// Live events (`twitch.events`): what they put on screen at once, and the
// reads they spare. Live, a route the events keep current is not read; it
// is read once each time the events are live again or one was missed (a
// gap in `seq`), and the followers' total after a follow. Off, every route
// is read every 20 seconds as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { NOVA, fakeTwitch, follower, goal, seconds, settle } from "./twitch-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 0, 1, 12);
const vm = installRuntime({ now: NOW, host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "connected" } });
const twitch = fakeTwitch();
twitch.goals = [goal("g1")];
await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);
const counts = () => ["/helix/users", "/helix/goals", "/helix/channels/followers", "/helix/hypetrain/status"].map((p) => twitch.count(p));
const EVENTS = "twitch.events.subscribe";

/** The events' update: `state`, then the window of events. */
let window = [];
async function push(status, events = []) {
  window = [...window, ...events].slice(-16);
  vm.push(EVENTS, { state: status, reason: status === "live" ? null : "unavailable", events: window });
  await settle(vm, twitch);
}
let seq = 0;
function event(type, data) {
  seq += 1;
  return { seq, type, at: Date.now(), data };
}
function goalEvent(id, current, startedAt = "2026-01-01T09:00:00Z") {
  return {
    id, broadcaster_user_id: NOVA, broadcaster_user_login: "novalive", broadcaster_user_name: "NovaLive",
    type: "follower", description: "Road to 1,300", current_amount: current, target_amount: 50,
    started_at: startedAt, is_achieved: null, ended_at: null,
  };
}

test("the widget asks the events its manifest lists", () => {
  const subscription = vm.subscriptions.find((entry) => entry.service === EVENTS);
  assert.ok(subscription, "subscribed");
  assert.deepEqual(subscription.params, {});
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions.accounts[0].events, [
    "channel.goal.begin", "channel.goal.progress", "channel.goal.end", "channel.follow",
    "channel.hype_train.begin", "channel.hype_train.progress", "channel.hype_train.end",
  ]);
  assert.deepEqual(counts(), [1, 1, 1, 1]);
});

test("live: every route once to catch up, then none while the events keep them current", async () => {
  await push("live");
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 2, 2, 2], "the catch-up");
  await seconds(vm, twitch, 120);
  assert.deepEqual(counts(), [1, 2, 2, 2], "nothing more");
});

test("a goal's events show at once, without a request", async () => {
  await push("live", [event("channel.goal.progress", goalEvent("g1", 45))]);
  assert.equal(state.goals.find((g) => g.id === "g1").current, 45);
  await push("live", [event("channel.goal.begin", goalEvent("g2", 0, "2026-01-01T11:00:00Z"))]);
  assert.deepEqual(state.goals.map((g) => g.id), ["g2", "g1"], "a new goal first");
  await push("live", [event("channel.goal.end", { ...goalEvent("g2", 3, "2026-01-01T11:00:00Z"), is_achieved: false })]);
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"], "an ended goal leaves");
  assert.deepEqual(counts(), [1, 2, 2, 2]);
});

test("an event already handled is not applied again", async () => {
  const before = state.goals.find((g) => g.id === "g1").current;
  // The same window again, as a coalesced update repeats it.
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, twitch);
  assert.equal(state.goals.find((g) => g.id === "g1").current, before);
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"]);
  assert.deepEqual(counts(), [1, 2, 2, 2]);
});

test("a gap in seq reads every route again, once", async () => {
  seq += 2; // two events lost
  twitch.goals = [goal("g1", { current_amount: 47 })]; // Helix is current
  await push("live", [event("channel.goal.progress", goalEvent("g1", 47))]);
  assert.equal(state.goals.find((g) => g.id === "g1").current, 47, "the event still shows");
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 3, 3, 3]);
  await seconds(vm, twitch, 60);
  assert.deepEqual(counts(), [1, 3, 3, 3]);
});

test("a follow lights the card at once, and only the followers are read again", async () => {
  const total = state.followers.total;
  // Twitch lists the new follower too.
  twitch.total = total + 1;
  twitch.followers = [follower("1234", "Nova_Fan", Date.now())];
  await push("live", [
    event("channel.follow", {
      user_id: "1234", user_login: "nova_fan", user_name: "Nova_Fan",
      broadcaster_user_id: NOVA, broadcaster_user_login: "novalive", broadcaster_user_name: "NovaLive",
      followed_at: new Date(Date.now()).toISOString(),
    }),
  ]);
  assert.equal(state.followers.lastName, "Nova_Fan");
  assert.equal(state.followers.total, total + 1);
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 3, 4, 3], "the total read again, nothing else");
});

test("a Hype Train shows and leaves with its events", async () => {
  const now = Date.now();
  await push("live", [
    event("channel.hype_train.begin", {
      id: "train-9", broadcaster_user_id: NOVA, level: 2, total: 1700, progress: 640, goal: 1000,
      started_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 300_000).toISOString(),
    }),
  ]);
  assert.equal(state.hype.level, 2);
  assert.equal(state.hype.progress, 640);
  await push("live", [event("channel.hype_train.end", { id: "train-9", broadcaster_user_id: NOVA, level: 3 })]);
  assert.equal(state.hype, null);
  assert.deepEqual(counts(), [1, 3, 4, 3]);
});

test("off: every route every 20 seconds again; live again: one catch-up", async () => {
  await push("off");
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 4, 5, 4]);
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 5, 6, 5]);
  await push("live");
  await seconds(vm, twitch, 20);
  assert.deepEqual(counts(), [1, 6, 7, 6], "the catch-up");
  await seconds(vm, twitch, 60);
  assert.deepEqual(counts(), [1, 6, 7, 6]);
});
