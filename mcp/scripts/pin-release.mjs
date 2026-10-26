// Pins @overcrow/mcp to a published OverCrow release: copies the
// `creatorTools` entry of its release.json (each platform's ZIP and every
// file in it, with sizes and SHA-256) into src/bootstrap/pin.json, with the
// npm integrity of the SDK (its latest released version: sdk/package.json's,
// or the changelog's previous section while that one is not released yet) and of the
// TypeScript of the templates, with the SHA-256 of the files tsc runs.
//
//   node scripts/pin-release.mjs <version>    write the pin
//   node scripts/pin-release.mjs --check      the committed pin matches the
//                                             published release, and both
//                                             ZIPs download with its digests
//
// Exit status: 0 ok, 1 mismatch, 3 release not published (yet).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repository = join(root, "..");
const pinPath = join(root, "src", "bootstrap", "pin.json");
const RELEASES = "https://github.com/Valhallab/playervox-overcrow-releases/releases/download";
const PLATFORMS = ["linux-x86_64", "windows-x86_64"];
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

async function get(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "overcrow-mcp-pin" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function npmDist(name, version) {
  const body = await get(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
  if (!body) throw new Error(`${name}@${version} is not on npm`);
  const dist = JSON.parse(body.toString("utf8")).dist ?? {};
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity ?? ""))
    throw new Error(`${name}@${version}: no sha512 integrity`);
  return dist;
}

async function npmIntegrity(name, version) {
  return (await npmDist(name, version)).integrity;
}

// The SHA-256 of the files tsc runs (src/typescript.ts), read from the
// tarball once its npm integrity is checked.
const TYPESCRIPT_FILES = ["lib/tsc.js", "lib/_tsc.js"];

async function typescriptPin(version) {
  const { integrity, tarball } = await npmDist("typescript", version);
  if (!/^https:\/\/registry\.npmjs\.org\//.test(tarball ?? ""))
    throw new Error("typescript: tarball URL");
  const archive = await get(tarball);
  if (!archive || `sha512-${createHash("sha512").update(archive).digest("base64")}` !== integrity)
    throw new Error(`typescript@${version}: the tarball does not match its integrity`);
  const tar = gunzipSync(archive);
  const files = {};
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const field = (start, end) =>
      header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "");
    const name = `${field(345, 500) ? `${field(345, 500)}/` : ""}${field(0, 100)}`;
    if (!name) break;
    const size = Number.parseInt(field(124, 136).trim() || "0", 8);
    const path = name.replace(/^package\//, "");
    if (TYPESCRIPT_FILES.includes(path)) {
      files[path] = createHash("sha256")
        .update(tar.subarray(offset + 512, offset + 512 + size))
        .digest("hex");
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (TYPESCRIPT_FILES.some((file) => !files[file]))
    throw new Error(`typescript@${version}: ${TYPESCRIPT_FILES.join(" or ")} missing`);
  return {
    version,
    integrity,
    files: Object.fromEntries(TYPESCRIPT_FILES.map((file) => [file, files[file]])),
  };
}

/**
 * The SDK version on npm: sdk/package.json's, or, while its changelog
 * section says "Not released yet", the section before it.
 */
function releasedSdk() {
  const current = JSON.parse(readFileSync(join(repository, "sdk", "package.json"), "utf8")).version;
  const changelog = readFileSync(join(repository, "sdk", "CHANGELOG.md"), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const [first, previous] = [...changelog.matchAll(/^## (\S+)\n\n([^\n]*)/gm)];
  if (first?.[1] !== current)
    throw new Error("the SDK changelog's first section is not its version");
  if (!first[2].startsWith("Not released yet")) return current;
  if (!previous) throw new Error("no released SDK in the changelog");
  return previous[1];
}

/** The pin of `version`, from its published release.json; null when not published. */
async function pinOf(version) {
  if (!VERSION.test(version)) throw new Error(`not a release version: ${version}`);
  const body = await get(`${RELEASES}/v${version}/release.json`);
  if (!body) return null;
  const manifest = JSON.parse(body.toString("utf8"));
  if (manifest.version !== version || typeof manifest.creatorTools !== "object") {
    throw new Error(`release.json of ${version} has no creatorTools entry`);
  }
  const tools = {};
  for (const platform of PLATFORMS) {
    const entry = manifest.creatorTools[platform];
    const name = `overcrow-creator-tools-${version}-${platform}.zip`;
    if (entry?.name !== name || entry.url !== `${RELEASES}/v${version}/${name}`)
      throw new Error(`${platform}: unexpected ZIP`);
    if (
      !Number.isSafeInteger(entry.size) ||
      !HEX64.test(entry.sha256) ||
      !Array.isArray(entry.files)
    ) {
      throw new Error(`${platform}: malformed entry`);
    }
    tools[platform] = {
      name: entry.name,
      size: entry.size,
      sha256: entry.sha256,
      files: entry.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    };
  }
  const sdk = releasedSdk();
  const typescript = JSON.parse(
    readFileSync(join(repository, "templates", "shared", "package.json"), "utf8"),
  ).devDependencies.typescript;
  return {
    release: version,
    tools,
    npm: {
      "@overcrow/sdk": { version: sdk, integrity: await npmIntegrity("@overcrow/sdk", sdk) },
      typescript: await typescriptPin(typescript),
    },
  };
}

const argument = process.argv[2];
if (argument === "--check") {
  const committed = JSON.parse(readFileSync(pinPath, "utf8"));
  if (committed.release === null) {
    console.log("pin: no release pinned yet (a publication would be refused)");
    process.exit(3);
  }
  const live = await pinOf(committed.release);
  if (!live) {
    console.log(`pin: OverCrow ${committed.release} is not published yet`);
    process.exit(3);
  }
  const { note: _, ...pinned } = committed;
  if (JSON.stringify(pinned) !== JSON.stringify(live)) {
    console.error(
      `pin: src/bootstrap/pin.json differs from the published release ${committed.release}`,
    );
    process.exit(1);
  }
  for (const platform of PLATFORMS) {
    const { name, size, sha256 } = live.tools[platform];
    const zip = await get(`${RELEASES}/v${live.release}/${name}`);
    const digest = zip ? createHash("sha256").update(zip).digest("hex") : null;
    if (!zip || zip.length !== size || digest !== sha256) {
      console.error(`pin: ${name} does not download with the pinned size and SHA-256`);
      process.exit(1);
    }
  }
  console.log(
    `pin: OverCrow ${live.release}; both ZIPs match (${PLATFORMS.map((p) => live.tools[p].sha256.slice(0, 12)).join(", ")})`,
  );
} else if (argument && VERSION.test(argument)) {
  const pin = await pinOf(argument);
  if (!pin) {
    console.error(`OverCrow ${argument} is not published (no release.json)`);
    process.exit(3);
  }
  writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
  console.log(
    `pinned OverCrow ${argument} in src/bootstrap/pin.json; raise package.json's version and src/version.ts`,
  );
} else {
  console.error("usage: node scripts/pin-release.mjs <version> | --check");
  process.exit(2);
}
