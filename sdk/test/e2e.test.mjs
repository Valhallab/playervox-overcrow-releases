// The end-to-end Clock, packaged by the widget CLI: reproducible, a classic
// script without imports, and working over the runtime surface in a fresh
// realm. The host repository runs the same logic.js in the real widget VM.
// The CLI is built first (`cargo build -p overcrow-widget-cli`); set
// OVERCROW_WIDGET to use another binary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { HOST, installRuntime } from "./fake-runtime.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.platform === "win32" ? "overcrow-widget.exe" : "overcrow-widget";
const cli = process.env.OVERCROW_WIDGET ?? join(root, "..", "target", "debug", executable);
const out = join(root, "build", "e2e");

/** The entries of a stored (uncompressed) zip, as `.ocpkg` v1 is. */
function entries(archive) {
  const files = new Map();
  let at = 0;
  while (archive.readUInt32LE(at) === 0x04034b50) {
    const size = archive.readUInt32LE(at + 18);
    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const name = archive.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;
    files.set(name, archive.subarray(start, start + size));
    at = start + size;
  }
  return files;
}

function build(name) {
  assert.ok(existsSync(cli), `build the widget CLI first: cargo build -p overcrow-widget-cli (${cli})`);
  mkdirSync(out, { recursive: true });
  const target = join(out, name);
  rmSync(target, { force: true });
  execFileSync(cli, ["package", join(root, "test", "e2e", "clock"), "--no-typecheck", "--out", target], {
    stdio: "ignore",
  });
  return readFileSync(target);
}

const first = build("clock-1.ocpkg");
const archive = build("clock-2.ocpkg");
const bundle = entries(archive).get("logic.js").toString("utf8");

test("the package is reproducible and its logic has no module syntax", () => {
  assert.ok(first.equals(archive), "two runs give identical bytes");
  assert.match(bundle, /^\/\*! @overcrow\/sdk 1\.0\.0 \| MIT-0 \|/);
  assert.doesNotMatch(bundle, /(^|[;})\s])(import|export)[\s{*]/);
  assert.doesNotThrow(() => new vm.Script(bundle));
  assert.ok(bundle.includes("globalThis.overcrow"), "the runtime global is never renamed");
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
