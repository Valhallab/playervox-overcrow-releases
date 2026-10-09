import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { childEnvironment, bypassesProxy } from "../dist/env.js";
import { RunError, runProcess } from "../dist/run.js";

const work = mkdtempSync(join(tmpdir(), "overcrow-mcp-run-"));
after(() => rmSync(work, { recursive: true, force: true }));
const node = process.execPath;
const base = { cwd: work, env: childEnvironment({ network: false }), timeoutMs: 20_000 };

test("arguments reach the program as they are: no shell", async () => {
  const marker = join(work, "pwned");
  const tricky = [
    "; touch pwned",
    "$(touch pwned)",
    "`touch pwned`",
    "&& echo hi",
    "| cat",
    "%PATH%",
    "\"quoted\" 'single'",
  ];
  const result = await runProcess(
    node,
    ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...tricky],
    base,
  );
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), tricky);
  assert.equal(existsSync(marker), false);
});

test("a timeout stops the program and the processes it started", async () => {
  const pidFile = join(work, "grandchild.pid");
  const script = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
    setInterval(() => {}, 1000);`;
  const started = Date.now();
  const result = await runProcess(node, ["-e", script], { ...base, timeoutMs: 1500 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 10_000);
  const grandchild = Number(readFileSync(pidFile, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, process.platform === "win32" ? 2000 : 2500));
  assert.throws(() => process.kill(grandchild, 0), "the grandchild was stopped too");
});

test("output is bounded and said to be cut", async () => {
  const result = await runProcess(node, ["-e", "process.stdout.write('x'.repeat(100000))"], {
    ...base,
    maxStdoutBytes: 1000,
  });
  assert.equal(result.stdout.length, 1000);
  assert.equal(result.truncated, true);
});

test("a cancelled request stops the program", async () => {
  const controller = new AbortController();
  const pending = runProcess(node, ["-e", "setInterval(() => {}, 1000)"], {
    ...base,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 300);
  const result = await pending;
  assert.equal(result.cancelled, true);
});

test("a missing program is an error, not a crash", async () => {
  await assert.rejects(runProcess(join(work, "missing-program"), [], base), RunError);
});

test("children get a minimal environment: no token, no key", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    GITHUB_TOKEN: "gh-secret",
    NPM_TOKEN: "npm-secret",
    ANTHROPIC_API_KEY: "key",
    npm_config__authToken: "auth",
    AWS_SECRET_ACCESS_KEY: "aws",
    HTTPS_PROXY: "http://proxy.example:3128",
  });
  try {
    const plain = childEnvironment({ network: false });
    const network = childEnvironment({ network: true });
    for (const env of [plain, network]) {
      for (const name of [
        "GITHUB_TOKEN",
        "NPM_TOKEN",
        "ANTHROPIC_API_KEY",
        "npm_config__authToken",
        "AWS_SECRET_ACCESS_KEY",
      ]) {
        assert.equal(env[name], undefined, name);
      }
    }
    assert.equal(plain.HTTPS_PROXY, undefined, "the CLI never needs the network");
    assert.equal(network.HTTPS_PROXY, "http://proxy.example:3128");
    assert.ok(plain.PATH);
    const result = await runProcess(
      node,
      ["-e", "process.stdout.write(Object.keys(process.env).join(','))"],
      { ...base, env: plain },
    );
    assert.doesNotMatch(result.stdout, /TOKEN|API_KEY|SECRET/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("NO_PROXY rules", () => {
  assert.equal(bypassesProxy("github.com", "localhost,.github.com"), true);
  assert.equal(
    bypassesProxy("release-assets.githubusercontent.com", "githubusercontent.com"),
    true,
  );
  assert.equal(bypassesProxy("github.com", "example.com"), false);
  assert.equal(bypassesProxy("github.com", "*"), true);
  assert.equal(bypassesProxy("notgithub.com", "github.com"), false);
});
