// The status icons in their slots, read from the reference captures of
// status-icons (Passive, 100 % and 150 %): every icon of an activity (done,
// started, to do) has the same slot and centre, whole within the panel's
// padding; every icon of a stage too. A dashed circle once sat a few
// pixels left of the others, its left arc cut.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { far, png } from "./png.mjs";

/** The panel's padding and an activity's icon slot, logical px (style.ocss `.checklist`, `.head-slot`). */
const PAD = 10;
const HEAD_SLOT = 16;
/** Between the head's slot and the activity's name. */
const HEAD_GAP = 8;

/**
 * The icons of a column of the capture: blobs of ink `min` to `max` px
 * tall, a few empty rows within (between a dashed circle's dashes);
 * `round` keeps only those as wide as tall, to leave out the text.
 */
function icons(image, from, to, min, max, round) {
  const background = image.at(1, image.height - 1);
  const ink = (x, y) => far(image.at(x, y), background, 40);
  const gap = Math.ceil(max / 6);
  const found = [];
  let band = null;
  let empty = 0;
  const close = () => {
    if (band === null) return;
    const height = band.bottom - band.top + 1;
    const width = band.right - band.left + 1;
    if (height >= min && height <= max && (!round || Math.abs(width - height) <= max / 12)) {
      found.push({ top: band.top, left: band.left, right: band.right, width, height, centre: (band.left + band.right) / 2 });
    }
    band = null;
  };
  for (let y = 0; y < image.height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = from; x < to; x += 1) {
      if (!ink(x, y)) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) {
      empty += 1;
      if (empty > gap) close();
    } else if (band === null) {
      band = { top: y, bottom: y, left, right };
      empty = 0;
    } else {
      band = { ...band, bottom: y, left: Math.min(band.left, left), right: Math.max(band.right, right) };
      empty = 0;
    }
  }
  close();
  return found;
}

for (const [name, scale] of [["icons-fr-100", 1], ["icons-fr-150", 1.5]]) {
  const image = png(readFileSync(new URL(`./reference/status-icons/${name}.png`, import.meta.url)));
  const at = (px) => Math.round(px * scale);

  test(`${name}: every activity's icon in the same slot, whole, on the same centre`, () => {
    // The Sortie done, the Archon Hunt, Netracells and Nightwave started, the two Circuits to do.
    const heads = icons(image, 0, at(PAD + HEAD_SLOT + HEAD_GAP / 2), at(12.5), at(17), false);
    assert.equal(heads.length, 6, JSON.stringify(heads));
    // The slot's centre, in pixels: its first pixel plus half its width, less the half pixel of a pixel's centre.
    const centre = at(PAD) + at(HEAD_SLOT) / 2 - 0.5;
    for (const icon of heads) {
      assert.ok(Math.abs(icon.centre - centre) <= 0.5, `the icon at ${icon.top}: centre ${icon.centre}, the slot's ${centre}`);
      // Whole: a circle cut at the panel's padding is narrower than tall.
      assert.ok(icon.width >= icon.height - 1, `the icon at ${icon.top} is cut: ${icon.width} by ${icon.height}`);
    }
  });

  test(`${name}: every stage's icon in the same slot, on the same centre`, () => {
    // The Archon Hunt's three stages and the five challenges Passive shows
    // under 520 points (the rest folds): done, to do, in progress.
    const from = at(PAD + HEAD_SLOT + HEAD_GAP / 2);
    const stages = icons(image, from, from + at(20), at(11.5), at(14.5), true);
    assert.ok(stages.length >= 8, JSON.stringify(stages));
    const centres = stages.map((icon) => icon.centre);
    assert.ok(Math.max(...centres) - Math.min(...centres) <= 0.5, `stage centres ${centres}`);
    const widths = stages.map((icon) => icon.right - icon.left);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `stage widths ${widths}`);
  });
}
