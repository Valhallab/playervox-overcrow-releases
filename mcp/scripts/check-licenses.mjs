// Licenses of every package in npm-shrinkwrap.json against the licenses the
// repository accepts (deny.toml, [licenses] allow), and the runtime
// dependencies against the reviewed list: adding one is a decision, made
// here with its reason.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Runtime packages, each with why it is there. */
export const RUNTIME = {
  "@modelcontextprotocol/server": "the official MCP SDK (server, stdio, both protocol eras)",
  "@modelcontextprotocol/core": "the SDK's protocol core, required by the server package",
  zod: "the input and output schemas of the tools, required by the SDK",
};

const deny = readFileSync(join(root, "..", "deny.toml"), "utf8");
const allowBlock = /\[licenses\][\s\S]*?allow = \[([\s\S]*?)\]/.exec(deny)?.[1] ?? "";
const allowed = new Set([...allowBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
if (allowed.size < 5) throw new Error("cannot read the accepted licenses of deny.toml");

/** An SPDX expression of OR/AND (no parentheses) satisfied by the accepted licenses. */
function accepted(expression) {
  if (typeof expression !== "string" || expression.includes("(")) return false;
  return expression
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((license) => allowed.has(license.trim())),
    );
}

const lock = JSON.parse(readFileSync(join(root, "npm-shrinkwrap.json"), "utf8"));
const problems = [];
const runtime = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path === "") continue;
  const name = path.replace(/^.*node_modules\//, "");
  if (!accepted(entry.license))
    problems.push(
      `${name} ${entry.version}: license ${entry.license ?? "unknown"} is not accepted`,
    );
  if (!entry.dev) runtime.push(name);
  if (entry.hasInstallScript && !entry.dev)
    problems.push(`${name}: runtime package with an install script`);
  if (
    !entry.resolved?.startsWith("https://registry.npmjs.org/") ||
    !entry.integrity?.startsWith("sha512-")
  ) {
    problems.push(`${name}: not resolved from registry.npmjs.org with an integrity`);
  }
}
const expected = Object.keys(RUNTIME).sort();
if (JSON.stringify(runtime.sort()) !== JSON.stringify(expected)) {
  problems.push(
    `runtime packages are ${runtime.join(", ")}; reviewed list: ${expected.join(", ")}`,
  );
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const [name, range] of Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})) {
  if (!/^\d+\.\d+\.\d+$/.test(range)) problems.push(`${name}: version ${range} is not exact`);
}
if (manifest.scripts?.postinstall || manifest.scripts?.install || manifest.scripts?.preinstall) {
  problems.push("package.json has an install script");
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `licenses: ${Object.keys(lock.packages).length - 1} packages accepted; runtime: ${runtime
    .map((name) => `${name} (${lock.packages[`node_modules/${name}`].license})`)
    .join(", ")}`,
);
