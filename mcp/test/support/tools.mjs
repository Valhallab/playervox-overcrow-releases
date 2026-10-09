// Assembles a creator tools ZIP in the layout of OverCrow's release
// publisher (scripts/release.py of the application), with its pin, from
// given executables: fake ones in the unit tests, the real CLI and runtime
// in the end-to-end proof.

import { createHash } from "node:crypto";
import { makeZip } from "./zip.mjs";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const NPM = {
  "@overcrow/sdk": {
    version: "1.0.0",
    integrity:
      "sha512-akyuynS1TN5QbKyLsgoLOFF6JylVzNpUluEoSfz52xSlFg161kQ9QPLhcfGCptZ1x5/pm9/zPe/6LsHqFofnEA==",
  },
  typescript: {
    version: "6.0.3",
    integrity:
      "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
  },
};

/**
 * Builds the two ZIPs of a release and the pin of @overcrow/mcp.
 * executables: { "linux-x86_64": { cli, runtime }, "windows-x86_64": { cli, runtime } } (Buffers)
 * tamper(platform, files) may change the files (a Map name → Buffer) before zipping.
 */
export function assembleRelease({
  release = "0.6.1-beta.1",
  cliVersion = "1.0.0-beta.2",
  executables,
  tamper = () => {},
  cliPinsRuntime = true,
}) {
  const platforms = ["linux-x86_64", "windows-x86_64"];
  const suffix = (platform) => (platform.startsWith("windows") ? ".exe" : "");
  const runtimeLicense = Buffer.from("OverCrow headless runtime terms (test)\n");
  const runtimeName = (platform) =>
    `overcrow-widget-headless-${release}-${platform}${suffix(platform)}`;
  const cliName = (platform) => `overcrow-widget-${cliVersion}-${platform}${suffix(platform)}`;
  const runtimes = {
    schemaVersion: 1,
    version: release,
    sourceCommit: "0".repeat(40),
    runtimes: {
      "headless-linux-x86_64": file(
        runtimeName("linux-x86_64"),
        executables["linux-x86_64"].runtime,
      ),
      "headless-windows-x86_64": file(
        runtimeName("windows-x86_64"),
        executables["windows-x86_64"].runtime,
      ),
      "headless-license": file(`overcrow-widget-headless-${release}-LICENSE.md`, runtimeLicense),
    },
  };
  const cliLicense = Buffer.from("MIT License (test)\n");
  const cliNotices = Buffer.from("# Third-party notices (test)\n");
  const cli = {
    schemaVersion: 1,
    version: cliVersion,
    sourceCommit: "1".repeat(40),
    runtime: {
      version: release,
      sha256: Object.fromEntries(
        platforms.map((platform) => [
          platform,
          cliPinsRuntime ? sha256(executables[platform].runtime) : "f".repeat(64),
        ]),
      ),
    },
    files: [
      file(cliName("linux-x86_64"), executables["linux-x86_64"].cli),
      file(cliName("windows-x86_64"), executables["windows-x86_64"].cli),
      file(`overcrow-widget-${cliVersion}-LICENSE.txt`, cliLicense),
      file(`overcrow-widget-${cliVersion}-THIRD-PARTY-NOTICES.md`, cliNotices),
    ],
  };
  const zips = {};
  const pin = { release, tools: {}, npm: NPM };
  for (const platform of platforms) {
    const root = `overcrow-creator-tools-${release}-${platform}`;
    const files = new Map([
      [runtimeName(platform), executables[platform].runtime],
      [`overcrow-widget-headless-${release}-LICENSE.md`, runtimeLicense],
      ["runtimes.json", Buffer.from(`${JSON.stringify(runtimes)}\n`)],
      [cliName(platform), executables[platform].cli],
      [`overcrow-widget-${cliVersion}-LICENSE.txt`, cliLicense],
      [`overcrow-widget-${cliVersion}-THIRD-PARTY-NOTICES.md`, cliNotices],
      ["cli.json", Buffer.from(`${JSON.stringify(cli)}\n`)],
      ["README.txt", Buffer.from(`OverCrow creator tools ${release} (test)\n`)],
    ]);
    const sums = [...files.keys()]
      .sort()
      .map((name) => `${sha256(files.get(name))}  ${name}\n`)
      .join("");
    files.set("SHA256SUMS", Buffer.from(sums));
    tamper(platform, files);
    const names = [...files.keys()].sort();
    const executable = new Set([runtimeName(platform), cliName(platform)]);
    const zip = makeZip(
      names.map((name) => ({
        name: `${root}/${name}`,
        data: files.get(name),
        mode: executable.has(name) ? 0o100755 : 0o100644,
      })),
    );
    zips[platform] = zip;
    pin.tools[platform] = {
      name: `${root}.zip`,
      size: zip.length,
      sha256: sha256(zip),
      files: names.map((name) => ({
        path: `${root}/${name}`,
        size: files.get(name).length,
        sha256: sha256(files.get(name)),
      })),
    };
  }
  return { zips, pin, cliVersion, release };
}

function file(name, data) {
  return { name, size: data.length, sha256: sha256(data) };
}

/** A fake CLI and runtime: shell scripts on Linux (the probe is injected on Windows). */
export function fakeExecutables(release = "0.6.1-beta.1") {
  const runtime = Buffer.from(`#!/bin/sh\necho "fake runtime ${release}"\n`);
  const runtimeSha = sha256(runtime);
  const cliScript = (platform) =>
    Buffer.from(
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '{"apiVersion":1,"runtime":{"sha256":{"linux-x86_64":"${runtimeSha}","windows-x86_64":"${runtimeSha}"},"version":"${release}"},"sdk":"1.0.0","version":"1.0.0-beta.2"}'; exit 0; fi\necho "fake cli ${platform}: $*" >&2\nexit 2\n`,
    );
  return {
    "linux-x86_64": { cli: cliScript("linux"), runtime },
    "windows-x86_64": { cli: cliScript("windows"), runtime },
  };
}

/** The probe matching fakeExecutables (for platforms where scripts cannot run). */
export function fakeProbe(release, runtimeSha) {
  return async () => ({
    apiVersion: 1,
    runtime: {
      sha256: { "linux-x86_64": runtimeSha, "windows-x86_64": runtimeSha },
      version: release,
    },
    sdk: "1.0.0",
    version: "1.0.0-beta.2",
  });
}
