// The engine when Twitch fails: values kept, the cause and age said, the
// backoff, a refused route, the host's own refusals.
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

test("unreachable: values stay, the warning names cause and age", async () => {
  twitch.fail = { error: "transport_failed" };
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "unreachable");
  assert.equal(state.phase, "ready");
  assert.deepEqual(state.goals.map((g) => g.current), [37]);
  assert.equal(state.followers.total, 1284);
  assert.equal(logic.staleText(state), "Unreachable · 1 min ago");
  assert.match(logic.staleTip(state), /not answering/);
  await minutes(vm, twitch, 4);
  assert.equal(logic.staleText(state), "Unreachable · 5 min ago");
  twitch.fail = null;
  twitch.goals = [goal("g1", { current_amount: 38 })];
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
  assert.deepEqual(state.goals.map((g) => g.current), [38]);
});

test("a 5xx waits 1, 2, 4, 8 then 10 minutes", async () => {
  twitch.fail = { status: 503 };
  const reads = () => twitch.count("/helix/goals");
  const gaps = [];
  let last = reads();
  for (let minute = 1, since = 0; minute <= 40; minute += 1) {
    await minutes(vm, twitch, 1);
    since += 1;
    if (reads() > last) {
      gaps.push(since);
      since = 0;
      last = reads();
    }
  }
  assert.deepEqual(gaps.slice(0, 6), [1, 1, 2, 4, 8, 10]);
  assert.equal(state.stale, "unreachable");
  twitch.fail = null;
  await minutes(vm, twitch, 10);
  assert.equal(state.stale, "");
});

test("a 429: Rate limited, with the same backoff", async () => {
  twitch.fail = { status: 429 };
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "quota");
  assert.equal(logic.staleText(state), "Rate limited · 1 min ago");
  assert.equal(logic.staleIcon(state), "hourglass");
  twitch.fail = null;
  await minutes(vm, twitch, 2);
  assert.equal(state.stale, "");
});

test("an unreadable answer is unreachable, not an empty list", async () => {
  twitch.routeStatus["/helix/goals"] = 200;
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "unreachable");
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"]);
  delete twitch.routeStatus["/helix/goals"];
  await minutes(vm, twitch, 2);
  assert.equal(state.stale, "");
});

test("busy (the host's network budget): nothing said, next minute again", async () => {
  twitch.fail = { error: "busy" };
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
  twitch.fail = null;
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
});

test("the host refuses (expired token): no warning, the host covers the content", async () => {
  twitch.fail = { error: "account_refused" };
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
  assert.equal(state.phase, "ready");
  twitch.fail = null;
  await minutes(vm, twitch, 1);
});

test("a refused route with a valid token: the channel read again, then Refused by Twitch", async () => {
  const users = twitch.count("/helix/users");
  twitch.routeStatus["/helix/goals"] = 403;
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "", "first, the channel is read again");
  await minutes(vm, twitch, 1);
  assert.equal(twitch.count("/helix/users"), users + 1);
  assert.equal(state.stale, "refused");
  assert.equal(logic.staleText(state), "Refused by Twitch · 2 min ago");
  assert.match(logic.staleTip(state), /Reconnect Twitch in Connected services/);
  assert.deepEqual(state.goals.map((g) => g.id), ["g1"], "values stay");
  delete twitch.routeStatus["/helix/goals"];
  await minutes(vm, twitch, 1);
  assert.equal(state.stale, "");
});
