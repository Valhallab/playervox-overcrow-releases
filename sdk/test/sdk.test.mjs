import assert from "node:assert/strict";
import { test } from "node:test";

import { HOST, installRuntime } from "./fake-runtime.mjs";

const vm = installRuntime();
const overcrow = await import("../dist/index.js");

const settle = () => new Promise((resolve) => setImmediate(resolve));
const lastCall = () => vm.calls[vm.calls.length - 1];

test("the version and the runtime surface are exported", () => {
  assert.equal(overcrow.SDK_VERSION, "1.4.0");
  assert.equal(overcrow.RUNTIME_SURFACE, "0.1");
});

test("state is the runtime's object; initState fills it", () => {
  assert.equal(overcrow.state, globalThis.overcrow.state);
  const state = overcrow.initState({ now: 5, seconds: false });
  assert.equal(state, overcrow.state);
  state.now += 1;
  assert.equal(globalThis.overcrow.state.now, 6);
});

test("host data is live and frozen", () => {
  assert.equal(overcrow.host.locale, "en");
  vm.host = { ...HOST, locale: "fr", grants: ["fps.read", "media.read"] };
  assert.equal(overcrow.host.locale, "fr");
  assert.ok(overcrow.hasGrant("media.read"));
  assert.ok(!overcrow.hasGrant("notes.read"));
  assert.ok(Object.isFrozen(overcrow.host));
  assert.throws(() => {
    "use strict";
    overcrow.host.locale = "en";
  }, TypeError);
  vm.host = HOST;
  assert.equal(overcrow.host.locale, "en");
});

test("options fall back on a missing value or another type", () => {
  assert.equal(overcrow.option("seconds", false), true);
  assert.equal(overcrow.option("size", 1), 3);
  assert.equal(overcrow.option("size", "big"), "big");
  assert.equal(overcrow.option("missing", 7), 7);
});

test("messages interpolate named values", () => {
  assert.equal(overcrow.t("greeting", { name: "Ada" }), "Hello Ada");
  assert.equal(overcrow.t("greeting"), "Hello {name}");
  assert.equal(overcrow.t("greeting", { other: 1 }), "Hello {name}");
  assert.equal(overcrow.t("missing.key"), "missing.key");
  assert.equal(overcrow.t("greeting", { name: "{name}" }), "Hello {name}", "no recursion");
  assert.equal(overcrow.t("toString"), "toString", "only own messages");
});

test("calls resolve with the result and reject with a ServiceError", async () => {
  const pending = overcrow.storage.get({ key: "k" });
  assert.deepEqual(
    { service: lastCall().service, params: lastCall().params },
    { service: "storage.get", params: { key: "k" } },
  );
  lastCall().resolve({ saved: 1 });
  assert.deepEqual(await pending, { saved: 1 });

  const failing = overcrow.notes.create();
  assert.deepEqual(lastCall().params, {}, "no parameters is an empty object");
  lastCall().reject({ code: "gesture_required" });
  const error = await failing.catch((caught) => caught);
  assert.ok(error instanceof overcrow.ServiceError);
  assert.ok(error instanceof Error);
  assert.equal(error.code, "gesture_required");

  const refused = overcrow.call("storage.keys");
  lastCall().reject(new TypeError("too many service calls in flight"));
  await assert.rejects(refused, TypeError);
});

test("namespaces reach nested services", async () => {
  const page = overcrow.playervox.reviews.page({ page: 2, followedOnly: true });
  assert.equal(lastCall().service, "playervox.reviews.page");
  lastCall().resolve({ items: [], page: 2, totalPages: 2, count: 0 });
  assert.equal((await page).page, 2);
  overcrow.twitch.chat.leave();
  assert.equal(lastCall().service, "twitch.chat.leave");
  overcrow.media.previous();
  assert.deepEqual(lastCall().params, {});
});

test("live Twitch events subscribe with their types and pass each update through", () => {
  const updates = [];
  overcrow.twitch.events.subscribe({ types: ["channel.goal.progress"] }, (update) => updates.push(update));
  const [, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "twitch.events.subscribe");
  assert.deepEqual(entry.params, { types: ["channel.goal.progress"] });
  const value = {
    state: "live",
    reason: null,
    events: [{ seq: 1, type: "channel.goal.progress", at: 1, data: { id: "g1" } }],
  };
  entry.update({ value, final: false });
  entry.update({ error: { code: "permission_denied" }, final: true });
  assert.deepEqual(updates[0], { ok: true, value, final: false });
  assert.equal(updates[1].ok, false);
  assert.equal(updates[1].error.code, "permission_denied");
});

test("local Steam events subscribe for the account the widget names", () => {
  const updates = [];
  const steamid = "76561197985436232";
  overcrow.steam.events.subscribe({ steamid }, (update) => updates.push(update));
  const [, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "steam.events.subscribe");
  assert.deepEqual(entry.params, { steamid });
  const value = {
    state: "live",
    reason: null,
    events: [{ seq: 1, type: "stats.saved", at: 1, data: { appid: 2315050 } }],
  };
  entry.update({ value, final: false });
  assert.deepEqual(updates[0], { ok: true, value, final: false });
});

test("the active game comes by subscription", () => {
  const updates = [];
  overcrow.game.subscribe((update) => updates.push(update));
  const [, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "game.subscribe");
  const value = { steamAppId: 1806840, name: "100 Hidden Frogs" };
  entry.update({ value, final: false });
  entry.update({ value: null, final: false });
  assert.deepEqual(updates, [
    { ok: true, value, final: false },
    { ok: true, value: null, final: false },
  ]);
});

test("Warframe events come by one subscription, typed by event", () => {
  const updates = [];
  overcrow.gameEvents.warframe.subscribe((update) => updates.push(update));
  const [, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "gameEvents.warframe.subscribe");
  assert.equal(typeof overcrow.gameEvents.subscribe, "undefined");
  const mission = { state: "ended", node: { id: "SolNode195", name: "Hydron" } };
  const value = {
    playing: true,
    session: { startedAt: 1793000000000 },
    features: { mission: "available" },
    info: { mission },
    events: [{ seq: 1, at: 1793000300500, type: "mission_ended", mission }],
  };
  entry.update({ value, final: false });
  assert.deepEqual(updates[0], { ok: true, value, final: false });
});

test("local Steam achievements are read by call for the account the widget names", async () => {
  const params = { steamid: "76561197985436232", appid: 1806840 };
  const pending = overcrow.steam.achievements.local(params);
  assert.deepEqual({ service: lastCall().service, params: lastCall().params }, { service: "steam.achievements.local", params });
  const value = { appid: 1806840, total: 1, achievements: [{ name: "ACH_FROG_FOUND", unlockedAt: 1761568118000 }] };
  lastCall().resolve(value);
  assert.deepEqual(await pending, value);
  const failing = overcrow.steam.achievements.local({ ...params, offset: 4096 });
  lastCall().reject({ code: "unavailable" });
  const error = await failing.catch((caught) => caught);
  assert.equal(error.code, "unavailable");
});

test("account services name the declared account; the secret never shows", async () => {
  vm.host = { ...HOST, grants: ["account:steam"] };
  assert.ok(overcrow.hasGrant("account:steam"));
  assert.ok(!overcrow.hasGrant("account:other"));
  vm.host = HOST;
  const updates = [];
  overcrow.account.subscribe({ id: "steam" }, (update) => updates.push(update));
  const [, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "account.subscribe");
  assert.deepEqual(entry.params, { id: "steam" });
  entry.update({ value: { state: "refused" }, final: false });
  assert.deepEqual(updates, [{ ok: true, value: { state: "refused" }, final: false }]);

  const connecting = overcrow.account.connect({ id: "steam" });
  assert.deepEqual(
    { service: lastCall().service, params: lastCall().params },
    { service: "account.connect", params: { id: "steam" } },
  );
  lastCall().resolve(null);
  assert.equal(await connecting, null);

  const fetching = overcrow.http.fetch(
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?steamids=1",
    { as: "json" },
  );
  lastCall().reject({ code: "account_refused" });
  const error = await fetching.catch((caught) => caught);
  assert.ok(error instanceof overcrow.ServiceError);
  assert.equal(error.code, "account_refused");
});

test("subscriptions report values and their final failure", () => {
  const updates = [];
  const subscription = overcrow.fps.subscribe((update) => updates.push(update));
  const [id, entry] = [...vm.subscriptions].at(-1);
  assert.equal(entry.service, "fps.subscribe");
  assert.deepEqual(entry.params, {});
  entry.update({ value: { fps: 60, stale: false, status: "ready" }, final: false });
  entry.update({ error: { code: "permission_denied" }, final: true });
  assert.deepEqual(updates[0], {
    ok: true,
    value: { fps: 60, stale: false, status: "ready" },
    final: false,
  });
  assert.equal(updates[1].ok, false);
  assert.equal(updates[1].error.code, "permission_denied");
  assert.equal(updates[1].final, true);
  subscription.cancel();
  subscription.cancel();
  assert.deepEqual(vm.cancelled, [id]);

  overcrow.media.subscribe({ cover: false }, () => {});
  assert.deepEqual([...vm.subscriptions].at(-1)[1].params, { cover: false });
  overcrow.subscribe("session.subscribe", {}, () => {});
  assert.equal([...vm.subscriptions].at(-1)[1].service, "session.subscribe");
});

test("http.fetch sends the body raw and decodes the answer", async () => {
  const json = overcrow.http.fetch("https://api.example.com/v1/x", {
    method: "POST",
    as: "json",
    body: { a: 1 },
  });
  assert.deepEqual(lastCall().params, {
    url: "https://api.example.com/v1/x",
    method: "POST",
    as: "json",
    contentType: "application/json",
  });
  assert.equal(lastCall().body, '{"a":1}');
  lastCall().resolve({
    status: 429,
    contentType: "application/json",
    headers: { "retry-after": "30", "ratelimit-reset": "1700000060" },
    body: { ok: false },
  });
  assert.deepEqual(await json, {
    status: 429,
    contentType: "application/json",
    headers: { "retry-after": "30", "ratelimit-reset": "1700000060" },
    body: { ok: false },
  });

  const text = overcrow.http.fetch("https://api.example.com/v1/t", { as: "text", body: "hi" });
  assert.deepEqual(lastCall().params.method, "GET");
  assert.equal(lastCall().params.contentType, "text/plain");
  assert.equal(lastCall().body, "hi");
  // A host older than SDK 1.3 sends no headers: they read as none.
  lastCall().resolve({ status: 204, contentType: null });
  assert.deepEqual(await text, { status: 204, contentType: null, headers: {}, body: "" });

  const quoted = overcrow.http.fetch("https://api.example.com/v1/q", {
    as: "bytes",
    body: "hi",
    contentType: "application/json",
  });
  assert.equal(lastCall().body, '"hi"', "a string sent as JSON is encoded");
  lastCall().resolve({ status: 200, contentType: null });
  assert.equal((await quoted).body.byteLength, 0);

  const image = overcrow.http.fetch("https://cdn.example.com/a.png", { as: "image" });
  assert.equal(lastCall().body, undefined);
  assert.equal("contentType" in lastCall().params, false);
  lastCall().resolve({ status: 200, asset: "asset:0000000000000001", headers: { etag: '"7"' } });
  assert.deepEqual(await image, { status: 200, asset: "asset:0000000000000001", headers: { etag: '"7"' } });
  const older = overcrow.http.fetch("https://cdn.example.com/b.png", { as: "image" });
  lastCall().resolve({ status: 200, asset: "asset:0000000000000002" });
  assert.deepEqual(await older, { status: 200, asset: "asset:0000000000000002", headers: {} });

  const denied = overcrow.http.fetch("https://other.example.com/", { as: "json" });
  lastCall().reject({ code: "permission_denied" });
  await assert.rejects(denied, (error) => error.code === "permission_denied");
  await settle();
});

test("the view table, drawings, the menu and logs reach the runtime", () => {
  const table = [(state) => state.now, (_state, _scope, event) => event.detail];
  overcrow.registerView(table);
  assert.equal(vm.table, table);
  assert.throws(() => overcrow.registerView([]), TypeError, "registered once");

  const commands = [
    ["moveTo", 0, 0],
    ["lineTo", 10, 5],
    ["stroke", "var(--color-accent)", 2],
  ];
  overcrow.draw("spark", commands);
  assert.deepEqual(vm.draws, [{ ref: "spark", commands }]);

  const rows = [];
  overcrow.onMenu((row) => rows.push(row));
  vm.menu("refresh");
  assert.deepEqual(rows, ["refresh"]);

  const changes = [];
  const first = overcrow.onHost((changed) => changes.push(["first", ...changed]));
  overcrow.onHost((changed) => changes.push(["second", ...changed]));
  vm.setHost({ options: { seconds: false }, visible: true });
  assert.equal(overcrow.host.options.seconds, false, "the host is current in the listener's turn");
  first.cancel();
  first.cancel();
  vm.setHost({ region: HOST.region });
  assert.deepEqual(changes, [
    ["first", "options", "visible"],
    ["second", "options", "visible"],
    ["second", "region"],
  ]);

  overcrow.log.info("started");
  overcrow.log.error("failed");
  assert.deepEqual(vm.logs, [
    { level: "info", text: "started" },
    { level: "error", text: "failed" },
  ]);
});

test("the generated namespaces carry no data at runtime", async () => {
  const schema = await import("../dist/generated/schema.js");
  const icons = await import("../dist/generated/icons.js");
  const limits = await import("../dist/generated/limits.js");
  assert.deepEqual(Object.keys(schema), [], "schema types only");
  assert.deepEqual(Object.keys(icons), [], "icon names are a type only");
  assert.ok(Object.values(limits).every((value) => typeof value === "number"), "limits only");
  assert.equal(limits.MAX_TIMERS, overcrow.MAX_TIMERS);
  assert.equal(overcrow.MIN_TIMER_INTERVAL_MS, 100);
});
