'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'output', 'smoke');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const env = { ...process.env, LINGLONG_TEST: '1', LINGLONG_TEST_DATA: process.env.LINGLONG_SMOKE_PROFILE || path.join(output, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = { args: process.env.LINGLONG_EXECUTABLE ? [] : [root], env, timeout: 30000 };
  if (process.env.LINGLONG_EXECUTABLE) launchOptions.executablePath = process.env.LINGLONG_EXECUTABLE;
  const app = await electron.launch(launchOptions);
  const errors = [];
  try {
    const pet = await app.firstWindow();
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForFunction(() => document.querySelector('#character').dataset.action === 'idle');
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('pet.html')).setPosition(120, 120));
    await pet.evaluate(() => { window.pet.drag('start'); window.pet.drag('stop'); });
    assert.deepEqual(errors, [], 'no renderer runtime errors');
    console.log(JSON.stringify({ ok: true, assertions: ['transparent artwork', 'isolated renderer', 'panel navigation', 'both appearances', 'six actions', 'native resize', 'settings persistence', 'IPC validation', 'launch sequence', 'connection status', 'usage display'], screenshots: output }));
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
