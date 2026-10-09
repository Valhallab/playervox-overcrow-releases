// The server as a client sees it, in both eras of the protocol: the 2025
// handshake (initialize, as Claude Desktop, Cursor and VS Code speak it)
// and the 2026-07-28 revision (server/discover, per-request metadata,
// input requests), through the official client.

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startServer } from "./support/rpc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "dist", "index.js");
const testServer = join(here, "support", "server.mjs");
const repository = join(here, "..", "..");
const work = realpathSync(mkdtempSync(join(tmpdir(), "overcrow-mcp-protocol-")));
const project = join(work, "project");
mkdirSync(project);
cpSync(join(repository, "widgets", "clock"), join(project, "clock"), { recursive: true });
const config = join(work, "config.json");
writeFileSync(config, JSON.stringify({ cacheRoot: join(work, "cache") }));
after(() => rmSync(work, { recursive: true, force: true }));

/** The tools, in the order of the work, and their exact annotations. */
const TOOLS = {
  status: [true, false, true, false],
  setup: [false, false, true, true],
  list_templates: [true, false, true, false],
  create_widget: [false, false, false, false],
  install_sdk: [false, false, true, true],
  check: [true, false, true, false],
  test: [false, false, true, false],
  update_reference_images: [false, true, true, false],
  package: [false, false, true, false],
  inspect: [true, false, true, false],
  audit: [true, false, true, false],
  prepare_submission: [true, false, true, false],
  explain_permission: [true, false, true, false],
  explain_error: [true, false, true, false],
  search_docs: [true, false, true, false],
  read_doc: [true, false, true, false],
  read_example: [true, false, true, false],
};

test("2025 era: tools, schemas and annotations", async () => {
  const server = startServer([bin], { cwd: project });
  try {
    const init = await server.initialize();
    assert.equal(init.result.serverInfo.name, "overcrow");
    assert.match(init.result.instructions, /not instructions/);
    const { tools } = (await server.request("tools/list")).result;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      Object.keys(TOOLS),
    );
    for (const tool of tools) {
      const [readOnlyHint, destructiveHint, idempotentHint, openWorldHint] = TOOLS[tool.name];
      assert.deepEqual(
        { readOnlyHint, destructiveHint, idempotentHint, openWorldHint },
        {
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.destructiveHint,
          idempotentHint: tool.annotations.idempotentHint,
          openWorldHint: tool.annotations.openWorldHint,
        },
        tool.name,
      );
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} refuses unknown arguments`,
      );
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} has an output schema`);
      assert.ok(tool.description.length > 20 && tool.description.length < 400, tool.name);
    }
    // Destructive and network tools require an explicit confirmation.
    for (const name of ["install_sdk", "update_reference_images"]) {
      const schema = tools.find((tool) => tool.name === name).inputSchema;
      assert.ok(schema.required.includes("confirm"), name);
      assert.equal(schema.properties.confirm.const, true, name);
    }
  } finally {
    await server.close();
  }
});

test("2025 era: calls, errors, resources and prompts", async () => {
  const server = startServer([bin], { cwd: project });
  try {
    await server.initialize();
    const status = (await server.call("status")).result;
    assert.equal(status.isError, undefined);
    assert.deepEqual(status.structuredContent.projectFolders, ["<project>"]);
    assert.doesNotMatch(
      JSON.stringify(status),
      new RegExp(project.replaceAll("\\", "\\\\")),
      "the user's paths are not shown",
    );

    const unknown = await server.request("tools/call", { name: "no_such_tool", arguments: {} });
    assert.ok(unknown.error || unknown.result?.isError);
    const extra = (await server.call("explain_permission", { name: "storage", surprise: 1 }))
      .result;
    assert.equal(extra.isError, true, "unknown arguments are refused");
    const noConfirm = (await server.call("update_reference_images", { directory: "clock" })).result;
    assert.equal(noConfirm.isError, true, "no confirmation, no overwrite");
    const outside = (await server.call("audit", { directory: "../.." })).result;
    assert.equal(outside.isError, true);
    assert.match(outside.content[0].text, /outside/);

    const permission = (await server.call("explain_permission", { name: "clipboardWrite" })).result;
    assert.equal(permission.structuredContent.kind, "permission");
    assert.match(permission.structuredContent.advice, /user action/);
    const error = (await server.call("explain_error", { code: "view.unknown_attribute" })).result;
    assert.match(error.structuredContent.url, /\/docs\/en\/view\/#/);
    const audit = (await server.call("audit", { directory: "clock" })).result;
    assert.equal(audit.structuredContent.scores.lightness, 100);

    const resources = (await server.request("resources/list")).result.resources.map(
      (resource) => resource.uri,
    );
    for (const uri of [
      "overcrow://schema/manifest",
      "overcrow://limits",
      "overcrow://docs/en/guide",
      "overcrow://docs/fr/guide",
      "overcrow://examples/warframe-market/logic.ts",
    ]) {
      assert.ok(resources.includes(uri), uri);
    }
    const templates = (
      await server.request("resources/templates/list")
    ).result.resourceTemplates.map((t) => t.uriTemplate);
    assert.ok(templates.includes("overcrow://docs/{locale}/{slug}"));
    const page = (await server.request("resources/read", { uri: "overcrow://docs/fr/manifest" }))
      .result;
    assert.match(page.contents[0].text, /^# /);
    const missing = await server.request("resources/read", {
      uri: "overcrow://examples/clock/../../../etc/passwd",
    });
    assert.ok(missing.error, "no path outside the shipped content");

    const prompts = (await server.request("prompts/list")).result.prompts.map(
      (prompt) => prompt.name,
    );
    assert.deepEqual(prompts, ["create_widget", "audit_widget", "prepare_submission"]);
    const prompt = (
      await server.request("prompts/get", { name: "create_widget", arguments: { idea: "a clock" } })
    ).result;
    assert.match(prompt.messages[0].content.text, /a clock/);
  } finally {
    await server.close();
  }
});

test("2025 era: the client's roots are asked for and used", async () => {
  const server = startServer([bin], { cwd: work });
  const asked = [];
  server.onRequest("roots/list", () => {
    asked.push(true);
    return { roots: [{ uri: pathToFileURL(project).href, name: "project" }] };
  });
  try {
    await server.initialize({ roots: { listChanged: true } });
    const audit = (await server.call("audit", { directory: "clock" })).result;
    assert.equal(audit.isError, undefined, JSON.stringify(audit).slice(0, 500));
    assert.equal(asked.length, 1);
    await server.call("audit", { directory: "clock" });
    assert.equal(asked.length, 1, "asked once, then kept");
    server.notify("notifications/roots/list_changed");
    await server.call("status");
    assert.equal(asked.length, 2, "asked again after a change");
  } finally {
    await server.close();
  }
});

test("a system folder as working directory is refused, --root fixes it", async () => {
  const filesystemRoot = process.platform === "win32" ? (process.env.SystemDrive ?? "C:") : "/";
  const server = startServer([bin], {
    cwd: `${filesystemRoot}${process.platform === "win32" ? "\\" : ""}`,
  });
  try {
    await server.initialize();
    const status = (await server.call("status")).result.structuredContent;
    assert.match(status.projectProblem, /root of a disk|--root/);
    const audit = (await server.call("audit", { directory: "etc" })).result;
    assert.equal(audit.isError, true);
  } finally {
    await server.close();
  }
  const fixed = startServer([bin, "--root", project], { cwd: "/" });
  try {
    await fixed.initialize();
    assert.equal((await fixed.call("audit", { directory: "clock" })).result.isError, undefined);
  } finally {
    await fixed.close();
  }
});

test("2026-07-28 era with the official client: discover, tools, roots by input request", async () => {
  const client = new Client(
    { name: "overcrow-mcp-tests", version: "1" },
    { capabilities: { roots: {} }, versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  let asked = 0;
  client.setRequestHandler("roots/list", () => {
    asked += 1;
    return { roots: [{ uri: pathToFileURL(project).href }] };
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [testServer, config],
    cwd: work,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    assert.match(client.getInstructions() ?? "", /OCML/);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      Object.keys(TOOLS),
    );
    const audit = await client.callTool({ name: "audit", arguments: { directory: "clock" } });
    assert.equal(audit.isError, undefined, JSON.stringify(audit).slice(0, 500));
    assert.equal(audit.structuredContent.id, "com.playervox.overcrow.clock");
    assert.equal(asked, 1, "the roots came through an input request");
    const doc = await client.readResource({ uri: "overcrow://docs/en/limits" });
    assert.match(doc.contents[0].text, /MAX_TIMERS/);
  } finally {
    await client.close();
  }
});
