'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _test } = require('../src/main/integrations.cjs');

test('Windows proxy formats select HTTPS and only permit local unauthenticated HTTP proxies', () => {
  assert.deepEqual(_test.parseProxy('http://127.0.0.1:65532'), { host: '127.0.0.1', port: 65532 });
  assert.deepEqual(_test.parseProxy('http=127.0.0.1:8080;https=localhost:9090'), { host: '127.0.0.1', port: 9090 });
  assert.deepEqual(_test.parseProxy('[::1]:8888'), { host: '::1', port: 8888 });
  for (const value of ['socks=127.0.0.1:1080', 'http://user:password@127.0.0.1:80', 'proxy.example.com:80', '127.0.0.1:99999', 'garbage', null]) assert.equal(_test.parseProxy(value), null);
});

test('quota normalization handles official camelCase and session snake_case without inventing missing windows', () => {
  const reset = Date.parse('2030-01-01T00:00:00Z') / 1000;
  const value = _test.normalizeUsage({ primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: reset }, secondary: null }, '2029-12-31T23:59:00Z', 'app-server', Date.parse('2029-12-31T23:59:10Z'));
  assert.equal(value.primary.remainingPercent, 73);
  assert.equal(value.primary.windowMinutes, 10080);
  assert.equal(value.secondary, null);
  assert.equal(value.stale, false);
  assert.equal(_test.normalizeWindow({ used_percent: 110 }), null);
  assert.equal(_test.normalizeWindow({ used_percent: '10' }), null);
  assert.equal(_test.normalizeUsage({}, null, 'unavailable').available, false);
});

test('quota snapshots are stale after expiry even when observed recently', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  const value = _test.normalizeUsage({ primary: { used_percent: 92, resets_at: now / 1000 - 1 } }, new Date(now - 2000).toISOString(), 'local-session', now);
  assert.equal(value.stale, true);
  assert.equal(value.primary.remainingPercent, 8);
});

test('session reader ignores arbitrary message text, malformed tails, and other limit IDs', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linglong-quota-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, '2030', '01', '01'); await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'rollout-test.jsonl');
  const event = (stamp, used, id = 'codex') => JSON.stringify({ timestamp: stamp, type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: id, primary: { used_percent: used, window_minutes: 300, resets_at: 2000000000 } } } });
  await fs.writeFile(file, [event('2029-12-31T23:57:00Z', 20), event('2029-12-31T23:59:00Z', 30), event('2030-01-01T00:00:00Z', 90, 'other-product'), '{"rate_limits":'].join('\n'));
  const value = await _test.readRateLimitTail(file);
  assert.equal(value.primary.remainingPercent, 70);
  assert.equal(value.observedAt, '2029-12-31T23:59:00.000Z');
  assert.deepEqual(await _test.listRecentSessions(dir), [file]);
  assert.equal(await _test.readRateLimitTail(path.join(dir, 'missing')), null);
});

test('an open proxy port or a fake CONNECT response does not count as a secure connection', async (t) => {
  const server = net.createServer((socket) => { socket.on('error', () => {}); socket.on('data', () => socket.end('HTTP/1.1 200 Connection established\r\n\r\n')); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(await _test.probeProxy({ host: '127.0.0.1', port: server.address().port }, 500), false);
});

test('PowerShell literal quoting cannot inject a command', () => {
  assert.equal(_test.psQuote("C:\\x'; Remove-Item x; '"), "'C:\\x''; Remove-Item x; '''");
});

test('Windows helper preserves Chinese in PowerShell 5 and rejects expired requests before launch', { skip: process.platform !== 'win32' }, async () => {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helper = _test.getNanoHelperPath();
  const bytes = await fs.readFile(helper);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const script = `$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${_test.psQuote(helper)},[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){exit 1};if(-not $ast.Extent.Text.Contains([string][char]0x8fde+[char]0x63a5)){exit 2};'ok'`;
  const parsed = await promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 });
  assert.equal(parsed.stdout.trim(), 'ok');
  await assert.rejects(promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-NanoPath', 'C:\\not-installed\\nano.exe', '-DeadlineEpochMs', '1'], { windowsHide: true, timeout: 10000 }), (error) => error.code === 24);
});
