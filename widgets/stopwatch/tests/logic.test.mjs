// Unit tests of the stopwatch's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["stopwatch.read", "stopwatch.control"],
    mode: "passive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const shortcuts = { toggle: "Super+Alt+P", reset: "Super+Alt+R", bound: true };
const at = (elapsedMs, running, time) => ({ running, elapsedMs, at: time, shortcuts });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("with the read grant, it subscribes once and starts unknown, without timers", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service, params }) => ({ service, params })),
    [{ service: "stopwatch.subscribe", params: {} }],
  );
  assert.equal(state.stopwatch, null);
  assert.equal(state.interactive, false);
  assert.equal(vm.timers.length, 0, "the host advances the hundredths: no timer");
});

test("each update replaces the state; null and failures leave it unknown", () => {
  vm.push("stopwatch.subscribe", at(123_450, true, 10));
  assert.deepEqual(state.stopwatch, at(123_450, true, 10));
  vm.push("stopwatch.subscribe", at(0, false, 20));
  assert.deepEqual(state.stopwatch, at(0, false, 20), "a reset, or a new game");
  vm.push("stopwatch.subscribe", null);
  assert.equal(state.stopwatch, null, "no active game");
  assert.equal(logic.current({ ok: false }), null);
  assert.deepEqual(logic.current({ ok: true, value: at(5, false, 1) }), at(5, false, 1));
});

test("the buttons follow the mode, the control grant and a known state", () => {
  const known = at(0, false, 0);
  assert.equal(logic.showControls(false, known), false, "Passive: no buttons");
  assert.equal(logic.showControls(true, null), false);
  assert.equal(logic.showControls(true, known), true);
  vm.setHost({ mode: "interactive" });
  assert.equal(state.interactive, true);
  vm.setHost({ mode: "passive" });
  assert.equal(state.interactive, false);
});

test("a command's result applies at once; a failure changes nothing", async () => {
  vm.push("stopwatch.subscribe", at(5_000, false, 0));
  logic.toggle();
  vm.lastCall("stopwatch.toggle").resolve(at(5_000, true, 30));
  await settle();
  assert.deepEqual(state.stopwatch, at(5_000, true, 30));
  logic.reset();
  vm.lastCall("stopwatch.reset").reject("unavailable");
  await settle();
  assert.deepEqual(state.stopwatch, at(5_000, true, 30), "the host did not act");
  logic.reset();
  vm.lastCall("stopwatch.reset").resolve(at(0, false, 40));
  await settle();
  assert.deepEqual(state.stopwatch, at(0, false, 40));
  logic.toggle();
  vm.lastCall("stopwatch.toggle").resolve(null);
  await settle();
  assert.equal(state.stopwatch, null, "the game ended meanwhile");
  assert.deepEqual(
    vm.calls.map(({ service }) => service),
    ["stopwatch.toggle", "stopwatch.reset", "stopwatch.reset", "stopwatch.toggle"],
  );
});

test("labels, tooltips and the reminder, in English and French", () => {
  assert.equal(logic.toggleLabel(false), "Start");
  assert.equal(logic.toggleLabel(true), "Pause");
  assert.equal(logic.withChord("Start", "Super+Alt+P"), "Start (Super+Alt+P)");
  assert.equal(
    logic.reminder(shortcuts),
    "Super+Alt+P  Start / pause  ·  Super+Alt+R  Reset",
  );
  vm.setHost({ locale: "fr", messages: messages("fr") });
  assert.equal(logic.toggleLabel(false), "Démarrer");
  assert.equal(logic.toggleLabel(true), "Pause");
  assert.equal(logic.withChord("Réinitialiser", "Ctrl+Shift+R"), "Réinitialiser (Ctrl+Shift+R)");
  assert.equal(
    logic.reminder({ toggle: "Ctrl+Shift+P", reset: "Ctrl+Shift+R", bound: false }),
    "Ctrl+Shift+P  Démarrer / pause  ·  Ctrl+Shift+R  Réinitialiser",
    "the reminder stays when the chords are not bound",
  );
});
