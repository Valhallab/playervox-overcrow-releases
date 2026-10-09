// A fingerprint of a widget's sources (paths, sizes and modification
// times; not the build outputs): prepare_submission compares it with the
// one taken when the tests last passed, to know whether they still stand.

import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

const SKIPPED = new Set(["node_modules", "dist"]);
const MAX_ENTRIES = 4000;

export async function sourcesFingerprint(directory: string): Promise<string> {
  const hash = createHash("sha256");
  let count = 0;
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (++count > MAX_ENTRIES) return;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name) || path === "tests/output")
        continue;
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const info = await lstat(join(directory, path));
        hash.update(`${path}\0${info.size}\0${info.mtimeMs}\n`);
      }
    }
  };
  await walk("");
  return hash.digest("hex");
}
