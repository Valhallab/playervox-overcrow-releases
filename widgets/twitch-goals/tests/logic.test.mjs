// Unit tests of the pure readers of Live goals on @overcrow/sdk/testing: the
// answers of each Twitch route and the texts. The answers are synthetic,
// shaped as Twitch's API reference shows them: no request reaches Twitch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const EN = read("../locales/en.json");
const FR = read("../locales/fr.json");
const vm = installRuntime({ host: { messages: EN, grants: ["network", "account:twitch"] }, accounts: { twitch: "signed_out" } });
const logic = await loadLogic();

const goal = (fields = {}) => ({
  id: "1woowvbkiNv8BRxEWSqmQz6Zk92",
  broadcaster_id: "141981764",
  broadcaster_name: "NovaLive",
  broadcaster_login: "novalive",
  type: "follower",
  description: "Follow goal for Helix testing",
  current_amount: 27062,
  target_amount: 30000,
  created_at: "2021-08-16T17:22:23Z",
  ...fields,
});

test("the channel of the token's user", () => {
  assert.equal(logic.parseUser({ data: [{ id: "141981764", login: "novalive", display_name: "NovaLive" }] }), "141981764");
  for (const body of [{ data: [] }, { data: [{ id: "" }] }, { data: [{ id: "12a" }] }, { data: [{ id: 141981764 }] }, {}, null, "x", { data: [{ id: "1".repeat(33) }] }]) {
    assert.equal(logic.parseUser(body), null, JSON.stringify(body));
  }
});

test("goals: every type, newest first, empty when there is none", () => {
  const goals = logic.parseGoals({
    data: [
      goal({ id: "a", type: "subscription", created_at: "2026-01-01T10:00:00Z" }),
      goal({ id: "b", type: "new_cheerer", current_amount: "12", target_amount: "50", created_at: "2026-01-02T10:00:00Z" }),
      goal({ id: "c", type: "something_new", description: "", created_at: "2025-12-01T10:00:00Z" }),
    ],
  });
  assert.deepEqual(goals.map((g) => [g.id, g.type, g.current, g.target]), [
    ["b", "new_cheerer", 12, 50],
    ["a", "subscription", 27062, 30000],
    ["c", "other", 27062, 30000],
  ]);
  assert.equal(goals[0].created, Date.parse("2026-01-02T10:00:00Z"));
  for (const type of ["follower", "subscription", "subscription_count", "new_subscription", "new_subscription_count", "new_bit", "new_cheerer"]) {
    assert.equal(logic.parseGoals({ data: [goal({ type })] })[0].type, type);
  }
  assert.deepEqual(logic.parseGoals({ data: [] }), []);
  assert.equal(logic.parseGoals({}), null);
  assert.equal(logic.parseGoals(null), null);
  // An unreadable goal is left out; the others stay.
  assert.deepEqual(logic.parseGoals({ data: [goal({ id: "" }), goal({ current_amount: null }), goal({ target_amount: -1 }), goal({ id: "ok" })] }).map((g) => g.id), ["ok"]);
});

test("a goal's description: trimmed, on one line, bounded", () => {
  const [g] = logic.parseGoals({ data: [goal({ description: "  Road to\n 30k  " })] });
  assert.equal(g.desc, "Road to 30k");
  assert.equal(logic.parseGoals({ data: [goal({ description: "x".repeat(500) })] })[0].desc.length, 100);
  assert.equal(logic.parseGoals({ data: [goal({ description: 5 })] })[0].desc, "");
});

test("followers: total and the latest one", () => {
  const body = { total: 8, data: [{ user_id: "11111", user_name: "UserDisplayName", user_login: "userloginname", followed_at: "2022-05-24T22:22:08Z" }], pagination: {} };
  assert.deepEqual(logic.parseFollowers(body), { total: 8, lastId: "11111", lastName: "UserDisplayName", lastAt: Date.parse("2022-05-24T22:22:08Z") });
  // Without a display name, the login.
  assert.equal(logic.parseFollowers({ total: 8, data: [{ user_id: "1", user_name: "", user_login: "nova" }] }).lastName, "nova");
  // Without the scope, Twitch may give the total alone (API reference).
  assert.deepEqual(logic.parseFollowers({ total: 1284, data: [] }), { total: 1284, lastId: "", lastName: "", lastAt: 0 });
  assert.deepEqual(logic.parseFollowers({ total: 0, data: [] }), { total: 0, lastId: "", lastName: "", lastAt: 0 });
  assert.equal(logic.parseFollowers({ data: [] }), null);
  assert.equal(logic.parseFollowers({ total: -2, data: [] }), null);
  assert.equal(logic.parseFollowers("x"), null);
});

test("Hype Train: the current one, none, or unreadable", () => {
  const current = { id: "1b0AsbInCHZW2SQFQkCzqN07Ib2", level: 2, total: 700, progress: 200, goal: 1000, started_at: "2026-01-01T11:55:00Z", expires_at: "2026-01-01T12:03:42Z", type: "regular" };
  assert.deepEqual(logic.parseHype({ data: [{ current, all_time_high: null, shared_all_time_high: null }] }), {
    id: current.id, level: 2, progress: 200, goal: 1000, expiresAt: Date.parse("2026-01-01T12:03:42Z"),
  });
  assert.equal(logic.parseHype({ data: [{ current: null, all_time_high: { level: 4 } }] }), null);
  assert.equal(logic.parseHype({ data: [{ all_time_high: null }] }), null);
  assert.equal(logic.parseHype({ data: [] }), null);
  assert.equal(logic.parseHype({}), undefined);
  assert.equal(logic.parseHype({ data: [{ current: { ...current, expires_at: "soon" } }] }), undefined);
  assert.equal(logic.parseHype({ data: [{ current: { ...current, goal: 0 } }] }), undefined);
});

test("percent, reached: no division by zero, 100 % at most", () => {
  assert.equal(logic.percentOf(37, 50), "74%");
  assert.equal(logic.percentOf(80, 50), "100%");
  assert.equal(logic.percentOf(3, 0), "0%");
  assert.equal(logic.reached({ current: 50, target: 50 }), true);
  assert.equal(logic.reached({ current: 3, target: 0 }), false);
});

test("backoff of a 5xx or a 429: 1, 2, 4, 8 then 10 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => logic.backoff(n) / 60_000), [1, 2, 4, 8, 10, 10]);
});

test("ages and short warnings, in English and French", () => {
  assert.equal(logic.ago(30_000), "just now");
  assert.equal(logic.ago(3 * 60_000), "3 min ago");
  assert.equal(logic.ago(5 * 3_600_000), "5 h ago");
  assert.equal(logic.ago(3 * 86_400_000), "3 d ago");
  assert.equal(logic.age(5 * 60_000), "5 min ago");
  vm.setHost({ locale: "fr", messages: FR, region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 0 } });
  assert.equal(logic.ago(3 * 60_000), "il y a 3 min");
  assert.equal(logic.percentOf(37, 50), "74 %");
  assert.match(logic.num(1284), /^1\u00a0284$/);
  vm.setHost({ locale: "en", messages: EN, region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 } });
  assert.equal(logic.num(1284), "1,284");
});

test("every text key exists in both languages", () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(FR).sort());
});
