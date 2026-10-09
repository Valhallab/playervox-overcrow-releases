// Answers from the shipped documentation: search, pages and sections, and
// the meaning of a permission or of an error code. No network access.

import {
  anchorOf,
  docMarkdown,
  docPages,
  docUrl,
  errorsTable,
  permissionsTable,
} from "./content.js";

export type Locale = "en" | "fr";

interface Section {
  slug: string;
  locale: Locale;
  page: string;
  heading: string;
  anchor: string;
  text: string;
}

let sections: Map<Locale, Section[]> | undefined;

function sectionsOf(locale: Locale): Section[] {
  sections ??= new Map();
  const cached = sections.get(locale);
  if (cached) return cached;
  const out: Section[] = [];
  for (const page of docPages()) {
    const markdown = docMarkdown(page.slug, locale) ?? "";
    const title = page.titles[locale] ?? page.slug;
    let heading = title;
    let buffer: string[] = [];
    const flush = () => {
      const text = buffer.join("\n").trim();
      if (text) {
        out.push({
          slug: page.slug,
          locale,
          page: title,
          heading,
          anchor: heading === title ? "" : anchorOf(heading),
          text,
        });
      }
      buffer = [];
    };
    for (const line of markdown.split("\n")) {
      const match = /^#{1,3} (.+)$/.exec(line);
      if (match) {
        flush();
        heading = (match[1] as string).trim();
        continue;
      }
      if (/^<!-- \/?generated:/.test(line)) continue;
      buffer.push(line);
    }
    flush();
  }
  sections.set(locale, out);
  return out;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*/gu) ?? []).filter(
    (term) => term.length > 1,
  );
}

export interface SearchHit {
  slug: string;
  page: string;
  section: string;
  url: string;
  resource: string;
  snippet: string;
  score: number;
}

/** Ranks the sections of the documentation for `query`. */
export function searchDocs(query: string, locale: Locale, limit: number): SearchHit[] {
  const wanted = [...new Set(terms(query))].slice(0, 12);
  if (wanted.length === 0) return [];
  const all = sectionsOf(locale);
  const frequency = new Map<string, number>();
  for (const term of wanted)
    frequency.set(term, all.filter((section) => section.text.toLowerCase().includes(term)).length);
  const scored = all
    .map((section) => {
      const body = section.text.toLowerCase();
      const heading = section.heading.toLowerCase();
      let score = 0;
      for (const term of wanted) {
        const idf = Math.log(1 + all.length / (1 + (frequency.get(term) ?? 0)));
        const count = body.split(term).length - 1;
        score +=
          Math.min(count, 8) * idf +
          (heading.includes(term) ? 4 * idf : 0) +
          (section.page.toLowerCase().includes(term) ? idf : 0);
      }
      return { section, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ section, score }) => {
    const body = section.text;
    const lower = body.toLowerCase();
    const at = Math.max(
      0,
      Math.min(...wanted.map((term) => lower.indexOf(term)).filter((index) => index >= 0)) - 80,
    );
    const snippet = body
      .slice(at, at + 320)
      .replace(/\s+/g, " ")
      .trim();
    return {
      slug: section.slug,
      page: section.page,
      section: section.heading,
      url: docUrl(section.slug, locale, section.anchor || undefined),
      resource: `overcrow://docs/${locale}/${section.slug || "index"}`,
      snippet: `${at > 0 ? "…" : ""}${snippet}${at + 320 < body.length ? "…" : ""}`,
      score: Math.round(score * 10) / 10,
    };
  });
}

/** A page, or one of its sections, with the list of its headings. */
export function readDoc(slug: string, locale: Locale, section?: string) {
  const page = docPages().find((candidate) => candidate.slug === slug);
  const markdown = page ? docMarkdown(page.slug, locale) : undefined;
  if (!page || markdown === undefined) return undefined;
  const headings = [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map((match) =>
    (match[1] as string).trim(),
  );
  let text = markdown;
  if (section) {
    const wanted = section.toLowerCase();
    const found = sectionsOf(locale).find(
      (candidate) =>
        candidate.slug === slug &&
        (candidate.heading.toLowerCase() === wanted || candidate.anchor === anchorOf(section)),
    );
    if (!found)
      return {
        title: page.titles[locale] ?? slug,
        url: docUrl(slug, locale),
        headings,
        markdown: null,
      };
    text = `## ${found.heading}\n\n${found.text}`;
  }
  return {
    title: page.titles[locale] ?? slug,
    url: docUrl(slug, locale),
    headings,
    markdown: text,
  };
}

const PERMISSION_ADVICE: Record<string, string> = {
  network:
    "Declare one rule per route the widget really requests: method, origin and exact path, with each {parameter} constrained (enum, integer with min and max, or a short slug) rather than free text. Set maxResponseBytes just above the largest real response. Never send the user's data without a reason, and say in listing.json what is sent and why. Every server you add learns when the user plays.",
  storage:
    "Keep only what the widget needs to come back to (settings, a small cache), well under 256 KiB in all and 64 KiB per value, and bound what you store. With a sensitive capability, storage lasts only while OverCrow runs.",
  clipboardWrite:
    "Write only in the handler of a user action (on:activate of a button), only the text the user asked to copy, and never on a timer or a data update: OverCrow refuses it otherwise (gesture_required).",
  gameEvents: "Subscribe only to the events the widget shows.",
  capabilities:
    "Each capability needs the user's consent. A sensitive capability cannot be combined with network or clipboardWrite (OverCrow refuses the manifest): the data it reads cannot leave the computer.",
};

/** The meaning of a permission or capability, what it allows, and how to keep it narrow. */
export function explainPermission(name: string, locale: Locale) {
  const table = permissionsTable();
  const permission = table.permissions[name];
  if (permission) {
    return {
      name,
      kind: "permission" as const,
      meaning: permission[locale].meaning,
      withSensitiveCapability: permission[locale].withSensitive ?? null,
      services: permission.services,
      sensitive: null,
      account: null,
      advice: PERMISSION_ADVICE[name] ?? "",
      docs: docUrl("services", locale, locale === "en" ? "permissions" : undefined),
    };
  }
  const capability = table.capabilities[name];
  if (capability) {
    const advice = [
      "Ask for it only if the widget shows or uses this data, and handle its refusal: the user may say no (check hasGrant).",
      capability.sensitive
        ? "It is sensitive: the widget cannot also declare network or clipboardWrite, and its storage lasts only while OverCrow runs."
        : null,
      capability.account
        ? `It needs the user's ${capability.account} account connected in OverCrow; handle not_connected.`
        : null,
    ].filter((part): part is string => part !== null);
    return {
      name,
      kind: "capability" as const,
      meaning: capability[locale].meaning,
      withSensitiveCapability: null,
      services: capability.services,
      sensitive: capability.sensitive ?? false,
      account: capability.account ?? null,
      advice: advice.join(" "),
      docs: docUrl("services", locale),
    };
  }
  return undefined;
}

/** Every permission and capability name, for suggestions. */
export function permissionNames(): string[] {
  const table = permissionsTable();
  return [...Object.keys(table.permissions), ...Object.keys(table.capabilities)];
}

/** The meaning of a diagnostic or service error code, with its page. */
export function explainError(code: string, locale: Locale) {
  const table = errorsTable();
  const diagnostic = table.diagnostics[code]?.[locale];
  if (diagnostic) {
    return {
      code,
      kind: "diagnostic" as const,
      meaning: diagnostic.meaning,
      page: diagnostic.page,
      url: docUrl(diagnostic.page, locale, anchorOf(diagnostic.section)),
    };
  }
  const service = table.services[code]?.[locale];
  if (service) {
    return {
      code,
      kind: "service" as const,
      meaning: service,
      page: "services",
      url: docUrl("services", locale),
    };
  }
  const domain = /^([a-z]+)\./.exec(code)?.[1];
  const info = domain ? table.domains[domain] : undefined;
  if (info) {
    const page =
      { manifest: "manifest", view: "view", style: "style", logic: "logic", test: "testing" }[
        domain as string
      ] ?? "cli";
    return {
      code,
      kind: "domain" as const,
      meaning: `A problem reported for ${info.from}. This code has no entry of its own in the documentation; the diagnostic's message and help say what to change. Codes of this kind: ${info.codes}.`,
      page,
      url: docUrl(page, locale),
    };
  }
  return undefined;
}

/** Codes close to `code`, for a suggestion when it is unknown. */
export function similarCodes(code: string): string[] {
  const table = errorsTable();
  const all = [...Object.keys(table.diagnostics), ...Object.keys(table.services)];
  const tail = code.split(".").pop() ?? code;
  return all
    .filter(
      (candidate) => candidate.includes(tail) || tail.includes(candidate.split(".").pop() ?? ""),
    )
    .slice(0, 8);
}
