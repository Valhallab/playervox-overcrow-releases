import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import { auditWidget, resolveExample } from "../dist/audit/index.js";
import { calls, evaluate, functions, numericConstants, tokenize } from "../dist/audit/lexer.js";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "overcrow-mcp-audit-"));
after(() => rmSync(work, { recursive: true, force: true }));

function widget(name, files) {
  const directory = join(work, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
}

const manifest = (permissions, extra = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    apiVersion: 1,
    id: "com.example-studio.test",
    version: "1.0.0",
    name: { en: "Test", fr: "Test" },
    sizing: { fit: "none", preferred: { width: 200, height: 100 } },
    permissions,
    ...extra,
  });

/** A PNG header with the given size and padding to the given bytes. */
function png(width, height, bytes) {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(0x89504e47, 0);
  header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([
    header,
    deflateSync(Buffer.alloc(16)),
    Buffer.alloc(Math.max(0, bytes - 40), 1),
  ]);
}

const rules = (result) =>
  result.findings.map((finding) => `${finding.severity}:${finding.rule}`).sort();

test("a heavy widget: every lightness rule fires, with an example", async () => {
  const directory = widget("heavy", {
    "manifest.json": manifest(
      {
        network: [
          {
            origin: "https://api.example.org",
            method: "GET",
            path: "/v1/everything",
            maxResponseBytes: 2097152,
          },
        ],
      },
      { vm: { heapMiB: 48 } },
    ),
    "logic.ts": `import { draw, http, initState, timers } from "@overcrow/sdk";
const TICK = 20 * 2;
export const state = initState({ rows: [] as string[], value: 0 });
const history: number[] = [];
async function load(): Promise<void> {
  const response = await http.fetch("https://api.example.org/v1/everything", { as: "json" });
  state.value = Number(response.status);
}
timers.every(TICK, () => {
  state.rows.push(String(Date.now()));
  history.push(state.value);
  draw("chart", [["clear"]]);
});
timers.every(5000, load);
`,
    "view.ocml": '<box><text class="spin">{state.value}</text><canvas ref="chart"/></box>\n',
    "style.ocss":
      ".spin { animation: spin 1s linear infinite; }\n@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n",
    "package.json": JSON.stringify({
      devDependencies: { "@overcrow/sdk": "1.0.0", lodash: "4.17.21" },
    }),
    "listing.json": JSON.stringify({ preview: "assets/preview.png" }),
    "assets/preview.png": png(4000, 3000, 300 * 1024),
    "assets/background.png": png(800, 600, 200 * 1024),
    LICENSE: "MIT",
  });
  const result = await auditWidget(directory);
  const found = rules(result);
  for (const expected of [
    "medium:fast-timer",
    "medium:fast-polling",
    "medium:large-response-one-turn",
    "medium:unbounded-list",
    "low:redraw-on-timer",
    "high:heavy-image",
    "medium:heavy-image",
    "high:image-too-large",
    "medium:extra-dependencies",
    "low:larger-heap",
    "low:endless-animation",
  ]) {
    assert.ok(found.includes(expected), `${expected} in ${found.join(", ")}`);
  }
  assert.ok(result.scores.lightness < 40, String(result.scores.lightness));
  const timer = result.findings.find((finding) => finding.rule === "fast-timer");
  assert.equal(timer.line, 9);
  assert.match(timer.message, /every 40 ms/);
  assert.equal(timer.example.widget, "stopwatch");
  const parse = result.findings.find((finding) => finding.rule === "large-response-one-turn");
  assert.equal(parse.example.widget, "warframe-market");
  assert.match(parse.example.excerpt, /class CatalogScanner/);
  const lists = result.findings
    .filter((finding) => finding.rule === "unbounded-list")
    .map((finding) => finding.message);
  assert.equal(lists.length, 2, lists.join(" | "));
});

test("an over-permissive widget: every security rule fires", async () => {
  // Built at run time: the repository's secret scanner must not see these.
  const fakeKey = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
  const fakeToken = ["gh", "p_", "a".repeat(36)].join("");
  const directory = widget("permissive", {
    "manifest.json": manifest(
      {
        network: [
          { origin: "https://api.example.org", method: "GET", path: "/v1/used" },
          {
            origin: "https://api.example.org",
            method: "POST",
            path: "/v1/report",
            maxResponseBytes: 1024,
          },
          {
            origin: "https://tracker.example.net",
            method: "GET",
            path: "/never",
            maxResponseBytes: 1024,
          },
          {
            origin: "https://third.example.com",
            method: "GET",
            path: "/search",
            maxResponseBytes: 1024,
            queryParams: { q: { type: "string", maxLength: 256 } },
          },
        ],
        storage: true,
        clipboardWrite: true,
        capabilities: ["telemetry.read"],
      },
      { id: "com.playervox.copycat" },
    ),
    "logic.ts": `import { clipboard, http, timers } from "@overcrow/sdk";
const API_KEY = "${fakeKey}";
export function refresh(): void {
  http.fetch("https://api.example.org/v1/used?key=" + API_KEY, { as: "text" });
  http.fetch("https://api.example.org/v1/report", { method: "POST", as: "json", body: {} });
  http.fetch("https://third.example.com/search?q=x", { as: "text" });
}
timers.every(60000, () => {
  clipboard.writeText({ text: "copied without asking" });
});
clipboard.writeText({ text: "at start" });
`,
    "view.ocml": "<box><button on:activate={refresh}><text>Go</text></button></box>\n",
    ".env": `GITHUB_TOKEN=${fakeToken}\n`,
    "README.md": `token: ${fakeToken}\n`,
    "manifest.extra.json": "{}",
  });
  const result = await auditWidget(directory);
  const found = rules(result);
  for (const expected of [
    "high:reserved-id",
    "high:unused-capability",
    "high:unused-permission",
    "high:clipboard-without-action",
    "medium:clipboard-without-action",
    "high:secret-file",
    "high:secret",
    "medium:unused-route",
    "medium:unbounded-response",
    "low:sends-data",
    "low:broad-parameter",
    "low:many-origins",
    "medium:license-missing",
  ]) {
    assert.ok(found.includes(expected), `${expected} in ${found.join(", ")}`);
  }
  assert.equal(result.scores.security, 0);
  assert.ok(
    result.findings.some((f) => f.rule === "unused-permission" && /storage/.test(f.message)),
  );
  assert.ok(
    !result.findings.some(
      (f) => f.rule === "unused-permission" && /clipboardWrite/.test(f.message),
    ),
  );
  assert.ok(result.authority.some((line) => /tracker\.example\.net/.test(line)));
  assert.ok(
    result.findings.filter((f) => f.rule === "secret").length >= 2,
    "logic.ts and README.md",
  );
});

test("the reference widgets: no high or medium finding (except the reserved PlayerVox ID)", async () => {
  for (const name of readdirSync(join(repository, "widgets"))) {
    const result = await auditWidget(join(repository, "widgets", name));
    const serious = result.findings.filter((f) => f.severity !== "low" && f.rule !== "reserved-id");
    assert.deepEqual(
      serious.map((f) => `${f.rule}: ${f.message}`),
      [],
      name,
    );
    assert.equal(
      result.scores.lightness >= 90,
      true,
      `${name}: lightness ${result.scores.lightness}`,
    );
  }
});

test("every example the audit cites exists in the shipped reference widgets", () => {
  const cited = [
    { widget: "warframe-market", file: "manifest.json", find: '"path": "/v2/versions"' },
    { widget: "warframe-market", file: "logic.ts", find: "export function copy(" },
    { widget: "warframe-market", file: "logic.ts", find: "export function refreshInterval(" },
    { widget: "warframe-market", file: "logic.ts", find: "export class CatalogScanner" },
    { widget: "weather", file: "manifest.json", find: '"units"' },
    { widget: "stopwatch", file: "view.ocml", find: "<elapsed" },
    { widget: "twitch-chat", file: "logic.ts", find: "export const HISTORY_MAX" },
    { widget: "playervox-rating", file: "logic.ts", find: 'draw("badge"' },
    { widget: "clock", file: "listing.json", find: '"preview"' },
    { widget: "notes", file: "view.ocml", find: "selector-icon spin" },
  ];
  for (const example of cited)
    assert.ok(resolveExample(example), `${example.widget}/${example.file}: ${example.find}`);
  // The same list as the rules: no rule cites an example missing here.
  const rulesSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "audit", "rules.ts"),
    "utf8",
  );
  const inRules = [
    ...rulesSource.matchAll(
      /example: \{ widget: "([^"]+)", file: "([^"]+)", find: ('[^']+'|"[^"]+") \}/g,
    ),
  ].map((match) => `${match[1]}|${match[2]}`);
  for (const key of inRules)
    assert.ok(
      cited.some((example) => `${example.widget}|${example.file}` === key),
      key,
    );
});

test("the lexer separates code from comments and strings", () => {
  const tokens = tokenize(`// timers.every(10, f)
/* clipboard.writeText({}) */
const A = 30_000;
const B = A * 2 + 5;
const url = \`https://x.test/\${id}/items\`;
const re = /timers\\.every\\(/g;
const half = total / 2;
timers.every(B, tick);
`);
  assert.equal(calls(tokens, ["timers", "every"]).length, 1);
  assert.equal(calls(tokens, ["clipboard", "writeText"]).length, 0);
  const constants = numericConstants(tokens);
  assert.equal(constants.get("B"), 60_005);
  assert.equal(evaluate(tokenize("A * 2"), constants), 60_000);
  assert.ok(tokens.some((token) => token.kind === "template" && token.value === "https://x.test/"));
  assert.ok(tokens.some((token) => token.kind === "regex"));
  const ranges = functions(tokenize("export function a() { b(); }\nconst c = () => { d(); };"));
  assert.deepEqual(
    ranges.map((range) => [range.name, range.exported]),
    [
      ["a", true],
      ["c", false],
    ],
  );
});

test("IDs: <handle>.<name> and verified reverse domains pass; placeholders and com.playervox do not", async () => {
  const idRules = async (id) =>
    rules(
      await auditWidget(
        widget(`id-${id}`, { "manifest.json": manifest({}, { id }), LICENSE: "MIT\n" }),
      ),
    ).filter((rule) => /-id$/.test(rule));
  for (const id of ["valhallab.lol-timers", "gg.valhallab.lol-timers", "example-studio.clock"])
    assert.deepEqual(await idRules(id), [], id);
  for (const id of ["yourhandle.clock", "example.clock", "com.example.clock", "com.yourname.clock"])
    assert.deepEqual(await idRules(id), ["medium:example-id"], id);
  assert.deepEqual(await idRules("com.playervox.clock"), ["high:reserved-id"]);
  const reserved = await auditWidget(
    widget("id-fix", { "manifest.json": manifest({}, { id: "com.playervox.x" }) }),
  );
  assert.match(
    reserved.findings.find((f) => f.rule === "reserved-id").fix,
    /<handle>\.<name>.*creator space.*reverse domain you can verify/,
  );
});
