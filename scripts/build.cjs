'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Keep extracted tools on the same, project-owned filesystem. Some Windows
// profiles encrypt LocalAppData and cause EXDEV during the cache rename.
const env = { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.join(__dirname, '..', 'output', 'build-cache'), CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', ...(process.argv.includes('--dir') ? ['--dir'] : ['nsis'])], { env, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
