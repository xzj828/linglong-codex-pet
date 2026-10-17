'use strict';

// Read-only local diagnosis. Safe to share: no paths, UUIDs, conversation text,
// tool arguments, credentials, or raw exception messages are printed.
const { createActivityMonitor } = require('../src/main/codex-activity.cjs');

(async () => {
  const diagnostics = [];
  const monitor = createActivityMonitor({ onDiagnostic: event => diagnostics.push(event) });
  try {
    const snapshot = await monitor.refresh();
    const errors = {};
    for (const event of diagnostics) errors[event.code] = (errors[event.code] || 0) + 1;
    console.log(JSON.stringify({ snapshot, errors, diagnostics }, null, 2));
  } finally { monitor.stop(); }
})().catch(() => { console.error('Activity diagnosis could not finish.'); process.exitCode = 1; });
