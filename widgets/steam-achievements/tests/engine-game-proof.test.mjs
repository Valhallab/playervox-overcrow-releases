// The proof that the game details are public stays in storage for the
// account. A refusal of a game of Steam's recent list (no game from the
// host: an older PlayerVox OverCrow, or none since the start) makes it
// fall: the host's game refused then says the details are hidden.
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
// Proven public by an earlier run; Friends Only since.
steam.storage.set("publicDetails", ID);
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.games[300] = { name: "Borrowed Lantern", schema: achievementsOf(2, "L"), unlocked: {}, owned: false };
steam.recent = [200];
steam.playing = null;
steam.details = "friends";
const GAME = "game.subscribe";
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push(GAME, null);
await settle(vm, steam);

test("a refusal of a game of the recent list: the proof falls, hidden", () => {
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
  assert.equal(steam.storage.get("publicDetails"), undefined, "the proof fell");
});

test("then the host's game refused: hidden details, not 'not readable'", async () => {
  vm.advance(10_000);
  vm.push(GAME, { steamAppId: 300, name: "Borrowed Lantern" });
  await settle(vm, steam);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
});
