// A minimal MCP client of the 2025 protocol over stdio (the handshake of
// Claude Desktop, Cursor and VS Code today), with full control of what it
// declares and answers.

import { spawn } from "node:child_process";

export function startServer(args, { cwd, env } = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 0;
  const pending = new Map();
  const handlers = new Map();
  const notifications = [];
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        // A request of the server (roots/list…).
        const handler = handlers.get(message.method);
        const reply = handler
          ? { jsonrpc: "2.0", id: message.id, result: handler(message.params) }
          : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not supported" } };
        child.stdin.write(`${JSON.stringify(reply)}\n`);
      } else if (message.method) {
        notifications.push(message);
      } else if (pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error(`${method}: no answer\n${stderr}`)), 60_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method, params = {}) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return {
    child,
    request,
    notify,
    notifications,
    stderr: () => stderr,
    onRequest: (method, handler) => handlers.set(method, handler),
    async initialize(capabilities = {}) {
      const answer = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities,
        clientInfo: { name: "overcrow-mcp-tests", version: "1" },
      });
      notify("notifications/initialized");
      return answer;
    },
    call: (name, args = {}) => request("tools/call", { name, arguments: args }),
    close: () =>
      new Promise((resolve) => {
        child.once("exit", resolve);
        child.stdin.end();
        setTimeout(() => child.kill(), 5000).unref();
      }),
  };
}
