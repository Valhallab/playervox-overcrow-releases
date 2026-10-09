// Reads a widget directory for the audit, as data: a bounded walk that
// follows no link and skips what is never submitted (node_modules, dist,
// tests/output, hidden folders), the manifest, the logic's tokens, the
// view's handlers and the images' sizes.

import { lstat, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Token, tokenize } from "./lexer.js";

export interface ProjectFile {
  /** Relative path with `/`. */
  path: string;
  bytes: number;
  /** Text content for text files under the size bound; null otherwise. */
  text: string | null;
  /** Packaged in the .ocpkg (manifest, view, style, logic, locales, assets, LICENSE). */
  packaged: boolean;
  image?: { width: number; height: number } | null;
}

export interface WidgetProject {
  directory: string;
  files: ProjectFile[];
  /** Entries left out because the walk reached its bounds. */
  truncated: boolean;
  manifest: Record<string, unknown> | null;
  manifestError: string | null;
  logicPath: string | null;
  logic: string | null;
  tokens: Token[];
  view: string | null;
  style: string | null;
  listing: Record<string, unknown> | null;
  packageJson: Record<string, unknown> | null;
}

const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_TEXT_BYTES = 1 << 20;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const TEXT =
  /\.(json|ts|mts|cts|js|mjs|cjs|ocml|ocss|md|txt|env|npmrc|yml|yaml|toml|html|css|sh)$|^(LICENSE|README|\.env.*|\.npmrc)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;

function isPackaged(path: string): boolean {
  return (
    ["manifest.json", "view.ocml", "style.ocss", "logic.ts", "logic.js", "LICENSE"].includes(
      path,
    ) ||
    /^locales\/[a-z]{2}(-[A-Z]{2})?\.json$/.test(path) ||
    (path.startsWith("assets/") && IMAGE.test(path))
  );
}

/** Width and height from a PNG's IHDR, or null for anything else. */
async function pngSize(path: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (
      bytesRead < 24 ||
      header.readUInt32BE(0) !== 0x89504e47 ||
      header.toString("latin1", 12, 16) !== "IHDR"
    ) {
      return null;
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

function parseObject(text: string | null): {
  value: Record<string, unknown> | null;
  error: string | null;
} {
  if (text === null) return { value: null, error: "missing" };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { value: value as Record<string, unknown>, error: null };
    }
    return { value: null, error: "not a JSON object" };
  } catch (error) {
    return { value: null, error: (error as Error).message };
  }
}

export async function readWidget(directory: string): Promise<WidgetProject> {
  const files: ProjectFile[] = [];
  let truncated = false;
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || path === "tests/output") continue;
        if (entry.name.startsWith(".")) continue;
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = join(directory, path);
      const info = await lstat(absolute);
      const isText = TEXT.test(entry.name) && info.size <= MAX_TEXT_BYTES;
      const file: ProjectFile = {
        path,
        bytes: info.size,
        text: isText ? await readFile(absolute, "utf8") : null,
        packaged: isPackaged(path),
      };
      if (/\.png$/i.test(entry.name)) file.image = await pngSize(absolute);
      files.push(file);
    }
  };
  await walk("", 0);
  const text = (path: string) => files.find((file) => file.path === path)?.text ?? null;
  const manifest = parseObject(text("manifest.json"));
  const logicPath =
    text("logic.ts") !== null ? "logic.ts" : text("logic.js") !== null ? "logic.js" : null;
  const logic = logicPath ? text(logicPath) : null;
  return {
    directory,
    files,
    truncated,
    manifest: manifest.value,
    manifestError: manifest.error,
    logicPath,
    logic,
    tokens: logic ? tokenize(logic) : [],
    view: text("view.ocml"),
    style: text("style.ocss"),
    listing: parseObject(text("listing.json")).value,
    packageJson: parseObject(text("package.json")).value,
  };
}

export interface ViewFacts {
  /** Handler name → events that call it, from `on:<event>={name…}`. */
  handlers: Map<string, Set<string>>;
  intents: { name: string; line: number }[];
  /** Static `class="…"` uses outside any `<if>`/`<else-if>`/`<else>`: class → line. */
  unconditionalClasses: Map<string, number>;
  images: { src: string; line: number }[];
}

/** What the view says about handlers, forms, classes and images. */
export function viewFacts(view: string | null): ViewFacts {
  const facts: ViewFacts = {
    handlers: new Map(),
    intents: [],
    unconditionalClasses: new Map(),
    images: [],
  };
  if (!view) return facts;
  let conditional = 0;
  view.split("\n").forEach((text, index) => {
    const line = index + 1;
    for (const match of text.matchAll(/<\/?(if|else-if|else)\b[^>]*?(\/?)>/g)) {
      if (match[0].startsWith("</")) conditional = Math.max(0, conditional - 1);
      else if (match[2] !== "/") conditional += 1;
    }
    for (const match of text.matchAll(/on:([a-z]+)=\{\s*([A-Za-z_$][\w$]*)/g)) {
      const name = match[2] as string;
      const events = facts.handlers.get(name) ?? new Set<string>();
      events.add(match[1] as string);
      facts.handlers.set(name, events);
    }
    for (const match of text.matchAll(/\bintent="([a-z][\w.]*)"/g))
      facts.intents.push({ name: match[1] as string, line });
    for (const match of text.matchAll(/<image\b[^>]*\bsrc="(assets\/[^"]+)"/g))
      facts.images.push({ src: match[1] as string, line });
    if (conditional === 0) {
      for (const match of text.matchAll(/\bclass="([^"]+)"/g)) {
        for (const name of (match[1] as string).split(/\s+/)) {
          if (name && !facts.unconditionalClasses.has(name))
            facts.unconditionalClasses.set(name, line);
        }
      }
    }
  });
  return facts;
}

/** Classes of the style whose animation repeats forever: class → line. */
export function infiniteAnimations(style: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!style) return out;
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = match[2] as string;
    if (!/animation\s*:[^;]*\binfinite\b/.test(body)) continue;
    const line =
      withoutComments.slice(0, match.index).split("\n").length +
      (match[1] as string).split("\n").length -
      1;
    for (const selector of (match[1] as string).matchAll(/\.([A-Za-z_][\w-]*)/g))
      out.set(selector[1] as string, line);
  }
  return out;
}
