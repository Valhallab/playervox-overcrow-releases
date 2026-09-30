// Copies the shared sources of the built-in widgets (widgets-shared/) into
// the widgets that use them, between markers:
//
//   // <shared:playervox-badge/badge.ts>        (logic.ts)
//   /* <shared:playervox-badge/badge.ocss> */   (style.ocss)
//
// and the matching closing markers `</shared:…>`. Each widget directory
// stays a complete project for `overcrow-widget check`, `package` and
// `admit`; the copies can never diverge from their source, because
// `--check` fails on any difference (CI). An internal tool of the
// built-ins, not a feature of the widget CLI.
//
//   node scripts/sync-shared-widgets.mjs [--check]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "widgets-shared");
const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--check");
if (unknown.length > 0) {
  console.error(`sync-shared-widgets: unknown argument ${unknown[0]}`);
  process.exit(2);
}

// Marker lines per widget source file: a marker is a whole line, so the
// markers a shared file names in its own comments are text, not markers.
const FILES = [
  { name: "logic.ts", extension: ".ts", open: /^\/\/ <shared:([a-z0-9-]+\/[a-z0-9-]+\.ts)>$/, close: (path) => `// </shared:${path}>` },
  {
    name: "style.ocss",
    extension: ".ocss",
    open: /^\/\* <shared:([a-z0-9-]+\/[a-z0-9-]+\.ocss)> \*\/$/,
    close: (path) => `/* </shared:${path}> */`,
  },
];

const errors = [];
const stale = [];
let copies = 0;
for (const widget of readdirSync(join(root, "widgets")).sort()) {
  for (const file of FILES) {
    const path = join(root, "widgets", widget, file.name);
    if (!existsSync(path)) {
      continue;
    }
    const where = relative(root, path);
    const lines = readFileSync(path, "utf8").split("\n");
    const output = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      output.push(line);
      const source = file.open.exec(line)?.[1];
      if (source === undefined) {
        continue;
      }
      const origin = join(shared, source);
      const close = lines.indexOf(file.close(source), index + 1);
      if (!existsSync(origin)) {
        errors.push(`${where}: widgets-shared/${source} does not exist`);
        continue;
      }
      if (close < 0) {
        errors.push(`${where}: "${line}" has no "${file.close(source)}" line`);
        continue;
      }
      const body = readFileSync(origin, "utf8");
      output.push(...body.replace(/\n$/, "").split("\n"), file.close(source));
      index = close;
      copies += 1;
    }
    const text = lines.join("\n");
    const synced = output.join("\n");
    if (synced !== text) {
      stale.push(where);
      if (!check) {
        writeFileSync(path, synced);
      }
    }
  }
}
for (const error of errors) {
  console.error(`sync-shared-widgets: ${error}`);
}
if (errors.length > 0) {
  process.exit(1);
}
if (check && stale.length > 0) {
  for (const path of stale) {
    console.error(`sync-shared-widgets: ${path} differs from widgets-shared/: run node scripts/sync-shared-widgets.mjs`);
  }
  process.exit(1);
}
console.log(`sync-shared-widgets: ${copies} shared copies ${check ? "current" : "written"}`);
