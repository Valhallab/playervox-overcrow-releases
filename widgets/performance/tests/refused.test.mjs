// Without its grants the logic asks the host nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: [] } });
await loadLogic();
const { state } = await import("@overcrow/sdk");

test("no grant: no subscription, nothing to show", () => {
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.deepEqual([state.telemetry, state.rate], [null, null]);
  vm.setHost({ options: { "show-fps": false } });
  vm.setHost({ options: {} });
  assert.equal(vm.subscriptions.length, 0, "the FPS toggle asks nothing without fps.read");
});
