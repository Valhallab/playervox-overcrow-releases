// Builds dist/: the server compiled by the pinned TypeScript, its pin, and
// the content it serves without network access, taken from this revision
// of the repository: the creator documentation (EN and FR), the templates of
// `overcrow-widget init`, the reference widgets and the documentation's
// example projects (text files only), and reference tables derived from the
// generated regions of the documentation and from the SDK's limits. Every
// file is mode 644 (the bin 755) whatever the umask, so that the tarball is
// the same on every machine.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repository = join(root, "..");
const dist = join(root, "dist");
const content = join(dist, "content");
const MAX_EMBEDDED_BYTES = 64 * 1024;
const TEXT_FILE = /\.(json|ts|mjs|ocml|ocss|md)$|^LICENSE$/;

const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (
  !readFileSync(join(root, "src", "version.ts"), "utf8").includes(
    `export const VERSION = "${packageVersion}";`,
  )
) {
  throw new Error(`src/version.ts does not say ${packageVersion}, the version of package.json`);
}
rmSync(dist, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/lib/tsc.js");
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], { stdio: "inherit" });
copyFileSync(join(root, "src", "bootstrap", "pin.json"), join(dist, "bootstrap", "pin.json"));

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function readText(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/** Text files of a project directory, sorted, without tests' outputs, assets, images or hidden files. */
function projectFiles(directory) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "output", "reference", "assets"].includes(entry.name))
          continue;
        walk(path);
      } else if (entry.isFile() && TEXT_FILE.test(entry.name)) {
        if (lstatSync(path).size <= MAX_EMBEDDED_BYTES)
          out.push(relative(directory, path).split("\\").join("/"));
      }
    }
  };
  walk(directory);
  return out;
}

/** Image and asset names of a project, listed but not embedded. */
function assetNames(directory) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(current, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
        walk(path);
      else if (entry.isFile() && /\.(png|jpe?g|webp)$/.test(entry.name)) {
        out.push({
          path: relative(directory, path).split("\\").join("/"),
          bytes: lstatSync(path).size,
        });
      }
    }
  };
  walk(directory);
  return out;
}

// The documentation, as the website renders it.
const pages = JSON.parse(readText(join(repository, "docs", "content", "pages.json")));
const docs = [];
for (const page of pages.pages) {
  const entry = {
    slug: page.slug,
    file: page.file,
    group: page.group,
    label: page.label,
    titles: {},
  };
  for (const locale of pages.locales) {
    const markdown = readText(join(repository, "docs", "content", locale, page.file));
    write(join(content, "docs", locale, page.file), markdown);
    entry.titles[locale] = /^# (.+)$/m.exec(markdown)?.[1] ?? page.label[locale];
  }
  docs.push(entry);
}

// Projects: templates, reference widgets, documentation examples.
const projects = [];
const addProject = (kind, name, directory, extra = {}) => {
  const files = projectFiles(directory);
  for (const file of files) write(join(content, kind, name, file), readText(join(directory, file)));
  projects.push({ kind, name, files, images: assetNames(directory), ...extra });
};
for (const name of readdirSync(join(repository, "templates")).sort()) {
  addProject("templates", name, join(repository, "templates", name));
}
for (const name of readdirSync(join(repository, "widgets")).sort()) {
  const directory = join(repository, "widgets", name);
  const manifest = JSON.parse(readText(join(directory, "manifest.json")));
  addProject("examples", name, directory, {
    id: manifest.id,
    title: manifest.name.en,
    source: "widgets",
  });
}
for (const name of readdirSync(join(repository, "docs", "content", "examples")).sort()) {
  const directory = join(repository, "docs", "content", "examples", name);
  const manifest = JSON.parse(readText(join(directory, "manifest.json")));
  addProject("examples", name, directory, {
    id: manifest.id,
    title: manifest.name.en,
    source: "docs",
  });
}

// Reference tables, derived from the generated documentation.
function region(locale, file, name) {
  const markdown = readText(join(repository, "docs", "content", locale, file));
  const start = markdown.indexOf(`<!-- generated:${name} -->`);
  const end = markdown.indexOf(`<!-- /generated:${name} -->`);
  if (start < 0 || end < 0)
    throw new Error(`missing generated region ${name} in ${locale}/${file}`);
  return markdown.slice(start + `<!-- generated:${name} -->`.length, end).trim();
}

function tableRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

const plain = (cell) => cell.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
const codeOf = (cell) => /^`([^`]+)`$/.exec(cell)?.[1];

const permissions = { permissions: {}, capabilities: {} };
for (const locale of pages.locales) {
  for (const [name, meaning, sensitiveRule] of tableRows(
    region(locale, "services.md", "permission-list"),
  )) {
    const key = codeOf(name);
    permissions.permissions[key] ??= { services: [] };
    permissions.permissions[key][locale] = {
      meaning: plain(meaning),
      withSensitive: plain(sensitiveRule),
    };
  }
  for (const [name, sensitive, account, meaning] of tableRows(
    region(locale, "services.md", "capability-list"),
  )) {
    const key = codeOf(name);
    permissions.capabilities[key] ??= { services: [] };
    permissions.capabilities[key].sensitive = /\*\*/.test(sensitive);
    permissions.capabilities[key].account = account === "—" ? null : account;
    permissions.capabilities[key][locale] = { meaning: plain(meaning) };
  }
}
for (const [name, , service, when] of tableRows(region("en", "services.md", "capabilities"))) {
  permissions.capabilities[codeOf(name)].services.push({
    service: plain(service).replace(/`/g, ""),
    when,
  });
}
for (const [name, service, when] of tableRows(region("en", "services.md", "permissions"))) {
  const key = codeOf(name);
  if (key)
    permissions.permissions[key].services.push({ service: plain(service).replace(/`/g, ""), when });
}

// Error codes: every table row whose first cell names `domain.code`
// values, plus the service error codes and the CLI's domains.
const errors = { diagnostics: {}, services: {}, domains: {} };
for (const locale of pages.locales) {
  for (const page of pages.pages) {
    const markdown = readText(join(repository, "docs", "content", locale, page.file));
    let heading = "";
    for (const line of markdown.split("\n")) {
      const title = /^#{2,3} (.+)$/.exec(line);
      if (title) heading = title[1];
      if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim());
      // Only rows whose first cell is a list of codes.
      if (!/^`[a-z]+\.[a-z_]+`(?:,\s*`[a-z]+\.[a-z_]+`)*$/.test(cells[0] ?? "")) continue;
      const codes = [...(cells[0] ?? "").matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((match) => match[1]);
      const meaning = plain(cells.slice(1).join(" — "));
      for (const code of codes) {
        errors.diagnostics[code] ??= {};
        errors.diagnostics[code][locale] ??= { meaning, page: page.slug, section: heading };
      }
    }
  }
  for (const [code, meaning] of tableRows(region(locale, "services.md", "error-codes"))) {
    errors.services[codeOf(code)] ??= {};
    errors.services[codeOf(code)][locale] = plain(meaning);
  }
}
const cliMarkdown = readText(join(repository, "docs", "content", "en", "cli.md"));
for (const [domain, from, codes] of tableRows(
  cliMarkdown.slice(cliMarkdown.indexOf("| Domain | From | Codes |")).split("\n\n")[0],
)) {
  for (const name of [...domain.matchAll(/`([a-z]+)`/g)].map((match) => match[1])) {
    errors.domains[name] = { from: plain(from), codes: plain(codes) };
  }
}

// Limits, from the generated table of the limits page: name, topic, value
// as written, the number in its base unit (bytes, ms, count…) and meaning.
const UNITS = {
  KiB: [1024, "bytes"],
  MiB: [1048576, "bytes"],
  bytes: [1, "bytes"],
  byte: [1, "bytes"],
};
const limits = [];
let topic = "";
for (const line of region("en", "limits.md", "limits").split("\n")) {
  const heading = /^### (.+)$/.exec(line);
  if (heading) topic = heading[1];
  const row = /^\| `([A-Z0-9_]+)` \| ([^|]+) \| (.+) \|$/.exec(line);
  if (!row) continue;
  const written = row[2].trim();
  const parsed = /^(\d+)(?: (.+))?$/.exec(written);
  if (!parsed) throw new Error(`unreadable limit value ${written}`);
  const [factor, unit] = UNITS[parsed[2]] ?? [1, parsed[2] ?? "count"];
  limits.push({
    name: row[1],
    topic,
    written,
    value: Number(parsed[1]) * factor,
    unit,
    meaning: plain(row[3]),
  });
}
if (limits.length < 80) throw new Error(`only ${limits.length} limits parsed from the limits page`);

// The manifest reference: generated tables and the permission types.
const schemaSource = readText(join(repository, "sdk", "src", "generated", "schema.ts"));
const typeBlock = (name) => {
  const start =
    schemaSource.indexOf(`export type ${name}`) >= 0
      ? schemaSource.indexOf(`export type ${name}`)
      : schemaSource.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`missing SDK type ${name}`);
  const end = schemaSource.indexOf("\nexport ", start + 1);
  return schemaSource.slice(start, end).trim();
};
const manifestReference = [
  "# Manifest reference (widget API v1)",
  "",
  "Generated from the creator documentation (pages `manifest`, `services`) and the SDK types. The manifest is `manifest.json`: strict JSON, no unknown field, no duplicate key.",
  "",
  ...[
    ["manifest.md", "manifest-fields", "Top-level fields"],
    ["manifest.md", "manifest-name", "name"],
    ["manifest.md", "manifest-sizing", "sizing"],
    ["manifest.md", "manifest-dimensions", "Dimensions"],
    ["manifest.md", "manifest-permissions", "permissions"],
    ["manifest.md", "manifest-vm", "vm"],
    ["manifest.md", "menu-row-fields", "wrapper.menu rows"],
    ["services.md", "permission-list", "Permissions"],
    ["services.md", "network-rule-fields", "Network rule fields"],
    ["services.md", "parameter-constraints", "Path and query parameter constraints"],
    ["services.md", "capability-list", "Capabilities"],
  ].flatMap(([file, name, title]) => [`## ${title}`, "", region("en", file, name), ""]),
  "## SDK types",
  "",
  "```ts",
  ...[
    "Permission",
    "Capability",
    "SensitiveCapability",
    "CapabilityServices",
    "PermissionServices",
  ].map(typeBlock),
  "```",
  "",
].join("\n");

const templates = JSON.parse(readText(join(repository, "templates", "shared", "package.json")));
write(
  join(content, "index.json"),
  `${JSON.stringify(
    {
      formatVersion: 1,
      docs: { locales: pages.locales, pages: docs },
      projects,
      typescript: templates.devDependencies.typescript,
    },
    null,
    1,
  )}\n`,
);
write(join(content, "reference", "permissions.json"), `${JSON.stringify(permissions, null, 1)}\n`);
write(join(content, "reference", "errors.json"), `${JSON.stringify(errors, null, 1)}\n`);
write(join(content, "reference", "limits.json"), `${JSON.stringify(limits, null, 1)}\n`);
write(join(content, "reference", "manifest.md"), manifestReference);

// npm packs each file with its mode.
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644);
}
chmodSync(dist, 0o755);
chmodSync(join(dist, "index.js"), 0o755);
