import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { shippedPin } from "../dist/bootstrap/pin.js";
import { asDiagnostic, jsonLines } from "../dist/cli.js";
import { docPages, limit, manifestReference, projectFile, projects } from "../dist/content.js";
import { explainError, explainPermission, readDoc, searchDocs } from "../dist/knowledge.js";
import { clean, cleanLine, Redactor } from "../dist/text.js";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the shipped content: every page in both languages, projects, references", () => {
  const pages = JSON.parse(
    readFileSync(join(repository, "docs", "content", "pages.json"), "utf8"),
  ).pages;
  assert.equal(docPages().length, pages.length);
  for (const page of docPages()) {
    assert.ok(readDoc(page.slug, "en")?.markdown?.startsWith("# "), page.slug);
    assert.ok(readDoc(page.slug, "fr")?.markdown?.startsWith("# "), page.slug);
  }
  assert.deepEqual(
    projects("examples")
      .filter((p) => p.source === "widgets")
      .map((p) => p.name).length,
    13,
  );
  assert.ok(projectFile("examples", "warframe-market", "logic.ts")?.includes("CatalogScanner"));
  assert.equal(projectFile("examples", "warframe-market", "../../../package.json"), undefined);
  assert.equal(projectFile("templates", "counter", "logic.ts")?.includes("{{"), false);
  assert.equal(limit("MIN_TIMER_INTERVAL_MS"), 100);
  assert.equal(limit("MAX_HTTP_DECLARED_RESPONSE_BYTES"), 3 * 1024 * 1024);
  assert.match(manifestReference(), /maxResponseBytes/);
  assert.match(manifestReference(), /export type Capability/);
});

test("search finds the right page, in English and French", () => {
  assert.equal(searchDocs("maxResponseBytes", "en", 5)[0]?.slug !== undefined, true);
  assert.ok(searchDocs("clipboard user action", "en", 5).some((hit) => hit.slug === "services"));
  assert.ok(searchDocs("presse-papiers", "fr", 5).length > 0);
  assert.deepEqual(searchDocs("   ", "en", 5), []);
  const section = readDoc("services", "en", "Errors");
  assert.ok(section?.markdown?.startsWith("## Errors"));
});

test("explanations of permissions and codes", () => {
  const network = explainPermission("network", "en");
  assert.equal(network.kind, "permission");
  assert.match(network.advice, /maxResponseBytes/);
  const media = explainPermission("media.read", "fr");
  assert.equal(media.sensitive, true);
  assert.match(media.advice, /network or clipboardWrite/);
  assert.equal(explainPermission("root.access", "en"), undefined);
  assert.equal(explainError("permission_denied", "en").kind, "service");
  assert.equal(explainError("logic.eval", "en").kind, "diagnostic");
  assert.equal(explainError("manifest.network_rule", "en").kind, "domain");
  assert.equal(explainError("nothing.here", "en"), undefined);
});

test("the CLI's JSON lines are read as data", () => {
  const golden = readFileSync(
    join(repository, "cli", "tests", "golden", "view_unknown_attribute_json.txt"),
    "utf8",
  );
  const [diagnostic] = jsonLines(golden).map(asDiagnostic);
  assert.deepEqual(diagnostic, {
    severity: "error",
    code: "view.unknown_attribute",
    file: "view.ocml",
    line: 4,
    column: 9,
    message: "`clas` is not an attribute of <text>",
    help: "did you mean `class`?",
  });
  const lines = jsonLines('noise\n{"type":"summary","passed":1,"failed":0}\n{broken\n[1,2]\n');
  assert.deepEqual(lines, [{ type: "summary", passed: 1, failed: 0 }]);
  assert.equal(asDiagnostic({ type: "scenario" }), undefined);
});

test("text leaving the server: no escapes, no hidden characters, no home path", () => {
  assert.equal(clean("\u001b[31mred\u001b[0m\u0007 bell‮"), "red bell");
  assert.equal(cleanLine("a\nb\tc"), "a b c");
  assert.match(clean("x".repeat(5000), 100), /more characters/);
  const redactor = new Redactor(
    [{ path: "/home/someone/work/project", label: "<project>" }],
    "/home/someone",
  );
  assert.equal(
    redactor.text("/home/someone/work/project/w and /home/someone/.ssh"),
    "<project>/w and ~/.ssh",
  );
});

test("the shipped pin names the SDK and TypeScript versions of the templates", () => {
  const pin = shippedPin();
  const template = JSON.parse(
    readFileSync(join(repository, "templates", "shared", "package.json"), "utf8"),
  );
  const sdk = JSON.parse(readFileSync(join(repository, "sdk", "package.json"), "utf8"));
  assert.equal(pin.npm.typescript.version, template.devDependencies.typescript);
  assert.equal(pin.npm.sdk.version, sdk.version);
});
