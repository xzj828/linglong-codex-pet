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
function createSettings(directory) {
  const file = path.join(directory, 'settings.json');
  let current;
  try { current = normalize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { current = { ...defaults }; }
  return {
    get: () => ({ ...current }),
    update: patch => {
      const next = normalize({ ...current, ...patch });
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2));
      fs.renameSync(file + '.tmp', file);
      current = next;
      return { ...current };
    }
  };
}
function clampPosition(position, area, size) {
  return { x: Math.round(Math.max(area.x, Math.min(position.x, area.x + area.width - size.width))), y: Math.round(Math.max(area.y, Math.min(position.y, area.y + area.height - size.height))) };
}
module.exports = { defaults, normalize, createSettings, clampPosition };
