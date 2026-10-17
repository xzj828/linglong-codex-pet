'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize, createSettings, clampPosition } = require('../src/main/settings.cjs');
test('invalid settings cannot inject appearance paths or nonfinite bounds', () => {
  const config = normalize({ appearance: '../../private', scale: Infinity, x: NaN, autoStart: 'false' });
  assert.equal(config.appearance, 'cute'); assert.equal(config.scale, 1); assert.equal(config.x, null); assert.equal(config.autoStart, true);
  assert.equal(normalize({ scale: 99 }).scale, 1.5);
  assert.equal(normalize({ scale: -5 }).scale, .65);
});
test('corrupt settings recover and persist validated changes atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linglong-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
    const store = createSettings(dir); assert.equal(store.get().appearance, 'cute');
    store.update({ appearance: 'mature', autoStart: false });
    assert.equal(createSettings(dir).get().appearance, 'mature');
    assert.equal(createSettings(dir).get().autoStart, false);
    assert.equal(fs.existsSync(path.join(dir, 'settings.json.tmp')), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('screen positioning recovers offscreen pets and handles monitors left of primary', () => {
  assert.deepEqual(clampPosition({ x: 9000, y: -999 }, { x: -1920, y: 0, width: 1920, height: 1080 }, { width: 320, height: 380 }), { x: -320, y: 0 });
  assert.deepEqual(clampPosition({ x: -10, y: 2000 }, { x: 0, y: 0, width: 1920, height: 1040 }, { width: 320, height: 380 }), { x: 0, y: 660 });
});
