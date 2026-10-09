// check, test, update_reference_images, package and inspect: the CLI's
// commands, their results read from its JSON output, as data.

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContentBlock } from "@modelcontextprotocol/server";
import { z } from "zod";
import { authoritySummary } from "../audit/index.js";
import { Cli, type Diagnostic } from "../cli.js";
import { type Confinement, ConfinementError } from "../confine.js";
import { explainError } from "../knowledge.js";
import { boundList, clean, cleanLine } from "../text.js";
import { DESCRIPTIONS } from "../texts.js";
import { fail, ok, READ_ONLY, TOOLS_MISSING, type ToolEnv, withRoots } from "./common.js";

const DIRECTORY = z
  .string()
  .min(1)
  .max(1024)
  .describe("The widget folder (it holds manifest.json), relative to the project folder.");
const SCENARIO = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .optional()
  .describe("One scenario name (the file tests/<name>.scenario.json); all scenarios when absent.");
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DIAGNOSTICS = 200;
const MAX_IMAGE_BYTES = 1 << 20;
const MAX_IMAGES_BYTES = 4 << 20;
const MAX_IMAGE_SETS = 3;

/** A widget folder inside the project: it must hold a manifest.json. */
export async function widgetDirectory(
  confinement: Confinement,
  directory: string,
): Promise<string> {
  const target = await confinement.resolve(directory, "directory");
  const manifest = await lstat(join(target, "manifest.json")).catch(() => undefined);
  if (!manifest?.isFile()) {
    throw new ConfinementError(`${directory} is not a widget folder: it has no manifest.json.`);
  }
  return target;
}

/**
 * Folders the CLI writes into: a link there could lead the write out of the
 * project, so each must resolve inside it (or not exist yet).
 */
async function checkOutputs(confinement: Confinement, target: string, folders: readonly string[]) {
  for (const folder of folders) await confinement.resolve(join(target, folder), "new-directory");
}

const diagnosticSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  message: z.string(),
  help: z.string().nullable(),
  docs: z.string().nullable(),
});

function shapeDiagnostics(diagnostics: Diagnostic[]) {
  const { items, omitted } = boundList(diagnostics, MAX_DIAGNOSTICS);
  return {
    diagnostics: items.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: cleanLine(diagnostic.code, 64),
      file: diagnostic.file === null ? null : cleanLine(diagnostic.file, 256),
      line: diagnostic.line,
      column: diagnostic.column,
      message: cleanLine(diagnostic.message, 600),
      help: diagnostic.help === null ? null : cleanLine(diagnostic.help, 600),
      docs: explainError(diagnostic.code, "en")?.url ?? null,
    })),
    omitted,
  };
}

function counts(diagnostics: Diagnostic[]) {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
  };
}

async function cliOf(env: ToolEnv): Promise<Cli | undefined> {
  const tools = await env.session.installedTools();
  return tools ? new Cli(tools) : undefined;
}

/** Reads a PNG of the project for an image result, within the bounds. */
async function pngContent(
  confinement: Confinement,
  wanted: string,
  budget: { left: number },
): Promise<ContentBlock | undefined> {
  // Through the confinement: a link in tests/ cannot show a file from elsewhere.
  const path = await confinement.resolve(wanted, "file").catch(() => undefined);
  if (!path) return undefined;
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_IMAGE_BYTES || info.size > budget.left) return undefined;
  const data = await readFile(path);
  if (data.readUInt32BE(0) !== 0x89504e47) return undefined;
  budget.left -= info.size;
  return { type: "image", data: data.toString("base64"), mimeType: "image/png" };
}

type ScenarioLine = Record<string, unknown>;

function shapeScenario(line: ScenarioLine) {
  const passed = line.passed === true;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const outcomes = (value: unknown) =>
    list<{ step?: unknown; kind?: unknown; ok?: unknown; detail?: unknown }>(value)
      .filter((outcome) => outcome.ok !== true)
      .slice(0, 20)
      .map((outcome) => ({
        step: typeof outcome.step === "number" ? outcome.step : null,
        kind: cleanLine(String(outcome.kind ?? ""), 32),
        detail: typeof outcome.detail === "string" ? clean(outcome.detail, 1500) : null,
      }));
  const name = String(line.name ?? "");
  return {
    name: NAME.test(name) ? name : cleanLine(name, 64),
    passed,
    failure: typeof line.failure === "string" ? clean(line.failure, 2000) : null,
    failedExpectations: outcomes(line.expectations),
    scenarioErrors: outcomes(line.errors),
    faults: list<string>(line.faults)
      .slice(0, 20)
      .map((fault) => cleanLine(String(fault), 64)),
    images: list<{ name?: unknown; status?: unknown; ppm?: unknown; maxDelta?: unknown }>(
      line.images,
    )
      .slice(0, 64)
      .map((image) => {
        const imageName = String(image.name ?? "");
        const safe = NAME.test(imageName) && NAME.test(name);
        const status = cleanLine(String(image.status ?? ""), 16);
        return {
          name: cleanLine(imageName, 64),
          status,
          ppm: typeof image.ppm === "number" ? image.ppm : null,
          maxDelta: typeof image.maxDelta === "number" ? image.maxDelta : null,
          reference: safe ? `tests/reference/${name}/${imageName}.png` : null,
          actual:
            safe && ["different", "size", "missing"].includes(status)
              ? `tests/output/${name}/${imageName}.actual.png`
              : null,
          diff:
            safe && status === "different" ? `tests/output/${name}/${imageName}.diff.png` : null,
        };
      }),
    logs: passed
      ? []
      : list<{ level?: unknown; text?: unknown }>(line.logs)
          .slice(0, 20)
          .map((log) => ({
            level: cleanLine(String(log.level ?? ""), 8),
            text: clean(String(log.text ?? ""), 500),
          })),
    staleReferences: list<string>(line.staleReferences)
      .slice(0, 20)
      .map((path) => cleanLine(String(path), 256)),
  };
}

const scenarioSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  failure: z.string().nullable(),
  failedExpectations: z.array(
    z.object({ step: z.number().nullable(), kind: z.string(), detail: z.string().nullable() }),
  ),
  scenarioErrors: z.array(
    z.object({ step: z.number().nullable(), kind: z.string(), detail: z.string().nullable() }),
  ),
  faults: z.array(z.string()),
  images: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      ppm: z.number().nullable(),
      maxDelta: z.number().nullable(),
      reference: z.string().nullable(),
      actual: z.string().nullable(),
      diff: z.string().nullable(),
    }),
  ),
  logs: z.array(z.object({ level: z.string(), text: z.string() })),
  staleReferences: z.array(z.string()),
});

const testOutput = z.object({
  directory: z.string(),
  ran: z.boolean(),
  passed: z.number().nullable(),
  failed: z.number().nullable(),
  scenarios: z.array(scenarioSchema),
  diagnostics: z.array(diagnosticSchema),
  problem: z.string().nullable(),
  imagesShown: z.array(z.string()),
  next: z.string(),
});

async function runTests(
  env: ToolEnv,
  confinement: Confinement,
  directory: string,
  scenario: string | undefined,
  update: boolean,
  signal: AbortSignal,
) {
  const cli = await cliOf(env);
  if (!cli) return { failure: fail(TOOLS_MISSING) };
  const target = await widgetDirectory(confinement, directory);
  await checkOutputs(
    confinement,
    target,
    update ? ["tests/output", "tests/reference"] : ["tests/output"],
  );
  const result = await cli.test(target, { scenario, update }, signal);
  const { diagnostics } = shapeDiagnostics(result.diagnostics);
  if (!result.ran) {
    return {
      target,
      structured: {
        directory: confinement.display(target),
        ran: false,
        passed: null,
        failed: null,
        scenarios: [],
        diagnostics,
        problem: clean(result.problem, 2000) || "No scenario ran.",
        imagesShown: [],
        next:
          diagnostics.length > 0
            ? "Fix the diagnostics (run check), then test again."
            : "Read the problem, fix it, and test again.",
      },
      images: [] as ContentBlock[],
    };
  }
  const scenarios = result.scenarios.slice(0, 256).map(shapeScenario);
  // Images of the first failures: reference, new image, difference.
  const images: ContentBlock[] = [];
  const shown: string[] = [];
  const budget = { left: MAX_IMAGES_BYTES };
  if (!update) {
    let sets = 0;
    for (const entry of scenarios) {
      for (const image of entry.images) {
        if (sets >= MAX_IMAGE_SETS || !image.actual) continue;
        sets += 1;
        for (const [label, path] of [
          ["reference", image.reference],
          ["new", image.actual],
          ["difference", image.diff],
        ] as const) {
          if (!path) continue;
          const block = await pngContent(confinement, join(target, path), budget);
          if (block) {
            images.push(
              { type: "text", text: `${entry.name} / ${image.name}: ${label} image (${path})` },
              block,
            );
            shown.push(path);
          }
        }
      }
    }
  }
  const failed = scenarios.filter((entry) => !entry.passed).length;
  return {
    target,
    structured: {
      directory: confinement.display(target),
      ran: true,
      passed: result.passed ?? scenarios.length - failed,
      failed: result.failed ?? failed,
      scenarios,
      diagnostics,
      problem: result.problem ? clean(result.problem, 2000) : null,
      imagesShown: shown,
      next:
        failed === 0
          ? update
            ? "Reference images updated. Look at them, then run test again."
            : "All scenarios pass. Run audit next."
          : "Fix the widget, or, if the new images are right, ask the user before update_reference_images.",
    },
    images,
  };
}

export function registerBuildTools(env: ToolEnv): void {
  const { server } = env;

  server.registerTool(
    "check",
    {
      title: "Check a widget",
      description: DESCRIPTIONS.check,
      inputSchema: z.strictObject({ directory: DIRECTORY }),
      outputSchema: z.object({
        directory: z.string(),
        ok: z.boolean(),
        errors: z.number(),
        warnings: z.number(),
        diagnostics: z.array(diagnosticSchema),
        omitted: z.number(),
        next: z.string(),
      }),
      annotations: { title: "Check a widget", ...READ_ONLY },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const cli = await cliOf(env);
        if (!cli) return fail(TOOLS_MISSING);
        const target = await widgetDirectory(confinement, directory);
        const result = await cli.check(target, ctx.mcpReq.signal);
        const { errors, warnings } = counts(result.diagnostics);
        const shaped = shapeDiagnostics(result.diagnostics);
        const next =
          errors > 0
            ? "Fix the errors (explain_error explains a code), then check again."
            : warnings > 0
              ? "Fix the warnings: a submission must have none."
              : "No problem. Run test next.";
        return ok(
          {
            directory: confinement.display(target),
            ok: result.ok && warnings === 0,
            errors,
            warnings,
            ...shaped,
            next,
          },
          errors + warnings === 0
            ? "check: no problem."
            : `check: ${errors} error(s), ${warnings} warning(s).`,
          { data: true, redactor },
        );
      }),
  );

  server.registerTool(
    "test",
    {
      title: "Test a widget",
      description: DESCRIPTIONS.test,
      inputSchema: z.strictObject({ directory: DIRECTORY, scenario: SCENARIO }),
      outputSchema: testOutput,
      annotations: {
        title: "Test a widget",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ directory, scenario }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const run = await runTests(env, confinement, directory, scenario, false, ctx.mcpReq.signal);
        if ("failure" in run) return run.failure;
        const s = run.structured;
        const summary = s.ran
          ? `test: ${s.passed} passed, ${s.failed} failed.`
          : `test: no scenario ran. ${s.problem}`;
        return ok(s, summary, { data: true, redactor, extra: run.images });
      }),
  );

  server.registerTool(
    "update_reference_images",
    {
      title: "Update reference images",
      description: DESCRIPTIONS.update_reference_images,
      inputSchema: z.strictObject({
        directory: DIRECTORY,
        scenario: SCENARIO,
        confirm: z
          .literal(true)
          .describe("Must be true: the user agreed to replace the reference images."),
      }),
      outputSchema: testOutput,
      annotations: {
        title: "Update reference images",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ directory, scenario }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const run = await runTests(env, confinement, directory, scenario, true, ctx.mcpReq.signal);
        if ("failure" in run) return run.failure;
        const updated = run.structured.scenarios.flatMap((entry) =>
          entry.images
            .filter((image) => image.status === "updated")
            .map((image) => image.reference ?? image.name),
        );
        return ok(
          run.structured,
          `Updated ${updated.length} reference image(s)${updated.length ? `: ${updated.slice(0, 10).join(", ")}` : ""}.`,
          {
            data: true,
            redactor,
          },
        );
      }),
  );

  server.registerTool(
    "package",
    {
      title: "Package a widget",
      description: DESCRIPTIONS.package,
      inputSchema: z.strictObject({ directory: DIRECTORY }),
      outputSchema: z.object({
        directory: z.string(),
        ok: z.boolean(),
        package: z.string().nullable(),
        bytes: z.number().nullable(),
        logicBytes: z.number().nullable(),
        sha256: z.string().nullable(),
        diagnostics: z.array(diagnosticSchema),
        next: z.string(),
      }),
      annotations: {
        title: "Package a widget",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const cli = await cliOf(env);
        if (!cli) return fail(TOOLS_MISSING);
        const target = await widgetDirectory(confinement, directory);
        const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")) as {
          id?: unknown;
          version?: unknown;
        };
        const id = String(manifest.id ?? "");
        const version = String(manifest.version ?? "");
        if (!/^[a-z0-9.-]{3,128}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) {
          return fail("manifest.json has no valid id and version: run check first.");
        }
        await checkOutputs(confinement, target, ["dist"]);
        const out = join(target, "dist", `${id}-${version}.ocpkg`);
        const result = await cli.package(target, out, ctx.mcpReq.signal);
        const shaped = shapeDiagnostics(result.diagnostics);
        return ok(
          {
            directory: confinement.display(target),
            ok: result.ok,
            package: result.ok ? confinement.display(out) : null,
            bytes: result.bytes,
            logicBytes: result.logicBytes,
            sha256: result.sha256,
            diagnostics: shaped.diagnostics,
            next: result.ok
              ? "Run inspect on the package to see what it may do, then prepare_submission."
              : "Fix the diagnostics, then package again.",
          },
          result.ok
            ? `Packaged ${confinement.display(out)} (${result.bytes} bytes, logic.js ${result.logicBytes} bytes).`
            : "The package could not be built.",
          { data: true, redactor },
        );
      }),
  );

  server.registerTool(
    "inspect",
    {
      title: "Inspect a package",
      description: DESCRIPTIONS.inspect,
      inputSchema: z.strictObject({
        file: z.string().min(1).max(1024).describe("A .ocpkg file inside the project."),
      }),
      outputSchema: z.object({
        file: z.string(),
        ok: z.boolean(),
        id: z.string().nullable(),
        version: z.string().nullable(),
        bytes: z.number().nullable(),
        sha256: z.string().nullable(),
        heapMiB: z.number().nullable(),
        sdk: z.string().nullable(),
        files: z.array(z.object({ path: z.string(), bytes: z.number() })),
        mayDo: z.array(z.string()),
        diagnostics: z.array(diagnosticSchema),
      }),
      annotations: { title: "Inspect a package", ...READ_ONLY },
    },
    async ({ file }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const cli = await cliOf(env);
        if (!cli) return fail(TOOLS_MISSING);
        if (!file.endsWith(".ocpkg")) return fail("inspect reads .ocpkg files.");
        const path = await confinement.resolve(file, "file");
        const result = await cli.inspect(
          path,
          confinement.roots[0]?.path ?? path,
          ctx.mcpReq.signal,
        );
        const report = result.report ?? {};
        const archive = (report.archive ?? {}) as { bytes?: unknown; sha256?: unknown };
        const files = Array.isArray(report.files)
          ? (report.files as { path?: unknown; bytes?: unknown }[])
          : [];
        const manifest = (report.manifest ?? null) as Record<string, unknown> | null;
        return ok(
          {
            file: confinement.display(path),
            ok: result.ok,
            id: typeof report.id === "string" ? report.id : null,
            version: typeof report.version === "string" ? report.version : null,
            bytes: typeof archive.bytes === "number" ? archive.bytes : null,
            sha256: typeof archive.sha256 === "string" ? archive.sha256 : null,
            heapMiB: typeof report.heapBytes === "number" ? report.heapBytes / 1048576 : null,
            sdk: typeof report.sdk === "string" ? report.sdk : null,
            files: files.slice(0, 256).map((entry) => ({
              path: cleanLine(String(entry.path ?? ""), 256),
              bytes: Number(entry.bytes ?? 0),
            })),
            mayDo: manifest ? authoritySummary(manifest) : [],
            diagnostics: shapeDiagnostics(result.diagnostics).diagnostics,
          },
          result.ok
            ? `${String(report.id)} ${String(report.version)}: ${files.length} files, ${String(archive.bytes)} bytes.`
            : "The package is refused.",
          { data: true, redactor },
        );
      }),
  );
}
