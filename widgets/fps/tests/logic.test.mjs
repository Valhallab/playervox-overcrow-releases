// Unit tests of the FPS widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const MESSAGES = {"old": "old", "label": "{fps} frames per second", "label-old": "{fps} frames per second, last reading", "label-none": "Frame rate unavailable", "hint-old": "Last FPS reading. No new measurement has arrived for at least three seconds.", "hint-ready": "Frames the game presented, observed from outside the game: its presentation rate, not the refresh rate of the display.", "hint-waiting": "Waiting for frames from the game window. A paused game keeps this value unavailable.", "hint-unsupported": "The frame rate of this game window cannot be measured on this system.", "hint-permission_denied": "OverCrow was denied access to the game's frame events.", "hint-ambiguous": "Several presentation sources prevent a reliable FPS measurement.", "hint-events_lost": "Frame events were lost. No reliable FPS measurement is available.", "hint-unavailable": "FPS capture is not available. See Diagnostics in the Control Center."};
const STATUSES = ["ready", "waiting", "unsupported", "permission_denied", "ambiguous", "events_lost", "unavailable"];

const vm = installRuntime({ host: { grants: ["fps.read"], messages: MESSAGES } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

test("it subscribes once and waits for a first reading", () => {
  assert.deepEqual(vm.subscriptions.map(({ service }) => service), ["fps.subscribe"]);
  assert.deepEqual(
    { fps: state.fps, stale: state.stale, status: state.status, showLabel: state.showLabel },
    { fps: null, stale: false, status: "waiting", showLabel: true },
  );
  assert.equal(vm.timers.length, 0, "the host marks a reading stale: no timer");
});

test("value, marker and colour", () => {
  assert.equal(logic.fpsValue(null), "—");
  assert.equal(logic.fpsValue(144), "144");
  assert.equal(logic.isOld(144, true), true);
  assert.equal(logic.isOld(null, true), false, "no marker without a value");
  assert.equal(logic.valueClass(144, false), "value");
  assert.equal(logic.valueClass(144, true), "value muted");
  assert.equal(logic.valueClass(null, false), "value muted");
  assert.equal(logic.oldMarker(), "\u00a0· old");
});

test("each status has its own sentence; an old reading explains itself", () => {
  const sentences = STATUSES.map((status) => logic.fpsTooltip(null, false, status));
  assert.equal(new Set(sentences).size, STATUSES.length);
  assert.ok(sentences.every((sentence) => !sentence.startsWith("hint-")), "every key exists");
  assert.equal(logic.fpsTooltip(144, true, "ready"), MESSAGES["hint-old"]);
  assert.equal(logic.fpsTooltip(144, false, "ready"), MESSAGES["hint-ready"]);
});

test("accessible labels", () => {
  assert.equal(logic.fpsLabel(144, false), "144 frames per second");
  assert.equal(logic.fpsLabel(144, true), "144 frames per second, last reading");
  assert.equal(logic.fpsLabel(null, false), "Frame rate unavailable");
});

test("updates, the stale transition and the end of the subscription", () => {
  vm.push("fps.subscribe", { fps: 144, stale: false, status: "ready" });
  assert.deepEqual([state.fps, state.stale, state.status], [144, false, "ready"]);
  vm.push("fps.subscribe", { fps: 144, stale: true, status: "ready" });
  assert.equal(state.stale, true);
  vm.push("fps.subscribe", { fps: null, stale: false, status: "unavailable" });
  assert.deepEqual([state.fps, state.status], [null, "unavailable"], "the service stopped (W.2)");
  vm.fail("fps.subscribe", "permission_denied");
  assert.deepEqual([state.fps, state.stale, state.status], [null, false, "unavailable"]);
});

test("the label row applies at once", () => {
  vm.setHost({ options: { "show-label": false } });
  assert.equal(state.showLabel, false);
  vm.setHost({ options: {} });
  assert.equal(state.showLabel, true);
});
