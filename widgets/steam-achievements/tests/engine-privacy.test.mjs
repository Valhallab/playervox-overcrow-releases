// What Steam hides: a private profile, game details that are not Public
// (Friends Only included), a game it names no stats for, and a borrowed game
// it reads. The widget says what it knows, never guesses a game.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000 } };
steam.games[200] = { name: "Rune Table", schema: achievementsOf(4), unlocked: {} };
steam.games[300] = { name: "Tidewater Run", schema: achievementsOf(3), unlocked: { ACH_1: 1767000000 } };
steam.playing = 100;
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("public: the running game", () => {
  assert.equal(state.phase, "game");
  assert.equal(logic.eyebrow(state), "Playing now");
});

test("game details Friends Only: said, no game guessed, asked again every 10 minutes", async () => {
  steam.details = "friends";
  // Another game runs: Steam no longer names it, and still lists the last one.
  steam.playing = 200;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
  assert.equal(logic.hiddenTitle(state), "Game details hidden");
  assert.equal(logic.hiddenBody(state), "Steam hides your game details. Set them to Public (Friends Only is not enough).");
  assert.equal(logic.hiddenPath(state), "In Steam: Profile › Edit Profile › Privacy Settings");
  assert.equal(logic.hiddenSetting(state), "Game details: Public");
  assert.equal(state.stale, "", "a setting, not a failure");
  assert.equal(steam.storage.get("hidden"), "details");
  const asked = steam.count("GetPlayerAchievements");
  await minutes(vm, steam, 8);
  assert.equal(steam.count("GetPlayerAchievements"), asked, "no loop");
  assert.equal(state.phase, "hidden");
  await minutes(vm, steam, 2);
  assert.equal(steam.count("GetPlayerAchievements"), asked + 1);
  assert.equal(state.phase, "hidden");
});

test("private game details: the same", async () => {
  steam.details = "private";
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
});

test("Public again: the running game at the next read", async () => {
  steam.details = "public";
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Rune Table");
  assert.equal(logic.eyebrow(state), "Playing now");
  assert.equal(steam.storage.has("hidden"), false);
});

test("private profile: said, nothing else asked", async () => {
  steam.visible = 1;
  const before = steam.requests.length;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "profile");
  assert.equal(logic.hiddenTitle(state), "Profile hidden");
  assert.equal(logic.hiddenBody(state), "Steam hides your profile. Set it to Public, and your game details too.");
  assert.equal(logic.hiddenSetting(state), "My profile and Game details: Public");
  assert.deepEqual(steam.requests.slice(before).map((url) => new URL(url).pathname), ["/ISteamUser/GetPlayerSummaries/v2/"]);
  steam.visible = 3;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(logic.eyebrow(state), "Playing now");
});

test("the running game is not the player's (403 with public details): a neutral line, no guess, asked again every 10 minutes", async () => {
  steam.games[200].owned = false;
  vm.advance(10 * 60_000);
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(state.game.readable, false);
  assert.equal(state.game.total, 4, "the schema lists achievements: never 'no achievements'");
  assert.equal(logic.hasAch(state.game), false);
  assert.equal(logic.muted(state.game), "Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile.");
  assert.doesNotMatch(logic.muted(state.game), /borrow/i);
  assert.equal(state.stale, "");
  const asked = steam.count("GetPlayerAchievements");
  await minutes(vm, steam, 8);
  assert.equal(steam.count("GetPlayerAchievements"), asked);
  delete steam.games[200].owned;
  await minutes(vm, steam, 2);
  assert.equal(state.game.readable, true);
  assert.equal(logic.hasAch(state.game), true);
});

test("no stats although the game lists achievements (400): the same neutral line, never 'no achievements'", async () => {
  steam.games[200].noStats = true;
  vm.advance(10 * 60_000);
  await minutes(vm, steam, 1);
  assert.equal(state.game.readable, false);
  assert.equal(logic.muted(state.game), "Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile.");
  assert.equal(state.stale, "");
  delete steam.games[200].noStats;
  vm.advance(10 * 60_000);
  await minutes(vm, steam, 1);
  assert.equal(state.game.readable, true);
});

test("success:false in a 200 is a refusal, not a server failure", async () => {
  steam.games[200].answer = { status: 200, body: { playerstats: { steamID: ID, gameName: "Rune Table", success: false } } };
  vm.advance(10 * 60_000);
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "");
  assert.equal(state.game.readable, false);
  const summaries = steam.count("GetPlayerSummaries");
  await minutes(vm, steam, 3);
  assert.equal(steam.count("GetPlayerSummaries"), summaries + 3, "no backoff");
  assert.equal(state.stale, "");
  delete steam.games[200].answer;
});

test("a borrowed game Steam reads: shown as usual, though not in the recent games", async () => {
  steam.playing = 300;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Tidewater Run");
  assert.equal(logic.eyebrow(state), "Playing now");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 3]);
  assert.equal(state.game.readable, true);
});

test("a game without achievements: said, the achievements never asked", async () => {
  steam.games[400] = { name: "Neon Courier", schema: [], unlocked: {} };
  steam.playing = 400;
  const asked = steam.count("GetPlayerAchievements");
  await minutes(vm, steam, 1);
  assert.equal(state.game.name, "Neon Courier");
  assert.equal(logic.muted(state.game), "This game has no Steam achievements.");
  assert.equal(steam.count("GetPlayerAchievements"), asked);
});
