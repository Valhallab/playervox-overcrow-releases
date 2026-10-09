// Pins @overcrow/mcp to a published OverCrow release: copies the
// `creatorTools` entry of its release.json (each platform's ZIP and every
// file in it, with sizes and SHA-256) into src/bootstrap/pin.json, with the
// npm integrity of the SDK (sdk/package.json's version) and of the
// TypeScript of the templates.
//
//   node scripts/pin-release.mjs <version>    write the pin
//   node scripts/pin-release.mjs --check      the committed pin matches the
//                                             published release, and both
//                                             ZIPs download with its digests
//
// Exit status: 0 ok, 1 mismatch, 3 release not published (yet).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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

async function npmIntegrity(name, version) {
  const body = await get(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
  if (!body) throw new Error(`${name}@${version} is not on npm`);
  const integrity = JSON.parse(body.toString("utf8")).dist?.integrity;
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity ?? ""))
    throw new Error(`${name}@${version}: no sha512 integrity`);
  return integrity;
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
  const sdk = JSON.parse(readFileSync(join(repository, "sdk", "package.json"), "utf8")).version;
  const typescript = JSON.parse(
    readFileSync(join(repository, "templates", "shared", "package.json"), "utf8"),
  ).devDependencies.typescript;
  return {
    release: version,
    tools,
    npm: {
      "@overcrow/sdk": { version: sdk, integrity: await npmIntegrity("@overcrow/sdk", sdk) },
      typescript: { version: typescript, integrity: await npmIntegrity("typescript", typescript) },
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
