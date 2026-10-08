// Unit tests of the Warframe Market logic on @overcrow/sdk/testing. The
// data is synthetic (tests/fixtures.json): no request reaches warframe.market.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const MESSAGES = read("../locales/en.json");
const { items: ITEMS, orders: ORDERS } = read("./fixtures.json");
const ORDERS_TEXT = JSON.stringify(ORDERS);
const answer = (body) => ({ status: 200, contentType: "application/json", body });
const API = "https://api.warframe.market";
const VERSIONS = { data: { collections: { items: "v1" } } };

const vm = installRuntime({
  host: { messages: MESSAGES, mode: "interactive", grants: ["network", "storage", "clipboardWrite"] },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const flush = () => new Promise((resolve) => setImmediate(resolve));
const open = (service) => vm.calls.filter((call) => call.service === service && !call.settled);
const fetchUrl = (call) => call.params.url;

/** Answers every storage call as the host would, in order, until none is left. */
async function settleStorage() {
  for (let round = 0; round < 20; round += 1) {
    await flush();
    const calls = vm.calls.filter((call) => call.service.startsWith("storage.") && !call.settled);
    if (calls.length === 0) {
      return;
    }
    for (const call of calls) {
      call.resolve(null);
    }
  }
}

function syntheticCatalog(count) {
  return {
    data: Array.from({ length: count }, (_, index) => {
      const name = `Synthetic Mod ${index}`;
      return {
        id: index.toString(16).padStart(24, "0"),
        slug: logic.derivedSlug(name),
        gameRef: `/Lotus/Synthetic/${index}`,
        tags: ["synthetic"],
        i18n: { en: { name, icon: "items/images/en/x.png", thumb: "items/images/en/thumbs/x.png" } },
      };
    }),
  };
}

test("start: the saved search, then the version, then the catalog 400 ms later", async () => {
  const saved = open("storage.get")[0];
  assert.deepEqual(saved.params, { key: "state" });
  saved.resolve({ query: "arcane" });
  await flush();
  const index = open("storage.get")[0];
  assert.deepEqual(index.params, { key: "catalog" });
  index.resolve(null);
  await flush();
  assert.equal(state.phase, "loading");
  const version = open("http.fetch")[0];
  assert.equal(fetchUrl(version), `${API}/v2/versions`);
  version.resolve({ status: 200, contentType: "application/json", body: VERSIONS });
  await flush();
  assert.equal(open("http.fetch").length, 0, "the provider allows three requests per second");
  vm.advance(logic.REQUEST_SPACING_MS);
  await flush();
  const catalog = open("http.fetch")[0];
  assert.deepEqual(catalog.params, { url: `${API}/v2/items`, method: "GET", as: "text" });
  catalog.resolve({ status: 200, contentType: "application/json", body: JSON.stringify(ITEMS) });
  await flush();
  assert.equal(state.phase, "ready", "searchable before it is stored");
  assert.equal(open("storage.remove").length, 0, "storing waits for the next turn");
  vm.advance(100);
  await settleStorage();
  assert.equal(state.phase, "ready");
  assert.equal(state.count, 8);
  assert.equal(state.query, "arcane");
  assert.deepEqual(state.results.map((item) => item.slug), ["arcane_energize", "arcane_grace", "arcane_guardian"]);
  const writes = vm.calls.filter((call) => call.service === "storage.set").map((call) => call.params);
  assert.deepEqual(writes.map((params) => params.key), ["catalog-0", "catalog"]);
  assert.deepEqual(writes[1].value, { version: "v1", chunks: 1 });
  assert.deepEqual(logic.decodeCatalog([writes[0].value]), logic.parseCatalog(ITEMS));
  assert.equal(logic.statusText(state.phase, state.count, state.error, state.detail, false),
    "8 items cached · select an item to view offers");
});

test("search: results as the user types, saved a second after the last keystroke", async () => {
  logic.search({ value: "PRIME" });
  assert.deepEqual(state.results.map((item) => item.name),
    ["Primed Flow", "Soma Prime Set", "Silva & Aegis Prime Guard"]);
  logic.search({ value: "prime" });
  vm.advance(999);
  assert.equal(open("storage.set").length, 0);
  vm.advance(1);
  const [save] = open("storage.set");
  assert.deepEqual(save.params, { key: "state", value: { query: "prime" } });
  save.resolve(null);
  logic.search({ value: "hells" });
  assert.deepEqual(state.results.map((item) => item.slug), ["hells_chamber"], "the slug matches too");
  logic.search({ value: "x".repeat(65) });
  assert.deepEqual(state.results, [], "too long");
  logic.clear();
  assert.equal(state.query, "");
  assert.equal(logic.emptyText(state.query, state.phase), MESSAGES["empty-start"]);
  vm.advance(1000);
  open("storage.set")[0].resolve(null);
  await flush();
});

test("select: paced requests; only the latest selection shows its offers", async () => {
  logic.search({ value: "arcane" });
  logic.select("arcane_energize");
  assert.equal(state.loadingOrders, true);
  await flush();
  const [first] = open("http.fetch");
  assert.deepEqual(first.params, { url: `${API}/v2/orders/item/arcane_energize`, method: "GET", as: "text" });
  logic.select("arcane_guardian");
  logic.select("arcane_grace");
  await flush();
  assert.equal(open("http.fetch").length, 1, "the next start waits 400 ms");
  assert.equal(vm.timers.filter((timer) => !timer.repeat).length >= 1, true);
  vm.advance(logic.REQUEST_SPACING_MS);
  await flush();
  assert.equal(open("http.fetch").length, 1, "orders requests run one after the other");
  first.resolve(answer(ORDERS_TEXT));
  await flush();
  assert.equal(state.detail, null, "a superseded answer is dropped");
  const requests = open("http.fetch");
  assert.deepEqual(requests.map(fetchUrl), [`${API}/v2/orders/item/arcane_grace`],
    "one request for the latest selection");
  requests[0].resolve(answer(ORDERS_TEXT));
  await flush();
  assert.equal(state.loadingOrders, false);
  assert.equal(state.detail.name, "Arcane Grace");
  // Online and in game only, sellers by rising and buyers by falling price
  // per item: the hidden offer and the offline seller are left out.
  assert.deepEqual(state.detail.sells.map((order) => order.trader), ["Tenno_Trader", "VoidMerchant"]);
  assert.deepEqual(state.detail.buys.map((order) => order.trader), ["OrokinBuyer", "RelicHunter"]);
  assert.equal(state.tab, "sell", "sellers first");
  assert.equal(logic.tabCount(state.detail, "sell"), "2");
  assert.equal(logic.moreOffers(state.detail, "sell"), "");
  assert.equal(logic.unitPrice(state.detail.sells, true), "18p");
  assert.equal(logic.unitPrice(state.detail.buys, false), "15p");
  assert.equal(logic.orderDetail(state.detail.sells[1]), "3 items · total price · Rank 0");
  vm.advance(1000);
  await settleStorage();
});

test("copy: the whisper on a gesture, its feedback, a failed copy", async () => {
  logic.copy("sell", "order-sell-2");
  const [write] = open("clipboard.writeText");
  assert.deepEqual(write.params, { text: "/w VoidMerchant Hi, WTB 3 x Arcane Grace (Rank 0) for 60p total" });
  assert.deepEqual(state.copy, { side: "sell", id: "order-sell-2", state: "pending" });
  assert.equal(logic.copyBusy(state.copy), true);
  logic.copy("buy", "order-buy-5");
  assert.equal(open("clipboard.writeText").length, 1, "one copy at a time");
  write.resolve(null);
  await flush();
  assert.equal(state.copy.state, "copied");
  assert.equal(logic.copyLabel(state.copy, "sell", "order-sell-2"), "Copied");
  assert.equal(logic.copyLabel(state.copy, "buy", "order-buy-5"), "Whisper");
  logic.copy("buy", "order-buy-5");
  open("clipboard.writeText")[0].reject("unavailable");
  await flush();
  assert.deepEqual(state.copy, { side: "buy", id: "order-buy-5", state: "failed" });
  assert.equal(logic.copyStatus(state.copy), MESSAGES["copy-status-failed"]);
  logic.back();
  assert.equal(state.detail, null);
  assert.equal(state.copy, null);
});

test("select: a failed request shows the error until the next selection", async () => {
  vm.advance(logic.REQUEST_SPACING_MS);
  logic.select("primed_flow");
  await flush();
  open("http.fetch")[0].reject("transport_failed");
  await flush();
  assert.equal(state.error, "orders_unavailable");
  assert.equal(logic.statusText(state.phase, state.count, state.error, state.detail, false),
    "Orders unavailable · select an item to retry");
  logic.select("primed_flow");
  assert.equal(state.error, null);
  vm.advance(logic.REQUEST_SPACING_MS);
  await flush();
  open("http.fetch")[0].resolve({ status: 503, contentType: "text/plain", body: null });
  await flush();
  assert.equal(state.error, "orders_unavailable", "a status other than 200 fails too");
  logic.back();
});

/** The fixture's answer with the first seller's price changed. */
const repriced = (platinum) => JSON.stringify({
  ...ORDERS,
  data: ORDERS.data.map((row, index) => (index === 0 ? { ...row, platinum } : row)),
});

test("refresh: the shown offers stay until the new ones arrive, one request at a time", async () => {
  vm.advance(logic.REQUEST_SPACING_MS);
  logic.select("arcane_energize");
  await flush();
  open("http.fetch")[0].resolve(answer(ORDERS_TEXT));
  await flush();
  const shown = state.detail;
  assert.equal(shown.sells[0].platinum, 18);
  logic.refresh();
  assert.equal(state.refreshing, true);
  assert.equal(logic.refreshBusy(state.loadingOrders, state.refreshing), true, "the button is off");
  assert.equal(state.detail, shown, "the offers stay meanwhile");
  assert.equal(logic.liveStatus(state.phase, state.count, state.error, state.detail, state.loadingOrders,
    state.refreshing), "Refreshing offers…");
  logic.refresh();
  vm.advance(logic.REQUEST_SPACING_MS);
  await flush();
  const requests = open("http.fetch");
  assert.equal(requests.length, 1, "a second press while it runs does nothing");
  requests[0].resolve(answer(repriced(17)));
  await flush();
  assert.equal(state.refreshing, false);
  assert.equal(state.detail.sells[0].platinum, 17);
  // A failed refresh keeps the previous offers and says so.
  vm.advance(logic.REQUEST_SPACING_MS);
  logic.refresh();
  await flush();
  open("http.fetch")[0].reject("transport_failed");
  await flush();
  assert.equal(state.detail.sells[0].platinum, 17);
  assert.equal(logic.liveStatus(state.phase, state.count, state.error, state.detail, state.loadingOrders,
    state.refreshing), "Refresh failed · showing the previous offers");
});

test("auto refresh: off by default, then every 30 s, slower after errors, never two at once", async () => {
  const pending = () => open("http.fetch").length;
  assert.equal(logic.autoRefresh({}), "off");
  vm.advance(10 * 60_000);
  await flush();
  assert.equal(pending(), 0, "off: nothing reloads");
  vm.setHost({ options: { "auto-refresh": "every-30s" } });
  // The last refresh failed: the first automatic one waits twice as long.
  vm.advance(30_000);
  await flush();
  assert.equal(pending(), 0);
  vm.advance(30_000);
  await flush();
  assert.equal(pending(), 1, "after 60 s");
  vm.advance(5 * 60_000);
  await flush();
  assert.equal(pending(), 1, "never while a request runs");
  open("http.fetch")[0].resolve(answer(repriced(16)));
  await flush();
  assert.equal(state.detail.sells[0].platinum, 16);
  vm.advance(29_999);
  await flush();
  assert.equal(pending(), 0);
  vm.advance(1);
  await flush();
  assert.equal(pending(), 1, "every 30 s once it succeeds");
  open("http.fetch")[0].resolve(answer(ORDERS_TEXT));
  await flush();
  vm.setHost({ options: { "auto-refresh": "every-1m" } });
  vm.advance(59_999);
  await flush();
  assert.equal(pending(), 0);
  vm.advance(1);
  await flush();
  assert.equal(pending(), 1, "every minute");
  open("http.fetch")[0].resolve(answer(ORDERS_TEXT));
  await flush();
  // Without an item shown, nothing reloads.
  logic.back();
  vm.advance(10 * 60_000);
  await flush();
  assert.equal(pending(), 0);
  vm.setHost({ options: { "auto-refresh": "off" } });
});

test("the catalog parser keeps valid rows only and bounds the catalog", () => {
  const rows = [
    { slug: "ok_item", i18n: { en: { name: " Kept " } } },
    { slug: "Bad-Case", i18n: { en: { name: "Uppercase slug" } } },
    { slug: "../path", i18n: { en: { name: "Traversal" } } },
    { slug: "control", i18n: { en: { name: "Bell\u0007" } } },
    { slug: "ok_item", i18n: { en: { name: "Duplicate wins" } } },
    { slug: "no_name", i18n: {} },
    null,
  ];
  assert.deepEqual(logic.parseCatalog({ data: rows }), [{ slug: "ok_item", name: "Duplicate wins" }]);
  assert.throws(() => logic.parseCatalog({ data: [] }));
  assert.throws(() => logic.parseCatalog({ data: [rows[1]] }));
  assert.throws(() => logic.parseCatalog({ data: new Array(logic.MAX_ITEMS + 1).fill(rows[0]) }));
  assert.throws(() => logic.parseCatalog({ data: { length: 1 } }));
  const long = logic.sanitizeName("x".repeat(200));
  assert.equal([...long].length, 96);
  assert.ok(long.endsWith("…"));
  assert.equal(logic.parseVersion(VERSIONS), "v1");
  assert.equal(logic.parseVersion({ data: { collections: { items: "x".repeat(129) } } }), "");
  assert.equal(logic.parseVersion(null), "");
});

test("a catalog of the real size fits two storage values and round-trips", () => {
  const catalog = logic.parseCatalog(syntheticCatalog(3892));
  const chunks = logic.encodeCatalog(catalog);
  assert.ok(chunks && chunks.length <= 2, `${chunks?.length} chunks`);
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(JSON.stringify(chunk)) <= logic.CHUNK_BYTES, "within a storage value");
  }
  assert.deepEqual(logic.decodeCatalog(chunks), catalog);
  // Names whose slug does not derive from them keep their slug.
  const odd = logic.parseCatalog(ITEMS);
  assert.deepEqual(logic.decodeCatalog(logic.encodeCatalog(odd)), odd);
  assert.equal(logic.derivedSlug("Silva & Aegis Prime Guard"), "silva_aegis_prime_guard");
  // Beyond three values the catalog is not stored.
  const huge = Array.from({ length: 8000 }, (_, index) => ({ slug: `s${index}`, name: `${"n".repeat(40)} ${index}` }));
  assert.equal(logic.encodeCatalog(huge), null);
  // A stored value crosses the same checks as remote data.
  assert.throws(() => logic.decodeCatalog([42]));
  assert.throws(() => logic.decodeCatalog(["Name\tslug\textra"]));
  assert.throws(() => logic.decodeCatalog(["Traversal\t../x"]));
});

test("the orders parser keeps the visible PC offers of players in game or online", () => {
  const detail = logic.parseOrdersText(ORDERS_TEXT, "arcane_energize", "Arcane Energize");
  assert.equal(detail.sells.length, 2, "hidden and offline offers are dropped");
  assert.equal(detail.buys.length, 2);
  assert.deepEqual(detail.sells.map((order) => order.presence), ["ingame", "online"]);
  const base = ORDERS.data[0];
  const variant = (changes) => ({ ...base, ...changes, user: { ...base.user, ...(changes.user ?? {}) } });
  const parsed = (row) => logic.parseOrder(row);
  assert.equal(parsed(variant({ user: { platform: "ps4" } })), null);
  assert.equal(parsed(variant({ id: "bad id" })), null);
  assert.equal(parsed(variant({ platinum: 0 })), null);
  assert.equal(parsed(variant({ platinum: 1.5 })), null);
  assert.equal(parsed(variant({ perTrade: 7 })), null);
  assert.equal(parsed(variant({ rank: 101 })), null);
  assert.equal(parsed(variant({ type: "trade" })), null);
  assert.equal(parsed(variant({ visible: false })), null);
  assert.equal(parsed(variant({ user: { ingameName: "/\\" } })), null);
  assert.equal(parsed(variant({ user: { ingameName: "Evil/Name\\" } })).trader, "EvilName");
  assert.equal(parsed(variant({ user: { status: "offline" } })), null);
  assert.equal(parsed(variant({ user: { status: "away" } })), null);
  assert.equal(parsed(variant({ type: "buy" })).side, "buy");
});

/** An orders answer of `count` sells, the cheapest last, as the provider writes it. */
function manyOrders(count, statuses = ["ingame", "online", "offline"]) {
  const base = ORDERS.data[0];
  return {
    apiVersion: "0.25.0",
    data: Array.from({ length: count }, (_, index) => ({
      ...base,
      id: `order-${index}`,
      platinum: count - index,
      user: { ...base.user, ingameName: `Trader${index}`, status: statuses[index % statuses.length] },
    })),
    error: null,
  };
}

test("an answer is read in slices, and at most 150 offers a tab are kept", () => {
  const text = JSON.stringify(manyOrders(logic.ORDER_SLICE_ROWS * 2 + 7));
  const collector = new logic.OrderCollector();
  const reader = new logic.OrderReader(text, collector);
  let turns = 1;
  while (!reader.step()) {
    turns += 1;
  }
  assert.equal(turns, 3, "one slice of 300 rows per turn");
  const detail = collector.finish("x", "X");
  // Two in three are online or in game: 405 of 607.
  assert.equal(detail.sellTotal, 405);
  assert.equal(detail.sells.length, logic.MAX_OFFERS_SHOWN);
  assert.equal(detail.sells[0].platinum, 1, "the cheapest first");
  assert.ok(detail.sells.every((order, index) => index === 0 || order.platinum >= detail.sells[index - 1].platinum));
  assert.equal(logic.moreOffers(detail, "sell"), "+255 more");
  assert.equal(logic.tabCount(detail, "sell"), "405");
  assert.equal(logic.moreOffers(detail, "buy"), "");
  assert.deepEqual(logic.parseOrdersText('{"apiVersion":"0","data":[],"error":null}').sells, []);
});

test("a malformed or oversized orders answer fails closed", () => {
  const row = JSON.stringify(ORDERS.data[0]);
  for (const bad of [
    "",
    "{}",
    '{"data":{}}',
    `{"data":[${row}`,
    `{"data":[${row},]}`,
    `{"data":[${row}]} trailing`,
    `{"data":[${row}],"x":1} {"data":[]}`,
    `${" ".repeat(300)}{"data":[]}`,
  ]) {
    assert.throws(() => logic.parseOrdersText(bad), undefined, bad);
  }
  // Rows whose first key is not `id` have no boundary the reader cuts at:
  // a whole answer is never parsed in one turn.
  const shuffled = manyOrders(1500).data.map(({ id, ...rest }) => ({ ...rest, id }));
  assert.throws(() => logic.parseOrdersText(JSON.stringify({ data: shuffled })));
  // Beyond 20,000 rows.
  const tiny = '{"id":"a","visible":false}';
  const huge = `{"data":[${new Array(logic.MAX_ORDERS_IN_ANSWER + 1).fill(tiny).join(",")}]}`;
  assert.throws(() => logic.parseOrdersText(huge));
});

test("tabs: sellers first, buyers on demand", () => {
  const detail = logic.parseOrdersText(ORDERS_TEXT, "a", "A");
  assert.equal(logic.tabClass("sell", "sell"), "tab active");
  assert.equal(logic.tabClass("sell", "buy"), "tab");
  assert.deepEqual(logic.tabOrders(detail, "buy").map((order) => order.trader), ["OrokinBuyer", "RelicHunter"]);
  logic.showTab("buy");
  assert.equal(state.tab, "buy");
  logic.showTab("sell");
});

test("the catalog and the orders run one after the other", async () => {
  const order = [];
  let release;
  const first = logic.inLane(() => new Promise((resolve) => {
    order.push("catalog");
    release = resolve;
  }));
  const second = logic.inLane(async () => {
    order.push("orders");
  });
  await flush();
  assert.deepEqual(order, ["catalog"], "the orders wait for the catalog");
  release();
  await first;
  await second;
  assert.deepEqual(order, ["catalog", "orders"]);
  // A failed task does not block the next one.
  const failed = logic.inLane(async () => {
    throw new Error("x");
  });
  await assert.rejects(failed);
  assert.equal(await logic.inLane(async () => 1), 1);
});

test("whispers name the variant and the total price", () => {
  const order = { id: "x", side: "buy", platinum: 90, trader: "Seller", presence: "online", perTrade: 1 };
  assert.equal(logic.whisperLine(order, "Riven"), "/w Seller Hi, WTS Riven for 90p");
  assert.equal(
    logic.whisperLine({ ...order, side: "sell", perTrade: 2, rank: 3, charges: 1, amberStars: 2, subtype: "flawless_x" }, "Relic"),
    "/w Seller Hi, WTB 2 x Relic (Rank 3, 1 charges, 2 amber / 0 cyan stars, flawless x) for 90p total",
  );
});

test("status texts follow the phase and the error", () => {
  assert.equal(logic.statusText("loading", 0, null, null, false), MESSAGES["status-loading"]);
  assert.equal(logic.statusText("unavailable", 0, "catalog_unavailable", null, false), "Catalog unavailable");
  assert.equal(logic.statusText("ready", 5, "catalog_unavailable", null, false), MESSAGES["status-catalog-stale"]);
  assert.equal(logic.statusText("ready", 5, "storage_unavailable", null, false), MESSAGES["status-storage_unavailable"]);
  assert.equal(logic.statusText("ready", 1234, null, null, true), MESSAGES["status-loading-orders"]);
  assert.equal(logic.statusText("ready", 1234, null, null, false), "1,234 items cached · select an item to view offers");
  assert.equal(logic.searchHint(false), MESSAGES["hint-passive"]);
  vm.setHost({ mode: "passive" });
  assert.equal(state.interactive, false);
  vm.setHost({ mode: "interactive" });
  assert.equal(state.interactive, true);
});

test("the incremental reader: strings, nesting, slices and malformed text", () => {
  const row = (slug, name) => ({ slug, i18n: { en: { name } }, tags: ["a", "[b]"], note: "{\"x\": [1]}\\" });
  const text = JSON.stringify({ apiVersion: "0", data: [row("a_b", "A B"), row("c_d", "C \"D\" {e}")], error: null });
  assert.deepEqual(logic.parseCatalogText(text), [
    { slug: "a_b", name: "A B" },
    { slug: "c_d", name: "C \"D\" {e}" },
  ]);
  // Whitespace, key order and an unrelated nested `data` do not matter.
  assert.deepEqual(
    logic.parseCatalogText(`  { "error" : { "data": [1] } , "data" :\n [ ${JSON.stringify(row("x", "X"))} ] }  `),
    [{ slug: "x", name: "X" }],
  );
  // More rows than one slice: every slice continues where the last stopped.
  const many = Array.from({ length: logic.SLICE_ITEMS * 2 + 3 }, (_, index) => row(`s${index}`, `Name ${index}`));
  const builder = new logic.CatalogBuilder();
  const scanner = new logic.CatalogScanner(JSON.stringify({ data: many }), builder);
  let turns = 1;
  while (!scanner.step()) {
    turns += 1;
  }
  assert.equal(turns, 3);
  assert.equal(builder.finish().length, many.length);
  for (const bad of [
    "",
    "[]",
    '{"data": {}}',
    '{"data": [[1]]}',
    '{"data": [{"slug": "a"}]', // unbalanced
    '{"data": [{"slug": "a"]}}', // mismatched
    '{"data": [], "data": []}',
    `{"data": [${JSON.stringify(row("a", "A"))}]} {}`,
    `{"data": [${JSON.stringify(row("a", "A"))}]} x`,
    '{"data": ["unterminated}]}',
    `${"[".repeat(70)}`,
  ]) {
    assert.throws(() => logic.parseCatalogText(bad), undefined, bad);
  }
});
