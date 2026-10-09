// status and setup: what is ready, and the one tool that downloads.

import { z } from "zod";
import { findNpmCli } from "../npm.js";
import { DESCRIPTIONS } from "../texts.js";
import { VERSION } from "../version.js";
import { fail, failure, ok, progress, READ_ONLY, type ToolEnv, withRoots } from "./common.js";

const NODE_MINIMUM = [22, 18];

function nodeOk(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return (
    major > (NODE_MINIMUM[0] as number) ||
    (major === NODE_MINIMUM[0] && minor >= (NODE_MINIMUM[1] as number))
  );
}

export function registerSetupTools(env: ToolEnv): void {
  const { server, session } = env;

  server.registerTool(
    "status",
    {
      title: "Status",
      description: DESCRIPTIONS.status,
      inputSchema: z.strictObject({}),
      outputSchema: z.object({
        server: z.string(),
        node: z.object({ version: z.string(), ok: z.boolean() }),
        npm: z.boolean(),
        platform: z.object({
          supported: z.boolean(),
          name: z.string().nullable(),
          message: z.string().nullable(),
        }),
        release: z.string().nullable(),
        sdk: z.string(),
        typescript: z.string(),
        tools: z.object({
          installed: z.boolean(),
          cli: z.string().nullable(),
          folder: z.string().nullable(),
        }),
        projectFolders: z.array(z.string()),
        projectProblem: z.string().nullable(),
        next: z.string(),
      }),
      annotations: { title: "Status", ...READ_ONLY },
    },
    async (_args, ctx) => {
      const platform = session.platform;
      const tools = await session.installedTools().catch(() => undefined);
      const answer = await session.roots(ctx, server);
      if ("input" in answer) return answer.input;
      const confinement = "confinement" in answer ? answer.confinement : undefined;
      const redactor = session.redactor(confinement);
      const release = session.options.pin.release;
      let next: string;
      if (!("platform" in platform)) next = platform.unsupported;
      else if (!nodeOk())
        next = `Node.js ${process.versions.node} is too old: install Node.js 22.18 or later.`;
      else if (!release)
        next =
          "This version of @overcrow/mcp is not tied to a published OverCrow release yet: update it.";
      else if (!tools) next = "Run setup to install the creator tools.";
      else if ("error" in answer) next = answer.error;
      else next = "Ready. Create a widget with create_widget, or check an existing one with check.";
      return ok(
        {
          server: `@overcrow/mcp ${VERSION}`,
          node: { version: process.versions.node, ok: nodeOk() },
          npm: findNpmCli() !== undefined,
          platform: {
            supported: "platform" in platform,
            name: "platform" in platform ? platform.platform : null,
            message: "unsupported" in platform ? platform.unsupported : null,
          },
          release,
          sdk: session.options.pin.npm.sdk.version,
          typescript: session.options.pin.npm.typescript.version,
          tools: {
            installed: tools !== undefined,
            cli: tools ? tools.cliVersion : null,
            folder: tools ? tools.directory : null,
          },
          projectFolders: confinement ? confinement.roots.map((root) => root.path) : [],
          projectProblem: "error" in answer ? answer.error : null,
          next,
        },
        next,
        { redactor },
      );
    },
  );

  server.registerTool(
    "setup",
    {
      title: "Install the creator tools",
      description: DESCRIPTIONS.setup,
      inputSchema: z.strictObject({
        zipPath: z
          .string()
          .min(1)
          .max(1024)
          .optional()
          .describe(
            "A local copy of the creator tools ZIP, inside the project, for offline use. It must be the exact pinned file.",
          ),
      }),
      outputSchema: z.object({
        release: z.string(),
        platform: z.string(),
        cli: z.string(),
        folder: z.string(),
        source: z.enum(["cache", "local", "download"]),
        seconds: z.number(),
      }),
      annotations: {
        title: "Install the creator tools",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zipPath }, ctx) => {
      const started = Date.now();
      const report = progress(ctx);
      const run = async (localZip: string | undefined, redactor = session.redactor()) => {
        try {
          const { tools, source } = await session.setup(
            localZip,
            report
              ? (done, total) => report(done, total, "Downloading the creator tools")
              : undefined,
            ctx.mcpReq.signal,
          );
          const summary =
            source === "cache"
              ? `The creator tools of OverCrow ${tools.release} are already installed and intact.`
              : `Installed the creator tools of OverCrow ${tools.release} (CLI ${tools.cliVersion}) after checking every file.`;
          return ok(
            {
              release: tools.release,
              platform: tools.platform,
              cli: tools.cliVersion,
              folder: tools.directory,
              source,
              seconds: Math.round((Date.now() - started) / 100) / 10,
            },
            summary,
            { redactor },
          );
        } catch (error) {
          return failure(error, redactor);
        }
      };
      if (zipPath === undefined) return run(undefined);
      // A local ZIP is read only inside the project folders.
      return withRoots(env, ctx, async (confinement, redactor) => {
        if (!zipPath.toLowerCase().endsWith(".zip")) return fail("zipPath must name a .zip file.");
        const file = await confinement.resolve(zipPath, "file");
        return run(file, redactor);
      });
    },
  );
}
