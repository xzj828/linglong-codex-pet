'use strict';
// Exercise real writes under the user's Windows profile without touching
// the running app's settings. The child directory inherits profile policies.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createSettings } = require('../src/main/settings.cjs');
const parent = path.join(process.env.APPDATA, 'linglong-codex-pet');
fs.mkdirSync(parent, { recursive: true });
const directory = fs.mkdtempSync(path.join(parent, 'settings-check-'));
const renameErrors = [], saveErrors = [];
const io = { ...fs, renameSync: (...args) => {
  try { fs.renameSync(...args); } catch (error) { renameErrors.push(error.code); throw error; }
} };
try {
  const store = createSettings(directory, { fs: io, onError: error => saveErrors.push(error.code) });
  store.update({ appearance: 'mature', scale: .85, x: 234, y: 345 });
  assert.equal(createSettings(directory).get().appearance, 'mature');
  store.update({ x: 456, y: 567 });
  const restored = createSettings(directory).get();
  assert.equal(restored.x, 456); assert.equal(restored.y, 567);
  assert.equal(restored.scale, .85); assert.equal(restored.appearance, 'mature');
  assert.deepEqual(saveErrors, []);
  assert.equal(fs.existsSync(path.join(directory, 'settings.json.tmp')), false);
  console.log(JSON.stringify({ ok: true, renameErrors, persistedAcrossReload: true }));
} finally {
  for (const name of ['settings.json', 'settings.json.tmp']) {
    const file = path.join(directory, name); if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  fs.rmdirSync(directory);
}
