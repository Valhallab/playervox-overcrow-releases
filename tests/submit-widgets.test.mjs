// scripts/submit-widgets.mjs, the submit job of the PlayerVox widgets, run
// against a stand-in for `overcrow-widget submit` on scratch widgets, and
// the workflow that runs it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "submit-widgets.mjs");
const KEY = "ocw_pub_q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";
const SECRET = KEY.slice("ocw_pub_".length);

// Answers as `submit --format json` does, from the widget's fake.json; logs
// its arguments and whether it got the key.
const FAKE_CLI = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const plan = JSON.parse(readFileSync(join(args[1], "fake.json"), "utf8"));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, key: process.env.OVERCROW_PUBLISH_KEY === ${JSON.stringify(KEY)} }) + "\\n");
if (plan.sleep) await new Promise((done) => setTimeout(done, plan.sleep));
if (plan.stderr) process.stderr.write(plan.stderr);
process.stdout.write(typeof plan.stdout === "string" ? plan.stdout : JSON.stringify(plan.report) + "\\n");
process.exit(plan.code);
`;

const PUBLISHED = {
  code: 0,
  report: { outcome: "already_known", exitCode: 0, known: { versionId: 7, state: "published", match: "sources" },
    version: { version: "1.0.2", state: "published" } },
};
const WAITING = {
  code: 3,
  report: { outcome: "complete_in_portal", exitCode: 3, local: { version: "1.0.3" },
    version: { version: "1.0.3", state: "ready",
      reviewBlockers: [{ code: "listing_incomplete", missing: ["description.en", "support"] }],
      completeInPortal: { message: "To complete in the creator space.",
        url: "https://creators.playervox.com/widgets/com.playervox.overcrow.fps/versions/12" } } },
};
const REFUSED = {
  code: 1,
  report: { outcome: "refused_locally", exitCode: 1, local: { version: "3.1.0",
    diagnostics: [{ severity: "error", code: "submit.justification_missing", message: "a justification is needed for each new permission: storage",
      file: null, line: null, column: null, help: null }] } },
};
const IN_REVIEW = {
  code: 0,
  report: { outcome: "in_review", exitCode: 0, submission: { id: 3 }, version: { version: "1.0.4", state: "in_review", reviewType: "quick" } },
};

/** Scratch widgets (name → plan, with an optional submission.json), the fake CLI and its log. */
function scratch(widgets, { submissions = [] } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "overcrow-submit-"));
  const cli = join(folder, "fake-cli.mjs");
  writeFileSync(cli, FAKE_CLI);
  chmodSync(cli, 0o755);
  const tree = join(folder, "widgets");
  for (const [name, plan] of Object.entries(widgets)) {
    mkdirSync(join(tree, name), { recursive: true });
    writeFileSync(join(tree, name, "manifest.json"), JSON.stringify({ id: `com.playervox.overcrow.${name}`, version: "1.0.0" }));
    writeFileSync(join(tree, name, "fake.json"), JSON.stringify(plan));
    if (submissions.includes(name)) writeFileSync(join(tree, name, "submission.json"), "{}");
  }
  mkdirSync(join(tree, "not-a-widget"));
  return { folder, cli, tree, log: join(folder, "log.jsonl"), summary: join(folder, "summary.md") };
}

function run(setup, extra = [], env = {}) {
  const result = spawnSync(process.execPath, [script, "--cli", setup.cli, "--widgets", setup.tree, ...extra], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, FAKE_LOG: setup.log, OVERCROW_PUBLISH_KEY: KEY, GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: setup.summary, GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "Valhallab/playervox-overcrow-releases", GITHUB_RUN_ID: "42", ...env },
  });
  const calls = readFileSync(setup.log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  let summary = "";
  try {
    summary = readFileSync(setup.summary, "utf8");
  } catch {
    summary = "";
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, summary };
}

test("each widget gets one line, in order, and a known version sends nothing", () => {
  const setup = scratch({ clock: PUBLISHED, fps: IN_REVIEW });
  try {
    const { status, stdout, calls, summary } = run(setup);
    assert.equal(status, 0, stdout);
    const lines = stdout.split("\n").filter((line) => line.startsWith("clock") || line.startsWith("fps"));
    assert.equal(lines.length, 2, stdout);
    assert.match(lines[0], /^clock +1\.0\.2 +already published in the creator space: nothing sent$/);
    assert.match(lines[1], /^fps +1\.0\.4 +sent: in review \(quick review\)$/);
    assert.deepEqual(calls.map((call) => call.args[1].split("/").pop()), ["clock", "fps"]);
    assert.ok(calls.every((call) => call.key), "the CLI gets the key from the environment");
    assert.match(summary, /\| Widget \| Version \| Result \|/);
    assert.match(summary, /\| clock \| 1\.0\.2 \| already published in the creator space: nothing sent \|/);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("a version waiting in the creator space is a warning, not a failure", () => {
  const setup = scratch({ fps: WAITING });
  try {
    const { status, stdout } = run(setup);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /^fps +1\.0\.3 +sent: waiting in the creator space: listing_incomplete \(description\.en, support\) → https:\/\/creators\.playervox\.com\/widgets\/com\.playervox\.overcrow\.fps\/versions\/12$/m);
    assert.match(stdout, /^::warning title=fps::sent: waiting in the creator space/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("a dry run and a version sent before name what the creator space waits for", () => {
  const dryRun = {
    code: 3,
    report: { outcome: "complete_in_portal", exitCode: 3, local: { version: "1.0.3" },
      requirements: { blockers: [{ code: "listing_incomplete" }] } },
  };
  const sentBefore = {
    code: 3,
    report: { outcome: "already_known", exitCode: 3, known: { versionId: 12, state: "ready", match: "sources" },
      version: WAITING.report.version },
  };
  const setup = scratch({ alpha: dryRun, beta: sentBefore });
  try {
    const { stdout } = run(setup, ["--dry-run"]);
    assert.match(stdout, /^alpha +1\.0\.3 +would wait in the creator space for listing_incomplete \(dry run\)$/m);
    assert.match(stdout, /^beta +1\.0\.3 +already sent, waiting in the creator space for listing_incomplete \(description\.en, support\) → https:\/\/creators\.playervox\.com\/widgets\/com\.playervox\.overcrow\.fps\/versions\/12: nothing sent$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("once the checks do not end, the next widgets do not wait for theirs", () => {
  const stuck = {
    code: 4,
    report: { outcome: "checking", exitCode: 4, version: { version: "1.0.3", state: "checking" } },
  };
  const setup = scratch({ alpha: stuck, beta: IN_REVIEW, gamma: PUBLISHED });
  try {
    const { status, stdout, calls } = run(setup);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /^alpha +1\.0\.3 +sent: still being checked; the creator space e-mails the result$/m);
    assert.match(stdout, /^::warning title=alpha::/m);
    const [alpha, beta, gamma] = calls.map((call) => call.args);
    assert.ok(!alpha.includes("--no-wait"));
    assert.ok(beta.includes("--no-wait") && gamma.includes("--no-wait"));
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("a known version followed to its end, or awaiting an answer, reads as known", () => {
  const followed = {
    code: 0,
    report: { outcome: "in_review", exitCode: 0, known: { versionId: 4, state: "checking", match: "sources" },
      version: { version: "1.0.3", state: "in_review", reviewType: "full" } },
  };
  const answer = {
    code: 0,
    report: { outcome: "already_known", exitCode: 0, known: { versionId: 5, state: "changes_requested", match: "sources" },
      version: { version: "1.0.2", state: "changes_requested" } },
  };
  const setup = scratch({ alpha: followed, beta: answer });
  try {
    const { status, stdout } = run(setup);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /^alpha +1\.0\.3 +already sent, checked since: in review \(full review\): nothing sent$/m);
    assert.match(stdout, /^beta +1\.0\.2 +already in review, changes requested in the creator space: nothing sent$/m);
    assert.match(stdout, /^::warning title=beta::/m);
    assert.ok(!/^::warning title=alpha::/m.test(stdout));
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("a CLI that runs too long is stopped and said so", () => {
  const setup = scratch({ slow: { ...PUBLISHED, sleep: 3000 } });
  try {
    const { status, stdout } = run(setup, ["--cli-timeout", "1"]);
    assert.equal(status, 1);
    assert.match(stdout, /^slow +1\.0\.0 +error: overcrow-widget was stopped after 1 seconds$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("a refusal fails the run after every widget ran", () => {
  const setup = scratch({ alpha: REFUSED, beta: PUBLISHED });
  try {
    const { status, stdout, calls } = run(setup);
    assert.equal(status, 1, stdout);
    assert.equal(calls.length, 2);
    assert.match(stdout, /^alpha +3\.1\.0 +refused before sending: a justification is needed for each new permission: storage$/m);
    assert.match(stdout, /^::error title=alpha::refused before sending/m);
    assert.match(stdout, /^1 of 2 widgets need attention\.$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("the arguments: texts file when there is one, dry run, review message, never the key", () => {
  const setup = scratch({ clock: PUBLISHED, fps: PUBLISHED }, { submissions: ["fps"] });
  try {
    const { calls } = run(setup, ["--dry-run"]);
    const [clock, fps] = calls.map((call) => call.args);
    assert.equal(clock[0], "submit");
    assert.ok(!clock.includes("--submission"));
    assert.equal(fps[fps.indexOf("--submission") + 1], join(setup.tree, "fps", "submission.json"));
    for (const args of [clock, fps]) {
      assert.ok(args.includes("--dry-run"));
      assert.deepEqual(args.slice(args.indexOf("--format"), args.indexOf("--format") + 2), ["--format", "json"]);
      assert.equal(args[args.indexOf("--review-message") + 1],
        "Sent by the releases CI from 0123456789ab (https://github.com/Valhallab/playervox-overcrow-releases/actions/runs/42)");
      assert.ok(!args.join(" ").includes(SECRET), "never the key on a command line");
      assert.ok(!args.includes("--verbose"));
    }
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("the key never appears, whatever the CLI prints", () => {
  const leaking = {
    code: 2,
    stderr: `overcrow-widget: oops ${KEY} and ${SECRET}\n`,
    report: { outcome: "error", exitCode: 2, error: { code: "server", message: `the server echoed ${KEY}` } },
  };
  const setup = scratch({ leak: leaking });
  try {
    const { status, stdout, stderr, summary } = run(setup);
    assert.equal(status, 1);
    for (const [name, text] of [["stdout", stdout], ["stderr", stderr], ["summary", summary]]) {
      assert.ok(!text.includes(SECRET), `the key in ${name}: ${text}`);
    }
    assert.match(stdout, /^leak +1\.0\.0 +error: the server echoed ocw_pub_…$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("an answer that is not one JSON object is an error", () => {
  const setup = scratch({ odd: { code: 0, stdout: "not json\n" } });
  try {
    const { status, stdout } = run(setup);
    assert.equal(status, 1);
    assert.match(stdout, /^odd +1\.0\.0 +error: overcrow-widget gave no JSON answer \(status 0\)$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("annotations escape what GitHub would read as commands", () => {
  const sneaky = {
    code: 1,
    report: { outcome: "refused", exitCode: 1, local: { version: "1.0.0" },
      error: { code: "validation_failed", message: "bad%value\n::set-output name=x::y" } },
  };
  const setup = scratch({ sneaky });
  try {
    const { stdout } = run(setup);
    assert.ok(!/^::set-output/m.test(stdout), stdout);
    assert.match(stdout, /^::error title=sneaky::refused by the creator space: bad%25value%0A::set-output name=x::y$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});

test("the workflow submits from main only, with the key in one step", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "submit.yml"), "utf8");
  assert.ok(!/pull_request/.test(workflow), "never on pull requests");
  assert.match(workflow, /^ {4}branches: \[main\]$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(workflow, /^ {4}environment: overcrow-submit$/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /^ {4}timeout-minutes: 60$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /vars\.OVERCROW_SUBMIT == 'on'/);
  assert.equal(workflow.match(/secrets\./g)?.length, 1, "the key is read once");
  const step = workflow.slice(workflow.indexOf("- name: Submit the widgets"));
  assert.match(step, /OVERCROW_PUBLISH_KEY: \$\{\{ secrets\.OVERCROW_PUBLISH_KEY \}\}/);
  assert.ok(!/set -x|--verbose/.test(workflow));
  for (const use of workflow.match(/uses: \S+/g) ?? []) {
    assert.match(use, /@[0-9a-f]{40}$/, `${use} is pinned to a commit`);
  }
});

test("a held widget is never submitted, and the run says why", () => {
  const setup = scratch({ clock: PUBLISHED, "steam-achievements": IN_REVIEW, "twitch-goals": IN_REVIEW });
  try {
    const { status, stdout, calls, summary } = run(setup);
    assert.equal(status, 0, stdout);
    assert.deepEqual(calls.map((call) => call.args[1].split("/").pop()), ["clock"]);
    assert.match(stdout, /^steam-achievements +1\.0\.0 +held: enters the catalog with the release that ships its host features$/m);
    assert.match(summary, /\| steam-achievements \| 1\.0\.0 \| held: enters the catalog with the release that ships its host features \|/);
    assert.match(stdout, /^twitch-goals +1\.0\.0 +held: enters the catalog with the release that ships its host features$/m);
  } finally {
    rmSync(setup.folder, { recursive: true, force: true });
  }
});
