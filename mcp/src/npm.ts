// Installs the SDK and TypeScript in a widget project with npm, and only
// them: `npm install --ignore-scripts --save-dev --save-exact` of the
// pinned versions, then a check that the lockfile records the integrity of
// the published tarballs. npm runs as `node npm-cli.js` (no shell, no
// `.cmd`); a project that declares other packages or has its own `.npmrc`
// is refused rather than installed.

import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PinnedPackage } from "./bootstrap/pin.js";
import { childEnvironment } from "./env.js";
import { runProcess } from "./run.js";

export class NpmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NpmError";
  }
}

const MAX_PACKAGE_JSON_BYTES = 64 * 1024;
const MAX_LOCK_BYTES = 8 << 20;
const ALLOWED = new Set(["@overcrow/sdk", "typescript"]);
const OTHER_FIELDS = [
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "overrides",
  "workspaces",
];

/** npm's JavaScript entry point next to the running Node.js. */
export function findNpmCli(
  execPath = process.execPath,
  platform = process.platform,
): string | undefined {
  const directory = dirname(execPath);
  const candidates =
    platform === "win32"
      ? [join(directory, "node_modules", "npm", "bin", "npm-cli.js")]
      : [
          join(dirname(directory), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
          join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
        ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function readJsonFile(
  path: string,
  maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return undefined;
  }
  if (!info.isFile()) throw new NpmError(`${path.split(/[\\/]/).pop()} is not a plain file`);
  if (info.size > maxBytes) throw new NpmError(`${path.split(/[\\/]/).pop()} is too large`);
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new NpmError(`${path.split(/[\\/]/).pop()} is not valid JSON`);
}

/** What `install_sdk` would do in `directory`, or why it refuses. */
export async function planInstall(directory: string) {
  const manifest = await readJsonFile(join(directory, "package.json"), MAX_PACKAGE_JSON_BYTES);
  if (!manifest) {
    throw new NpmError(
      "package.json is missing: create the widget with create_widget, which writes one.",
    );
  }
  for (const name of ["node_modules", "package-lock.json"]) {
    const info = await lstat(join(directory, name)).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      throw new NpmError(
        `${name} is a link: npm would write outside the widget folder. Remove the link first.`,
      );
    }
  }
  if (existsSync(join(directory, ".npmrc"))) {
    throw new NpmError(
      "The project has its own .npmrc, which could change where npm downloads from: install the SDK yourself after checking it.",
    );
  }
  const others: string[] = [];
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = manifest[field];
    if (deps === undefined) continue;
    if (typeof deps !== "object" || deps === null)
      throw new NpmError(`package.json ${field} is not an object`);
    for (const name of Object.keys(deps)) if (!ALLOWED.has(name)) others.push(name);
  }
  for (const field of OTHER_FIELDS) if (manifest[field] !== undefined) others.push(`(${field})`);
  if (others.length > 0) {
    throw new NpmError(
      `package.json declares other packages (${others.slice(0, 8).join(", ")}). A widget's logic can only use @overcrow/sdk: remove them, or install them yourself.`,
    );
  }
}

/** Runs the install, then checks the lockfile against the pinned integrities. */
export async function installPackages(
  directory: string,
  pins: { sdk: PinnedPackage; typescript: PinnedPackage },
  signal?: AbortSignal,
) {
  await planInstall(directory);
  const npm = findNpmCli();
  if (!npm) {
    throw new NpmError(
      `npm was not found next to Node.js. Install the SDK yourself: npm install --ignore-scripts --save-dev --save-exact @overcrow/sdk@${pins.sdk.version} typescript@${pins.typescript.version}`,
    );
  }
  const env = childEnvironment({ network: true });
  const result = await runProcess(
    process.execPath,
    [
      npm,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-dev",
      "--save-exact",
      `@overcrow/sdk@${pins.sdk.version}`,
      `typescript@${pins.typescript.version}`,
    ],
    { cwd: directory, env, timeoutMs: 5 * 60_000, signal },
  );
  if (result.timedOut) throw new NpmError("npm took more than 5 minutes and was stopped.");
  if (result.cancelled) throw new NpmError("npm was cancelled.");
  if (result.code !== 0) {
    const reason = result.stderr
      .split("\n")
      .filter((line) => /npm (error|ERR!)/.test(line))
      .slice(0, 6)
      .join("\n");
    throw new NpmError(`npm install failed (exit ${result.code}).${reason ? `\n${reason}` : ""}`);
  }
  return verifyLock(directory, pins);
}

/** Checks that package-lock.json records the pinned versions and integrities. */
export async function verifyLock(
  directory: string,
  pins: { sdk: PinnedPackage; typescript: PinnedPackage },
) {
  const lock = await readJsonFile(join(directory, "package-lock.json"), MAX_LOCK_BYTES);
  const packages = (lock?.packages ?? {}) as Record<
    string,
    { version?: unknown; integrity?: unknown }
  >;
  const checks = [
    { name: "@overcrow/sdk", pin: pins.sdk },
    { name: "typescript", pin: pins.typescript },
  ].map(({ name, pin }) => {
    const entry = packages[`node_modules/${name}`];
    return {
      name,
      version: typeof entry?.version === "string" ? entry.version : null,
      expectedVersion: pin.version,
      integrityMatches: entry?.integrity === pin.integrity,
    };
  });
  const bad = checks.filter(
    (check) => check.version !== check.expectedVersion || !check.integrityMatches,
  );
  if (bad.length > 0) {
    throw new NpmError(
      `npm installed something other than the published packages (${bad.map((check) => check.name).join(", ")}): delete node_modules and package-lock.json, then try again.`,
    );
  }
  return checks;
}
