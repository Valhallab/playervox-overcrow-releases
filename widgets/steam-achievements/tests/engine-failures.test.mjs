// The engine when Steam fails: values kept, the cause and age said, the
// backoff, "Playing now" only from a fresh read.
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

test("unreachable: values stay, the warning names cause and age", async () => {
  assert.equal(logic.eyebrow(state), "Playing now");
  steam.fail = { error: "transport_failed" };
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "unreachable");
  assert.equal(state.game.playing, false, "never Playing now without a fresh read");
  assert.deepEqual([state.game.unlocked, state.game.total], [1, 5]);
  assert.equal(logic.eyebrow(state), "Unreachable · 1 min ago");
  assert.equal(logic.eyebrowClass(state), "eyebrow warn stale");
  await minutes(vm, steam, 4);
  assert.equal(logic.eyebrow(state), "Unreachable · 5 min ago");
  steam.fail = null;
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "");
  assert.equal(logic.eyebrow(state), "Playing now");
});

test("a 5xx waits 1, 2, 4, 8 then 10 minutes", async () => {
  steam.fail = { status: 503 };
  const reads = () => steam.count("GetPlayerSummaries");
  const gaps = [];
  let last = reads();
  await minutes(vm, steam, 1);
  for (let minute = 1, since = 0; minute <= 40; minute += 1) {
    await minutes(vm, steam, 1);
    since += 1;
    if (reads() > last) {
      gaps.push(since);
      since = 0;
      last = reads();
    }
  }
  assert.deepEqual(gaps.slice(0, 5), [1, 2, 4, 8, 10]);
  assert.equal(state.stale, "unreachable");
  steam.fail = null;
  await minutes(vm, steam, 10);
  assert.equal(state.stale, "");
});

test("a 429 says the limit and backs off", async () => {
  steam.fail = { status: 429 };
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "quota");
  assert.equal(logic.eyebrow(state), "Rate limited · 1 min ago");
  assert.equal(logic.staleIcon(state), "hourglass");
  steam.fail = null;
  await minutes(vm, steam, 3);
  assert.equal(state.stale, "");
});

test("a refused key stops the reads until it is connected again", async () => {
  vm.setAccount("steam", "refused");
  steam.fail = { error: "account_refused" };
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "", "the host says it, not the widget");
  const before = steam.requests.length;
  await minutes(vm, steam, 3);
  assert.equal(steam.requests.length, before);
  steam.fail = null;
  vm.setAccount("steam", "connected");
  await settle(vm, steam);
  assert.equal(steam.requests.length > before, true);
});

test("the host's own budget (busy) is not Steam being unreachable", async () => {
  steam.fail = { error: "busy" };
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "");
  steam.fail = null;
  await minutes(vm, steam, 1);
  assert.equal(state.stale, "");
  assert.equal(logic.eyebrow(state), "Playing now");
});
