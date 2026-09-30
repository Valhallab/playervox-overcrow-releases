// Without its grants the logic asks the host nothing and shows no buttons.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: [], mode: "interactive" } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("no grant: no subscription, unknown time, no buttons", () => {
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.equal(state.stopwatch, null);
  const known = { running: false, elapsedMs: 0, at: 0, shortcuts: { toggle: "", reset: "", bound: false } };
  assert.equal(logic.showControls(true, known), false, "no stopwatch.control");
});
