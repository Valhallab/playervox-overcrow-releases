// Game details that are not public (Friends Only, Private): Steam's Web API
// refuses the player's achievements, even to their own key. For the game
// PlayerVox OverCrow says is running, the achievements the Steam client of
// this computer saved show instead, named by the game's list (which Steam
// gives whatever the setting), with their rarity: the player's own data, on
// their own screen. Without them (another computer, an older PlayerVox
// OverCrow), the game details are said hidden, as before.
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
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: {} };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.local = { 100: { ACH_0: 1767000000, ACH_3: 1767000500 } };
steam.recent = [200];
steam.playing = null;
steam.details = "friends";
const EVENTS = "steam.events.subscribe";
const { achievements } = await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push("game.subscribe", { steamAppId: 100, name: "Ashen Crown" });
await settle(vm, steam);

async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}

test("the host's game shows its achievements from this computer", () => {
  assert.equal(state.phase, "game");
  assert.equal(state.hidden, "");
  assert.equal(state.game.appid, 100);
  assert.equal(state.game.name, "Ashen Crown");
  assert.equal(state.game.playing, true);
  assert.equal(state.game.total, 5);
  assert.equal(state.game.unlocked, 2);
  const unlocked = achievements().filter((a) => a.achieved);
  assert.deepEqual(unlocked.map((a) => [a.id, a.name, a.at]), [["ACH_0", "Achievement 0", 1767000000000], ["ACH_3", "Achievement 3", 1767000500000]]);
  assert.ok(achievements().every((a) => a.rarity >= 0), "the rarity, which Steam gives whatever the setting");
  assert.equal(steam.storage.get("hidden"), undefined, "nothing said hidden");
});

test("a save shows the new one at once", async () => {
  await wait(10_000);
  steam.local[100].ACH_1 = Math.floor(Date.now() / 1000);
  vm.push(EVENTS, { state: "live", reason: null, events: [{ seq: 1, type: "stats.saved", at: Date.now(), data: { appid: 100 } }] });
  await settle(vm, steam);
  assert.equal(state.game.unlocked, 3);
  assert.ok("ACH_1" in state.fresh);
});

test("the minute keeps the game shown", async () => {
  await wait(60_000);
  await wait(60_000);
  assert.equal(state.phase, "game");
  assert.equal(state.game.unlocked, 3);
});

test("a game without local achievements: the game details are said hidden, as before", async () => {
  vm.push("game.subscribe", { steamAppId: 200, name: "Courier of Tides" });
  await settle(vm, steam);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
});

test("a game with nothing on this computer is not asked again each minute, but at its save", async () => {
  const asked = () => steam.localCalls.filter((call) => call.appid === 200).length;
  const before = asked();
  await wait(60_000);
  await wait(60_000);
  assert.equal(asked(), before, "not each minute");
  // Its first save: Steam wrote the file.
  steam.local[200] = { C_1: Math.floor(Date.now() / 1000) };
  vm.push("steam.events.subscribe", { state: "live", reason: null, events: [{ seq: 2, type: "stats.saved", at: Date.now(), data: { appid: 200 } }] });
  await settle(vm, steam);
  assert.ok(asked() > before, "read at its save");
  // Steam's summary again, never twice within 5 seconds: the game shows.
  await wait(5_000);
  assert.equal(state.phase, "game");
  assert.equal(state.game.appid, 200);
  assert.equal(state.game.unlocked, 1);
});

test("back to the game with local achievements: shown again", async () => {
  await wait(10_000);
  vm.push("game.subscribe", { steamAppId: 100, name: "Ashen Crown" });
  await settle(vm, steam);
  await wait(10_000);
  assert.equal(state.phase, "game");
  assert.equal(state.game.unlocked, 3);
});
