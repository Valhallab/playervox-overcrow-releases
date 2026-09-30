// Fills the generated regions of the creator documentation (docs/content/),
// so no page keeps a hand-written copy of the contract:
//
//   <!-- generated:NAME -->
//   …
//   <!-- /generated:NAME -->
//
// The tables come from the SDK types that the schema crate generates
// (sdk/src/generated/schema.ts) and from the reference widgets (widgets/).
//
//   node scripts/build-docs-content.mjs          rewrite the regions
//   node scripts/build-docs-content.mjs --check  fail when one is stale
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = join(root, "docs", "content");
const LOCALES = ["en", "fr"];

const WORDS = {
  en: {
    capability: "Capability",
    sensitive: "Sensitive",
    services: "Services",
    gesture: "On a gesture",
    permission: "Permission",
    yes: "yes",
    no: "no",
    none: "none (host-bound intent)",
    widget: "Widget",
    description: "Description",
    id: "ID",
    authority: "Permissions",
    page: "Page",
    nothing: "none",
  },
  fr: {
    capability: "Capability",
    sensitive: "Sensible",
    services: "Services",
    gesture: "Sur un geste",
    permission: "Permission",
    yes: "oui",
    no: "non",
    none: "aucun (intent lié à l’hôte)",
    widget: "Widget",
    description: "Description",
    id: "ID",
    authority: "Permissions",
    page: "Page",
    nothing: "aucune",
  },
};

const schema = readFileSync(join(root, "sdk", "src", "generated", "schema.ts"), "utf8");

/** The string members of `export type NAME = | "a" | "b";`. */
function union(name) {
  const match = schema.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!match) {
    throw new Error(`schema.ts has no type ${name}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((member) => member[1]);
}

/** `readonly "key": "a" | "b";` members of `export interface NAME`. */
function mapping(name) {
  const match = schema.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`schema.ts has no interface ${name}`);
  }
  const entries = new Map();
  for (const line of match[1].matchAll(/readonly "([^"]+)": ([^;]+);/g)) {
    entries.set(line[1], line[2] === "never" ? [] : [...line[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }
  return entries;
}

const code = (text) => `\`${text}\``;
const row = (cells) => `| ${cells.join(" | ")} |`;
const table = (header, rows) =>
  [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");

function capabilities(locale) {
  const w = WORDS[locale];
  const sensitive = new Set(union("SensitiveCapability"));
  const gesture = new Set(union("GestureServiceName"));
  const services = mapping("CapabilityServices");
  return table(
    [w.capability, w.sensitive, w.services, w.gesture],
    union("Capability").map((name) => {
      const list = services.get(name) ?? [];
      const free = list.filter((service) => !gesture.has(service));
      const bound = list.filter((service) => gesture.has(service));
      return [
        code(name),
        sensitive.has(name) ? `**${w.yes}**` : w.no,
        list.length === 0 ? w.none : free.map(code).join(", ") || "—",
        bound.map(code).join(", ") || "—",
      ];
    }),
  );
}

function permissions(locale) {
  const w = WORDS[locale];
  const gesture = new Set(union("GestureServiceName"));
  const services = mapping("PermissionServices");
  return table(
    [w.permission, w.services, w.gesture],
    union("Permission")
      .filter((name) => name !== "capabilities")
      .map((name) => {
        const list = services.get(name) ?? [];
        return [
          code(name),
          list.filter((service) => !gesture.has(service)).map(code).join(", ") || "—",
          list.filter((service) => gesture.has(service)).map(code).join(", ") || "—",
        ];
      }),
  );
}

function gestureEvents() {
  return union("GestureEventName").map(code).join(", ") + ".";
}

function widgets(locale, file) {
  const w = WORDS[locale];
  const base = join(root, "widgets");
  const rows = [];
  for (const dir of readdirSync(base).sort()) {
    const project = join(base, dir);
    // Widget API v1 projects only (they have a view.ocml).
    if (!existsSync(join(project, "view.ocml"))) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(project, "manifest.json"), "utf8"));
    const listing = JSON.parse(readFileSync(join(project, "listing.json"), "utf8"));
    const text =
      listing.localizations.find((entry) => entry.locale === locale) ??
      listing.localizations.find((entry) => entry.locale === listing.defaultLocale);
    const permissions = manifest.permissions ?? {};
    const authority = [
      ...(permissions.capabilities ?? []),
      ...Object.keys(permissions).filter((key) => key !== "capabilities" && permissions[key] !== false),
    ];
    const page = relative(dirname(file), join(project, "README.md")).split("\\").join("/");
    rows.push([
      `**${text.name}**`,
      text.description,
      code(manifest.id),
      authority.map(code).join(", ") || w.nothing,
      `[${dir}/README.md](${page})`,
    ]);
  }
  return table([w.widget, w.description, w.id, w.authority, w.page], rows);
}

const GENERATORS = {
  capabilities: (locale) => capabilities(locale),
  permissions: (locale) => permissions(locale),
  "gesture-events": () => gestureEvents(),
  widgets: (locale, file) => widgets(locale, file),
};

/** The file with every generated region rewritten. */
export function render(file, locale, text) {
  return text.replace(
    /<!-- generated:([a-z-]+) -->\n[\s\S]*?<!-- \/generated:([a-z-]+) -->/g,
    (_whole, name, end) => {
      if (name !== end) {
        throw new Error(`${relative(root, file)}: region ${name} ends as ${end}`);
      }
      const generate = GENERATORS[name];
      if (!generate) {
        throw new Error(`${relative(root, file)}: unknown generated region ${name}`);
      }
      return `<!-- generated:${name} -->\n${generate(locale, file)}\n<!-- /generated:${name} -->`;
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const locale of LOCALES) {
    const dir = join(content, locale);
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
      const file = join(dir, name);
      const before = readFileSync(file, "utf8");
      const after = render(file, locale, before);
      if (after === before) {
        continue;
      }
      if (check) {
        console.error(`${relative(root, file)}: generated regions are stale`);
        stale += 1;
      } else {
        writeFileSync(file, after);
        console.log(`updated ${relative(root, file)}`);
      }
    }
  }
  if (stale > 0) {
    console.error("run `node scripts/build-docs-content.mjs` and commit the result");
    process.exit(1);
  }
}
