// The ZIP of a widget's sources, the file a creator sends to the OverCrow
// creator space (whose server rebuilds the package from it). It holds the
// widget folder minus what is never sent: hidden entries (.git, .env,
// .npmrc…), node_modules, dist, tests/output, links (never followed), built
// packages, key stores and system files. Each left-out entry is listed with
// its reason. The archive is deterministic (sorted names, fixed date,
// mode 644) and written atomically: a temporary file, then a rename.

import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

export interface SourceFile {
  /** Relative path with `/`. */
  path: string;
  bytes: number;
}

export interface Excluded {
  /** Relative path with `/`; folders end with `/`. */
  path: string;
  reason: string;
}

export interface Selection {
  included: SourceFile[];
  excluded: Excluded[];
  /** Why no ZIP can be made (a bound reached), or null. */
  problem: string | null;
}

export const MAX_SOURCE_FILES = 2000;
export const MAX_SOURCE_DEPTH = 8;
/** Sum of the files read. */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
/** The creator space takes an archive of 32 MB at most. */
export const MAX_ZIP_BYTES = 32_000_000;

const SKIPPED_FOLDERS: Record<string, string> = {
  node_modules: "installed packages: npm brings them back",
  dist: "build output: the creator space builds its own package",
};
const KEY_FILE =
  /\.(pem|key|p12|pfx|pk8|jks|keystore|kdbx|gpg|asc)$|^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i;
const SYSTEM_FILE = /^(thumbs\.db|desktop\.ini|ehthumbs\.db)$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse them
const NOT_PORTABLE = /[\u0000-\u001f\u007f<>:"\\|?*]|[ .]$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/** Why a file of the widget folder is left out, or undefined to keep it. */
function fileReason(name: string): string | undefined {
  if (/\.ocpkg$/i.test(name)) return "a built package: the creator space builds its own";
  if (KEY_FILE.test(name)) return "a key or a key store: never sent";
  if (SYSTEM_FILE.test(name)) return "a system file";
  if (NOT_PORTABLE.test(name) || WINDOWS_DEVICE.test(name))
    return 'a name that Windows cannot use (control characters, < > : " \\ | ? *, or a final dot or space): rename it to send it';
  return undefined;
}

/** The files of the widget folder `directory` (already confined) that the ZIP holds. */
export async function selectSources(directory: string): Promise<Selection> {
  const included: SourceFile[] = [];
  const excluded: Excluded[] = [];
  let total = 0;
  let problem: string | null = null;
  const walk = async (relative: string, depth: number): Promise<void> => {
    const entries = await readdir(relative ? join(directory, relative) : directory, {
      withFileTypes: true,
    });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (problem) return;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        excluded.push({ path, reason: "a link: links are never followed" });
      } else if (entry.isDirectory()) {
        const skipped = SKIPPED_FOLDERS[entry.name];
        if (entry.name.startsWith(".")) {
          excluded.push({ path: `${path}/`, reason: "a hidden folder" });
        } else if (skipped) {
          excluded.push({ path: `${path}/`, reason: skipped });
        } else if (path === "tests/output") {
          excluded.push({ path: `${path}/`, reason: "test output: test writes it again" });
        } else if (NOT_PORTABLE.test(entry.name) || WINDOWS_DEVICE.test(entry.name)) {
          excluded.push({ path: `${path}/`, reason: fileReason(entry.name) ?? "" });
        } else if (depth >= MAX_SOURCE_DEPTH) {
          problem = `${path}/ is more than ${MAX_SOURCE_DEPTH} folders deep: flatten the widget folder.`;
        } else {
          await walk(path, depth + 1);
        }
      } else if (!entry.isFile()) {
        excluded.push({ path, reason: "not a regular file" });
      } else if (entry.name.startsWith(".")) {
        excluded.push({
          path,
          reason: "a hidden file (such as .env or .npmrc, which often hold secrets)",
        });
      } else {
        const reason = fileReason(entry.name);
        if (reason) {
          excluded.push({ path, reason });
          continue;
        }
        const info = await lstat(join(directory, path));
        total += info.size;
        included.push({ path, bytes: info.size });
        if (included.length > MAX_SOURCE_FILES) {
          problem = `The widget folder holds more than ${MAX_SOURCE_FILES} files to send: remove the ones the widget does not need.`;
        } else if (total > MAX_SOURCE_BYTES) {
          problem = `The files to send weigh more than ${MAX_SOURCE_BYTES / 1048576} MiB: remove the large files the widget does not need.`;
        }
      }
    }
  };
  await walk("", 0);
  return { included, excluded, problem };
}

const DOS_DATE_1980_01_01 = (1 << 5) | 1;
const UTF8_NAMES = 1 << 11;
const VERSION_NEEDED = 20;
const MADE_BY_UNIX = (3 << 8) | VERSION_NEEDED;
const REGULAR_FILE_644 = (0o100644 << 16) >>> 0;

/** A deterministic ZIP of `entries` (already in their final order). */
export function buildZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(REGULAR_FILE_644, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Reads a selected file without following a link, if it is still as selected. */
async function readSelected(directory: string, file: SourceFile): Promise<Buffer | undefined> {
  // O_NOFOLLOW does not exist on Windows, where links were left out when selecting.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(join(directory, file.path), flags).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.bytes) return undefined;
    const data = await handle.readFile();
    return data.length === file.bytes ? data : undefined;
  } finally {
    await handle.close();
  }
}

export interface WrittenZip {
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * Writes the ZIP of `files` to `folder`/`name` (`folder` already confined),
 * or returns why it is not written.
 */
export async function writeSourcesZip(
  directory: string,
  files: readonly SourceFile[],
  folder: string,
  name: string,
): Promise<WrittenZip | { problem: string }> {
  const entries = [];
  for (const file of files) {
    const data = await readSelected(directory, file);
    if (!data)
      return {
        problem: `${file.path} changed while the ZIP was made: run prepare_submission again.`,
      };
    entries.push({ name: file.path, data });
  }
  const zip = buildZip(entries);
  if (zip.length > MAX_ZIP_BYTES) {
    return {
      problem: `The ZIP would weigh ${(zip.length / 1e6).toFixed(1)} MB, and the creator space takes 32 MB at most: shrink or remove large files.`,
    };
  }
  await mkdir(folder, { recursive: true });
  const destination = join(folder, name);
  const temporary = join(folder, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, zip, { flag: "wx", mode: 0o644 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path: destination,
    bytes: zip.length,
    sha256: createHash("sha256").update(zip).digest("hex"),
  };
}
