// A new start shows the last game at once, as the last game played, until
// Steam answers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, fakeSteam, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "signed_out" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.storage.set("snapshot", { appid: 100, name: "Ashen Crown", icon: "", readAt: Date.UTC(2026, 0, 1, 11, 55), unlocked: { A: 1767000000 }, rarity: { A: 4.2, B: 30 }, noStats: false });
steam.storage.set("schemas", [{ key: "100:english", chunks: 1, at: 1 }]);
steam.storage.set("schema:100:english:0", JSON.stringify({ n: "Ashen Crown", l: [["A", "Crown of Ashes", "Win", 0, "", ""], ["B", "Deep Key", "Open", 0, "", ""]] }));
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("the last values at once, as the last game played", () => {
  assert.equal(steam.requests.length, 0, "Steam is not connected yet");
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Ashen Crown");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 2]);
  assert.equal(state.game.playing, false);
  assert.equal(logic.eyebrow(state), "Last game played");
  assert.equal(logic.latest(state).name, "Crown of Ashes");
  assert.equal(logic.rarity(logic.latest(state)), "4.2% of players");
});

test("unlocks made while the widget was closed are not New", async () => {
  // Steam now lists B, unlocked yesterday (on another computer), and C, just now.
  steam.games[100] = {
    name: "Ashen Crown",
    schema: [
      { name: "A", displayName: "Crown of Ashes", description: "Win", hidden: 0, icon: "", icongray: "" },
      { name: "B", displayName: "Deep Key", description: "Open", hidden: 0, icon: "", icongray: "" },
      { name: "C", displayName: "Ember", description: "Light", hidden: 0, icon: "", icongray: "" },
    ],
    unlocked: { A: 1767000000, B: Math.floor((vm.now - 24 * 3_600_000) / 1000), C: Math.floor(vm.now / 1000) },
  };
  steam.playing = 100;
  vm.setAccount("steam", "connected");
  await settle(vm, steam);
  assert.equal(state.fresh.B, undefined, "unlocked yesterday, elsewhere");
  assert.ok(state.fresh.C > vm.now, "unlocked now");
  // C is not in the stored list: the game was updated, its list is read again.
  const schemas = steam.count("GetSchemaForGame");
  vm.advance(60_000);
  await settle(vm, steam);
  assert.equal(steam.count("GetSchemaForGame"), schemas + 1);
  assert.deepEqual([state.game.unlocked, state.game.total], [3, 3]);
});
