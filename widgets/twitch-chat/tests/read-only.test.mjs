// With the permission to read alone the logic shows the chat and the
// channel controls, and no composer: nothing can be sent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const vm = installRuntime({ host: { grants: ["twitch.chat.read"], mode: "interactive" } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const SERVICE = "twitch.chat.subscribe";

test("the read grant alone: the chat and its channel, no composer", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    [SERVICE],
  );
  vm.push(SERVICE, {
    account: "connected",
    channel: "juniper_plays",
    joinState: "joined",
    failure: null,
    favorites: [],
    canSend: true,
    generation: 1,
    reset: true,
    messages: [
      {
        id: "m1",
        author: "Juniper",
        color: null,
        badges: [],
        fragments: [{ text: "good evening chat" }],
        reply: null,
        deleted: false,
        receivedAt: vm.now,
      },
    ],
    removed: [],
    skipped: 0,
  });
  assert.equal(logic.phase(state), "chat");
  assert.equal(state.shown.length, 1);
  assert.equal(logic.composing(state), false);
  assert.equal(logic.composerClass(state), "composer hidden");
  assert.equal(logic.canSubmit(state), false);

  // Whatever the form reports, nothing is awaited.
  logic.drafted("hello");
  logic.keyed("Enter");
  logic.sendPressed();
  assert.equal(state.sending, false);
  assert.equal(vm.timers.length, 0);

  // The channel controls belong to the read permission.
  logic.toggleSelector();
  assert.equal(logic.selecting(state), true);
  logic.channelTyped("river_otter");
  logic.join();
  assert.deepEqual(vm.lastCall("twitch.chat.join").params, { channel: "river_otter" });
});
