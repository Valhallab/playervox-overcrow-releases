// Compiles this widget's logic.ts with the project's TypeScript into
// dist/ and imports it, after the test installed its runtime
// (`@overcrow/sdk/testing`), as the VM runs logic.js after its prelude.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

export async function loadLogic() {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("logic.ts", root), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
  });
  mkdirSync(new URL("dist/", root), { recursive: true });
  // One file per test process: test files run in parallel.
  const output = new URL(`dist/logic-${process.pid}.mjs`, root);
  writeFileSync(output, outputText);
  return import(output.href);
}
