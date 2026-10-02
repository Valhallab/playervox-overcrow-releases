// The link check of scripts/check-links.mjs on a scratch repository.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { anchors, check, checkSite, slug } from "../scripts/check-links.mjs";

test("anchors follow GitHub's rules", () => {
  assert.equal(slug("`init <dir> [--template NAME] [--id ID] [--name NAME]`"), "init-dir---template-name---id-id---name-name");
  assert.equal(slug("Permissions et consentement"), "permissions-et-consentement");
  assert.equal(slug("Ce qu’un widget ne peut pas faire"), "ce-quun-widget-ne-peut-pas-faire");
  assert.deepEqual([...anchors("# A\n## A\n```\n# not a heading\n```\n### B\n")], ["a", "a-1", "b"]);
});

test("broken files, anchors, repository URLs and retired downloads are reported", () => {
  const root = mkdtempSync(join(tmpdir(), "overcrow-links-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "target.md"), "# Target\n\n## A section\n");
    writeFileSync(
      join(root, "README.md"),
      [
        "[ok](docs/target.md#a-section) [ok](docs/) [ok](#readme)",
        "# Readme",
        "[missing](docs/missing.md) [anchor](docs/target.md#nope)",
        "[github ok](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/docs/target.md)",
        "[github missing](https://github.com/Valhallab/playervox-overcrow-releases/tree/main/gone)",
        "[kit](https://overcrow.playervox.com/docs/downloads/creator-kit.zip)",
        "[outside](../elsewhere.md) [external](https://example.com/x)",
        "`[in code](nowhere.md)`",
        "```",
        "[in a block](nowhere.md)",
        "```",
      ].join("\n"),
    );
    const problems = check(root, ["README.md", "docs/target.md"]);
    assert.deepEqual(
      problems.map((problem) => problem.replace(/:.*?: /, ": ")),
      [
        "README.md: docs/missing.md does not exist",
        "README.md: docs/target.md#nope names no heading of docs/target.md",
        "README.md: https://github.com/Valhallab/playervox-overcrow-releases/tree/main/gone does not exist",
        "README.md: https://overcrow.playervox.com/docs/downloads/creator-kit.zip is a retired Web download",
        "README.md: ../elsewhere.md leaves the repository",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("addresses of the documentation website name a page and a heading of its language", () => {
  const root = mkdtempSync(join(tmpdir(), "overcrow-links-"));
  try {
    for (const locale of ["en", "fr"]) {
      mkdirSync(join(root, "docs", "content", locale), { recursive: true });
    }
    writeFileSync(
      join(root, "docs", "content", "pages.json"),
      JSON.stringify({
        pages: [
          { slug: "", file: "index.md" },
          { slug: "cli", file: "cli.md" },
        ],
      }),
    );
    writeFileSync(join(root, "docs", "content", "en", "index.md"), "# Home\n");
    writeFileSync(join(root, "docs", "content", "fr", "index.md"), "# Accueil\n");
    writeFileSync(join(root, "docs", "content", "en", "cli.md"), "# The tool\n\n## Exit status\n");
    writeFileSync(join(root, "docs", "content", "fr", "cli.md"), "# L’outil\n\n## Codes de sortie\n");
    mkdirSync(join(root, "cli"));
    writeFileSync(
      join(root, "cli", "main.rs"),
      [
        'const GUIDE: &str = "Guide: https://overcrow.playervox.com/docs/en/cli/";',
        '.help("see https://overcrow.playervox.com/docs/en/cli/#exit-status.")',
        '.help("see https://overcrow.playervox.com/docs/cli/#codes-de-sortie")',
        "// https://overcrow.playervox.com/docs/en/ and https://overcrow.playervox.com/docs/",
        '.help("see https://overcrow.playervox.com/docs/en/sdk/")',
        '.help("see https://overcrow.playervox.com/docs/cli/#exit-status")',
        '.help("see https://overcrow.playervox.com/docs/en/cli")',
        "// https://overcrow.playervox.com/marketplace/widgets/v1/catalog.json is not a page",
      ].join("\n"),
    );
    writeFileSync(join(root, "image.png"), "https://overcrow.playervox.com/docs/en/nowhere/");
    assert.deepEqual(checkSite(root, ["cli/main.rs", "image.png"]), [
      "cli/main.rs:5: https://overcrow.playervox.com/docs/en/sdk/ is no page of the documentation website",
      "cli/main.rs:6: https://overcrow.playervox.com/docs/cli/#exit-status names no heading of docs/content/fr/cli.md",
      "cli/main.rs:7: https://overcrow.playervox.com/docs/en/cli is no page of the documentation website",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
