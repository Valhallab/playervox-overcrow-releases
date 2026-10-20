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
  for (const id of ["nova.lol-timers", "gg.nova.lol-timers", "example-studio.clock"])
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

test("a field that asks for a key, a token or a password is reported, not its look-alikes", async () => {
  const fields = (labels) =>
    labels
      .map((label, index) => `  <field label="${label}" value={state.f${index}} on:input={typed}/>`)
      .join("\n");
  const asking = [
    "Steam Web API key",
    "Paste your token",
    "Personal access token",
    "Password",
    "Mot de passe",
    "Votre clé d'API",
    "Collez votre jeton",
    "Client secret",
  ];
  const harmless = [
    "Token count",
    "Steam ID",
    "Secret Santa",
    "Key binding",
    "Player name",
    "Jeton de partie gagnés",
  ];
  const directory = widget("asks-for-secret", {
    "manifest.json": manifest({}),
    "view.ocml": `<column>\n${fields(asking)}\n${fields(harmless)}\n  <field placeholder={t("key-hint")} value={state.k} on:input={typed}/>\n</column>\n`,
    "locales/en.json": JSON.stringify({ "key-hint": "Your API key" }),
    "locales/fr.json": JSON.stringify({ "key-hint": "Votre clé API" }),
    "logic.ts": `export function typed(): void {}\n`,
  });
  const result = await auditWidget(directory);
  const found = result.findings.filter((finding) => finding.rule === "asks-for-secret");
  assert.deepEqual(
    found.map((finding) => finding.line),
    [2, 3, 4, 5, 6, 7, 8, 9, 16],
    "each asking field, by line, the localized one included",
  );
  assert.ok(found.every((finding) => finding.severity === "high" && finding.file === "view.ocml"));
  assert.match(found[0].fix, /publication rule 3\.5/);
});

test("routes that return or trade secrets are reported", async () => {
  const route = (origin, path) => ({ origin, method: "GET", path });
  const directory = widget("secret-routes", {
    "manifest.json": manifest({
      network: [
        route("https://api.example.org", "/oauth/token"),
        route("https://api.example.org", "/v1/API-Key/list"),
        route("https://api.example.org", "/v1/credentials"),
        route("https://api.twitch.tv", "/helix/streams/key"),
        route("https://api.twitch.tv", "/helix/extensions/jwt/secrets"),
        route("https://streamlabs.com", "/api/v2.0/socket/token"),
        route("https://api.example.org", "/v1/tokenizer"),
        route("https://www.googleapis.com", "/youtube/v3/liveStreams"),
        route("https://api.example.org", "/v1/weather"),
        route("https://api.steampowered.com", "/IEconService/GetTradeOffers/v1/"),
        route("https://api.steampowered.com", "/ieconservice/CancelTradeOffer/v1/"),
        route("https://api.steampowered.com", "/ISteamUser/GetPlayerSummaries/v2/"),
      ],
    }),
    "logic.ts": `export const urls = ["https://api.example.org/v1/weather"];\n`,
  });
  const result = await auditWidget(directory);
  const messages = (rule) =>
    result.findings.filter((finding) => finding.rule === rule).map((finding) => finding.message);
  const tokens = messages("token-route");
  assert.equal(tokens.length, 7, tokens.join("\n"));
  for (const path of [
    "/oauth/token",
    "/v1/API-Key/list",
    "/v1/credentials",
    "/helix/streams/key",
    "/helix/extensions/jwt/secrets",
    "/socket/token",
    "/youtube/v3/liveStreams",
  ])
    assert.ok(
      tokens.some((message) => message.includes(path)),
      path,
    );
  assert.ok(!tokens.some((message) => message.includes("/v1/weather")));
  const trades = result.findings.filter((finding) => finding.rule === "trade-route");
  assert.equal(trades.length, 2);
  assert.ok(trades.every((finding) => finding.severity === "high"));
  assert.match(trades[0].fix, /never touches Steam item trades/);
});

test("folded spellings, parameter names and enum values reveal a secret route", async () => {
  const route = (path, extra = {}) => ({
    origin: "https://api.runlog.example",
    method: "GET",
    path,
    ...extra,
  });
  const secret = [
    route("/v1/streamkey"),
    route("/v1/stream_key"),
    route("/v1/accesstoken"),
    route("/v1/Access-Tokens/list"),
    route("/v1/getApiKey"),
    route("/v1/me/keys"),
    route("/v1/me/{section}", {
      pathParams: { section: { type: "enum", values: ["runs", "tokens"] } },
    }),
    route("/v1/{kind}/list", { pathParams: { kind: { type: "enum", values: ["apikeys"] } } }),
    route("/v1/me", { queryParams: { include_secret: { type: "enum", values: ["no"] } } }),
    // Only the value in its place makes the compound (`accesstoken`).
    route("/v1/access/{part}", { pathParams: { part: { type: "enum", values: ["tokenset"] } } }),
  ];
  const harmless = [
    route("/v1/runs"),
    route("/v1/tokenizer"),
    route("/v1/hotkeys"),
    route("/v1/secretary/key-bindings"),
    route("/v1/{kind}", { pathParams: { kind: { type: "slug", maxLength: 16 } } }),
  ];
  const directory = widget("folded-secret-routes", {
    "manifest.json": manifest({ network: [...secret, ...harmless] }),
  });
  const found = (await auditWidget(directory)).findings.filter(
    (finding) => finding.rule === "token-route",
  );
  assert.deepEqual(
    found.map((finding) => Number(/network\[(\d+)\]/.exec(finding.message)[1])),
    secret.map((_, index) => index),
  );
  assert.ok(found.every((finding) => finding.severity === "medium"));

  // On a route of the account, the secret goes with the request: high.
  const account = {
    id: "runlog",
    name: "Run Log",
    mode: "key",
    origins: ["https://api.runlog.example"],
    send: { header: "X-Api-Key" },
    key: {
      format: { charset: "alnum", minLength: 40, maxLength: 64 },
      page: "https://runlog.example/key",
    },
  };
  const withAccount = widget("account-secret-route", {
    "manifest.json": manifest({
      accounts: [account],
      network: [route("/v1/me/access_token", { account: "runlog" })],
    }),
  });
  const high = (await auditWidget(withAccount)).findings.filter(
    (finding) => finding.rule === "token-route",
  );
  assert.equal(high.length, 1);
  assert.equal(high[0].severity, "high");
  assert.match(high[0].message, /carries the account's secret/);
});

test("rules on one route and a name in both tables are reported", async () => {
  const wide = {
    origin: "https://api.runlog.example",
    method: "GET",
    path: "/v1/me/{section}",
    pathParams: { section: { type: "slug", maxLength: 32 } },
    queryParams: { section: { type: "enum", values: ["runs", "stats"] } },
  };
  const narrow = { ...wide, pathParams: { section: { type: "enum", values: ["runs"] } } };
  delete narrow.queryParams;
  const directory = widget("same-route", {
    "manifest.json": manifest({
      network: [narrow, { ...narrow, path: "/v1/runs", pathParams: undefined }, wide],
    }),
  });
  const found = (await auditWidget(directory)).findings.filter((finding) =>
    ["same-route", "path-and-query-name"].includes(finding.rule),
  );
  assert.deepEqual(
    found.map((finding) => `${finding.rule}:${/network\[(\d+)\]/.exec(finding.message)[1]}`).sort(),
    ["path-and-query-name:2", "same-route:2"],
  );
  const same = found.find((finding) => finding.rule === "same-route");
  assert.match(same.message, /permissions\.network\[0\]/);
});

test("a declared account that could fish a service's key is reported", async () => {
  const account = (change) => {
    const value = {
      id: "tracker",
      name: "Achievement Tracker",
      mode: "key",
      origins: ["https://api.tracker.example"],
      send: { header: "X-Key" },
      key: {
        format: { charset: "alnum", minLength: 40, maxLength: 64 },
        page: "https://get.tracker.example/key",
      },
    };
    change(value);
    return value;
  };
  const cases = [
    ["a plain account", account(() => {}), []],
    [
      "a Steam key format",
      account((value) => {
        value.key.format = { charset: "hex", minLength: 32, maxLength: 32 };
      }),
      ["medium:service-key-format"],
    ],
    [
      "a wider charset that holds a Steam key",
      account((value) => {
        value.key.format = { charset: "alnum", minLength: 32, maxLength: 32 };
      }),
      ["medium:service-key-format"],
    ],
    [
      "a generic printable key",
      account((value) => {
        value.key.format = { charset: "printable", minLength: 16, maxLength: 128 };
      }),
      ["medium:service-key-format"],
    ],
    [
      "a key too long for Steam",
      account((value) => {
        value.key.format = { charset: "hex", minLength: 40, maxLength: 40 };
      }),
      [],
    ],
    [
      "a redirect in the key page",
      account((value) => {
        value.key.page =
          "https://www.google.com/url?q=https%3A%2F%2Fsteamcommunity.com%2Fdev%2Fapikey";
      }),
      ["high:address-in-key-page"],
    ],
    [
      "a service host in the key page",
      account((value) => {
        value.key.page = "https://get.tracker.example/go?to=steamcommunity.com";
      }),
      ["high:address-in-key-page"],
    ],
    [
      "a plain static query",
      account((value) => {
        value.key.page = "https://get.tracker.example/key?tab=api-keys";
      }),
      [],
    ],
    [
      "a host that reads as Steam",
      account((value) => {
        value.key.page = "https://st3am-keys.example/key";
      }),
      ["medium:service-name-in-host"],
    ],
    [
      "a host that reads as Twitch",
      account((value) => {
        value.origins = ["https://api.tw1tch-tools.example"];
      }),
      ["medium:service-name-in-host"],
    ],
    [
      "a name that imitates a label",
      account((value) => {
        value.name = "Arena (service intégré)";
      }),
      ["high:service-label-name"],
    ],
    [
      "a check mark",
      account((value) => {
        value.name = "Arena ✓";
      }),
      ["high:service-label-name"],
    ],
    ["the service itself", { service: "steam" }, []],
  ];
  const hintRules = new Set([
    "service-key-format",
    "address-in-key-page",
    "service-name-in-host",
    "service-label-name",
  ]);
  for (const [label, entry, expected] of cases) {
    const directory = widget(`hints-${label.replaceAll(" ", "-")}`, {
      "manifest.json": manifest({ accounts: [entry] }),
    });
    const found = (await auditWidget(directory)).findings
      .filter((finding) => hintRules.has(finding.rule))
      .map((finding) => `${finding.severity}:${finding.rule}`);
    assert.deepEqual(found, expected, label);
  }
});

// Until an application release announces account-key, the fixes name no
// manifest field that the published apps would refuse (the release lot
// points them to permissions.accounts again).
test("a declared OAuth account: its sign-in pages, a read scope that writes, its ID", async () => {
  const quests = (change) => {
    const value = {
      id: "quests",
      name: "Quest Log",
      mode: "oauth",
      origins: ["https://api.quests.example"],
      oauth: {
        clientId: "nova-quest-log",
        flow: "loopback",
        authorize: "https://auth.quests.example/oauth/authorize",
        token: "https://api.quests.example/oauth/token",
        scopes: [{ name: "quests:read", access: "read" }],
      },
    };
    change(value);
    return value;
  };
  const pages = "low:oauth-pages";
  const cases = [
    ["a plain OAuth account", quests(() => {}), [pages]],
    [
      "a read scope that writes",
      quests((value) => {
        value.oauth.scopes = [{ name: "user:write:chat", access: "read" }];
      }),
      [pages, "medium:read-scope-writes"],
    ],
    [
      "a write scope declared write",
      quests((value) => {
        value.oauth.scopes = [{ name: "user:write:chat", access: "write" }];
      }),
      [pages],
    ],
    [
      "a page that reads as PlayerVox",
      quests((value) => {
        value.oauth.authorize = "https://playervox-link.quests.example/oauth/authorize";
      }),
      [pages, "medium:service-name-in-host"],
    ],
    [
      "a page on a name of Twitch's CDN",
      quests((value) => {
        value.oauth.authorize = "https://ttvnw-auth.example/oauth/authorize";
      }),
      [pages, "medium:service-name-in-host"],
    ],
    [
      "an internationalized page",
      quests((value) => {
        value.oauth.authorize = "https://xn--twtch-0sa.example/oauth/authorize";
      }),
      [pages, "medium:service-name-in-host"],
    ],
    [
      "an ID that reads as Twitch",
      quests((value) => {
        value.id = "twitch-api";
      }),
      [pages, "medium:service-name-in-id"],
    ],
    [
      "a key account",
      {
        id: "tracker",
        name: "Tracker",
        mode: "key",
        origins: ["https://api.tracker.example"],
        send: { header: "X-Key" },
        key: {
          format: { charset: "alnum", minLength: 40, maxLength: 64 },
          page: "https://get.tracker.example/key",
        },
      },
      [],
    ],
  ];
  const hintRules = new Set([
    "oauth-pages",
    "read-scope-writes",
    "service-name-in-host",
    "service-name-in-id",
  ]);
  for (const [label, entry, expected] of cases) {
    const directory = widget(`oauth-${label.replaceAll(" ", "-").replaceAll("'", "")}`, {
      "manifest.json": manifest({ accounts: [entry] }),
    });
    const findings = (await auditWidget(directory)).findings.filter((finding) =>
      hintRules.has(finding.rule),
    );
    // The audit sorts its findings by severity.
    assert.deepEqual(
      findings.map((finding) => `${finding.severity}:${finding.rule}`).sort(),
      [...expected].sort(),
      label,
    );
    const page = findings.find((finding) => finding.rule === "oauth-pages");
    if (label === "a plain OAuth account") {
      assert.match(
        page.message,
        /signs the player in at auth\.quests\.example and gets its tokens from api\.quests\.example/,
      );
      assert.match(page.fix, /test account/);
    }
    if (label === "an internationalized page") {
      const host = findings.find((finding) => finding.rule === "service-name-in-host");
      assert.match(host.message, /twítch\.example \(xn--twtch-0sa\.example\) reads as Twitch/);
    }
  }
  const device = widget("oauth-device", {
    "manifest.json": manifest({
      accounts: [
        quests((value) => {
          value.oauth.flow = "device";
          delete value.oauth.authorize;
          value.oauth.device = "https://api.quests.example/oauth/device";
          value.oauth.verify = "https://quests.example/device";
        }),
      ],
    }),
  });
  const page = (await auditWidget(device)).findings.find(
    (finding) => finding.rule === "oauth-pages",
  );
  assert.match(
    page.message,
    /enter a code at quests\.example and gets its tokens from api\.quests\.example/,
  );
});

test("the secret fix names no unreleased manifest field", async () => {
  const key = ["api", "_key"].join("");
  const directory = widget("secret-fix", {
    "manifest.json": manifest({}),
    "logic.ts": `const ${key} = "${"a".repeat(24)}";\nexport const used = ${key};\n`,
  });
  const result = await auditWidget(directory);
  const finding = result.findings.find((f) => f.rule === "secret");
  assert.ok(finding);
  assert.doesNotMatch(finding.fix, /permissions\.accounts/);
});

test("a widget's own account on Steam or Twitch is reported, a named service is not", async () => {
  const declared = (fields) => ({
    mode: "key",
    send: { header: "X-Api-Key" },
    key: {
      format: { charset: "alnum", minLength: 16, maxLength: 64 },
      page: "https://runlog.example/key",
    },
    ...fields,
  });
  const cases = [
    [
      "by origin",
      declared({ id: "stats", name: "Stats", origins: ["https://api.steampowered.com"] }),
      1,
    ],
    ["by ID", declared({ id: "twitch", name: "Live", origins: ["https://api.live.example"] }), 1],
    [
      "by name",
      declared({ id: "stats", name: "Steam", origins: ["https://api.stats.example"] }),
      1,
    ],
    [
      "another service",
      declared({ id: "runlog", name: "Run Log", origins: ["https://api.runlog.example"] }),
      0,
    ],
    ["the service itself", { service: "steam" }, 0],
    [
      "the Steam key page",
      declared({
        id: "stats",
        name: "Stats",
        origins: ["https://api.stats.example"],
        key: {
          format: { charset: "hex", minLength: 32, maxLength: 32 },
          page: "https://steamcommunity.com/dev/apikey",
        },
      }),
      1,
    ],
    [
      "a Steam domain",
      declared({ id: "stats", name: "Stats", origins: ["https://store.steampowered.com"] }),
      1,
    ],
    [
      "named with an accent",
      declared({ id: "stats", name: "Šteam", origins: ["https://api.stats.example"] }),
      1,
    ],
    [
      "named with rn",
      declared({ id: "stats", name: "Stearn", origins: ["https://api.stats.example"] }),
      1,
    ],
  ];
  for (const [label, account, expected] of cases) {
    const directory = widget(`integrated-${label.replaceAll(" ", "-")}`, {
      "manifest.json": manifest({ accounts: [account] }),
    });
    const found = (await auditWidget(directory)).findings.filter(
      (finding) => finding.rule === "integrated-service",
    );
    assert.equal(found.length, expected, label);
    for (const finding of found) {
      assert.equal(finding.severity, "high");
      // The fix names no manifest field the published applications refuse.
      assert.doesNotMatch(finding.fix, /permissions\.accounts|"service"/);
    }
  }
});
