// A local HTTPS server for the download tests, with a certificate made for
// the test run by openssl (no key is committed), and a CONNECT proxy.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A self-signed certificate for localhost, or null without openssl. */
export function certificate() {
  const directory = mkdtempSync(join(tmpdir(), "overcrow-mcp-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(join(directory, "key.pem")),
      cert: readFileSync(join(directory, "cert.pem")),
    };
  } catch {
    return null;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Starts an HTTPS server; `routes` maps a path to (request, response) => void. */
export async function serve(tls, routes) {
  const requests = [];
  const server = createServer(tls, (request, response) => {
    requests.push(request.url);
    const handler = routes[request.url ?? ""] ?? routes["*"];
    if (!handler) {
      response.writeHead(404).end();
      return;
    }
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    url: (path) => `https://localhost:${port}${path}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

/** An HTTP proxy that only tunnels CONNECT, recording the targets. */
export async function proxy() {
  const targets = [];
  const sockets = new Set();
  const server = createHttpServer((_, response) => response.writeHead(405).end());
  server.on("connect", (request, client, head) => {
    targets.push({ target: request.url, auth: request.headers["proxy-authorization"] ?? null });
    const [host, port] = (request.url ?? "").split(":");
    sockets.add(client);
    const upstream = connect(Number(port), host === "localhost" ? "127.0.0.1" : host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://user:p%40ss@127.0.0.1:${server.address().port}`,
    targets,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}
