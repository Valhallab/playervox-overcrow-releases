// The game PlayerVox OverCrow says is running (`game.subscribe`) comes
// first, then the game Steam's presence names (`gameid`), then the last
// one played. With the status Invisible or offline, Steam names no game:
// the host's game is shown, with its achievements, as playing. A change of
// the host's game reads at once; hidden, when shown again. A game outside
// the Steam store, no game, a refusal or an older host: as before.
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
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000 } };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: { C_0: 1767000000, C_1: 1767000100 } };
// The last game played is another one; Steam's presence names none
// (Invisible).
steam.recent = [200];
steam.playing = null;
const GAME = "game.subscribe";
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push(GAME, { steamAppId: 100, name: "Ashen Crown" });
await settle(vm, steam);
const player = (appid) => steam.requests.filter((url) => url.includes("GetPlayerAchievements") && url.includes(`appid=${appid}`)).length;
const summary = () => steam.count("GetPlayerSummaries");

async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}
async function hostGame(value) {
  vm.push(GAME, value);
  await settle(vm, steam);
}

test("the widget subscribes to the game and declares it", () => {
  assert.ok(vm.subscriptions.some((entry) => entry.service === GAME && !entry.cancelled), "subscribed");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.capabilities, ["game.read"]);
});

test("Invisible: the host's game and its achievements, playing", () => {
  assert.equal(state.phase, "game");
  assert.equal(state.game.appid, 100);
  assert.equal(state.game.name, "Ashen Crown");
  assert.equal(state.game.playing, true);
  assert.equal(state.game.unlocked, 1);
  assert.equal(player(100), 1);
  assert.equal(player(200), 0, "never the last game played");
});

test("playing: the achievements every minute", async () => {
  await wait(60_000 - ((Date.now() - START) % 60_000));
  const before = player(100);
  steam.games[100].unlocked.ACH_1 = 1767100000;
  await wait(60_000);
  assert.equal(player(100), before + 1);
  assert.equal(state.game.unlocked, 2);
});

test("a change of the host's game reads at once", async () => {
  await wait(10_000);
  const before = summary();
  await hostGame({ steamAppId: 200, name: "Courier of Tides" });
  assert.equal(summary(), before + 1, "at once");
  assert.equal(player(200), 1);
  assert.equal(state.game.name, "Courier of Tides");
  assert.equal(state.game.playing, true);
  assert.equal(state.game.unlocked, 2);
});

test("the same game again reads nothing", async () => {
  await wait(10_000);
  const before = steam.requests.length;
  await hostGame({ steamAppId: 200, name: "Courier of Tides" });
  assert.equal(steam.requests.length, before);
});

test("hidden: nothing; shown again after a change: at once", async () => {
  await wait(10_000);
  vm.setHost({ visible: false });
  const before = steam.requests.length;
  await hostGame({ steamAppId: 100, name: "Ashen Crown" });
  await wait(30_000);
  assert.equal(steam.requests.length, before, "nothing while hidden");
  vm.setHost({ visible: true });
  await settle(vm, steam);
  assert.equal(state.game.name, "Ashen Crown");
  assert.ok(player(100) >= 3, "read when shown");
});

test("the game ends: the last game played, no longer playing", async () => {
  await wait(10_000);
  await hostGame(null);
  assert.equal(state.game.appid, 200);
  assert.equal(state.game.playing, false);
});

test("a game outside the Steam store: Steam's presence, as before", async () => {
  await wait(10_000);
  steam.playing = 100;
  const before = steam.requests.length;
  await hostGame({ steamAppId: null, name: "Manual game" });
  assert.deepEqual(steam.requests.slice(before), [], "no Steam game: nothing changed");
  // The minute's next summary (a tick at least a minute after the last).
  await wait(120_000);
  assert.equal(state.game.appid, 100);
  assert.equal(state.game.name, "Ashen Crown");
  assert.equal(state.game.playing, true);
});

test("the host's game comes before Steam's presence", async () => {
  await wait(10_000);
  await hostGame({ steamAppId: 200, name: "Courier of Tides" });
  assert.equal(state.game.appid, 200);
  assert.equal(state.game.playing, true);
});

test("a refused subscription: Steam's presence, as before", async () => {
  await wait(10_000);
  vm.fail(GAME, "permission_denied");
  await settle(vm, steam);
  await wait(60_000);
  assert.equal(state.game.appid, 100);
  assert.equal(state.game.playing, true);
});
