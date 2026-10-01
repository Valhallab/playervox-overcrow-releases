// Draws the synthetic emotes of the scenarios (no real Twitch emote in this
// repository): `node tests/assets/generate.mjs` writes them next to this
// script. RGBA PNGs with a transparent background, deterministic, without
// dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG of `width` × `height` whose pixel (x, y) is `paint(x, y)` → [r, g, b, a]. */
function png(width, height, paint) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      rows.set(paint(x, y), row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CLEAR = [0, 0, 0, 0];

const emotes = {
  // A yellow face with two eyes and a smile, 56 × 56: a square emote at
  // the 2.0 density.
  "smile.png": png(56, 56, (x, y) => {
    const d = Math.hypot(x - 27.5, y - 27.5);
    if (d > 26) {
      return CLEAR;
    }
    const eye = Math.hypot(Math.abs(x - 27.5) - 9, y - 21) < 3.5;
    const mouth = Math.abs(d - 15) < 2 && y > 32;
    return eye || mouth ? [60, 40, 10, 255] : [250, 200, 60, 255];
  }),
  // A violet diamond, 28 × 28: a square emote at the 1.0 density.
  "gem.png": png(28, 28, (x, y) => {
    const d = Math.abs(x - 13.5) + Math.abs(y - 13.5);
    if (d > 13) {
      return CLEAR;
    }
    return d < 6 ? [220, 190, 255, 255] : [140, 80, 220, 255];
  }),
  // Green and white stripes, 84 × 28: an emote three times as wide as tall.
  "wide.png": png(84, 28, (x, y) => {
    if (y < 3 || y > 24) {
      return CLEAR;
    }
    return Math.floor(x / 12) % 2 === 0 ? [40, 170, 110, 255] : [235, 245, 240, 255];
  }),
};

for (const [name, bytes] of Object.entries(emotes)) {
  writeFileSync(new URL(name, import.meta.url), bytes);
}
