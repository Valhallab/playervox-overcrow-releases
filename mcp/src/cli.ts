// Calls of the widget CLI (`overcrow-widget`) of the installed creator
// tools and the reading of its `--format json` output (one JSON object per
// line). Paths are always absolute: the CLI would read an argument starting
// with `--` as an option. The CLI never reaches the network here: `test`
// gets the runtime with `--runtime` and `--offline`. `doctor` and `dev`,
// which talk to a running OverCrow, are never called.

import type { InstalledTools } from "./bootstrap/install.js";
import { childEnvironment } from "./env.js";
import { type RunResult, runProcess } from "./run.js";

export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  help: string | null;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const MINUTE = 60_000;
export const TIMEOUTS = {
  version: 15_000,
  init: MINUTE,
  check: 6 * MINUTE,
  package: 6 * MINUTE,
  admit: 2 * MINUTE,
  inspect: MINUTE,
  test: 20 * MINUTE,
} as const;

/** Parses the JSON lines of stdout; other lines are ignored. */
export function jsonLines(stdout: string, maxLines = 5000): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    if (out.length >= maxLines) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value === "object" && value !== null && !Array.isArray(value))
        out.push(value as Record<string, unknown>);
    } catch {
      // Not a JSON line.
    }
  }
  return out;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null =>
  Number.isSafeInteger(value) ? (value as number) : null;

/** A diagnostic object of the CLI, or undefined for any other line. */
export function asDiagnostic(value: Record<string, unknown>): Diagnostic | undefined {
  if ("type" in value) return undefined;
  const severity = value.severity;
  if ((severity !== "error" && severity !== "warning") || typeof value.code !== "string")
    return undefined;
  return {
    severity,
    code: value.code,
    file: str(value.file),
    line: int(value.line),
    column: int(value.column),
    message: str(value.message) ?? "",
    help: str(value.help),
  };
}

export class Cli {
  constructor(private readonly tools: InstalledTools) {}

  private run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    return runProcess(this.tools.cli, args, {
      cwd,
      env: childEnvironment({ network: false }),
      timeoutMs,
      signal,
    });
  }

  private static failure(result: RunResult, what: string): CliError {
    if (result.timedOut)
      return new CliError(`${what} took too long and was stopped`, result.stderr);
    if (result.cancelled) return new CliError(`${what} was cancelled`, result.stderr);
    const first = result.stderr.split("\n").find((line) => line.trim() !== "") ?? "";
    return new CliError(
      `${what} failed (exit ${result.code})${first ? `: ${first}` : ""}`,
      result.stderr,
    );
  }

  /** `check <dir> --format json`: diagnostics, and whether there is no error. */
  async check(directory: string, signal?: AbortSignal) {
    const result = await this.run(
      ["check", directory, "--format", "json"],
      directory,
      TIMEOUTS.check,
      signal,
    );
    if (result.code !== 0 && result.code !== 1) throw Cli.failure(result, "check");
    const diagnostics = jsonLines(result.stdout)
      .map(asDiagnostic)
      .filter((d) => d !== undefined);
    return { ok: result.code === 0, diagnostics };
  }

  /** `package <dir> --out <file> --format json`. */
  async package(directory: string, out: string, signal?: AbortSignal) {
    const result = await this.run(
      ["package", directory, `--out=${out}`, "--format", "json"],
      directory,
      TIMEOUTS.package,
      signal,
    );
    if (result.code !== 0 && result.code !== 1) throw Cli.failure(result, "package");
    const lines = jsonLines(result.stdout);
    const diagnostics = lines.map(asDiagnostic).filter((d) => d !== undefined);
    const summary = lines.find(
      (line) => typeof line.package === "string" && typeof line.sha256 === "string",
    );
    return {
      ok: result.code === 0 && summary !== undefined,
      diagnostics,
      bytes: int(summary?.bytes),
      logicBytes: int(summary?.logicBytes),
      sha256: str(summary?.sha256),
    };
  }

  /** `admit <dir> --format json`: the static admission report, as data. */
  async admit(directory: string, signal?: AbortSignal) {
    const result = await this.run(
      ["admit", directory, "--format", "json"],
      directory,
      TIMEOUTS.admit,
      signal,
    );
    if (result.code !== 0 && result.code !== 1) throw Cli.failure(result, "admit");
    const report = jsonLines(result.stdout).find((line) => line.formatVersion === 1);
    if (!report) throw Cli.failure(result, "admit");
    return report;
  }

  /** `inspect <file> --format json`. */
  async inspect(file: string, cwd: string, signal?: AbortSignal) {
    const result = await this.run(
      ["inspect", file, "--format", "json"],
      cwd,
      TIMEOUTS.inspect,
      signal,
    );
    if (result.code === 2) throw Cli.failure(result, "inspect");
    const lines = jsonLines(result.stdout);
    const diagnostics = lines.map(asDiagnostic).filter((d) => d !== undefined);
    const report = lines.find(
      (line) => typeof line.id === "string" && typeof line.archive === "object",
    );
    return { ok: result.code === 0 && report !== undefined, diagnostics, report };
  }

  /** `test <dir> --runtime <cached runtime> --offline --format json`. */
  async test(
    directory: string,
    options: { scenario?: string | undefined; update?: boolean },
    signal?: AbortSignal,
  ) {
    const args = [
      "test",
      directory,
      `--runtime=${this.tools.runtime}`,
      "--offline",
      "--format",
      "json",
    ];
    if (options.scenario) args.push(`--scenario=${options.scenario}`);
    if (options.update) args.push("--update");
    const result = await this.run(args, directory, TIMEOUTS.test, signal);
    if (result.timedOut || result.cancelled) throw Cli.failure(result, "test");
    const lines = jsonLines(result.stdout);
    const summary = lines.find((line) => line.type === "summary");
    if (
      result.code === 2 ||
      (result.code !== 0 && !summary && lines.every((line) => line.type !== "scenario"))
    ) {
      // No scenario ran: a usage, project or runtime problem, said on stderr.
      const diagnostics = lines.map(asDiagnostic).filter((d) => d !== undefined);
      if (diagnostics.length === 0 || result.code === 2) {
        return { ran: false as const, diagnostics, problem: firstLines(result.stderr, 6) };
      }
    }
    return {
      ran: true as const,
      diagnostics: lines.map(asDiagnostic).filter((d) => d !== undefined),
      runtime: lines.find((line) => line.type === "runtime"),
      scenarios: lines.filter((line) => line.type === "scenario"),
      passed: int(summary?.passed),
      failed: int(summary?.failed),
      problem: result.code === 0 ? "" : firstLines(result.stderr, 6),
    };
  }

  /** `init <dir> --template <t> --id <id> --name <name>` (no JSON form). */
  async init(directory: string, template: string, id: string, name: string, cwd: string) {
    const result = await this.run(
      ["init", directory, `--template=${template}`, `--id=${id}`, `--name=${name}`],
      cwd,
      TIMEOUTS.init,
    );
    return {
      ok: result.code === 0,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

function firstLines(text: string, count: number): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, count)
    .join("\n");
}

/** The `--version --format json` probe used when installing the tools. */
export async function probeVersion(cli: string, cwd: string): Promise<unknown> {
  const result = await runProcess(cli, ["--version", "--format", "json"], {
    cwd,
    env: childEnvironment({ network: false }),
    timeoutMs: TIMEOUTS.version,
    maxStdoutBytes: 64 * 1024,
  });
  if (result.code !== 0) throw new CliError("the CLI did not report its version", result.stderr);
  const [report] = jsonLines(result.stdout);
  return report;
}
