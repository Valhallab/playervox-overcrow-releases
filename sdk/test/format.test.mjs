import assert from "node:assert/strict";
import { test } from "node:test";

import {
  delayToNext,
  formatDate,
  formatDuration,
  formatNumber,
  formatTime,
  localTime,
} from "../dist/format.js";

const NBSP = " ";

test("numbers follow the user's separators, not the language", () => {
  assert.equal(formatNumber(1234.5, { format: "us" }), "1,234.5");
  assert.equal(formatNumber(1234.5, { format: "fr" }), `1${NBSP}234,5`);
  assert.equal(formatNumber(1234.5, { format: "de" }), "1.234,5");
  assert.equal(formatNumber(1234567.891, { format: "us" }), "1,234,567.891");
  assert.equal(formatNumber(999, { format: "fr" }), "999");
  assert.equal(formatNumber(-1234, { format: "us" }), "-1,234");
  assert.equal(formatNumber(1284, { format: "us", grouping: false }), "1284");
});

test("fraction digits are bounded and padded", () => {
  assert.equal(formatNumber(0.8, { format: "us", maximumFractionDigits: 1 }), "0.8");
  assert.equal(formatNumber(2, { format: "fr", minimumFractionDigits: 1 }), "2,0");
  assert.equal(formatNumber(1.23456, { format: "us" }), "1.235", "three digits by default");
  assert.equal(formatNumber(1.5, { format: "us", maximumFractionDigits: 0 }), "2");
  assert.equal(formatNumber(61.25, { format: "de", maximumFractionDigits: 1 }), "61,3");
  assert.equal(formatNumber(-0.0001, { format: "us" }), "0", "no negative zero");
  assert.equal(formatNumber(5, { format: "us", minimumFractionDigits: 99 }).length, 22);
});

test("non-finite and huge numbers are written as JavaScript does", () => {
  assert.equal(formatNumber(Number.NaN, { format: "us" }), "NaN");
  assert.equal(formatNumber(-Infinity, { format: "fr" }), "-Infinity");
  assert.equal(formatNumber(1e21, { format: "us" }), "1e+21");
});

// 2026-07-17T14:08:42.250Z
const INSTANT = Date.UTC(2026, 6, 17, 14, 8, 42, 250);

test("local time applies the offset, whole or not", () => {
  assert.deepEqual(localTime(INSTANT, 120), {
    year: 2026,
    month: 7,
    day: 17,
    weekday: 5,
    hour: 16,
    minute: 8,
    second: 42,
    millisecond: 250,
  });
  const kolkata = localTime(INSTANT, 330);
  assert.equal(`${kolkata.hour}:${kolkata.minute}`, "19:38");
  const honolulu = localTime(INSTANT, -600);
  assert.equal(`${honolulu.hour}`, "4");
  // Across midnight and a year.
  const newYear = localTime(Date.UTC(2026, 11, 31, 23, 30), 60);
  assert.deepEqual([newYear.year, newYear.month, newYear.day, newYear.hour], [2027, 1, 1, 0]);
});

test("dates are numeric in the user's order", () => {
  assert.equal(formatDate(INSTANT, { order: "dmy", offsetMinutes: 0 }), "17/07/2026");
  assert.equal(formatDate(INSTANT, { order: "mdy", offsetMinutes: 0 }), "07/17/2026");
  assert.equal(formatDate(INSTANT, { order: "ymd", offsetMinutes: 0 }), "2026-07-17");
  assert.equal(formatDate(Date.UTC(2026, 6, 17, 23), { order: "dmy", offsetMinutes: 60 }), "18/07/2026");
});

test("times are 24-hour and zero padded", () => {
  assert.equal(formatTime(INSTANT, { offsetMinutes: 0 }), "14:08");
  assert.equal(formatTime(INSTANT, { offsetMinutes: 0, seconds: true }), "14:08:42");
  assert.equal(formatTime(Date.UTC(2026, 0, 1, 23, 5, 7), { offsetMinutes: 60, seconds: true }), "00:05:07");
});

test("durations truncate like a stopwatch", () => {
  assert.equal(formatDuration(0, { format: "us" }), "00:00");
  assert.equal(formatDuration(245_678, { format: "us" }), "04:05");
  assert.equal(formatDuration(245_678, { format: "us", hundredths: true }), "04:05.67");
  assert.equal(formatDuration(245_678, { format: "fr", hundredths: true }), "04:05,67");
  assert.equal(formatDuration(3_723_000, { format: "us" }), "1:02:03");
  assert.equal(formatDuration(5_000, { format: "us", hours: true }), "0:00:05");
  assert.equal(formatDuration(360_000_000, { format: "us" }), "100:00:00");
  assert.equal(formatDuration(-61_000, { format: "us" }), "-01:01");
  assert.equal(formatDuration(-5, { format: "us" }), "00:00");
  assert.equal(formatDuration(Number.NaN, { format: "us" }), "00:00");
});

test("the next boundary is in local time", () => {
  const region = { offsetMinutes: 0 };
  assert.equal(delayToNext("second", INSTANT, region), 750);
  assert.equal(delayToNext("minute", INSTANT, region), 17_750);
  assert.equal(delayToNext("hour", INSTANT, region), 51 * 60_000 + 17_750);
  // 23:59:59.500 local in UTC+5:30 is 18:29:59.500 UTC.
  const lateEvening = Date.UTC(2026, 6, 17, 18, 29, 59, 500);
  assert.equal(delayToNext("day", lateEvening, { offsetMinutes: 330 }), 500);
  // Exactly on a boundary: a whole period.
  assert.equal(delayToNext("minute", Date.UTC(2026, 6, 17, 14, 9), region), 60_000);
  // Before 1970 in local time.
  assert.equal(delayToNext("second", -250, region), 250);
});

// Europe/Paris: summer time starts on 2026-03-29 at 01:00 UTC (02:00 → 03:00
// local) and ends on 2026-10-25 at 01:00 UTC (03:00 → 02:00 local).
const SPRING = Date.UTC(2026, 2, 29, 1);
const AUTUMN = Date.UTC(2026, 9, 25, 1);

test("a local boundary never passes the next offset change", () => {
  const winter = { offsetMinutes: 60, nextChangeAt: SPRING };
  // 01:30 local: the next local day would be 22.5 h away with the winter
  // offset, but the offset changes in 30 min.
  const halfPastOne = SPRING - 30 * 60_000;
  assert.equal(delayToNext("day", halfPastOne, winter), 30 * 60_000);
  assert.equal(delayToNext("hour", halfPastOne, winter), 30 * 60_000);
  // Whole-minute offsets keep minute boundaries in place.
  assert.equal(delayToNext("minute", SPRING - 20_000, winter), 20_000);
  // After the change the host sends the new offset: 03:00 local.
  const summer = { offsetMinutes: 120, nextChangeAt: AUTUMN };
  assert.equal(formatTime(SPRING, summer), "03:00");
  assert.equal(formatTime(SPRING - 1, { offsetMinutes: 60, seconds: true }), "01:59:59");
  assert.equal(delayToNext("day", SPRING, summer), 21 * 3_600_000);
  // A change already past is ignored until the host sends the new region.
  assert.equal(delayToNext("hour", SPRING + 60_000, winter), 59 * 60_000);
});

test("the autumn change repeats a local hour", () => {
  const summer = { offsetMinutes: 120, nextChangeAt: AUTUMN };
  const before = AUTUMN - 60_000;
  assert.equal(formatTime(before, summer), "02:59");
  assert.equal(delayToNext("hour", before, summer), 60_000);
  assert.equal(formatTime(AUTUMN, { offsetMinutes: 60 }), "02:00");
});
