// Without the permission to read the chat the logic asks the host nothing
// and says what it lacks, whatever the mode.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));

const vm = installRuntime({ host: { grants: [], mode: "interactive", messages } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("no grant: no subscription, no call, no timer, and the widget says so", () => {
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.equal(vm.timers.length, 0);
  assert.equal(logic.phase(state), "permission");
  assert.equal(vm.host.messages["no-permission"], "Permission needed to read Twitch chat.");
  assert.equal(logic.heading(state), "Twitch");
  assert.equal(logic.statusKey(state), "inactive");
  assert.equal(logic.dotClass(state), "dot");
  assert.equal(logic.failureKey(state), "");
  assert.equal(logic.selecting(state), false, "no channel selector");
  assert.equal(logic.composing(state), false, "no composer");
  assert.equal(logic.composerClass(state), "composer hidden");
});

test("no grant: a change of mode, of the lifetime row or of visibility asks nothing either", () => {
  vm.setHost({ mode: "passive" });
  vm.setHost({ options: { "passive-lifetime": 10 } });
  vm.setHost({ visible: false });
  vm.setHost({ visible: true });
  vm.setHost({ mode: "interactive" });
  vm.advance(600_000);
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.equal(vm.timers.length, 0);
  assert.equal(logic.phase(state), "permission");
  assert.deepEqual(state.shown, []);
});
