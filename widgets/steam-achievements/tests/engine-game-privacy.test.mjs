// A refusal (403) of the host's game while Steam's presence names none
// (Invisible, offline): the game details are hidden (Friends Only or
// Private, a setting of the whole account), unless the widget already has
// proof that they are public: a read of the achievements of any game, or a
// game Steam's presence named, for this account. With that proof, the game
// itself is not readable (not owned). The proof stays for this account; it
// falls with a refusal of a game of the recent list (hidden details) or
// another account.
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
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.games[300] = { name: "Borrowed Lantern", schema: achievementsOf(2, "L"), unlocked: {}, owned: false };
steam.recent = [200];
steam.playing = null;
// Friends Only: every game's achievements are refused, even to the key.
steam.details = "friends";
const GAME = "game.subscribe";
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push(GAME, { steamAppId: 100, name: "Ashen Crown" });
await settle(vm, steam);

async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}
async function hostGame(value) {
  vm.push(GAME, value);
  await settle(vm, steam);
}

test("no proof: a refusal says the game details are hidden", () => {
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
  assert.equal(steam.storage.get("publicDetails"), undefined);
});

test("with proof (a read of another game): the game is not readable", async () => {
  // The player makes the details public: a read succeeds and proves it.
  steam.details = "public";
  await wait(10_000);
  await hostGame({ steamAppId: 200, name: "Courier of Tides" });
  assert.equal(state.phase, "game");
  assert.equal(state.game.appid, 200);
  assert.equal(steam.storage.get("publicDetails"), ID, "kept for this account");
  await wait(10_000);
  await hostGame({ steamAppId: 300, name: "Borrowed Lantern" });
  assert.equal(state.phase, "game");
  assert.equal(state.game.appid, 300);
  assert.equal(state.game.readable, false, "not readable");
});
