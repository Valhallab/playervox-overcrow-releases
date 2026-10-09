// Installs the creator tools of one platform from a ZIP whose SHA-256 is the
// pinned one: every file is extracted by the strict reader and checked
// against the pin, the ZIP's own SHA256SUMS, cli.json and runtimes.json must
// agree, and the CLI must pin exactly the runtime beside it. The files land
// in a private temporary directory that is renamed into place at the end;
// on any failure nothing is kept. Nothing goes on the PATH.

import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Platform } from "../env.js";
import type { PinnedTools } from "./pin.js";
import { extractEntry, readEntries } from "./zip.js";

export interface InstalledTools {
  release: string;
  platform: Platform;
  directory: string;
  cli: string;
  runtime: string;
  cliVersion: string;
  runtimeSha256: string;
}

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/** Runs `<cli> --version --format json` and returns its parsed output. */
export type VersionProbe = (cli: string, cwd: string) => Promise<unknown>;

const ZIP_LIMITS = { maxEntries: 64, maxEntryBytes: 256 << 20, maxTotalBytes: 512 << 20 };
const MAX_METADATA_BYTES = 64 * 1024;

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function executableSuffix(platform: Platform): string {
  return platform === "windows-x86_64" ? ".exe" : "";
}

/** The file names of a creator tools ZIP, derived from the pin's file list. */
export function toolNames(release: string, platform: Platform, names: readonly string[]) {
  const licenses = names
    .map(
      (name) => /^overcrow-widget-(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)-LICENSE\.txt$/.exec(name)?.[1],
    )
    .filter((version): version is string => version !== undefined);
  if (licenses.length !== 1)
    throw new InstallError("the creator tools do not hold exactly one CLI");
  const cliVersion = licenses[0] as string;
  const suffix = executableSuffix(platform);
  const expected = {
    cli: `overcrow-widget-${cliVersion}-${platform}${suffix}`,
    cliLicense: `overcrow-widget-${cliVersion}-LICENSE.txt`,
    cliNotices: `overcrow-widget-${cliVersion}-THIRD-PARTY-NOTICES.md`,
    runtime: `overcrow-widget-headless-${release}-${platform}${suffix}`,
    runtimeLicense: `overcrow-widget-headless-${release}-LICENSE.md`,
  };
  const all = new Set([
    ...Object.values(expected),
    "cli.json",
    "runtimes.json",
    "README.txt",
    "SHA256SUMS",
  ]);
  if (all.size !== names.length || !names.every((name) => all.has(name))) {
    throw new InstallError("the creator tools have missing or unexpected files");
  }
  return { cliVersion, ...expected };
}

/**
 * Checks `archive` against `pinned` and returns its files by name. The
 * SHA-256 of the whole archive is checked before any byte is parsed.
 */
export function verifyArchive(archive: Buffer, pinned: PinnedTools): Map<string, Buffer> {
  if (archive.length !== pinned.size || sha256(archive) !== pinned.sha256) {
    throw new InstallError("the creator tools ZIP is not the pinned one (size or SHA-256 differs)");
  }
  const root = pinned.name.replace(/\.zip$/, "");
  const entries = readEntries(archive, ZIP_LIMITS);
  const expected = new Map(pinned.files.map((file) => [file.path, file]));
  if (entries.length !== expected.size)
    throw new InstallError("the creator tools ZIP has another file list than the pin");
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const pin = expected.get(entry.name);
    if (!pin || entry.size !== pin.size)
      throw new InstallError(`unexpected file in the creator tools ZIP: ${entry.name}`);
    const data = extractEntry(archive, entry);
    if (sha256(data) !== pin.sha256)
      throw new InstallError(`a file of the creator tools ZIP differs from the pin: ${entry.name}`);
    files.set(entry.name.slice(root.length + 1), data);
  }
  return files;
}

function parseJson(data: Buffer | undefined, name: string): Record<string, unknown> {
  if (!data || data.length > MAX_METADATA_BYTES)
    throw new InstallError(`${name} is missing or too large`);
  try {
    const value: unknown = JSON.parse(data.toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new InstallError(`${name} is not a JSON object`);
}

/**
 * The checks between the files of the ZIP: SHA256SUMS lists every other
 * file with its digest, runtimes.json describes the runtime, and cli.json
 * describes the CLI and pins that same runtime.
 */
export function crossCheck(files: Map<string, Buffer>, release: string, platform: Platform) {
  const names = toolNames(release, platform, [...files.keys()]);
  const sums = files.get("SHA256SUMS")?.toString("utf8") ?? "";
  const listed = new Map<string, string>();
  for (const line of sums.split("\n")) {
    if (line === "") continue;
    const match = /^([0-9a-f]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._+-]*)$/.exec(line);
    if (!match || listed.has(match[2] as string)) throw new InstallError("SHA256SUMS is malformed");
    listed.set(match[2] as string, match[1] as string);
  }
  for (const [name, data] of files) {
    if (name === "SHA256SUMS") continue;
    if (listed.get(name) !== sha256(data))
      throw new InstallError(`SHA256SUMS does not match ${name}`);
  }
  if (listed.size !== files.size - 1)
    throw new InstallError("SHA256SUMS lists files that are not in the ZIP");

  const cliData = files.get(names.cli) as Buffer;
  const runtimeData = files.get(names.runtime) as Buffer;
  const runtimeSha = sha256(runtimeData);
  const runtimes = parseJson(files.get("runtimes.json"), "runtimes.json");
  const runtimeEntry = (runtimes.runtimes as Record<string, Record<string, unknown>> | undefined)?.[
    `headless-${platform}`
  ];
  if (
    runtimes.version !== release ||
    runtimeEntry?.name !== names.runtime ||
    runtimeEntry?.sha256 !== runtimeSha ||
    runtimeEntry?.size !== runtimeData.length
  ) {
    throw new InstallError("runtimes.json does not describe the runtime of the ZIP");
  }
  const cli = parseJson(files.get("cli.json"), "cli.json");
  const runtimePin = cli.runtime as
    | { version?: unknown; sha256?: Record<string, unknown> }
    | undefined;
  const cliFiles = Array.isArray(cli.files) ? (cli.files as Record<string, unknown>[]) : [];
  const cliEntry = cliFiles.find((file) => file.name === names.cli);
  if (
    cli.version !== names.cliVersion ||
    runtimePin?.version !== release ||
    runtimePin.sha256?.[platform] !== runtimeSha ||
    cliEntry?.sha256 !== sha256(cliData) ||
    cliEntry?.size !== cliData.length
  ) {
    throw new InstallError("cli.json does not describe this CLI, or pins another runtime");
  }
  return { ...names, runtimeSha256: runtimeSha };
}

/** Creates the cache root (0700) and refuses a link in its place. */
export async function prepareCacheRoot(cacheRoot: string): Promise<void> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(cacheRoot);
  if (!info.isDirectory()) throw new InstallError("the tools cache is not a plain directory");
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    info.uid !== process.getuid()
  ) {
    throw new InstallError("the tools cache belongs to another user");
  }
}

async function writeDurably(path: string, data: Buffer, mode: number): Promise<void> {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function installDirectory(cacheRoot: string, release: string, platform: Platform): string {
  return join(cacheRoot, `${release}-${platform}`);
}

/**
 * Installs `archive` (already read in memory) into the cache. Returns the
 * installed tools; if another server installed the same release meanwhile,
 * its copy is checked and used.
 */
export async function install(
  archive: Buffer,
  pinned: PinnedTools,
  release: string,
  platform: Platform,
  cacheRoot: string,
  probe: VersionProbe,
): Promise<InstalledTools> {
  const files = verifyArchive(archive, pinned);
  const names = crossCheck(files, release, platform);
  await prepareCacheRoot(cacheRoot);
  const working = await mkdtemp(join(cacheRoot, ".install-"));
  try {
    for (const [name, data] of files) {
      const executable = name === names.cli || name === names.runtime;
      await writeDurably(join(working, name), data, executable ? 0o755 : 0o644);
    }
    await syncDirectory(working);
    await checkVersion(join(working, names.cli), working, release, platform, names, probe);
    const final = installDirectory(cacheRoot, release, platform);
    try {
      await rename(working, final);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "EPERM") throw error;
      // Another server finished first: use its copy once checked.
      const existing = await loadInstalled(pinned, release, platform, cacheRoot);
      if (existing) return existing;
      // A damaged copy of our own cache: set it aside, then take its place.
      const damaged = `${final}.damaged-${randomBytes(4).toString("hex")}`;
      await rename(final, damaged);
      await rm(damaged, { recursive: true, force: true });
      await rename(working, final);
    }
    await syncDirectory(cacheRoot);
    return {
      release,
      platform,
      directory: final,
      cli: join(final, names.cli),
      runtime: join(final, names.runtime),
      cliVersion: names.cliVersion,
      runtimeSha256: names.runtimeSha256,
    };
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}

async function checkVersion(
  cli: string,
  cwd: string,
  release: string,
  platform: Platform,
  names: { cliVersion: string; runtimeSha256: string },
  probe: VersionProbe,
): Promise<void> {
  const report = (await probe(cli, cwd)) as {
    version?: unknown;
    apiVersion?: unknown;
    runtime?: { version?: unknown; sha256?: Record<string, unknown> };
  };
  if (
    report?.version !== names.cliVersion ||
    report.apiVersion !== 1 ||
    report.runtime?.version !== release ||
    report.runtime.sha256?.[platform] !== names.runtimeSha256
  ) {
    throw new InstallError("the CLI does not report the version and runtime of its ZIP");
  }
}

/**
 * The installed tools of the pinned release, after checking every file
 * against the pin again; undefined when they are absent or damaged.
 */
export async function loadInstalled(
  pinned: PinnedTools,
  release: string,
  platform: Platform,
  cacheRoot: string,
): Promise<InstalledTools | undefined> {
  const directory = installDirectory(cacheRoot, release, platform);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory()) return undefined;
    const root = pinned.name.replace(/\.zip$/, "");
    const expected = new Map(pinned.files.map((file) => [file.path.slice(root.length + 1), file]));
    const present = await readdir(directory);
    if (present.length !== expected.size) return undefined;
    for (const name of present) {
      const pin = expected.get(name);
      if (!pin) return undefined;
      const path = join(directory, name);
      const fileInfo = await lstat(path);
      if (!fileInfo.isFile() || fileInfo.size !== pin.size) return undefined;
      if (sha256(await readFile(path)) !== pin.sha256) return undefined;
    }
    const names = toolNames(release, platform, present);
    return {
      release,
      platform,
      directory,
      cli: join(directory, names.cli),
      runtime: join(directory, names.runtime),
      cliVersion: names.cliVersion,
      runtimeSha256: (expected.get(names.runtime) as { sha256: string }).sha256,
    };
  } catch {
    return undefined;
  }
}

/** A fresh, private path for a download in the cache root. */
export function downloadPath(cacheRoot: string): string {
  return join(cacheRoot, `.download-${randomBytes(8).toString("hex")}.zip`);
}
