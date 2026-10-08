#!/usr/bin/env node
// Composes the marketplace preview of each widget of `widgets/`: the image
// its `preview` scenario captures (tests/reference/preview/preview.png: the
// content in dark English at 150 %, on the stage colour), framed as
// OverCrow's wrapper frames it in the overlay (padding, panel, border,
// radius and shadow from the schema's dark tokens) and centred on a 4:3
// stage, the smallest of three that holds it. Every widget keeps its real
// size: one point of the widget is 1.5 pixels of the preview, whatever the
// widget, and a page shows a preview at 1.5 pixels per CSS pixel at most.
//
//   node scripts/compose-previews.mjs            writes widgets/*/assets/preview.png
//   node scripts/compose-previews.mjs --check    fails if one differs
//
// Deterministic: integer compositing, and coverage from IEEE operations
// only, so the same reference gives the same pixels on every platform.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./lib/png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The stages, points, all 4:3: small widgets fill a small stage, and the
 * large one holds the tallest widget at its usual size.
 */
export const STAGES_POINTS = [
  { width: 320, height: 240 },
  { width: 440, height: 330 },
  { width: 560, height: 420 },
];
/** Pixels per point of a preview: the scale of its scenario, 150 %. */
export const DENSITY = 1.5;
export const PREVIEW_SCALE = 1500;
/** The stages, pixels. */
export const STAGES = STAGES_POINTS.map(({ width, height }) => ({
  width: width * DENSITY,
  height: height * DENSITY,
}));
/** The free space a framed widget keeps around it on the stage, points. */
export const STAGE_MARGIN = 24;
/** The stage colour, also the `background` of every preview scenario. */
export const STAGE_COLOUR = "#1e242e";
/** The wrapper's padding around the content at scale 1, points. */
const FRAME_PADDING = 8;

/** The dark value of each token the wrapper's frame uses. */
export function frameTokens(schemaReference = readFileSync(join(root, "docs/widget-schema-v1.md"), "utf8")) {
  const value = (name) => {
    const row = schemaReference
      .split("\n")
      .find((line) => line.startsWith(`| \`${name}\` |`));
    const match = row?.match(/^\| `[^`]+` \| [a-z]+ \| `([^`]+)` \|/);
    if (!match) throw new Error(`docs/widget-schema-v1.md has no ${name} token`);
    return match[1];
  };
  const shadow = value("--shadow-panel").match(
    /^(-?\d+)px (-?\d+)px (\d+)px (\d+)px (#[0-9a-f]{8})$/,
  );
  if (!shadow) throw new Error("unexpected --shadow-panel value");
  return {
    panel: rgba(value("--color-surface-panel")),
    border: rgba(value("--color-border-strong")),
    radius: Number.parseFloat(value("--radius-lg")),
    shadow: {
      x: Number(shadow[1]),
      y: Number(shadow[2]),
      blur: Number(shadow[3]),
      spread: Number(shadow[4]),
      colour: rgba(shadow[5]),
    },
  };
}

function rgba(hex) {
  const match = hex.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (!match) throw new Error(`unexpected colour ${hex}`);
  const channel = (at) => Number.parseInt(match[1].slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4), match[2] ? Number.parseInt(match[2], 16) : 255];
}

/** `source` over `target` with `alpha` in 0..255, rounded. */
const over = (source, target, alpha) => Math.round((source * alpha + target * (255 - alpha)) / 255);

/**
 * Coverage (0..255) of the pixel (x, y) by the rounded rectangle of corner
 * `[left, top]`, size `[width, height]` and radius `radius`, pixels.
 */
function coverage(x, y, left, top, width, height, radius) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const qx = Math.abs(x + 0.5 - (left + halfWidth)) - (halfWidth - radius);
  const qy = Math.abs(y + 0.5 - (top + halfHeight)) - (halfHeight - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const distance = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.round(Math.min(Math.max(0.5 - distance, 0), 1) * 255);
}

/** Three box blurs of `size` pixels in each direction: a Gaussian, nearly. */
function blur(mask, width, height, size) {
  const half = Math.floor(size / 2);
  let current = Uint32Array.from(mask);
  const next = new Uint32Array(mask.length);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const horizontal of [true, false]) {
      const length = horizontal ? width : height;
      const lines = horizontal ? height : width;
      for (let line = 0; line < lines; line += 1) {
        const at = (index) => (horizontal ? line * width + index : index * width + line);
        let sum = 0;
        for (let index = -half; index < size - half; index += 1) {
          if (index >= 0 && index < length) sum += current[at(index)];
        }
        for (let index = 0; index < length; index += 1) {
          next[at(index)] = Math.round(sum / size);
          const leaving = index - half;
          const entering = index - half + size;
          if (leaving >= 0 && leaving < length) sum -= current[at(leaving)];
          if (entering >= 0 && entering < length) sum += current[at(entering)];
        }
      }
      current = Uint32Array.from(next);
    }
  }
  return current;
}

/**
 * The preview of one widget from its decoded `preview` capture, on the
 * smallest stage that holds the framed widget with its margin. Throws when
 * none does.
 */
export function composePreview(content, tokens = frameTokens()) {
  const padding = FRAME_PADDING * DENSITY;
  const frame = { width: content.width + 2 * padding, height: content.height + 2 * padding };
  const margin = STAGE_MARGIN * DENSITY;
  const stageSize = STAGES.find(
    (candidate) =>
      frame.width + 2 * margin <= candidate.width && frame.height + 2 * margin <= candidate.height,
  );
  if (!stageSize) {
    const largest = STAGES.at(-1);
    throw new Error(
      `a ${content.width} × ${content.height} capture does not fit the ${largest.width} × ${largest.height} stage`,
    );
  }
  const { width, height } = stageSize;
  const left = Math.floor((width - frame.width) / 2);
  const top = Math.floor((height - frame.height) / 2);
  const radius = tokens.radius * DENSITY;
  const stage = rgba(STAGE_COLOUR);

  // The shadow under the frame, then the frame's panel over the stage: the
  // capture's own pixels are the panel over the stage colour too.
  const shadow = tokens.shadow;
  const mask = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = coverage(
        x,
        y,
        left + shadow.x * DENSITY - shadow.spread * DENSITY,
        top + shadow.y * DENSITY - shadow.spread * DENSITY,
        frame.width + 2 * shadow.spread * DENSITY,
        frame.height + 2 * shadow.spread * DENSITY,
        radius,
      );
    }
  }
  // CSS blur radius b is a Gaussian of σ = b / 2; three boxes of w pixels
  // have σ² = (w² − 1) / 4.
  const sigma = (shadow.blur * DENSITY) / 2;
  const box = Math.max(1, Math.round(Math.sqrt(4 * sigma * sigma + 1)));
  const blurred = blur(mask, width, height, box);
  const panel = stage.slice(0, 3).map((channel, index) => over(tokens.panel[index], channel, tokens.panel[3]));

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const shade = Math.round((blurred[index] * shadow.colour[3]) / 255);
      const inside = coverage(x, y, left, top, frame.width, frame.height, radius);
      const ring =
        inside - coverage(x, y, left + 1, top + 1, frame.width - 2, frame.height - 2, Math.max(radius - 1, 0));
      for (let channel = 0; channel < 3; channel += 1) {
        const ground = over(shadow.colour[channel], stage[channel], shade);
        let value = over(panel[channel], ground, inside);
        value = over(tokens.border[channel], value, Math.round((Math.max(ring, 0) * tokens.border[3]) / 255));
        pixels[index * 4 + channel] = value;
      }
      pixels[index * 4 + 3] = 255;
    }
  }
  for (let y = 0; y < content.height; y += 1) {
    const from = y * content.width * 4;
    pixels.set(
      content.pixels.subarray(from, from + content.width * 4),
      ((top + padding + y) * width + left + padding) * 4,
    );
  }
  return { width, height, pixels };
}

export function widgetDirectories() {
  return readdirSync(join(root, "widgets"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "widgets", entry.name, "listing.json")))
    .map((entry) => entry.name)
    .sort();
}

export function capturePath(widget) {
  return join(root, "widgets", widget, "tests", "reference", "preview", "preview.png");
}

export function previewPath(widget) {
  return join(root, "widgets", widget, "assets", "preview.png");
}

function main(argv) {
  const check = argv.includes("--check");
  const tokens = frameTokens();
  let differ = 0;
  for (const widget of widgetDirectories()) {
    const composed = composePreview(decodePng(readFileSync(capturePath(widget))), tokens);
    if (check) {
      const current = existsSync(previewPath(widget)) ? decodePng(readFileSync(previewPath(widget))) : null;
      const same =
        current &&
        current.width === composed.width &&
        current.height === composed.height &&
        Buffer.from(current.pixels).equals(Buffer.from(composed.pixels));
      if (!same) {
        differ += 1;
        console.error(`${widget}: assets/preview.png differs from its composed preview`);
      }
    } else {
      writeFileSync(previewPath(widget), encodePng(composed));
      console.log(`${widget}: assets/preview.png`);
    }
  }
  if (differ > 0) {
    console.error("Run `node scripts/compose-previews.mjs`, then review the previews.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
