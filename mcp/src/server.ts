// The MCP server: its identity, its instructions, its tools, resources and
// prompts. One instance per protocol era (see serveStdio); the session is
// shared.

import { McpServer } from "@modelcontextprotocol/server";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import type { Session } from "./session.js";
import { INSTRUCTIONS } from "./texts.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerBuildTools } from "./tools/build.js";
import { registerDocTools } from "./tools/docs.js";
import { registerProjectTools } from "./tools/project.js";
import { registerSetupTools } from "./tools/setup.js";
import { VERSION } from "./version.js";

export function createServer(session: Session): McpServer {
  const server = new McpServer(
    { name: "overcrow", title: "PlayerVox OverCrow widgets", version: VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  const env = { session, server };
  // Registration order is the order of tools/list: the order of the work.
  registerSetupTools(env);
  registerProjectTools(env);
  registerBuildTools(env);
  registerAuditTools(env);
  registerDocTools(env);
  registerResources(server);
  registerPrompts(server);
  try {
    // Clients of the 2025 protocol say when their roots change.
    server.server.setNotificationHandler("notifications/roots/list_changed", () =>
      session.rootsChanged(),
    );
  } catch {
    // The 2026-07-28 protocol has no such notification.
  }
  return server;
}
