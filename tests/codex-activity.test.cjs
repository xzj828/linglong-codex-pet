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
  assert.equal(aborted.state, 'interrupted'); assert.equal(aborted.label, '任务已中断'); assert.equal(aborted.action, 'sad');
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

test('explicit terminal failures show sadness without exposing errors and expire after one minute', async t => {
  const f = fixture(t);
  f.append('task_started'); await f.monitor.refresh();
  f.advance(200);
  f.append('task_complete', { error: { message: 'PRIVATE-ERROR-SENTINEL', codex_error_info: 'usage_limit_exceeded' } });
  const failed = await f.monitor.refresh();
  assert.equal(failed.state, 'failed'); assert.equal(failed.action, 'sad');
  assert.equal(failed.activeCount, 0);
  assert.equal(JSON.stringify(f.changes).includes('PRIVATE-ERROR-SENTINEL'), false);
  f.advance(59000);
  assert.equal((await f.monitor.refresh()).state, 'failed');
  f.advance(2000);
  assert.equal((await f.monitor.refresh()).state, 'idle');
  assert.equal(f.monitor.getSnapshot().action, 'idle');
});

test('interruptions expire and a new task immediately clears sad terminal results', async t => {
  const f = fixture(t);
  f.append('task_started'); f.append('turn_aborted', { reason: 'interrupted' });
  assert.equal((await f.monitor.refresh()).state, 'interrupted');
  assert.equal(f.monitor.getSnapshot().action, 'sad');
  f.advance(61000);
  assert.equal((await f.monitor.refresh()).state, 'idle');
  f.append('task_started', { turn_id: 'retry-one' });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete', { turn_id: 'retry-one', error: { message: 'failed' } });
  assert.equal((await f.monitor.refresh()).state, 'failed');
  f.append('task_started', { turn_id: 'retry-two' });
  assert.equal((await f.monitor.refresh()).state, 'working');
  assert.equal(f.monitor.getSnapshot().action, 'busy');
  f.append('turn_aborted', { turn_id: 'retry-two', reason: 'replaced' });
  assert.equal((await f.monitor.refresh()).state, 'interrupted');
  f.append('task_started', { turn_id: 'retry-three' });
  assert.equal((await f.monitor.refresh()).state, 'working');
});

test('legacy turn errors become failed only with a matching completion', async t => {
  const f = fixture(t);
  f.append('task_started');
  f.append('error', { message: 'private', codex_error_info: { response_too_many_failed_attempts: { http_status_code: 503 } } });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('token_count'); f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'failed');
  f.append('task_complete'); f.append('token_count');
  assert.equal((await f.monitor.refresh()).state, 'failed');
});

test('network retries and continued model work clear old errors before a successful completion', async t => {
  const f = fixture(t);
  for (const [index, recovery] of [
    { type: 'stream_error', message: 'retry', codex_error_info: { response_stream_disconnected: { http_status_code: 502 } } },
    { type: 'error', message: 'retry', willRetry: true },
    { type: 'error', message: 'retry', will_retry: true },
    { type: 'item_completed', item: { type: 'Reasoning' } },
    { type: 'item_completed', item: { type: 'AgentMessage' } },
    { type: 'agent_reasoning' },
    { type: 'auth_recovery_completed' },
  ].entries()) {
    const turn_id = `retry-${index}`;
    f.append('task_started', { turn_id });
    f.append('error', { turn_id, message: 'retryable', codex_error_info: { response_stream_disconnected: { http_status_code: 502 } } });
    f.append(recovery.type, { ...recovery, turn_id });
    assert.equal((await f.monitor.refresh()).state, 'working');
    f.append('task_complete', { turn_id });
    assert.equal((await f.monitor.refresh()).state, 'completed');
  }
});

test('a bounded tail beginning at an error still recognizes subsequent model recovery', async t => {
  const f = fixture(t);
  f.append('error', { message: 'old stream failure', codex_error_info: { response_stream_disconnected: { http_status_code: 502 } } });
  f.append('item_completed', { item: { type: 'Reasoning' } });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'completed');
});

test('tool failures, request errors, and unknown error classifications are not task failures', async t => {
  const f = fixture(t);
  f.append('task_started');
  f.append('item_completed', { item: { type: 'CommandExecution', status: 'failed', exit_code: 1 } });
  f.append('patch_apply_end', { success: false, status: 'failed' });
  f.append('error', { message: 'request rejected', codex_error_info: 'thread_rollback_failed' });
  f.append('error', { message: 'request rejected', codex_error_info: { active_turn_not_steerable: { turn_kind: 'review' } } });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'completed');
  f.append('task_started', { turn_id: 'unclassified' });
  f.append('error', { turn_id: 'unclassified', message: 'unknown classification', codex_error_info: 'future_error_kind' });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete', { turn_id: 'unclassified' });
  const unknown = await f.monitor.refresh();
  assert.equal(unknown.state, 'unknown'); assert.equal(unknown.action, 'idle');
});

test('interruptions cannot be overwritten by cleanup completion and old-turn errors cannot poison new work', async t => {
  const f = fixture(t);
  f.append('task_started'); f.append('turn_aborted', { reason: 'interrupted' });
  await f.monitor.refresh();
  f.append('task_complete');
  assert.equal((await f.monitor.refresh()).state, 'interrupted');
  f.append('task_started', { turn_id: 'new-turn' });
  f.append('error', { turn_id: 'turn-one', message: 'old failure', codex_error_info: 'usage_limit_exceeded' });
  f.append('task_complete', { turn_id: 'turn-one', error: { message: 'old failure' } });
  assert.equal((await f.monitor.refresh()).state, 'working');
  f.append('task_complete', { turn_id: 'new-turn' });
  assert.equal((await f.monitor.refresh()).state, 'completed');
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
