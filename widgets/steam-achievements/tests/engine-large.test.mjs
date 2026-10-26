// Games of thousands of achievements, with the manifest's response bounds
// applied as the host does: the count shows before the names, a list
// beyond the schema's bound comes from the player's achievements instead,
// and the checklist goes through the whole list. Never a refusal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, MANIFEST_BOUNDS, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "signed_out" } });
const steam = fakeSteam();
steam.bounds = MANIFEST_BOUNDS;
steam.storage.set("profile", { steamid: ID, input: ID });
const unlockedOf = (count, every) => Object.fromEntries(Array.from({ length: count }, (_, n) => n).filter((n) => n % every === 0).map((n) => [`ACH_${n}`, 1767000000 + n]));
// Within Steam's cap of 5,000: the schema fits its bound.
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5000), unlocked: unlockedOf(5000, 4) };
// A game from before the cap: its schema exceeds every bound.
steam.games[200] = { name: "Endless Archive", schema: achievementsOf(12000), unlocked: unlockedOf(12000, 3) };
steam.recent = [100];
steam.playing = 100;
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

/** Lets the sliced reads finish: one slice every 100 ms. */
async function slices(seconds = 120) {
  for (let i = 0; i < seconds * 10; i += 1) {
    vm.advance(100);
    await settle(vm, steam);
  }
}

test("the manifest's bounds are the fake's", () => {
  const rule = (path) => manifest.permissions.network.filter((entry) => entry.path.endsWith(path));
  assert.equal(rule("/GetSchemaForGame/v2/")[0].maxResponseBytes, MANIFEST_BOUNDS.schema);
  // One rule per route: `l` optional, the same bound with or without it.
  const player = rule("/GetPlayerAchievements/v1/");
  assert.equal(player.length, 1);
  assert.equal(player[0].maxResponseBytes, MANIFEST_BOUNDS.player);
  assert.equal(player[0].maxResponseBytes, MANIFEST_BOUNDS["player:l"]);
  assert.equal(player[0].queryParams.l.required, undefined);
  assert.equal(rule("/GetGlobalAchievementPercentagesForApp/v2/")[0].maxResponseBytes, MANIFEST_BOUNDS.rarity);
});

test("5,000 achievements: the count shows within seconds, the names once the list is read", async () => {
  vm.setAccount("steam", "connected");
  await settle(vm, steam);
  // The player's achievements (a quarter of a megabyte) take a few slices,
  // the list (1.6 MB here, up to 3 MiB) about ten times more.
  await slices(3);
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Ashen Crown");
  assert.deepEqual([state.game.unlocked, state.game.total], [1250, 5000]);
  assert.equal(logic.hasAch(state.game), true, "the bar before the names");
  assert.equal(state.game.known, false);
  await slices();
  assert.equal(state.game.known, true);
  assert.deepEqual([state.game.unlocked, state.game.total], [1250, 5000]);
  assert.equal(logic.latest(state).name, "Achievement 4996");
  assert.equal(logic.achievements().at(-1).hidden, true, "the schema's list, which says the hidden ones");
  assert.equal(steam.count("GetSchemaForGame"), 1);
  assert.equal(state.stale, "");
});

test("the checklist: 50 more at a time up to 200, a search for the others", async () => {
  logic.openPick();
  assert.equal(state.picking, true);
  assert.equal(state.pickSearch, true, "more than a page missing");
  assert.equal(logic.pickList(state).length, 50);
  assert.equal(logic.pickMore(state), true);
  assert.equal(logic.pickMoreText(state), "50 more");
  logic.showMorePicks();
  assert.equal(logic.pickList(state).length, 100);
  // The rows already shown keep their place.
  const first = logic.pickList(state).slice(0, 100).map((a) => a.id);
  logic.showMorePicks();
  assert.deepEqual(logic.pickList(state).slice(0, 100).map((a) => a.id), first);
  for (let i = 0; i < 10; i += 1) logic.showMorePicks();
  assert.equal(logic.pickList(state).length, 200, "the view's bound");
  assert.equal(logic.pickMore(state), false);
  assert.equal(state.pickCapped, true);
  // Accents and case aside; a hidden achievement never by its name.
  logic.pickTyped("ACHIEVEMENT 123");
  assert.deepEqual(logic.pickList(state).map((a) => a.name).sort(), ["Achievement 123", "Achievement 1230", "Achievement 1231", "Achievement 1233", "Achievement 1234", "Achievement 1235", "Achievement 1237", "Achievement 1238", "Achievement 1239"]);
  assert.equal(logic.pickList(state).length, 9);
  assert.equal(state.pickCapped, false);
  logic.pickTyped("4999");
  assert.equal(logic.pickNone(state), true, "the hidden one is not found by its name");
  logic.pickTyped("");
  assert.equal(logic.pickList(state).length, 50);
  logic.closePick();
  logic.openPick();
  assert.equal(state.pickQuery, "");
  assert.equal(logic.pickList(state).length, 50, "opened again: 50");
  logic.closePick();
});

test("12,000 achievements: the names come from the player's achievements, never a refusal", async () => {
  steam.playing = 200;
  await minutes(vm, steam, 1);
  // The count first, from the player's achievements without names.
  await slices(8);
  assert.equal(state.game.name, "Endless Archive");
  assert.deepEqual([state.game.unlocked, state.game.total], [4000, 12000]);
  await slices();
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Endless Archive");
  assert.equal(state.game.known, true);
  assert.deepEqual([state.game.unlocked, state.game.total], [4000, 12000]);
  assert.equal(logic.latest(state).name, "Achievement 11997");
  assert.equal(logic.latest(state).icon, "", "the generic icon");
  assert.equal(logic.achievements().at(-1).hidden, false, "Steam does not say the hidden ones here");
  assert.equal(state.stale, "");
  assert.equal(steam.count("GetSchemaForGame"), 2);
  assert.equal(steam.requests.filter((url) => url.includes("GetPlayerAchievements") && url.includes("&l=")).length, 1);
});

test("then each minute the small read only: no list asked again", async () => {
  const schemas = steam.count("GetSchemaForGame");
  const named = () => steam.requests.filter((url) => url.includes("GetPlayerAchievements") && url.includes("&l=")).length;
  const before = named();
  steam.games[200].unlocked.ACH_1 = Math.floor(Date.now() / 1000);
  await slices(30 * 60);
  assert.equal(steam.count("GetSchemaForGame"), schemas);
  assert.equal(named(), before);
  assert.deepEqual([state.game.unlocked, state.game.total], [4001, 12000]);
  assert.equal(state.stale, "");
});
