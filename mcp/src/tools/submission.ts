// prepare_submission: everything the OverCrow creator space asks for, checked
// on the project; the ZIP of the sources written to dist/ once nothing
// fails; and the texts the creator space asks for, listed for the assistant
// to draft with the user. Nothing is sent: the user sends the ZIP and the
// texts in the creator space.

import { join } from "node:path";
import { z } from "zod";
import { auditWidget } from "../audit/index.js";
import { readWidget } from "../audit/project.js";
import { Cli } from "../cli.js";
import { limit } from "../content.js";
import { sourcesFingerprint } from "../fingerprint.js";
import { ID_FORMS, idProblem, isPlaceholderId, WIDGET_ID } from "../ids.js";
import { selectSources, writeSourcesZip } from "../sources.js";
import { cleanLine } from "../text.js";
import { DESCRIPTIONS } from "../texts.js";
import { ok, type ToolEnv, widgetDirectory, withRoots } from "./common.js";

type Status = "pass" | "fail" | "todo";
interface Item {
  item: string;
  status: Status;
  detail: string;
}
interface Text {
  kind: "permission" | "privacy-policy" | "release-notes" | "description";
  subject: string;
  current: string | null;
  ask: string;
}

const DIRECTORY = z
  .string()
  .min(1)
  .max(1024)
  .describe("The widget folder (it holds manifest.json), relative to the project folder.");
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_LISTED_INCLUDED = 200;
const MAX_LISTED_EXCLUDED = 100;
export const SEND =
  "The user sends the ZIP and these texts in the OverCrow creator space on overcrow.playervox.com.";

const KIB = 1024;
const kib = (bytes: number) => `${Math.max(1, Math.round(bytes / KIB))} KiB`;
const size = (bytes: number) =>
  bytes >= KIB * KIB && bytes % (KIB * KIB) === 0
    ? `${bytes / (KIB * KIB)} MiB`
    : bytes >= KIB
      ? `${Math.ceil(bytes / KIB)} KiB`
      : `${bytes} bytes`;

export function registerSubmissionTool(env: ToolEnv): void {
  const { server, session } = env;

  server.registerTool(
    "prepare_submission",
    {
      title: "Prepare the submission",
      description: DESCRIPTIONS.prepare_submission,
      inputSchema: z.strictObject({ directory: DIRECTORY }),
      outputSchema: z.object({
        directory: z.string(),
        id: z.string().nullable(),
        version: z.string().nullable(),
        ready: z.boolean(),
        checklist: z.array(
          z.object({
            item: z.string(),
            status: z.enum(["pass", "fail", "todo"]),
            detail: z.string(),
          }),
        ),
        sources: z.object({
          zip: z.string().nullable(),
          bytes: z.number().nullable(),
          sha256: z.string().nullable(),
          files: z.number(),
          included: z.array(z.object({ path: z.string(), bytes: z.number() })),
          excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
          omitted: z.number(),
        }),
        texts: z.array(
          z.object({
            kind: z.enum(["permission", "privacy-policy", "release-notes", "description"]),
            subject: z.string(),
            current: z.string().nullable(),
            ask: z.string(),
          }),
        ),
        next: z.string(),
        notes: z.array(z.string()),
      }),
      annotations: {
        title: "Prepare the submission",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const target = await widgetDirectory(confinement, directory);
        const tools = await session.installedTools();
        const project = await readWidget(target);
        const audit = await auditWidget(target);
        const manifest = project.manifest ?? {};
        const listing = project.listing;
        const files = new Map(project.files.map((file) => [file.path, file]));
        const checklist: Item[] = [];

        // 1. The ID.
        const id = audit.id ?? "";
        const idIssue =
          idProblem(id) ??
          (isPlaceholderId(id) ? `The ID ${id} is a placeholder: use ${ID_FORMS}.` : undefined);
        checklist.push({
          item: "Widget ID",
          status: idIssue ? "fail" : "pass",
          detail: idIssue ?? `${id}: final. Keep it for every version; it can never be reused.`,
        });

        // 2. check and the static admission, with the creator tools.
        let review: Record<string, unknown>[] = [];
        if (tools) {
          const cli = new Cli(tools);
          const check = await cli.check(target, ctx.mcpReq.signal);
          const errors = check.diagnostics.filter((d) => d.severity === "error").length;
          const warnings = check.diagnostics.length - errors;
          checklist.push({
            item: "check: no error, no warning",
            status: errors + warnings === 0 ? "pass" : "fail",
            detail:
              errors + warnings === 0
                ? "Clean."
                : `${errors} error(s), ${warnings} warning(s): the creator space refuses warnings too.`,
          });
          const report = await cli.admit(target, ctx.mcpReq.signal);
          const diagnostics = Array.isArray(report.diagnostics)
            ? (report.diagnostics as { code?: unknown; message?: unknown }[])
            : [];
          // The listing is filled in the creator space: listing.json is optional.
          const noListing = diagnostics.some((d) => d.code === "admission.listing_missing");
          const others = diagnostics.filter((d) => d.code !== "admission.listing_missing");
          const admitted = (report.admitted === true || noListing) && others.length === 0;
          review = Array.isArray(report.review) ? (report.review as Record<string, unknown>[]) : [];
          checklist.push({
            item: "Static admission (overcrow-widget admit)",
            status: admitted ? "pass" : "fail",
            detail: admitted
              ? noListing
                ? "Admitted. There is no listing.json: the listing is filled in the creator space, which can also import a listing.json placed next to manifest.json."
                : "Admitted, with its listing.json."
              : others
                  .slice(0, 8)
                  .map(
                    (d) =>
                      `${cleanLine(String(d.code ?? ""), 48)}: ${cleanLine(String(d.message ?? ""), 200)}`,
                  )
                  .join("; ") || "Refused.",
          });
        } else {
          checklist.push({
            item: "check and static admission",
            status: "fail",
            detail: "Run setup first: they need the creator tools.",
          });
        }

        // 3. The tests, the audit, the preview, the texts and the licence.
        const lastTest = session.lastTests.get(target);
        const unchanged =
          lastTest !== undefined && lastTest.fingerprint === (await sourcesFingerprint(target));
        const passedRun =
          unchanged && lastTest.complete && lastTest.failed === 0 && lastTest.passed > 0
            ? lastTest
            : undefined;
        checklist.push({
          item: "Tests pass",
          status: passedRun ? "pass" : "fail",
          detail: passedRun
            ? `All ${passedRun.passed} scenarios passed at ${passedRun.at.toISOString().slice(11, 16)} UTC, and no source changed since.`
            : lastTest && !unchanged
              ? "The sources changed since the last test run: run test again."
              : "Run test (every scenario, not one): each must pass with its reference images.",
        });
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
        checklist.push(previewItem(listing, files));
        checklist.push(languagesItem(manifest, files));
        checklist.push({
          item: "LICENSE",
          status: files.has("LICENSE") ? "pass" : "fail",
          detail: files.has("LICENSE")
            ? "Any licence is accepted, including all rights reserved: choose the same one in the creator space."
            : "There is no LICENSE file: add the text of your licence (any licence is accepted, including all rights reserved).",
        });

        // 4. What the creator space asks when sending: the texts to draft.
        const permissions =
          review.length > 0
            ? review.map(describeReview)
            : audit.authority.filter((line) => !line.startsWith("Nothing:"));
        const origins = networkOrigins(manifest);
        checklist.push({
          item: "Each permission justified",
          status: permissions.length === 0 ? "pass" : "todo",
          detail:
            permissions.length === 0
              ? "The widget asks for no permission: nothing to justify."
              : `${permissions.length} permission(s): the creator space asks why the widget needs each one. Draft one or two sentences for each (texts).`,
        });
        checklist.push({
          item: "Privacy policy",
          status: origins.length === 0 ? "pass" : "todo",
          detail:
            origins.length === 0
              ? "Not needed: the widget uses no network."
              : `The widget contacts ${origins.join(", ")}: the creator space asks for the address of a privacy policy.`,
        });
        checklist.push({
          item: "Release notes in English and French",
          status: "todo",
          detail: "Shown to players with the update: draft them (texts).",
        });
        const texts = textsToWrite(permissions, origins, listing);

        // 5. The ZIP of the sources, once nothing above fails.
        const selection = await selectSources(target);
        const blocked = checklist.some((entry) => entry.status === "fail");
        let written: { path: string; bytes: number; sha256: string } | undefined;
        let zipProblem: string | null = selection.problem;
        const version = VERSION.test(audit.version ?? "") ? (audit.version as string) : "";
        if (!blocked && !zipProblem && WIDGET_ID.test(id) && version) {
          const dist = await confinement.resolve(join(target, "dist"), "new-directory");
          const result = await writeSourcesZip(
            target,
            selection.included,
            dist,
            `${id}-${version}-sources.zip`,
          ).catch((error: unknown) => ({
            problem: `The ZIP could not be written to dist/ (${cleanLine(String((error as { code?: unknown }).code ?? (error as Error).message), 80)}).`,
          }));
          if ("problem" in result) zipProblem = result.problem;
          else written = result;
        }
        checklist.push({
          item: "Sources ZIP",
          status: written ? "pass" : "fail",
          detail: written
            ? `${confinement.display(written.path)}: ${selection.included.length} files, ${kib(written.bytes)}. The sources stay private: only PlayerVox reviewers read them, and players get the package built from them.`
            : (zipProblem ?? "Not written yet: fix the failed items above first."),
        });

        const ready = checklist.every((entry) => entry.status !== "fail");
        const included = selection.included.slice(0, MAX_LISTED_INCLUDED);
        const excluded = selection.excluded.slice(0, MAX_LISTED_EXCLUDED);
        const failed = checklist.filter((entry) => entry.status === "fail").length;
        return ok(
          {
            directory: confinement.display(target),
            id: audit.id,
            version: audit.version,
            ready,
            checklist,
            sources: {
              zip: written ? confinement.display(written.path) : null,
              bytes: written?.bytes ?? null,
              sha256: written?.sha256 ?? null,
              files: selection.included.length,
              included,
              excluded,
              omitted:
                selection.included.length -
                included.length +
                (selection.excluded.length - excluded.length),
            },
            texts,
            next: ready
              ? `Draft each text of texts with the user, then show them the checklist, the ZIP and the drafts. ${SEND}`
              : "Fix the failed items with the user, then run prepare_submission again.",
            notes: [
              `This tool sends, signs and publishes nothing. ${SEND}`,
              "For an update, the creator space asks only about the permissions this version adds.",
            ],
          },
          ready
            ? `Ready: ${confinement.display(written?.path ?? target)} (${selection.included.length} files). ${texts.length} text(s) to draft with the user.`
            : `Not ready: ${failed} item(s) to fix.`,
          { data: true, redactor },
        );
      }),
  );
}

function previewItem(
  listing: Record<string, unknown> | null,
  files: Map<string, { bytes: number; image?: { width: number; height: number } | null }>,
): Item {
  const path =
    typeof listing?.preview === "string" ? cleanLine(listing.preview, 256) : "assets/preview.png";
  const file = files.get(path);
  if (!file) {
    return {
      item: "Preview",
      status: "fail",
      detail: `There is no ${path}: use_preview copies a reference image of a test scenario there (a 4:3 PNG rendered at 150 %, 256 KiB at most).`,
    };
  }
  if (!file.image) return { item: "Preview", status: "fail", detail: `${path} is not a PNG.` };
  if (file.bytes > limit("MAX_PREVIEW_BYTES")) {
    return {
      item: "Preview",
      status: "fail",
      detail: `${path} weighs ${kib(file.bytes)}: a preview may weigh 256 KiB at most.`,
    };
  }
  const { width, height } = file.image;
  const fourByThree = Math.abs(width * 3 - height * 4) <= Math.max(width, height) * 0.01;
  return {
    item: "Preview",
    status: "pass",
    detail: `${path}, ${width}×${height}, ${kib(file.bytes)}${fourByThree ? "" : ": not 4:3, so it is shown in a 4:3 box"}. It is also the listing's preview in the creator space.`,
  };
}

function languagesItem(manifest: Record<string, unknown>, files: Map<string, unknown>): Item {
  const name = (manifest.name ?? {}) as { en?: unknown; fr?: unknown };
  const en = typeof name.en === "string" ? name.en.trim() : "";
  const fr = typeof name.fr === "string" ? name.fr.trim() : "";
  const locales = ["en", "fr"].filter((locale) => files.has(`locales/${locale}.json`));
  const problems = [
    en && fr ? null : "manifest.json needs a name in English (en) and in French (fr)",
    locales.length === 1
      ? `locales/${locales[0] === "en" ? "fr" : "en"}.json is missing: give the interface texts in both languages`
      : null,
  ].filter((problem): problem is string => problem !== null);
  return {
    item: "Texts in English and French",
    status: problems.length === 0 ? "pass" : "fail",
    detail:
      problems.length > 0
        ? `${problems.join("; ")}.`
        : `Name "${cleanLine(en, 64)}" / "${cleanLine(fr, 64)}"; ${locales.length === 2 ? "interface texts in locales/en.json and locales/fr.json" : "no locales (the view uses no t())"}. Check that the French is a real translation.`,
  };
}

function networkOrigins(manifest: Record<string, unknown>): string[] {
  const permissions = (manifest.permissions ?? {}) as { network?: unknown };
  const rules = Array.isArray(permissions.network)
    ? (permissions.network as { origin?: unknown }[])
    : [];
  const origins = rules
    .map((rule) => (typeof rule.origin === "string" ? cleanLine(rule.origin, 200) : ""))
    .filter((origin) => origin !== "");
  return [...new Set(origins)].slice(0, 16);
}

function textsToWrite(
  permissions: string[],
  origins: string[],
  listing: Record<string, unknown> | null,
): Text[] {
  const texts: Text[] = permissions.map((permission) => ({
    kind: "permission",
    subject: permission,
    current: null,
    ask: "Why the widget needs this permission, in one or two plain sentences, for the reviewer.",
  }));
  if (origins.length > 0) {
    texts.push({
      kind: "privacy-policy",
      subject: origins.join(", "),
      current: null,
      ask: "The address of a privacy policy that says what the widget sends to these servers and why. Ask the user for it, never invent one; if they have none, offer to draft its text for them to publish.",
    });
  }
  for (const [locale, language] of [
    ["en", "English"],
    ["fr", "French"],
  ] as const) {
    texts.push({
      kind: "release-notes",
      subject: locale,
      current: null,
      ask: `What changes for players in this version, in ${language}: short and plain, no marketing.`,
    });
  }
  const localizations = Array.isArray(listing?.localizations)
    ? (listing.localizations as { locale?: unknown; description?: unknown }[])
    : [];
  for (const [locale, language] of [
    ["en", "English"],
    ["fr", "French"],
  ] as const) {
    const found = localizations.find((entry) => entry.locale === locale);
    texts.push({
      kind: "description",
      subject: locale,
      current: typeof found?.description === "string" ? cleanLine(found.description, 600) : null,
      ask: `What the widget shows or does, in ${language}, 500 characters at most: the first two lines appear on the catalog card. Say what it contacts if it uses the network.`,
    });
  }
  return texts;
}

function describeReview(item: Record<string, unknown>): string {
  switch (item.kind) {
    case "capability":
      return `Capability ${cleanLine(String(item.name), 64)}${item.sensitive ? " (sensitive)" : ""}${item.account ? `, needs a ${cleanLine(String(item.account), 32)} account` : ""}.`;
    case "network":
      return `Network: ${cleanLine(String(item.method), 8)} ${cleanLine(String(item.origin), 200)}${cleanLine(String(item.path), 300)}, responses up to ${size(Number(item.maxResponseBytes))}.`;
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
