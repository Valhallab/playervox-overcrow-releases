// Local achievements (`steam.achievements.local`): the Steam client of this
// computer has an achievement the moment it unlocks, while Steam's Web API
// publishes it seconds to minutes later. At each save of the game shown,
// the widget reads them on the computer: a new one shows at once, marked
// new; the Web API still gives the names, icons and rarity, and confirms it
// later without marking it again. A save then asks the Web API nothing more
// than its minute. Hidden, nothing is read; shown again, at once.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const START = Date.UTC(2026, 0, 1, 12);
const vm = installRuntime({ now: START, host: { messages: EN, grants: ["storage", "network", "account:steam", "game.read"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(8), unlocked: { ACH_0: 1767000000 } };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.local = { 100: { ACH_0: 1767000000 } };
steam.recent = [200];
// Invisible: Steam's presence names no game; the host does.
steam.playing = null;
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push("game.subscribe", { steamAppId: 100, name: "Ashen Crown" });
await settle(vm, steam);
const EVENTS = "steam.events.subscribe";
const player = () => steam.count("GetPlayerAchievements");
const local = () => steam.localCalls.length;

let window = [];
let seq = 0;
async function saved(appid) {
  seq += 1;
  window = [...window, { seq, type: "stats.saved", at: Date.now(), data: { appid } }].slice(-16);
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, steam);
}
async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}
const now = () => Math.floor(Date.now() / 1000);

test("the widget declares the local achievements and reads those of the game shown", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.accounts, [{ service: "steam", events: ["stats.saved"], local: ["achievements"] }]);
  assert.equal(state.phase, "game");
  assert.equal(state.game.appid, 100);
  assert.ok(local() >= 1, "read with the game");
  assert.deepEqual(steam.localCalls.at(-1), { steamid: ID, appid: 100 });
  assert.equal(state.game.unlocked, 1);
  assert.deepEqual(state.fresh, {}, "what was there before is not new");
});

test("a save shows a new achievement at once, before Steam publishes it", async () => {
  await wait(10_000);
  vm.push(EVENTS, { state: "live", reason: null, events: [] });
  await settle(vm, steam);
  const reads = player();
  const calls = local();
  steam.local[100].ACH_1 = now();
  await saved(100);
  assert.equal(local(), calls + 1, "read on the computer at once");
  assert.equal(state.game.unlocked, 2);
  assert.ok("ACH_1" in state.fresh, "marked new");
  assert.equal(player(), reads, "Steam's Web API is not asked");
  // Nor looked at again later (+10 s, +30 s): the computer said it.
  await wait(30_000);
  assert.equal(player(), reads);
});

test("Steam publishes it later: confirmed, never new again", async () => {
  steam.games[100].unlocked.ACH_1 = steam.local[100].ACH_1;
  const freshUntil = state.fresh.ACH_1;
  await wait(60_000 - ((Date.now() - START) % 60_000));
  assert.ok(player() >= 2, "the minute's read");
  assert.equal(state.game.unlocked, 2);
  assert.equal(state.fresh.ACH_1 ?? freshUntil, freshUntil, "not marked again");
  await wait(120_000);
  assert.equal(state.fresh.ACH_1, undefined, "the mark lasts its minute");
  assert.equal(state.game.unlocked, 2);
});

test("several saves in a row: one read at a time, the last one seen", async () => {
  steam.local[100].ACH_2 = now();
  steam.local[100].ACH_3 = now();
  window = [...window, { seq: seq + 1, type: "stats.saved", at: Date.now(), data: { appid: 100 } }, { seq: seq + 2, type: "stats.saved", at: Date.now(), data: { appid: 100 } }];
  seq += 2;
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, steam);
  assert.equal(state.game.unlocked, 4);
  assert.ok("ACH_2" in state.fresh && "ACH_3" in state.fresh);
});

test("a save of another game reads Steam's summary, as before", async () => {
  await wait(10_000);
  const summaries = steam.count("GetPlayerSummaries");
  await saved(200);
  assert.equal(steam.count("GetPlayerSummaries"), summaries + 1);
});

test("hidden: nothing is read; shown again, at once", async () => {
  await wait(10_000);
  vm.setHost({ visible: false });
  const calls = local();
  steam.local[100].ACH_4 = now();
  await saved(100);
  assert.equal(local(), calls, "nothing while hidden");
  vm.setHost({ visible: true });
  await settle(vm, steam);
  assert.ok(local() > calls, "read when shown");
  assert.equal(state.game.unlocked, 5);
});

test("Steam's Web API unreachable: a save still shows the new achievement", async () => {
  await wait(10_000);
  steam.fail = { error: "unavailable" };
  // The next read of the summary, at most two minutes away.
  await wait(60_000);
  await wait(60_000);
  assert.equal(state.stale, "unreachable");
  const before = state.game.unlocked;
  steam.local[100].ACH_5 = now();
  await saved(100);
  assert.equal(state.game.unlocked, before + 1);
  assert.ok("ACH_5" in state.fresh, "marked new");
  steam.fail = null;
});
