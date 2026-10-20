// What moves during a live: a new follower, a Hype Train and its countdown,
// goals reached, filtered and listed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { fakeTwitch, follower, goal, minutes, settle, train } from "./twitch-fake.mjs";

const NOW = Date.UTC(2026, 0, 1, 12);
const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: NOW, host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "connected" } });
const twitch = fakeTwitch();
twitch.goals = [goal("g1")];
twitch.followers = [follower("7", "Mira", NOW - 180_000)];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);
const v = () => state.optionsVersion;

test("the first follower read is not new", () => {
  assert.equal(logic.isNewFollower(state), false);
  assert.equal(logic.lastFollower(state, false), "Latest: Mira");
  assert.equal(logic.lastFollower(state, true), "Latest: Mira · 3 min ago");
});

test("a new follower lights the card for 10 s", async () => {
  twitch.total = 1285;
  twitch.followers = [follower("8", "Kenji", Date.now()), ...twitch.followers];
  await minutes(vm, twitch, 1);
  assert.equal(logic.isNewFollower(state), true);
  assert.equal(logic.followersClass(state), "followers new");
  vm.advance(10_000);
  assert.equal(logic.isNewFollower(state), false);
  assert.equal(logic.followersClass(state), "followers");
});

test("a Hype Train comes first and counts down each second", async () => {
  twitch.train = train(Date.now() + 60_000, 150);
  await minutes(vm, twitch, 1);
  assert.equal(logic.firstCard(state, v()), "hype");
  const h = logic.hype(state, v());
  assert.equal(logic.hypeTime(h, state), "02:30");
  assert.equal(logic.hypeLevel(h, true), "Lv 2");
  vm.advance(30_000);
  assert.equal(logic.hypeTime(h, state), "02:00");
  // Standard: train and goal on one line, no followers card.
  assert.equal(logic.followersCard(state, v()), false);
  vm.setHost({ options: { layout: "compact" } });
  assert.equal(logic.followersCard(state, v()), false);
  vm.setHost({ options: { "show-hype": false } });
  assert.equal(logic.hype(state, v()), null);
  assert.equal(logic.firstCard(state, v()), "goal:g1");
  vm.setHost({ options: {} });
});

test("the train leaves at zero even when Twitch is down", async () => {
  twitch.fail = { error: "timeout" };
  vm.advance(30_000);
  await settle(vm, twitch);
  await minutes(vm, twitch, 1);
  assert.notEqual(logic.hype(state, v()), null);
  vm.advance(30_000);
  await settle(vm, twitch);
  assert.equal(logic.hype(state, v()), null);
  assert.equal(state.hype, null);
  assert.equal(vm.timers.filter((timer) => timer.intervalMs === 1000).length, 0, "no countdown left");
  twitch.fail = null;
});

test("an ended train Twitch still lists is not shown", async () => {
  twitch.train = train(Date.now(), -5);
  await minutes(vm, twitch, 1);
  assert.equal(state.hype, null);
  twitch.train = null;
  await minutes(vm, twitch, 1);
  assert.equal(state.hype, null);
});

test("goals: reached, filtered by type, three at most in Full", async () => {
  twitch.goals = [
    goal("bits", { type: "new_bit", description: "", current_amount: 500, target_amount: 500, created_at: "2026-01-01T11:00:00Z" }),
    goal("subs", { type: "subscription_count", description: "Sub goal", created_at: "2026-01-01T10:00:00Z" }),
    goal("fol", { created_at: "2026-01-01T09:00:00Z" }),
    goal("cheer", { type: "new_cheerer", created_at: "2026-01-01T08:00:00Z" }),
  ];
  await minutes(vm, twitch, 1);
  const first = logic.firstGoal(state, v());
  assert.equal(first.id, "bits");
  assert.equal(logic.reached(first), true);
  assert.equal(logic.typeIcon(first), "circle-check");
  assert.equal(logic.goalTitle(first), "Bits goal");
  assert.equal(logic.goals(state, v()).length, 1);
  vm.setHost({ options: { layout: "full" } });
  assert.deepEqual(logic.goals(state, v()).map((g) => g.id), ["bits", "subs", "fol"]);
  assert.deepEqual(logic.goals(state, v()).map((g) => g.mark !== ""), [true, false, false]);
  vm.setHost({ options: { layout: "full", "goal-bits": false, "goal-subs": false } });
  assert.deepEqual(logic.goals(state, v()).map((g) => g.id), ["fol", "cheer"]);
  assert.equal(logic.typeIcon(logic.goals(state, v())[1]), "sparkles");
  vm.setHost({ options: {} });
});

test("goals filtered out and followers off: nothing to show, never No active goal", async () => {
  twitch.goals = [goal("subs", { type: "subscription" })];
  await minutes(vm, twitch, 1);
  vm.setHost({ options: { "goal-subs": false, "show-followers": false, "show-last-follower": false } });
  assert.equal(logic.noGoalCard(state, v()), false);
  assert.equal(logic.nothingShown(state, v()), true);
  vm.setHost({ options: {} });
});
