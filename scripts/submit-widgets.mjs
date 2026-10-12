// Submits every widget of widgets/ to the OverCrow creator space, one after
// the other, with `overcrow-widget submit` (the overcrow-submit workflow,
// after each merge on main). A version the creator space already has is
// not sent again: the run reports its state. One line per widget; on
// GitHub Actions, a warning for a version waiting in the creator space, an
// error for one refused or a problem, and a table in the job summary.
//
//   node scripts/submit-widgets.mjs --cli PATH [--dry-run] [--widgets DIR]
//
// The publish key is read by the CLI from OVERCROW_PUBLISH_KEY, never
// passed on a command line, and masked in everything this script prints.
// The run fails (status 1) when a widget ended with 1, 2 or 4, or with an
// answer that could not be read; a version waiting in the creator space
// (status 3) does not fail it: what it waits for is done there.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEY_PATTERN = /ocw_pub_[A-Za-z0-9_-]+/g;
/** Long enough for checks followed for 15 minutes, and the upload. */
const CLI_TIMEOUT_MS = 20 * 60 * 1000;

const STATE_WORDS = {
  published: "published",
  approved: "approved",
  in_review: "in review",
  changes_requested: "in review, changes requested",
  ready: "waiting there",
  checking: "being checked",
  checks_failed: "refused by its checks",
  rejected: "rejected",
  withdrawn: "withdrawn",
  suspended: "suspended",
  superseded: "superseded",
  discarded: "discarded",
};

/** The text with any publish key, and the given secret, masked. */
export function mask(text, secret = "") {
  let masked = String(text).replace(KEY_PATTERN, "ocw_pub_…");
  const bare = secret.startsWith("ocw_pub_") ? secret.slice("ocw_pub_".length) : secret;
  for (const value of [secret, bare]) {
    if (value.length >= 8) masked = masked.split(value).join("…");
  }
  return masked;
}

/**
 * One line of the log: what came from the CLI stays on its line, and never
 * starts like a GitHub workflow command (`::…`).
 */
export function logLine(text) {
  return String(text).replace(/[\r\n]+/g, " ").replace(/^(\s*)::/, "$1: :");
}

/** A value of a GitHub workflow command (`::warning::…`). */
export function commandData(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** A property of a GitHub workflow command (`title=…`). */
function commandProperty(text) {
  return commandData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function blockers(version) {
  return (version?.reviewBlockers ?? [])
    .map((blocker) => {
      const missing = Array.isArray(blocker.missing) && blocker.missing.length > 0 ? ` (${blocker.missing.join(", ")})` : "";
      const permissions = Array.isArray(blocker.permissions) && blocker.permissions.length > 0 ? ` (${blocker.permissions.join(", ")})` : "";
      return `${blocker.code}${missing}${permissions}`;
    })
    .join(", ");
}

function waiting(version) {
  const what = blockers(version);
  const url = version?.completeInPortal?.url;
  return `${what || "to complete"}${url ? ` → ${url}` : ""}`;
}

function errorDiagnostics(report) {
  return (report.local?.diagnostics ?? [])
    .filter((diagnostic) => diagnostic?.severity === "error")
    .map((diagnostic) => diagnostic.message)
    .join("; ");
}

function checkProblems(version) {
  return (version?.checks ?? [])
    .flatMap((check) => check.diagnostics ?? [])
    .filter((diagnostic) => diagnostic?.severity !== "warning")
    .map((diagnostic) => `${diagnostic.file ? `${diagnostic.file}: ` : ""}${diagnostic.message}`)
    .join("; ");
}

/** One sentence for a run of `submit --format json` that ended with `code`. */
export function describe(report, code, dryRun) {
  const version = report.version;
  const state = version?.state ?? "";
  switch (report.outcome) {
    case "already_known": {
      const known = report.known?.state ?? state;
      if (known === "ready") return `already sent, waiting in the creator space for ${waiting(version)}: nothing sent`;
      return `already ${STATE_WORDS[known] ?? known} in the creator space: nothing sent`;
    }
    case "ready_to_send":
      return "would be sent (dry run)";
    case "complete_in_portal": {
      if (!dryRun) return `sent: waiting in the creator space: ${waiting(version)}`;
      const codes = (report.requirements?.blockers ?? []).map((blocker) => blocker.code).join(", ");
      return `would wait in the creator space${codes ? ` for ${codes}` : ""} (dry run)`;
    }
    case "refused_locally":
      return `refused before sending: ${errorDiagnostics(report) || report.error?.message || "see the log"}`;
    case "refused":
      return `refused by the creator space: ${report.error?.message ?? "see the log"}`;
    case "checks_failed":
      return `sent: refused by its checks: ${checkProblems(version) || "see the creator space"}`;
    case "checking":
      return "sent: still being checked in the creator space";
    case "error":
      return `error: ${report.error?.message ?? report.error?.code ?? "see the log"}`;
    default:
      if (STATE_WORDS[report.outcome]) {
        const review = version?.reviewType ? ` (${version.reviewType} review)` : "";
        return `sent: ${STATE_WORDS[report.outcome]}${review}`;
      }
      return `ended with status ${code}`;
  }
}

function widgetFolders(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "manifest.json")))
    .map((entry) => entry.name)
    .sort();
}

/** The version in the widget's manifest.json, when the CLI did not say. */
function manifestVersion(folder) {
  try {
    const version = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")).version;
    return typeof version === "string" ? version : "?";
  } catch {
    return "?";
  }
}

function reviewMessage(env) {
  if (env.GITHUB_SHA && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    const run = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
    return `Sent by the releases CI from ${env.GITHUB_SHA.slice(0, 12)} (${run})`;
  }
  return "Sent by the releases submit script";
}

function parseArguments(argv) {
  const options = { cli: null, dryRun: false, widgets: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cli") options.cli = argv[++index];
    else if (argument === "--widgets") options.widgets = argv[++index];
    else if (argument === "--dry-run") options.dryRun = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!options.cli) throw new Error("--cli PATH is required");
  return options;
}

export function main(argv, env = process.env) {
  const options = parseArguments(argv);
  const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(options.widgets ?? join(repository, "widgets"));
  const secret = env.OVERCROW_PUBLISH_KEY?.trim() ?? "";
  const actions = env.GITHUB_ACTIONS === "true";
  const say = (line) => process.stdout.write(`${logLine(mask(line, secret))}\n`);
  const rows = [];
  let failed = 0;
  const folders = widgetFolders(root);
  for (const name of folders) {
    const folder = join(root, name);
    const args = ["submit", folder, "--format", "json", "--review-message", reviewMessage(env)];
    const submission = join(folder, "submission.json");
    if (existsSync(submission)) args.push("--submission", submission);
    if (options.dryRun) args.push("--dry-run");
    const result = spawnSync(resolve(options.cli), args, {
      encoding: "utf8",
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: CLI_TIMEOUT_MS,
    });
    const code = result.status;
    let report = null;
    try {
      const parsed = JSON.parse(result.stdout ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) report = parsed;
    } catch {
      report = null;
    }
    let text;
    let level = null;
    if (report === null) {
      text = result.error ? `error: overcrow-widget did not run (${result.error.code ?? result.error.message})` : `error: overcrow-widget gave no JSON answer (status ${code})`;
      level = "error";
    } else {
      text = describe(report, code, options.dryRun);
      if (code === 3) level = "warning";
      else if (code !== 0) level = "error";
    }
    const version = report?.version?.version ?? report?.local?.version ?? manifestVersion(folder);
    say(`${name.padEnd(18)} ${String(version).padEnd(7)} ${text}`);
    for (const line of (result.stderr ?? "").split("\n").filter((line) => line.trim() !== "")) {
      say(`    ${line}`);
    }
    if (level === "error") failed += 1;
    if (actions && level) {
      process.stdout.write(`::${level} title=${commandProperty(name)}::${commandData(mask(text, secret))}\n`);
    }
    rows.push([name, String(version), text]);
  }
  if (failed > 0) say(`${failed} of ${folders.length} widgets need attention.`);
  if (env.GITHUB_STEP_SUMMARY) {
    const cell = (value) => mask(value, secret).replaceAll("|", "\\|").replaceAll("\n", " ");
    const table = [
      `## ${options.dryRun ? "Dry run: " : ""}PlayerVox widgets in the creator space`,
      "",
      "| Widget | Version | Result |",
      "| --- | --- | --- |",
      ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      "",
    ].join("\n");
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${table}\n`);
  }
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`submit-widgets: ${mask(error.message, process.env.OVERCROW_PUBLISH_KEY ?? "")}\n`);
    process.exitCode = 2;
  }
}
