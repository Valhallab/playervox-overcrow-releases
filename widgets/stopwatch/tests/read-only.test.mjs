// With stopwatch.read alone the logic shows the time but never the buttons.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: ["stopwatch.read"], mode: "interactive" } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("read only: subscribed, no buttons", () => {
  assert.equal(vm.subscriptions.length, 1);
  const known = { running: true, elapsedMs: 1, at: 0, shortcuts: { toggle: "", reset: "", bound: true } };
  vm.push("stopwatch.subscribe", known);
  assert.deepEqual(state.stopwatch, known);
  assert.equal(logic.showControls(state.interactive, state.stopwatch), false);
});
