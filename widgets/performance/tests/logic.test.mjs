// Unit tests of the Performance widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const MESSAGES = {"label": "Performance", "waiting": "Waiting for game data…", "no-metric": "No metric selected", "cpu": "CPU", "ram": "RAM", "cpu-temperature": "CPU°", "gpu-temperature": "GPU°", "fps": "FPS", "old": "old", "hint-cpu": "Game CPU use across all logical processors.", "hint-ram": "Game resident memory.", "hint-cpu-temperature": "Host CPU temperature.", "hint-gpu-temperature": "Host GPU temperature.", "hint-fps": "Observed presentation rate.", "hint-fps-old": "Last FPS reading. No new measurement has arrived for at least three seconds.", "name-cpu": "Game CPU use {value} {unit}", "name-ram": "Game memory {value} {unit}", "name-cpu-temperature": "CPU temperature {value} {unit}", "name-gpu-temperature": "GPU temperature {value} {unit}", "name-fps": "{value} frames per second", "name-fps-old": "{value} frames per second, last reading"};
const GB = 1024 ** 3;
const ALL = { cpu: true, ram: true, cpuTemperature: true, gpuTemperature: true, fps: true, fahrenheit: false };
const sample = (fields = {}) => ({
  cpu: 23,
  ram: 3 * GB,
  cpuTemperature: 61,
  gpuTemperature: 67,
  sources: { cpuTemperature: true, gpuTemperature: true },
  ...fields,
});
const FRESH = { fps: 144, stale: false };

const vm = installRuntime({ host: { grants: ["telemetry.read", "fps.read"], messages: MESSAGES } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const live = (service) => vm.subscriptions.filter((entry) => entry.service === service && !entry.cancelled);
const shown = (rows) => rows.map((row) => `${row.label} ${row.value}${row.unit}`);

test("it subscribes to both services and runs no timer", () => {
  assert.deepEqual(vm.subscriptions.map(({ service }) => service), ["telemetry.subscribe", "fps.subscribe"]);
  assert.deepEqual([state.telemetry, state.rate, state.layout], [null, null, "vertical"]);
  assert.equal(vm.timers.length, 0, "the host marks a frame rate stale");
});

test("rows in the fixed order, each value with its unit", () => {
  assert.deepEqual(shown(logic.rows(sample(), FRESH, ALL)), [
    "CPU 23.0\u2009%",
    "RAM 3.0\u2009GB",
    "CPU° 61.0\u2009°C",
    "GPU° 67.0\u2009°C",
    "FPS 144",
  ]);
  const rows = logic.rows(sample(), FRESH, ALL);
  assert.deepEqual(rows.map((row) => row.first), [true, false, false, false, false]);
  assert.deepEqual(rows.map((row) => row.name), [
    "Game CPU use 23.0 %",
    "Game memory 3.0 GB",
    "CPU temperature 61.0 °C",
    "GPU temperature 67.0 °C",
    "144 frames per second",
  ]);
  assert.equal(rows[0].hint, MESSAGES["hint-cpu"]);
  assert.equal(rows[4].hint, MESSAGES["hint-fps"]);
});

test("a row needs its toggle and a reading; nothing is shown as unavailable", () => {
  const partial = sample({ cpu: null, cpuTemperature: null, sources: { cpuTemperature: false, gpuTemperature: true } });
  assert.deepEqual(shown(logic.rows(partial, { fps: null, stale: false }, ALL)), ["RAM 3.0\u2009GB", "GPU° 67.0\u2009°C"]);
  assert.deepEqual(logic.rows(sample(), FRESH, { ...ALL, cpu: false, ram: false, fps: false }).map((row) => row.key), [
    "cpu-temperature",
    "gpu-temperature",
  ]);
  assert.equal(logic.rows(sample(), FRESH, { ...ALL, fps: false }).at(-1).key, "gpu-temperature");
  assert.deepEqual(logic.rows(null, null, ALL), []);
  assert.ok(
    logic.rows(sample(), FRESH, ALL).every((row) => !/[—]|N\/A/.test(row.value)),
    "no dash or N/A",
  );
});

test("CPU is the host's share of the machine, one decimal, coloured at 80 and 95", () => {
  const cpu = (value) => logic.rows(sample({ cpu: value }), null, ALL)[0];
  assert.deepEqual([cpu(0).value, cpu(0).valueClass], ["0.0", "value"]);
  assert.deepEqual([cpu(79.99).value, cpu(79.99).valueClass], ["80.0", "value"], "compared before rounding");
  assert.equal(cpu(80).valueClass, "value warning");
  assert.equal(cpu(94.99).valueClass, "value warning");
  assert.equal(cpu(95).valueClass, "value critical");
  assert.deepEqual([cpu(100).value, cpu(100).valueClass], ["100.0", "value critical"]);
});

test("memory in binary gigabytes, never coloured", () => {
  const ram = (bytes) => logic.rows(sample({ ram: bytes }), null, { ...ALL, cpu: false })[0];
  assert.equal(ram(6_900_000_000).value, "6.4");
  assert.equal(ram(64 * GB).valueClass, "value");
  assert.equal(ram(0).value, "0.0");
  assert.equal(ram(1234.56 * GB).value, "1,234.6");
});

test("temperatures convert before rounding: the parity vectors", () => {
  for (const [celsius, c, f] of [
    [0, "0.0", "32.0"],
    [62.345, "62.3", "144.2"],
    [37.677, "37.7", "99.8"],
    [-12.678, "-12.7", "9.2"],
  ]) {
    assert.equal(logic.temperature(celsius, false).value, c, `${celsius} °C`);
    assert.equal(logic.temperature(celsius, true).value, f, `${celsius} °F`);
  }
  assert.equal(logic.temperature(61, true).unit, "°F");
  assert.equal(logic.temperature(61, false).unit, "°C");
});

test("temperature thresholds stay in °C in °F mode; FPS never coloured", () => {
  const fahrenheit = { ...ALL, cpu: false, ram: false, fahrenheit: true };
  const [cpu, gpu] = logic.rows(sample({ cpuTemperature: 80, gpuTemperature: 79.9 }), null, fahrenheit);
  assert.deepEqual([cpu.value, cpu.valueClass], ["176.0", "value warning"]);
  assert.deepEqual([gpu.value, gpu.valueClass], ["175.8", "value"]);
  const [hot] = logic.rows(sample({ cpuTemperature: 90 }), null, fahrenheit);
  assert.equal(hot.valueClass, "value critical");
  assert.equal(logic.severity(89.99, 80, 90), "value warning");
  const [fps] = logic.rows(null, { fps: 999, stale: false }, ALL);
  assert.equal(fps.valueClass, "value");
});

test("a stale frame rate keeps its number, marked old", () => {
  const [row] = logic.rows(null, { fps: 143.6, stale: true }, ALL);
  assert.deepEqual([row.value, row.unit, row.hint, row.name], [
    "144",
    "\u2009old",
    MESSAGES["hint-fps-old"],
    "144 frames per second, last reading",
  ]);
});

test("numbers follow the host's number format, not the language", () => {
  vm.setHost({ region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 0 } });
  assert.deepEqual(shown(logic.rows(sample({ ram: 1234.56 * GB }), { fps: 1200, stale: false }, ALL)), [
    "CPU 23,0\u2009%",
    "RAM 1\u00a0234,6\u2009GB",
    "CPU° 61,0\u2009°C",
    "GPU° 67,0\u2009°C",
    "FPS 1\u00a0200",
  ]);
  vm.setHost({ region: { numberFormat: "de", dateOrder: "dmy", offsetMinutes: 0 } });
  assert.equal(logic.rows(sample(), null, ALL)[0].value, "23,0");
  vm.setHost({ region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 } });
});

test("the empty panel says why", () => {
  assert.equal(logic.emptyMessage(ALL), "Waiting for game data…");
  const none = { cpu: false, ram: false, cpuTemperature: false, gpuTemperature: false, fps: false, fahrenheit: true };
  assert.equal(logic.emptyMessage(none), "No metric selected");
  assert.equal(logic.rootClass("horizontal"), "performance horizontal");
  assert.equal(logic.rootClass("vertical"), "performance vertical");
  assert.equal(logic.rootClass("list"), "performance vertical", "an unknown value is the default");
});

test("updates, the game going away and failures", () => {
  vm.push("telemetry.subscribe", sample());
  vm.push("fps.subscribe", { fps: 144, stale: false, status: "ready" });
  assert.equal(state.telemetry.cpu, 23);
  assert.deepEqual(state.rate, FRESH);
  vm.push("telemetry.subscribe", null);
  assert.equal(state.telemetry, null, "no game");
  vm.fail("telemetry.subscribe", "unavailable");
  assert.equal(state.telemetry, null);
});

test("the menu applies at once, and the FPS row's toggle owns the FPS subscription", () => {
  vm.setHost({ options: { layout: "horizontal", "temperature-unit": "fahrenheit", "show-ram": false } });
  assert.equal(state.layout, "horizontal");
  assert.equal(state.shown.fahrenheit, true);
  assert.equal(state.shown.ram, false);
  assert.equal(live("fps.subscribe").length, 1);
  vm.setHost({ options: { "show-fps": false } });
  assert.equal(live("fps.subscribe").length, 0, "no FPS row, no measurement");
  assert.equal(state.rate, null);
  vm.setHost({ options: { "show-fps": false, "show-cpu": false } });
  assert.equal(live("fps.subscribe").length, 0);
  vm.setHost({ options: {} });
  assert.equal(live("fps.subscribe").length, 1, "subscribed again");
  vm.fail("fps.subscribe", "unavailable");
  assert.equal(state.rate, null);
  vm.setHost({ options: { "show-fps": false } });
  vm.setHost({ options: {} });
  assert.equal(live("fps.subscribe").length, 1, "a failed subscription is retried by the toggle");
});
