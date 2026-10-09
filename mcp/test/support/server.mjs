// The server with a test configuration, for the protocol tests and the
// end-to-end proof: the same code as the published bin (server.js,
// session.js), with the pin, the release address, the trusted certificate
// and the cache given by a JSON file. The published bin has no such switch.
// `dist` names the compiled package to run (by default this checkout's
// dist/; the end-to-end proof passes the copy installed from the tarball).
//
//   node test/support/server.mjs <config.json>

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const dist = config.dist
  ? pathToFileURL(`${config.dist}/`).href
  : new URL("../../dist/", import.meta.url).href;
const load = (path) => import(new URL(path, dist).href);
const [{ shippedPin, validatePin }, { stopAll }, { serve }, { Session }] = await Promise.all([
  load("bootstrap/pin.js"),
  load("run.js"),
  load("server.js"),
  load("session.js"),
]);

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
const handle = serve(session, (error) =>
  process.stderr.write(`overcrow-mcp (test): ${error.message}\n`),
);
const shutdown = () => {
  stopAll();
  handle.close().finally(() => process.exit(0));
};
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
