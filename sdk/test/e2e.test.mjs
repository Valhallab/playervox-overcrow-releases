// The end-to-end Clock bundle: reproducible, a classic script without
// imports, and working over the runtime surface in a fresh realm. The host
// repository runs the same bundle in the real widget VM.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { HOST, installRuntime } from "./fake-runtime.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "build", "e2e", "clock.logic.js");
const build = () => {
  execFileSync(process.execPath, [join(root, "scripts", "bundle-e2e.mjs")], { stdio: "ignore" });
  return readFileSync(bundlePath, "utf8");
};

const first = build();
const bundle = build();

test("the bundle is reproducible and has no module syntax", () => {
  assert.equal(first, bundle);
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m);
  assert.doesNotThrow(() => new vm.Script(bundle));
});

test("the Clock runs over the runtime surface", () => {
  const control = installRuntime({
    ...HOST,
    region: { numberFormat: "us", dateOrder: "dmy", offsetMinutes: 120 },
    options: { seconds: false },
  });
  const surface = globalThis.overcrow;
  delete globalThis.overcrow;
  const context = vm.createContext({ overcrow: surface });
  vm.runInContext(bundle, context);

  const table = control.table;
  assert.equal(table.length, 10, "one function per expression of clock.view.json");
  const state = surface.state;
  const scope = {};
  assert.equal(table[0](state, scope), "clock", "no message: the key");
  assert.match(table[1](state, scope), /^\d\d:\d\d$/);
  assert.equal(table[2](state, scope), true);
  assert.match(table[3](state, scope), /^\d\d\/\d\d\/\d{4}$/);
  const zone = table[4](state, scope)[0];
  const zoneScope = Object.create(scope, { zone: { value: zone } });
  assert.equal(table[5](state, zoneScope), "utc");
  assert.match(table[6](state, zoneScope), /^\d\d:\d\d UTC\+0$/);
  assert.equal(table[7](state, scope), "Show seconds");
  assert.equal(table[8](state, scope), false);

  // One minute-aligned timer, one dial drawing.
  assert.equal(control.timers.size, 1);
  assert.equal([...control.timers.values()][0].repeat, false);
  assert.equal(control.draws.at(-1).ref, "dial");
  assert.equal(control.draws.at(-1).commands.length, 5);
  assert.deepEqual(control.logs, [{ level: "debug", text: "clock started" }]);

  // The toggle's handler switches to seconds and re-arms the clock.
  table[9](state, scope, { type: "change", detail: { value: true } });
  assert.equal(state.seconds, true);
  assert.match(table[1](state, scope), /^\d\d:\d\d:\d\d$/);
  assert.equal(control.timers.size, 1, "the minute timer was cancelled");
  const [id, timer] = [...control.timers][0];
  assert.ok(timer.intervalMs <= 1000);
  control.fire(id);
  assert.equal(control.timers.size, 1, "re-armed after a tick");

  control.menu("add-zone");
  assert.equal(state.zones.length, 2);
  assert.match(table[6](state, Object.create(scope, { zone: { value: state.zones[1] } })), /UTC-5$/);
});
