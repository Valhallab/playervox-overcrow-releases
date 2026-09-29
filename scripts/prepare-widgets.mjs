// Links this checkout's @overcrow/sdk (built with `npm run build` in sdk/)
// and its pinned TypeScript into each reference widget of widgets/ that is a
// widget API v1 project (it has a view.ocml), as `npm install` would once
// @overcrow/sdk is published. `overcrow-widget check` and the widgets' unit
// tests then run against the SDK of this revision. Links are directory
// junctions on Windows.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = join(root, "sdk");
const typescript = join(sdk, "node_modules", "typescript");
for (const [path, hint] of [
  [join(sdk, "dist", "index.js"), "run `npm run build` in sdk/"],
  [join(typescript, "package.json"), "run `npm ci` in sdk/"],
]) {
  if (!existsSync(path)) {
    console.error(`prepare-widgets: ${path} is missing: ${hint}`);
    process.exit(1);
  }
}

const link = (target, path) => {
  if (existsSync(path) || isLink(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
};
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const widgets = join(root, "widgets");
let count = 0;
for (const name of readdirSync(widgets).sort()) {
  const project = join(widgets, name);
  if (!existsSync(join(project, "view.ocml"))) {
    continue;
  }
  link(sdk, join(project, "node_modules", "@overcrow", "sdk"));
  link(typescript, join(project, "node_modules", "typescript"));
  count += 1;
}
console.log(`prepare-widgets: ${count} widget projects linked to sdk/`);
