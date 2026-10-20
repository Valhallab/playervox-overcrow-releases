// A first load that fails: no value yet, the cause said, then the values.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { fakeTwitch, minutes, settle } from "./twitch-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "signed_out" } });
const twitch = fakeTwitch();
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, twitch);

test("signed out: nothing is read, the skeleton waits under the host's panel", async () => {
  await minutes(vm, twitch, 2);
  assert.equal(twitch.requests.length, 0);
  assert.equal(state.phase, "loading");
});

test("connected while Twitch is down: unreachable without values", async () => {
  twitch.fail = { error: "timeout" };
  vm.setAccount("twitch", "connected");
  await settle(vm, twitch);
  assert.equal(state.phase, "empty");
  assert.equal(logic.emptyText(state), "Twitch unreachable. Retrying every minute.");
  twitch.fail = null;
  await minutes(vm, twitch, 1);
  assert.equal(state.phase, "ready");
  assert.equal(state.stale, "");
  assert.deepEqual(state.goals, []);
  assert.equal(logic.noGoalCard(state, state.optionsVersion), true);
  assert.equal(logic.firstCard(state, state.optionsVersion), "nogoal");
});
