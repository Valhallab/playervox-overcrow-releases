// "Game image" off: the widget shows the game as one without a store image
// (its icon, its name in text), and never downloads the image. On again,
// the image comes at once, without waiting for the next read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({
  now: Date.UTC(2026, 0, 1, 12),
  host: { messages: EN, grants: ["storage", "network", "account:steam"], options: { "show-cover": false } },
  accounts: { steam: "connected" },
});
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(12), unlocked: { ACH_1: 1767000000 } };
steam.recent = [100];
steam.playing = 100;
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);
const headers = () => steam.requests.filter((url) => url.endsWith("/header.jpg"));

test("on by default, after the achievements' options", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const ids = manifest.wrapper.menu.map((row) => row.id);
  assert.equal(ids.indexOf("show-cover") - 1, ids.indexOf("achievements"));
  assert.equal(ids.includes("show-logo"), false, "no Steam logo option");
  const row = manifest.wrapper.menu.find((entry) => entry.id === "show-cover");
  assert.deepEqual([row.type, row.default, row.label.en, row.label.fr], ["toggle", true, "Game image", "Image du jeu"]);
});

test("off: the game without its image, which is never downloaded", async () => {
  await minutes(vm, steam, 2);
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Ashen Crown");
  assert.deepEqual(headers(), [], "the store image is not asked");
  assert.equal(logic.hasHeader(state, state.optionsVersion), false);
  assert.equal(logic.gameSrc(state, state.optionsVersion), "");
  // The card is the progress alone: no banner, no capsule, icon or name.
  for (const layout of ["full", "standard", "compact"]) {
    vm.setHost({ options: { "show-cover": false, layout } });
    assert.equal(logic.banner(state, state.optionsVersion), false, layout);
    assert.equal(logic.gameHead(state, state.optionsVersion), false, layout);
  }
  vm.setHost({ options: { "show-cover": false } });
  await settle(vm, steam);
  assert.deepEqual(headers(), [], "still not asked");
});

test("on again: the image at once, without waiting for the next read", async () => {
  const reads = steam.count("GetPlayerSummaries");
  vm.setHost({ options: { "show-cover": true } });
  await settle(vm, steam);
  assert.equal(steam.count("GetPlayerSummaries"), reads, "no read of Steam");
  assert.equal(headers().length, 1);
  assert.equal(logic.hasHeader(state, state.optionsVersion), true);
  // Full: the image across the top, the name in it; Standard and Compact:
  // the capsule and the name.
  assert.deepEqual([logic.banner(state, state.optionsVersion), logic.gameHead(state, state.optionsVersion)], [true, false]);
  for (const layout of ["standard", "compact"]) {
    vm.setHost({ options: { "show-cover": true, layout } });
    assert.deepEqual([logic.banner(state, state.optionsVersion), logic.gameHead(state, state.optionsVersion)], [false, true], layout);
  }
  vm.setHost({ options: { "show-cover": true } });
});

test("off again: hidden at once, the loaded image kept for later", async () => {
  vm.setHost({ options: { "show-cover": false } });
  await settle(vm, steam);
  assert.equal(logic.hasHeader(state, state.optionsVersion), false);
  await minutes(vm, steam, 3);
  assert.equal(headers().length, 1, "never asked again");
});

test("no option set: the image shows", () => {
  vm.setHost({ options: {} });
  assert.equal(logic.showCover(0), true);
});
