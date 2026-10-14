// The project's TypeScript runs only when it is the pinned one: a project
// from someone else could hold its own node_modules/typescript/lib/tsc.js,
// which check, package and test would otherwise run with the user's rights,
// even after an npm install that kept it (npm trusts its lockfile).

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
import { mayTypeCheck } from "../dist/typescript.js";
import { startServer } from "./support/rpc.mjs";
import { assembleRelease, fakeExecutables, PINNED_TSC } from "./support/tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const work = realpathSync.native(mkdtempSync(join(tmpdir(), "overcrow-mcp-typescript-")));
after(() => rmSync(work, { recursive: true, force: true }));
const POSIX = process.platform !== "win32";
const PIN = assembleRelease({ executables: fakeExecutables() }).pin.npm.typescript;

function project(name, files = PINNED_TSC) {
  const root = join(work, name);
  const lib = join(root, "node_modules", "typescript", "lib");
  mkdirSync(lib, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(root, "node_modules", "typescript", file), text);
  }
  return { root, lib };
}

test("the pinned TypeScript may run, while its files are unchanged", async () => {
  const { root, lib } = project("a");
  assert.equal(await mayTypeCheck(PIN, root), true);
  appendFileSync(join(lib, "_tsc.js"), "require('child_process').execSync('touch pwned');\n");
  assert.equal(await mayTypeCheck(PIN, root), false);
});

test("a project's own TypeScript, or none, never runs", async () => {
  const { root } = project("b", {
    "lib/tsc.js": "require('fs').writeFileSync('pwned', '');\n",
    "lib/_tsc.js": "\n",
  });
  assert.equal(await mayTypeCheck(PIN, root), false);
  assert.equal(await mayTypeCheck(PIN, join(work, "nothing")), false);
});

test("a link in place of the compiler or its folder is never trusted", {
  skip: !POSIX,
}, async () => {
  const genuine = project("c-genuine");
  const linked = join(work, "c");
  mkdirSync(join(linked, "node_modules"), { recursive: true });
  symlinkSync(
    join(genuine.root, "node_modules", "typescript"),
    join(linked, "node_modules", "typescript"),
  );
  assert.equal(await mayTypeCheck(PIN, linked), false);
  const file = project("d");
  rmSync(join(file.lib, "tsc.js"));
  symlinkSync(join(genuine.lib, "tsc.js"), join(file.lib, "tsc.js"));
  assert.equal(await mayTypeCheck(PIN, file.root), false);
});

// Through the server: the fake CLI writes the arguments it got.
const COMMANDS = [
  'check) echo "$@" > "$2/.check-args"; exit 0 ;;',
  `test) echo "$@" > "$2/.test-args"; echo '{"type":"summary","passed":0,"failed":0}'; exit 0 ;;`,
].join("\n");

test("check and test skip the type check, and say why, unless the TypeScript is the pinned one", {
  skip: !POSIX,
}, async () => {
  const root = join(work, "server");
  mkdirSync(root, { recursive: true });
  const evil = project("server/evil", {
    "lib/tsc.js": "require('fs').writeFileSync('pwned', '');\n",
    "lib/_tsc.js": "\n",
  }).root;
  writeFileSync(join(evil, "manifest.json"), "{}");
  const genuine = project("server/genuine").root;
  writeFileSync(join(genuine, "manifest.json"), "{}");
  const release = assembleRelease({ executables: fakeExecutables(undefined, COMMANDS) });
  writeFileSync(join(root, "tools.zip"), release.zips["linux-x86_64"]);
  const config = join(work, "server.json");
  writeFileSync(
    config,
    JSON.stringify({ pin: release.pin, cacheRoot: join(work, "server-cache"), cwd: root }),
  );
  const server = startServer([join(here, "support", "server.mjs"), config], { cwd: root });
  await server.initialize();
  try {
    assert.equal((await server.call("setup", { zipPath: "tools.zip" })).result.isError, undefined);

    const skipped = (await server.call("check", { directory: "evil" })).result;
    assert.match(readFileSync(join(evil, ".check-args"), "utf8"), /--no-typecheck/);
    assert.match(skipped.structuredContent.next, /run install_sdk/);
    await server.call("test", { directory: "evil" });
    assert.match(readFileSync(join(evil, ".test-args"), "utf8"), /--no-typecheck/);

    await server.call("check", { directory: "genuine" });
    assert.doesNotMatch(readFileSync(join(genuine, ".check-args"), "utf8"), /--no-typecheck/);
  } finally {
    await server.close();
  }
});
