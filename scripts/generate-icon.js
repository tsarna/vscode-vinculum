#!/usr/bin/env node
// Generates icon.png — a 128×128 PNG with a deep indigo background,
// white overbar, and white V. Pure Node.js, no dependencies.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 128;
const px = new Uint8Array(SIZE * SIZE * 4);

// Fill background: #2d1b69
for (let i = 0; i < SIZE * SIZE; i++) {
  px[i*4]   = 0x2d;
  px[i*4+1] = 0x1b;
  px[i*4+2] = 0x69;
  px[i*4+3] = 255;
}

// Rounded-rect mask: make corners transparent (radius=20)
const R = 20;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inCorner =
      (x < R     && y < R     && Math.hypot(x - R,        y - R)        > R) ||
      (x > 127-R && y < R     && Math.hypot(x - (127-R),  y - R)        > R) ||
      (x < R     && y > 127-R && Math.hypot(x - R,        y - (127-R))  > R) ||
      (x > 127-R && y > 127-R && Math.hypot(x - (127-R),  y - (127-R)) > R);
    if (inCorner) px[(y*SIZE+x)*4+3] = 0;
  }
}

// Draw a thick line (round caps, brute-force distance test)
function line(x1, y1, x2, y2, hw) {
  const dx = x2-x1, dy = y2-y1, len2 = dx*dx + dy*dy;
  const x0 = Math.max(0, Math.floor(Math.min(x1,x2) - hw));
  const x1b = Math.min(SIZE-1, Math.ceil(Math.max(x1,x2) + hw));
  const y0 = Math.max(0, Math.floor(Math.min(y1,y2) - hw));
  const y1b = Math.min(SIZE-1, Math.ceil(Math.max(y1,y2) + hw));
  for (let y = y0; y <= y1b; y++) {
    for (let x = x0; x <= x1b; x++) {
      const t = Math.max(0, Math.min(1, ((x-x1)*dx + (y-y1)*dy) / len2));
      const d = Math.hypot(x - (x1+t*dx), y - (y1+t*dy));
      if (d <= hw) {
        const i = (y*SIZE+x)*4;
        px[i] = px[i+1] = px[i+2] = px[i+3] = 255;
      }
    }
  }
}

line(24, 26, 104, 26, 4);   // overbar (stroke-width 8)
line(24, 44,  64, 100, 5);  // V left arm (stroke-width 10)
line(104, 44, 64, 100, 5);  // V right arm

// ── PNG encoding ──────────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([t, data]);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, t, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE*4);
  row[0] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    const s = (y*SIZE+x)*4;
    row[1+x*4] = px[s]; row[1+x*4+1] = px[s+1];
    row[1+x*4+2] = px[s+2]; row[1+x*4+3] = px[s+3];
  }
  rows.push(row);
}
const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(out, png);
console.log(`Written ${png.length} bytes to icon.png`);
