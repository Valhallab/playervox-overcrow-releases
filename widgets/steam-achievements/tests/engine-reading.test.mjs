// The engine on a synthetic Steam: rhythm, states, new unlocks, game
// switches, the stored schema and the worst-case number of calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const START = Date.UTC(2026, 0, 1, 12);
const vm = installRuntime({ now: START, host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "signed_out" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000, ACH_1: 1767100000 } };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: { C_0: 1767200000 } };
steam.games[300] = { name: "Tidewater", schema: [], unlocked: {} };
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("nothing is read until Steam is connected, then at once", async () => {
  assert.equal(steam.requests.length, 0);
  steam.playing = 100;
  vm.setAccount("steam", "connected");
  await settle(vm, steam);
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Ashen Crown");
  assert.equal(state.game.playing, true);
  assert.deepEqual([state.game.unlocked, state.game.total], [2, 5]);
  assert.equal(steam.count("GetPlayerSummaries"), 1);
  assert.equal(steam.count("GetSchemaForGame"), 1);
  assert.equal(steam.count("GetPlayerAchievements"), 1);
  assert.equal(steam.count("GetGlobalAchievementPercentages"), 1);
  assert.equal(logic.achievements().find((a) => a.id === "ACH_1").rarity, 49);
});

test("never two requests of one route within a minute", async () => {
  await logic.refresh();
  await settle(vm, steam);
  vm.setHost({ visible: false });
  vm.setHost({ visible: true });
  await settle(vm, steam);
  assert.equal(steam.count("GetPlayerSummaries"), 1);
  await minutes(vm, steam, 1);
  assert.equal(steam.count("GetPlayerSummaries"), 2);
  assert.equal(steam.count("GetPlayerAchievements"), 2, "each minute in game");
  assert.equal(steam.count("GetSchemaForGame"), 1, "once per game and language");
  assert.equal(steam.count("GetGlobalAchievementPercentages"), 1, "once a day");
});

test("each route every minute in game, even when Steam takes its time to answer", async () => {
  const summaries = steam.count("GetPlayerSummaries");
  const achievements = steam.count("GetPlayerAchievements");
  await minutes(vm, steam, 5, { delay: 700 });
  assert.equal(steam.count("GetPlayerSummaries") - summaries, 5);
  assert.equal(steam.count("GetPlayerAchievements") - achievements, 5);
});

test("hidden, nothing is called; shown again, one read", async () => {
  const before = steam.requests.length;
  const summaries = steam.count("GetPlayerSummaries");
  vm.setHost({ visible: false });
  await minutes(vm, steam, 5);
  assert.equal(steam.requests.length, before);
  vm.setHost({ visible: true });
  await settle(vm, steam);
  assert.equal(steam.count("GetPlayerSummaries"), summaries + 1);
});

test("a new unlock is New for 60 s, and only then", async () => {
  steam.games[100].unlocked.ACH_2 = Math.floor(vm.now / 1000);
  // The read on return (previous test) holds the routes for a minute.
  await minutes(vm, steam, 2);
  assert.equal(state.game.unlocked, 3);
  const fresh = logic.achievements().find((a) => a.id === "ACH_2");
  assert.equal(logic.isNew(fresh, state), true);
  assert.equal(logic.cardClass(fresh, state), "feature new");
  assert.equal(logic.isNew(logic.achievements().find((a) => a.id === "ACH_0"), state), false);
  vm.advance(60_000);
  await settle(vm, steam);
  assert.equal(logic.isNew(fresh, state), false);
});

test("out of game: last game played, read when the game stops, then every 10 minutes", async () => {
  const before = steam.count("GetPlayerAchievements");
  steam.playing = null;
  await minutes(vm, steam, 1);
  assert.equal(state.game.playing, false);
  assert.equal(logic.eyebrow(state), "Last game played");
  assert.equal(logic.eyebrowClass(state), "eyebrow");
  // The last unlocks at once, then ten minutes later, not before.
  const achievements = steam.count("GetPlayerAchievements");
  assert.equal(achievements, before + 1);
  await minutes(vm, steam, 9);
  assert.equal(steam.count("GetPlayerAchievements"), achievements);
  await minutes(vm, steam, 1);
  assert.equal(steam.count("GetPlayerAchievements"), achievements + 1);
  await minutes(vm, steam, 9);
  assert.equal(steam.count("GetPlayerAchievements"), achievements + 1);
});

test("a game switch never mixes two games", async () => {
  steam.playing = 200;
  steam.recent = [200, 100];
  await minutes(vm, steam, 1);
  assert.equal(state.game.name, "Courier of Tides");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 3]);
  assert.ok(logic.achievements().every((a) => a.id.startsWith("C_")));
  assert.equal(logic.anyNew(state), false, "the first read of a game marks nothing new");
});

test("a switch in game shows the new game's figures at once, never 0 / N", async () => {
  steam.playing = 100;
  await minutes(vm, steam, 2);
  assert.equal(state.game.name, "Ashen Crown");
  steam.playing = 200;
  await minutes(vm, steam, 1);
  assert.equal(state.game.name, "Courier of Tides");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 3]);
});

test("a switch whose list fails says it is reading, not that the game has none", async () => {
  steam.games[400] = { name: "Gloom Harbor", schema: [{ name: "G_0", displayName: "G", description: "", hidden: 0, icon: "", icongray: "" }], unlocked: {} };
  steam.playing = 400;
  steam.routeStatus["GetSchemaForGame"] = 503;
  await minutes(vm, steam, 1);
  assert.equal(state.game.name, "Gloom Harbor");
  assert.notEqual(logic.muted(state.game), "This game has no Steam achievements.");
  assert.equal(logic.muted(state.game), "Reading your achievements…");
  delete steam.routeStatus["GetSchemaForGame"];
  await minutes(vm, steam, 2);
  assert.deepEqual([state.game.unlocked, state.game.total], [0, 1]);
  steam.playing = 200;
  await minutes(vm, steam, 1);
});

test("a game without achievements says so and never reads them", async () => {
  steam.playing = 300;
  const before = steam.count("GetPlayerAchievements");
  await minutes(vm, steam, 2);
  assert.equal(state.game.name, "Tidewater");
  assert.equal(logic.hasAch(state.game), false);
  assert.equal(logic.muted(state.game), "This game has no Steam achievements.");
  assert.equal(steam.count("GetPlayerAchievements"), before);
});

test("the schema is kept for later games, in storage", async () => {
  const keys = [...steam.storage.keys()].filter((key) => key.startsWith("schema"));
  assert.ok(keys.includes("schemas"));
  // Small lists all fit the storage budget.
  const index = steam.storage.get("schemas").map((entry) => entry.key).sort();
  assert.deepEqual(index, ["100:english", "200:english", "300:english", "400:english"]);
  steam.playing = 100;
  const before = steam.count("GetSchemaForGame");
  await minutes(vm, steam, 1);
  assert.equal(steam.count("GetSchemaForGame"), before, "out of memory, read back from storage");
  assert.ok(steam.storage.get("snapshot").appid === 100);
});

test("worst case in game: about 2 880 calls a day", async () => {
  const before = steam.requests.filter((url) => url.startsWith("https://api.steampowered.com")).length;
  await minutes(vm, steam, 24 * 60);
  const api = steam.requests.filter((url) => url.startsWith("https://api.steampowered.com")).length - before;
  assert.ok(api <= 2 * 24 * 60 + 2, `${api} calls`);
  assert.ok(api >= 2 * 24 * 60 - 2, `${api} calls`);
});
