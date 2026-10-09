// What one server process keeps between requests: the options it started
// with, the project folders it may use, and the creator tools once checked.
// `serveStdio` may build a server instance per protocol era; they all share
// this state.

import { lstat, readFile, rm } from "node:fs/promises";
import {
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { DownloadError, downloadPinned } from "./bootstrap/download.js";
import {
  downloadPath,
  InstallError,
  type InstalledTools,
  install,
  loadInstalled,
  prepareCacheRoot,
  type VersionProbe,
} from "./bootstrap/install.js";
import { DOWNLOAD_HOSTS, type Pin, toolsUrl } from "./bootstrap/pin.js";
import { ZipError } from "./bootstrap/zip.js";
import { probeVersion } from "./cli.js";
import { checkRoot, Confinement, ConfinementError, labelRoots, rootUriToPath } from "./confine.js";
import {
  cacheRoot,
  homeDirectory,
  httpsProxy,
  namedLocations,
  type Platform,
  toolsPlatform,
} from "./env.js";
import { Redactor } from "./text.js";

export interface SessionOptions {
  /** Folders given with --root; when set, the client's roots are not asked for. */
  launchRoots: string[];
  /** A local creator tools ZIP given with --tools-zip. */
  toolsZip: string | undefined;
  pin: Pin;
  cwd: string;
  /** Tests only: where the releases are downloaded from, and the TLS roots to trust. */
  releaseBase?: string;
  releasePort?: number;
  ca?: string | Buffer;
  cacheRootOverride?: string;
  /** Tests only: answers `--version --format json` instead of the CLI. */
  probe?: VersionProbe;
}

export type RootsAnswer =
  | { confinement: Confinement }
  | { input: ReturnType<typeof inputRequired> }
  | { error: string };

export class Session {
  private clientRoots: string[] | undefined;
  private launchRoots: string[] | undefined;
  private tools: InstalledTools | undefined;
  private sdkVersion: string | undefined;
  private installing: Promise<InstalledTools> | undefined;
  /** The last test run of each widget folder, with the fingerprint of its sources then. */
  readonly lastTests = new Map<
    string,
    { fingerprint: string; passed: number; failed: number; complete: boolean; at: Date }
  >();

  constructor(readonly options: SessionOptions) {}

  get platform(): { platform: Platform } | { unsupported: string } {
    return toolsPlatform();
  }

  get cacheRoot(): string | undefined {
    return this.options.cacheRootOverride ?? cacheRoot();
  }

  /** Forgets the client's roots (they changed). */
  rootsChanged(): void {
    this.clientRoots = undefined;
  }

  /**
   * The folders the server may use for this request: the --root folders,
   * else the client's roots (asked for once with an input request), else
   * the working directory. Every folder is checked (no system folder, no
   * disk root, not the whole home folder).
   */
  async roots(ctx: ServerContext, server: McpServer): Promise<RootsAnswer> {
    try {
      if (this.options.launchRoots.length > 0) {
        this.launchRoots ??= await Promise.all(this.options.launchRoots.map(checkRoot));
        return { confinement: new Confinement(labelRoots(this.launchRoots)) };
      }
      if (this.clientRoots === undefined) {
        const answered = inputResponse(ctx.mcpReq.inputResponses, "roots");
        if (answered.kind === "roots") {
          this.clientRoots = answered.roots
            .map((root) => rootUriToPath(root.uri))
            .filter((path): path is string => path !== undefined)
            .slice(0, 16);
        } else if (clientSupportsRoots(ctx, server)) {
          return { input: inputRequired({ inputRequests: { roots: inputRequired.listRoots() } }) };
        } else {
          this.clientRoots = [];
        }
      }
      const candidates = this.clientRoots.length > 0 ? this.clientRoots : [this.options.cwd];
      const checked: string[] = [];
      const refusals: string[] = [];
      for (const candidate of candidates) {
        try {
          checked.push(await checkRoot(candidate));
        } catch (error) {
          refusals.push((error as Error).message);
        }
      }
      if (checked.length === 0) return { error: refusals[0] ?? "No project folder is open." };
      return { confinement: new Confinement(labelRoots([...new Set(checked)])) };
    } catch (error) {
      if (error instanceof ConfinementError) return { error: error.message };
      throw error;
    }
  }

  /** Replaces the user's paths in text results. */
  redactor(confinement?: Confinement): Redactor {
    return new Redactor(
      [
        ...(confinement?.roots ?? []).map((root) => ({
          path: root.path,
          label: root.label === "." ? "<project>" : `<${root.label}>`,
        })),
        ...namedLocations(),
      ],
      homeDirectory(),
    );
  }

  /** The installed tools, checked against the pin (once per process). */
  async installedTools(): Promise<InstalledTools | undefined> {
    if (this.tools) return this.tools;
    const platform = this.platform;
    const root = this.cacheRoot;
    const release = this.options.pin.release;
    if (!("platform" in platform) || !root || !release) return undefined;
    const pinned = this.options.pin.tools[platform.platform];
    if (!pinned) return undefined;
    const found = await loadInstalled(pinned, release, platform.platform, root);
    if (found) await this.adopt(found);
    return this.tools;
  }

  /** The SDK version the installed CLI embeds (from `--version --format json`). */
  get cliSdkVersion(): string | undefined {
    return this.sdkVersion;
  }

  private async adopt(tools: InstalledTools): Promise<void> {
    const probe = this.options.probe ?? probeVersion;
    const report = (await probe(tools.cli, tools.directory)) as { sdk?: unknown } | undefined;
    this.sdkVersion = typeof report?.sdk === "string" ? report.sdk : undefined;
    this.tools = tools;
  }

  /**
   * Installs the pinned creator tools: from `zipPath` (a local file the
   * caller has confined) or --tools-zip, else by downloading the pinned ZIP.
   */
  async setup(
    zipPath: string | undefined,
    onProgress?: (received: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<{ tools: InstalledTools; source: "cache" | "local" | "download" }> {
    const existing = await this.installedTools();
    if (existing) return { tools: existing, source: "cache" };
    const platform = this.platform;
    if (!("platform" in platform)) throw new SetupError(platform.unsupported);
    const release = this.options.pin.release;
    const pinned = this.options.pin.tools[platform.platform];
    if (!release || !pinned) {
      throw new SetupError(
        "This version of @overcrow/mcp is not tied to a published OverCrow release yet: update it (npx -y @overcrow/mcp@latest).",
      );
    }
    const root = this.cacheRoot;
    if (!root) throw new SetupError("No cache folder: set HOME (or LOCALAPPDATA on Windows).");
    const local = zipPath ?? this.options.toolsZip;
    this.installing ??= (async () => {
      await prepareCacheRoot(root);
      let archive: Buffer;
      if (local) {
        const info = await lstat(local).catch(() => undefined);
        if (!info?.isFile()) throw new SetupError("The creator tools ZIP was not found.");
        if (info.size !== pinned.size)
          throw new SetupError(
            `This ZIP is not ${pinned.name} of OverCrow ${release} (another size).`,
          );
        archive = await readFile(local);
      } else {
        const temporary = downloadPath(root);
        try {
          const proxy = httpsProxy("github.com");
          await downloadPinned(
            toolsUrl(release, pinned.name, this.options.releaseBase),
            temporary,
            {
              allowedHosts: this.options.releaseBase
                ? [new URL(this.options.releaseBase).hostname, ...DOWNLOAD_HOSTS]
                : DOWNLOAD_HOSTS,
              expectedSize: pinned.size,
              proxy,
              ca: this.options.ca,
              port: this.options.releasePort,
              ...(onProgress ? { onProgress } : {}),
              signal,
            },
          );
          archive = await readFile(temporary);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      return install(
        archive,
        pinned,
        release,
        platform.platform,
        root,
        this.options.probe ?? probeVersion,
      );
    })();
    try {
      const tools = await this.installing;
      await this.adopt(tools);
      return { tools, source: local ? "local" : "download" };
    } catch (error) {
      if (error instanceof DownloadError)
        throw new SetupError(
          `Cannot download the creator tools: ${error.reason}. Nothing was kept. Check the connection (or HTTPS_PROXY), or pass a local copy of ${pinned.name}.`,
        );
      if (error instanceof ZipError || error instanceof InstallError)
        throw new SetupError(`The creator tools were refused: ${error.message}. Nothing was kept.`);
      throw error;
    } finally {
      this.installing = undefined;
    }
  }
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

function clientSupportsRoots(ctx: ServerContext, server: McpServer): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const modern = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { roots?: unknown } | undefined;
  if (modern) return modern.roots !== undefined;
  return server.server.getClientCapabilities()?.roots !== undefined;
}
