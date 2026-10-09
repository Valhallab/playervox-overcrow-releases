// The audit of a widget: security (least authority, no secret, user data
// kept) and lightness (CPU, memory, network, images), each scored out of
// 100, with findings ranked by severity, each with a fix and an example
// from a reference widget. Static: nothing of the widget runs.

import { permissionsTable, projectFile } from "../content.js";
import { readWidget } from "./project.js";
import { type ExampleRef, type Finding, runRules, type Severity } from "./rules.js";

export type { Finding } from "./rules.js";

const PENALTY: Record<Severity, number> = { high: 25, medium: 10, low: 3 };
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface ResolvedExample {
  widget: string;
  file: string;
  line: number;
  excerpt: string;
  resource: string;
}

/** Finds an example's line in the embedded reference widgets. */
export function resolveExample(example: ExampleRef): ResolvedExample | undefined {
  const text = projectFile("examples", example.widget, example.file);
  if (text === undefined) return undefined;
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(example.find));
  if (index < 0) return undefined;
  return {
    widget: example.widget,
    file: example.file,
    line: index + 1,
    excerpt: lines.slice(index, index + 6).join("\n"),
    resource: `overcrow://examples/${example.widget}/${example.file}`,
  };
}

function score(findings: readonly Finding[], area: Finding["area"]): number {
  return Math.max(
    0,
    100 - findings.filter((f) => f.area === area).reduce((sum, f) => sum + PENALTY[f.severity], 0),
  );
}

function verdict(value: number): string {
  if (value >= 90) return "good";
  if (value >= 70) return "fair";
  return "needs work";
}

/** What the manifest lets the widget do, in plain words. */
export function authoritySummary(manifest: Record<string, unknown> | null): string[] {
  const permissions = (manifest?.permissions as Record<string, unknown> | undefined) ?? {};
  const table = permissionsTable();
  const out: string[] = [];
  const network = Array.isArray(permissions.network)
    ? (permissions.network as Record<string, unknown>[])
    : [];
  for (const rule of network) {
    const bound =
      typeof rule.maxResponseBytes === "number"
        ? `${Math.ceil(rule.maxResponseBytes / 1024)} KiB`
        : "1 MiB (default)";
    out.push(
      `Network: ${String(rule.method ?? "GET")} ${String(rule.origin ?? "")}${String(rule.path ?? "")}, responses up to ${bound}.`,
    );
  }
  if (permissions.storage === true)
    out.push(`Storage: ${table.permissions.storage?.en.meaning ?? "host-managed storage"}`);
  if (permissions.clipboardWrite === true)
    out.push(`Clipboard: ${table.permissions.clipboardWrite?.en.meaning ?? "text writes"}`);
  const events = Array.isArray(permissions.gameEvents) ? (permissions.gameEvents as string[]) : [];
  if (events.length > 0) out.push(`Game events: ${events.join(", ")}.`);
  const capabilities = Array.isArray(permissions.capabilities)
    ? (permissions.capabilities as string[])
    : [];
  for (const capability of capabilities) {
    const info = table.capabilities[capability];
    const flags = [
      info?.sensitive ? "sensitive" : null,
      info?.account ? `needs a ${info.account} account` : null,
    ].filter(Boolean);
    out.push(
      `${capability}${flags.length ? ` (${flags.join(", ")})` : ""}: ${info?.en.meaning ?? "unknown capability"}`,
    );
  }
  if (out.length === 0) out.push("Nothing: the widget asks for no permission and no capability.");
  return out;
}

export interface AuditResult {
  id: string | null;
  version: string | null;
  scores: { security: number; lightness: number };
  verdicts: { security: string; lightness: string };
  counts: Record<Severity, number>;
  findings: (Omit<Finding, "example"> & { example?: ResolvedExample })[];
  authority: string[];
  notes: string[];
}

/** Audits the widget in `directory` (already confined). */
export async function auditWidget(
  directory: string,
  extra: { findings?: Finding[]; notes?: string[] } = {},
): Promise<AuditResult> {
  const project = await readWidget(directory);
  const findings = [...runRules(project), ...(extra.findings ?? [])].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.rule.localeCompare(b.rule),
  );
  const notes = [...(extra.notes ?? [])];
  if (project.manifestError)
    notes.push(
      `manifest.json could not be read (${project.manifestError}): the permission rules did not run.`,
    );
  if (!project.logic) notes.push("No logic.ts or logic.js: the logic rules did not run.");
  if (project.truncated) notes.push("The folder is very large: the audit read only part of it.");
  const security = score(findings, "security");
  const lightness = score(findings, "lightness");
  return {
    id: typeof project.manifest?.id === "string" ? project.manifest.id : null,
    version: typeof project.manifest?.version === "string" ? project.manifest.version : null,
    scores: { security, lightness },
    verdicts: { security: verdict(security), lightness: verdict(lightness) },
    counts: {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    },
    findings: findings.map(({ example, ...finding }) => {
      const resolved = example ? resolveExample(example) : undefined;
      return resolved ? { ...finding, example: resolved } : finding;
    }),
    authority: authoritySummary(project.manifest),
    notes,
  };
}
