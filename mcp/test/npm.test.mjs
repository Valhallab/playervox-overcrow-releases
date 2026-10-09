import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { findNpmCli, NpmError, planInstall, verifyLock } from "../dist/npm.js";

const work = mkdtempSync(join(tmpdir(), "overcrow-mcp-npm-"));
after(() => rmSync(work, { recursive: true, force: true }));
const PINS = {
  sdk: {
    version: "1.0.0",
    integrity:
      "sha512-akyuynS1TN5QbKyLsgoLOFF6JylVzNpUluEoSfz52xSlFg161kQ9QPLhcfGCptZ1x5/pm9/zPe/6LsHqFofnEA==",
  },
  typescript: {
    version: "6.0.3",
    integrity:
      "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
  },
};
let count = 0;
function project(files) {
  const directory = join(work, `p${++count}`);
  mkdirSync(directory);
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content);
  return directory;
}
const packageJson = (extra = {}) =>
  JSON.stringify({ devDependencies: { "@overcrow/sdk": "1.0.0", typescript: "6.0.3" }, ...extra });

test("a project made by create_widget can install the SDK", async () => {
  await planInstall(project({ "package.json": packageJson() }));
});

test("refuses what could install other code or write elsewhere", async () => {
  const refused = (files, pattern) =>
    assert.rejects(
      planInstall(project(files)),
      (e) => e instanceof NpmError && pattern.test(e.message),
    );
  await refused({}, /package\.json is missing/);
  await refused({ "package.json": "{not json" }, /not valid JSON/);
  await refused(
    { "package.json": packageJson(), ".npmrc": "registry=https://evil.example/" },
    /\.npmrc/,
  );
  await refused(
    { "package.json": packageJson({ dependencies: { "left-pad": "1.3.0" } }) },
    /left-pad/,
  );
  await refused(
    { "package.json": packageJson({ overrides: { typescript: "5.0.0" } }) },
    /overrides/,
  );
  await refused({ "package.json": packageJson({ workspaces: ["a"] }) }, /workspaces/);
  const linked = project({ "package.json": packageJson() });
  try {
    symlinkSync(work, join(linked, "node_modules"), "dir");
    await assert.rejects(planInstall(linked), /node_modules is a link/);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
});

test("the lockfile must record the published integrity of both packages", async () => {
  const lock = (sdkIntegrity) =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/@overcrow/sdk": { version: "1.0.0", integrity: sdkIntegrity },
        "node_modules/typescript": { version: "6.0.3", integrity: PINS.typescript.integrity },
      },
    });
  const good = await verifyLock(project({ "package-lock.json": lock(PINS.sdk.integrity) }), PINS);
  assert.deepEqual(
    good.map((check) => check.integrityMatches),
    [true, true],
  );
  await assert.rejects(
    verifyLock(project({ "package-lock.json": lock("sha512-other") }), PINS),
    /other than the published packages/,
  );
  await assert.rejects(verifyLock(project({}), PINS), NpmError);
});

test("npm is found next to the running Node.js", () => {
  assert.ok(findNpmCli(), "npm-cli.js beside node");
  assert.equal(findNpmCli("/nowhere/bin/node", "linux"), undefined);
});
