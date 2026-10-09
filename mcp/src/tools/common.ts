// Helpers shared by the tools: results with structured content and a text
// copy, errors the model can act on, the confinement of each request, and
// project data marked as data.

import type {
  CallToolResult,
  ContentBlock,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import { CliError } from "../cli.js";
import type { Confinement } from "../confine.js";
import { ConfinementError } from "../confine.js";
import { NpmError } from "../npm.js";
import { RunError } from "../run.js";
import { type Session, SetupError } from "../session.js";
import { bound, DATA_NOTICE, type Redactor } from "../text.js";

export interface ToolEnv {
  session: Session;
  server: McpServer;
}

/** Most characters a text result carries; Claude Code moves larger results to a file. */
export const MAX_RESULT_CHARS = 40_000;

/**
 * A successful result: a one-line summary for people, then the structured
 * content as JSON (clients that ignore `structuredContent` still get it).
 * Results that carry project content are marked as data.
 */
export function ok(
  structured: Record<string, unknown>,
  summary: string,
  options: { data?: boolean; redactor?: Redactor; extra?: ContentBlock[] } = {},
): CallToolResult {
  const redact = (text: string) => (options.redactor ? options.redactor.text(text) : text);
  const structuredContent = options.redactor
    ? redactDeep(structured, options.redactor)
    : structured;
  const json = JSON.stringify(structuredContent);
  const body = options.data
    ? `${DATA_NOTICE}\n<data>\n${json.replaceAll("</data>", "<\\/data>")}\n</data>`
    : json;
  return {
    content: [
      { type: "text", text: bound(`${redact(summary)}\n\n${body}`, MAX_RESULT_CHARS) },
      ...(options.extra ?? []),
    ],
    structuredContent,
  };
}

/** Replaces the user's paths in every string of a JSON value. */
function redactDeep<T>(value: T, redactor: Redactor): T {
  if (typeof value === "string") return redactor.text(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redactor)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, redactor)]),
    ) as T;
  }
  return value;
}

/** A failure the model can correct: what went wrong and what to do. */
export function fail(message: string, redactor?: Redactor): CallToolResult {
  return {
    content: [{ type: "text", text: bound(redactor ? redactor.text(message) : message, 4000) }],
    isError: true,
  };
}

/** Turns the expected errors into tool failures; anything else is rethrown. */
export function failure(error: unknown, redactor?: Redactor): CallToolResult {
  if (
    error instanceof ConfinementError ||
    error instanceof SetupError ||
    error instanceof NpmError ||
    error instanceof RunError
  ) {
    return fail(error.message, redactor);
  }
  if (error instanceof CliError) {
    const detail = error.stderr
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(0, 8)
      .join("\n");
    return fail(`${error.message}${detail ? `\n${DATA_NOTICE}\n${detail}` : ""}`, redactor);
  }
  throw error;
}

export const TOOLS_MISSING =
  "The creator tools (the widget CLI and its test runtime) are not installed on this computer yet: run the setup tool first. It downloads them once (about 15 MB) and checks them.";

type Handler = (confinement: Confinement, redactor: Redactor) => Promise<CallToolResult>;

/**
 * Runs `handler` with the project folders of this request. When the
 * client's roots are needed and not known yet, returns the input request
 * that asks for them; the client then retries the call.
 */
export async function withRoots(env: ToolEnv, ctx: ServerContext, handler: Handler) {
  const answer = await env.session.roots(ctx, env.server);
  if ("input" in answer) return answer.input;
  if ("error" in answer) return fail(answer.error);
  const redactor = env.session.redactor(answer.confinement);
  try {
    return await handler(answer.confinement, redactor);
  } catch (error) {
    return failure(error, redactor);
  }
}

/** Sends a progress notification when the client asked for them. */
export function progress(
  ctx: ServerContext,
): ((done: number, total: number, message?: string) => void) | undefined {
  const token = (ctx.mcpReq._meta as { progressToken?: string | number } | undefined)
    ?.progressToken;
  if (token === undefined) return undefined;
  return (done, total, message) => {
    ctx.mcpReq
      .notify({
        method: "notifications/progress",
        params: { progressToken: token, progress: done, total, ...(message ? { message } : {}) },
      })
      .catch(() => undefined);
  };
}

/** Annotations, spelled out for every tool (no default is relied on). */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
