// Deterministic geometric application icon; character artwork is unchanged.
const fs = require('node:fs');
const path = require('node:path');
const size = 256, pixels = Buffer.alloc(size * size * 4), mask = Buffer.alloc(size * size / 8);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = Math.abs(x - 127.5), dy = Math.abs(y - 127.5);
  const visible = Math.hypot(Math.max(dx - 58, 0), Math.max(dy - 58, 0)) < 66;
  const sparkle = Math.pow(dx / 85, .58) + Math.pow(dy / 85, .58) < 1;
  const t = (x + y) / 510, i = ((255 - y) * size + x) * 4;
  pixels[i] = sparkle ? 252 : Math.round(222 - 55 * t);
  pixels[i + 1] = sparkle ? 250 : Math.round(178 - 76 * t);
  pixels[i + 2] = sparkle ? 255 : Math.round(196 - 66 * t);
  pixels[i + 3] = visible ? 255 : 0;
}
const dib = Buffer.alloc(40); dib.writeUInt32LE(40); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels.length + mask.length, 20);
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(dib.length + pixels.length + mask.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.ico'), Buffer.concat([header, dib, pixels, mask]));
