// The API reference of the creator documentation (docs/content/en/sdk.md and
// its French translation, docs/content/fr/sdk.md) is checked against the
// types: every export of the package is named there, every name it lists as
// an export exists, and every exported declaration and member has TSDoc.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const references = ["en", "fr"].map((locale) => ({
  locale,
  text: readFileSync(join(root, "..", "docs", "content", locale, "sdk.md"), "utf8"),
}));

const program = ts.createProgram([join(root, "src", "index.ts")], {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  types: [],
});
const checker = program.getTypeChecker();
const index = program.getSourceFile(join(root, "src", "index.ts"));
const exports = checker
  .getExportsOfModule(checker.getSymbolAtLocation(index))
  .map((symbol) => ({
    name: symbol.name,
    target: symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
  }));

for (const { locale, text } of references) {
  /** Names the reference writes in code spans, before any `(` or `<`. */
  const documented = new Set(
    [...text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)[(<`]/g)].map((match) => match[1]),
  );

  test(`every export is in the ${locale} reference`, () => {
    const missing = exports.map(({ name }) => name).filter((name) => !documented.has(name));
    assert.deepEqual(missing, []);
  });

  test(`every export named in a table of the ${locale} reference exists`, () => {
    const names = new Set(exports.map(({ name }) => name));
    const listed = [...text.matchAll(/^\| `([A-Za-z_][A-Za-z0-9_]*)[(<`]/gm)].map(
      (match) => match[1],
    );
    const unknown = listed.filter((name) => !names.has(name));
    assert.deepEqual(unknown, []);
  });
}

const hasDoc = (symbol) =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() !== "";

test("every exported declaration and member has TSDoc", () => {
  const undocumented = [];
  for (const { name, target } of exports) {
    if (!hasDoc(target)) {
      undocumented.push(name);
    }
    if (target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) {
      for (const member of target.members?.values() ?? []) {
        if (
          member.flags & (ts.SymbolFlags.Property | ts.SymbolFlags.Method) &&
          !member.name.startsWith("__") &&
          !hasDoc(member)
        ) {
          undocumented.push(`${name}.${member.name}`);
        }
      }
    }
  }
  assert.deepEqual(undocumented, []);
});
