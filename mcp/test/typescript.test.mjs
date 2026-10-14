// The project's TypeScript runs only when install_sdk installed it: a project
// from someone else could hold its own node_modules/typescript/lib/tsc.js,
// which check, package and test would otherwise run with the user's rights.

import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { recordTypeScript, trustedTypeScript } from "../dist/typescript.js";
import { startServer } from "./support/rpc.mjs";
import { assembleRelease, fakeExecutables } from "./support/tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const work = realpathSync.native(mkdtempSync(join(tmpdir(), "overcrow-mcp-typescript-")));
after(() => rmSync(work, { recursive: true, force: true }));
const POSIX = process.platform !== "win32";

function project(name) {
  const root = join(work, name);
  const lib = join(root, "node_modules", "typescript", "lib");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, "tsc.js"), 'module.exports = require("./_tsc.js");\n');
  writeFileSync(join(lib, "_tsc.js"), "// the compiler\n");
  return { root, lib };
}

test("a TypeScript recorded at install is trusted while its files are unchanged", async () => {
  const cache = join(work, "cache-a");
  const { root, lib } = project("a");
  assert.equal(await trustedTypeScript(cache, root), false);
  await recordTypeScript(cache, root);
  assert.equal(await trustedTypeScript(cache, root), true);
  appendFileSync(join(lib, "_tsc.js"), "require('child_process').execSync('touch pwned');\n");
  assert.equal(await trustedTypeScript(cache, root), false);
});

test("another project's record does not count", async () => {
  const cache = join(work, "cache-b");
  const first = project("b1");
  const second = project("b2");
  await recordTypeScript(cache, first.root);
  assert.equal(await trustedTypeScript(cache, second.root), false);
});

test("a link in place of the compiler is never trusted", { skip: !POSIX }, async () => {
  const cache = join(work, "cache-c");
  const { root, lib } = project("c");
  const elsewhere = join(work, "elsewhere-tsc.js");
  writeFileSync(elsewhere, readFileSync(join(lib, "tsc.js")));
  await recordTypeScript(cache, root);
  rmSync(join(lib, "tsc.js"));
  symlinkSync(elsewhere, join(lib, "tsc.js"));
  assert.equal(await trustedTypeScript(cache, root), false);
});

// Through the server: the fake CLI writes the arguments it got.
const COMMANDS = [
  'check) echo "$@" > "$2/.check-args"; exit 0 ;;',
  `test) echo "$@" > "$2/.test-args"; echo '{"type":"summary","passed":0,"failed":0}'; exit 0 ;;`,
].join("\n");

test("check runs without type checking, and says why, until install_sdk installed TypeScript", {
  skip: !POSIX,
}, async () => {
  const root = join(work, "server");
  mkdirSync(root, { recursive: true });
  const widget = join(root, "evil");
  mkdirSync(join(widget, "node_modules", "typescript", "lib"), { recursive: true });
  writeFileSync(join(widget, "manifest.json"), "{}");
  writeFileSync(
    join(widget, "node_modules", "typescript", "lib", "tsc.js"),
    "require('fs').writeFileSync('pwned', '');\n",
  );
  writeFileSync(join(widget, "node_modules", "typescript", "lib", "_tsc.js"), "\n");
  const release = assembleRelease({ executables: fakeExecutables(undefined, COMMANDS) });
  writeFileSync(join(root, "tools.zip"), release.zips["linux-x86_64"]);
  const cacheRoot = join(work, "server-cache");
  const config = join(work, "server.json");
  writeFileSync(config, JSON.stringify({ pin: release.pin, cacheRoot, cwd: root }));
  const server = startServer([join(here, "support", "server.mjs"), config], { cwd: root });
  await server.initialize();
  try {
    assert.equal((await server.call("setup", { zipPath: "tools.zip" })).result.isError, undefined);

    const skipped = (await server.call("check", { directory: "evil" })).result;
    assert.match(readFileSync(join(widget, ".check-args"), "utf8"), /--no-typecheck/);
    assert.match(skipped.structuredContent.next, /run install_sdk/);
    await server.call("test", { directory: "evil" });
    assert.match(readFileSync(join(widget, ".test-args"), "utf8"), /--no-typecheck/);

    await recordTypeScript(cacheRoot, widget);
    await server.call("check", { directory: "evil" });
    assert.doesNotMatch(readFileSync(join(widget, ".check-args"), "utf8"), /--no-typecheck/);
  } finally {
    await server.close();
  }
});
