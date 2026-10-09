import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import { after, test } from "node:test";
import {
  checkRoot,
  Confinement,
  ConfinementError,
  isInside,
  labelRoots,
  rootRefusal,
  rootUriToPath,
} from "../dist/confine.js";

const POSIX = process.platform !== "win32";
const base = realpathSync(mkdtempSync(join(tmpdir(), "overcrow-mcp-confine-")));
const project = join(base, "project");
const outside = join(base, "outside");
mkdirSync(join(project, "my-widget", "tests"), { recursive: true });
mkdirSync(join(project, ".secret"), { recursive: true });
mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(project, "my-widget", "manifest.json"), "{}");
writeFileSync(join(outside, "passwd"), "secret");
let links = true;
try {
  symlinkSync(outside, join(project, "escape"), "dir");
  symlinkSync(join(outside, "passwd"), join(project, "my-widget", "leak.json"), "file");
} catch {
  links = false;
}
after(() => rmSync(base, { recursive: true, force: true }));

const confinement = new Confinement(labelRoots([project]));
const refused = (input, target = "directory") =>
  assert.rejects(confinement.resolve(input, target), ConfinementError, input);

test("paths inside the project resolve to their real location", async () => {
  assert.equal(await confinement.resolve("my-widget", "directory"), join(project, "my-widget"));
  assert.equal(
    await confinement.resolve(join(project, "my-widget", "manifest.json"), "file"),
    join(project, "my-widget", "manifest.json"),
  );
  assert.equal(
    await confinement.resolve("my-widget/./tests/../tests", "directory"),
    join(project, "my-widget", "tests"),
  );
  assert.equal(
    await confinement.resolve("new-widget", "new-directory"),
    join(project, "new-widget"),
  );
  assert.equal(confinement.display(join(project, "my-widget", "logic.ts")), "my-widget/logic.ts");
});

test("paths that leave the project are refused", async () => {
  await refused("..");
  await refused("../outside");
  await refused("my-widget/../../outside");
  await refused(outside);
  await refused(join(outside, "passwd"), "file");
  await refused(parse(project).root);
  await refused(homedir());
});

test("links that lead out of the project are refused", {
  skip: links ? false : "symbolic links are not available",
}, async () => {
  await refused("escape");
  await refused("escape/passwd", "file");
  await refused("my-widget/leak.json", "file");
  await refused("escape/new-folder", "new-directory");
});

test("hidden folders, node_modules and odd input are refused", async () => {
  await refused(".secret");
  await refused("my-widget/.git", "new-directory");
  await refused("node_modules/pkg");
  await refused("");
  await refused("a\u0000b");
  await refused("x".repeat(2000));
  await refused(".", "new-directory");
  await refused("my-widget/manifest.json", "directory");
});

test("roots: system folders, a disk root and the home folder are never roots", async () => {
  assert.match(await rootRefusal(parse(project).root), /root of a disk/);
  assert.match(await rootRefusal(realpathSync(homedir())), /home folder/);
  if (POSIX) {
    for (const system of ["/etc", "/usr/lib", "/proc/self", "/var/log", "/tmp", "/home"]) {
      assert.ok(await rootRefusal(system), system);
    }
  }
  assert.equal(await rootRefusal(project), undefined);
  await assert.rejects(checkRoot(join(base, "missing")), /does not exist/);
  assert.equal(await checkRoot(project), project);
});

test("several roots are labelled, and <label>/path names a path in one of them", async () => {
  const second = join(base, "second");
  mkdirSync(join(second, "w"), { recursive: true });
  const two = new Confinement(labelRoots([project, second]));
  assert.equal(await two.resolve("second/w", "directory"), join(second, "w"));
  assert.equal(two.display(join(second, "w")), "second/w");
  assert.equal(two.display(outside), "<outside the project>");
});

test("client roots must be file URIs", () => {
  assert.equal(rootUriToPath("https://example.com/x"), undefined);
  assert.equal(rootUriToPath("not a uri"), undefined);
  assert.ok(rootUriToPath(POSIX ? "file:///home/me/project" : "file:///C:/Users/me/project"));
  assert.ok(isInside(project, join(project, "a")));
  assert.ok(!isInside(project, `${project}-other`));
});
