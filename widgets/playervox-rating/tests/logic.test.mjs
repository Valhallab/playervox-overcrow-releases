// Unit tests of the PlayerVox Rating widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["playervox.rating.read", "playervox.rating.write"],
    mode: "passive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const SERVICE = "playervox.rating.subscribe";
const rated = (changes = {}) => ({
  gameplay: 96,
  art: 88,
  tech: 94,
  review: "Great.",
  publishedAt: null,
  offsetMinutes: null,
  ...changes,
});
const ready = (rating = rated(), changes = {}) => ({
  state: "ready",
  name: "Portal 2",
  offline: false,
  rating,
  ...changes,
});
const empty = (name) => ({ state: name, name: null, offline: false, rating: null });
const lastDraw = (ref) => vm.draws.filter((entry) => entry.ref === ref).at(-1)?.commands;
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);

/** What OverCrow does when it fills the form: one `input` per control. */
function seed(rating) {
  logic.scored("gameplay", rating?.gameplay ?? 50);
  logic.scored("art", rating?.art ?? 50);
  logic.scored("tech", rating?.tech ?? 50);
  logic.reviewed(rating?.review ?? "");
}

/** A rating shown and its form filled, in Interactive mode. */
function open(rating = rated()) {
  vm.setHost({ mode: "interactive" });
  vm.push(SERVICE, ready(rating));
  seed(rating);
  state.pending = 0;
  state.saved = false;
  state.error = "";
}

test("it subscribes once, draws the mark and a neutral badge, and shows Loading", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    [SERVICE],
  );
  assert.equal(state.rating, null);
  assert.deepEqual(logic.status(state.rating), { label: "loading", hint: "" });
  assert.ok(lastDraw("mark").length > 0, "the mark is drawn once");
  assert.deepEqual(lastDraw("badge")[2], ["rotate", 0], "a neutral, square badge");
  assert.equal(state.badgeClass, "badge", "no pulse without a rating");
  assert.equal(vm.timers.length, 0, "nothing ticks");
  assert.equal(logic.scoreText(state), "--");
  assert.equal(logic.formClass(state), "form hidden");
});

test("each state without a rating has its label and hint", () => {
  const texts = (name) => {
    vm.push(SERVICE, empty(name));
    assert.equal(logic.ready(state.rating), false);
    return logic.status(state.rating);
  };
  assert.deepEqual(texts("idle"), { label: "waiting", hint: "" });
  assert.deepEqual(texts("unsupported"), { label: "unsupported", hint: "steam-required" });
  assert.deepEqual(texts("loading"), { label: "loading", hint: "" });
  assert.deepEqual(texts("unavailable"), { label: "unavailable", hint: "retrying" });
  for (const key of ["waiting", "unsupported", "steam-required", "loading", "unavailable", "retrying"]) {
    assert.ok(messages("en")[key] && messages("fr")[key], key);
  }
});

test("Passive mode shows the published rating: its mean, grade and caption, never the form", () => {
  vm.setHost({ mode: "passive" });
  vm.push(SERVICE, ready());
  assert.equal(logic.ready(state.rating), true);
  assert.equal(logic.gameName(state.rating), "Portal 2");
  assert.equal(logic.shownScore(state), (96 + 88 + 94) / 3);
  assert.equal(logic.scoreText(state), "93", "92.67 shows 93");
  assert.equal(logic.caption(state), "published");
  assert.equal(logic.badgeName(state), "Grade S+, 93/100");
  assert.equal(logic.formClass(state), "form hidden");
  assert.equal(logic.editing(state), false);
  const badge = lastDraw("badge");
  assert.deepEqual(badge[2], ["rotate", 4]);
  assert.deepEqual(badge.find((command) => command[0] === "text").slice(3, 6), ["S+", 26, "#9ae600"]);

  vm.push(SERVICE, ready(null));
  assert.equal(logic.scoreText(state), "--");
  assert.equal(logic.caption(state), "unrated");
  assert.equal(logic.badgeName(state), "No grade");
  assert.deepEqual(lastDraw("badge")[2], ["rotate", 0]);
});

test("a draft in the form never shows in Passive mode", () => {
  open();
  logic.scored("gameplay", 10);
  assert.equal(logic.scoreText(state), "64", "the draft's mean while the form shows");
  vm.setHost({ mode: "passive" });
  assert.equal(logic.scoreText(state), "93", "the published rating in Passive mode");
  assert.equal(logic.caption(state), "published");
  assert.equal(logic.formClass(state), "form hidden");
  vm.setHost({ mode: "interactive" });
  assert.equal(logic.scoreText(state), "64", "the draft is still there");
  assert.equal(logic.caption(state), "draft");
});

test("the form follows the values OverCrow reports: a live mean, rounded half away from zero", () => {
  open(null);
  assert.equal(logic.formClass(state), "form");
  assert.deepEqual([state.gameplay, state.art, state.tech, state.review], [50, 50, 50, ""]);
  assert.equal(logic.scoreText(state), "50");
  assert.equal(logic.caption(state), "draft", "not rated yet: a draft");
  logic.scored("gameplay", 100);
  logic.scored("art", 100);
  logic.scored("tech", 75);
  assert.equal(logic.scoreText(state), "92", "91.67");
  assert.equal(logic.badgeName(state), "Grade S+, 92/100");
  logic.scored("tech", 72);
  assert.equal(logic.shownScore(state), 272 / 3);
  assert.equal(logic.scoreText(state), "91");
  assert.equal(logic.mean(72, 73, 72.5), 72.5);
  assert.equal(logic.mean(null, 73, 72), null);
  assert.equal(logic.valueText(null), "--");
  assert.equal(logic.valueText(72), "72");
});

test("the button is active for a first rating or a change, and never while sending, offline or in Passive mode", () => {
  open(null);
  assert.equal(logic.canPublish(state), true, "a first rating, at its defaults");
  assert.equal(logic.buttonLabel(state), "publish");

  open();
  assert.equal(logic.dirty(state), false);
  assert.equal(logic.canPublish(state), false, "nothing changed");
  assert.equal(logic.buttonLabel(state), "update");
  assert.equal(logic.caption(state), "published");
  logic.scored("art", 89);
  assert.equal(logic.dirty(state), true);
  assert.equal(logic.canPublish(state), true);
  assert.equal(logic.caption(state), "draft");
  logic.scored("art", 88);
  assert.equal(logic.canPublish(state), false, "back to the published values");
  logic.reviewed("Great!");
  assert.equal(logic.canPublish(state), true, "the review changed");
  logic.reviewed("");
  assert.equal(logic.canPublish(state), true, "an emptied review is a change");

  logic.publishing();
  assert.equal(logic.canPublish(state), false, "being sent");
  assert.equal(logic.buttonLabel(state), "saving");
  logic.submitted("rejected", { code: "unavailable" });

  vm.push(SERVICE, ready(rated(), { offline: true }));
  assert.equal(logic.editable(state), false);
  assert.equal(logic.canPublish(state), false, "offline");
  assert.equal(logic.rootClass(state), "rating offline");
  assert.equal(logic.formClass(state), "form", "the draft stays visible");
  vm.push(SERVICE, ready());
  assert.equal(logic.rootClass(state), "rating");
  assert.equal(logic.canPublish(state), true);
  vm.setHost({ mode: "passive" });
  assert.equal(logic.canPublish(state), false);
});

test("a review without one published compares to an empty text", () => {
  open(rated({ review: null }));
  assert.equal(logic.dirty(state), false);
  logic.reviewed("First words.");
  assert.equal(logic.dirty(state), true);
});

test("Publish, Saving, Saved, then Update again after the next change", () => {
  open(null);
  logic.scored("gameplay", 80);
  logic.publishing();
  assert.deepEqual([state.pending, state.saved, state.error], [1, false, ""]);
  assert.equal(logic.buttonLabel(state), "saving");
  assert.equal(vm.timers.length, 1, "one timer bounds the wait");
  logic.submitted("accepted", undefined);
  assert.deepEqual([state.pending, state.saved, state.error], [0, true, ""]);
  assert.equal(vm.timers.length, 0, "answered: no timer left");
  // The subscription sends the stored rating: the widget reads nothing.
  const calls = vm.calls.length;
  vm.push(SERVICE, ready(rated({ gameplay: 80, art: 50, tech: 50, review: null })));
  assert.equal(vm.calls.length, calls, "no new call");
  assert.equal(logic.buttonLabel(state), "saved");
  assert.equal(logic.canPublish(state), false, "saved: nothing to send");
  assert.equal(logic.caption(state), "published");
  logic.scored("tech", 60);
  assert.equal(state.saved, false, "a change ends Saved");
  assert.equal(logic.buttonLabel(state), "update");
  assert.equal(logic.canPublish(state), true);
});

test("a refused publication shows its message and keeps the draft", () => {
  const cases = [
    ["invalid_request", "error-invalid"],
    ["not_connected", "error-expired"],
    ["busy", "error-busy"],
    ["stale_context", "error-stale"],
    ["permission_denied", "error-forbidden"],
    ["unavailable", "error-unavailable"],
    ["timeout", "error-unavailable"],
    ["gesture_required", "error-unavailable"],
    [null, "error-unavailable"],
  ];
  for (const [code, key] of cases) {
    assert.equal(logic.errorKey(code), key);
    assert.ok(messages("en")[key] && messages("fr")[key], key);
  }
  open();
  logic.scored("gameplay", 40);
  logic.reviewed("Not that good.");
  logic.publishing();
  logic.submitted("rejected", { code: "busy" });
  assert.deepEqual([state.pending, state.saved, state.error], [0, false, "error-busy"]);
  assert.deepEqual([state.gameplay, state.review], [40, "Not that good."], "the draft is kept");
  assert.equal(logic.canPublish(state), true, "the user can send it again");
  assert.equal(logic.buttonLabel(state), "update");
  // A rejection without a code (never sent by OverCrow) is still an error.
  logic.publishing();
  logic.submitted("rejected", undefined);
  assert.equal(state.error, "error-unavailable");
  logic.publishing();
  assert.equal(state.error, "", "a new attempt clears the message");
  logic.submitted("cancelled", undefined);
  assert.deepEqual([state.pending, state.error], [0, ""], "a cancelled intent is not an error");
});

test("Ctrl+Enter in the review sends too; other keys do not", () => {
  open();
  logic.keyed("Enter", false);
  logic.keyed("a", true);
  assert.equal(state.pending, 0);
  logic.keyed("Enter", true);
  assert.equal(state.pending, 1);
  logic.submitted("accepted", undefined);
  assert.equal(state.pending, 0);
});

test("without any answer the button comes back after the bound", () => {
  open();
  logic.scored("gameplay", 1);
  logic.publishing();
  assert.equal(vm.advance(logic.ANSWER_MS - 1), 0);
  assert.equal(state.pending, 1);
  assert.equal(vm.advance(1), 1);
  assert.deepEqual([state.pending, state.error], [0, "error-unavailable"]);
  // A late answer changes nothing wrong.
  logic.submitted("accepted", undefined);
  assert.equal(state.pending, 0);
});

test("another game, or a rating that leaves, drops the last outcome", () => {
  open();
  logic.scored("gameplay", 40);
  logic.publishing();
  logic.submitted("rejected", { code: "unavailable" });
  assert.equal(state.error, "error-unavailable");
  vm.push(SERVICE, ready(rated(), { name: "Half-Life 2" }));
  assert.equal(state.error, "", "another game");
  state.saved = true;
  vm.push(SERVICE, empty("loading"));
  assert.equal(state.saved, false, "the rating left");
  // A new rating of the same game keeps the outcome.
  vm.push(SERVICE, ready());
  state.saved = true;
  vm.push(SERVICE, ready(rated({ art: 70 })));
  assert.equal(state.saved, true);
});

test("one pulse per new published rating, none for a draft, a status or the same score", () => {
  vm.setHost({ mode: "passive" });
  vm.push(SERVICE, empty("loading"));
  const before = state.badgeClass;
  vm.push(SERVICE, ready());
  const first = state.badgeClass;
  assert.notEqual(first, before, "a rating shows: pulse");
  assert.match(first, /^badge pulse-[ab]$/);
  vm.push(SERVICE, ready(rated({ review: "Edited." })));
  assert.equal(state.badgeClass, first, "same score: no pulse");
  vm.setHost({ mode: "interactive" });
  seed(rated());
  logic.scored("gameplay", 10);
  assert.equal(state.badgeClass, first, "a draft never pulses");
  vm.push(SERVICE, ready(rated({ gameplay: 10 })));
  assert.notEqual(state.badgeClass, first, "a new published score: pulse");
  const second = state.badgeClass;
  vm.push(SERVICE, empty("unavailable"));
  vm.push(SERVICE, ready(null));
  assert.equal(state.badgeClass, second, "no pulse for a status or --");
});

test("the badge is redrawn only when its grade or the theme changes", () => {
  open();
  const count = () => vm.draws.filter((entry) => entry.ref === "badge").length;
  const before = count();
  logic.scored("gameplay", 95);
  logic.reviewed("Still S+.");
  assert.equal(count(), before, "same grade: no draw");
  logic.scored("gameplay", 0);
  assert.equal(count(), before + 1, "another grade");
  vm.setHost({ theme: "light" });
  assert.equal(count(), before + 2);
  vm.setHost({ theme: "dark" });
});

test("the game's name is one line and the badge's name is bounded", () => {
  assert.equal(logic.gameName(ready(rated(), { name: "Portal\n 2" })), "Portal 2");
  assert.equal(logic.gameName(empty("loading")), "");
  assert.equal(logic.cutBytes("é".repeat(200), 256).length, 128);
  assert.equal(logic.oneLine("  a \r\n b  "), "a b");
});

test("a failed subscription shows unavailable and subscribes again 5 s later", () => {
  vm.push(SERVICE, ready());
  vm.fail(SERVICE, "unavailable");
  assert.equal(state.rating.state, "unavailable");
  assert.equal(live().length, 0);
  assert.equal(vm.advance(logic.RETRY_MS - 1), 0);
  assert.equal(vm.advance(1), 1);
  assert.equal(live().length, 1, "subscribed again");
});

test("French and English have the same messages", () => {
  assert.deepEqual(Object.keys(messages("fr")), Object.keys(messages("en")));
});
