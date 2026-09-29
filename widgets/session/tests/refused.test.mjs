// Without the session.read grant the logic asks the host nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: [] } });
await loadLogic();
const { state } = await import("@overcrow/sdk");

test("no grant: no subscription, unknown duration", () => {
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.equal(state.session, null);
});
