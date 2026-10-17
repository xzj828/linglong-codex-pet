'use strict';
const fs = require('node:fs');
const path = require('node:path');
const defaults = Object.freeze({ appearance: 'cute', scale: 1, alwaysOnTop: true, autoStart: true, quiet: false, x: null, y: null });
function normalize(input = {}) {
  return {
    appearance: input.appearance === 'mature' ? 'mature' : 'cute',
    scale: Number.isFinite(input.scale) ? Math.max(.65, Math.min(1.5, input.scale)) : 1,
    alwaysOnTop: typeof input.alwaysOnTop === 'boolean' ? input.alwaysOnTop : true,
    autoStart: typeof input.autoStart === 'boolean' ? input.autoStart : true,
    quiet: input.quiet === true,
    x: Number.isFinite(input.x) ? Math.round(input.x) : null,
    y: Number.isFinite(input.y) ? Math.round(input.y) : null
  };
}
function createSettings(directory, { fs: io = fs, onError = () => {} } = {}) {
  const file = path.join(directory, 'settings.json');
  const temporary = file + '.tmp';
  function read(candidate) {
    try {
      const data = JSON.parse(io.readFileSync(candidate, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return normalize(data);
    } catch { return null; }
  }
  // Keep a complete temporary file after a failed copy so an interrupted
  // non-atomic replacement can recover on the next launch.
  const committed = read(file);
  const recovered = committed ? null : read(temporary);
  let restorePending = Boolean(recovered);
  let current = committed || recovered || { ...defaults };
  return {
    get: () => ({ ...current }),
    update: patch => {
      const next = normalize({ ...current, ...patch });
      current = next;
      try {
        io.mkdirSync(directory, { recursive: true });
        // Do not overwrite the only recoverable settings with a new temporary
        // write that might itself fail partway through.
        if (restorePending) {
          io.copyFileSync(temporary, file);
          restorePending = false;
        }
        io.writeFileSync(temporary, JSON.stringify(next, null, 2));
        try {
          io.renameSync(temporary, file);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          // Encrypted/redirected Windows profiles can reject rename even
          // within one directory. Copy without first removing the old file.
          io.copyFileSync(temporary, file);
          try { io.unlinkSync(temporary); } catch { /* The committed file wins on reload. */ }
        }
      } catch (error) {
        restorePending = !read(file) && Boolean(read(temporary));
        // Drag/blur/tray callbacks must never throw into Electron's main
        // event loop just because the settings directory is unavailable.
        try { onError(error); } catch { /* A notification failure is nonfatal too. */ }
      }
      return { ...current };
    }
  };
}
function clampPosition(position, area, size) {
  return { x: Math.round(Math.max(area.x, Math.min(position.x, area.x + area.width - size.width))), y: Math.round(Math.max(area.y, Math.min(position.y, area.y + area.height - size.height))) };
}
module.exports = { defaults, normalize, createSettings, clampPosition };
