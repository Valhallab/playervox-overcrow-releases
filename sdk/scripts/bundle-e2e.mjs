// Builds the end-to-end Clock into one classic script, as a widget's
// logic.js must be: TypeScript compiles the SDK and the fixture to
// CommonJS, then each module is wrapped in a function of a small registry,
// in path order. Test tooling only: the widget CLI (P2.2) is the real
// bundler. Prints the bundle path and size.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "e2e");
const tsc = createRequire(import.meta.url).resolve("typescript/lib/tsc.js");
rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", join(root, "test", "e2e", "tsconfig.json")], {
  stdio: "inherit",
});

const ENTRY = "test/e2e/clock.view.js";
const ALIASES = { "@overcrow/sdk": "src/index.js" };
const modules = new Map();

function resolve(from, specifier) {
  if (specifier in ALIASES) {
    return ALIASES[specifier];
  }
  if (!specifier.startsWith(".")) {
    throw new Error(`${from}: cannot bundle ${specifier}`);
  }
  return posix.normalize(posix.join(posix.dirname(from), specifier));
}

function visit(id) {
  if (modules.has(id)) {
    return;
  }
  const source = readFileSync(join(out, id), "utf8");
  const dependencies = [];
  const code = source.replace(/require\("([^"]+)"\)/g, (_, specifier) => {
    const target = resolve(id, specifier);
    dependencies.push(target);
    return `require(${JSON.stringify(target)})`;
  });
  modules.set(id, code.replace(/^"use strict";\n/, "").trimEnd());
  dependencies.forEach(visit);
}
visit(ENTRY);

const body = [...modules]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([id, code]) => `${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n}`)
  .join(",\n");
const bundle = `// End-to-end fixture of @overcrow/sdk, built by sdk/scripts/bundle-e2e.mjs.
"use strict";
(() => {
const modules = {
${body}
};
const cache = {};
const require = (id) => {
  if (!(id in cache)) {
    const module = { exports: {} };
    cache[id] = module;
    modules[id](module, module.exports, require);
  }
  return cache[id].exports;
};
require(${JSON.stringify(ENTRY)});
})();
`;
mkdirSync(out, { recursive: true });
const target = join(out, "clock.logic.js");
writeFileSync(target, bundle);
console.log(`${relative(root, target)} ${Buffer.byteLength(bundle)} bytes, ${modules.size} modules`);
