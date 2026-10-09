// End-to-end proof of @overcrow/mcp on a fresh copy, before the release
// exists: the package is packed and installed from its tarball (fresh npm
// cache), the creator tools ZIPs are assembled in the release layout from a
// CLI built from this revision and the published 0.6.0-beta.1 runtime (the
// one that CLI pins), served by a local HTTPS server shaped like GitHub
// (302 to an asset host), and the installed server runs with an empty
// home folder and no OverCrow tool on PATH. A scripted MCP client (the
// official SDK) then goes through status → setup → create_widget →
// install_sdk → check → test → audit → package → inspect →
// prepare_submission. It also writes the MCP configuration for a run of
// `claude -p` on the same setup.
//
//   node test/e2e/proof.mjs <work dir> <overcrow-widget binary> <runtimes dir>
//
// Not part of npm test: it needs the built CLI, the runtime and the network
// (npm). Nothing is published.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { certificate } from "../support/https.mjs";
import { schemaErrors } from "../support/schema.mjs";
import { assembleRelease, sha256 } from "../support/tools.mjs";

const [workArg, cliArg, runtimesArg, mode, prompt] = process.argv.slice(2);
if (!workArg || !cliArg || !runtimesArg) {
  console.error(
    "usage: node test/e2e/proof.mjs <work dir> <overcrow-widget binary> <runtimes dir>",
  );
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const mcp = resolve(here, "..", "..");
const work = resolve(workArg);
const RELEASE = "0.6.0-beta.1";
rmSync(work, { recursive: true, force: true });
for (const directory of ["pkg", "install", "npm-cache", "home", "project", "zips"])
  mkdirSync(join(work, directory), { recursive: true });
const log = [];
const note = (entry) => {
  log.push({ at: new Date().toISOString(), ...entry });
  console.log(JSON.stringify(entry).slice(0, 400));
};

// 1. The package, packed and installed like `npx` installs it.
const npmEnv = {
  ...process.env,
  npm_config_cache: join(work, "npm-cache"),
  npm_config_update_notifier: "false",
};
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", join(work, "pkg")], {
    cwd: mcp,
    env: npmEnv,
    encoding: "utf8",
  }).replace(/^[^[]*/s, ""),
)[0];
const tarball = join(work, "pkg", packed.filename);
note({
  step: "pack",
  file: packed.filename,
  bytes: statSync(tarball).size,
  sha256: sha256(readFileSync(tarball)),
  files: packed.files.length,
});
writeFileSync(join(work, "install", "package.json"), "{}\n");
const started = Date.now();
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
  cwd: join(work, "install"),
  env: npmEnv,
  stdio: "inherit",
});
const tree = JSON.parse(
  execFileSync("npm", ["ls", "--all", "--json"], {
    cwd: join(work, "install"),
    env: npmEnv,
    encoding: "utf8",
  }),
);
const deps = tree.dependencies["@overcrow/mcp"].dependencies;
note({
  step: "npm install of the tarball",
  seconds: (Date.now() - started) / 1000,
  installed: Object.fromEntries(Object.entries(deps).map(([name, info]) => [name, info.version])),
  core:
    deps["@modelcontextprotocol/server"].dependencies?.["@modelcontextprotocol/core"]?.version ??
    "deduped",
});
const dist = join(work, "install", "node_modules", "@overcrow", "mcp", "dist");
note({
  step: "bin --version",
  out: execFileSync(process.execPath, [join(dist, "index.js"), "--version"], {
    encoding: "utf8",
  }).trim(),
});

// 2. The creator tools ZIPs, in the release layout.
const strippedCli = join(work, "overcrow-widget-stripped");
execFileSync("strip", ["-o", strippedCli, resolve(cliArg)]);
const runtimes = resolve(runtimesArg);
const release = assembleRelease({
  release: RELEASE,
  cliVersion: JSON.parse(
    execFileSync(strippedCli, ["--version", "--format", "json"], { encoding: "utf8" }),
  ).version,
  executables: {
    "linux-x86_64": {
      cli: readFileSync(strippedCli),
      runtime: readFileSync(join(runtimes, `overcrow-widget-headless-${RELEASE}-linux-x86_64`)),
    },
    "windows-x86_64": {
      cli: Buffer.from("The Windows CLI is not built for this proof.\n"),
      runtime: readFileSync(
        join(runtimes, `overcrow-widget-headless-${RELEASE}-windows-x86_64.exe`),
      ),
    },
  },
});
for (const [platform, zip] of Object.entries(release.zips))
  writeFileSync(join(work, "zips", release.pin.tools[platform].name), zip);
note({
  step: "zips",
  linux: {
    bytes: release.pin.tools["linux-x86_64"].size,
    sha256: release.pin.tools["linux-x86_64"].sha256,
  },
});

// 3. A local "GitHub": the release URL redirects to an asset host.
const tls = certificate();
if (!tls) throw new Error("openssl is needed for the local HTTPS server");
writeFileSync(join(work, "ca.pem"), tls.cert);
const requests = [];
const server = createServer(tls, (request, response) => {
  requests.push(request.url);
  const name = /\/releases\/download\/v[^/]+\/([^/]+)$/.exec(request.url ?? "")?.[1];
  if (name) return response.writeHead(302, { location: `/assets/${name}` }).end();
  const asset = /^\/assets\/([^/]+)$/.exec(request.url ?? "")?.[1];
  if (asset) {
    try {
      const body = readFileSync(join(work, "zips", asset));
      return response.writeHead(200, { "content-length": body.length }).end(body);
    } catch {
      // Not found below.
    }
  }
  response.writeHead(404).end();
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;

// 4. The server's configuration and environment: an empty home folder, no
// OverCrow tool on PATH, a fresh npm cache.
const config = {
  dist,
  pin: release.pin,
  releaseBase: `https://localhost:${port}`,
  releasePort: port,
  caFile: join(work, "ca.pem"),
  cwd: join(work, "project"),
};
writeFileSync(join(work, "config.json"), JSON.stringify(config, null, 1));
const serverEnv = {
  HOME: join(work, "home"),
  // Clients add their own environment to this one: name every location.
  XDG_CACHE_HOME: join(work, "home", ".cache"),
  PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  LANG: "C.UTF-8",
  npm_config_cache: join(work, "npm-cache"),
};
writeFileSync(
  join(work, "claude-mcp.json"),
  `${JSON.stringify({ mcpServers: { overcrow: { command: process.execPath, args: [join(mcp, "test", "support", "server.mjs"), join(work, "config.json")], env: serverEnv } } }, null, 1)}\n`,
);
note({
  step: "environment",
  overcrowWidgetOnPath: (() => {
    try {
      execFileSync("sh", ["-c", "command -v overcrow-widget"], { env: serverEnv });
      return true;
    } catch {
      return false;
    }
  })(),
});

// 5a. Or a real client: Claude Code in print mode, with this server only.
if (mode === "--claude") {
  const started = Date.now();
  const stream = join(work, "claude-stream.jsonl");
  try {
    // Asynchronous: the local release server of this process must keep answering.
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "-p",
          prompt ?? "",
          "--strict-mcp-config",
          "--mcp-config",
          join(work, "claude-mcp.json"),
          "--allowedTools",
          process.env.PROOF_ALLOWED_TOOLS ?? "mcp__overcrow__*",
          "--output-format",
          "stream-json",
          "--verbose",
          "--max-turns",
          "80",
        ],
        { cwd: join(work, "project"), stdio: ["ignore", "pipe", "inherit"] },
      );
      const chunks = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      const timer = setTimeout(() => child.kill(), 30 * 60_000);
      child.once("error", reject);
      child.once("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    writeFileSync(stream, output);
  } finally {
    note({ step: "claude -p", seconds: (Date.now() - started) / 1000, requests });
    server.close();
    server.closeAllConnections();
    writeFileSync(join(work, "proof-log.json"), `${JSON.stringify(log, null, 1)}\n`);
  }
  process.exit(0);
}

// 5. The scripted client.
const client = new Client(
  { name: "overcrow-mcp-proof", version: "1" },
  { capabilities: { roots: {} } },
);
client.setRequestHandler("roots/list", () => ({
  roots: [{ uri: pathToFileURL(join(work, "project")).href, name: "project" }],
}));
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(mcp, "test", "support", "server.mjs"), join(work, "config.json")],
    env: serverEnv,
    cwd: join(work, "project"),
    stderr: "inherit",
  }),
);
const schemas = Object.fromEntries(
  (await client.listTools()).tools.map((tool) => [tool.name, tool.outputSchema]),
);
const call = async (name, args = {}) => {
  const begin = Date.now();
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 20 * 60_000,
  });
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  note({
    step: `tool ${name}`,
    args,
    seconds: (Date.now() - begin) / 1000,
    isError: result.isError === true,
    summary: text.split("\n")[0],
    images: result.content?.filter((block) => block.type === "image").length ?? 0,
    structured: result.structuredContent,
  });
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  const mismatches = schemaErrors(result.structuredContent, schemas[name]);
  if (mismatches.length > 0)
    throw new Error(`${name}: output schema mismatch: ${mismatches.join("; ")}`);
  return result;
};
try {
  await call("status");
  await call("setup");
  await call("setup");
  await call("create_widget", {
    directory: "pomodoro",
    template: "counter",
    id: "com.mcp-proof.pomodoro",
    name: "Pomodoro",
  });
  await call("install_sdk", { directory: "pomodoro", confirm: true });
  await call("check", { directory: "pomodoro" });
  await call("use_preview", { directory: "pomodoro", scenario: "example", image: "initial" });
  await call("test", { directory: "pomodoro" });
  await call("audit", { directory: "pomodoro" });
  await call("package", { directory: "pomodoro" });
  await call("inspect", { file: "pomodoro/dist/com.mcp-proof.pomodoro-0.1.0.ocpkg" });
  await call("prepare_submission", { directory: "pomodoro" });
  note({ step: "requests to the local GitHub", requests });
} finally {
  await client.close();
  server.close();
  server.closeAllConnections();
  writeFileSync(join(work, "proof-log.json"), `${JSON.stringify(log, null, 1)}\n`);
}
