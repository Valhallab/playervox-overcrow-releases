// prepare_submission and the sources ZIP: what the ZIP holds and leaves out
// (with the reason), its bounds, its bytes (deterministic, readable by the
// strict reader), its atomic write; and, through the server with a fake CLI,
// the checklist, the texts to draft, and a ZIP written only once nothing
// fails, never through a link out of the project.

import assert from "node:assert/strict";
import {
  existsSync,
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
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { extractEntry, readEntries } from "../dist/bootstrap/zip.js";
import {
  buildZip,
  MAX_SOURCE_DEPTH,
  MAX_SOURCE_FILES,
  selectSources,
  writeSourcesZip,
} from "../dist/sources.js";
import { startServer } from "./support/rpc.mjs";
import { schemaErrors } from "./support/schema.mjs";
import { assembleRelease, fakeExecutables } from "./support/tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const testServer = join(here, "support", "server.mjs");
const work = realpathSync.native(mkdtempSync(join(tmpdir(), "overcrow-mcp-submission-")));
after(() => rmSync(work, { recursive: true, force: true }));
const POSIX = process.platform !== "win32";
const LIMITS = { maxEntries: 4000, maxEntryBytes: 1 << 26, maxTotalBytes: 1 << 26 };

function write(directory, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
}

function png(width, height) {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(0x89504e47, 0);
  header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, deflateSync(Buffer.alloc(16))]);
}

const manifest = (extra = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    apiVersion: 1,
    id: "valhallab.weather",
    version: "1.2.0",
    name: { en: "Weather", fr: "Météo" },
    sizing: { fit: "none", preferred: { width: 200, height: 100 } },
    permissions: {
      network: [
        {
          origin: "https://api.example-weather.net",
          method: "GET",
          path: "/v1/now",
          maxResponseBytes: 4096,
        },
      ],
    },
    ...extra,
  });

/**
 * A widget folder with sources, and what a ZIP must leave out. (.env and
 * .npmrc are left out too, but the audit refuses them: the selection test
 * adds them.)
 */
function project(directory, extra = {}) {
  return write(directory, {
    "manifest.json": manifest(),
    "view.ocml": "<box><text>{state.temperature}</text></box>\n",
    "logic.ts":
      'import { http } from "@overcrow/sdk";\nexport async function load() {\n  return http.fetch("https://api.example-weather.net/v1/now", { as: "json" });\n}\n',
    "locales/en.json": '{"title":"Weather"}\n',
    "locales/fr.json": '{"title":"Météo"}\n',
    LICENSE: "Copyright Valhallab. All rights reserved.\n",
    "package.json": '{"private":true}\n',
    "assets/preview.png": png(720, 540),
    "tests/basic.scenario.json": "{}\n",
    "tests/reference/basic/initial.png": png(300, 150),
    "tests/output/basic/initial.actual.png": png(300, 150),
    "node_modules/@overcrow/sdk/index.js": "export {};\n",
    "dist/valhallab.weather-1.2.0.ocpkg": "package",
    ".git/config": "[core]\n",
    ".gitignore": "node_modules\n",
    "notes/.draft.md": "draft\n",
    "signing.pem": "certificate\n",
    id_ed25519: "key\n",
    "Thumbs.db": "x",
    "old.ocpkg": "package",
    ...extra,
  });
}

const INCLUDED = [
  "LICENSE",
  "assets/preview.png",
  "locales/en.json",
  "locales/fr.json",
  "logic.ts",
  "manifest.json",
  "package.json",
  "tests/basic.scenario.json",
  "tests/reference/basic/initial.png",
  "view.ocml",
];

test("the ZIP holds the sources and lists what it leaves out, with the reason", async () => {
  const directory = project(join(work, "select"), {
    ".env": "TOKEN=x\n",
    ".npmrc": "//registry.npmjs.org/:_authToken=x\n",
  });
  const outside = write(join(work, "select-outside"), { "secret.txt": "outside\n" });
  if (POSIX) symlinkSync(outside, join(directory, "linked"), "dir");
  const selection = await selectSources(directory);
  assert.equal(selection.problem, null);
  assert.deepEqual(
    selection.included.map((file) => file.path),
    INCLUDED,
  );
  assert.equal(
    selection.included.find((file) => file.path === "manifest.json").bytes,
    Buffer.byteLength(manifest()),
  );
  const reasons = Object.fromEntries(selection.excluded.map((entry) => [entry.path, entry.reason]));
  for (const [path, reason] of [
    [".git/", /hidden folder/],
    [".gitignore", /hidden file/],
    [".env", /hidden file.*secrets/],
    [".npmrc", /hidden file/],
    ["notes/.draft.md", /hidden file/],
    ["node_modules/", /installed packages/],
    ["dist/", /build output/],
    ["tests/output/", /test output/],
    ["signing.pem", /key/],
    ["id_ed25519", /key/],
    ["Thumbs.db", /system file/],
    ["old.ocpkg", /built package/],
  ]) {
    assert.match(reasons[path] ?? "(not excluded)", reason, path);
  }
  if (POSIX) assert.match(reasons.linked, /link/);
  assert.ok(!selection.included.some((file) => file.path.startsWith("linked")));
});

test("names Windows cannot use are left out, with the reason", {
  skip: POSIX ? false : "Windows cannot create these names",
}, async () => {
  const directory = write(join(work, "names"), {
    "manifest.json": "{}",
    "a:b.txt": "x",
    "trailing.": "x",
    "aux.md": "x",
    "ok name é.md": "x",
  });
  const selection = await selectSources(directory);
  assert.deepEqual(
    selection.included.map((file) => file.path),
    ["manifest.json", "ok name é.md"],
  );
  for (const path of ["a:b.txt", "trailing.", "aux.md"]) {
    assert.match(
      selection.excluded.find((entry) => entry.path === path)?.reason ?? "",
      /Windows/,
      path,
    );
  }
});

test("the selection stops at its bounds: too many files, too deep", async () => {
  const many = join(work, "many");
  mkdirSync(join(many, "data"), { recursive: true });
  writeFileSync(join(many, "manifest.json"), "{}");
  for (let index = 0; index < MAX_SOURCE_FILES; index += 1)
    writeFileSync(join(many, "data", `${index}.txt`), "");
  assert.match((await selectSources(many)).problem ?? "", /more than 2000 files/);

  const deep = join(work, "deep");
  const levels = Array.from({ length: MAX_SOURCE_DEPTH + 1 }, (_, index) => `l${index}`);
  write(deep, { "manifest.json": "{}", [`${levels.join("/")}/x.txt`]: "x" });
  assert.match((await selectSources(deep)).problem ?? "", /folders deep/);
});

test("the ZIP is deterministic and the strict reader reads it back", () => {
  const entries = [
    { name: "LICENSE", data: Buffer.from("MIT\n") },
    { name: "assets/preview.png", data: png(720, 540) },
    { name: "logic.ts", data: Buffer.from("export const x = 1;\n".repeat(200)) },
    { name: "notes/empty.md", data: Buffer.alloc(0) },
  ];
  const zip = buildZip(entries);
  assert.deepEqual(buildZip(entries), zip, "same input, same bytes");
  // UTF-8 names, fixed date (1980-01-01 00:00) in every local header.
  assert.equal(zip.readUInt16LE(6), 0x800);
  assert.equal(zip.readUInt16LE(10), 0);
  assert.equal(zip.readUInt16LE(12), 0x21);
  assert.equal(buildZip([{ name: "é.md", data: Buffer.from("x") }]).includes("é.md"), true);
  const read = readEntries(zip, LIMITS);
  assert.deepEqual(
    read.map((entry) => entry.name),
    entries.map((entry) => entry.name),
  );
  for (const [index, entry] of read.entries()) {
    assert.equal(entry.mode, 0o644, entry.name);
    assert.deepEqual(extractEntry(zip, entry), entries[index].data, entry.name);
  }
  assert.ok(read.find((entry) => entry.name === "logic.ts").deflated, "text is deflated");
});

test("the ZIP is written atomically, replaces the previous one, and leaves no temporary file", async () => {
  const directory = project(join(work, "atomic"));
  const { included } = await selectSources(directory);
  const out = join(directory, "dist");
  const name = "valhallab.weather-1.2.0-sources.zip";
  const first = await writeSourcesZip(directory, included, out, name);
  assert.ok(!("problem" in first), JSON.stringify(first));
  const zip = readFileSync(first.path);
  assert.equal(first.bytes, zip.length);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    readEntries(zip, LIMITS).map((entry) => entry.name),
    INCLUDED,
  );
  const again = await writeSourcesZip(directory, included, out, name);
  assert.equal(again.sha256, first.sha256, "the same sources give the same ZIP");
  assert.deepEqual(
    readdirSync(out).filter((file) => file.endsWith(".tmp")),
    [],
  );
  // A file that changed since it was selected stops the ZIP.
  writeFileSync(join(directory, "logic.ts"), "export const changed = true;\n");
  const changed = await writeSourcesZip(directory, included, out, name);
  assert.match(changed.problem ?? "", /logic\.ts changed/);
});

// ── Through the server, with a fake CLI ─────────────────────────────────

const REVIEW = JSON.stringify({
  kind: "network",
  method: "GET",
  origin: "https://api.example-weather.net",
  path: "/v1/now",
  maxResponseBytes: 4096,
});
const FAKE_COMMANDS = [
  "check) exit 0 ;;",
  `admit) echo '{"formatVersion":1,"admitted":false,"diagnostics":[{"code":"admission.listing_missing","severity":"error","file":"listing.json","message":"a submission needs listing.json next to manifest.json"}],"package":{"bytes":2048},"review":[${REVIEW}]}'; exit 1 ;;`,
  `test) echo '{"type":"scenario","name":"basic","passed":true,"images":[]}'; echo '{"type":"summary","passed":1,"failed":0}'; exit 0 ;;`,
].join("\n");

async function serverWithTools(name) {
  const root = join(work, name);
  mkdirSync(root, { recursive: true });
  const release = assembleRelease({ executables: fakeExecutables(undefined, FAKE_COMMANDS) });
  writeFileSync(join(root, "tools.zip"), release.zips["linux-x86_64"]);
  const config = join(work, `${name}.json`);
  writeFileSync(
    config,
    JSON.stringify({ pin: release.pin, cacheRoot: join(work, `${name}-cache`), cwd: root }),
  );
  const server = startServer([testServer, config], { cwd: root });
  await server.initialize();
  const setup = (await server.call("setup", { zipPath: "tools.zip" })).result;
  assert.equal(setup.isError, undefined, JSON.stringify(setup).slice(0, 400));
  const { tools } = (await server.request("tools/list")).result;
  const schema = tools.find((tool) => tool.name === "prepare_submission").outputSchema;
  const prepare = async (directory) => {
    const result = (await server.call("prepare_submission", { directory })).result;
    assert.equal(result.isError, undefined, JSON.stringify(result).slice(0, 400));
    assert.deepEqual(schemaErrors(result.structuredContent, schema), []);
    return result.structuredContent;
  };
  return { root, server, prepare };
}

const status = (result) =>
  Object.fromEntries(result.checklist.map((entry) => [entry.item, entry.status]));

test("prepare_submission: checklist, texts to draft, and the ZIP once nothing fails", {
  skip: POSIX ? false : "fake CLI scripts need a POSIX shell",
}, async () => {
  const { root, server, prepare } = await serverWithTools("ready");
  try {
    const directory = project(join(root, "weather"));
    const zipPath = join(directory, "dist", "valhallab.weather-1.2.0-sources.zip");

    const before = await prepare("weather");
    assert.equal(before.ready, false);
    assert.equal(status(before)["Tests pass"], "fail");
    assert.equal(before.sources.zip, null);
    assert.equal(existsSync(zipPath), false, "no ZIP while an item fails");
    assert.deepEqual(
      before.sources.included.map((file) => file.path),
      INCLUDED,
      "the ZIP's content is shown before it is written",
    );

    const tested = (await server.call("test", { directory: "weather" })).result;
    assert.equal(tested.structuredContent.failed, 0);
    const ready = await prepare("weather");
    assert.equal(ready.ready, true, JSON.stringify(ready.checklist));
    assert.deepEqual(status(ready), {
      "Widget ID": "pass",
      "check: no error, no warning": "pass",
      "Static admission (overcrow-widget admit)": "pass",
      "Tests pass": "pass",
      "Audit: no high finding": "pass",
      Preview: "pass",
      "Texts in English and French": "pass",
      LICENSE: "pass",
      "Each permission justified": "todo",
      "Privacy policy": "todo",
      "Release notes in English and French": "todo",
      "Sources ZIP": "pass",
    });
    assert.equal(ready.sources.zip, "weather/dist/valhallab.weather-1.2.0-sources.zip");
    const zip = readFileSync(zipPath);
    assert.equal(ready.sources.bytes, zip.length);
    assert.deepEqual(
      readEntries(zip, LIMITS).map((entry) => entry.name),
      INCLUDED,
    );
    assert.deepEqual(
      ready.texts.map((text) => `${text.kind}:${text.subject}`),
      [
        "permission:Network: GET https://api.example-weather.net/v1/now, responses up to 4 KiB.",
        "privacy-policy:https://api.example-weather.net",
        "release-notes:en",
        "release-notes:fr",
        "description:en",
        "description:fr",
      ],
    );
    assert.match(ready.next, /creator space on overcrow\.playervox\.com/);
    const text = JSON.stringify(ready);
    for (const gone of ["pull request", "candidate", "git ", "fork"])
      assert.ok(!text.includes(gone), `no ${gone}`);

    // A source changes: the tests no longer stand, and no new ZIP is made.
    writeFileSync(join(directory, "view.ocml"), "<box><text>changed</text></box>\n");
    const stale = await prepare("weather");
    assert.equal(stale.ready, false);
    assert.match(stale.checklist.find((entry) => entry.item === "Tests pass").detail, /changed/);
    assert.equal(stale.sources.zip, null);
  } finally {
    await server.close();
  }
});

test("prepare_submission: a placeholder ID, a missing preview, a secret: no ZIP", {
  skip: POSIX ? false : "fake CLI scripts need a POSIX shell",
}, async () => {
  const { root, server, prepare } = await serverWithTools("refused");
  try {
    const directory = project(join(root, "w"), {
      "manifest.json": manifest({ id: "yourhandle.weather" }),
      "notes.md": `token: ghp_${"a".repeat(36)}\n`,
    });
    rmSync(join(directory, "assets", "preview.png"));
    await server.call("test", { directory: "w" });
    const result = await prepare("w");
    assert.equal(result.ready, false);
    const checklist = Object.fromEntries(result.checklist.map((entry) => [entry.item, entry]));
    assert.equal(checklist["Widget ID"].status, "fail");
    assert.match(checklist["Widget ID"].detail, /placeholder.*<handle>\.<name>/);
    assert.equal(checklist.Preview.status, "fail");
    assert.match(checklist.Preview.detail, /use_preview/);
    assert.equal(checklist["Audit: no high finding"].status, "fail");
    assert.equal(checklist["Sources ZIP"].status, "fail");
    assert.deepEqual(
      readdirSync(join(directory, "dist")).filter((file) => file.endsWith(".zip")),
      [],
    );
  } finally {
    await server.close();
  }
});

test("prepare_submission never writes the ZIP through a dist/ link out of the project", {
  skip: POSIX ? false : "fake CLI scripts need a POSIX shell",
}, async () => {
  const { root, server } = await serverWithTools("link");
  try {
    const directory = project(join(root, "w"));
    rmSync(join(directory, "dist"), { recursive: true });
    const outside = join(work, "link-outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(directory, "dist"), "dir");
    await server.call("test", { directory: "w" });
    const result = (await server.call("prepare_submission", { directory: "w" })).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /outside/);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    await server.close();
  }
});
