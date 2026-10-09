// list_templates, create_widget and install_sdk: starting a widget project.

import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { Cli } from "../cli.js";
import { projects } from "../content.js";
import { installPackages } from "../npm.js";
import { cleanLine } from "../text.js";
import { DESCRIPTIONS, TEMPLATE_SUMMARIES } from "../texts.js";
import { fail, ok, READ_ONLY, TOOLS_MISSING, type ToolEnv, withRoots } from "./common.js";

/** The CLI's ID rule (reverse DNS, lowercase labels) without the reserved PlayerVox IDs. */
export const WIDGET_ID =
  /^(?=.{3,128}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TEMPLATES = ["blank", "counter", "list", "chart"] as const;

export function idProblem(id: string): string | undefined {
  if (!WIDGET_ID.test(id)) {
    return "The ID must be a reverse-DNS name in lowercase, such as com.yourname.clock: at least two parts separated by dots, letters, digits and dashes.";
  }
  if (id === "com.playervox" || id.startsWith("com.playervox.")) {
    return "IDs under com.playervox are reserved for widgets published by PlayerVox: use a domain you control.";
  }
  return undefined;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse them
const REFUSED_IN_NAME = /[\u0000-\u001f\u007f<>]/;

export function nameProblem(name: string): string | undefined {
  if (
    name !== name.trim() ||
    name.length === 0 ||
    [...name].length > 48 ||
    REFUSED_IN_NAME.test(name)
  ) {
    return "The name must be 1 to 48 characters, without spaces at either end, control characters, < or >.";
  }
  return undefined;
}

async function listFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(relative(directory, path).split(sep).join("/"));
    }
  };
  await walk(directory);
  return out.sort();
}

export function registerProjectTools(env: ToolEnv): void {
  const { server, session } = env;

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: DESCRIPTIONS.list_templates,
      inputSchema: z.strictObject({}),
      outputSchema: z.object({
        templates: z.array(
          z.object({
            name: z.string(),
            summary: z.string(),
            files: z.array(z.string()),
            resource: z.string(),
          }),
        ),
      }),
      annotations: { title: "List templates", ...READ_ONLY },
    },
    async () => {
      const shared =
        projects("templates").find((project) => project.name === "shared")?.files ?? [];
      const templates = TEMPLATES.map((name) => {
        const project = projects("templates").find((candidate) => candidate.name === name);
        return {
          name,
          summary: TEMPLATE_SUMMARIES[name] ?? "",
          files: [
            ...(project?.files ?? []),
            ...shared.map((file) => (file === "gitignore" ? ".gitignore" : file)),
          ].sort(),
          resource: `overcrow://templates/${name}/logic.ts`,
        };
      });
      return ok(
        { templates },
        `${templates.length} templates: ${templates.map((t) => `${t.name} (${t.summary})`).join("; ")}`,
      );
    },
  );

  server.registerTool(
    "create_widget",
    {
      title: "Create a widget",
      description: DESCRIPTIONS.create_widget,
      inputSchema: z.strictObject({
        directory: z
          .string()
          .min(1)
          .max(1024)
          .describe("A new folder, relative to the project folder."),
        template: z.enum(TEMPLATES).default("blank"),
        id: z
          .string()
          .min(3)
          .max(128)
          .describe(
            "Reverse-DNS widget ID under a domain the user controls, e.g. com.yourname.clock.",
          ),
        name: z
          .string()
          .min(1)
          .max(48)
          .describe("The widget's name shown to users, 1 to 48 characters."),
      }),
      outputSchema: z.object({
        directory: z.string(),
        template: z.string(),
        id: z.string(),
        files: z.array(z.string()),
        warnings: z.array(z.string()),
        next: z.string(),
      }),
      annotations: {
        title: "Create a widget",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ directory, template, id, name }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const problem = idProblem(id) ?? nameProblem(name);
        if (problem) return fail(problem);
        const tools = await session.installedTools();
        if (!tools) return fail(TOOLS_MISSING);
        const target = await confinement.resolve(directory, "new-directory");
        const existing = await readdir(target).catch(() => []);
        if (existing.length > 0)
          return fail(
            `${directory} already exists and is not empty: create_widget never overwrites files. Choose a new folder.`,
          );
        const result = await new Cli(tools).init(
          target,
          template,
          id,
          name,
          confinement.roots[0]?.path ?? target,
        );
        if (!result.ok) {
          const reason = cleanLine(
            result.stderr.split("\n").find((line) => line.trim() !== "") ?? `exit ${result.code}`,
          );
          return fail(`The widget could not be created: ${reason}`, redactor);
        }
        const warnings = /^(com|org|net)\.example\./.test(id)
          ? ["The ID uses example.*: replace it with a domain the user controls before submitting."]
          : [];
        return ok(
          {
            directory: confinement.display(target),
            template,
            id,
            files: await listFiles(target),
            warnings,
            next: "Ask the user before installing packages, then run install_sdk with confirm: true, then check.",
          },
          `Created ${confinement.display(target)} from the ${template} template.`,
          { redactor },
        );
      }),
  );

  server.registerTool(
    "install_sdk",
    {
      title: "Install the SDK",
      description: DESCRIPTIONS.install_sdk,
      inputSchema: z.strictObject({
        directory: z
          .string()
          .min(1)
          .max(1024)
          .describe("The widget folder, relative to the project folder."),
        confirm: z
          .literal(true)
          .describe("Must be true: the user agreed to download the packages from npm."),
      }),
      outputSchema: z.object({
        directory: z.string(),
        installed: z.array(
          z.object({
            name: z.string(),
            version: z.string().nullable(),
            integrityMatches: z.boolean(),
          }),
        ),
        next: z.string(),
      }),
      annotations: {
        title: "Install the SDK",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ directory }, ctx) =>
      withRoots(env, ctx, async (confinement, redactor) => {
        const target = await confinement.resolve(directory, "directory");
        const pins = session.options.pin.npm;
        const cliSdk = session.cliSdkVersion;
        if (cliSdk && cliSdk !== pins.sdk.version) {
          return fail(
            `The installed CLI uses @overcrow/sdk ${cliSdk} but this server pins ${pins.sdk.version}: update @overcrow/mcp.`,
          );
        }
        const installed = await installPackages(target, pins, ctx.mcpReq.signal);
        return ok(
          { directory: confinement.display(target), installed, next: "Run check." },
          `Installed @overcrow/sdk ${pins.sdk.version} and TypeScript ${pins.typescript.version}; their integrity matches the published packages.`,
          { redactor },
        );
      }),
  );
}
