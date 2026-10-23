// The profile step, "Change Steam profile…", tracking an achievement and
// images with their fallbacks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"], options: { layout: "full" } }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(6), unlocked: { ACH_0: 1767000000 } };
steam.playing = 100;
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("without a profile: the last step, and nothing read", () => {
  assert.equal(state.phase, "profile");
  assert.equal(state.profile.canCancel, false);
  assert.equal(steam.requests.length, 0);
});

test("a link that is not a profile, then a name Steam does not know", async () => {
  logic.profileTyped("https://store.steampowered.com/app/10");
  await logic.submitProfile();
  assert.equal(state.profile.status, "invalid");
  assert.equal(logic.profileMessage(state, false), "This is not a Steam profile link. Example: steamcommunity.com/id/yourname");
  assert.equal(steam.requests.length, 0, "refused before any request");
  logic.profileTyped("steamcommunity.com/id/nobody_here");
  const submitted = logic.submitProfile();
  await settle(vm, steam);
  await submitted;
  assert.equal(state.profile.status, "notfound");
  assert.equal(logic.profileMessage(state, false), "No Steam profile at this link. Check it and try again.");
});

test("a custom name resolves, is kept, and the achievements show", async () => {
  logic.profileTyped("https://steamcommunity.com/id/Nova_Player/");
  const vanity = steam.count("ResolveVanityURL");
  const summaries = steam.count("GetPlayerSummaries");
  const submitted = logic.submitProfile();
  // Enter twice: one request.
  void logic.submitProfile();
  await settle(vm, steam);
  await submitted;
  await settle(vm, steam);
  assert.deepEqual(steam.storage.get("profile"), { steamid: ID, input: "https://steamcommunity.com/id/Nova_Player/" });
  assert.equal(state.phase, "game");
  assert.equal(state.game.name, "Ashen Crown");
  assert.equal(steam.count("ResolveVanityURL"), vanity + 1);
  assert.equal(steam.count("GetPlayerSummaries"), summaries + 1, "the profile's check is the first read");
});

test("Change Steam profile… opens the step with the link, Cancel goes back", async () => {
  vm.menu("change-profile");
  assert.equal(state.phase, "profile");
  assert.equal(state.profile.value, "https://steamcommunity.com/id/Nova_Player/");
  assert.equal(state.profile.canCancel, true);
  const before = steam.requests.length;
  await minutes(vm, steam, 2);
  assert.equal(steam.requests.length, before, "no read while the step is open");
  logic.cancelProfile();
  assert.equal(state.phase, "game");
});

test("Track an achievement…: the picker, the tracked card, Stop tracking", async () => {
  vm.menu("track");
  assert.equal(state.picking, true);
  const list = logic.pickList(state);
  assert.ok(list.every((a) => !a.achieved));
  logic.pick("ACH_3");
  assert.equal(state.picking, false);
  await settle(vm, steam);
  assert.deepEqual(steam.storage.get("tracked"), { appid: 100, api: "ACH_3" });
  assert.equal(logic.tracked(state).id, "ACH_3");
  assert.equal(logic.featured(state, 0).id, "ACH_3");
  steam.games[100].unlocked.ACH_3 = 1767400000;
  await minutes(vm, steam, 1);
  assert.equal(logic.cardClass(logic.tracked(state), state), "feature tracked done");
  assert.match(logic.featureMeta(logic.tracked(state), state), /^Unlocked /);
  vm.menu("track");
  logic.pick("");
  assert.equal(logic.tracked(state), null);
});

test("Passive mode closes the picker", () => {
  vm.menu("track");
  vm.setHost({ mode: "passive" });
  assert.equal(state.picking, false);
  vm.setHost({ mode: "interactive" });
});

test("images: declared hosts, a failure not asked again for an hour", async () => {
  await minutes(vm, steam, 1);
  const header = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/100/header.jpg";
  assert.ok(steam.requests.includes(header));
  assert.ok(steam.requests.every((url) => !url.includes("akamaihd.net") && !url.includes("media.steampowered")));
  assert.ok(logic.gameSrc(state) !== "");
  // The shared host fails: the next host, then the icon.
  steam.images.fail.add(header);
  delete state.images[header];
  state.images = { ...state.images };
  await minutes(vm, steam, 1);
  const fallback = "https://cdn.akamai.steamstatic.com/steam/apps/100/header.jpg";
  assert.equal(state.game.header, fallback);
  const asked = steam.count(header);
  await minutes(vm, steam, 30);
  assert.equal(steam.count(header), asked, "not asked again within the hour");
  assert.equal(typeof logic.achSrc(logic.achievements()[0], state.images), "string");
  // A recent game: no header on either host, the game's icon instead.
  steam.images.fail.add(fallback);
  delete state.images[fallback];
  state.images = { ...state.images };
  state.game = { ...state.game, header: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/100/none.jpg" };
  await minutes(vm, steam, 1);
  assert.equal(state.game.header, "");
  assert.equal(logic.hasHeader(state), false);
  assert.equal(state.game.icon, `https://shared.akamai.steamstatic.com/community_assets/images/apps/100/${"e".repeat(40)}.jpg`);
  assert.ok(logic.iconSrc(state) !== "", "the game's icon shows");
  // Icons on the one path that serves every game.
  const icons = steam.requests.filter((url) => url.endsWith(".jpg") && !url.includes("header"));
  assert.ok(icons.length > 0 && icons.every((url) => url.startsWith("https://shared.akamai.steamstatic.com/community_assets/images/apps/")), icons.join(" "));
});

test("another language: its names are read at once, not a minute later", async () => {
  const FR = JSON.parse(readFileSync(new URL("../locales/fr.json", import.meta.url), "utf8"));
  const before = steam.count("l=french");
  vm.setHost({ locale: "fr", messages: FR });
  await settle(vm, steam);
  assert.equal(steam.count("l=french"), before + 1);
  assert.match(logic.achievements()[0].name, /\(fr\)$/);
  vm.setHost({ locale: "en", messages: EN });
  await settle(vm, steam);
});
