import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { startServer } from "./support/rpc.mjs";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const work = realpathSync.native(mkdtempSync(join(tmpdir(), "overcrow-mcp-preview-")));
after(() => rmSync(work, { recursive: true, force: true }));

function png(width, height, padding = 0) {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(0x89504e47, 0);
  header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, deflateSync(Buffer.alloc(8)), Buffer.alloc(padding, 1)]);
}

function widget(name) {
  const directory = join(work, name);
  mkdirSync(join(directory, "tests", "reference", "preview"), { recursive: true });
  writeFileSync(join(directory, "manifest.json"), "{}");
  writeFileSync(join(directory, "tests", "reference", "preview", "preview.png"), png(720, 540));
  writeFileSync(join(directory, "tests", "reference", "preview", "wide.png"), png(1000, 200));
  writeFileSync(
    join(directory, "tests", "reference", "preview", "huge.png"),
    png(720, 540, 300 * 1024),
  );
  return directory;
}

test("use_preview copies a reference image to assets/preview.png, never over a file", async () => {
  const directory = widget("w");
  const server = startServer([bin], { cwd: work });
  try {
    await server.initialize();
    const first = (
      await server.call("use_preview", { directory: "w", scenario: "preview", image: "preview" })
    ).result;
    assert.equal(first.isError, undefined, JSON.stringify(first).slice(0, 300));
    assert.deepEqual(
      readFileSync(join(directory, "assets", "preview.png")),
      readFileSync(join(directory, "tests", "reference", "preview", "preview.png")),
    );
    assert.equal(first.structuredContent.fourByThree, true);
    const again = (
      await server.call("use_preview", { directory: "w", scenario: "preview", image: "wide" })
    ).result;
    assert.equal(again.isError, true);
    assert.match(again.content[0].text, /never replaces/);
    const huge = (
      await server.call("use_preview", { directory: "w", scenario: "preview", image: "huge" })
    ).result;
    assert.equal(huge.isError, true);
    assert.match(huge.content[0].text, /256 KiB/);
    const missing = (
      await server.call("use_preview", { directory: "w", scenario: "none", image: "preview" })
    ).result;
    assert.equal(missing.isError, true);
    const traversal = (
      await server.call("use_preview", { directory: "w", scenario: "../..", image: "preview" })
    ).result;
    assert.equal(traversal.isError, true, "names are checked by the schema");
  } finally {
    await server.close();
  }
});

test("use_preview refuses an assets/ link that leads out of the project", async (t) => {
  const directory = widget("linked");
  const outside = join(dirname(work), `${basename(work)}-outside`);
  mkdirSync(outside, { recursive: true });
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  try {
    symlinkSync(outside, join(directory, "assets"), "dir");
  } catch {
    t.skip("symbolic links are not available");
    return;
  }
  const server = startServer([bin], { cwd: work });
  try {
    await server.initialize();
    const result = (
      await server.call("use_preview", {
        directory: "linked",
        scenario: "preview",
        image: "preview",
      })
    ).result;
    assert.equal(result.isError, true);
    assert.equal(existsSync(join(outside, "preview.png")), false);
  } finally {
    await server.close();
  }
});
