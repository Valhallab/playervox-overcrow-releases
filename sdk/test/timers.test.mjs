import assert from "node:assert/strict";
import { test } from "node:test";

import { HOST, installRuntime } from "./fake-runtime.mjs";

const vm = installRuntime();
const { timers, MIN_TIMER_INTERVAL_MS } = await import("../dist/index.js");

let now = 0;
Date.now = () => now;

const clear = () => {
  for (const id of [...vm.timers.keys()]) {
    vm.timers.delete(id);
  }
};

test("after and every start host timers and cancel them", () => {
  clear();
  let ticks = 0;
  const once = timers.after(250.4, () => (ticks += 1));
  assert.deepEqual(
    { intervalMs: vm.onlyTimer().intervalMs, repeat: vm.onlyTimer().repeat },
    { intervalMs: 251, repeat: false },
  );
  vm.fire(vm.onlyTimer().id);
  assert.equal(ticks, 1);
  once.cancel();

  const repeating = timers.every(10, () => (ticks += 1));
  assert.equal(vm.onlyTimer().intervalMs, MIN_TIMER_INTERVAL_MS, "raised to the minimum");
  assert.equal(vm.onlyTimer().repeat, true);
  repeating.cancel();
  repeating.cancel();
  assert.equal(vm.timers.size, 0);
});

test("atEach wakes at each local boundary", () => {
  clear();
  vm.host = { ...HOST, region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 330 } };
  now = Date.UTC(2026, 6, 17, 14, 8, 42, 250);
  const seen = [];
  const clock = timers.atEach("minute", () => seen.push(now));
  assert.equal(vm.onlyTimer().intervalMs, 17_750);
  now += 17_750;
  vm.fire(vm.onlyTimer().id);
  assert.deepEqual(seen, [now]);
  assert.equal(vm.onlyTimer().intervalMs, 60_000, "re-armed from the current time");
  // A late tick (the host was busy) re-aligns on the next boundary.
  now += 60_000 + 1_200;
  vm.fire(vm.onlyTimer().id);
  assert.equal(vm.onlyTimer().intervalMs, 58_800);
  clock.cancel();
  assert.equal(vm.timers.size, 0);
});

test("atEach ticks once after a hidden period, then realigns", () => {
  clear();
  vm.host = HOST;
  now = Date.UTC(2026, 6, 17, 14, 8, 30);
  const seen = [];
  const clock = timers.atEach("minute", () => seen.push(now));
  const due = vm.onlyTimer();
  assert.equal(due.intervalMs, 30_000);
  // Hidden for five minutes: the host holds the due one-shot, then
  // delivers it once when the widget is shown again.
  now += 5 * 60_000 + 12_345;
  vm.fire(due.id);
  assert.equal(seen.length, 1, "one tick for the whole hidden period");
  assert.equal(vm.onlyTimer().intervalMs, 60_000 - 42_345 % 60_000);
  assert.equal(vm.timers.size, 1, "one timer, no burst");
  clock.cancel();
});

test("atEach wakes at the offset change and uses the new offset", () => {
  clear();
  const spring = Date.UTC(2026, 2, 29, 1);
  vm.host = {
    ...HOST,
    region: { numberFormat: "us", dateOrder: "dmy", offsetMinutes: 60, nextChangeAt: spring },
  };
  now = spring - 30 * 60_000;
  const seen = [];
  const daily = timers.atEach("day", () => seen.push(now));
  assert.equal(vm.onlyTimer().intervalMs, 30 * 60_000, "wakes at the change, not at midnight");
  // The host sends the new Region at the change.
  now = spring;
  vm.host = {
    ...HOST,
    region: { numberFormat: "us", dateOrder: "dmy", offsetMinutes: 120 },
  };
  vm.fire(vm.onlyTimer().id);
  assert.equal(seen.length, 1);
  assert.equal(vm.onlyTimer().intervalMs, 21 * 3_600_000, "next local midnight in summer time");
  daily.cancel();
});

test("a cancelled atEach never re-arms", () => {
  clear();
  vm.host = HOST;
  now = 0;
  let ticks = 0;
  const clock = timers.atEach("second", () => (ticks += 1));
  const pending = vm.onlyTimer();
  clock.cancel();
  // A tick already on its way when cancelled.
  pending.callback();
  assert.equal(ticks, 0);
  assert.equal(vm.timers.size, 0);
});
