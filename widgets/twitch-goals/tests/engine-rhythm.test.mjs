// The engine's rhythm: the channel once per connection, each route every 20
// seconds, no route whose data is hidden, nothing while hidden.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { fakeTwitch, goal, minutes, seconds, settle } from "./twitch-fake.mjs";

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

test("every 20 seconds: every shown route once, the channel never again", async () => {
  vm.advance(19_000);
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 1, 1, 1], "nothing before 20 seconds");
  vm.advance(1000);
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 2, 2, 2]);
  await seconds(vm, twitch, 40);
  assert.deepEqual(counts(), [1, 4, 4, 4]);
  await minutes(vm, twitch, 2);
  assert.deepEqual(counts(), [1, 10, 10, 10]);
});

test("a goal added on Twitch shows at the next read, within 20 seconds", async () => {
  twitch.goals = [goal("g2", { created_at: "2026-01-01T11:00:00Z" }), goal("g1")];
  await seconds(vm, twitch, 20);
  assert.deepEqual(state.goals.map((g) => g.id), ["g2", "g1"]);
  twitch.goals = [goal("g1")];
  await seconds(vm, twitch, 20);
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"], "an ended goal leaves as fast");
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 13, 13, 13]);
});

test("an option change reads nothing twice within a tick", async () => {
  vm.setHost({ options: { layout: "full" } });
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 13, 13, 13]);
});

test("routes follow the options: no follower or train read when hidden by them", async () => {
  vm.setHost({ options: { "show-hype": false } });
  await minutes(vm, twitch, 2);
  assert.deepEqual(counts(), [1, 19, 19, 13]);
  vm.setHost({ options: { "show-hype": false, "show-followers": false } });
  await minutes(vm, twitch, 1);
  assert.deepEqual(counts(), [1, 22, 22, 13], "the latest follower alone still reads the route");
  vm.setHost({ options: { "show-hype": false, "show-followers": false, "show-last-follower": false } });
  await minutes(vm, twitch, 1);
  assert.deepEqual(counts(), [1, 25, 22, 13]);
  // Shown again: read at once, within the rhythm.
  vm.setHost({ options: {} });
  await settle(vm, twitch);
  assert.deepEqual(counts(), [1, 25, 23, 14]);
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

test("shown again: read at once if the last read is more than 20 seconds old, then every 20 seconds from there", async () => {
  await seconds(vm, twitch, 60);
  const goals = () => twitch.count("/helix/goals");
  let last = goals();
  // Hidden 10 seconds after a read, shown 5 seconds later: nothing yet.
  vm.advance(10_000);
  vm.setHost({ visible: false });
  vm.advance(5_000);
  vm.setHost({ visible: true });
  await settle(vm, twitch);
  assert.equal(goals(), last, "read 15 seconds ago");
  await seconds(vm, twitch, 5);
  assert.equal(goals(), last + 1, "the tick 20 seconds after the last read");
  // Hidden 30 seconds: every route at once.
  last = goals();
  const before = twitch.requests.length;
  vm.setHost({ visible: false });
  vm.advance(30_000);
  vm.setHost({ visible: true });
  await settle(vm, twitch);
  assert.equal(goals(), last + 1, "read at once");
  assert.equal(twitch.requests.length, before + 3);
  // The next read comes 20 seconds after that one, not sooner.
  vm.advance(19_000);
  await settle(vm, twitch);
  assert.equal(goals(), last + 1);
  vm.advance(1000);
  await settle(vm, twitch);
  assert.equal(goals(), last + 2);
});

test("worst case: at most 9 requests a minute, 12,960 a day", async () => {
  const before = twitch.requests.length;
  await minutes(vm, twitch, 1440);
  assert.ok(twitch.requests.length - before <= 9 * 1440, `${twitch.requests.length - before}`);
});
