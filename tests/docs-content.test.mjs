// The creator documentation (docs/content/, docs/content/README.md): every
// page exists in both languages with the same code blocks, every code block
// is an excerpt of a project the CLI checks, packages and admits, every
// `overcrow-widget` command of a shell block exists, the generated regions
// are current, and every generated description has its French translation.
//
//   node scripts/prepare-widgets.mjs   (links the SDK into the examples)
//   node --test --test-concurrency=2 tests/docs-content.test.mjs
//
// The CLI is target/debug/overcrow-widget, or the executable named by
// OVERCROW_WIDGET.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = join(root, "docs", "content");
const examples = join(content, "examples");
const cli =
  process.env.OVERCROW_WIDGET ??
  join(root, "target", "debug", process.platform === "win32" ? "overcrow-widget.exe" : "overcrow-widget");
const pages = JSON.parse(readFileSync(join(content, "pages.json"), "utf8"));
const SOURCE_ROOTS = ["docs/content/examples/", "templates/", "widgets/", "mcp/examples/"];
const UNCHECKED = new Set(["sh", "text"]);

/** The fenced code blocks of a Markdown page, with their source comment. */
function blocks(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(/^```(\S*)$/);
    if (!open) {
      continue;
    }
    const start = index;
    const body = [];
    for (index += 1; index < lines.length && lines[index] !== "```"; index += 1) {
      body.push(lines[index]);
    }
    assert.ok(index < lines.length, `unclosed code block at line ${start + 1}`);
    const comment = lines[start - 1]?.match(/^<!-- source: (\S+) -->$/);
    found.push({ line: start + 1, language: open[1], source: comment?.[1] ?? null, code: body.join("\n") });
  }
  return found;
}

function run(args, options = {}) {
  const result = spawnSync(cli, args, { encoding: "utf8", ...options });
  assert.equal(result.error, undefined, `cannot run ${cli}: build it with cargo build -p overcrow-widget-cli`);
  return result;
}

const pageFiles = (locale) => pages.pages.map((page) => join(content, locale, page.file));

test("pages.json lists every page of both languages", () => {
  assert.deepEqual(pages.locales, ["en", "fr"]);
  const slugs = pages.pages.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug");
  for (const locale of pages.locales) {
    const listed = pages.pages.map((page) => page.file).sort();
    const present = readdirSync(join(content, locale)).filter((name) => name.endsWith(".md")).sort();
    assert.deepEqual(present, listed, `${locale}/ holds exactly the listed pages`);
    for (const page of pages.pages) {
      assert.ok(page.label[locale], `${page.file}: no ${locale} label`);
      const text = readFileSync(join(content, locale, page.file), "utf8");
      assert.match(text, /^# \S/, `${locale}/${page.file} starts with its title`);
    }
  }
});

test("both languages have the same code blocks", () => {
  for (const page of pages.pages) {
    const [en, fr] = pages.locales.map((locale) =>
      blocks(readFileSync(join(content, locale, page.file), "utf8")).map(({ language, source, code }) => ({
        language,
        source,
        code,
      })),
    );
    assert.deepEqual(fr, en, `fr/${page.file} and en/${page.file} differ in their code blocks`);
  }
});

test("every code block is an excerpt of a checked project", () => {
  let checked = 0;
  for (const file of pageFiles("en")) {
    for (const block of blocks(readFileSync(file, "utf8"))) {
      const where = `${file}:${block.line}`;
      assert.ok(block.language, `${where}: a code block names its language`);
      if (UNCHECKED.has(block.language)) {
        continue;
      }
      assert.ok(block.source, `${where}: a ${block.language} block needs a <!-- source: PATH --> comment`);
      assert.ok(
        SOURCE_ROOTS.some((prefix) => block.source.startsWith(prefix)) && !block.source.includes(".."),
        `${where}: ${block.source} is not under ${SOURCE_ROOTS.join(", ")}`,
      );
      const source = readFileSync(join(root, block.source), "utf8").replaceAll("\r\n", "\n");
      assert.ok(
        `\n${source}\n`.includes(`\n${block.code}\n`),
        `${where}: the block is not a run of whole lines of ${block.source}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0);
});

test("every overcrow-widget command of a shell block exists", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  const commands = new Set(
    [...help.stdout.matchAll(/^ {2}overcrow-widget ([a-z][a-z-]*)/gm)].map((match) => match[1]),
  );
  assert.ok(commands.has("init") && commands.has("admit"));
  for (const locale of pages.locales) {
    for (const file of pageFiles(locale)) {
      for (const block of blocks(readFileSync(file, "utf8")).filter((b) => b.language === "sh")) {
        for (const line of block.code.split("\n")) {
          const command = line.match(/^overcrow-widget ([a-z][a-z-]*)/)?.[1];
          if (command) {
            assert.ok(commands.has(command), `${file}:${block.line}: unknown command ${command}`);
          }
        }
      }
    }
  }
});

test("the generated regions are current and their descriptions translated", () => {
  const result = spawnSync(process.execPath, [join(root, "scripts", "build-docs-content.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("only the page of limits and the list of SDK constants name a limit", () => {
  const reference = readFileSync(join(root, "docs", "widget-schema-v1.md"), "utf8");
  const limits = reference.slice(reference.indexOf("\n## Limits"), reference.indexOf("\n## Manifest"));
  const names = new Set([...limits.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map((match) => match[1]));
  assert.ok(names.has("MAX_NETWORK_RULES"), "the schema reference lists the limits");
  // The SDK exports the constants: its page lists their names, once.
  const exported = { en: "## Limit constants", fr: "## Constantes de limites" };
  for (const locale of pages.locales) {
    for (const file of pageFiles(locale).filter((page) => !page.endsWith("limits.md"))) {
      let text = readFileSync(file, "utf8");
      if (file.endsWith("sdk.md")) {
        const start = text.indexOf(exported[locale]);
        assert.ok(start >= 0, `${file}: no ${exported[locale]}`);
        const end = text.indexOf("\n## ", start + 1);
        text = text.slice(0, start) + (end < 0 ? "" : text.slice(end));
      }
      const named = [...text.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1]).filter((name) => names.has(name));
      assert.deepEqual(named, [], `${file} names a limit: write its value and unit`);
    }
  }
});

for (const name of readdirSync(examples).sort()) {
  const project = join(examples, name);
  test(`example ${name} is checked, packaged and admitted by the CLI`, () => {
    assert.ok(
      existsSync(join(project, "node_modules", "typescript")),
      "run `node scripts/prepare-widgets.mjs` first, so its types are checked",
    );
    const check = run(["check", project, "--deny-warnings"]);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    const work = mkdtempSync(join(tmpdir(), "overcrow-docs-example-"));
    try {
      const packaged = run(["package", project, "--out", join(work, `${name}.ocpkg`)]);
      assert.equal(packaged.status, 0, packaged.stdout + packaged.stderr);
      // The examples' IDs are under `nova`, the documentation's example
      // publisher: admitted for it, refused to anyone else.
      const admitted = run(["admit", project, "--publisher", "nova", "--deny-warnings"]);
      assert.equal(admitted.status, 0, admitted.stdout + admitted.stderr);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}
