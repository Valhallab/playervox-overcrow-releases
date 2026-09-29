// `@overcrow/sdk/testing`: the public test helper drives the SDK as the
// VM does, on virtual time, and never ships in the widget bundle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { HOST, installRuntime } from "../dist/testing/index.js";

const realNow = Date.now;
const start = Date.UTC(2026, 2, 29, 0, 59, 0);
const vm = installRuntime({
  now: start,
  host: {
    grants: ["stopwatch.control"],
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 60, nextChangeAt: Date.UTC(2026, 2, 29, 1) },
  },
});
const { formatTime, stopwatch, timers, ServiceError } = await import("../dist/index.js");

test("Date.now follows the virtual time", () => {
  assert.equal(Date.now(), start);
  assert.equal(vm.now, start);
  assert.equal(HOST.scale, 1000);
});

test("atEach wakes at each boundary and at nextChangeAt", () => {
  const seen = [];
  const clock = timers.atEach("minute", () => seen.push(formatTime(Date.now())));
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, Date.UTC(2026, 2, 29, 1));
  // The host sends the new offset at nextChangeAt; the tick shows it.
  vm.setHost({ region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 120 } });
  assert.equal(vm.advance(60_000), 1);
  assert.deepEqual(seen, ["03:00"]);
  assert.equal(vm.advance(120_000), 2);
  assert.deepEqual(seen, ["03:00", "03:01", "03:02"]);
  clock.cancel();
  assert.equal(vm.timers.length, 0);
});

test("repeating timers re-arm, in order, and short ones are refused", () => {
  const ticks = [];
  const every = timers.every(400, () => ticks.push(`every@${Date.now() - vm.now}`));
  timers.after(1_000, () => ticks.push("after"));
  assert.equal(vm.advance(1_000), 3);
  assert.deepEqual(ticks, ["every@0", "every@0", "after"]);
  every.cancel();
  assert.throws(() => globalThis.overcrow.timer(99, false, () => {}), RangeError);
});

test("calls wait for the test, and subscriptions take pushed values", async () => {
  const running = stopwatch.toggle();
  const call = vm.lastCall("stopwatch.toggle");
  assert.equal(call.settled, false);
  call.reject("unavailable");
  await assert.rejects(running, (error) => error instanceof ServiceError && error.code === "unavailable");
  const again = stopwatch.toggle();
  vm.lastCall("stopwatch.toggle").resolve(null);
  assert.equal(await again, null);

  const updates = [];
  stopwatch.subscribe((update) => updates.push(update));
  const value = { running: true, elapsedMs: 5, at: 0, shortcuts: { toggle: "F9", reset: "F10", bound: true } };
  assert.equal(vm.push("stopwatch.subscribe", value), 1);
  assert.equal(vm.fail("stopwatch.subscribe", "permission_denied"), 1);
  assert.equal(vm.push("stopwatch.subscribe", value), 0);
  assert.equal(updates[0].ok, true);
  assert.equal(updates[1].error.code, "permission_denied");
});

test("uninstall restores Date.now and the global", () => {
  vm.uninstall();
  assert.equal(Date.now, realNow);
  assert.equal(globalThis.overcrow, undefined);
  assert.throws(() => {
    installRuntime();
    installRuntime();
  }, /installed already/);
});

test("the widget bundle never reaches the helper", () => {
  const index = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(index, /testing/);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.exports["./testing"].default, "./dist/testing/index.js");
});
