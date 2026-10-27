// The button to Steam's privacy settings: shown where the widget says Steam
// hides the profile or the game details, in Interactive mode only; it opens
// the one declared page, and says what is missing when the page cannot open.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const PAGE = "https://steamcommunity.com/my/edit/settings";
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000 } };
steam.playing = 100;
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

/** A click on the button, answered by the host. */
async function click(answer) {
  steam.linkAnswer = answer;
  logic.openSettings();
  await settle(vm, steam);
}

test("a readable game: no button", () => {
  assert.equal(state.phase, "game");
  assert.equal(logic.settingsLink(state), false);
});

test("game details hidden: the button opens Steam's privacy settings", async () => {
  steam.details = "friends";
  steam.playing = null;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
  assert.equal(logic.settingsLink(state), true);
  await click(null);
  assert.deepEqual(steam.opened, [PAGE]);
  assert.equal(logic.linkNote(state), "");
  assert.equal(logic.settingsLink(state), true);
});

test("declined in the host's panel (cancelled), or one already open (busy): nothing to say", async () => {
  await click("cancelled");
  await click("busy");
  assert.equal(logic.linkNote(state), "");
  assert.equal(logic.settingsLink(state), true);
});

test("the browser did not open: said, the button stays to try again", async () => {
  await click("unavailable");
  assert.equal(logic.linkNote(state), "Your browser didn't open. Try again.");
  assert.equal(logic.settingsLink(state), true);
  await click(null);
  assert.equal(logic.linkNote(state), "", "a new click clears it");
});

test("Passive mode: no button, no note", async () => {
  await click("unavailable");
  vm.setHost({ mode: "passive" });
  await settle(vm, steam);
  assert.equal(logic.settingsLink(state), false);
  assert.equal(logic.linkNote(state), "");
  vm.setHost({ mode: "interactive" });
  await settle(vm, steam);
  await click(null);
});

test("profile hidden: the same button", async () => {
  steam.visible = 1;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "profile");
  assert.equal(logic.settingsLink(state), true);
  const before = steam.opened.length;
  await click(null);
  assert.deepEqual(steam.opened.slice(before), [PAGE]);
});

test("Open web pages not allowed: the button gives way to what to allow, and where", async () => {
  await click("permission_denied");
  assert.equal(logic.settingsLink(state), false);
  assert.equal(logic.linkNote(state), "Allow “Open web pages” in the Control Center.");
  assert.ok(logic.hiddenTip(state).endsWith(" Allow “Open web pages” in the Control Center."), "One line: in its tooltip");
});

test("public again: neither button nor note", async () => {
  steam.visible = 3;
  steam.details = "public";
  steam.playing = 100;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "game");
  assert.equal(logic.settingsLink(state), false);
  assert.equal(logic.linkNote(state), "");
});
