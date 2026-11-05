// Game events not allowed: the night stays, with where to allow them; once
// the user allows them, the widget follows at once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { NIGHT_END, SERVICE, START, fakeStorage, messages, send, settle, texts, value } from "./fake.mjs";

const vm = installRuntime({ now: START, host: { messages: messages("en"), grants: ["storage"] } });
const store = fakeStorage({ cetus: NIGHT_END });
await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, store);
const subscriptions = () => vm.subscriptions.filter((entry) => entry.service === SERVICE).length;

test("refused: the stored night, and where to allow game events", async () => {
  vm.fail(SERVICE, "permission_denied");
  await settle(vm, store);
  assert.equal(state.view.big, "30:00");
  assert.equal(state.view.hint, "Allow “Warframe: Eidolons” in the Control Center.");
  assert.equal(state.view.hintCls, "hint tone-warning");
  // One line keeps the night, then says what is wrong; its label says it all.
  assert.equal(texts(state.view).line, "Night 30:00 Access denied");
  assert.equal(state.view.lineSubCls, "line-sub tone-warning");
  assert.equal(state.view.lineLabel, "Night left 30:00. Allow \u201cWarframe: Eidolons\u201d in the Control\u00a0Center.");
});

test("allowed in the Control Center: followed at once", async () => {
  const before = subscriptions();
  vm.setHost({ grants: ["storage", "gameEvents"] });
  assert.equal(subscriptions(), before + 1);
  await send(vm, store, value());
  assert.equal(state.view.hint, "The timer starts at the first spawn.");
});
