'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'output', 'smoke');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const activityHome = fs.mkdtempSync(path.join(output, 'activity-'));
  const today = new Date().toISOString().slice(0, 10).split('-');
  const sessionFolder = path.join(activityHome, 'sessions', ...today);
  fs.mkdirSync(sessionFolder, { recursive: true });
  const activityFile = path.join(sessionFolder, 'rollout-ui-test.jsonl');
  const event = (type, turn = 'ui-turn', payload = {}) => fs.appendFileSync(activityFile, JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type, turn_id: turn, ...payload } }) + '\n');
  const env = { ...process.env, LINGLONG_TEST: '1', LINGLONG_TEST_DATA: process.env.LINGLONG_SMOKE_PROFILE || path.join(output, 'profile'), LINGLONG_ACTIVITY_HOME: activityHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = { args: process.env.LINGLONG_EXECUTABLE ? [] : [root], env, timeout: 30000 };
  if (process.env.LINGLONG_EXECUTABLE) launchOptions.executablePath = process.env.LINGLONG_EXECUTABLE;
  const app = await electron.launch(launchOptions);
  const errors = [];
  try {
    const pet = await app.firstWindow();
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.action === 'idle');
    assert.equal(await pet.locator('#bubble').isVisible(), false, 'no permanent bubble before any task');
    assert.equal(await pet.evaluate(() => typeof window.require), 'undefined');
    const alpha = await pet.evaluate(() => {
      const data = document.querySelector('canvas').getContext('2d').getImageData(0, 0, 640, 640).data;
      let visible = 0, transparent = 0; for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; if (data[i] > 128) visible++; }
      return { visible, transparent };
    });
    assert.ok(alpha.visible > 1000 && alpha.transparent > 1000, 'real transparent artwork rendered');
    await pet.screenshot({ path: path.join(output, 'pet.png'), omitBackground: true });
    await pet.evaluate(() => window.pet.panel('home'));
    const panel = app.windows().find(page => page.url().includes('panel.html'));
    assert.ok(panel, 'panel opened'); panel.on('pageerror', error => errors.push(error.message));
    await panel.waitForSelector('.hero-pet[data-action="idle"]');
    assert.equal(await panel.locator('#pet-name').textContent(), 'ChatGPT');
    assert.equal(await pet.locator('#home span').textContent(), 'ChatGPT');
    await panel.screenshot({ path: path.join(output, 'home.png') });
    await panel.getByRole('button', { name: '形象', exact: true }).click();
    await panel.locator('[data-appearance="mature"]').click();
    await pet.waitForFunction(() => document.querySelector('#character').dataset.request === 'mature:idle');
    for (const action of ['crouch', 'eat', 'headpat', 'sleep', 'wave', 'idle']) {
      await panel.evaluate(value => window.pet.action(value), action);
      await pet.waitForFunction(value => document.querySelector('#character').dataset.action === value, action);
    }
    await panel.screenshot({ path: path.join(output, 'looks.png') });
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).getBounds());
    await panel.evaluate(() => window.pet.saveSettings({ scale: .8, quiet: true, autoStart: false }));
    const resized = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).getBounds());
    assert.ok(resized.width < bounds.width, 'scale changes native window');
    await panel.evaluate(() => window.pet.saveSettings({ scale: .25 }));
    await pet.waitForFunction(() => document.querySelector('#character').getBoundingClientRect().width <= 81);
    const small = await pet.locator('#character').boundingBox();
    assert.ok(small.width >= 79, '25% renders an 80px character canvas');
    assert.equal(await pet.locator('#bubble').isVisible(), false, 'idle interactions do not leave a bubble');
    await pet.screenshot({ path: path.join(output, 'pet-small.png'), omitBackground: true });
    await panel.evaluate(() => window.pet.saveSettings({ scale: 3 }));
    const large = await app.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).getBounds();
      return { bounds, area: screen.getDisplayMatching(bounds).workArea };
    });
    assert.ok(large.bounds.width <= large.area.width && large.bounds.height <= large.area.height, '300% fits monitor work area');
    assert.equal(await panel.locator('#scale').getAttribute('max'), '3');
    assert.equal(await panel.locator('#scale').getAttribute('min'), '0.25');
    const longMessage = 'Codex 正在处理任务，正在检查相关文件和执行验证，请稍等一会儿；任务结束后会提示结果。';
    await app.evaluate(({ BrowserWindow }, message) => {
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).webContents.send('pet:update', {
        activity: { state: 'working', label: '正在处理任务', message, action: 'busy' }, action: 'headpat'
      });
    }, longMessage);
    for (const scale of [.25, .5, .65, 1, 1.5, 2, 3]) {
      await panel.evaluate(scale => window.pet.saveSettings({ scale, quiet: false }), scale);
      await pet.waitForFunction(() => !document.querySelector('#bubble').hidden && document.querySelector('#bubble').textContent.includes('正在检查'));
      await pet.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const boxes = await pet.evaluate(() => {
        const bubble = document.querySelector('#bubble').getBoundingClientRect(), character = document.querySelector('#character').getBoundingClientRect();
        return { bubbleBottom: bubble.bottom, characterTop: character.top, characterBottom: character.bottom, height: innerHeight };
      });
      assert.ok(boxes.bubbleBottom + 7 <= boxes.characterTop, `long bubble stays above animated character at ${scale}: ${JSON.stringify(boxes)}`);
      if (scale === .65) await pet.screenshot({ path: path.join(output, 'pet-long-bubble.png'), omitBackground: true });
    }
    for (const state of ['idle', 'offline', 'unknown']) {
      await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).webContents.send('pet:update', {
        resumeActivity: true, activity: { state, label: '暂无任务', message: '状态详情可在小窝查看。', action: 'idle' }
      }), state);
      await pet.waitForFunction(() => document.querySelector('#bubble').hidden);
      assert.equal(await pet.locator('#bubble').isVisible(), false, `${state} bubble hidden`);
    }
    await panel.evaluate(() => window.pet.saveSettings({ scale: 1, quiet: false, appearance: 'cute' }));
    const invalid = await panel.evaluate(async () => { try { await window.pet.action('execute-shell'); return false; } catch { return true; } });
    assert.ok(invalid, 'unknown IPC action rejected');
    const launched = await panel.evaluate(() => window.pet.launch()); assert.ok(launched.ok, 'launch orchestration works with test integrations');
    await pet.waitForFunction(() => document.querySelector('#character').dataset.action === 'success');
    await panel.getByRole('button', { name: '连接', exact: true }).click();
    await panel.waitForFunction(() => !document.querySelector('#refresh-status').disabled, null, { timeout: 25000 });
    await panel.screenshot({ path: path.join(output, 'status.png') });
    await panel.getByRole('button', { name: '额度', exact: true }).click();
    await panel.waitForFunction(() => !document.querySelector('#refresh-usage').disabled, null, { timeout: 25000 });
    await panel.screenshot({ path: path.join(output, 'usage.png') });
    await panel.getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await panel.locator('#autoStart').isChecked(), false);
    await panel.screenshot({ path: path.join(output, 'settings.png') });
    await panel.getByRole('button', { name: '小窝', exact: true }).click();
    event('task_started');
    await pet.waitForFunction(() => document.body.dataset.state === 'working' && document.querySelector('#character').dataset.action === 'busy', null, { timeout: 20000 });
    assert.equal(await pet.locator('#bubble').isVisible(), true, 'task starts show bubble');
    await panel.waitForFunction(() => document.querySelector('#activity-card').dataset.state === 'working');
    await pet.waitForFunction(() => document.querySelector('#character').dataset.asset === 'cute-working.png');
    await pet.screenshot({ path: path.join(output, 'pet-working.png'), omitBackground: true });
    await panel.screenshot({ path: path.join(output, 'home-working.png') });
    await panel.evaluate(() => window.pet.saveSettings({ appearance: 'mature' }));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.asset === 'mature-working.png');
    await pet.screenshot({ path: path.join(output, 'pet-working-mature.png'), omitBackground: true });
    await panel.evaluate(() => window.pet.saveSettings({ appearance: 'cute' }));
    await panel.evaluate(() => window.pet.action('headpat'));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.action === 'headpat');
    event('token_count');
    await pet.waitForFunction(() => document.querySelector('#character').dataset.action === 'busy', null, { timeout: 10000 });
    event('task_complete');
    await pet.waitForFunction(() => document.body.dataset.state === 'completed' && document.querySelector('#character').dataset.action === 'success', null, { timeout: 20000 });
    await pet.screenshot({ path: path.join(output, 'pet-completed.png'), omitBackground: true });
    event('task_started', 'ui-stop');
    await pet.waitForFunction(() => document.body.dataset.state === 'working', null, { timeout: 20000 });
    event('turn_aborted', 'ui-stop');
    await pet.waitForFunction(() => document.body.dataset.state === 'interrupted' && document.querySelector('#character').dataset.asset === 'cute-crying.png', null, { timeout: 20000 });
    assert.ok(!(await pet.locator('#bubble').textContent()).includes('已完成'), 'interruption is not success');
    assert.equal(await pet.locator('#bubble').isVisible(), true, 'interrupted result is visible briefly');
    await pet.screenshot({ path: path.join(output, 'pet-crying.png'), omitBackground: true });
    await panel.evaluate(() => window.pet.saveSettings({ appearance: 'mature' }));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.asset === 'mature-disappointed.png');
    await pet.screenshot({ path: path.join(output, 'pet-disappointed.png'), omitBackground: true });
    event('task_started', 'ui-fail');
    await pet.waitForFunction(() => document.body.dataset.state === 'working' && document.querySelector('#character').dataset.action === 'busy', null, { timeout: 20000 });
    event('task_complete', 'ui-fail', { error: { message: 'Fixture terminal failure', codex_error_info: 'other' } });
    await pet.waitForFunction(() => document.body.dataset.state === 'failed' && document.querySelector('#character').dataset.asset === 'mature-disappointed.png', null, { timeout: 20000 });
    await panel.waitForFunction(() => document.querySelector('#activity-card').dataset.state === 'failed');
    await panel.evaluate(() => window.pet.saveSettings({ appearance: 'cute' }));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.asset === 'cute-crying.png');
    await pet.waitForFunction(() => document.body.dataset.state === 'idle' && document.querySelector('#character').dataset.action === 'idle' && document.querySelector('#bubble').hidden, null, { timeout: 15000 });
    await pet.screenshot({ path: path.join(output, 'pet-idle-no-bubble.png'), omitBackground: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).setPosition(120, 120));
    await pet.evaluate(() => { window.pet.drag('start'); window.pet.drag('stop'); });
    assert.deepEqual(errors, [], 'no renderer runtime errors');
    console.log(JSON.stringify({ ok: true, assertions: ['transparent artwork', 'isolated renderer', 'ChatGPT naming', 'panel navigation', 'both appearances', 'six actions', '25%-300% resize', 'long bubble never overlaps animated character', 'idle/offline/unknown bubbles hidden', 'both redesigned working sprites', 'working/completed/interrupted/failed activity', 'cute crying and mature disappointed sprites', 'result expires to idle without bubble', 'new task resumes working', 'manual action returns to activity', 'settings persistence', 'IPC validation', 'launch sequence', 'connection status', 'usage display'], screenshots: output }));
  } finally { await app.close(); }
  const reopened = await electron.launch(launchOptions);
  try {
    const page = await reopened.firstWindow();
    await page.waitForFunction(() => document.querySelector('#character').dataset.action === 'idle');
    const restored = await reopened.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.equal(restored.x, 120, 'restores x after restart'); assert.equal(restored.y, 120, 'restores y after restart');
    console.log('Restart restored saved position.');
  } finally { await reopened.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
