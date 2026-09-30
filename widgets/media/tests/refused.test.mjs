// Without its grants the logic asks the host nothing and shows no buttons;
// with media.read alone it shows the track without buttons.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: [], mode: "interactive" } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("no grant: no subscription, no player, no buttons", () => {
  assert.equal(vm.subscriptions.length, 0);
  assert.equal(vm.calls.length, 0);
  assert.equal(state.media, null);
  assert.equal(state.unavailable, false);
  const known = {
    player: "p1",
    title: "T",
    artists: [],
    playing: false,
    canPrevious: true,
    canPlayPause: true,
    canNext: true,
    cover: null,
  };
  assert.deepEqual(logic.controls(known, true), [], "no media.control");
  vm.setHost({ options: { "show-cover": false } });
  assert.equal(vm.subscriptions.length, 0, "the cover option asks nothing without the grant");
});
