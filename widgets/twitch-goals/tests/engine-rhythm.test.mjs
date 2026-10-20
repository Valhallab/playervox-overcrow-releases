// The engine's rhythm: the channel once per connection, each route at most
// once per tick, no route whose data is hidden, nothing while hidden.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { fakeTwitch, goal, minutes, settle } from "./twitch-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "connected" } });
const twitch = fakeTwitch();
twitch.goals = [goal("g1")];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);
const counts = () => ["/helix/users", "/helix/goals", "/helix/channels/followers", "/helix/hypetrain/status"].map((p) => twitch.count(p));

test("the first read: the channel, then goals, followers and Hype Train", () => {
  assert.deepEqual(counts(), [1, 1, 1, 1]);
  assert.equal(state.phase, "ready");
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"]);
  assert.equal(state.followers.total, 1284);
  assert.ok(twitch.requests.every((url) => url.startsWith("https://api.twitch.tv/helix/")));
  assert.ok(twitch.requests.some((url) => url.endsWith("/helix/channels/followers?broadcaster_id=141981764&first=1")));
});

test("each minute: every shown route once, the channel never again", async () => {
  await minutes(vm, twitch, 3);
  assert.deepEqual(counts(), [1, 4, 4, 4]);
});

test("an option change reads nothing twice within a tick", async () => {
  vm.setHost({ options: { layout: "full" } });
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 4, 4, 4]);
});

test("routes follow the options: no follower or train read when hidden by them", async () => {
  vm.setHost({ options: { "show-hype": false } });
  await minutes(vm, twitch, 2);
  assert.deepEqual(counts(), [1, 6, 6, 4]);
  vm.setHost({ options: { "show-hype": false, "show-followers": false } });
  await minutes(vm, twitch, 1);
  assert.deepEqual(counts(), [1, 7, 7, 4], "the latest follower alone still reads the route");
  vm.setHost({ options: { "show-hype": false, "show-followers": false, "show-last-follower": false } });
  await minutes(vm, twitch, 1);
  assert.deepEqual(counts(), [1, 8, 7, 4]);
  // Shown again: read at once, within the rhythm.
  vm.setHost({ options: {} });
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 8, 8, 5]);
});

test("no route is called when nothing is shown", async () => {
  const off = { "goal-subs": false, "goal-followers": false, "goal-bits": false, "goal-cheerers": false, "show-followers": false, "show-last-follower": false, "show-hype": false };
  vm.setHost({ options: off });
  const before = twitch.requests.length;
  await minutes(vm, twitch, 5);
  assert.equal(twitch.requests.length, before);
  assert.equal(logic.nothingShown(state, state.optionsVersion), true);
  vm.setHost({ options: { ...off, layout: "line" } });
  assert.equal(logic.nothingShown(state, state.optionsVersion), true);
  vm.setHost({ options: {} });
  await settle(vm, twitch);
  assert.equal(logic.nothingShown(state, state.optionsVersion), false);
});

test("hidden: nothing is read; shown again: one read at once", async () => {
  await minutes(vm, twitch, 1);
  vm.setHost({ visible: false });
  const before = twitch.requests.length;
  await minutes(vm, twitch, 4);
  assert.equal(twitch.requests.length, before);
  vm.setHost({ visible: true });
  await settle(vm, twitch);
  assert.equal(twitch.requests.length, before + 3);
});

test("worst case: at most 3 requests a minute, 4,320 a day", async () => {
  const before = twitch.requests.length;
  await minutes(vm, twitch, 1440);
  assert.ok(twitch.requests.length - before <= 3 * 1440, `${twitch.requests.length - before}`);
});
