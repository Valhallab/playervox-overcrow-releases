// audit and prepare_submission: the review a widget gets before it is
// submitted, and the pull request text. Nothing is pushed or published.

import { basename } from "node:path";
import { z } from "zod";
import { auditWidget, type Finding } from "../audit/index.js";
import { Cli } from "../cli.js";
import { limit } from "../content.js";
import { cleanLine } from "../text.js";
import { DESCRIPTIONS } from "../texts.js";
import { ok, READ_ONLY, type ToolEnv, withRoots } from "./common.js";
import { widgetDirectory } from "./build.js";
import { idProblem } from "./project.js";

interface ListingFacts {
  spdxLicense?: unknown;
  preview?: unknown;
}

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

  server.registerTool(
    "prepare_submission",
    {
      title: "Prepare the submission",
      description: DESCRIPTIONS.prepare_submission,
      inputSchema: z.strictObject({ directory: DIRECTORY }),
      outputSchema: z.object({
        directory: z.string(),
        ready: z.boolean(),
        checklist: z.array(
          z.object({
            item: z.string(),
            status: z.enum(["pass", "fail", "todo"]),
            detail: z.string(),
          }),
        ),
        pullRequest: z.object({
          repository: z.string(),
          base: z.string(),
          title: z.string(),
          body: z.string(),
        }),
        commands: z.object({ shell: z.string(), lines: z.array(z.string()) }),
        notes: z.array(z.string()),
      }),
      annotations: { title: "Prepare the submission", ...READ_ONLY },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const target = await widgetDirectory(confinement, directory);
        const tools = await session.installedTools();
        const checklist: { item: string; status: "pass" | "fail" | "todo"; detail: string }[] = [];
        const audit = await auditWidget(target);
        const id = audit.id ?? "";
        const idIssue =
          idProblem(id) ??
          (/^(com|org|net)\.example\./.test(id)
            ? "The ID uses example.*: choose one under a domain you control."
            : undefined);
        checklist.push({
          item: "Widget ID",
          status: idIssue ? "fail" : "pass",
          detail: idIssue ?? `${id}: keep it for every version.`,
        });
        let admitted = false;
        let review: Record<string, unknown>[] = [];
        let listingInfo: ListingFacts | null = null;
        if (tools) {
          const cli = new Cli(tools);
          const check = await cli.check(target, ctx.mcpReq.signal);
          const errors = check.diagnostics.filter((d) => d.severity === "error").length;
          const warnings = check.diagnostics.filter((d) => d.severity === "warning").length;
          checklist.push({
            item: "check: no error, no warning",
            status: errors + warnings === 0 ? "pass" : "fail",
            detail:
              errors + warnings === 0
                ? "Clean."
                : `${errors} error(s), ${warnings} warning(s): the marketplace CI refuses warnings too.`,
          });
          const report = await cli.admit(target, ctx.mcpReq.signal);
          const diagnostics = Array.isArray(report.diagnostics)
            ? (report.diagnostics as { code?: unknown; message?: unknown; severity?: unknown }[])
            : [];
          admitted = report.admitted === true && !diagnostics.some((d) => d.severity === "warning");
          review = Array.isArray(report.review) ? (report.review as Record<string, unknown>[]) : [];
          listingInfo = (report.listing ?? null) as ListingFacts | null;
          checklist.push({
            item: "Static admission (what the marketplace CI runs)",
            status: admitted ? "pass" : "fail",
            detail: admitted
              ? "Admitted."
              : diagnostics
                  .slice(0, 8)
                  .map(
                    (d) =>
                      `${cleanLine(String(d.code ?? ""), 48)}: ${cleanLine(String(d.message ?? ""), 200)}`,
                  )
                  .join("; ") || "Refused.",
          });
          checklist.push({
            item: "listing.json and preview",
            status: listingInfo ? (listingInfo.preview ? "pass" : "todo") : "fail",
            detail: listingInfo
              ? listingInfo.preview
                ? `License ${String(listingInfo.spdxLicense)}, preview ${String(listingInfo.preview)}.`
                : "No preview: add a 4:3 PNG under assets/ rendered at 150 % by a scenario, and name it in listing.json."
              : "listing.json is missing or invalid: it holds the marketplace text (read_doc publishing).",
          });
        } else {
          checklist.push({
            item: "check and static admission",
            status: "todo",
            detail: "Run setup: the creator tools are needed to run them.",
          });
        }
        const high = audit.findings.filter(
          (finding) => finding.severity === "high" && finding.rule !== "reserved-id",
        );
        checklist.push({
          item: "Audit: no high finding",
          status: high.length === 0 ? "pass" : "fail",
          detail:
            high.length === 0
              ? `Security ${audit.scores.security}/100, lightness ${audit.scores.lightness}/100.`
              : high
                  .map((f) => f.message)
                  .slice(0, 5)
                  .join(" "),
        });
        checklist.push({
          item: "Tests pass",
          status: "todo",
          detail: "Run test: every scenario must pass with its reference images.",
        });
        checklist.push({
          item: "LICENSE",
          status: audit.findings.some((f) => f.rule === "license-missing") ? "fail" : "pass",
          detail: "LICENSE must match listing.json spdxLicense; bundled assets keep their notices.",
        });

        const folder = basename(target);
        const slug = /^[a-z0-9][a-z0-9-]{0,63}$/.test(folder)
          ? folder
          : (id.split(".").pop() ?? "my-widget");
        const authority = review.length > 0 ? review.map(describeReview) : audit.authority;
        const ready = checklist.every(
          (entry) =>
            entry.status === "pass" || (entry.item === "Tests pass" && entry.status === "todo"),
        );
        const title = `Add ${slug} ${audit.version ?? ""}`.trim();
        const body = [
          `Submits \`widgets/${slug}/\`: ${id} ${audit.version ?? ""}.`,
          "",
          "## What the widget may do",
          ...authority.map((line) => `- ${line}`),
          "",
          "## Checks run before submitting",
          ...checklist.map((entry) => `- [${entry.status === "pass" ? "x" : " "}] ${entry.item}`),
          "",
          "Sources only: the maintainers rebuild the package from these sources. Nothing is published by this pull request.",
        ].join("\n");
        const windows = process.platform === "win32";
        const source =
          confinement.roots.length === 1
            ? `<project>/${confinement.display(target)}`
            : `<${confinement.display(target)}>`;
        const lines = [
          "# 1. On GitHub, fork Valhallab/playervox-overcrow-releases, then:",
          "git clone https://github.com/YOUR-ACCOUNT/playervox-overcrow-releases.git",
          "cd playervox-overcrow-releases",
          "git fetch https://github.com/Valhallab/playervox-overcrow-releases.git candidate",
          `git switch -c widget/${slug} FETCH_HEAD`,
          "# 2. Copy the widget's sources (not node_modules, dist or tests/output):",
          windows
            ? `robocopy "${source}" "widgets\\${slug}" /E /XD node_modules dist output`
            : `rsync -a --exclude node_modules --exclude dist --exclude tests/output "${source}/" "widgets/${slug}/"`,
          `git add widgets/${slug}`,
          `git commit -m "${title}"`,
          `git push origin widget/${slug}`,
          "# 3. On GitHub, open a pull request to Valhallab/playervox-overcrow-releases, base branch: candidate.",
        ];
        return ok(
          {
            directory: confinement.display(target),
            ready,
            checklist,
            pullRequest: {
              repository: "Valhallab/playervox-overcrow-releases",
              base: "candidate",
              title,
              body,
            },
            commands: { shell: windows ? "PowerShell" : "sh", lines },
            notes: [
              "This tool pushes, signs and publishes nothing: run the commands yourself after reading them.",
              "In the commands, replace <project> with the project folder and YOUR-ACCOUNT with your GitHub account.",
              "Publication is a separate step of the maintainers after review (read_doc publishing).",
            ],
          },
          ready
            ? "Ready to submit: read the checklist, then run the commands."
            : "Not ready yet: fix the failed items first.",
          { data: true, redactor },
        );
      }),
  );
}

function describeReview(item: Record<string, unknown>): string {
  switch (item.kind) {
    case "capability":
      return `Capability ${cleanLine(String(item.name), 64)}${item.sensitive ? " (sensitive)" : ""}${item.account ? `, needs a ${cleanLine(String(item.account), 32)} account` : ""}.`;
    case "network":
      return `Network: ${cleanLine(String(item.method), 8)} ${cleanLine(String(item.origin), 200)}${cleanLine(String(item.path), 300)}, responses up to ${Number(item.maxResponseBytes)} bytes.`;
    case "clipboardWrite":
      return "Clipboard: writes text when the user acts.";
    case "storage":
      return item.processLifetime
        ? "Storage, kept only while OverCrow runs."
        : "Storage on this computer.";
    case "gameEvent":
      return `Game event ${cleanLine(String(item.name), 64)}.`;
    default:
      return cleanLine(JSON.stringify(item), 200);
  }
}
