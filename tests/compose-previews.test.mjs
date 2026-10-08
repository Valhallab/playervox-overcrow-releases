// The PNG reader and writer of the scripts, and the composition of a
// marketplace preview: the stage it picks, the frame it draws, what it
// refuses.
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import test from "node:test";
import {
  DENSITY,
  STAGES,
  STAGE_COLOUR,
  STAGE_MARGIN,
  composePreview,
  frameTokens,
} from "../scripts/compose-previews.mjs";
import { decodePng, encodePng } from "../scripts/lib/png.mjs";

const tokens = frameTokens();

function image(width, height, paint) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, pixels };
}

const at = ({ width, pixels }, x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const stage = [0, 2, 4].map((offset) => Number.parseInt(STAGE_COLOUR.slice(1 + offset, 3 + offset), 16));

test("an opaque image survives encoding as RGB, every filter included", () => {
  const source = image(37, 23, (x, y) => [(x * 7) & 255, (y * 11) & 255, (x * y) & 255, 255]);
  const bytes = encodePng(source);
  assert.equal(bytes[25], 2, "colour type RGB");
  const decoded = decodePng(bytes);
  assert.equal(decoded.width, 37);
  assert.equal(decoded.height, 23);
  assert.deepEqual(Buffer.from(decoded.pixels), Buffer.from(source.pixels));
});

test("an image with transparency stays RGBA", () => {
  const source = image(5, 4, (x, y) => [x * 40, y * 50, 90, x === 0 ? 0 : 200]);
  const bytes = encodePng(source);
  assert.equal(bytes[25], 6, "colour type RGBA");
  assert.deepEqual(Buffer.from(decodePng(bytes).pixels), Buffer.from(source.pixels));
});

test("the reader refuses what it does not support", () => {
  assert.throws(() => decodePng(Buffer.from("not a png")), /not a PNG/);
  const bytes = Buffer.from(encodePng(image(2, 2, () => [1, 2, 3, 255])));
  const corrupted = Buffer.from(bytes);
  corrupted[30] ^= 0xff;
  assert.throws(() => decodePng(corrupted), /checksum/);
  // A 16-bit image: the same IHDR with depth 16 and its checksum.
  const sixteen = Buffer.from(bytes);
  sixteen[24] = 16;
  sixteen.writeUInt32BE(crc32(sixteen.subarray(12, 29)), 29);
  assert.throws(() => decodePng(sixteen), /unsupported/);
});

test("a small widget takes the small stage, centred at its real size", () => {
  const content = image(90, 60, () => [17, 17, 20, 255]);
  const preview = composePreview(content, tokens);
  assert.deepEqual([preview.width, preview.height], [STAGES[0].width, STAGES[0].height]);
  assert.deepEqual(at(preview, 0, 0), [...stage, 255], "the stage colour in a corner");
  const padding = 8 * DENSITY;
  const left = Math.floor((preview.width - (90 + 2 * padding)) / 2);
  const top = Math.floor((preview.height - (60 + 2 * padding)) / 2);
  assert.deepEqual(at(preview, left + padding + 45, top + padding + 30), [17, 17, 20, 255]);
  // The frame's border, a pixel inside its left edge, at mid-height.
  const border = at(preview, left, top + padding + 30);
  assert.ok(border[0] > 40, `a light border, not ${border}`);
});

test("each stage holds what the smaller one cannot", () => {
  const margin = 2 * STAGE_MARGIN * DENSITY + 2 * 8 * DENSITY;
  for (const [index, size] of STAGES.entries()) {
    const fits = composePreview(image(size.width - margin, 10, () => [0, 0, 0, 255]), tokens);
    assert.equal(fits.width, size.width);
    if (index + 1 < STAGES.length) {
      const larger = composePreview(image(size.width - margin + 1, 10, () => [0, 0, 0, 255]), tokens);
      assert.equal(larger.width, STAGES[index + 1].width);
    }
  }
});

test("a widget too large for every stage is refused", () => {
  const largest = STAGES.at(-1);
  assert.throws(() => composePreview(image(largest.width, 10, () => [0, 0, 0, 255]), tokens), /does not fit/);
  assert.throws(() => composePreview(image(10, largest.height, () => [0, 0, 0, 255]), tokens), /does not fit/);
});

test("the composition is the same twice", () => {
  const content = image(200, 120, (x, y) => [x & 255, y & 255, 128, 255]);
  const first = composePreview(content, tokens);
  const second = composePreview(content, tokens);
  assert.deepEqual(Buffer.from(first.pixels), Buffer.from(second.pixels));
});
