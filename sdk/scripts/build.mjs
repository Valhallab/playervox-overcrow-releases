// Builds dist/ from src/ with the pinned TypeScript, after removing the
// previous output so that a removed module never ships. Comments stay in
// the JavaScript: the `@__PURE__` annotations let the widget bundler drop
// unused namespaces, and its minifier removes the rest.
import { execFileSync } from "node:child_process";
import { chmodSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(import.meta.url).resolve("typescript/lib/tsc.js");
rmSync(join(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], { stdio: "inherit" });
// The test helper (`@overcrow/sdk/testing`) builds apart, under dist/testing/:
// no widget bundle ever reaches it.
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.testing.json")], { stdio: "inherit" });
// npm packs each file with its mode: make the output readable by all
// whatever the umask, so that the tarball is the same on every machine.
for (const entry of readdirSync(join(root, "dist"), { recursive: true, withFileTypes: true })) {
  chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644);
}
chmodSync(join(root, "dist"), 0o755);
