// Resources: the documentation pages (EN and FR), the manifest reference,
// the limits, the templates and the example widgets. All come from the
// package; none from the project or the network.

import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  docMarkdown,
  docPages,
  limits,
  manifestReference,
  projectFile,
  projects,
} from "./content.js";

function mimeOf(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".ts") || path.endsWith(".mjs")) return "text/x-typescript";
  return "text/plain";
}

const single = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export function registerResources(server: McpServer): void {
  server.registerResource(
    "manifest-reference",
    "overcrow://schema/manifest",
    {
      title: "Manifest reference",
      description:
        "Every field of manifest.json, the permissions, the network rules and the capabilities.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: manifestReference() }],
    }),
  );

  server.registerResource(
    "limits",
    "overcrow://limits",
    {
      title: "Limits",
      description: "Every limit a widget meets: name, value and meaning (from the limits page).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(limits(), null, 1) },
      ],
    }),
  );

  server.registerResource(
    "docs",
    new ResourceTemplate("overcrow://docs/{locale}/{slug}", {
      list: async () => ({
        resources: docPages().flatMap((page) =>
          (["en", "fr"] as const).map((locale) => ({
            uri: `overcrow://docs/${locale}/${page.slug || "index"}`,
            name: `${locale}/${page.slug || "index"}`,
            title: page.titles[locale] ?? page.slug,
            mimeType: "text/markdown",
          })),
        ),
      }),
    }),
    {
      title: "Creator documentation",
      description: "A page of the OverCrow creator documentation.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const locale = z.enum(["en", "fr"]).safeParse(single(variables.locale));
      const slug = single(variables.slug);
      const markdown = locale.success
        ? docMarkdown(slug === "index" ? "" : slug, locale.data)
        : undefined;
      if (markdown === undefined) throw new ResourceNotFoundError(uri.href);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: markdown }] };
    },
  );

  for (const kind of ["examples", "templates"] as const) {
    server.registerResource(
      kind,
      new ResourceTemplate(`overcrow://${kind}/{name}/{+path}`, {
        list: async () => ({
          resources: projects(kind)
            .filter((project) => project.name !== "shared" || kind === "templates")
            .flatMap((project) =>
              project.files.map((file) => ({
                uri: `overcrow://${kind}/${project.name}/${file}`,
                name: `${project.name}/${file}`,
                mimeType: mimeOf(file),
              })),
            ),
        }),
      }),
      {
        title: kind === "examples" ? "Example widgets" : "Templates",
        description:
          kind === "examples"
            ? "Source files of the reference widgets and of the documentation's examples."
            : "Source files of the templates of a new widget.",
      },
      async (uri, variables) => {
        const name = single(variables.name);
        const path = single(variables.path);
        const text = projectFile(kind, name, path);
        if (text === undefined) throw new ResourceNotFoundError(uri.href);
        return { contents: [{ uri: uri.href, mimeType: mimeOf(path), text }] };
      },
    );
  }
}
