// check, package and test type-check with the project's own TypeScript: the
// CLI runs node_modules/typescript/lib/tsc.js with Node.js. A project may
// come from someone else, so the server lets that run only when those files
// are the pinned TypeScript's: tsc.js loads _tsc.js, which only loads Node's
// own modules, and the pin holds the SHA-256 of both (pin.ts). Otherwise the
// commands run with --no-typecheck and say so.

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type PinnedTypeScript, TYPESCRIPT_FILES } from "./bootstrap/pin.js";

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Said when a command ran without type checking. */
export const TYPECHECK_SKIPPED =
  "Types were not checked: node_modules/typescript is not the TypeScript install_sdk installs. To check them, run install_sdk (delete node_modules first if it came with the project).";

/** Whether `directory` holds the pinned TypeScript, as plain files (no link on the way). */
export async function mayTypeCheck(pin: PinnedTypeScript, directory: string): Promise<boolean> {
  const folders = ["node_modules", "node_modules/typescript", "node_modules/typescript/lib"];
  try {
    for (const folder of folders) {
      if (!(await lstat(join(directory, folder))).isDirectory()) return false;
    }
    for (const file of TYPESCRIPT_FILES) {
      const path = join(directory, "node_modules", "typescript", file);
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return false;
      const digest = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      if (digest !== pin.files[file]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
