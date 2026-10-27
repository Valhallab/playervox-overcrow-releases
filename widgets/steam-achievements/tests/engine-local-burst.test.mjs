// Saves one after another (an achievement a second, as in a real game):
// each new one shows at once, marked New once, and the widget keeps every
// achievement this computer gave. Host timers are few (`MAX_TIMERS`, 16 a
// widget): the New marks share one timer, and when the host refuses a timer
// nothing this computer gave is lost, nor marked New again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const START = Date.UTC(2026, 0, 1, 12);
const MAX_TIMERS = 16;
const vm = installRuntime({ now: START, host: { messages: EN, grants: ["storage", "network", "account:steam", "game.read"] }, accounts: { steam: "connected" } });
// The host's ceiling, as the VM applies it: a timer beyond 16 is refused.
// `refuse` refuses every one-shot timer, as when the ceiling is reached.
const limits = { refuse: false, most: 0 };
const surface = globalThis.overcrow;
globalThis.overcrow = Object.create(surface, {
  timer: {
    value(intervalMs, repeat, callback) {
      if (vm.timers.length >= MAX_TIMERS || (limits.refuse && !repeat)) throw new RangeError("too many timers");
      const id = surface.timer(intervalMs, repeat, callback);
      limits.most = Math.max(limits.most, vm.timers.length);
      return id;
    },
  },
});
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
steam.games[100] = { name: "Ashen Crown", schema: achievementsOf(80), unlocked: { ACH_0: 1767000000 } };
steam.games[200] = { name: "Courier of Tides", schema: achievementsOf(3, "C"), unlocked: {} };
steam.local = { 100: { ACH_0: 1767000000 } };
steam.recent = [200];
steam.playing = null;
await loadLogic();
const { state } = await import("@overcrow/sdk");
vm.push("game.subscribe", { steamAppId: 100, name: "Ashen Crown" });
await settle(vm, steam);
const EVENTS = "steam.events.subscribe";

let window = [];
let seq = 0;
async function saved() {
  seq += 1;
  window = [...window, { seq, type: "stats.saved", at: Date.now(), data: { appid: 100 } }].slice(-16);
  vm.push(EVENTS, { state: "live", reason: null, events: window });
  await settle(vm, steam);
}
async function wait(ms) {
  vm.advance(ms);
  await settle(vm, steam);
}

/** Unlocks the next `count` achievements, one a second, each with its save. */
async function burst(count, from) {
  const marked = new Map();
  for (let n = from; n < from + count; n += 1) {
    steam.local[100][`ACH_${n}`] = Math.floor(Date.now() / 1000);
    await saved();
    assert.equal(state.game.unlocked, n + 1, `ACH_${n} shown at its save`);
    assert.ok(`ACH_${n}` in state.fresh, `ACH_${n} marked New`);
    for (const [id, until] of Object.entries(state.fresh)) {
      if (marked.has(id)) assert.equal(until, marked.get(id), `${id} never marked again`);
      else marked.set(id, until);
    }
    await wait(1_000);
  }
}

test("thirty saves a second apart: each shown at once, marked once, few timers", async () => {
  await wait(10_000);
  const calls = steam.localCalls.length;
  await burst(30, 1);
  assert.ok(steam.localCalls.length >= calls + 30, "read on this computer at each save");
  assert.ok(limits.most <= 6, `timers at most ${limits.most}`);
  // The marks go after their minute, all of them.
  await wait(61_000);
  assert.deepEqual(state.fresh, {});
  assert.equal(state.game.unlocked, 31);
});

test("a timer the host refuses: nothing from this computer is lost or marked again", async () => {
  limits.refuse = true;
  await burst(10, 31);
  assert.equal(state.game.unlocked, 41);
  // A save with nothing new marks nothing.
  const before = { ...state.fresh };
  await saved();
  assert.deepEqual(state.fresh, before);
  assert.equal(state.game.unlocked, 41);
  limits.refuse = false;
  // The marks still go, at the minute's tick at the latest.
  await wait(2 * 60_000);
  assert.deepEqual(state.fresh, {});
  assert.equal(state.game.unlocked, 41);
});
