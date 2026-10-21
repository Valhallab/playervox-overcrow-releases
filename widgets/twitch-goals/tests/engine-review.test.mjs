// What a review of the engine found: independent routes, every option off
// from the start, an unfollow, an answer of a previous connection, and the
// three reads leaving together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { NOVA, OTHER, fakeTwitch, follower, goal, minutes, settle, train } from "./twitch-fake.mjs";

const NOW = Date.UTC(2026, 0, 1, 12);
const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const OFF = { "goal-subs": false, "goal-followers": false, "goal-bits": false, "goal-cheerers": false, "show-followers": false, "show-last-follower": false, "show-hype": false };
const vm = installRuntime({ now: NOW, host: { messages: EN, grants: ["network", "account:twitch"], options: OFF }, accounts: { twitch: "connected" } });
const twitch = fakeTwitch();
twitch.goals = [goal("g1")];
twitch.followers = [follower("7", "Mira", NOW - 180_000)];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);
const v = () => state.optionsVersion;

test("every option off from the start: Nothing to show, never the skeleton", async () => {
  await minutes(vm, twitch, 2);
  assert.equal(twitch.requests.length, 0);
  assert.equal(logic.screen(state, v()), "nothing");
  vm.setHost({ options: {} });
  await settle(vm, twitch);
  assert.equal(logic.screen(state, v()), "content");
});

test("the three reads leave together, not one after the other", async () => {
  vm.advance(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  const open = vm.calls.filter((call) => call.service === "http.fetch" && !call.settled);
  assert.equal(open.length, 3);
  await settle(vm, twitch);
});

test("a route failing for good never stops the others", async () => {
  twitch.routeStatus["/helix/hypetrain/status"] = 500;
  const goals = twitch.count("/helix/goals");
  await minutes(vm, twitch, 30);
  assert.equal(twitch.count("/helix/goals") - goals, 30, "goals every minute");
  assert.equal(state.stale, "server");
  assert.equal(logic.staleText(state), "Unreachable · 30 min ago");
  assert.match(logic.staleTip(state), /few minutes/);
  delete twitch.routeStatus["/helix/hypetrain/status"];
  twitch.train = train(Date.now() + 600_000, 200);
  await minutes(vm, twitch, 10);
  assert.equal(state.stale, "");
  assert.notEqual(logic.hype(state, v()), null);
  twitch.train = null;
  await minutes(vm, twitch, 1);
});

test("followers refused for good: goals and the Hype Train still read", async () => {
  twitch.routeStatus["/helix/channels/followers"] = 401;
  const [goals, hype] = [twitch.count("/helix/goals"), twitch.count("/helix/hypetrain/status")];
  await minutes(vm, twitch, 5);
  assert.equal(twitch.count("/helix/goals") - goals, 5);
  assert.equal(twitch.count("/helix/hypetrain/status") - hype, 5);
  assert.equal(state.stale, "refused");
  assert.equal(logic.staleText(state), "Refused by Twitch · 5 min ago", "the age of the followers, not of the goals");
  delete twitch.routeStatus["/helix/channels/followers"];
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
});

test("an unfollow is not a new follower", async () => {
  twitch.followers = [follower("8", "Kenji", Date.now()), ...twitch.followers];
  await minutes(vm, twitch, 1);
  assert.equal(logic.isNewFollower(state), true);
  vm.advance(10_000);
  const lit = state.newUntil;
  twitch.followers = twitch.followers.slice(1);
  await minutes(vm, twitch, 1);
  assert.equal(logic.lastFollower(state, false), "Latest follower: Mira");
  assert.equal(state.newUntil, lit, "Mira is not lit again");
  assert.equal(logic.isNewFollower(state), false);
});

test("two routes failing: the warning gives the age of the older data", async () => {
  twitch.routeStatus["/helix/goals"] = 503;
  await minutes(vm, twitch, 3);
  twitch.routeStatus["/helix/hypetrain/status"] = 503;
  await minutes(vm, twitch, 1);
  assert.equal(logic.staleText(state), "Unreachable · 4 min ago");
  delete twitch.routeStatus["/helix/goals"];
  delete twitch.routeStatus["/helix/hypetrain/status"];
  await minutes(vm, twitch, 10);
  assert.equal(state.stale, "");
});

test("a follower without any name shows no empty Latest:", async () => {
  twitch.followers = [{ user_id: "9", user_login: "", user_name: "", followed_at: new Date(Date.now()).toISOString() }];
  await minutes(vm, twitch, 1);
  assert.equal(logic.hasLast(state, v()), false);
  twitch.followers = [follower("7", "Mira", NOW)];
  await minutes(vm, twitch, 1);
});

test("an answer of the previous connection is never used for the new one", async () => {
  // Connection A again: its channel read waits.
  vm.setAccount("twitch", "signed_out");
  vm.setAccount("twitch", "connected");
  await new Promise((resolve) => setImmediate(resolve));
  const stale = vm.calls.find((call) => call.service === "http.fetch" && !call.settled);
  assert.match(stale.params.url, /\/helix\/users$/);
  // Account B connects before A's answer comes.
  vm.setAccount("twitch", "signed_out");
  twitch.user = OTHER;
  twitch.goals = [goal("gB", { broadcaster_id: OTHER })];
  vm.setAccount("twitch", "connected");
  stale.resolve({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ id: NOVA }] }) });
  const before = twitch.requests.length;
  await settle(vm, twitch);
  assert.ok(twitch.requests.slice(before).every((url) => !url.includes(`broadcaster_id=${NOVA}`)), twitch.requests.slice(before).join("\n"));
  assert.deepEqual(state.goals.map((g) => g.id), ["gB"]);
  assert.equal(state.stale, "");
});

test("errors: a too large answer is Twitch's problem; a first-load limit says so", () => {
  assert.equal(logic.emptyText({ ...state, stale: "quota" }), "Twitch is limiting requests. Retrying in a few minutes.");
  assert.equal(logic.emptyText({ ...state, stale: "server" }), "Twitch unreachable. Retrying in a few minutes.");
});

test("one line: the source is said in the tooltips", () => {
  const g = logic.firstGoal(state, v());
  assert.equal(logic.lineTip(logic.goalType(g)), "Followers · Data from Twitch");
});
