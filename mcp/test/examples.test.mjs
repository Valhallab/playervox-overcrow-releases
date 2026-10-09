// The client configurations that the documentation quotes start this
// package, and the one-click link of VS Code installs the same thing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const docs = join(here, "..", "..", "docs", "content");
const SERVER = ["-y", "@overcrow/mcp"];

test("the JSON configurations run npx -y @overcrow/mcp", () => {
  const cursor = JSON.parse(readFileSync(join(examples, "cursor-mcp.json"), "utf8"));
  assert.deepEqual(cursor.mcpServers.overcrow, { command: "npx", args: SERVER });
  const vscode = JSON.parse(readFileSync(join(examples, "vscode-mcp.json"), "utf8"));
  assert.deepEqual(vscode.servers.overcrow, { type: "stdio", command: "npx", args: SERVER });
  const desktop = JSON.parse(readFileSync(join(examples, "claude_desktop_config.json"), "utf8"));
  assert.equal(desktop.mcpServers.overcrow.command, "npx");
  assert.deepEqual(desktop.mcpServers.overcrow.args.slice(0, 3), [...SERVER, "--root"]);
});

test("the Codex configuration runs the same command", () => {
  const toml = readFileSync(join(examples, "codex-config.toml"), "utf8");
  assert.match(toml, /^\[mcp_servers\.overcrow\]$/m);
  assert.match(toml, /^command = "npx"$/m);
  assert.match(toml, /^args = \["-y", "@overcrow\/mcp"\]$/m);
});

test("the VS Code link of both pages installs the same server", () => {
  for (const locale of ["en", "fr"]) {
    const page = readFileSync(join(docs, locale, "ai.md"), "utf8");
    const link = /\]\((https:\/\/insiders\.vscode\.dev\/redirect\?url=[^)]+)\)/.exec(page)?.[1];
    assert.ok(link, locale);
    const target = decodeURIComponent(new URL(link).searchParams.get("url") ?? "");
    assert.ok(target.startsWith("vscode:mcp/install?"), target);
    const config = JSON.parse(decodeURIComponent(target.slice("vscode:mcp/install?".length)));
    assert.deepEqual(config, { name: "overcrow", command: "npx", args: SERVER });
  }
});
