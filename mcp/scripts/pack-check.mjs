// Packs @overcrow/mcp twice from clean builds and requires byte-identical
// tarballs that hold only the published files, in mode 644 (the bin 755),
// under a size bound. With --release, the package must also pin a published
// release of the creator tools. Nothing is published.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const release = process.argv.includes("--release");
const MAX_TARBALL_BYTES = 1536 * 1024;
const scratch = mkdtempSync(join(tmpdir(), "overcrow-mcp-pack-"));

function pack(index) {
  const destination = join(scratch, String(index));
  mkdirSync(destination);
  const output = execFileSync(npm, ["pack", "--json", "--pack-destination", destination, "--foreground-scripts"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const [result] = JSON.parse(output.slice(output.indexOf("[")));
  const bytes = readFileSync(join(destination, result.filename));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    files: result.files.map((file) => file.path).sort(),
    modes: result.files.map((file) => [file.path, file.mode]),
  };
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.publishConfig?.access !== "public") throw new Error('package.json must set publishConfig.access to "public"');
const pin = JSON.parse(readFileSync(join(root, "src", "bootstrap", "pin.json"), "utf8"));
if (release && pin.release === null) {
  throw new Error("src/bootstrap/pin.json pins no release: run scripts/pin-release.mjs <version> first");
}

const PUBLISHED =
  /^(dist\/[\w/.-]+\.js|dist\/bootstrap\/pin\.json|dist\/content\/[\w/.-]+\.(md|json|ts|mjs|ocml|ocss)|dist\/content\/(examples|templates)\/[\w.-]+\/(LICENSE|[\w/.-]+)|README\.md|LICENSE|package\.json|npm-shrinkwrap\.json)$/;
try {
  const first = pack(1);
  const second = pack(2);
  if (first.sha256 !== second.sha256) throw new Error(`npm pack is not reproducible: ${first.sha256} != ${second.sha256}`);
  const unexpected = first.files.filter((file) => !PUBLISHED.test(file) || file.endsWith(".map"));
  const required = ["dist/index.js", "dist/bootstrap/pin.json", "dist/content/index.json", "npm-shrinkwrap.json", "LICENSE", "README.md"];
  const missing = required.filter((file) => !first.files.includes(file));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`unexpected package content: ${unexpected.join(", ")}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
  }
  const badModes = first.modes.filter(([path, mode]) => mode !== (path === "dist/index.js" ? 0o755 : 0o644));
  if (badModes.length > 0) {
    throw new Error(`package files must be mode 644 (dist/index.js 755): ${badModes.map(([p, m]) => `${p} (${m.toString(8)})`).join(", ")}`);
  }
  if (first.size > MAX_TARBALL_BYTES) throw new Error(`the tarball is ${first.size} bytes, over ${MAX_TARBALL_BYTES}`);
  console.log(
    `reproducible: ${first.sha256} (${first.size} bytes, ${first.files.length} files); pin: ${pin.release ?? "none yet (refused with --release)"}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
