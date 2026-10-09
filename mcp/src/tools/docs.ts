// explain_permission, explain_error, search_docs, read_doc and read_example:
// answers from the documentation and examples shipped in the package.

import { z } from "zod";
import { docPages, projectFile, projects } from "../content.js";
import {
  explainError,
  explainPermission,
  permissionNames,
  readDoc,
  searchDocs,
  similarCodes,
} from "../knowledge.js";
import { bound } from "../text.js";
import { DESCRIPTIONS } from "../texts.js";
import { fail, MAX_RESULT_CHARS, ok, READ_ONLY, type ToolEnv } from "./common.js";

const LOCALE = z
  .enum(["en", "fr"])
  .default("en")
  .describe("Language of the documentation: en or fr.");

export function registerDocTools(env: ToolEnv): void {
  const { server } = env;

  server.registerTool(
    "explain_permission",
    {
      title: "Explain a permission",
      description: DESCRIPTIONS.explain_permission,
      inputSchema: z.strictObject({
        name: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "network, storage, clipboardWrite, gameEvents, or a capability such as media.read.",
          ),
        locale: LOCALE,
      }),
      outputSchema: z.object({
        name: z.string(),
        kind: z.enum(["permission", "capability"]),
        meaning: z.string(),
        withSensitiveCapability: z.string().nullable(),
        services: z.array(z.object({ service: z.string(), when: z.string() })),
        sensitive: z.boolean().nullable(),
        account: z.string().nullable(),
        advice: z.string(),
        docs: z.string(),
      }),
      annotations: { title: "Explain a permission", ...READ_ONLY },
    },
    async ({ name, locale }) => {
      const info = explainPermission(name, locale);
      if (!info)
        return fail(
          `Unknown permission or capability: ${name.slice(0, 64)}. Known: ${permissionNames().join(", ")}.`,
        );
      return ok({ ...info }, `${info.name}: ${info.meaning}`);
    },
  );

  server.registerTool(
    "explain_error",
    {
      title: "Explain an error code",
      description: DESCRIPTIONS.explain_error,
      inputSchema: z.strictObject({
        code: z
          .string()
          .regex(/^[a-z_]+(\.[a-z_]+)?$/)
          .max(64)
          .describe(
            "A diagnostic code (view.unknown_attribute) or a service error code (permission_denied).",
          ),
        locale: LOCALE,
      }),
      outputSchema: z.object({
        code: z.string(),
        kind: z.enum(["diagnostic", "service", "domain"]),
        meaning: z.string(),
        page: z.string(),
        url: z.string(),
      }),
      annotations: { title: "Explain an error code", ...READ_ONLY },
    },
    async ({ code, locale }) => {
      const info = explainError(code, locale);
      if (!info) {
        const similar = similarCodes(code);
        return fail(
          `Unknown code ${code}.${similar.length ? ` Close codes: ${similar.join(", ")}.` : " Use search_docs."}`,
        );
      }
      return ok({ ...info }, `${info.code}: ${info.meaning}`);
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search the documentation",
      description: DESCRIPTIONS.search_docs,
      inputSchema: z.strictObject({
        query: z.string().min(1).max(200),
        locale: LOCALE,
        limit: z.number().int().min(1).max(10).default(5),
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({
            slug: z.string(),
            page: z.string(),
            section: z.string(),
            url: z.string(),
            resource: z.string(),
            snippet: z.string(),
            score: z.number(),
          }),
        ),
      }),
      annotations: { title: "Search the documentation", ...READ_ONLY },
    },
    async ({ query, locale, limit }) => {
      const results = searchDocs(query, locale, limit);
      return ok(
        { results },
        results.length === 0
          ? "No match: try other words, or read_doc with a page slug."
          : `${results.length} section(s) found; read one with read_doc.`,
      );
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read the documentation",
      description: DESCRIPTIONS.read_doc,
      inputSchema: z.strictObject({
        slug: z
          .string()
          .max(64)
          .describe(
            'Page slug, such as "guide", "manifest", "services", "limits"; "index" for the overview.',
          ),
        section: z
          .string()
          .max(200)
          .optional()
          .describe("A heading of the page, to read only that section."),
        locale: LOCALE,
      }),
      outputSchema: z.object({
        slug: z.string(),
        title: z.string(),
        url: z.string(),
        headings: z.array(z.string()),
        markdown: z.string().nullable(),
        pages: z.array(z.object({ slug: z.string(), title: z.string(), group: z.string() })),
      }),
      annotations: { title: "Read the documentation", ...READ_ONLY },
    },
    async ({ slug, section, locale }) => {
      const pageSlug = slug === "index" ? "" : slug;
      const pages = docPages().map((page) => ({
        slug: page.slug || "index",
        title: page.titles[locale] ?? page.slug,
        group: page.group,
      }));
      const doc = readDoc(pageSlug, locale, section);
      if (!doc)
        return fail(
          `No page ${slug.slice(0, 64)}. Pages: ${pages.map((page) => page.slug).join(", ")}.`,
        );
      const markdown = doc.markdown === null ? null : bound(doc.markdown, MAX_RESULT_CHARS - 4000);
      return ok(
        { slug, title: doc.title, url: doc.url, headings: doc.headings, markdown, pages },
        doc.markdown === null
          ? `No section "${section}" in ${doc.title}: see headings.`
          : `${doc.title} (${doc.url})`,
      );
    },
  );

  server.registerTool(
    "read_example",
    {
      title: "Read an example",
      description: DESCRIPTIONS.read_example,
      inputSchema: z.strictObject({
        name: z
          .string()
          .max(64)
          .optional()
          .describe(
            "A reference widget (warframe-market, clock…), a template (counter…) or a documentation example (weather, countdown).",
          ),
        file: z
          .string()
          .max(256)
          .optional()
          .describe("A file of that project, such as logic.ts or manifest.json."),
      }),
      outputSchema: z.object({
        projects: z.array(
          z.object({
            name: z.string(),
            kind: z.string(),
            title: z.string().nullable(),
            id: z.string().nullable(),
          }),
        ),
        files: z.array(z.string()),
        file: z.string().nullable(),
        text: z.string().nullable(),
        resource: z.string().nullable(),
      }),
      annotations: { title: "Read an example", ...READ_ONLY },
    },
    async ({ name, file }) => {
      const all = projects().filter((project) => project.name !== "shared");
      const list = all.map((project) => ({
        name: project.name,
        kind:
          project.kind === "templates"
            ? "template"
            : project.source === "docs"
              ? "documentation example"
              : "reference widget",
        title: project.title ?? null,
        id: project.id ?? null,
      }));
      if (!name) {
        return ok(
          { projects: list, files: [], file: null, text: null, resource: null },
          `${list.length} projects; read one with name.`,
        );
      }
      const project = all.find((candidate) => candidate.name === name);
      if (!project)
        return fail(`No example named ${name}. Names: ${all.map((p) => p.name).join(", ")}.`);
      if (!file) {
        return ok(
          { projects: [], files: project.files, file: null, text: null, resource: null },
          `${name}: ${project.files.length} files${project.images.length ? ` (and ${project.images.length} images, not included)` : ""}.`,
        );
      }
      const text = projectFile(project.kind, project.name, file);
      if (text === undefined)
        return fail(
          `${name} has no text file ${file.slice(0, 256)}. Files: ${project.files.join(", ")}.`,
        );
      return ok(
        {
          projects: [],
          files: [],
          file,
          text: bound(text, MAX_RESULT_CHARS - 4000),
          resource: `overcrow://${project.kind}/${project.name}/${file}`,
        },
        `${name}/${file}`,
        { data: true },
      );
    },
  );
}
