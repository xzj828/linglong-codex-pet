'use strict';
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSettings, clampPosition, petSize } = require('./settings.cjs');
const { createActivityMonitor } = require('./codex-activity.cjs');
const integrations = require('./integrations.cjs');
const testing = process.env.LINGLONG_TEST === '1';
if (testing && process.env.LINGLONG_TEST_DATA) app.setPath('userData', process.env.LINGLONG_TEST_DATA);
app.setAppUserModelId('io.github.xzj828.linglong');
let petWindow, panelWindow, tray, store, dragging, dragTimer, launching = false;
let actionTimer, activityMonitor, options = {};
const root = path.join(__dirname, '..', '..');
const renderer = name => path.join(root, 'src', 'renderer', name);
const allowedUrls = new Set(['pet.html', 'panel.html'].map(name => pathToFileURL(renderer(name)).href));
const validActions = new Set(['idle', 'wave', 'crouch', 'eat', 'headpat', 'sleep', 'busy', 'success']);
function trusted(event) {
  return [petWindow, panelWindow].some(win => win && !win.isDestroyed() && event.sender === win.webContents) && allowedUrls.has(event.senderFrame?.url?.split('?')[0]);
}
function send(data) {
  for (const win of [petWindow, panelWindow]) if (win && !win.isDestroyed()) win.webContents.send('pet:update', data);
}
function animate(action, message) {
  clearTimeout(actionTimer);
  send({ action, message });
  if (action !== 'busy') actionTimer = setTimeout(() => send({ resumeActivity: true }), ['sleep', 'crouch'].includes(action) ? 15000 : 5200);
}
function loginSettings() {
  return { name: 'LinglongPet', path: process.execPath, args: app.isPackaged ? ['--autostart'] : ['"' + root + '"', '--autostart'] };
}
function autoStart(enabled) {
  if (!testing && process.platform === 'win32') app.setLoginItemSettings({ ...loginSettings(), openAtLogin: enabled, enabled });
}
function safePosition(position, size) {
  const display = screen.getDisplayNearestPoint({ x: position.x + Math.round(size.width / 2), y: position.y + Math.round(size.height / 2) });
  return clampPosition(position, display.workArea, size);
}
function resizePet(restore = false) {
  const config = store.get();
  const current = petWindow?.getBounds();
  const area = (current && restore !== true
    ? screen.getDisplayMatching(current)
    : Number.isFinite(config.x) && Number.isFinite(config.y)
      ? screen.getDisplayNearestPoint({ x: config.x, y: config.y })
      : screen.getPrimaryDisplay()).workArea;
  const size = petSize(config.scale, area);
  const initial = { x: config.x ?? area.x + area.width - size.width - 32, y: config.y ?? area.y + area.height - size.height - 10 };
  const position = clampPosition(restore === true ? initial : (current || initial), area, size);
  petWindow.setBounds({ ...position, ...size });
  petWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating');
}
function webPreferences() { return { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }; }
function lockWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}
async function panel(tab = 'home') {
  if (!['home', 'looks', 'status', 'usage', 'settings'].includes(tab)) tab = 'home';
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show(); panelWindow.focus(); send({ tab }); return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  panelWindow = new BrowserWindow({ width: 480, height: Math.min(840, area.height - 24), minWidth: 440, minHeight: 520, icon: path.join(root, 'assets', 'icon.ico'), title: 'ChatGPT · 桌边的小小陪伴', backgroundColor: '#f7f5fc', autoHideMenuBar: true, show: false, webPreferences: webPreferences() });
  lockWindow(panelWindow);
  await panelWindow.loadFile(renderer('panel.html'), { query: { tab } });
  panelWindow.show();
  panelWindow.on('closed', () => { panelWindow = null; });
}
async function launch() {
  if (launching) return { ok: false, busy: true, message: '正在连接，请稍等一下。' };
  launching = true;
  animate('busy', '正在唤醒 Nano…');
  try {
    const connection = testing ? { connected: true, message: '测试连接' } : await integrations.connectNano({ ...options, onProgress: message => animate('busy', message) });
    if (!connection.connected) {
      animate('sad', connection.message || 'Nano 还没连好，右键查看连接状态。');
      return { ok: false, connection, message: connection.message };
    }
    animate('busy', '连接就绪，正在打开 Codex…');
    const codex = testing ? { opened: true } : await integrations.openCodex(options);
    if (codex.opened === false || codex.ok === false) throw new Error(codex.message || '无法打开 Codex，请检查应用路径。');
    animate('success', '准备好啦，一起开始吧。');
    return { ok: true, connection, codex, message: 'Nano 已连接，Codex 已打开。' };
  } catch (error) {
    animate('sad', error.message || '启动遇到问题，右键查看状态。');
    return { ok: false, message: error.message || '启动失败' };
  } finally { launching = false; clearTimeout(actionTimer); actionTimer = setTimeout(() => send({ resumeActivity: true }), 5200); }
}
function menu() {
  const config = store.get();
  const item = (label, action, message) => ({ label, click: () => animate(action, message) });
  return Menu.buildFromTemplate([
    { label: 'ChatGPT · 在你桌边', enabled: false },
    { label: launching ? '正在准备…' : '连接 Nano 并打开 Codex', enabled: !launching, click: launch },
    { type: 'separator' },
    { label: '切换形象', submenu: [
      { label: '可爱', type: 'radio', checked: config.appearance === 'cute', click: () => update({ appearance: 'cute' }) },
      { label: '成熟', type: 'radio', checked: config.appearance === 'mature', click: () => update({ appearance: 'mature' }) }
    ] },
    item('蹲下休息', 'crouch', '歇一小会儿，陪你慢慢来。'),
    item('吃饭', 'eat', '今天也要好好吃饭呀。'),
    item('摸摸头', 'headpat', '嘿嘿，被你发现了。'),
    item('打个招呼', 'wave', '我在这里哦。'),
    item('睡一会儿', 'sleep', '晚安，做个柔软的梦。'),
    item('站起来', 'idle', '精神满满！'),
    { type: 'separator' },
    { label: '查看 Codex 工作状态', click: () => panel('home') },
    { label: '查看连接状态', click: () => panel('status') },
    { label: '查看剩余额度', click: () => panel('usage') },
    { label: '我的小窝 / 设置', click: () => panel('home') },
    { label: '开机自启动', type: 'checkbox', checked: config.autoStart, click: item => update({ autoStart: item.checked }) },
    { label: '始终置顶', type: 'checkbox', checked: config.alwaysOnTop, click: item => update({ alwaysOnTop: item.checked }) },
    { type: 'separator' },
    { label: petWindow?.isVisible() ? '暂时隐藏（从托盘找回）' : '显示桌宠', click: () => {
      if (petWindow.isVisible()) petWindow.hide(); else petWindow.showInactive();
      tray?.setContextMenu(menu());
    } },
    { label: '退出ChatGPT', click: () => app.quit() }
  ]);
}
function update(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式无效');
  const filtered = {};
  for (const key of ['appearance', 'scale', 'alwaysOnTop', 'autoStart', 'quiet']) if (key in patch) filtered[key] = patch[key];
  const config = store.update(filtered);
  if ('autoStart' in filtered) autoStart(config.autoStart);
  resizePet(); send({ settings: config });
  tray?.setContextMenu(menu());
  return config;
}
function registerHandlers() {
  const handlers = {
    settings: () => store.get(),
    'save-settings': update,
    launch,
    status: () => integrations.getConnectionStatus(options),
    activity: () => activityMonitor.getSnapshot(),
    usage: () => integrations.getUsage(options),
    action: value => {
      if (!validActions.has(value) || ['busy', 'success'].includes(value)) throw new Error('未知动作');
      animate(value); return { ok: true };
    },
    panel,
    menu: () => { petWindow.setIgnoreMouseEvents(false); menu().popup({ window: petWindow }); },
    'close-panel': () => panelWindow?.close(),
    'open-usage': () => shell.openExternal('https://chatgpt.com/codex/settings/usage'),
    'locate-app': async name => {
      if (!['nano', 'codex'].includes(name)) throw new Error('未知应用');
      const result = await dialog.showOpenDialog(panelWindow, { title: `选择 ${name === 'nano' ? 'Nano' : 'Codex'} 程序`, properties: ['openFile'], filters: [{ name: 'Windows 应用', extensions: ['exe'] }] });
      if (result.canceled) return { canceled: true };
      options[name + 'Path'] = result.filePaths[0];
      fs.writeFileSync(path.join(app.getPath('userData'), 'local-config.json'), JSON.stringify(options, null, 2));
      return { ok: true };
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle('pet:' + name, (event, value) => {
    if (!trusted(event)) throw new Error('不允许的请求');
    return handler(value);
  });
  ipcMain.on('pet:mouse', (event, ignore) => {
    if (trusted(event) && event.sender === petWindow.webContents && typeof ignore === 'boolean' && !dragging) petWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });
  ipcMain.on('pet:drag', (event, stage) => {
    if (!trusted(event) || event.sender !== petWindow.webContents) return;
    if (stage === 'start') {
      clearInterval(dragTimer);
      const cursor = screen.getCursorScreenPoint(), bounds = petWindow.getBounds();
      dragging = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
      petWindow.setIgnoreMouseEvents(false);
      dragTimer = setInterval(() => {
        if (!dragging) return;
        const point = screen.getCursorScreenPoint();
        const position = safePosition({ x: point.x - dragging.x, y: point.y - dragging.y }, petWindow.getBounds());
        petWindow.setPosition(position.x, position.y);
      }, 16);
    } else if (stage === 'stop') stopDrag();
  });
}
function stopDrag() {
  clearInterval(dragTimer);
  if (!dragging) return;
  dragging = null;
  const { x, y } = petWindow.getBounds(); store.update({ x, y });
}
function trayIcon() {
  const size = 32, pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const inCircle = Math.hypot(x - 15.5, y - 15.5) < 15;
    const star = Math.abs(x - 15.5) + Math.abs(y - 15.5) < 10;
    pixels[i] = star ? 255 : 205; pixels[i + 1] = star ? 255 : 136; pixels[i + 2] = star ? 255 : 131; pixels[i + 3] = inCircle ? 255 : 0;
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { petWindow?.showInactive(); panel('home'); });
  app.whenReady().then(async () => {
    store = createSettings(app.getPath('userData'), { onError: error => {
      console.warn('Settings could not be saved:', error.code || 'IO_ERROR');
      send({ message: '暂时无法保存设置，本次操作仍然有效；退出后可能恢复旧设置。' });
    } });
    try { options = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'local-config.json'), 'utf8')); } catch { options = {}; }
    activityMonitor = createActivityMonitor({
      codexHome: testing ? process.env.LINGLONG_ACTIVITY_HOME || path.join(app.getPath('userData'), 'codex-fixture') : options.codexHome,
      ...(testing ? { processProbe: async () => true, completionMs: 5000 } : {}),
      onChange: activity => send({ activity })
    });
    petWindow = new BrowserWindow({ width: 320, height: 380, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, hasShadow: false, skipTaskbar: true, show: false, webPreferences: webPreferences() });
    lockWindow(petWindow); resizePet(true); registerHandlers();
    petWindow.on('blur', stopDrag);
    await petWindow.loadFile(renderer('pet.html'));
    petWindow.showInactive();
    activityMonitor.start();
    tray = new Tray(trayIcon()); tray.setToolTip('ChatGPT桌宠 · 右键互动，左键启程'); tray.setContextMenu(menu());
    tray.on('double-click', () => { petWindow.showInactive(); panel('home'); });
    autoStart(store.get().autoStart);
    screen.on('display-metrics-changed', resizePet);
    screen.on('display-removed', resizePet);
    if (process.argv.includes('--welcome')) await panel('home');
  }).catch(error => { console.error(error); app.quit(); });
  app.on('before-quit', () => { clearTimeout(actionTimer); clearInterval(dragTimer); activityMonitor?.stop(); });
  app.on('window-all-closed', () => app.quit());
}
