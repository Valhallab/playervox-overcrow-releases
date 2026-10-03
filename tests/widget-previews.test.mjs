// Every widget of the repository declares a marketplace preview, and that
// preview is one of its own reference images, byte for byte: a preview cannot
// drift from what the widget renders once the references are re-recorded.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const widgets = readdirSync(join(root, "widgets"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const maximumBytes = 256 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function referenceDigests(directory) {
  const digests = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) for (const value of referenceDigests(path)) digests.add(value);
    else if (entry.name.endsWith(".png")) digests.add(digest(readFileSync(path)));
  }
  return digests;
}

test("the repository has widgets", () => assert.ok(widgets.length > 0));

for (const widget of widgets) {
  test(`${widget} declares a preview taken from its reference images`, () => {
    const directory = join(root, "widgets", widget);
    const listing = JSON.parse(readFileSync(join(directory, "listing.json"), "utf8"));
    assert.equal(listing.preview, "assets/preview.png");
    const path = join(directory, listing.preview);
    assert.ok(statSync(path).size <= maximumBytes, "a preview is at most 256 KiB");
    const bytes = readFileSync(path);
    assert.deepEqual(bytes.subarray(0, 8), pngSignature, "a preview is a PNG");
    assert.ok(
      referenceDigests(join(directory, "tests", "reference")).has(digest(bytes)),
      "the preview is a copy of one of the widget's reference images",
    );
  });
}
