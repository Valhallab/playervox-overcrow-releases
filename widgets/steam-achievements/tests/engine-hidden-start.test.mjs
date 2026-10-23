// A new start after Steam hid the game details: said at once, never the
// last game, which may not be the one running; then read again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "signed_out" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.storage.set("snapshot", { appid: 100, name: "Ashen Crown", icon: "", readAt: Date.UTC(2026, 0, 1, 11, 55), unlocked: {}, rarity: null });
steam.storage.set("schemas", [{ key: "100:english", chunks: 1, at: 1 }]);
steam.storage.set("schema:100:english:0", JSON.stringify({ n: "Ashen Crown", l: [["A", "Crown of Ashes", "Win", 0, "", ""]] }));
steam.storage.set("hidden", "details");
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(2), unlocked: {} };
steam.details = "friends";
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("said at once, before Steam is even connected", () => {
  assert.equal(steam.requests.length, 0);
  assert.equal(state.phase, "hidden");
  assert.equal(logic.hiddenTitle(state), "Game details hidden");
});

test("still hidden: still said", async () => {
  vm.setAccount("steam", "connected");
  await settle(vm, steam);
  assert.equal(state.phase, "hidden");
});

test("Public now, in game: the game", async () => {
  steam.details = "public";
  steam.playing = 100;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(logic.eyebrow(state), "Playing now");
  assert.equal(steam.storage.has("hidden"), false);
});
