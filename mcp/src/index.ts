#!/usr/bin/env node
// @overcrow/mcp: an MCP server over stdio for creators of OverCrow
// widgets. Standard output carries only MCP messages; the few log lines go
// to standard error. No telemetry.
//
//   npx -y @overcrow/mcp [--root <folder>]... [--tools-zip <file>]

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { shippedPin } from "./bootstrap/pin.js";
import { stopAll } from "./run.js";
import { createServer } from "./server.js";
import { Session } from "./session.js";
import { VERSION } from "./version.js";

const USAGE = `Usage: overcrow-mcp [--root <folder>]... [--tools-zip <file>]

An MCP server (stdio) for creating PlayerVox OverCrow widgets with an AI assistant.
  --root <folder>      a project folder the server may use (repeatable);
                       by default, the client's folders or the working directory
  --tools-zip <file>   a local copy of the pinned creator tools ZIP (offline use)
  --version            print the version
Guide: https://overcrow.playervox.com/docs/en/ai/`;

function log(message: string): void {
  process.stderr.write(`overcrow-mcp: ${message}\n`);
}

function parse(argv: readonly string[]): { roots: string[]; toolsZip: string | undefined } {
  const roots: string[] = [];
  let toolsZip: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const [flag, inline] =
      argument.startsWith("--") && argument.includes("=")
        ? argument.split(/=(.*)/s, 2)
        : [argument, undefined];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next === undefined || next === "") throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--root") roots.push(value());
    else if (flag === "--tools-zip") toolsZip = value();
    else if (flag === "--version" || flag === "-V") {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    } else if (flag === "--help" || flag === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument ${argument}`);
  }
  return { roots, toolsZip };
}

let options: ReturnType<typeof parse>;
try {
  options = parse(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`overcrow-mcp: ${(error as Error).message}\n\n${USAGE}\n`);
  process.exit(2);
}

const session = new Session({
  launchRoots: options.roots,
  toolsZip: options.toolsZip,
  pin: shippedPin(),
  cwd: process.cwd(),
});
const handle = serveStdio(() => createServer(session), {
  onerror: (error) => log(`protocol error: ${error.message}`),
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  stopAll();
  handle.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
// The client closing stdin ends the server (MCP stdio transport).
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
