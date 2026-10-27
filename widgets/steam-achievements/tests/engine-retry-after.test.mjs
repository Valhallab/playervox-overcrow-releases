// The engine after a 429 that says when to try again (Retry-After): the
// route that got it waits that long, in seconds or until an HTTP date,
// bounded to an hour; without the header, the backoff as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(5), unlocked: { ACH_0: 1767000000 } };
steam.playing = 100;
steam.recent = [100];
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

const SUMMARY = "GetPlayerSummaries";
const PLAYER = "GetPlayerAchievements";

/** An HTTP date (IMF-fixdate) of `ms`. */
const httpDate = (ms) => new Date(ms).toUTCString();

/**
 * Steam answers 429 once (with `headers`), then recovers; the minutes,
 * counted from that 429, at which `fragment` is asked again in `span`.
 */
async function retriesAfter429(headers, fragment = SUMMARY, span = 15) {
  steam.fail = { status: 429, headers };
  const before = steam.count(fragment);
  await minutes(vm, steam, 1);
  assert.equal(steam.count(fragment), before + 1, "the 429 itself");
  assert.equal(state.stale, "quota");
  steam.fail = null;
  const at = [];
  let last = steam.count(fragment);
  for (let minute = 1; minute <= span; minute += 1) {
    await minutes(vm, steam, 1);
    if (steam.count(fragment) > last) at.push(minute);
    last = steam.count(fragment);
  }
  return at;
}

/** Back to normal reads between tests: no block, no backoff left. */
async function recover() {
  steam.fail = null;
  steam.routeStatus = {};
  await minutes(vm, steam, 61);
  assert.equal(state.stale, "");
}

test("without Retry-After, a 429 backs off as before (1 minute, then every minute)", async () => {
  assert.deepEqual((await retriesAfter429({}, SUMMARY, 3)), [1, 2, 3]);
  await recover();
});

test("Retry-After in seconds: the route is not asked again before", async () => {
  const at = await retriesAfter429({ "retry-after": "300" });
  assert.equal(at[0], 5, `asked again at minute ${at[0]}, not before 5`);
  assert.equal(state.stale, "");
  await recover();
});

test("Retry-After as an HTTP date counts from the response's own Date", async () => {
  // The server's clock is an hour ahead of this computer's: the wait is
  // the 3 minutes between its two dates, not 63 minutes of local time.
  const server = Date.now() + 60_000 + 60 * 60_000;
  const at = await retriesAfter429({ "retry-after": httpDate(server + 3 * 60_000), date: httpDate(server) });
  assert.equal(at[0], 3);
  await recover();
});

test("Retry-After as an HTTP date without Date counts from this computer's clock", async () => {
  const at = await retriesAfter429({ "retry-after": httpDate(Date.now() + 60_000 + 4 * 60_000) });
  assert.equal(at[0], 4);
  await recover();
});

test("Retry-After beyond an hour waits an hour", async () => {
  const at = await retriesAfter429({ "retry-after": "86400" }, SUMMARY, 62);
  assert.equal(at[0], 60);
  await recover();
});

test("an unreadable Retry-After is as no header", async () => {
  assert.deepEqual(await retriesAfter429({ "retry-after": "soon" }, SUMMARY, 3), [1, 2, 3]);
  await recover();
});

test("only the route that got the 429 waits; the limit stays said meanwhile", async () => {
  steam.routeStatus = { [PLAYER]: { status: 429, headers: { "retry-after": "600" } } };
  const player = steam.count(PLAYER);
  await minutes(vm, steam, 1);
  assert.equal(steam.count(PLAYER), player + 1, "the 429 itself");
  steam.routeStatus = {};
  const summaries = steam.count(SUMMARY);
  await minutes(vm, steam, 9);
  assert.equal(steam.count(PLAYER), player + 1, "the achievements wait their 10 minutes");
  assert.ok(steam.count(SUMMARY) - summaries >= 5, "the profile is still read");
  assert.equal(state.stale, "quota");
  assert.equal(logic.staleIcon(state), "hourglass");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 5], "values stay");
  await minutes(vm, steam, 1);
  assert.equal(steam.count(PLAYER), player + 2);
  assert.equal(state.stale, "");
  await recover();
});

test("a profile entered while the route waits asks nothing of Steam", async () => {
  steam.fail = { status: 429, headers: { "retry-after": "600" } };
  await minutes(vm, steam, 1);
  steam.fail = null;
  const requests = steam.requests.length;
  logic.profileTyped(ID);
  // Answered as it goes: a request made anyway must not hang the test.
  const submitted = logic.submitProfile();
  await settle(vm, steam);
  await submitted;
  assert.equal(steam.requests.length, requests);
  assert.equal(state.stale, "quota");
  assert.equal(state.profile.status, "idle");
  await recover();
});
