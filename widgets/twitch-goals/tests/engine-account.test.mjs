// The account: values kept through its states, read again at each
// connection, never the values of another account.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { OTHER, fakeTwitch, follower, goal, minutes, settle } from "./twitch-fake.mjs";

const NOW = Date.UTC(2026, 0, 1, 12);
const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: NOW, host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "connected" } });
const twitch = fakeTwitch();
twitch.goals = [goal("g1")];
twitch.followers = [follower("7", "Mira", NOW - 120_000)];
await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);

test("expired: nothing read, the values kept for the return", async () => {
  vm.setAccount("twitch", "expired");
  const before = twitch.requests.length;
  await minutes(vm, twitch, 3);
  assert.equal(twitch.requests.length, before);
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"]);
  vm.setAccount("twitch", "connected");
  // Shown at once, then read again with the channel.
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"]);
  await settle(vm, twitch);
  assert.equal(twitch.count("/helix/users"), 2);
  assert.equal(state.phase, "ready");
});

test("a new account drops the old values", async () => {
  vm.setAccount("twitch", "signed_out");
  twitch.user = OTHER;
  twitch.goals = [];
  twitch.total = 3;
  twitch.followers = [follower("9", "Zed", NOW)];
  await minutes(vm, twitch, 1);
  vm.setAccount("twitch", "connected");
  await settle(vm, twitch);
  assert.deepEqual(state.goals, []);
  assert.equal(state.followers.total, 3);
  assert.equal(state.newUntil, 0, "another account's follower is not new");
});

test("another account connected without a sign-out seen: the channel read again", async () => {
  twitch.user = "500000002";
  twitch.goals = [goal("g9", { broadcaster_id: "500000002" })];
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
  await minutes(vm, twitch, 1);
  assert.deepEqual(state.goals.map((g) => g.id), ["g9"]);
  assert.equal(state.stale, "");
});
