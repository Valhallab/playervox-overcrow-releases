// The reference captures' pixels, for the tests that measure them.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

/** An 8-bit RGB or RGBA PNG, as RGBA pixels. */
export function png(bytes) {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const depth = bytes[24];
  const color = bytes[25];
  assert.equal(depth, 8, "8-bit");
  const channels = color === 6 ? 4 : color === 2 ? 3 : 0;
  assert.ok(channels > 0, `colour type ${color}`);
  const data = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") data.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value += a <= b && a <= c ? left : b <= c ? up : corner;
      }
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) out[(y * width + x) * 4 + c] = row[x * channels + c];
      out[(y * width + x) * 4 + 3] = channels === 4 ? row[x * 4 + 3] : 255;
    }
    previous = row;
  }
  return { width, height, at: (x, y) => out.subarray((y * width + x) * 4, (y * width + x) * 4 + 3) };
}

/** Whether two pixels differ by more than `by` in a channel. */
export const far = (a, b, by) => Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c]))) > by;
