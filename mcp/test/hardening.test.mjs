// Regressions of the security review of the first version: project data
// never reaches a file name or a command unchecked; a link in the folders
// the CLI writes into cannot lead outside the project; hostile sizes and
// shapes cannot make the audit's text scans slow.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { auditWidget } from "../dist/audit/index.js";
import { infiniteAnimations, viewFacts } from "../dist/audit/project.js";
import { INVISIBLE_CHARACTERS } from "../dist/hidden.js";
import { nameProblem } from "../dist/tools/project.js";
import { startServer } from "./support/rpc.mjs";
import { assembleRelease, fakeExecutables } from "./support/tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const testServer = join(here, "support", "server.mjs");
const work = realpathSync.native(mkdtempSync(join(tmpdir(), "overcrow-mcp-hardening-")));
after(() => rmSync(work, { recursive: true, force: true }));

function widget(directory, manifestExtra = {}) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      apiVersion: 1,
      id: "com.example-studio.safe",
      version: "1.0.0",
      name: { en: "Safe", fr: "Safe" },
      sizing: { fit: "none", preferred: { width: 100, height: 100 } },
      ...manifestExtra,
    }),
  );
  writeFileSync(join(directory, "logic.ts"), "export const x = 1;\n");
}

test("prepare_submission builds nothing from unchecked project values", async () => {
  const project = join(work, "commands");
  const hostile = join(project, "x$(touch pwned)`id`");
  widget(hostile, { id: "com.evil.$(reboot)", version: '1.0.0"; rm -rf ~; echo "' });
  const server = startServer([join(here, "..", "dist", "index.js")], { cwd: project });
  try {
    await server.initialize();
    const result = (await server.call("prepare_submission", { directory: "x$(touch pwned)`id`" }))
      .result;
    assert.equal(result.isError, undefined, JSON.stringify(result).slice(0, 400));
    const content = result.structuredContent;
    assert.equal(content.ready, false);
    assert.equal(content.commands, undefined, "no command to run");
    assert.equal(content.sources.zip, null);
    assert.equal(content.checklist.find((entry) => entry.item === "Widget ID").status, "fail");
    assert.deepEqual(readdirSync(hostile).sort(), ["logic.ts", "manifest.json"]);
  } finally {
    await server.close();
  }
});

const POSIX = process.platform !== "win32";
test("a link in dist/ or tests/output/ cannot lead the CLI's writes outside the project", {
  skip: POSIX ? false : "fake CLI scripts need a POSIX shell",
}, async () => {
  const project = join(work, "links");
  const outside = join(work, "outside");
  mkdirSync(outside, { recursive: true });
  widget(join(project, "w"));
  mkdirSync(join(project, "w", "tests"), { recursive: true });
  symlinkSync(outside, join(project, "w", "dist"), "dir");
  symlinkSync(outside, join(project, "w", "tests", "output"), "dir");
  const release = assembleRelease({ executables: fakeExecutables() });
  const zip = join(project, "tools.zip");
  writeFileSync(zip, release.zips["linux-x86_64"]);
  const config = join(work, "links.json");
  writeFileSync(
    config,
    JSON.stringify({ pin: release.pin, cacheRoot: join(work, "cache"), cwd: project }),
  );
  const server = startServer([testServer, config], { cwd: project });
  try {
    await server.initialize();
    const setup = (await server.call("setup", { zipPath: "tools.zip" })).result;
    assert.equal(setup.isError, undefined, JSON.stringify(setup).slice(0, 400));
    for (const tool of ["package", "test"]) {
      const result = (await server.call(tool, { directory: "w" })).result;
      assert.equal(result.isError, true, tool);
      assert.match(result.content[0].text, /outside/, tool);
    }
  } finally {
    await server.close();
  }
});

test("hostile sizes and shapes do not slow the audit down", async () => {
  const started = Date.now();
  infiniteAnimations("a".repeat(120_000));
  infiniteAnimations("{".repeat(60_000) + "}".repeat(60_000));
  viewFacts("<if ".repeat(60_000));
  viewFacts(`<image ${"a".repeat(200_000)}`);
  const directory = join(work, "slow");
  widget(directory);
  writeFileSync(join(directory, "notes.md"), `api_key = "${"a".repeat(600_000)}`);
  writeFileSync(join(directory, "style.ocss"), "a".repeat(120_000));
  writeFileSync(join(directory, "view.ocml"), "<image ".repeat(30_000));
  await auditWidget(directory);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
});

test("a widget name with a hidden character is refused, naming it and its position", () => {
  const hidden = (code, position) =>
    `The name holds a hidden character, U+${code}, at position ${position}: remove it.`;
  assert.equal(nameProblem("Clock\u202e"), hidden("202E", 6));
  assert.equal(nameProblem("a\u200db"), hidden("200D", 2));
  assert.equal(nameProblem("Re\u00adset"), hidden("00AD", 3));
  // Counted in characters, not in UTF-16 units: a tag character is one.
  assert.equal(nameProblem("\u{1F600}Clock\u{E0041}"), hidden("E0041", 7));
  assert.equal(nameProblem("\ufe0fClock"), hidden("FE0F", 1));
  assert.equal(nameProblem("\u23f1\ufe0f\ufe0f"), hidden("FE0F", 3));
  // An emoji keeps its presentation selector.
  assert.equal(nameProblem("\u23f1\ufe0f Timer"), undefined);
  assert.equal(nameProblem("12\u00a0h"), undefined);
});

test("the hidden characters are the widget schema's", () => {
  const schema = readFileSync(
    join(here, "..", "..", "crates", "overcrow-widget-schema", "src", "text.rs"),
    "utf8",
  );
  const start = schema.indexOf("pub const INVISIBLE_CHARACTERS");
  const block = schema.slice(start, schema.indexOf("];", start));
  const ranges = [...block.matchAll(/'\\u\{([0-9A-F]+)\}'\.\.='\\u\{([0-9A-F]+)\}'/g)].map(
    (match) => [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)],
  );
  assert.ok(ranges.length > 10);
  assert.deepEqual(INVISIBLE_CHARACTERS, ranges);
});
