// Unit tests of the Session's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: ["session.read"] } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("with the grant, it subscribes once and starts unknown", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service, params }) => ({ service, params })),
    [{ service: "session.subscribe", params: {} }],
  );
  assert.equal(state.session, null);
  assert.equal(vm.timers.length, 0, "the host advances the value: no timer");
});

test("each update re-anchors; null and failures show the unknown duration", () => {
  vm.push("session.subscribe", { elapsedMs: 5_263_000, at: 10 });
  assert.deepEqual(state.session, { elapsedMs: 5_263_000, at: 10 });
  vm.push("session.subscribe", { elapsedMs: 0, at: 20 });
  assert.deepEqual(state.session, { elapsedMs: 0, at: 20 }, "a new process");
  vm.push("session.subscribe", null);
  assert.equal(state.session, null, "no active game");
  vm.push("session.subscribe", { elapsedMs: 1, at: 30 });
  vm.fail("session.subscribe", "unavailable");
  assert.equal(state.session, null);
});

test("anchor", () => {
  assert.equal(logic.anchor({ ok: false }), null);
  assert.equal(logic.anchor({ ok: true, value: null }), null);
  assert.deepEqual(logic.anchor({ ok: true, value: { elapsedMs: 5, at: 1 } }), { elapsedMs: 5, at: 1 });
});
