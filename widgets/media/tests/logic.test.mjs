// Unit tests of the media widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["media.read", "media.control"],
    mode: "passive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const track = (changes = {}) => ({
  player: "p1",
  title: "Beyond the northern lights",
  artists: ["The Quiet Expedition"],
  playing: true,
  canPrevious: true,
  canPlayPause: true,
  canNext: true,
  cover: "asset:00000000000000a1",
  ...changes,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);

test("with the read grant, it subscribes once with the cover and starts without a player", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service, params }) => ({ service, params })),
    [{ service: "media.subscribe", params: { cover: true } }],
  );
  assert.equal(state.media, null);
  assert.equal(state.unavailable, false);
  assert.equal(state.interactive, false);
  assert.equal(vm.timers.length, 0, "the host scrolls the title: no timer");
});

test("each update replaces the player; null is no player", () => {
  vm.push("media.subscribe", track());
  assert.deepEqual(state.media, track());
  vm.push("media.subscribe", null);
  assert.equal(state.media, null);
});

test("title and artists: one line each, fallbacks for missing text", () => {
  assert.equal(logic.title(track({ title: "Line one\nline two\r\n  three" })), "Line one line two three");
  assert.equal(logic.title(track({ title: null })), "Unknown title");
  assert.equal(logic.title(track({ title: " \n " })), "Unknown title");
  assert.equal(logic.artists(track({ artists: ["A", "B\nC", ""] })), "A, B C");
  assert.equal(logic.artists(track({ artists: [] })), "", "no artist row");
});

test("the cover is as tall as the text rows, one row without artists", () => {
  assert.equal(logic.coverClass(track(), "asset:1"), "cover tall");
  assert.equal(logic.coverClass(track({ artists: [] }), "asset:1"), "cover short");
  assert.equal(logic.coverClass(track(), null), "cover tall placeholder");
  assert.equal(logic.coverClass(null, null), "cover short placeholder", "no player: one row");
  assert.equal(logic.rootClass(true), "media with-cover");
  assert.equal(logic.rootClass(false), "media");
  assert.equal(logic.titleClass(true), "title scrolling");
  assert.equal(logic.titleClass(false), "title");
});

test("buttons: Interactive only, only the supported actions, in order", () => {
  assert.deepEqual(logic.controls(track(), false), [], "Passive: no buttons");
  assert.deepEqual(logic.controls(null, true), []);
  assert.deepEqual(
    logic.controls(track(), true).map(({ key, icon, label }) => [key, icon, label]),
    [
      ["previous", "skip-back", "Previous"],
      ["play-pause", "pause", "Pause"],
      ["next", "skip-forward", "Next"],
    ],
  );
  assert.deepEqual(
    logic.controls(track({ playing: false, canPrevious: false, canNext: false }), true).map(({ icon, label }) => [icon, label]),
    [["play", "Play"]],
    "unsupported actions are left out, not disabled",
  );
  assert.deepEqual(logic.controls(track({ canPrevious: false, canPlayPause: false, canNext: false }), true), []);
  vm.setHost({ mode: "interactive" });
  assert.equal(state.interactive, true);
  vm.setHost({ mode: "passive" });
  assert.equal(state.interactive, false);
});

test("a button acts on the player shown; a refusal changes nothing", async () => {
  vm.push("media.subscribe", track({ player: "p7" }));
  logic.activate("previous");
  logic.activate("play-pause");
  logic.activate("next");
  assert.deepEqual(
    vm.calls.slice(-3).map(({ service, params }) => [service, params]),
    [
      ["media.previous", { player: "p7" }],
      ["media.playPause", { player: "p7" }],
      ["media.next", { player: "p7" }],
    ],
  );
  vm.lastCall("media.previous").reject("stale_context");
  vm.lastCall("media.playPause").reject("unsupported");
  vm.lastCall("media.next").resolve(null);
  await settle();
  assert.deepEqual(state.media, track({ player: "p7" }));
  vm.push("media.subscribe", null);
  const before = vm.calls.length;
  logic.activate("next");
  assert.equal(vm.calls.length, before, "no player: no call");
});

test("the cover option subscribes again with or without the cover", () => {
  vm.push("media.subscribe", track());
  vm.setHost({ options: { "show-cover": false } });
  assert.equal(state.showCover, false);
  assert.deepEqual(
    live().map(({ params }) => params),
    [{ cover: false }],
    "the cover subscription is cancelled",
  );
  vm.setHost({ options: { "show-cover": false, "scroll-title": false } });
  assert.equal(state.scrollTitle, false);
  assert.equal(live().length, 1, "the title option keeps the subscription");
  vm.setHost({ options: {} });
  assert.equal(state.showCover, true);
  assert.equal(state.scrollTitle, true);
  assert.deepEqual(live().map(({ params }) => params), [{ cover: true }]);
});

test("a failed source shows the message, then subscribes again after 5 s", () => {
  vm.push("media.subscribe", track());
  const count = vm.subscriptions.length;
  assert.equal(vm.fail("media.subscribe", "unavailable"), 1);
  assert.equal(state.media, null, "the previous track is discarded");
  assert.equal(state.unavailable, true);
  assert.equal(live().length, 0);
  assert.equal(logic.RETRY_MS, 5_000);
  assert.equal(vm.advance(4_999), 0, "no retry before 5 s");
  assert.equal(vm.subscriptions.length, count);
  assert.equal(vm.advance(1), 1);
  assert.equal(vm.subscriptions.length, count + 1, "one new subscription");
  assert.equal(state.unavailable, true, "the message stays until the next state");
  vm.push("media.subscribe", null);
  assert.equal(state.unavailable, false);
  assert.equal(vm.timers.length, 0);
});

test("a failure again keeps retrying at the same cadence", () => {
  vm.fail("media.subscribe", "unavailable");
  vm.advance(5_000);
  vm.fail("media.subscribe", "unavailable");
  assert.equal(vm.timers.length, 1, "one pending retry, never two");
  vm.advance(5_000);
  vm.push("media.subscribe", track());
  assert.equal(state.unavailable, false);
  assert.deepEqual(state.media, track());
});

test("labels in French; provider text stays as is", () => {
  vm.setHost({ locale: "fr", messages: messages("fr"), mode: "interactive" });
  assert.deepEqual(
    logic.controls(track({ playing: false }), true).map(({ label }) => label),
    ["Précédent", "Lire", "Suivant"],
  );
  assert.equal(logic.controls(track(), true)[1].label, "Pause");
  assert.equal(logic.title(track({ title: null })), "Titre inconnu");
  assert.equal(logic.title(track({ title: "Unknown title" })), "Unknown title");
});
