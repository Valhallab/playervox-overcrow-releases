// audit: the review of a widget's security and lightness, before it is
// submitted.

import { z } from "zod";
import { auditWidget, type Finding } from "../audit/index.js";
import { Cli } from "../cli.js";
import { limit } from "../content.js";
import { DESCRIPTIONS } from "../texts.js";
import { ok, READ_ONLY, type ToolEnv, widgetDirectory, withRoots } from "./common.js";

const DIRECTORY = z
  .string()
  .min(1)
  .max(1024)
  .describe("The widget folder (it holds manifest.json), relative to the project folder.");
const KIB = 1024;

const findingSchema = z.object({
  rule: z.string(),
  area: z.enum(["security", "lightness"]),
  severity: z.enum(["high", "medium", "low"]),
  file: z.string().nullable(),
  line: z.number().nullable(),
  message: z.string(),
  fix: z.string(),
  example: z
    .object({
      widget: z.string(),
      file: z.string(),
      line: z.number(),
      excerpt: z.string(),
      resource: z.string(),
    })
    .optional(),
});

/** Findings that need the package: the size of logic.js and of the archive. */
function sizeFindings(report: Record<string, unknown>): Finding[] {
  const pkg = (report.package ?? {}) as {
    bytes?: unknown;
    files?: Record<string, { bytes?: unknown }>;
  };
  const out: Finding[] = [];
  const logic = Number(pkg.files?.["logic.js"]?.bytes ?? 0);
  const maxLogic = limit("MAX_LOGIC_BYTES");
  if (logic > 128 * KIB) {
    out.push({
      rule: "large-logic",
      area: "lightness",
      severity: logic > 256 * KIB ? "medium" : "low",
      file: "logic.ts",
      line: null,
      message: `logic.js, the logic once bundled, is ${Math.round(logic / KIB)} KiB (limit ${maxLogic / KIB} KiB): it is parsed at each start and stays in memory.`,
      fix: "Remove unused code and large constant data; keep only what the widget shows.",
    });
  }
  const bytes = Number(pkg.bytes ?? 0);
  if (bytes > 1024 * KIB) {
    out.push({
      rule: "large-package",
      area: "lightness",
      severity: bytes > 4096 * KIB ? "medium" : "low",
      file: null,
      line: null,
      message: `The package is ${Math.round(bytes / KIB)} KiB: every user downloads it and OverCrow checks it at each start.`,
      fix: "Shrink the images in assets/ and drop the unused ones.",
    });
  }
  return out;
}

export function registerAuditTools(env: ToolEnv): void {
  const { server, session } = env;

  server.registerTool(
    "audit",
    {
      title: "Audit a widget",
      description: DESCRIPTIONS.audit,
      inputSchema: z.strictObject({ directory: DIRECTORY }),
      outputSchema: z.object({
        directory: z.string(),
        id: z.string().nullable(),
        version: z.string().nullable(),
        scores: z.object({ security: z.number(), lightness: z.number() }),
        verdicts: z.object({ security: z.string(), lightness: z.string() }),
        counts: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
        findings: z.array(findingSchema),
        authority: z.array(z.string()),
        notes: z.array(z.string()),
      }),
      annotations: { title: "Audit a widget", ...READ_ONLY },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const target = await widgetDirectory(confinement, directory);
        const tools = await session.installedTools();
        const extra: { findings: Finding[]; notes: string[] } = { findings: [], notes: [] };
        if (tools) {
          const report = await new Cli(tools)
            .admit(target, ctx.mcpReq.signal)
            .catch(() => undefined);
          if (report?.package) extra.findings.push(...sizeFindings(report));
          else
            extra.notes.push(
              "The package could not be built (run check): its size was not measured.",
            );
        } else {
          extra.notes.push(
            "The creator tools are not installed (run setup): the package size was not measured.",
          );
        }
        const result = await auditWidget(target, extra);
        const summary = `Security ${result.scores.security}/100 (${result.verdicts.security}), lightness ${result.scores.lightness}/100 (${result.verdicts.lightness}): ${result.counts.high} high, ${result.counts.medium} medium, ${result.counts.low} low.`;
        return ok({ directory: confinement.display(target), ...result }, summary, {
          data: true,
          redactor,
        });
      }),
  );
}
