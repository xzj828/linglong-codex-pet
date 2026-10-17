import { drawSprite } from './sprites.js';
let settings = await window.pet.getSettings(), toastTimer, statusBusy = false, usageBusy = false;
const $ = selector => document.querySelector(selector);
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 6500); }
function time(value) { if (!value) return '未知'; const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function renderSettings() {
  for (const name of ['autoStart', 'alwaysOnTop', 'quiet']) $('#' + name).checked = settings[name];
  $('#scale').value = settings.scale; $('#scale-label').textContent = Math.round(settings.scale * 100) + '%';
  $('#pet-name').textContent = settings.appearance === 'cute' ? '小玲' : '玲月';
  document.querySelectorAll('[data-appearance]').forEach(el => el.classList.toggle('active', el.dataset.appearance === settings.appearance));
  drawSprite($('.hero-pet'), settings.appearance).catch(() => toast('角色图片加载失败'));
}
async function save(patch) { try { settings = await window.pet.saveSettings(patch); renderSettings(); } catch (error) { toast(error.message); } }
async function showTab(tab) {
  if (!['home', 'looks', 'status', 'usage', 'settings'].includes(tab)) tab = 'home';
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== tab);
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('selected', el.dataset.tab === tab));
  if (tab === 'status') await refreshStatus();
  if (tab === 'usage') await refreshUsage();
}
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => showTab(el.dataset.tab)));
document.querySelectorAll('[data-appearance]').forEach(el => el.addEventListener('click', () => save({ appearance: el.dataset.appearance })));
document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', async () => { await window.pet.action(el.dataset.action); toast('好呀，我在桌边陪你。'); }));
document.querySelectorAll('.launch-button').forEach(el => el.addEventListener('click', async () => {
  const buttons = [...document.querySelectorAll('.launch-button')]; buttons.forEach(button => button.disabled = true);
  try { const result = await window.pet.launch(); toast(result.message || (result.ok ? '准备好啦。' : '请查看连接状态。')); } catch (error) { toast(error.message); }
  finally { buttons.forEach(button => button.disabled = false); if (!$('#status').hidden) refreshStatus(); }
}));
for (const key of ['autoStart', 'alwaysOnTop', 'quiet']) $('#' + key).addEventListener('change', event => save({ [key]: event.target.checked }));
$('#scale').addEventListener('input', event => $('#scale-label').textContent = Math.round(Number(event.target.value) * 100) + '%');
$('#scale').addEventListener('change', event => save({ scale: Number(event.target.value) }));
document.querySelectorAll('[data-locate]').forEach(el => el.addEventListener('click', async () => { try { const result = await window.pet.locateApp(el.dataset.locate); if (result.ok) toast('应用位置已保存。'); } catch (error) { toast(error.message); } }));
async function refreshStatus() {
  if (statusBusy) return; statusBusy = true; $('#refresh-status').disabled = true; $('#status-message').textContent = '正在检查应用和连接…';
  try {
    const status = await window.pet.status();
    $('#nano-detail').textContent = status.nanoInstalled ? (status.nanoRunning ? '已运行 · 沿用当前节点' : '已安装 · 尚未运行') : '未找到应用，请在设置中选择';
    $('#nano-badge').textContent = status.connected ? '已连接' : status.proxyEnabled ? '待验证' : '未连接';
    $('#nano-badge').className = 'badge ' + (status.connected ? '' : 'warn');
    $('#codex-detail').textContent = status.codexInstalled ? '已找到桌面应用' : '未找到应用，请在设置中选择';
    $('#codex-badge').textContent = status.codexInstalled ? '可启动' : '未找到';
    $('#codex-badge').className = 'badge ' + (status.codexInstalled ? '' : 'neutral');
    $('#status-message').textContent = status.message || '检测完成。'; $('#status-time').textContent = '检测于 ' + time(status.checkedAt || Date.now());
  } catch (error) { $('#status-message').textContent = error.message || '连接状态读取失败。'; }
  finally { statusBusy = false; $('#refresh-status').disabled = false; }
}
function meter(prefix, value) {
  const block = $('#' + prefix + '-value').closest('.meter-block'); block.hidden = !value;
  if (!value) return;
  const remaining = Number.isFinite(value.remainingPercent) ? Math.max(0, Math.min(100, value.remainingPercent)) : null;
  $('#' + prefix + '-value').textContent = remaining === null ? '未知' : Math.round(remaining) + '%';
  $('#' + prefix + '-bar').style.width = (remaining ?? 0) + '%';
  const minutes = value.windowMinutes;
  $('#' + prefix + '-label').textContent = minutes ? (minutes >= 1440 ? Math.round(minutes / 1440) + ' 天额度' : minutes < 60 ? minutes + ' 分钟额度' : Number((minutes / 60).toFixed(1)) + ' 小时额度') : (prefix === 'primary' ? '短周期额度' : '长周期额度');
  $('#' + prefix + '-reset').textContent = value.resetsAt ? '预计重置 ' + time(value.resetsAt) : '未提供重置时间';
}
async function refreshUsage() {
  if (usageBusy) return; usageBusy = true; $('#refresh-usage').disabled = true;
  $('#usage-state').hidden = false; $('#usage-state strong').textContent = '正在读取额度…'; $('#usage-state p').textContent = '请稍等，正在查询本机 Codex。'; $('#usage-meters').hidden = true;
  try {
    const usage = await window.pet.usage();
    const hasData = usage.available && (usage.primary || usage.secondary);
    $('#usage-state').hidden = Boolean(hasData); $('#usage-meters').hidden = !hasData;
    if (hasData) { meter('primary', usage.primary); meter('secondary', usage.secondary); }
    else { $('#usage-state strong').textContent = '暂时无法读取额度'; $('#usage-state p').textContent = usage.message || '请打开官方用量页查看。'; }
    $('#usage-time').textContent = usage.observedAt ? (usage.stale ? '历史快照 · ' : '更新于 ') + time(usage.observedAt) : '';
    $('#usage-note').textContent = usage.message || '此数据为 Codex 使用额度，不是账户余额。';
  } catch (error) { $('#usage-state strong').textContent = '暂时无法读取额度'; $('#usage-state p').textContent = error.message; }
  finally { usageBusy = false; $('#refresh-usage').disabled = false; }
}
$('#refresh-status').addEventListener('click', refreshStatus); $('#refresh-usage').addEventListener('click', refreshUsage); $('#open-usage').addEventListener('click', () => window.pet.openUsage());
window.pet.onUpdate(update => { if (update.settings) { settings = update.settings; renderSettings(); } if (update.tab) showTab(update.tab); if (update.message) toast(update.message); });
document.querySelectorAll('[data-preview]').forEach(canvas => drawSprite(canvas, canvas.dataset.preview).catch(() => {}));
renderSettings(); showTab(new URLSearchParams(location.search).get('tab') || 'home');
