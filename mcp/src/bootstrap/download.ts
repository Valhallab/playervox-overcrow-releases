// Downloads one pinned file over HTTPS. Only the expected hosts are
// contacted; redirects are followed by hand and bounded; the size must be
// exactly the pinned size; the SHA-256 is computed while reading, and the
// caller compares it with the pin before anything reads the file.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { type ClientRequest, type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export interface DownloadOptions {
  /** Hosts a redirect may lead to; the first URL's host must be one too. */
  allowedHosts: readonly string[];
  expectedSize: number;
  maxRedirects?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** An `http://` proxy (CONNECT tunnel), or undefined for a direct connection. */
  proxy?: string | undefined;
  /** Extra trusted certificates (tests only). */
  ca?: string | Buffer | undefined;
  /** Port of the first URL (tests only); real downloads use 443. */
  port?: number | undefined;
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal | undefined;
}

export interface DownloadResult {
  sha256: string;
  size: number;
}

export class DownloadError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DownloadError";
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Checks that `target` is an HTTPS URL of an allowed host, without credentials. */
export function checkUrl(target: URL, allowedHosts: readonly string[], testPort?: number): void {
  if (target.protocol !== "https:")
    throw new DownloadError(`refused a non-HTTPS address (${target.protocol})`);
  if (target.username || target.password)
    throw new DownloadError("refused an address with credentials");
  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    throw new DownloadError(`refused a redirect to another host (${target.hostname})`);
  }
  const port = target.port === "" ? 443 : Number(target.port);
  if (port !== 443 && port !== testPort) throw new DownloadError(`refused port ${port}`);
}

/**
 * Downloads `url` into `destination` (created, never overwritten) and
 * returns its size and SHA-256. On any failure the partial file is removed.
 */
export async function downloadPinned(
  url: string,
  destination: string,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const deadline = Date.now() + (options.totalTimeoutMs ?? 10 * 60_000);
  let target = new URL(url);
  checkUrl(target, options.allowedHosts, options.port);
  try {
    for (let hop = 0; ; hop += 1) {
      const response = await get(target, options, deadline);
      const status = response.statusCode ?? 0;
      if (REDIRECTS.has(status)) {
        response.resume();
        const location = response.headers.location;
        if (!location) throw new DownloadError(`redirect ${status} without a location`);
        if (hop >= maxRedirects) throw new DownloadError("too many redirects");
        target = new URL(location, target);
        checkUrl(target, options.allowedHosts, options.port);
        continue;
      }
      if (status !== 200) {
        response.resume();
        throw new DownloadError(
          status === 404 ? "the file is not published (404)" : `the server answered ${status}`,
        );
      }
      return await save(response, destination, options, deadline);
    }
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(networkReason(error));
  }
}

function networkReason(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "the address could not be resolved (offline?)";
  if (code === "ECONNREFUSED") return "the connection was refused";
  if (code === "ECONNRESET" || code === "EPIPE") return "the connection was cut";
  if (code?.startsWith("ERR_TLS") || code?.includes("CERT"))
    return `the TLS certificate was refused (${code})`;
  if (code === "ABORT_ERR") return "cancelled";
  return code ? `network error (${code})` : "network error";
}

/** One GET request, directly or through the proxy's CONNECT tunnel. */
async function get(
  target: URL,
  options: DownloadOptions,
  deadline: number,
): Promise<IncomingMessage> {
  const host = target.hostname;
  const port = target.port === "" ? 443 : Number(target.port);
  const tunnel = options.proxy
    ? await connectThroughProxy(options.proxy, host, port, options, deadline)
    : undefined;
  const requestOptions: RequestOptions = {
    method: "GET",
    host,
    port,
    path: `${target.pathname}${target.search}`,
    servername: host,
    headers: {
      "user-agent": "overcrow-mcp",
      accept: "application/octet-stream",
      // The size check needs the bytes as stored.
      "accept-encoding": "identity",
    },
    rejectUnauthorized: true,
    agent: false,
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
    ...(tunnel ? { createConnection: () => tunnel } : {}),
  };
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(requestOptions, resolve);
    guard(request, options, deadline, reject);
    request.end();
  });
}

/** Applies the connection, idle and total timeouts and the abort signal to `request`. */
function guard(
  request: ClientRequest,
  options: DownloadOptions,
  deadline: number,
  reject: (error: Error) => void,
): void {
  const connectTimer = setTimeout(
    () => request.destroy(new DownloadError("the connection timed out")),
    Math.min(options.connectTimeoutMs ?? 30_000, Math.max(0, deadline - Date.now())),
  );
  request.once("response", () => clearTimeout(connectTimer));
  request.once("close", () => clearTimeout(connectTimer));
  request.setTimeout(options.idleTimeoutMs ?? 60_000, () =>
    request.destroy(new DownloadError("the server stopped sending")),
  );
  const onAbort = () => request.destroy(new DownloadError("cancelled"));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  request.once("close", () => options.signal?.removeEventListener("abort", onAbort));
  request.once("error", reject);
}

/** Opens a CONNECT tunnel through an `http://` proxy and returns its TLS socket. */
async function connectThroughProxy(
  proxy: string,
  host: string,
  port: number,
  options: DownloadOptions,
  deadline: number,
): Promise<TLSSocket> {
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
  } catch {
    throw new DownloadError("the proxy setting (HTTPS_PROXY) is not a valid address");
  }
  if (proxyUrl.protocol !== "http:") {
    throw new DownloadError("only an http:// proxy is supported (HTTPS_PROXY)");
  }
  const headers: Record<string, string> = { host: `${host}:${port}` };
  if (proxyUrl.username) {
    const credentials = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
    headers["proxy-authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }
  const socket = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const request = httpRequest({
      method: "CONNECT",
      host: proxyUrl.hostname,
      port: proxyUrl.port === "" ? 80 : Number(proxyUrl.port),
      path: `${host}:${port}`,
      headers,
      agent: false,
    });
    guard(request, options, deadline, reject);
    request.once("connect", (response, tunnelSocket) => {
      if (response.statusCode !== 200) {
        tunnelSocket.destroy();
        reject(new DownloadError(`the proxy refused the connection (${response.statusCode})`));
        return;
      }
      resolve(tunnelSocket);
    });
    request.end();
  });
  return tlsConnect({
    socket,
    servername: host,
    rejectUnauthorized: true,
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
  });
}

/** Streams the body to `destination`, bounded by the expected size. */
async function save(
  response: IncomingMessage,
  destination: string,
  options: DownloadOptions,
  deadline: number,
): Promise<DownloadResult> {
  const declared = response.headers["content-length"];
  if (declared !== undefined && Number(declared) !== options.expectedSize) {
    response.resume();
    throw new DownloadError(`the file has another size than the pinned one (${declared} bytes)`);
  }
  const encoding = response.headers["content-encoding"];
  if (encoding !== undefined && encoding !== "identity") {
    response.resume();
    throw new DownloadError(`unexpected content encoding (${encoding})`);
  }
  const hash = createHash("sha256");
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  let received = 0;
  let lastReport = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      // Destroying the response emits its own events: the first reason wins.
      if (settled) return;
      settled = true;
      reject(error);
      response.destroy();
      output.destroy();
    };
    const totalTimer = setTimeout(
      () => fail(new DownloadError("the download took too long")),
      Math.max(0, deadline - Date.now()),
    );
    output.once("error", (error) => fail(error));
    response.once("error", (error) => fail(error));
    response.once("aborted", () => fail(new DownloadError("the connection was cut")));
    response.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > options.expectedSize) {
        fail(new DownloadError("the file is larger than the pinned size"));
        return;
      }
      hash.update(chunk);
      if (!output.write(chunk)) {
        response.pause();
        output.once("drain", () => response.resume());
      }
      if (options.onProgress && received - lastReport >= 1 << 20) {
        lastReport = received;
        options.onProgress(received, options.expectedSize);
      }
    });
    response.once("end", () => {
      clearTimeout(totalTimer);
      if (received !== options.expectedSize) {
        fail(new DownloadError("the download ended early"));
        return;
      }
      settled = true;
      output.end(() => resolve());
    });
    output.once("close", () => clearTimeout(totalTimer));
  });
  return { sha256: hash.digest("hex"), size: received };
}
