import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  crossCheck,
  InstallError,
  install,
  loadInstalled,
  verifyArchive,
} from "../dist/bootstrap/install.js";
import { validatePin } from "../dist/bootstrap/pin.js";
import { toolsPlatform } from "../dist/env.js";
import { Session, SetupError } from "../dist/session.js";
import { certificate, serve } from "./support/https.mjs";
import { assembleRelease, fakeExecutables, fakeProbe, sha256 } from "./support/tools.mjs";

const POSIX = process.platform !== "win32";
const platform = toolsPlatform();
const native = "platform" in platform ? platform.platform : "linux-x86_64";
const executables = fakeExecutables();
const release = assembleRelease({ executables });
const probe = fakeProbe(release.release, sha256(executables[native].runtime));
const work = mkdtempSync(join(tmpdir(), "overcrow-mcp-install-"));
after(() => rmSync(work, { recursive: true, force: true }));
let count = 0;
const cacheRoot = () => join(work, `cache-${++count}`);

test("the assembled pin is a valid pin", () => {
  const pin = validatePin(JSON.parse(JSON.stringify(release.pin)));
  assert.deepEqual(pin.tools, release.pin.tools);
  assert.deepEqual(pin.npm.sdk, release.pin.npm["@overcrow/sdk"]);
  assert.throws(() => validatePin({ ...release.pin, release: "latest" }));
  assert.equal(validatePin({ release: null, npm: release.pin.npm }).release, null);
});

test("installs a pinned ZIP: every file checked, private folder, executables 755", async () => {
  const root = cacheRoot();
  const tools = await install(
    release.zips[native],
    release.pin.tools[native],
    release.release,
    native,
    root,
    probe,
  );
  assert.equal(tools.cliVersion, "1.0.0-beta.2");
  assert.ok(existsSync(tools.cli) && existsSync(tools.runtime));
  assert.deepEqual(
    readdirSync(root),
    [`${release.release}-${native}`],
    "no temporary file is left",
  );
  if (POSIX) {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(statSync(tools.cli).mode & 0o777, 0o755);
    assert.equal(statSync(join(tools.directory, "cli.json")).mode & 0o777, 0o644);
  }
  const again = await loadInstalled(release.pin.tools[native], release.release, native, root);
  assert.equal(again?.cli, tools.cli);
  // A file changed in the cache: the copy is not used any more.
  writeFileSync(join(tools.directory, "README.txt"), "changed");
  assert.equal(
    await loadInstalled(release.pin.tools[native], release.release, native, root),
    undefined,
  );
});

test("refuses a ZIP that is not the pinned one, and keeps nothing", async () => {
  const root = cacheRoot();
  const other = Buffer.from(release.zips[native]);
  other[other.length - 30] ^= 1;
  await assert.rejects(
    install(other, release.pin.tools[native], release.release, native, root, probe),
    InstallError,
  );
  assert.deepEqual(existsSync(root) ? readdirSync(root) : [], []);
});

test("refuses ZIPs whose files disagree with each other", () => {
  const cases = {
    "an extra file": (_, files) => files.set("extra.txt", Buffer.from("x")),
    "SHA256SUMS that does not match": (_, files) =>
      files.set("SHA256SUMS", Buffer.from(`${"0".repeat(64)}  README.txt\n`)),
    "a runtime that runtimes.json does not describe": (_, files) => {
      const name = [...files.keys()].find(
        (key) => key.startsWith("overcrow-widget-headless-") && !key.endsWith(".md"),
      );
      files.set(name, Buffer.from("other runtime"));
    },
  };
  for (const [what, tamper] of Object.entries(cases)) {
    const bad = assembleRelease({ executables, tamper });
    assert.throws(
      () => crossCheck(verifyArchive(bad.zips[native], bad.pin.tools[native]), bad.release, native),
      InstallError,
      what,
    );
  }
  const otherPin = assembleRelease({ executables, cliPinsRuntime: false });
  assert.throws(
    () =>
      crossCheck(
        verifyArchive(otherPin.zips[native], otherPin.pin.tools[native]),
        otherPin.release,
        native,
      ),
    /pins another runtime/,
  );
});

test("refuses a CLI that reports another version or runtime", async () => {
  const wrong = async () => ({
    apiVersion: 1,
    version: "9.9.9",
    runtime: { version: release.release, sha256: {} },
  });
  await assert.rejects(
    install(
      release.zips[native],
      release.pin.tools[native],
      release.release,
      native,
      cacheRoot(),
      wrong,
    ),
    /does not report/,
  );
});

test("setup downloads from the release, checks, installs, and reuses the cache", {
  skip: certificate() ? false : "no openssl",
}, async () => {
  const tls = certificate();
  const zipName = release.pin.tools[native].name;
  const server = await serve(tls, {
    [`/Valhallab/playervox-overcrow-releases/releases/download/v${release.release}/${zipName}`]: (
      _,
      response,
    ) => response.writeHead(302, { location: "/asset" }).end(),
    "/asset": (_, response) => response.end(release.zips[native]),
  });
  try {
    const options = {
      launchRoots: [],
      toolsZip: undefined,
      pin: release.pin,
      cwd: work,
      releaseBase: `https://localhost:${server.port}`,
      releasePort: server.port,
      ca: tls.cert,
      cacheRootOverride: cacheRoot(),
      probe,
    };
    const session = new Session(options);
    const first = await session.setup(undefined);
    assert.equal(first.source, "download");
    const second = await new Session(options).setup(undefined);
    assert.equal(second.source, "cache");
    // A pin that does not match what the server sends: refused, nothing kept.
    const wrongPin = structuredClone(release.pin);
    wrongPin.tools[native].sha256 = "0".repeat(64);
    const refusedRoot = cacheRoot();
    await assert.rejects(
      new Session({ ...options, pin: wrongPin, cacheRootOverride: refusedRoot }).setup(undefined),
      (error) => error instanceof SetupError && /refused|not the pinned/.test(error.message),
    );
    assert.deepEqual(readdirSync(refusedRoot), []);
    // The server is gone: a clear message.
    await server.close();
    await assert.rejects(
      new Session({ ...options, cacheRootOverride: cacheRoot() }).setup(undefined),
      (error) => error instanceof SetupError && /Cannot download/.test(error.message),
    );
  } finally {
    await server.close().catch(() => undefined);
  }
});

test("setup works offline from a local copy of the pinned ZIP", async () => {
  const zip = join(work, "tools.zip");
  writeFileSync(zip, release.zips[native]);
  const session = new Session({
    launchRoots: [],
    toolsZip: zip,
    pin: release.pin,
    cwd: work,
    cacheRootOverride: cacheRoot(),
    probe,
  });
  assert.equal((await session.setup(undefined)).source, "local");
  writeFileSync(zip, Buffer.concat([release.zips[native], Buffer.from("x")]));
  await assert.rejects(
    new Session({
      launchRoots: [],
      toolsZip: zip,
      pin: release.pin,
      cwd: work,
      cacheRootOverride: cacheRoot(),
      probe,
    }).setup(undefined),
    /another size/,
  );
});

test("an unpinned package and an unsupported computer get a clear message", async () => {
  const unpinned = new Session({
    launchRoots: [],
    toolsZip: undefined,
    pin: { release: null, tools: {}, npm: release.pin.npm },
    cwd: work,
    cacheRootOverride: cacheRoot(),
  });
  await assert.rejects(unpinned.setup(undefined), /not tied to a published OverCrow release/);
  assert.match(toolsPlatform("darwin", "arm64").unsupported, /macOS arm64/);
  assert.match(toolsPlatform("linux", "arm64").unsupported, /Windows x64 and Linux x86-64/);
  assert.equal(toolsPlatform("win32", "x64").platform, "windows-x86_64");
});
