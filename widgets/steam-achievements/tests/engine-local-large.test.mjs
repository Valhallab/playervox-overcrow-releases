// A game of thousands of achievements: the local achievements come in pages
// of 4,096, newest first. The game's first read takes every page, one after
// the other; a save, only the first, where the new ones are. Never a
// refusal for the size.
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
const COUNT = 5000;
steam.games[100] = { name: "Endless Tower", schema: achievementsOf(COUNT), unlocked: {} };
// Every one unlocked here but the last, which Steam does not publish yet.
steam.local = { 100: Object.fromEntries(Array.from({ length: COUNT - 1 }, (_, n) => [`ACH_${n}`, 1767000000 + n])) };
steam.recent = [100];
steam.playing = null;
steam.details = "friends";
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push("game.subscribe", { steamAppId: 100, name: "Endless Tower" });
await settle(vm, steam);
// A large list is read in slices, a pause after each.
for (let round = 0; round < 1200 && state.phase !== "game"; round += 1) {
  vm.advance(100);
  await settle(vm, steam);
}

test("the first read takes every page, one after the other", () => {
  assert.equal(state.phase, "game");
  assert.deepEqual(steam.localCalls.map((call) => call.offset ?? 0), [0, 4096]);
  assert.equal(state.game.total, COUNT);
  assert.equal(state.game.unlocked, COUNT - 1);
});

test("a save reads the first page only", async () => {
  vm.advance(10_000);
  await settle(vm, steam);
  const calls = steam.localCalls.length;
  steam.local[100][`ACH_${COUNT - 1}`] = Math.floor(Date.now() / 1000);
  vm.push("steam.events.subscribe", { state: "live", reason: null, events: [{ seq: 1, type: "stats.saved", at: Date.now(), data: { appid: 100 } }] });
  await settle(vm, steam);
  assert.deepEqual(steam.localCalls.slice(calls).map((call) => call.offset ?? 0), [0]);
  assert.equal(state.game.unlocked, COUNT);
  assert.ok(`ACH_${COUNT - 1}` in state.fresh);
});
