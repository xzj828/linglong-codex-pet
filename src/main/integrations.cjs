'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const tls = require('node:tls');
const { execFile, spawn } = require('node:child_process');

const isWindows = process.platform === 'win32';
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
let discoveryCache = null;
let usageCache = null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function powershell(script, timeout = 12000) {
  if (!isWindows) return Promise.reject(new Error('此功能仅支持 Windows。'));
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error(error.killed ? 'Windows 操作超时。' : 'Windows 操作未完成。')) : resolve(stdout.trim()));
  });
}

function parseJSON(text, fallback = null) { try { return JSON.parse(text); } catch { return fallback; } }
function normalizeExecutable(value) {
  if (!value || typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return path.extname(resolved).toLowerCase() === '.exe' && fs.existsSync(resolved) ? resolved : null;
}

async function discoverApps(options = {}) {
  const key = `${options.nanoPath || ''}|${options.codexPath || ''}`;
  if (!options.force && discoveryCache?.key === key && Date.now() - discoveryCache.at < 300000) return discoveryCache.value;
  const value = { nanoPath: normalizeExecutable(options.nanoPath), codexPath: normalizeExecutable(options.codexPath), codexAppId: null, codexCliPath: null };
  if (isWindows) {
    const found = parseJSON(await powershell(`
      $nanoPath=$null; $codexPath=$null; $codexAppId=$null; $codexCliPath=$null;
      $shortcutShell=New-Object -ComObject WScript.Shell;
      $shortcutRoots=@((Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),(Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'));
      foreach($root in $shortcutRoots) {
        Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -match '^(Nano|Codex)$'} | ForEach-Object {
          $target=$shortcutShell.CreateShortcut($_.FullName).TargetPath;
          if($_.BaseName -eq 'Nano' -and (Test-Path -LiteralPath $target)) {$nanoPath=$target};
          if($_.BaseName -eq 'Codex' -and (Test-Path -LiteralPath $target)) {$codexPath=$target};
        }
      }
      $package=Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1;
      if($package) { $manifest=$package | Get-AppxPackageManifest; $application=$manifest.Package.Applications.Application | Where-Object {$_.Id -eq 'App'} | Select-Object -First 1; if($application) {$codexAppId=$package.PackageFamilyName+'!'+$application.Id} }
      $cli=Join-Path $env:USERPROFILE '.codex\\packages\\standalone\\current\\bin\\codex.exe';
      if(Test-Path -LiteralPath $cli) {$codexCliPath=$cli};
      [pscustomobject]@{nanoPath=$nanoPath;codexPath=$codexPath;codexAppId=$codexAppId;codexCliPath=$codexCliPath}|ConvertTo-Json -Compress
    `).catch(() => '{}'), {});
    value.nanoPath ||= normalizeExecutable(found.nanoPath);
    value.codexPath ||= normalizeExecutable(found.codexPath);
    value.codexAppId = found.codexAppId || null;
    value.codexCliPath = normalizeExecutable(found.codexCliPath);
    if (!value.nanoPath) {
      for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs')].filter(Boolean)) {
        value.nanoPath = normalizeExecutable(path.join(root, 'Nano', 'nano.exe'));
        if (value.nanoPath) break;
      }
    }
  }
  value.nanoInstalled = Boolean(value.nanoPath);
  value.codexInstalled = Boolean(value.codexPath || value.codexAppId);
  discoveryCache = { key, at: Date.now(), value };
  return value;
}

function parseProxy(server) {
  if (typeof server !== 'string' || !server.trim()) return null;
  const parts = server.split(';').map((part) => part.trim());
  const entry = parts.find((part) => /^https=/i.test(part)) || parts.find((part) => /^http=/i.test(part)) || parts.find((part) => !part.includes('='));
  if (!entry) return null;
  try {
    const raw = entry.replace(/^https?=/i, '');
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname) || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: hostname === 'localhost' ? '127.0.0.1' : hostname, port };
  } catch { return null; }
}

function probeProxy(proxy, timeout = 4500) {
  // A listening TCP socket is not a successful VPN connection. Require an
  // authenticated TLS handshake to the actual destination through HTTP CONNECT.
  return new Promise((resolve) => {
    let socket; let secure; let done = false; let response = '';
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); secure?.destroy(); socket?.destroy(); resolve(ok); };
    const timer = setTimeout(() => finish(false), timeout);
    socket = net.connect({ host: proxy.host, port: proxy.port });
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write('CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: chatgpt.com:443\r\n\r\n'));
    const onData = (chunk) => {
      response += chunk.toString('latin1');
      if (response.length > 16384) return finish(false);
      const boundary = response.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      socket.removeListener('data', onData);
      if (!/^HTTP\/1\.[01] 200\b/.test(response)) return finish(false);
      secure = tls.connect({ socket, servername: 'chatgpt.com', rejectUnauthorized: true }, () => finish(secure.authorized));
      secure.once('error', () => finish(false));
    };
    socket.on('data', onData);
  });
}

async function getConnectionStatus(options = {}) {
  const apps = await discoverApps(options);
  const base = { nanoInstalled: apps.nanoInstalled, codexInstalled: apps.codexInstalled, nanoRunning: false, proxyEnabled: false, proxyOwnedByNano: false, connected: false, reachable: null, checkedAt: new Date().toISOString() };
  if (!isWindows) return { ...base, message: '连接检测仅支持 Windows。' };
  const state = parseJSON(await powershell(`
    $processes=@(Get-Process -Name nano -ErrorAction SilentlyContinue);
    $proxy=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue;
    $listeners=@(); if($processes.Count -gt 0) {$pids=@($processes.Id); $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$pids -contains $_.OwningProcess} | ForEach-Object {$_.LocalPort})};
    [pscustomobject]@{running=($processes.Count -gt 0);proxyEnabled=($proxy.ProxyEnable -eq 1);proxyServer=$proxy.ProxyServer;ports=$listeners}|ConvertTo-Json -Compress
  `, 9000).catch(() => '{}'), {});
  const proxy = parseProxy(state.proxyServer);
  const owned = Boolean(proxy && Array.isArray(state.ports) && state.ports.includes(proxy.port));
  const localReady = Boolean(state.running && state.proxyEnabled && owned);
  const reachable = localReady && options.checkNetwork !== false ? await probeProxy(proxy, options.networkTimeout || 4500) : null;
  return {
    ...base, nanoRunning: Boolean(state.running), proxyEnabled: Boolean(state.proxyEnabled), proxyOwnedByNano: owned,
    connected: localReady && reachable === true, localProxyReady: localReady, reachable,
    message: reachable === true ? 'Nano 代理已连接，ChatGPT 安全连接可达。' : localReady ? (reachable === false ? 'Nano 代理已开启，但外网连接检测未通过。' : 'Nano 代理已开启，尚未验证外网连接。') : state.running ? 'Nano 已运行，尚未检测到它的系统代理连接。' : 'Nano 尚未运行。',
  };
}

async function launchExecutable(executable) {
  if (!normalizeExecutable(executable)) throw new Error('找不到有效的应用程序路径。');
  // ShellExecute supports Nano's requireAdministrator manifest. Windows may
  // show its own UAC consent prompt; this application never bypasses it.
  await powershell(`Start-Process -FilePath ${psQuote(executable)} -WorkingDirectory ${psQuote(path.dirname(executable))} -WindowStyle Hidden`, 15000);
}

async function invokeNanoConnect() {
  // No guessed coordinates and no toggle hotkeys: invoke only a visible,
  // explicitly named Connect control. Never invoke Disconnect/Reconnect.
  const result = await powershell(`
    Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes;
    $invoked=$false;
    foreach($nano in @(Get-Process -Name nano -ErrorAction SilentlyContinue)) {
      $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$nano.Id);
      $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition);
      foreach($window in $windows) {
        $controls=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);
        foreach($control in $controls) {
          if($control.Current.IsEnabled -and !$control.Current.IsOffscreen -and $control.Current.Name -cmatch '^(连接|点击连接|点按连接|Connect|Tap To Connect)$') {
            $pattern=$null; if($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {$pattern.Invoke();$invoked=$true;break}
          }
        }
        if($invoked) {break}
      }
      if($invoked) {break}
    }
    [pscustomobject]@{invoked=$invoked}|ConvertTo-Json -Compress
  `, 7000).catch(() => '{"invoked":false}');
  return Boolean(parseJSON(result, {}).invoked);
}

function getNanoHelperPath() {
  // electron-builder unpacks the script so Windows PowerShell can open it.
  return path.join(__dirname, 'nano-connect.ps1').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

async function invokeNanoNativeConnect(nanoPath, launchIfMissing = false) {
  const helper = getNanoHelperPath();
  if (!fs.existsSync(helper) || path.basename(nanoPath).toLowerCase() !== 'nano.exe') return false;
  // Start-Process receives an argv list containing quoted, validated Windows
  // paths. -Verb RunAs is the standard UAC consent flow, not a bypass.
  const result = await powershell(`
    $helper=${psQuote(helper)}; $nano=${psQuote(nanoPath)};
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$helper+'"'),'-NanoPath',('"'+$nano+'"'),'-DeadlineEpochMs','${Date.now() + 40000}');
    ${launchIfMissing ? "$arguments += '-LaunchIfMissing';" : ''}
    try {$process=Start-Process -FilePath ${psQuote(POWERSHELL)} -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru -Wait; [pscustomobject]@{code=$process.ExitCode}|ConvertTo-Json -Compress} catch {'{"code":21}'}
  `, 45000).catch(() => '{"code":21}');
  const code = parseJSON(result, {}).code;
  return code === 0 || code === 10;
}

async function connectNano(options = {}) {
  const apps = await discoverApps(options);
  if (!apps.nanoPath) return { connected: false, needsInteraction: true, message: '没有找到 Nano。请在设置里选择 nano.exe。' };
  let status = await getConnectionStatus(options);
  if (status.connected) return { ...status, alreadyConnected: true, message: 'Nano 已连接，保留当前默认节点。' };
  const progress = (message) => { try { options.onProgress?.(message); } catch {} };
  let nativeAttempted = false;
  let connectRequested = false;
  if (!status.nanoRunning) {
    if (options.allowUac !== false) {
      progress('正在启动 Nano；Windows 若弹出管理员确认，请选择“是”。');
      nativeAttempted = true;
      connectRequested = await invokeNanoNativeConnect(apps.nanoPath, true);
    } else {
      try { await launchExecutable(apps.nanoPath); } catch { return { ...status, needsInteraction: true, message: 'Nano 启动未完成。请允许 Windows 的管理员确认，或手动打开 Nano。' }; }
    }
    for (let i = 0; i < 3; i++) {
      await wait(1000);
      status = await getConnectionStatus(options);
      if (status.connected) return { ...status, message: 'Nano 已使用当前节点连接。' };
      if (status.nanoRunning) break;
    }
  }
  if (!connectRequested) connectRequested = await invokeNanoConnect();
  if (!connectRequested && !nativeAttempted && options.allowUac !== false) {
    progress('准备连接 Nano；Windows 若弹出管理员确认，请选择“是”。');
    connectRequested = await invokeNanoNativeConnect(apps.nanoPath);
  }
  if (connectRequested) {
    progress('正在确认 Nano 网络连接，随后自动打开 Codex。');
    for (let i = 0; i < 3; i++) {
      await wait(1200);
      status = await getConnectionStatus(options);
      if (status.connected) return { ...status, message: 'Nano 已使用当前节点连接。' };
    }
  }
  // Some Nano Flutter versions expose no accessibility controls. Bring the
  // existing window forward instead of blindly clicking a connection toggle.
  await powershell(`$shell=New-Object -ComObject WScript.Shell; $null=$shell.AppActivate('Nano')`, 3000).catch(() => {});
  progress('请在 Nano 首页点击“连接”。ChatGPT将在 30 秒内自动接着打开 Codex。');
  // A manual connection can finish the same click. The main process may also
  // use needsInteraction to keep its own progress UI visible during this wait.
  const pendingDeadline = Date.now() + (options.manualConnectTimeout ?? 30000);
  while (Date.now() < pendingDeadline) {
    await wait(1500);
    status = await getConnectionStatus(options);
    if (status.connected) return { ...status, message: 'Nano 连接已确认，将继续打开 Codex。' };
  }
  return { ...status, connected: false, needsInteraction: true, message: '尚未确认 Nano 连接。请在 Nano 点击“连接”，或允许 Windows 管理员确认后重试；默认节点保持不变。' };
}

async function openCodex(options = {}) {
  const apps = await discoverApps(options);
  try {
    if (apps.codexPath && (options.codexPath || !apps.codexAppId)) await launchExecutable(apps.codexPath);
    else if (apps.codexAppId) await powershell(`Start-Process -FilePath 'explorer.exe' -ArgumentList ${psQuote(`shell:AppsFolder\\${apps.codexAppId}`)} -WindowStyle Hidden`, 6000);
    else return { opened: false, message: '未找到 Codex 桌面应用，请在设置里选择桌面版程序。' };
    return { opened: true, message: '已打开 Codex 桌面应用。' };
  } catch { return { opened: false, message: 'Codex 启动失败，请检查设置中的程序路径。' }; }
}

function normalizeWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const used = value.used_percent ?? value.usedPercent;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) return null;
  const resets = value.resets_at ?? value.resetsAt;
  const resetMs = typeof resets === 'number' ? resets * 1000 : Date.parse(resets);
  return { usedPercent: used, remainingPercent: Math.max(0, 100 - used), windowMinutes: value.window_minutes ?? value.windowDurationMins ?? null, resetsAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null };
}

function normalizeUsage(limits, observedAt, source, now = Date.now()) {
  const primary = normalizeWindow(limits?.primary);
  const secondary = normalizeWindow(limits?.secondary);
  const observedMs = Date.parse(observedAt);
  const stale = !Number.isFinite(observedMs) || now - observedMs > 15 * 60000 || [primary, secondary].some((window) => window?.resetsAt && Date.parse(window.resetsAt) <= now);
  return { available: Boolean(primary || secondary), primary, secondary, observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null, source, stale,
    message: !primary && !secondary ? '暂无可读取的 Codex 配额数据。' : stale ? '这是较早的配额快照；请以 Codex 当前显示为准。' : source === 'app-server' ? '来自 Codex 官方账户配额接口。' : '来自本机 Codex 最近会话中的配额快照。' };
}

function getLiveUsage(executable, timeout = 8000) {
  return new Promise((resolve) => {
    let finished = false; let buffer = ''; let initialized = false;
    const child = spawn(executable, ['app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (value) => { if (finished) return; finished = true; clearTimeout(timer); child.stdin.destroy(); child.kill(); resolve(value); };
    const timer = setTimeout(() => finish(null), timeout);
    child.once('error', () => finish(null));
    child.once('exit', () => finish(null));
    child.stdin.on('error', () => finish(null));
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 1024 * 1024) return finish(null);
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = parseJSON(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message?.id === 1 && message.result && !initialized) {
          initialized = true; send({ method: 'initialized', params: {} }); send({ id: 2, method: 'account/rateLimits/read', params: {} });
        }
        if (message?.id === 1 && message.error) return finish(null);
        if (message?.id === 2) {
          const limits = message.result?.rateLimitsByLimitId?.codex || message.result?.rateLimits;
          return finish(limits ? normalizeUsage(limits, new Date().toISOString(), 'app-server') : null);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'linglong-desktop-pet', version: require('../../package.json').version }, capabilities: {} } });
  });
}

async function listRecentSessions(directory, limit = 12) {
  // Session folders use YYYY/MM/DD. Descend in date order, never scan the
  // contents of the entire Codex home or inspect authentication files.
  const result = [];
  async function descend(folder, depth) {
    let entries; try { entries = await fsp.readdir(folder, { withFileTypes: true }); } catch { return; }
    if (depth < 3) {
      for (const entry of entries.filter((item) => item.isDirectory() && /^\d{2,4}$/.test(item.name)).sort((a, b) => b.name.localeCompare(a.name))) {
        await descend(path.join(folder, entry.name), depth + 1); if (result.length >= limit) return;
      }
    } else {
      const files = await Promise.all(entries.filter((entry) => entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)).map(async (entry) => {
        const file = path.join(folder, entry.name); const stat = await fsp.stat(file).catch(() => null); return stat ? { file, mtime: stat.mtimeMs } : null;
      }));
      result.push(...files.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, limit - result.length));
    }
  }
  await descend(directory, 0); return result.map((item) => item.file);
}

async function readRateLimitTail(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r'); const stat = await handle.stat();
    const length = Math.min(stat.size, 1024 * 1024); const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      const event = parseJSON(lines[i]);
      if (event?.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.rate_limits && Number.isFinite(Date.parse(event.timestamp))) {
        const limits = event.payload.rate_limits;
        if (limits.limit_id && limits.limit_id !== 'codex') continue;
        return normalizeUsage(limits, event.timestamp, 'local-session');
      }
    }
  } catch {} finally { await handle?.close().catch(() => {}); }
  return null;
}

async function getUsage(options = {}) {
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const cacheKey = `${codexHome}|${options.liveUsage !== false}`;
  if (!options.force && usageCache?.key === cacheKey && Date.now() - usageCache.at < 30000) return usageCache.value;
  let value = null;
  if (options.liveUsage !== false && isWindows) {
    const apps = await discoverApps(options);
    if (apps.codexCliPath) value = await getLiveUsage(apps.codexCliPath, options.usageTimeout || 8000);
  }
  if (!value?.available) {
    const files = await listRecentSessions(path.join(codexHome, 'sessions'));
    const snapshots = (await Promise.all(files.map(readRateLimitTail))).filter((snapshot) => snapshot?.available);
    value = snapshots.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] || normalizeUsage(null, null, 'unavailable');
  }
  usageCache = { key: cacheKey, at: Date.now(), value };
  return value;
}

module.exports = { discoverApps, connectNano, openCodex, getConnectionStatus, getUsage,
  _test: { parseProxy, normalizeWindow, normalizeUsage, readRateLimitTail, listRecentSessions, psQuote, probeProxy, getNanoHelperPath } };
