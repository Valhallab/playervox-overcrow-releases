// The link check of scripts/check-links.mjs on a scratch repository.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { anchors, check, slug } from "../scripts/check-links.mjs";

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
