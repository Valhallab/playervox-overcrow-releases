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

test("atEach keeps seconds and minutes on one aligned repeating timer", () => {
  clear();
  vm.host = { ...HOST, region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 330 } };
  now = Date.UTC(2026, 6, 17, 14, 8, 42, 250);
  const seen = [];
  const clock = timers.atEach("minute", () => seen.push(now));
  assert.deepEqual(
    { intervalMs: vm.onlyTimer().intervalMs, repeat: vm.onlyTimer().repeat },
    { intervalMs: 17_750, repeat: false },
    "first to the boundary",
  );
  now += 17_750;
  vm.fire(vm.onlyTimer().id);
  assert.deepEqual(seen, [now]);
  const steady = vm.onlyTimer();
  assert.deepEqual({ intervalMs: steady.intervalMs, repeat: steady.repeat }, { intervalMs: 60_000, repeat: true });
  // Each boundary is one tick of the same timer, a little late as a host
  // timer is: nothing is re-armed.
  now += 40;
  for (let minute = 0; minute < 3; minute += 1) {
    now += 60_000;
    vm.fire(steady.id);
  }
  assert.equal(seen.length, 4);
  assert.equal(vm.onlyTimer().id, steady.id, "still the same repeating timer");
  // A tick that drifted past the alignment bound re-aligns on the next boundary.
  now += 60_000 + 1_200;
  vm.fire(steady.id);
  assert.equal(seen.length, 5, "the late tick still shows the time");
  assert.deepEqual(
    { intervalMs: vm.onlyTimer().intervalMs, repeat: vm.onlyTimer().repeat },
    { intervalMs: 58_760, repeat: false },
  );
  clock.cancel();
  assert.equal(vm.timers.size, 0);
});

test("an early tick waits for its boundary", () => {
  clear();
  vm.host = HOST;
  now = Date.UTC(2026, 6, 17, 14, 8, 0);
  const seen = [];
  const clock = timers.atEach("second", () => seen.push(now));
  now += 1000;
  vm.fire(vm.onlyTimer().id);
  const steady = vm.onlyTimer();
  // The monotonic timer ran ahead of the wall clock by 30 ms.
  now += 970;
  vm.fire(steady.id);
  assert.deepEqual(
    { intervalMs: vm.onlyTimer().intervalMs, repeat: vm.onlyTimer().repeat },
    { intervalMs: 100, repeat: false },
    "one-shot to the boundary, raised to the minimum",
  );
  clock.cancel();
  assert.equal(seen.length, 2);
});

test("atEach ticks once when shown again, keeping its timer", () => {
  clear();
  vm.host = HOST;
  now = Date.UTC(2026, 6, 17, 14, 8, 30);
  const seen = [];
  const clock = timers.atEach("minute", () => seen.push(now));
  now += 30_000;
  vm.fire(vm.onlyTimer().id);
  const steady = vm.onlyTimer();
  // Hidden for five minutes: the host drops the repeating ticks.
  vm.setHost({ visible: false });
  now += 5 * 60_000 + 12_345;
  vm.setHost({ visible: true });
  assert.equal(seen.length, 2, "one tick for the whole hidden period");
  assert.equal(vm.onlyTimer().id, steady.id, "the aligned timer is kept");
  vm.setHost({ visible: true });
  assert.equal(seen.length, 2, "an unchanged visibility does not tick");
  clock.cancel();
  vm.setHost({ visible: false });
  vm.setHost({ visible: true });
  assert.equal(seen.length, 2, "a cancelled clock ignores the host");
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
