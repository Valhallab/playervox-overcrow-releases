// Every widget of the repository declares a marketplace preview, and that
// preview is exactly the composition of the image its `preview` scenario
// captures: the widget in its overlay frame, at its real size, on one of the
// 4:3 stages (scripts/compose-previews.mjs). A preview cannot drift from
// what the widget renders once its references are re-recorded.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  STAGES,
  STAGE_COLOUR,
  PREVIEW_SCALE,
  capturePath,
  composePreview,
  frameTokens,
  previewPath,
} from "../scripts/compose-previews.mjs";
import { decodePng } from "../scripts/lib/png.mjs";

const root = new URL("..", import.meta.url).pathname;
const widgets = readdirSync(join(root, "widgets"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const maximumBytes = 256 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const tokens = frameTokens();

test("the repository has widgets", () => assert.ok(widgets.length > 0));

for (const widget of widgets) {
  const directory = join(root, "widgets", widget);

  test(`${widget} has a preview scenario in dark English at 150 % on the stage`, () => {
    const scenario = JSON.parse(readFileSync(join(directory, "tests", "preview.scenario.json"), "utf8"));
    assert.equal(scenario.name, "preview");
    assert.equal(scenario.host.scale, PREVIEW_SCALE);
    assert.equal(scenario.host.background, STAGE_COLOUR);
    assert.equal(scenario.host.theme ?? "dark", "dark");
    assert.equal(scenario.host.locale ?? "en", "en");
    assert.equal(scenario.host.frame ?? false, false, "the script draws the frame");
    for (const step of scenario.steps) {
      assert.equal(step.host?.scale ?? PREVIEW_SCALE, PREVIEW_SCALE);
      assert.equal(step.host?.theme ?? "dark", "dark");
      assert.equal(step.host?.locale ?? "en", "en");
    }
    const images = scenario.steps.flatMap((step) => (step.expect?.image ? [step.expect.image] : []));
    assert.deepEqual(images, ["preview"], "one image, named preview");
  });

  test(`${widget} declares the preview composed from its scenario`, () => {
    const listing = JSON.parse(readFileSync(join(directory, "listing.json"), "utf8"));
    assert.equal(listing.preview, "assets/preview.png");
    const path = previewPath(widget);
    assert.ok(statSync(path).size <= maximumBytes, "a preview is at most 256 KiB");
    const bytes = readFileSync(path);
    assert.deepEqual(bytes.subarray(0, 8), pngSignature, "a preview is a PNG");
    const preview = decodePng(bytes);
    assert.ok(
      STAGES.some((stage) => stage.width === preview.width && stage.height === preview.height),
      `a preview is one of the stages, not ${preview.width} × ${preview.height}`,
    );
    const composed = composePreview(decodePng(readFileSync(capturePath(widget))), tokens);
    assert.equal(preview.width, composed.width);
    assert.equal(preview.height, composed.height);
    assert.ok(
      Buffer.from(preview.pixels).equals(Buffer.from(composed.pixels)),
      "assets/preview.png is the composition of tests/reference/preview/preview.png: run `node scripts/compose-previews.mjs`",
    );
  });
}
