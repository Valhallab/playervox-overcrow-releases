import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { checkUrl, DownloadError, downloadPinned } from "../dist/bootstrap/download.js";
import { certificate, proxy, serve } from "./support/https.mjs";

const tls = certificate();
const skip = tls ? false : "openssl is not available to make a test certificate";
const body = Buffer.alloc(300_000, 9);
const sha = createHash("sha256").update(body).digest("hex");
let server;
let work;

before(async () => {
  if (!tls) return;
  work = mkdtempSync(join(tmpdir(), "overcrow-mcp-download-"));
  server = await serve(tls, {
    "/file": (_, response) => response.writeHead(200, { "content-length": body.length }).end(body),
    "/chunked": (_, response) => {
      response.writeHead(200);
      response.end(Buffer.concat([body, Buffer.from("more")]));
    },
    "/short": (_, response) => {
      response.writeHead(200, { "content-length": body.length });
      response.write(body.subarray(0, 1000));
      response.socket.destroy();
    },
    "/wrong-length": (_, response) =>
      response.writeHead(200, { "content-length": 12 }).end("123456789012"),
    "/redirect-same": (_, response) => response.writeHead(302, { location: "/file" }).end(),
    "/redirect-other": (_, response) =>
      response.writeHead(302, { location: `https://127.0.0.1:${server.port}/file` }).end(),
    "/redirect-http": (_, response) =>
      response.writeHead(302, { location: `http://localhost:${server.port}/file` }).end(),
    "/loop": (_, response) => response.writeHead(302, { location: "/loop" }).end(),
    "/gzip": (_, response) => response.writeHead(200, { "content-encoding": "gzip" }).end("x"),
  });
});

after(async () => {
  await server?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

let count = 0;
const destination = () => join(work, `d${++count}.zip`);
const options = (extra = {}) => ({
  allowedHosts: ["localhost"],
  expectedSize: body.length,
  ca: tls?.cert,
  port: server?.port,
  ...extra,
});

async function refusedWith(url, reason, extra) {
  const path = destination();
  await assert.rejects(
    downloadPinned(url, path, options(extra)),
    (error) => error instanceof DownloadError && reason.test(error.reason),
  );
  assert.equal(existsSync(path), false, "nothing is kept after a failure");
}

test("downloads, counts and hashes the pinned file", { skip }, async () => {
  const path = destination();
  const result = await downloadPinned(server.url("/file"), path, options());
  assert.deepEqual(result, { sha256: sha, size: body.length });
  assert.deepEqual(readFileSync(path), body);
});

test("follows a redirect to an allowed host only", { skip }, async () => {
  const result = await downloadPinned(server.url("/redirect-same"), destination(), options());
  assert.equal(result.sha256, sha);
  await refusedWith(server.url("/redirect-other"), /another host/);
  await refusedWith(server.url("/redirect-http"), /non-HTTPS/);
  await refusedWith(server.url("/loop"), /too many redirects/);
});

test("refuses another size, extra bytes, a cut and an encoding", { skip }, async () => {
  await refusedWith(server.url("/wrong-length"), /another size/);
  await refusedWith(server.url("/chunked"), /larger than the pinned size/);
  await refusedWith(server.url("/short"), /cut|ended early/);
  await refusedWith(server.url("/gzip"), /encoding/);
  await refusedWith(server.url("/missing"), /not published/);
});

test("refuses an untrusted certificate", { skip }, async () => {
  await refusedWith(server.url("/file"), /TLS|certificate/, { ca: undefined });
});

test("refuses a closed port and an unknown host", { skip }, async () => {
  await refusedWith("https://localhost:1/file", /refused|network/, { port: 1 });
  await refusedWith("https://no-such-host.invalid/file", /resolved|another host/, {
    allowedHosts: ["no-such-host.invalid"],
  });
});

test("goes through an HTTP proxy with CONNECT, credentials included", { skip }, async () => {
  const relay = await proxy();
  try {
    const result = await downloadPinned(
      server.url("/file"),
      destination(),
      options({ proxy: relay.url }),
    );
    assert.equal(result.sha256, sha);
    assert.equal(relay.targets[0].target, `localhost:${server.port}`);
    assert.equal(relay.targets[0].auth, `Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  } finally {
    await relay.close();
  }
});

test("URL rules: HTTPS, allowed hosts, port 443, no credentials", () => {
  const hosts = ["github.com"];
  assert.doesNotThrow(() => checkUrl(new URL("https://github.com/a"), hosts));
  for (const url of [
    "http://github.com/a",
    "https://evil.com/a",
    "https://user:pw@github.com/a",
    "https://github.com:8443/a",
  ]) {
    assert.throws(() => checkUrl(new URL(url), hosts), DownloadError, url);
  }
});
