'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createActivityMonitor } = require('../src/main/codex-activity.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-activity-'));
  let timestamp = Date.UTC(2026, 9, 17, 12);
  const sessions = path.join(directory, 'sessions', '2026', '10', '17');
  fs.mkdirSync(sessions, { recursive: true });
  const changes = [];
  const monitor = createActivityMonitor({
    codexHome: directory, now: () => timestamp, processProbe: async () => true,
    discoverMs: 100, processProbeMs: 100, onChange: state => changes.push(state), ...options,
  });
  t.after(() => { monitor.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  function file(name = 'a') { return path.join(sessions, `rollout-${name}.jsonl`); }
  function event(type, extra = {}, at = timestamp) {
    return JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type, turn_id: 'turn-one', ...extra } }) + '\n';
  }
  return {
    directory, monitor, changes, file, event,
    append(type, extra = {}, name = 'a', at = timestamp) { fs.appendFileSync(file(name), event(type, extra, at)); },
    advance(ms) { timestamp += ms; }, now() { return timestamp; },
  };
}

test('only lifecycle metadata is exposed through work, completion and stop transitions', async t => {
  const f = fixture(t);
  f.append('task_started', { private_prompt: 'PRIVATE-CONTENT-SENTINEL' });
  assert.equal((await f.monitor.refresh()).state, 'working');
  assert.equal(f.monitor.getSnapshot().action, 'busy');
  f.advance(200);
  f.append('task_complete', { last_agent_message: 'PRIVATE-CONTENT-SENTINEL' });
  const complete = await f.monitor.refresh();
  assert.equal(complete.state, 'completed'); assert.equal(complete.action, 'success');
  f.advance(200);
  f.append('task_started', { turn_id: 'turn-two' });
  await f.monitor.refresh();
  f.append('turn_aborted', { turn_id: 'turn-two', reason: 'PRIVATE-CONTENT-SENTINEL' });
  const aborted = await f.monitor.refresh();
  assert.equal(aborted.state, 'idle'); assert.equal(aborted.label, '任务已停止');
  assert.equal(JSON.stringify(f.changes).includes('PRIVATE-CONTENT-SENTINEL'), false);
  assert.deepEqual(Object.keys(aborted).sort(), ['state', 'label', 'message', 'action', 'observedAt', 'activeCount', 'source'].sort());
});

test('token accounting extends an active turn but never resurrects a completed one', async t => {
  const f = fixture(t, { staleMs: 600000 });
  f.append('task_started'); await f.monitor.refresh();
  f.advance(590000); f.append('token_count');
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.advance(590000);
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.advance(20000);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  f.append('task_complete'); await f.monitor.refresh();
  f.advance(1000); f.append('token_count');
  assert.equal((await f.monitor.refresh()).state, 'completed');
  f.advance(61000);
  assert.equal((await f.monitor.refresh()).state, 'idle');
});

test('simultaneous sessions remain working until every active session has finished', async t => {
  const f = fixture(t);
  f.append('task_started', {}, 'a');
  f.advance(200); f.append('task_started', { turn_id: 'turn-b' }, 'b');
  const active = await f.monitor.refresh();
  assert.equal(active.activeCount, 2); assert.match(active.message, /2/);
  assert.equal(active.observedAt, new Date(f.now()).toISOString());
  f.advance(200); f.append('task_complete', { turn_id: 'turn-b' }, 'b');
  assert.equal((await f.monitor.refresh()).activeCount, 1);
  assert.equal(f.monitor.getSnapshot().state, 'working');
  f.advance(200); f.append('task_complete', {}, 'a');
  assert.equal((await f.monitor.refresh()).state, 'completed');
});

test('a stale start is uncertain and a running process alone is never classified as working', async t => {
  const f = fixture(t);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  f.advance(200); f.append('task_started', {}, 'a', f.now() - 3600000);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  assert.match(f.monitor.getSnapshot().message, /无法确认/);
  assert.equal(f.monitor.getSnapshot().activeCount, 0);
});

test('a confirmed stopped Codex process overrides unfinished historical events', async t => {
  const f = fixture(t, { processProbe: async () => false });
  f.append('task_started');
  const state = await f.monitor.refresh();
  assert.equal(state.state, 'offline'); assert.equal(state.activeCount, 0);
});

test('split lines and malformed events do not corrupt incremental state', async t => {
  const f = fixture(t);
  const line = f.event('task_started');
  fs.writeFileSync(f.file(), line.slice(0, -12));
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  fs.appendFileSync(f.file(), line.slice(-12));
  assert.equal((await f.monitor.refresh()).state, 'working');
  fs.appendFileSync(f.file(), '{invalid json}\n' + f.event('task_complete', {}, f.now() + 120000));
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'completed');
});

test('a bounded initial tail skips huge model output and finds subsequent lifecycle metadata', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.file(), JSON.stringify({ type: 'response_item', payload: { content: 'X'.repeat(2 * 1024 * 1024) } }) + '\n' + f.event('task_started'));
  assert.equal((await f.monitor.refresh()).state, 'working');
  fs.appendFileSync(f.file(), JSON.stringify({ type: 'response_item', payload: { content: 'X'.repeat(600000) } }) + '\n' + f.event('task_complete'));
  // Each refresh is bounded to 256 KiB per file, including oversized records.
  for (let i = 0; i < 3; i++) await f.monitor.refresh();
  assert.equal(f.monitor.getSnapshot().state, 'completed');
});

test('a truncated rollout is reread and unrelated old-turn completions do not end new work', async t => {
  const f = fixture(t);
  f.append('task_started'); f.append('task_complete');
  await f.monitor.refresh(); f.advance(200);
  fs.writeFileSync(f.file(), f.event('task_started', { turn_id: 'new-turn' }));
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.advance(200); f.append('task_complete', { turn_id: 'old-turn' });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete', { turn_id: 'new-turn' });
  assert.equal((await f.monitor.refresh()).state, 'completed');
});

test('probe failures and subscriber exceptions do not escape, and polling is cached', async t => {
  let probes = 0;
  const f = fixture(t, { processProbeMs: 8000, processProbe: async () => { probes++; throw Error('unavailable'); }, onChange: () => { throw Error('subscriber'); } });
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  f.append('task_started'); f.advance(200);
  assert.equal((await f.monitor.refresh()).state, 'working');
  await f.monitor.refresh(); assert.equal(probes, 1);
  f.advance(8000); await f.monitor.refresh(); assert.equal(probes, 2);
});

test('only contained rollout files are read and immutable snapshots are returned', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  const outside = path.join(f.directory, 'auth.json');
  fs.writeFileSync(outside, f.event('task_started'));
  candidates = [outside];
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  const snapshot = f.monitor.getSnapshot(); snapshot.state = 'working';
  assert.equal(f.monitor.getSnapshot().state, 'unknown');
});

test('lost access to a completed rollout produces unknown instead of stale success or idle', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  candidates = [f.file()];
  f.append('task_started'); f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'completed');
  const contents = fs.readFileSync(f.file());
  fs.unlinkSync(f.file());
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  f.advance(61000);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  fs.mkdirSync(f.file());
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  fs.rmdirSync(f.file()); fs.writeFileSync(f.file(), contents);
  assert.equal((await f.monitor.refresh()).state, 'idle');
});

test('a readable active session remains visible when another rollout cannot be read', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  candidates = [f.file('a'), f.file('b')];
  f.append('task_started', {}, 'a');
  const snapshot = await f.monitor.refresh();
  assert.equal(snapshot.state, 'working'); assert.equal(snapshot.activeCount, 1);
  f.append('task_complete', {}, 'a');
  assert.equal((await f.monitor.refresh()).state, 'unknown');
});

test('weeks-old orphaned index entries do not veto a readable latest completion or idle state', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  candidates = [
    { file: f.file('deleted-history'), origin: 'index', indexUpdatedAt: f.now() - 20 * 86400000 },
    f.file(),
  ];
  f.append('task_started');
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.advance(200); f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'completed');
  f.advance(61000);
  assert.equal((await f.monitor.refresh()).state, 'idle');
  // A new index update makes this entry relevant again even if still missing.
  candidates[0].indexUpdatedAt = f.now(); f.advance(200);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  // Ignoring an orphan's stale error must not stop following its path.
  f.append('task_started', { turn_id: 'resumed-history' }, 'deleted-history');
  assert.equal((await f.monitor.refresh()).state, 'working');
});

test('missing recent or undated index entries remain uncertain', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  candidates = [{ file: f.file('recent'), origin: 'index', indexUpdatedAt: f.now() - 3600000 }, f.file()];
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  candidates[0].indexUpdatedAt = null; f.advance(200);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
});

test('an observed active session remains uncertain after disappearance even with a stale index timestamp', async t => {
  let candidates = [];
  const f = fixture(t, { discoverPaths: async () => candidates });
  candidates = [{ file: f.file('active'), origin: 'index', indexUpdatedAt: f.now() - 20 * 86400000 }, f.file()];
  f.append('task_started', { turn_id: 'active-turn' }, 'active');
  assert.equal((await f.monitor.refresh()).state, 'working');
  fs.unlinkSync(f.file('active'));
  f.advance(200); f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  f.advance(61000);
  assert.equal((await f.monitor.refresh()).state, 'unknown');
});

test('permission failures are not treated as orphaned history and diagnostics never expose paths', async t => {
  let candidates = [], inaccessible;
  const diagnostics = [];
  const f = fixture(t, {
    discoverPaths: async () => candidates,
    readFs: { ...fs.promises, lstat: async file => {
      if (file === inaccessible) throw Object.assign(new Error('DO-NOT-EXPOSE-PATH-OR-CONTENT'), { code: 'EACCES' });
      return fs.promises.lstat(file);
    } },
    onDiagnostic: item => diagnostics.push(item),
  });
  inaccessible = f.file('restricted');
  candidates = [{ file: inaccessible, origin: 'index', indexUpdatedAt: f.now() - 20 * 86400000 }, f.file()];
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'unknown');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(Object.keys(diagnostics[0]).sort(), ['hash', 'stage', 'code', 'count'].sort());
  assert.match(diagnostics[0].hash, /^[a-f0-9]{12}$/);
  assert.equal(diagnostics[0].stage, 'lstat'); assert.equal(diagnostics[0].code, 'EACCES');
  assert.equal(JSON.stringify(diagnostics).includes(f.directory), false);
  assert.equal(JSON.stringify(diagnostics).includes('DO-NOT-EXPOSE'), false);
});

test('read-only index discovers resumed sessions outside the recent date directories', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const f = fixture(t);
  const oldDirectory = path.join(f.directory, 'sessions', '2026', '01', '01');
  fs.mkdirSync(oldDirectory, { recursive: true });
  const oldFile = path.join(oldDirectory, 'rollout-old.jsonl');
  fs.writeFileSync(oldFile, f.event('task_started'));
  const db = new DatabaseSync(path.join(f.directory, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (rollout_path TEXT, archived INTEGER, updated_at INTEGER, title TEXT)');
  db.prepare('INSERT INTO threads VALUES (?,0,?,?)').run(oldFile, f.now(), 'PRIVATE-TITLE-SENTINEL');
  db.close();
  assert.equal((await f.monitor.refresh()).state, 'working');
  assert.equal(JSON.stringify(f.changes).includes('PRIVATE-TITLE-SENTINEL'), false);
});

test('real SQLite stale-index discovery preserves latest completion without editing the database', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const diagnostics = [];
  const f = fixture(t, { onDiagnostic: item => diagnostics.push(item) });
  f.append('task_complete');
  const databaseFile = path.join(f.directory, 'state_5.sqlite');
  const db = new DatabaseSync(databaseFile);
  db.exec('CREATE TABLE threads (rollout_path TEXT, archived INTEGER, updated_at INTEGER)');
  const insert = db.prepare('INSERT INTO threads VALUES (?,0,?)');
  insert.run(f.file(), Math.floor(f.now() / 1000));
  for (let i = 0; i < 11; i++) insert.run(f.file(`missing-${i}`), Math.floor(f.now() / 1000) - (20 + i) * 86400);
  db.close();
  const before = fs.readFileSync(databaseFile);
  assert.equal((await f.monitor.refresh()).state, 'completed');
  assert.equal(diagnostics.filter(item => item.code === 'ENOENT').length, 11);
  assert.deepEqual(fs.readFileSync(databaseFile), before);
});
