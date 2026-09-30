// Unit tests of the PlayerVox Score widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["playervox.score.read"],
    mode: "passive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const nulls = { gameplay: null, art: null, tech: null };
const score = (changes = {}) => ({
  state: "ready",
  name: "Portal 2",
  score: 94.2,
  grade: "S+",
  ratingsCount: 1284,
  criteria: { gameplay: 97, art: 72.5, tech: 0 },
  ...changes,
});
const empty = (state) => ({ state, name: null, score: null, grade: "--", ratingsCount: 0, criteria: nulls });
const lastDraw = (ref) => vm.draws.filter((entry) => entry.ref === ref).at(-1)?.commands;
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);

test("it subscribes once, draws the mark and a neutral badge, and shows Loading", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    ["playervox.score.subscribe"],
  );
  assert.equal(state.score, null);
  assert.equal(logic.status(state.score).label, "loading");
  assert.ok(lastDraw("mark").length > 0, "the mark is drawn once");
  assert.equal(state.badgeClass, "badge", "no pulse without a score");
  assert.equal(vm.timers.length, 0, "the host animates the pulse: no timer");
});

test("the badge follows the host's grade: square and neutral for --, turned for a grade", () => {
  vm.push("playervox.score.subscribe", empty("loading"));
  const neutral = lastDraw("badge");
  assert.deepEqual(neutral[2], ["rotate", 0]);
  assert.ok(neutral.some((command) => command[0] === "fill" && command[1] === "#27272a80"));
  assert.ok(!neutral.some((command) => command[0] === "stroke" && command[1] === "#a3e63505"), "no glow");

  vm.push("playervox.score.subscribe", score());
  const rated = lastDraw("badge");
  assert.deepEqual(rated[2], ["rotate", 4]);
  assert.equal(rated.filter((command) => command[1] === "#a3e63505").length, 8, "S+ glows with 8 rings");
  const letter = rated.find((command) => command[0] === "text");
  assert.deepEqual(letter.slice(3, 9), ["S+", 26, "#9ae600", "center", "display", "700"]);

  vm.push("playervox.score.subscribe", score({ score: 84, grade: "S" }));
  assert.equal(lastDraw("badge").filter((command) => command[1] === "#a3e63505").length, 0, "only S+ glows");
});

test("the neutral badge follows the theme; a graded badge keeps its black face", () => {
  vm.push("playervox.score.subscribe", empty("loading"));
  vm.setHost({ theme: "light" });
  const light = lastDraw("badge");
  assert.ok(light.some((command) => command[0] === "fill" && command[1] === "#e4e4e780"));
  assert.ok(light.some((command) => command[0] === "stroke" && command[1] === "#71717a"));
  vm.push("playervox.score.subscribe", score());
  assert.ok(lastDraw("badge").some((command) => command[0] === "fill" && command[1] === "#000000"));
  vm.setHost({ theme: "dark" });
  vm.push("playervox.score.subscribe", empty("loading"));
  assert.ok(lastDraw("badge").some((command) => command[0] === "fill" && command[1] === "#27272a80"));
});

test("the mark is centred in its whole-pixel canvas", () => {
  const xs = vm.draws
    .find((entry) => entry.ref === "mark")
    .commands.filter((command) => command[0] === "moveTo" || command[0] === "lineTo")
    .map((command) => command[1]);
  assert.ok(Math.min(...xs) >= 0.35 && Math.max(...xs) <= 15.65, `${Math.min(...xs)}..${Math.max(...xs)}`);
});

test("one pulse per new score, none for the same score, a status or --", () => {
  vm.push("playervox.score.subscribe", empty("loading"));
  const before = state.badgeClass;
  vm.push("playervox.score.subscribe", score());
  const first = state.badgeClass;
  assert.notEqual(first, before, "a score shows: pulse");
  assert.match(first, /^badge pulse-[ab]$/);
  vm.push("playervox.score.subscribe", score({ ratingsCount: 1290 }));
  assert.equal(state.badgeClass, first, "same grade and number: no pulse");
  vm.push("playervox.score.subscribe", score({ score: 92.4 }));
  assert.notEqual(state.badgeClass, first, "a new number restarts the pulse");
  const second = state.badgeClass;
  vm.push("playervox.score.subscribe", empty("unavailable"));
  vm.push("playervox.score.subscribe", empty("no_ratings"));
  assert.equal(state.badgeClass, second, "no pulse for a status");
  vm.push("playervox.score.subscribe", score({ score: 92.4 }));
  assert.notEqual(state.badgeClass, second, "the score back after a status pulses again");
});

test("host grades on the raw score; the number rounds half away from zero", () => {
  assert.equal(logic.scoreText(score({ score: 89.6, grade: "S" })), "90");
  assert.equal(logic.scoreText(score({ score: 72.5 })), "73");
  assert.equal(logic.scoreText(score({ score: 0, grade: "F" })), "0");
  assert.equal(logic.scoreText(empty("no_ratings")), "--");
  for (const [value, grade] of [
    [90, "S+"],
    [89.99, "S"],
    [80, "S"],
    [70, "A"],
    [60, "B"],
    [40, "C"],
    [20, "D"],
    [19.99, "F"],
    [0, "F"],
    [-1, "--"],
    [100.1, "--"],
    [Number.NaN, "--"],
    [null, "--"],
  ]) {
    assert.equal(logic.gradeOf(value), grade, String(value));
  }
});

test("rating count: singular only for one, the user's number format", () => {
  assert.equal(logic.votes(score({ ratingsCount: 1 })), "1 rating");
  assert.equal(logic.votes(score({ ratingsCount: 1284 })), "1,284 ratings");
  vm.setHost({ region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 0 }, messages: messages("fr") });
  assert.equal(logic.votes(score({ ratingsCount: 1284 })), "1\u00a0284 votes");
  assert.equal(logic.votes(score({ ratingsCount: 1 })), "1 vote");
  vm.setHost({ region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 }, messages: messages("en") });
});

test("each state without a score has its label and hint", () => {
  const expected = {
    idle: ["Waiting for a game", ""],
    unsupported: ["Game not linked", "Steam game required"],
    loading: ["Loading…", ""],
    no_ratings: ["Not rated yet", "No ratings yet"],
    not_found: ["Game not found", "On PlayerVox"],
    unavailable: ["Score unavailable", "Retrying automatically"],
  };
  for (const [name, [label, hint]] of Object.entries(expected)) {
    const status = logic.status(empty(name));
    assert.equal(t(status.label), label, name);
    assert.equal(status.hint === "" ? "" : t(status.hint), hint, name);
    assert.equal(logic.rated(empty(name)), false, name);
  }
  assert.equal(logic.rated(score()), true);
  assert.equal(logic.rated(score({ state: "no_ratings", score: null, grade: "--", ratingsCount: 0 })), false);
});

test("the title is the game's name on one line, else Community rating; the tooltip fits a label", () => {
  assert.equal(logic.title(score({ name: "Half\nLife 2" })), "Half Life 2");
  assert.equal(logic.title(empty("loading")), "Community rating");
  assert.equal(logic.title(null), "Community rating");
  assert.equal(logic.tooltip(score()), "Portal 2");
  assert.equal(logic.tooltip(empty("not_found")), "Game not found");
  const long = "é".repeat(300);
  const cut = logic.tooltip(score({ name: long }));
  assert.equal(Buffer.byteLength(cut), 256);
  assert.equal(Buffer.byteLength(logic.cutBytes("a🎮b", 4)), 1, "never inside a character");
});

test("criteria: rounded values, -- for none, a real zero, bars in each value's grade", () => {
  const rows = logic.criteria(score({ criteria: { gameplay: 97, art: 72.5, tech: 0 } }));
  assert.deepEqual(
    rows.map(({ key, text, value, bar }) => [key, text, value, bar]),
    [
      ["gameplay", "97", 97, "bar grade-s-plus"],
      ["art", "73", 72.5, "bar grade-a"],
      ["tech", "0", 0, "bar grade-f"],
    ],
  );
  assert.equal(rows[0].label, "Gameplay: 97");
  const missing = logic.criteria(score({ criteria: { gameplay: null, art: 55, tech: null } }));
  assert.deepEqual(
    missing.map(({ text, bar }) => [text, bar]),
    [
      ["--", "bar grade-none"],
      ["55", "bar grade-c"],
      ["--", "bar grade-none"],
    ],
  );
});

test("options: badge only, the side and the classes follow the menu", () => {
  const display = { showScore: false, showCriteria: false, showTitle: false, showVotes: false };
  assert.equal(logic.badgeOnly(display), true);
  assert.equal(logic.rootClass(display), "score badge-only");
  assert.equal(logic.mainClass(display), "main centred");
  assert.equal(logic.rootClass({ ...display, showCriteria: true }), "score with-criteria");
  assert.equal(logic.mainClass({ ...display, showVotes: true }), "main");
  vm.setHost({ options: { "show-score": false, "show-criteria": true, "show-title": false, "show-votes": true } });
  assert.deepEqual(
    [state.showScore, state.showCriteria, state.showTitle, state.showVotes],
    [false, true, false, true],
  );
  vm.setHost({ options: {} });
  assert.deepEqual(
    [state.showScore, state.showCriteria, state.showTitle, state.showVotes],
    [true, false, true, true],
    "the menu's defaults",
  );
});

test("the badge's accessible name gives the grade and the rounded score", () => {
  assert.equal(logic.badgeName(score()), "Grade S+, 94/100");
  assert.equal(logic.badgeName(empty("loading")), "No grade");
});

test("a failed subscription shows unavailable and subscribes again 5 s later", () => {
  vm.push("playervox.score.subscribe", score());
  vm.fail("playervox.score.subscribe", "unavailable");
  assert.equal(state.score.state, "unavailable");
  assert.equal(live().length, 0);
  assert.equal(vm.advance(logic.RETRY_MS - 1), 0);
  assert.equal(vm.advance(1), 1);
  assert.equal(live().length, 1, "subscribed again");
});

function t(key) {
  return messages("en")[key];
}
