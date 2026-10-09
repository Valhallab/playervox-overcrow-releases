// Starts the programs the server relies on (the widget CLI, npm) and
// nothing else: no shell, arguments as an array, a minimal environment,
// stdin closed, a time limit, bounded output, and the whole process tree
// stopped on timeout or when the server exits.

import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { windowsSystemRoot } from "./env.js";

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal | undefined;
}

export interface RunResult {
  /** Exit code, or null when the process was stopped by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** True when stdout or stderr went past its bound and was cut. */
  truncated: boolean;
}

export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunError";
  }
}

const running = new Set<ChildProcess>();

/** Stops every process still running (the server is exiting). */
export function stopAll(): void {
  for (const child of running) stopTree(child);
}

function stopTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // taskkill by its full path: the PATH is not trusted for this.
    const killer = spawn(
      join(windowsSystemRoot(), "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true, shell: false },
    );
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }
  try {
    // The child leads its own process group (detached): stop all of it.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const pid = child.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 2000).unref();
}

/** Runs `file` with `args` and collects its output. */
export function runProcess(
  file: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  const maxStdout = options.maxStdoutBytes ?? 8 << 20;
  const maxStderr = options.maxStderrBytes ?? 1 << 20;
  return new Promise<RunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(file, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new RunError(`cannot start ${file}: ${(error as Error).message}`));
      return;
    }
    running.add(child);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    const collect = (chunks: Buffer[], max: number, size: number, chunk: Buffer): number => {
      if (size >= max) {
        truncated = true;
        return size;
      }
      const room = max - size;
      if (chunk.length > room) truncated = true;
      chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      return size + Math.min(chunk.length, room);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes = collect(stdout, maxStdout, stdoutBytes, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = collect(stderr, maxStderr, stderrBytes, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, options.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      stopTree(child);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      running.delete(child);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new RunError(`cannot start ${file}: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      running.delete(child);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        cancelled,
        truncated,
      });
    });
  });
}
