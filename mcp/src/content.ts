// The content shipped in the package (dist/content/, written by
// scripts/build.mjs): documentation pages, templates, reference widgets and
// reference tables. Only files named by the index can be read, so no
// request can reach another file.

import { readFileSync } from "node:fs";

export interface DocPage {
  slug: string;
  file: string;
  group: string;
  label: Record<string, string>;
  titles: Record<string, string>;
}

export interface Project {
  kind: "templates" | "examples";
  name: string;
  files: string[];
  images: { path: string; bytes: number }[];
  id?: string;
  title?: string;
  source?: "widgets" | "docs";
}

interface Index {
  formatVersion: 1;
  docs: { locales: string[]; pages: DocPage[] };
  projects: Project[];
  typescript: string;
}

export interface PermissionInfo {
  services: { service: string; when: string }[];
  en: { meaning: string; withSensitive?: string };
  fr: { meaning: string; withSensitive?: string };
  sensitive?: boolean;
  account?: string | null;
}

export interface ErrorInfo {
  diagnostics: Record<
    string,
    Partial<Record<"en" | "fr", { meaning: string; page: string; section: string }>>
  >;
  services: Record<string, Partial<Record<"en" | "fr", string>>>;
  domains: Record<string, { from: string; codes: string }>;
}

export interface Limit {
  name: string;
  topic: string;
  /** As the documentation writes it, e.g. `256 KiB`. */
  written: string;
  /** In the base unit: bytes, ms, count… */
  value: number;
  unit: string;
  meaning: string;
}

const base = new URL("./content/", import.meta.url);
const cache = new Map<string, unknown>();

function load<T>(path: string, parse: (text: string) => T): T {
  if (!cache.has(path)) cache.set(path, parse(readFileSync(new URL(path, base), "utf8")));
  return cache.get(path) as T;
}

export function index(): Index {
  return load("index.json", JSON.parse);
}

export function docPages(): DocPage[] {
  return index().docs.pages;
}

/** The Markdown of a page, or undefined for an unknown slug or locale. */
export function docMarkdown(slug: string, locale: "en" | "fr"): string | undefined {
  const page = docPages().find((candidate) => candidate.slug === slug);
  if (!page) return undefined;
  return load(`docs/${locale}/${page.file}`, (text) => text);
}

export function projects(kind?: Project["kind"]): Project[] {
  return index().projects.filter((project) => kind === undefined || project.kind === kind);
}

/** A text file of an embedded project, or undefined when the index does not list it. */
export function projectFile(kind: Project["kind"], name: string, file: string): string | undefined {
  const project = projects(kind).find((candidate) => candidate.name === name);
  if (!project?.files.includes(file)) return undefined;
  return load(`${kind}/${name}/${file}`, (text) => text);
}

export function permissionsTable(): {
  permissions: Record<string, PermissionInfo>;
  capabilities: Record<string, PermissionInfo>;
} {
  return load("reference/permissions.json", JSON.parse);
}

export function errorsTable(): ErrorInfo {
  return load("reference/errors.json", JSON.parse);
}

export function limits(): Limit[] {
  return load("reference/limits.json", JSON.parse);
}

/** A limit's value by its SDK name; throws if the SDK no longer has it. */
export function limit(name: string): number {
  const found = limits().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`unknown limit ${name}`);
  return found.value;
}

export function manifestReference(): string {
  return load("reference/manifest.md", (text) => text);
}

/** The website address of a documentation page. */
export function docUrl(slug: string, locale: "en" | "fr" = "en", anchor?: string): string {
  const path =
    locale === "en" ? `/docs/en/${slug ? `${slug}/` : ""}` : `/docs/${slug ? `${slug}/` : ""}`;
  return `https://overcrow.playervox.com${path}${anchor ? `#${anchor}` : ""}`;
}

/** GitHub-style anchor of a heading, as the website builds it. */
export function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}
