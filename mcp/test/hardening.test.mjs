// Regressions of the security review of the first version: shell syntax in
// project data never reaches the suggested commands; a link in the folders
// the CLI writes into cannot lead outside the project; hostile sizes and
// shapes cannot make the audit's text scans slow.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { auditWidget } from "../dist/audit/index.js";
import { infiniteAnimations, viewFacts } from "../dist/audit/project.js";
import { startServer } from "./support/rpc.mjs";
import { assembleRelease, fakeExecutables } from "./support/tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const testServer = join(here, "support", "server.mjs");
const work = realpathSync(mkdtempSync(join(tmpdir(), "overcrow-mcp-hardening-")));
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

test("prepare_submission keeps shell syntax of the project out of its commands", async () => {
  const project = join(work, "commands");
  const hostile = join(project, "x$(touch pwned)`id`");
  widget(hostile, { id: "com.evil.$(reboot)", version: '1.0.0"; rm -rf ~; echo "' });
  const server = startServer([join(here, "..", "dist", "index.js")], { cwd: project });
  try {
    await server.initialize();
    const result = (await server.call("prepare_submission", { directory: "x$(touch pwned)`id`" })).result;
    assert.equal(result.isError, undefined, JSON.stringify(result).slice(0, 400));
    const { lines } = result.structuredContent.commands;
    for (const line of lines.filter((text) => !text.startsWith("#"))) {
      assert.doesNotMatch(line, /\$\(|`|rm -rf|reboot|;/, line);
    }
    assert.ok(lines.some((line) => line.includes("<widget folder>")));
    assert.ok(lines.some((line) => line === 'git commit -m "Add my-widget"'));
  } finally {
    await server.close();
  }
});

const POSIX = process.platform !== "win32";
test("a link in dist/ or tests/output/ cannot lead the CLI's writes outside the project", { skip: POSIX ? false : "fake CLI scripts need a POSIX shell" }, async () => {
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
  writeFileSync(config, JSON.stringify({ pin: release.pin, cacheRoot: join(work, "cache"), cwd: project }));
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
