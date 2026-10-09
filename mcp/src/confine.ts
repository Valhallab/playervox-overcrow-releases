// Where the server may act: the roots (folders given with --root, or the
// client's roots, or the working directory) and the paths inside them.
// Every path is resolved through its real location: a link that leads out
// of a root is refused like any outside path. System folders, a disk's root
// and the home folder itself are never roots; hidden folders and
// node_modules inside a root are never targets.

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDirectory, windowsSystemDirectories } from "./env.js";

export class ConfinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfinementError";
  }
}

export interface Root {
  /** Real path of the folder. */
  path: string;
  /** How results name it: `.` for a single root, else its folder name. */
  label: string;
}

const WINDOWS = process.platform === "win32";
const POSIX_SYSTEM = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/run",
  "/sbin",
  "/snap",
  "/srv",
  "/sys",
  "/usr",
  "/var/cache",
  "/var/lib",
  "/var/log",
  "/System",
  "/Library",
  "/Applications",
  "/private/etc",
  "/private/var/db",
];
const POSIX_EXACT = [
  "/tmp",
  "/var",
  "/var/tmp",
  "/home",
  "/Users",
  "/opt",
  "/mnt",
  "/media",
  "/private",
  "/root",
];

function samePath(a: string, b: string): boolean {
  return WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `child` is `parent` or inside it. */
export function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  if (path === "") return true;
  return !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Why `path` (a real path) cannot be a root, or undefined when it can. */
export async function rootRefusal(path: string): Promise<string | undefined> {
  if (samePath(parse(path).root, path)) return "it is the root of a disk";
  const home = await realOrSelf(homeDirectory());
  if (samePath(home, path)) return "it is your whole home folder";
  if (WINDOWS) {
    if (samePath(dirname(home), path)) return "it is the folder of every user";
    for (const system of windowsSystemDirectories()) {
      const real = await realOrSelf(system);
      if (isInside(real, path) || isInside(system, path)) return "it is a system folder";
    }
    return undefined;
  }
  if (isInside(home, path)) return undefined;
  if (POSIX_EXACT.some((system) => samePath(system, path))) return "it is a system folder";
  if (POSIX_SYSTEM.some((system) => isInside(system, path))) return "it is a system folder";
  return undefined;
}

/** Checks a candidate root and returns its real path. */
export async function checkRoot(candidate: string): Promise<string> {
  const absolute = resolve(candidate);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new ConfinementError(`The folder ${candidate} does not exist.`);
  }
  if (!(await lstat(real)).isDirectory())
    throw new ConfinementError(`${candidate} is not a folder.`);
  const refusal = await rootRefusal(real);
  if (refusal) {
    throw new ConfinementError(
      `The server cannot work in ${real}: ${refusal}. Open a project folder, or start the server with --root <your widgets folder>.`,
    );
  }
  return real;
}

/** The local path of a client root (`file://` URIs only). */
export function rootUriToPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}

/** Labels the roots: `.` when there is one, else each folder's name. */
export function labelRoots(paths: readonly string[]): Root[] {
  if (paths.length === 1) return [{ path: paths[0] as string, label: "." }];
  const seen = new Map<string, number>();
  return paths.map((path) => {
    const name = basename(path) || path;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return { path, label: count === 1 ? name : `${name}-${count}` };
  });
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse them
const UNSAFE_INPUT = /[\u0000-\u001f\u007f]/;

export type Target = "directory" | "file" | "new-directory";

/** Paths inside the roots. */
export class Confinement {
  constructor(readonly roots: readonly Root[]) {}

  /** The path as results show it: relative to its root, with `/`. */
  display(path: string): string {
    for (const root of this.roots) {
      if (isInside(root.path, path)) {
        const inside = relative(root.path, path).split(sep).join("/");
        if (root.label === ".") return inside === "" ? "." : inside;
        return inside === "" ? root.label : `${root.label}/${inside}`;
      }
    }
    return "<outside the project>";
  }

  /**
   * Resolves `input` (relative to the first root, or absolute inside a
   * root) to a real path inside a root, and checks what it must be.
   */
  async resolve(input: string, target: Target): Promise<string> {
    if (this.roots.length === 0) throw new ConfinementError("No project folder is open.");
    if (input.length === 0 || input.length > 1024 || UNSAFE_INPUT.test(input)) {
      throw new ConfinementError("The path is empty, too long, or holds control characters.");
    }
    if (WINDOWS && (/^[\\/]{2}/.test(input) || /:/.test(input.replace(/^[A-Za-z]:/, "")))) {
      throw new ConfinementError("Network paths, device paths and alternate streams are refused.");
    }
    const first = this.roots[0] as Root;
    const absolute = isAbsolute(input) ? resolve(input) : resolve(first.path, input);
    // Labelled roots: `<label>/rest` names a path in that root.
    const labelled = this.labelledPath(input);
    const wanted = labelled ?? absolute;
    const real = await this.realLocation(wanted);
    const root = this.roots.find((candidate) => isInside(candidate.path, real));
    if (!root) {
      throw new ConfinementError(
        `${input} is outside the project folders the server may use (${this.roots.map((r) => r.label).join(", ")}).`,
      );
    }
    const inside = relative(root.path, real);
    const parts = inside === "" ? [] : inside.split(sep);
    for (const part of parts) {
      if (part.startsWith(".")) throw new ConfinementError("Hidden folders and files are refused.");
      if (part === "node_modules") throw new ConfinementError("node_modules is refused.");
      if (WINDOWS && /[. ]$/.test(part))
        throw new ConfinementError("A name ending with a dot or a space is refused.");
    }
    await this.checkTarget(real, target, root, input);
    return real;
  }

  private labelledPath(input: string): string | undefined {
    if (this.roots.length < 2 || isAbsolute(input)) return undefined;
    const [head, ...rest] = input.split(/[\\/]/);
    const root = this.roots.find((candidate) => candidate.label === head);
    return root ? resolve(root.path, ...rest) : undefined;
  }

  /** The real path of `path`, or of its deepest existing parent plus the rest. */
  private async realLocation(path: string): Promise<string> {
    const missing: string[] = [];
    let current = path;
    for (;;) {
      try {
        const real = await realpath(current);
        return missing.length === 0 ? real : join(real, ...missing.reverse());
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "ENOENT" && code !== "ENOTDIR")
          throw new ConfinementError(`${path} cannot be read.`);
        const parent = dirname(current);
        if (parent === current) throw new ConfinementError(`${path} cannot be resolved.`);
        missing.push(basename(current));
        current = parent;
      }
    }
  }

  private async checkTarget(
    real: string,
    target: Target,
    root: Root,
    input: string,
  ): Promise<void> {
    let info: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      info = await lstat(real);
    } catch {
      info = undefined;
    }
    if (target === "new-directory") {
      if (samePath(real, root.path))
        throw new ConfinementError("Create the widget in a new folder inside the project.");
      if (info && !info.isDirectory())
        throw new ConfinementError(`${input} exists and is not a folder.`);
      return;
    }
    if (!info) throw new ConfinementError(`${input} does not exist.`);
    if (target === "directory" && !info.isDirectory())
      throw new ConfinementError(`${input} is not a folder.`);
    if (target === "file" && !info.isFile()) throw new ConfinementError(`${input} is not a file.`);
  }
}
