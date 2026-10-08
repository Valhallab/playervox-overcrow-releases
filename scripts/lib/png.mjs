// A small PNG reader and writer for the repository's scripts and tests:
// 8-bit greyscale, RGB, greyscale with alpha and RGBA, non-interlaced, which
// covers the images the headless runtime writes. No dependency: the
// inflate and deflate of `node:zlib` only.
import { deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The largest side a script decodes, pixels. */
export const MAX_SIDE = 4096;
const channels = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decodes a PNG into straight RGBA8: `{ width, height, pixels }`. Throws on
 * anything else than the formats above, a bad chunk checksum or truncated
 * image data.
 */
export function decodePng(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 8 || !data.subarray(0, 8).equals(signature)) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error("truncated PNG chunk");
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(end - 4)) {
      throw new Error(`bad checksum in the ${type} chunk`);
    }
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colour: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset = end;
  }
  if (!header) throw new Error("PNG without IHDR");
  const { width, height, depth, colour, interlace } = header;
  const count = channels.get(colour);
  if (depth !== 8 || count === undefined || interlace !== 0) {
    throw new Error("unsupported PNG format (8-bit, non-interlaced, no palette only)");
  }
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error("PNG side out of bounds");
  }
  const stride = width * count;
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error("truncated PNG image data");
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= count ? rows[target + x - count] : 0;
      const b = y > 0 ? rows[target - stride + x] : 0;
      const c = x >= count && y > 0 ? rows[target - stride + x - count] : 0;
      const value = raw[source + x];
      let predicted;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = a;
          break;
        case 2:
          predicted = b;
          break;
        case 3:
          predicted = (a + b) >> 1;
          break;
        case 4:
          predicted = paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      rows[target + x] = (value + predicted) & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const from = index * count;
    const to = index * 4;
    if (count >= 3) {
      pixels[to] = rows[from];
      pixels[to + 1] = rows[from + 1];
      pixels[to + 2] = rows[from + 2];
      pixels[to + 3] = count === 4 ? rows[from + 3] : 255;
    } else {
      pixels[to] = pixels[to + 1] = pixels[to + 2] = rows[from];
      pixels[to + 3] = count === 2 ? rows[from + 1] : 255;
    }
  }
  return { width, height, pixels };
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * Encodes straight RGBA8 pixels as an RGB PNG when every pixel is opaque,
 * RGBA otherwise; each row takes the filter with the smallest sum of
 * absolute differences.
 */
export function encodePng({ width, height, pixels }) {
  let opaque = true;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) {
      opaque = false;
      break;
    }
  }
  const count = opaque ? 3 : 4;
  const stride = width * count;
  const rows = Buffer.alloc(stride * height);
  for (let index = 0; index < width * height; index += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      rows[index * count + channel] = pixels[index * 4 + channel];
    }
  }
  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    let best = null;
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const value = rows[y * stride + x];
        const a = x >= count ? rows[y * stride + x - count] : 0;
        const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
        const c = x >= count && y > 0 ? rows[(y - 1) * stride + x - count] : 0;
        const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
        const out = (value - predicted) & 0xff;
        candidate[x] = out;
        score += out < 128 ? out : 256 - out;
      }
      if (score < bestScore) {
        bestScore = score;
        best = Buffer.from(candidate);
        bestFilter = filter;
      }
    }
    filtered[y * (stride + 1)] = bestFilter;
    best.copy(filtered, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
