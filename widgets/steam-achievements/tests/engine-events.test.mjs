// Local Steam events (`steam.events`): the Steam client of this computer
// saved the stats of a game of the followed account. For the game shown,
// its achievements are read at once (never twice within 5 seconds), then
// twice more at most (+10 s, +30 s) while Steam's answer shows nothing new;
// for another game, the summary at once (Steam switched games). Hidden,
// nothing; shown again, at once. Without events, the minute as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const START = Date.UTC(2026, 0, 1, 12);
const vm = installRuntime({ now: START, host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000 } };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.recent = [100];
steam.playing = 100;
await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);
const EVENTS = "steam.events.subscribe";
const player = () => steam.count("GetPlayerAchievements");
const summary = () => steam.count("GetPlayerSummaries");

let window = [];
let seq = 0;
/** One `stats.saved` of `appid`, in the window the host repeats. */
async function saved(appid, { gap = false } = {}) {
  seq += gap ? 2 : 1;
  window = [...window, { seq, type: "stats.saved", at: Date.now(), data: { appid } }].slice(-16);
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, steam);
}
async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}

test("the widget listens for the followed account's saves", () => {
  const subscription = vm.subscriptions.find((entry) => entry.service === EVENTS && !entry.cancelled);
  assert.ok(subscription, "subscribed");
  assert.deepEqual(subscription.params, { steamid: ID });
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.accounts, [{ service: "steam", events: ["stats.saved"] }]);
  assert.equal(state.phase, "game");
  assert.deepEqual([state.game.unlocked, player(), summary()], [1, 1, 1]);
});

test("a save of the game shown reads its achievements at once", async () => {
  await wait(10_000);
  vm.push(EVENTS, { state: "live", reason: null, events: [] });
  await settle(vm, steam);
  steam.games[100].unlocked.ACH_1 = 1767100000;
  await saved(100);
  assert.equal(player(), 2, "at once");
  assert.equal(summary(), 1, "the summary keeps its minute");
  assert.equal(state.game.unlocked, 2);
  // Something new: no second look.
  await wait(30_000);
  assert.equal(player(), 2);
});

test("never twice within five seconds, the second save waits its turn", async () => {
  steam.games[100].unlocked.ACH_2 = 1767200000;
  await saved(100);
  // The minute's tick came meanwhile (+40 s) or not: at least one read.
  const after = player();
  await saved(100);
  await saved(100);
  assert.equal(player(), after, "within the floor");
  await wait(5_000);
  assert.equal(player(), after + 1, "once the floor passed");
  assert.equal(state.game.unlocked, 3);
});

test("Steam's late answer: two more looks at +10 s and +30 s, then the minute", async () => {
  // Away from the minute's tick: the first read of the minute comes later.
  await wait(60_000 - ((Date.now() - START) % 60_000) + 2_000);
  const before = player();
  await saved(100);
  assert.equal(player(), before + 1, "at once");
  await wait(9_000);
  assert.equal(player(), before + 1);
  await wait(1_000);
  assert.equal(player(), before + 2, "+10 s");
  steam.games[100].unlocked.ACH_3 = 1767300000;
  await wait(20_000);
  assert.equal(player(), before + 3, "+30 s");
  assert.equal(state.game.unlocked, 4);
  // Nothing more until the minute's tick (+58 s).
  await wait(27_000);
  assert.equal(player(), before + 3);
});

test("after two looks without anything new, the minute again", async () => {
  await wait(60_000 - ((Date.now() - START) % 60_000) + 2_000);
  const before = player();
  await saved(100);
  await wait(10_000);
  await wait(20_000);
  assert.equal(player(), before + 3, "at once, +10 s, +30 s");
  // The last look counts as a read: the minute's next read of the
  // achievements comes at the first tick a minute after it, no sooner.
  await wait(58_000);
  assert.equal(player(), before + 3, "no third look");
  await wait(62_000);
  assert.equal(player(), before + 4, "the minute again");
});

test("a save of another game reads the summary at once: Steam switched games", async () => {
  await wait(10_000);
  const before = summary();
  steam.playing = 200;
  await saved(200);
  assert.equal(summary(), before + 1, "at once");
  assert.equal(state.game.name, "Courier of Tides");
  steam.playing = 100;
});

test("a gap in seq: a save was missed, the summary is read at once", async () => {
  await wait(10_000);
  const before = summary();
  await saved(100, { gap: true });
  assert.equal(summary(), before + 1);
  assert.equal(state.game.name, "Ashen Crown");
});

test("hidden: nothing; shown again after a save: at once", async () => {
  await wait(10_000);
  const before = steam.requests.length;
  vm.setHost({ visible: false });
  steam.games[100].unlocked.ACH_4 = 1767400000;
  await saved(100);
  await wait(30_000);
  assert.equal(steam.requests.length, before, "nothing while hidden");
  const players = player();
  vm.setHost({ visible: true });
  await settle(vm, steam);
  assert.equal(player(), players + 1, "at once when shown");
  assert.equal(state.game.unlocked, 5);
});

test("a save already seen is never read again", async () => {
  await wait(10_000);
  const before = player();
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, steam);
  assert.equal(player(), before);
});

test("without the events, the minute as before", async () => {
  vm.push(EVENTS, { state: "off", reason: "unavailable", events: [] });
  await settle(vm, steam);
  await wait(60_000 - ((Date.now() - START) % 60_000));
  const before = [summary(), player()];
  for (let minute = 0; minute < 5; minute += 1) await wait(60_000);
  assert.deepEqual([summary() - before[0], player() - before[1]], [5, 5]);
});

test("a host that refuses the events: the minute", async () => {
  vm.fail(EVENTS, "unsupported");
  await settle(vm, steam);
  const before = [summary(), player()];
  await wait(60_000);
  assert.deepEqual([summary() - before[0], player() - before[1]], [1, 1]);
});
