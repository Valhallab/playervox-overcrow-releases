// A new start shows the last values at once, never "Playing now" before a
// fresh read, and a first start with nothing says Steam is unreachable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.fail = { error: "timeout" };
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("first start without values and without Steam", () => {
  assert.equal(state.phase, "empty-unreachable");
});

test("nothing played: say how to start", async () => {
  steam.fail = null;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "nothing");
});

test("private game details without a known game", async () => {
  steam.recentHidden = true;
  await minutes(vm, steam, 11);
  assert.equal(state.phase, "hidden");
  assert.equal(state.hidden, "details");
});

test("without a game shown, Steam down says so, never 'Play a Steam game'", async () => {
  steam.recentHidden = false;
  await minutes(vm, steam, 11);
  assert.equal(state.phase, "nothing");
  steam.fail = { error: "transport_failed" };
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "empty-unreachable");
  steam.fail = null;
  await minutes(vm, steam, 1);
  assert.equal(state.phase, "nothing");
});
