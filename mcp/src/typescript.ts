// check, package and test type-check with the project's own TypeScript: the
// CLI runs node_modules/typescript/lib/tsc.js with Node.js. A project may
// come from someone else, so the server lets that run only when install_sdk
// installed it: after npm's integrity check, install_sdk records the
// SHA-256 of the two files tsc runs (tsc.js loads _tsc.js, which only loads
// Node's own modules); a command type-checks only while both still match.

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { writeCacheFile } from "./bootstrap/install.js";

const FILES = ["tsc.js", "_tsc.js"] as const;
const STATE = "typescript-installs.json";
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_PROJECTS = 256;

/** Said when a command ran without type checking. */
export const TYPECHECK_SKIPPED =
  "Types were not checked: this project's TypeScript was not installed by install_sdk. To check them, run install_sdk.";

type Digests = Record<(typeof FILES)[number], string>;

/** The digests of the compiler files, or undefined if any is missing, a link or too large. */
async function digests(directory: string): Promise<Digests | undefined> {
  const folders = [
    join(directory, "node_modules"),
    join(directory, "node_modules", "typescript"),
    join(directory, "node_modules", "typescript", "lib"),
  ];
  try {
    for (const folder of folders) if (!(await lstat(folder)).isDirectory()) return undefined;
    const result = {} as Digests;
    for (const file of FILES) {
      const path = join(folders[2] as string, file);
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
      result[file] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    }
    return result;
  } catch {
    return undefined;
  }
}

async function readState(cacheRoot: string): Promise<Record<string, Digests>> {
  try {
    const path = join(cacheRoot, STATE);
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_STATE_BYTES) return {};
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, Digests>)
      : {};
  } catch {
    return {};
  }
}

/** After install_sdk: the project's TypeScript may run until its files change. */
export async function recordTypeScript(cacheRoot: string, directory: string): Promise<void> {
  const found = await digests(directory);
  if (!found) return;
  const state = await readState(cacheRoot);
  const key = await realpath(directory);
  delete state[key];
  const kept = Object.entries(state).slice(-(MAX_PROJECTS - 1));
  await writeCacheFile(
    cacheRoot,
    STATE,
    JSON.stringify(Object.fromEntries([...kept, [key, found]])),
  );
}

/** Whether check, package and test may run the project's TypeScript. */
export async function trustedTypeScript(cacheRoot: string, directory: string): Promise<boolean> {
  const found = await digests(directory);
  if (!found) return false;
  let key: string;
  try {
    key = await realpath(directory);
  } catch {
    return false;
  }
  const recorded = (await readState(cacheRoot))[key];
  return recorded !== undefined && FILES.every((file) => recorded[file] === found[file]);
}

/** Whether a command on `directory` may type-check, for a session's cache. */
export async function mayTypeCheck(
  cacheRoot: string | undefined,
  directory: string,
): Promise<boolean> {
  return cacheRoot !== undefined && (await trustedTypeScript(cacheRoot, directory));
}
