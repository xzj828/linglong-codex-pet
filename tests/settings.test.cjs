'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize, createSettings, clampPosition, petSize } = require('../src/main/settings.cjs');
test('invalid settings cannot inject appearance paths or nonfinite bounds', () => {
  const config = normalize({ appearance: '../../private', scale: Infinity, x: NaN, autoStart: 'false' });
  assert.equal(config.appearance, 'cute'); assert.equal(config.scale, 1); assert.equal(config.x, null); assert.equal(config.autoStart, true);
  assert.equal(normalize({ scale: 99 }).scale, 3);
  assert.equal(normalize({ scale: -5 }).scale, .25);
});
test('wide size range keeps small status text usable and large pets inside the work area', () => {
  const area = { width: 1920, height: 1040 };
  assert.deepEqual(petSize(.25, area), { width: 220, height: 190 });
  assert.deepEqual(petSize(1, area), { width: 320, height: 380 });
  assert.deepEqual(petSize(3, area), { width: 960, height: 1040 });
  assert.deepEqual(petSize(3, { width: 800, height: 600 }), { width: 800, height: 600 });
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
function settingsFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linglong-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'settings.json'), temporary: path.join(directory, 'settings.json.tmp') };
}
function ioError(code) { return Object.assign(new Error(`Simulated ${code}`), { code }); }

test('EXDEV during drag-position save falls back to copy and survives restart', t => {
  const { directory, file, temporary } = settingsFixture(t);
  createSettings(directory).update({ appearance: 'mature', autoStart: false });
  let copies = 0;
  const errors = [];
  const store = createSettings(directory, { fs: {
    ...fs,
    renameSync: () => { throw ioError('EXDEV'); },
    copyFileSync: (source, destination) => {
      assert.equal(source, temporary); assert.equal(destination, file);
      // The previous valid configuration must still exist when fallback starts.
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).appearance, 'mature');
      copies++;
      fs.copyFileSync(source, destination);
    }
  }, onError: error => errors.push(error) });
  store.update({ x: 427.8, y: 312.2 });
  assert.equal(copies, 1);
  assert.deepEqual(errors, []);
  assert.equal(fs.existsSync(temporary), false);
  const restarted = createSettings(directory).get();
  assert.equal(restarted.x, 428); assert.equal(restarted.y, 312);
  assert.equal(restarted.appearance, 'mature'); assert.equal(restarted.autoStart, false);
});

test('failed temporary write preserves committed settings and keeps updates usable in memory', t => {
  const { directory, file, temporary } = settingsFixture(t);
  createSettings(directory).update({ appearance: 'mature', x: 15 });
  const committed = fs.readFileSync(file, 'utf8');
  const failure = ioError('ENOSPC');
  const errors = [];
  const store = createSettings(directory, { fs: {
    ...fs,
    writeFileSync: destination => {
      assert.equal(destination, temporary);
      fs.writeFileSync(destination, '{partial');
      throw failure;
    }
  }, onError: error => errors.push(error) });
  assert.doesNotThrow(() => store.update({ x: 640 }));
  assert.equal(store.get().x, 640);
  assert.equal(store.update({ quiet: true }).x, 640);
  assert.equal(store.get().quiet, true);
  assert.deepEqual(errors, [failure, failure]);
  assert.equal(fs.readFileSync(file, 'utf8'), committed);
  assert.equal(createSettings(directory).get().x, 15);
});

test('interrupted EXDEV fallback retains complete temporary settings for restart recovery', t => {
  const { directory, file, temporary } = settingsFixture(t);
  createSettings(directory).update({ appearance: 'mature', autoStart: false });
  const failure = ioError('EIO');
  const errors = [];
  const store = createSettings(directory, { fs: {
    ...fs,
    renameSync: () => { throw ioError('EXDEV'); },
    copyFileSync: (source, destination) => {
      fs.writeFileSync(destination, '{interrupted');
      throw failure;
    }
  }, onError: error => errors.push(error) });
  assert.doesNotThrow(() => store.update({ x: 710, y: 420 }));
  assert.deepEqual(errors, [failure]);
  assert.equal(JSON.parse(fs.readFileSync(temporary, 'utf8')).x, 710);
  const restarted = createSettings(directory);
  assert.equal(restarted.get().appearance, 'mature');
  assert.equal(restarted.get().autoStart, false);
  assert.equal(restarted.get().x, 710); assert.equal(restarted.get().y, 420);
  restarted.update({ quiet: true });
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(createSettings(directory).get().quiet, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).x, 710);
});

test('non-EXDEV rename errors preserve committed data and cannot escape through error callbacks', t => {
  const { directory, file } = settingsFixture(t);
  createSettings(directory).update({ appearance: 'mature', x: 32 });
  const committed = fs.readFileSync(file, 'utf8');
  const failure = ioError('EACCES');
  let copied = false;
  let reported;
  const store = createSettings(directory, { fs: {
    ...fs,
    renameSync: () => { throw failure; },
    copyFileSync: () => { copied = true; }
  }, onError: error => { reported = error; throw new Error('Notification unavailable'); } });
  assert.doesNotThrow(() => store.update({ x: 600 }));
  assert.equal(copied, false); assert.equal(reported, failure);
  assert.equal(store.get().x, 600);
  assert.equal(fs.readFileSync(file, 'utf8'), committed);
  assert.equal(createSettings(directory).get().x, 32);
});

test('a committed file wins over stale temporary settings when cleanup fails', t => {
  const { directory, temporary } = settingsFixture(t);
  const errors = [];
  const store = createSettings(directory, { fs: {
    ...fs,
    renameSync: () => { throw ioError('EXDEV'); },
    unlinkSync: () => { throw ioError('EPERM'); }
  }, onError: error => errors.push(error) });
  assert.doesNotThrow(() => store.update({ appearance: 'mature', x: 245 }));
  assert.deepEqual(errors, []);
  assert.equal(fs.existsSync(temporary), true);
  fs.writeFileSync(temporary, JSON.stringify({ appearance: 'cute', x: 900 }));
  const restarted = createSettings(directory).get();
  assert.equal(restarted.appearance, 'mature'); assert.equal(restarted.x, 245);
});

test('missing or invalid main JSON recovers only a valid temporary settings object', t => {
  const { directory, file, temporary } = settingsFixture(t);
  fs.writeFileSync(temporary, JSON.stringify({ appearance: 'mature', x: 181 }));
  assert.equal(createSettings(directory).get().x, 181);
  for (const invalid of ['null', '[]', 'false', '1', '"text"', '{broken']) {
    fs.writeFileSync(file, invalid);
    assert.equal(createSettings(directory).get().appearance, 'mature', `Main JSON: ${invalid}`);
  }
  fs.writeFileSync(temporary, 'null');
  assert.equal(createSettings(directory).get().appearance, 'cute');
  assert.equal(createSettings(directory).get().x, null);
});

test('a recovered temporary file is committed before a later failed write can overwrite it', t => {
  const { directory, file, temporary } = settingsFixture(t);
  fs.writeFileSync(temporary, JSON.stringify({ appearance: 'mature', x: 181 }));
  const failure = ioError('ENOSPC');
  const errors = [];
  const recovered = createSettings(directory, { fs: {
    ...fs,
    writeFileSync: destination => {
      fs.writeFileSync(destination, '{partial');
      throw failure;
    }
  }, onError: error => errors.push(error) });
  assert.equal(recovered.get().x, 181);
  assert.doesNotThrow(() => recovered.update({ x: 500 }));
  assert.equal(recovered.get().x, 500);
  assert.deepEqual(errors, [failure]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).x, 181);
  assert.equal(createSettings(directory).get().appearance, 'mature');
  assert.equal(createSettings(directory).get().x, 181);
});

test('failed recovery copy leaves the only complete temporary settings untouched', t => {
  const { directory, temporary } = settingsFixture(t);
  const saved = JSON.stringify({ appearance: 'mature', x: 181 });
  fs.writeFileSync(temporary, saved);
  const failure = ioError('EACCES');
  const errors = [];
  const recovered = createSettings(directory, { fs: {
    ...fs,
    copyFileSync: () => { throw failure; }
  }, onError: error => errors.push(error) });
  assert.doesNotThrow(() => recovered.update({ x: 500 }));
  assert.equal(recovered.get().x, 500);
  assert.deepEqual(errors, [failure]);
  assert.equal(fs.readFileSync(temporary, 'utf8'), saved);
  assert.equal(createSettings(directory).get().x, 181);
});
test('screen positioning recovers offscreen pets and handles monitors left of primary', () => {
  assert.deepEqual(clampPosition({ x: 9000, y: -999 }, { x: -1920, y: 0, width: 1920, height: 1080 }, { width: 320, height: 380 }), { x: -320, y: 0 });
  assert.deepEqual(clampPosition({ x: -10, y: 2000 }, { x: 0, y: 0, width: 1920, height: 1040 }, { width: 320, height: 380 }), { x: 0, y: 660 });
});
