'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const MAX_FILES = 32;
const INITIAL_TAIL_BYTES = 128 * 1024;
const READ_BYTES = 256 * 1024;
const REFRESH_BYTES = MAX_FILES * INITIAL_TAIL_BYTES;
const MAX_LINE_BYTES = 256 * 1024;
let sqliteConstructor;

function within(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function probeCodexProcess() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
    execFile(executable, ['/FI', 'IMAGENAME eq codex.exe', '/NH', '/FO', 'CSV'], {
      windowsHide: true, timeout: 3500, maxBuffer: 64 * 1024, encoding: 'utf8',
    }, (error, stdout) => resolve(error ? null : /^"codex\.exe",/im.test(stdout)));
  });
}

// Read only file locations from Codex's index. No titles, messages, credentials,
// model output, or tool arguments leave this module. Older clients and Electron
// builds without node:sqlite fall back to a small set of dated directories.
function indexedPaths(codexHome) {
  const databasePath = path.join(codexHome, 'state_5.sqlite');
  if (!fs.existsSync(databasePath)) return [];
  let database;
  try {
    if (sqliteConstructor === undefined) {
      try { sqliteConstructor = require('node:sqlite').DatabaseSync; } catch { sqliteConstructor = null; }
    }
    if (!sqliteConstructor) return [];
    database = new sqliteConstructor(databasePath, { readOnly: true, timeout: 100 });
    return database.prepare('SELECT rollout_path FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?')
      .all(MAX_FILES).map(row => row.rollout_path).filter(value => typeof value === 'string');
  } catch { return []; }
  finally { try { database?.close(); } catch {} }
}

async function discoverRecentPaths(codexHome, now) {
  const sessionRoot = path.join(codexHome, 'sessions');
  const candidates = indexedPaths(codexHome);
  // UTC and local date boundaries are both covered by three calendar days.
  // Deliberately never recurse through historical conversation archives.
  for (let daysAgo = 0; daysAgo < 3; daysAgo++) {
    const date = new Date(now - daysAgo * 86400000);
    const directory = path.join(sessionRoot, String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'));
    try {
      const handle = await fs.promises.opendir(directory);
      const names = [];
      let seen = 0;
      for await (const entry of handle) {
        if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) names.push(entry.name);
        if (++seen >= 1024) break;
      }
      names.sort().reverse();
      candidates.push(...names.slice(0, MAX_FILES).map(name => path.join(directory, name)));
    } catch { /* A day with no sessions is normal. */ }
  }
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))]
    .filter(candidate => within(sessionRoot, candidate) && path.extname(candidate) === '.jsonl')
    .slice(0, MAX_FILES);
}

function createActivityMonitor(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const sessionRoot = path.join(codexHome, 'sessions');
  const now = options.now || Date.now;
  const processProbe = options.processProbe || probeCodexProcess;
  const intervalMs = Math.max(100, options.intervalMs ?? 2000);
  const staleMs = Math.max(1000, options.staleMs ?? 10 * 60 * 1000);
  const completionMs = Math.max(1000, options.completionMs ?? 60000);
  const discoverMs = Math.max(100, options.discoverMs ?? 10000);
  const processProbeMs = Math.max(100, options.processProbeMs ?? 8000);
  const records = new Map();
  let lastDiscovery = -Infinity;
  let lastProbe = -Infinity;
  let processRunning = null;
  let timer = null;
  let pending = null;
  let generation = 0;
  let snapshot = { state: 'unknown', label: '等待 Codex 状态', message: '正在读取本机 Codex 工作状态。', action: 'idle', observedAt: null, activeCount: 0, source: 'unavailable' };

  function emit(next, version) {
    if (version !== generation) return snapshot;
    const changed = JSON.stringify(snapshot) !== JSON.stringify(next);
    snapshot = next;
    if (changed) { try { options.onChange?.({ ...next }); } catch {} }
    return { ...snapshot };
  }

  function consume(record, line, time) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type !== 'event_msg' || !event.payload || typeof event.payload !== 'object') return;
    const type = event.payload.type;
    if (!['task_started', 'task_complete', 'turn_aborted', 'item_completed', 'token_count', 'agent_reasoning'].includes(type)) return;
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > time + 60000) return;
    // A resumed/forked file can contain copied history. Ignore out-of-order
    // older events, and never resurrect a completed turn with token accounting.
    if (timestamp < record.eventAt) return;
    const turn = typeof event.payload.turn_id === 'string' ? event.payload.turn_id.slice(0, 160) : null;
    if (type === 'task_started') {
      record.state = 'working'; record.turn = turn; record.eventAt = timestamp;
    } else if (type === 'task_complete' || type === 'turn_aborted') {
      if (record.state === 'working' && turn && record.turn && turn !== record.turn) return;
      record.state = type === 'task_complete' ? 'completed' : 'aborted';
      record.turn = turn || record.turn; record.eventAt = timestamp;
    } else if (record.state === 'working') {
      if (turn && record.turn && turn !== record.turn) return;
      record.eventAt = timestamp;
    } else if (record.state === 'unknown' && ['item_completed', 'agent_reasoning'].includes(type)) {
      // Initial bounded tails may omit task_started. A fresh completed item is
      // evidence of activity; it is not evidence that the entire turn finished.
      record.state = 'working'; record.turn = turn; record.eventAt = timestamp;
    }
  }

  async function readRecord(file, record, time, budget) {
    let handle;
    try {
      const stat = await fs.promises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { record.readable = false; return 0; }
      const replacement = record.identity !== null && record.identity !== `${stat.dev}:${stat.ino}`;
      if (replacement || stat.size < record.offset) {
        record.offset = 0; record.carry = Buffer.alloc(0); record.skipLine = false;
        record.initialized = false; record.state = 'unknown'; record.eventAt = 0; record.turn = null;
      }
      record.identity = `${stat.dev}:${stat.ino}`;
      if (!record.initialized) {
        record.offset = Math.max(0, stat.size - INITIAL_TAIL_BYTES);
        record.skipLine = record.offset > 0;
        record.initialized = true;
      }
      const length = Math.min(READ_BYTES, budget, stat.size - record.offset);
      if (length <= 0 && record.readable) return 0;
      const realFile = await fs.promises.realpath(file);
      const realRoot = await fs.promises.realpath(sessionRoot);
      if (!within(realRoot, realFile)) { record.readable = false; return 0; }
      handle = await fs.promises.open(file, 'r');
      // Recheck a previously unreadable, unchanged file without rereading its
      // history. A successful open restores confidence in its last metadata.
      if (length <= 0) { record.readable = true; return 0; }
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, record.offset);
      record.offset += bytesRead;
      const content = Buffer.concat([record.carry, buffer.subarray(0, bytesRead)]);
      record.carry = Buffer.alloc(0);
      let start = 0;
      for (;;) {
        const end = content.indexOf(10, start);
        if (end === -1) break;
        if (!record.skipLine && end - start <= MAX_LINE_BYTES) consume(record, content.subarray(start, end).toString('utf8'), time);
        record.skipLine = false;
        start = end + 1;
      }
      if (content.length - start > MAX_LINE_BYTES) record.skipLine = true;
      else if (!record.skipLine) record.carry = Buffer.from(content.subarray(start));
      record.readable = true;
      return bytesRead;
    } catch { record.readable = false; return 0; }
    finally { try { await handle?.close(); } catch {} }
  }

  function summarize(time) {
    const ordered = [...records.values()].filter(record => record.eventAt).sort((a, b) => b.eventAt - a.eventAt);
    const latest = ordered[0];
    const base = { observedAt: latest ? new Date(latest.eventAt).toISOString() : null, activeCount: 0, source: latest ? 'codex-session-events' : 'process' };
    if (processRunning === false) return { ...base, state: 'offline', label: 'Codex 未运行', message: '点击我即可连接 Nano 并打开 Codex。', action: 'idle', source: 'process' };
    const active = ordered.filter(record => record.state === 'working' && time - record.eventAt <= staleMs && record.readable);
    if (active.length) return {
      ...base, state: 'working', label: 'Codex 正在工作',
      message: active.length > 1 ? `Codex 正在处理 ${active.length} 个会话，我会跟随工作进度。` : 'Codex 正在工作，我陪你一起等。',
      action: 'busy', activeCount: active.length, observedAt: new Date(active[0].eventAt).toISOString(),
    };
    if ([...records.values()].some(record => !record.readable)) return {
      ...base, state: 'unknown', label: '工作状态待确认',
      message: '暂时无法读取部分会话的工作事件，无法确认最新状态；稍后会自动重试。',
      action: 'idle', source: 'unavailable',
    };
    if (latest?.state === 'completed' && time - latest.eventAt <= completionMs) return { ...base, state: 'completed', label: 'Codex 已完成', message: '最近一轮任务已完成，可以回到 Codex 查看结果。', action: 'success' };
    if (latest?.state === 'aborted' && time - latest.eventAt <= completionMs) return { ...base, state: 'idle', label: '任务已停止', message: '最近一轮任务已停止，等待你的下一步。', action: 'idle' };
    if (latest?.state === 'working') return { ...base, state: 'unknown', label: '工作状态待确认', message: '较久没有新工作事件，暂时无法确认任务是否仍在运行。', action: 'idle' };
    if (processRunning === true && latest) return { ...base, state: 'idle', label: 'Codex 已就绪', message: '暂无正在进行的任务，随时可以开始。', action: 'idle' };
    return { ...base, state: 'unknown', label: '等待 Codex 状态', message: processRunning === true ? 'Codex 已打开，尚未发现可读取的工作事件。' : '暂时无法确认 Codex 状态，等待本机工作事件。', action: 'idle', source: 'unavailable' };
  }

  async function update(version) {
    const time = now();
    try {
      if (time - lastProbe >= processProbeMs) {
        try { const value = await processProbe(); processRunning = typeof value === 'boolean' ? value : null; }
        catch { processRunning = null; }
        lastProbe = time;
      }
      if (time - lastDiscovery >= discoverMs) {
        const files = await (options.discoverPaths ? options.discoverPaths() : discoverRecentPaths(codexHome, time));
        const allowed = [...new Set(files.filter(file => typeof file === 'string').map(file => path.resolve(file)))]
          .filter(file => within(sessionRoot, file) && path.extname(file) === '.jsonl').slice(0, MAX_FILES);
        for (const file of allowed) if (!records.has(file)) records.set(file, {
          offset: 0, initialized: false, carry: Buffer.alloc(0), skipLine: false,
          state: 'unknown', turn: null, eventAt: 0, readable: false, identity: null,
        });
        // Keep following resumed old files while their turn is fresh, even if
        // a burst of newly created sessions pushes them out of the index slice.
        for (const [file, record] of records) if (!allowed.includes(file) && (record.state !== 'working' || time - record.eventAt > staleMs)) records.delete(file);
        while (records.size > MAX_FILES) {
          const oldest = [...records].sort((a, b) => a[1].eventAt - b[1].eventAt)[0];
          records.delete(oldest[0]);
        }
        lastDiscovery = time;
      }
      let budget = REFRESH_BYTES;
      for (const [file, record] of records) {
        if (budget <= 0) break;
        budget -= await readRecord(file, record, time, budget);
      }
      return emit(summarize(time), version);
    } catch {
      return emit({ state: 'unknown', label: '工作状态待确认', message: '暂时无法读取本机工作事件，稍后会自动重试。', action: 'idle', observedAt: snapshot.observedAt, activeCount: 0, source: 'unavailable' }, version);
    }
  }

  function refresh() {
    if (!pending) pending = update(generation).finally(() => { pending = null; });
    return pending;
  }

  return {
    start() { if (!timer) { void refresh(); timer = setInterval(() => { void refresh(); }, intervalMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; generation++; },
    getSnapshot() { return { ...snapshot }; },
    refresh,
  };
}

module.exports = { createActivityMonitor };
