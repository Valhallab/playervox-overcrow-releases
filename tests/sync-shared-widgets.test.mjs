// scripts/sync-shared-widgets.mjs on a checkout made as Windows makes it
// (core.autocrlf=true): the copies of widgets-shared/ in the built-ins stay
// current, because the shared sources and the widgets keep the same bytes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, ...args) {
  const run = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

test("a Windows checkout keeps the shared copies current", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "overcrow-shared-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "source");
  mkdirSync(join(source, "scripts"), { recursive: true });
  cpSync(join(root, ".gitattributes"), join(source, ".gitattributes"));
  cpSync(join(root, "scripts", "sync-shared-widgets.mjs"), join(source, "scripts", "sync-shared-widgets.mjs"));
  cpSync(join(root, "widgets-shared"), join(source, "widgets-shared"), { recursive: true });
  let users = 0;
  for (const widget of readdirSync(join(root, "widgets"))) {
    for (const name of ["logic.ts", "style.ocss"]) {
      const path = join(root, "widgets", widget, name);
      let text;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (text.includes("<shared:")) {
        cpSync(path, join(source, "widgets", widget, name));
        users += 1;
      }
    }
  }
  assert.ok(users > 0, "no widget uses widgets-shared/");
  git(source, "init", "-q");
  git(source, "-c", "core.autocrlf=false", "add", ".");
  git(source, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "shared");

  const windows = join(folder, "windows");
  git(folder, "clone", "-q", "-c", "core.autocrlf=true", "-c", "core.eol=crlf", source, windows);
  const run = spawnSync(process.execPath, ["scripts/sync-shared-widgets.mjs", "--check"], { cwd: windows, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /shared copies current/);
});
