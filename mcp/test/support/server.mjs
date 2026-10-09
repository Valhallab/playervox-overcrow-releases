// The server with a test configuration, for the protocol tests and the
// end-to-end proof: the same code as the published bin (dist/server.js,
// dist/session.js), with the pin, the release address, the trusted
// certificate and the cache given by a JSON file. The published bin has no
// such switch.
//
//   node test/support/server.mjs <config.json>

import { readFileSync } from "node:fs";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { shippedPin, validatePin } from "../../dist/bootstrap/pin.js";
import { stopAll } from "../../dist/run.js";
import { createServer } from "../../dist/server.js";
import { Session } from "../../dist/session.js";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const session = new Session({
  launchRoots: config.roots ?? [],
  toolsZip: config.toolsZip,
  pin: config.pin ? validatePin(config.pin) : shippedPin(),
  cwd: config.cwd ?? process.cwd(),
  ...(config.releaseBase
    ? { releaseBase: config.releaseBase, releasePort: config.releasePort }
    : {}),
  ...(config.caFile ? { ca: readFileSync(config.caFile) } : {}),
  ...(config.cacheRoot ? { cacheRootOverride: config.cacheRoot } : {}),
});
const handle = serveStdio(() => createServer(session), {
  onerror: (error) => process.stderr.write(`overcrow-mcp (test): ${error.message}\n`),
});
const shutdown = () => {
  stopAll();
  handle.close().finally(() => process.exit(0));
};
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
