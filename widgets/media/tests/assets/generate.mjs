// Draws the synthetic covers of the scenarios (no real album art in this
// repository): `node tests/assets/generate.mjs` writes them next to this
// script. Plain RGB PNGs, deterministic, without dependencies.
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

/** A PNG of `width` × `height` whose pixel (x, y) is `paint(x, y)` → [r, g, b]. */
function png(width, height, paint) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      rows.set([r, g, b], row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((value, index) => Math.round(value + (b[index] - value) * t));

const covers = {
  // A teal to violet diagonal with a pale disc: the playing track.
  "aurora.png": png(128, 128, (x, y) => {
    const base = mix([20, 150, 140], [110, 60, 170], (x + y) / 254);
    const d = Math.hypot(x - 80, y - 48);
    return d < 26 ? mix(base, [240, 230, 190], 0.8) : base;
  }),
  // Orange and navy halves, wider than tall: the cover is cropped to its centre.
  "horizon.png": png(192, 96, (x, y) => {
    const band = Math.floor(x / 48) % 2 === 0 ? [235, 120, 40] : [30, 40, 90];
    return y > 64 ? mix(band, [250, 250, 250], 0.5) : band;
  }),
  // Green checks: the next track.
  "tiles.png": png(96, 96, (x, y) =>
    (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? [60, 170, 80] : [230, 240, 200],
  ),
};

for (const [name, bytes] of Object.entries(covers)) {
  writeFileSync(new URL(name, import.meta.url), bytes);
}
