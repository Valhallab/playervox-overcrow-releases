// The only module that reads the environment: the platform, the cache
// directory, the proxy, and the small environment handed to child
// processes. Nothing secret (tokens, keys, npm credentials) is ever passed
// on.

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Platform = "linux-x86_64" | "windows-x86_64";

/** The platform of the creator tools, or why there are none for this machine. */
export function toolsPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { platform: Platform } | { unsupported: string } {
  if (arch === "x64" && platform === "linux") return { platform: "linux-x86_64" };
  if (arch === "x64" && platform === "win32") return { platform: "windows-x86_64" };
  const system =
    platform === "darwin"
      ? "macOS"
      : platform === "win32"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : platform;
  return {
    unsupported: `The OverCrow creator tools run on Windows x64 and Linux x86-64; this computer is ${system} ${arch}. You can still read the documentation and audit a widget here; checking, testing and packaging need a Windows or Linux x64 computer.`,
  };
}

/** Reads one variable; on Windows the names are case-insensitive already. */
function variable(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The directory where the creator tools are kept:
 * `$XDG_CACHE_HOME/overcrow-mcp` (absolute only) or `~/.cache/overcrow-mcp`,
 * and `%LOCALAPPDATA%\overcrow-mcp` on Windows.
 */
export function cacheRoot(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === "win32") {
    const local = variable("LOCALAPPDATA");
    return local && isAbsolute(local) ? join(local, "overcrow-mcp") : undefined;
  }
  const xdg = variable("XDG_CACHE_HOME");
  if (xdg && isAbsolute(xdg)) return join(xdg, "overcrow-mcp");
  const home = variable("HOME") ?? homedir();
  return home && isAbsolute(home) ? join(home, ".cache", "overcrow-mcp") : undefined;
}

/** The proxy for HTTPS requests to `host`, if the environment names one. */
export function httpsProxy(host: string): string | undefined {
  const proxy =
    variable("HTTPS_PROXY") ??
    variable("https_proxy") ??
    variable("ALL_PROXY") ??
    variable("all_proxy");
  if (!proxy) return undefined;
  const noProxy = variable("NO_PROXY") ?? variable("no_proxy");
  if (noProxy && bypassesProxy(host, noProxy)) return undefined;
  return proxy;
}

/** `NO_PROXY` rules: `*`, exact names and domain suffixes (`.example.com` or `example.com`). */
export function bypassesProxy(host: string, noProxy: string): boolean {
  const name = host.toLowerCase();
  return noProxy
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter((entry) => entry.length > 0)
    .some((entry) => {
      if (entry === "*") return true;
      const domain = entry.startsWith(".") ? entry.slice(1) : entry;
      return name === domain || name.endsWith(`.${domain}`);
    });
}

const COMMON = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "LOCALAPPDATA",
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
] as const;

const NETWORK = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "npm_config_registry",
  "NPM_CONFIG_REGISTRY",
] as const;

/**
 * The environment of a child process: what a program needs to find its
 * files and temporary directory, and, for npm only, the proxy and registry
 * settings. Tokens and other variables of the user's session stay out.
 */
export function childEnvironment(options: { network: boolean }): NodeJS.ProcessEnv {
  const names: readonly string[] = options.network ? [...COMMON, ...NETWORK] : COMMON;
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = variable(name);
    if (value !== undefined) env[name] = value;
  }
  // The CLI never colors its output; npm would.
  env.NO_COLOR = "1";
  if (options.network) {
    env.npm_config_update_notifier = "false";
    env.npm_config_fund = "false";
    env.npm_config_audit = "false";
  }
  return env;
}

/** The user's home directory, for redaction and the root checks. */
export function homeDirectory(): string {
  return variable("HOME") ?? variable("USERPROFILE") ?? homedir();
}

/** Windows directories that are never a project. */
export function windowsSystemDirectories(): string[] {
  return [
    "SystemRoot",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "ProgramData",
    "windir",
  ]
    .map(variable)
    .filter((value): value is string => value !== undefined);
}

/** `%SystemRoot%`, for the full path of Windows' own programs. */
export function windowsSystemRoot(): string {
  return variable("SystemRoot") ?? variable("windir") ?? "C:\\Windows";
}
