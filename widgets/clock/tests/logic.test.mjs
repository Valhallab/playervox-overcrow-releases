// Unit tests of the Clock's logic on @overcrow/sdk/testing: virtual time,
// the host's region and menu values, no VM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

// 14:08:42.250 in UTC+2, 2026-07-17.
const START = Date.UTC(2026, 6, 17, 12, 8, 42, 250);
const vm = installRuntime({
  now: START,
  host: {
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 120 },
    messages: { label: "Local time {time}", "label-date": "Local time {time}, {date}" },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("defaults: date on, day/month/year, no seconds, whatever the region's order", () => {
  assert.deepEqual(
    { seconds: state.seconds, showDate: state.showDate, order: state.order },
    { seconds: false, showDate: true, order: "dmy" },
  );
  assert.equal(logic.clockTime(state.now, state.seconds), "14:08");
  assert.equal(logic.clockDate(state.now, state.order), "17/07/2026");
  assert.equal(
    logic.clockLabel(state.now, false, true, "dmy"),
    "Local time 14:08, 17/07/2026",
  );
  assert.equal(logic.clockLabel(state.now, true, false, "dmy"), "Local time 14:08:42");
});

test("the three date formats and an unknown stored value", () => {
  const formats = {};
  for (const [value, order] of Object.entries(logic.DATE_ORDERS)) {
    formats[value] = logic.clockDate(START, order);
  }
  assert.deepEqual(formats, {
    "day-month-year": "17/07/2026",
    "year-month-day": "2026-07-17",
    "month-day-year": "07/17/2026",
  });
  vm.setHost({ options: { "date-format": "week-day" } });
  assert.equal(state.order, "dmy", "an unknown value falls back to the default");
  vm.setHost({ options: {} });
});

test("24-hour, zero padded", () => {
  const night = Date.UTC(2026, 0, 1, 23, 5, 9);
  assert.equal(logic.clockTime(night, true), "01:05:09");
  assert.equal(logic.clockTime(Date.UTC(2026, 0, 1, 11, 0, 0), false), "13:00");
});

test("one timer at the next local minute, then each minute", () => {
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, Date.UTC(2026, 6, 17, 12, 9));
  vm.advance(Date.UTC(2026, 6, 17, 12, 9) - vm.now);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:09");
  assert.deepEqual(
    vm.timers.map(({ intervalMs, repeat }) => ({ intervalMs, repeat })),
    [{ intervalMs: 60_000, repeat: true }],
  );
  assert.equal(vm.advance(120_000), 2);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11");
});

test("turning seconds on re-arms at once on seconds, and off again on minutes", () => {
  vm.advance(7_500);
  vm.setHost({ options: { "show-seconds": true } });
  assert.equal(state.seconds, true);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11:07", "shown at once");
  assert.equal(vm.timers.length, 1, "the minute timer is gone");
  vm.advance(500);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11:08");
  vm.advance(1_000);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11:09");
  vm.setHost({ options: { "show-seconds": false, "show-date": false } });
  assert.equal(state.showDate, false);
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, Date.UTC(2026, 6, 17, 12, 12));
  vm.setHost({ options: {} });
});

test("a new UTC offset shows at once", () => {
  vm.setHost({ region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: -240 } });
  assert.equal(logic.clockTime(state.now, state.seconds), "08:11");
});
