// The creator tools release this version of the package uses: its version
// and, for each platform, the ZIP's name, size and SHA-256 and every file
// in it (the `creatorTools` entry of the release's public release.json,
// copied by `scripts/pin-release.mjs`). Nothing else is ever downloaded.

import { readFileSync } from "node:fs";
import type { Platform } from "../env.js";

export interface PinnedFile {
  /** `<zip root>/<name>`, as in release.json. */
  path: string;
  size: number;
  sha256: string;
}

export interface PinnedTools {
  name: string;
  size: number;
  sha256: string;
  files: PinnedFile[];
}

export interface PinnedPackage {
  version: string;
  /** npm's `dist.integrity` of the published tarball. */
  integrity: string;
}

export interface Pin {
  /** OverCrow release version, e.g. `0.6.1-beta.1`; null before the release exists. */
  release: string | null;
  tools: Partial<Record<Platform, PinnedTools>>;
  /** The npm packages a widget project installs: the SDK and TypeScript. */
  npm: { sdk: PinnedPackage; typescript: PinnedPackage };
}

export const RELEASES_REPOSITORY = "Valhallab/playervox-overcrow-releases";
export const DOWNLOAD_HOSTS = [
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** The address of a pinned ZIP. */
export function toolsUrl(release: string, name: string, base = "https://github.com"): string {
  return `${base}/${RELEASES_REPOSITORY}/releases/download/v${release}/${name}`;
}

/** Checks the shape of a pin; throws on anything unexpected. */
export function validatePin(value: unknown): Pin {
  const fail = (why: string): never => {
    throw new Error(`invalid pin: ${why}`);
  };
  if (typeof value !== "object" || value === null) fail("not an object");
  const { release, tools, npm } = value as { release?: unknown; tools?: unknown; npm?: unknown };
  const packages = (npm ?? {}) as Record<string, unknown>;
  const pinnedPackage = (name: string): PinnedPackage => {
    const { version, integrity } = (packages[name] ?? {}) as Record<string, unknown>;
    if (typeof version !== "string" || !VERSION.test(version)) fail(`${name} version`);
    if (typeof integrity !== "string" || !INTEGRITY.test(integrity)) fail(`${name} integrity`);
    return { version: version as string, integrity: integrity as string };
  };
  const npmPins = { sdk: pinnedPackage("@overcrow/sdk"), typescript: pinnedPackage("typescript") };
  if (release === null) return { release: null, tools: {}, npm: npmPins };
  if (typeof release !== "string" || !VERSION.test(release)) fail("release version");
  if (typeof tools !== "object" || tools === null) fail("tools");
  const result: Pin = { release: release as string, tools: {}, npm: npmPins };
  for (const platform of ["linux-x86_64", "windows-x86_64"] as const) {
    const entry = (tools as Record<string, unknown>)[platform];
    if (typeof entry !== "object" || entry === null) fail(`missing ${platform}`);
    const { name, size, sha256, files } = entry as Record<string, unknown>;
    const root = `overcrow-creator-tools-${release}-${platform}`;
    if (name !== `${root}.zip`) fail(`${platform} name`);
    if (!Number.isSafeInteger(size) || (size as number) <= 0) fail(`${platform} size`);
    if (typeof sha256 !== "string" || !HEX64.test(sha256)) fail(`${platform} digest`);
    if (!Array.isArray(files) || files.length === 0 || files.length > 64) fail(`${platform} files`);
    const checked: PinnedFile[] = [];
    for (const file of files as unknown[]) {
      const { path, size: fileSize, sha256: fileSha } = (file ?? {}) as Record<string, unknown>;
      if (
        typeof path !== "string" ||
        !path.startsWith(`${root}/`) ||
        !FILE_NAME.test(path.slice(root.length + 1))
      ) {
        fail(`${platform} file path`);
      }
      if (!Number.isSafeInteger(fileSize) || (fileSize as number) <= 0)
        fail(`${platform} file size`);
      if (typeof fileSha !== "string" || !HEX64.test(fileSha)) fail(`${platform} file digest`);
      checked.push({ path: path as string, size: fileSize as number, sha256: fileSha as string });
    }
    result.tools[platform] = {
      name: name as string,
      size: size as number,
      sha256: sha256 as string,
      files: checked,
    };
  }
  return result;
}

/** The pin shipped with the package (`dist/pin.json`). */
export function shippedPin(): Pin {
  return validatePin(JSON.parse(readFileSync(new URL("./pin.json", import.meta.url), "utf8")));
}
