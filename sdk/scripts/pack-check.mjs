// Packs the SDK twice from clean builds and requires byte-identical
// tarballs holding only the published files. Nothing is published.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const scratch = mkdtempSync(join(tmpdir(), "overcrow-sdk-pack-"));

function pack(index) {
  const destination = join(scratch, String(index));
  mkdirSync(destination);
  const output = execFileSync(
    npm,
    ["pack", "--json", "--pack-destination", destination, "--foreground-scripts"],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  );
  const [result] = JSON.parse(output.slice(output.indexOf("[")));
  const bytes = readFileSync(join(destination, result.filename));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    files: result.files.map((file) => file.path).sort(),
    modes: result.files.map((file) => [file.path, file.mode]),
  };
}

// A scoped package is restricted by default: its first publication would
// be refused without public access.
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.publishConfig?.access !== "public") {
  throw new Error("package.json must set publishConfig.access to \"public\"");
}

try {
  const first = pack(1);
  const second = pack(2);
  if (first.sha256 !== second.sha256) {
    throw new Error(`npm pack is not reproducible: ${first.sha256} != ${second.sha256}`);
  }
  const unexpected = first.files.filter(
    (file) => !/^(dist\/.+\.(js|d\.ts)|README\.md|LICENSE|package\.json)$/.test(file),
  );
  if (
    unexpected.length > 0 ||
    !first.files.includes("dist/index.d.ts") ||
    !first.files.includes("dist/testing/index.js")
  ) {
    throw new Error(`unexpected package content: ${unexpected.join(", ")}`);
  }
  // npm keeps each file's mode: a build under umask 077 would publish
  // files only their owner can read, and another tarball.
  const unreadable = first.modes.filter(([, mode]) => mode !== 0o644);
  if (unreadable.length > 0) {
    throw new Error(
      `package files must be mode 644: ${unreadable
        .map(([path, mode]) => `${path} (${mode.toString(8)})`)
        .join(", ")}`,
    );
  }
  console.log(`reproducible: ${first.sha256} (${first.size} bytes, ${first.files.length} files)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
