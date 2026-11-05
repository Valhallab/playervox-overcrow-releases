// The goal of an achievement on hover, and every bounded attribute fed by
// Steam or the player. Steam's list of a game (and the player's
// achievements with `l`) gives no description of a hidden achievement,
// unlocked or not: the goals route (GetGameAchievements, keyless) does. A
// `label` or `tooltip` beyond 256 bytes makes the VM refuse the whole
// render: the view would freeze.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const FR = JSON.parse(readFileSync(new URL("../locales/fr.json", import.meta.url), "utf8"));
const vm = installRuntime({
  now: Date.UTC(2026, 0, 1, 12),
  host: { messages: EN, grants: ["storage", "network", "account:steam"], options: { layout: "full" }, mode: "interactive" },
  accounts: { steam: "connected" },
});
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
// Twelve achievements: the last three hidden story ones, two unlocked last;
// one without any description; one whose goal is long (French, 2 bytes a
// letter).
const story = achievementsOf(12).map((a, n) => {
  if (n < 9) return a;
  const { description: _, ...hidden } = a;
  return { ...hidden, hidden: 1, goal: `Story goal ${n}` };
});
const { description: _none, ...silent } = story[2];
story[2] = silent;
story[1] = { ...story[1], description: "É".repeat(140) };
steam.games[100] = { name: "Ashen Crown", schema: story, unlocked: { ACH_0: 1767000000, ACH_2: 1767050000, ACH_9: 1767100000, ACH_10: 1767200000 } };
// Everything 1,000 bytes: accents, combining marks, emoji sequences, flags.
const GIANT = "Ünïcödé é 👩‍👩‍👧‍👦 🇫🇷 ".repeat(40).slice(0, 600);
const giant = achievementsOf(30, "BIG").map((a, n) => ({ ...a, displayName: `${n} ${GIANT}`, description: `${GIANT} ${n}` }));
steam.games[200] = { name: `Game ${GIANT}`, schema: giant, unlocked: { BIG_0: 1767000000, BIG_3: 1767100000 } };
steam.recent = [100];
steam.playing = 100;
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);
await minutes(vm, steam, 2);
const bytes = (text) => Buffer.byteLength(text);

test("a hidden achievement, unlocked: its real goal, from the goals route", () => {
  const latest = logic.latest(state);
  assert.deepEqual([latest.id, latest.achieved, latest.hidden], ["ACH_10", true, true]);
  assert.equal(logic.goalTip(latest), "Story goal 10");
  const first = logic.recent(state, 3)[0];
  assert.equal(first.id, "ACH_9");
  assert.equal(logic.goalTip(first), "Story goal 9");
  // Keyless, asked once for the game in its language.
  const asked = steam.requests.filter((url) => url.includes("GetGameAchievements"));
  assert.deepEqual(asked, ["https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid=100&language=english"]);
});

test("a hidden achievement still missing: the hint, its real goal with Reveal hidden achievements", () => {
  const missing = () => logic.achievements().find((a) => a.id === "ACH_11");
  assert.equal(logic.goalTip(missing()), "Revealed when you unlock it.");
  assert.equal(logic.achDesc(missing()), "Revealed when you unlock it.");
  vm.setHost({ options: { ...vm.host.options, "reveal-hidden": true } });
  assert.equal(logic.goalTip(missing()), "Story goal 11");
  assert.equal(logic.achDesc(missing()), "Story goal 11", "the row shows it too");
  assert.equal(logic.achName(missing()), "Achievement 11");
  vm.setHost({ options: { ...vm.host.options, "reveal-hidden": false } });
  assert.equal(logic.goalTip(missing()), "Revealed when you unlock it.");
});

test("an achievement without any goal, even from the route: said, never an empty tooltip", () => {
  const silentOne = logic.achievements().find((a) => a.id === "ACH_2");
  assert.deepEqual([silentOne.achieved, silentOne.hidden, silentOne.desc], [true, false, ""]);
  assert.equal(logic.goalTip(silentOne), "Goal unavailable.");
  vm.setHost({ messages: FR, locale: "fr" });
  assert.equal(logic.goalTip(silentOne), "Objectif indisponible.");
  vm.setHost({ messages: EN, locale: "en" });
});

test("a long goal is cut within 256 bytes, the ellipsis included", () => {
  const long = logic.achievements().find((a) => a.id === "ACH_1");
  assert.equal(bytes(long.desc), 280);
  const tip = logic.goalTip(long);
  assert.ok(bytes(tip) <= 256, `${bytes(tip)} bytes`);
  assert.ok(tip.endsWith("…"));
  assert.equal(tip, `${"É".repeat(126)}…`);
});

test("the cut never splits a character, a mark, an emoji sequence or a flag", () => {
  const cases = [
    ["a".repeat(256), "a".repeat(256)],
    ["a".repeat(257), `${"a".repeat(253)}…`],
    // An accent written as a letter and a combining mark stays whole.
    [`${"a".repeat(251)}éxyz`, `${"a".repeat(251)}…`],
    // A family emoji (joined by ZWJ) is kept whole or left out whole.
    [`${"a".repeat(240)}👩‍👩‍👧‍👦tail`, `${"a".repeat(240)}…`],
    // A flag is two regional indicators: never half of one.
    [`${"a".repeat(247)}🇫🇷🇩🇪`, `${"a".repeat(247)}…`],
    // A skin tone stays with its hand.
    [`${"a".repeat(248)}👍🏽z`, `${"a".repeat(248)}…`],
  ];
  for (const [input, expected] of cases) {
    const out = logic.clip(input);
    assert.ok(bytes(out) <= 256, `${bytes(out)} bytes`);
    assert.equal(out, expected);
  }
  // Short texts are left as they are, and a custom bound is honoured.
  assert.equal(logic.clip("Crown of Ashes"), "Crown of Ashes");
  assert.equal(logic.clip("abcdef", 5), "ab…");
});

test("the route once per game and language; again a day later only for an unlocked one still without a goal", async () => {
  // The French list (the language changed above) has its own read.
  const count = () => steam.requests.filter((url) => url.includes("GetGameAchievements") && url.includes("appid=100&language=english")).length;
  assert.equal(count(), 1);
  await minutes(vm, steam, 30);
  assert.equal(count(), 1, "not each minute");
  // ACH_2, unlocked, has no goal anywhere: a day later, asked again, once.
  await minutes(vm, steam, 24 * 60);
  assert.equal(count(), 2);
  await minutes(vm, steam, 60);
  assert.equal(count(), 2);
});

test("the route fails: the tooltips say the goal is unavailable, nothing else changes", async () => {
  steam.games[300] = { name: "Rune Table", schema: story.map((a) => ({ ...a })), unlocked: { ACH_10: 1767200000 } };
  steam.routeStatus = { GetGameAchievements: 503 };
  steam.playing = 300;
  steam.recent = [300];
  await minutes(vm, steam, 2);
  assert.equal(state.game.appid, 300);
  assert.equal(state.stale, "", "silent: never Unreachable for it");
  assert.equal(logic.goalTip(logic.latest(state)), "Hidden achievement: goal unavailable.");
  // Asked again ten minutes later, not each minute; then the goal shows.
  const asked = () => steam.requests.filter((url) => url.includes("GetGameAchievements/v1/?appid=300")).length;
  const before = asked();
  await minutes(vm, steam, 5);
  assert.equal(asked(), before);
  steam.routeStatus = {};
  await minutes(vm, steam, 6);
  assert.equal(asked(), before + 1);
  assert.equal(logic.goalTip(logic.latest(state)), "Story goal 10");
});

test("1,000-byte names, goals and game name: every bounded attribute stays within 256 bytes", async () => {
  steam.playing = 200;
  steam.recent = [200];
  await minutes(vm, steam, 2);
  assert.equal(state.game.appid, 200);
  logic.openPick();
  logic.showMorePicks();
  logic.toggleTrack("BIG_5");
  const shown = [...state.lists.recent, ...state.lists.missing, ...state.lists.tracked, ...state.lists.pick, logic.latest(state)].filter(Boolean);
  assert.ok(shown.length >= 30);
  for (const a of shown) {
    assert.ok(bytes(a.name) > 256 && bytes(a.desc) > 256, "the data is giant");
    for (const value of [logic.goalTip(a), logic.achLabel(a), logic.pickLabel(a, state)]) {
      assert.ok(bytes(value) <= 256, `${a.id}: ${bytes(value)} bytes`);
    }
  }
  assert.ok(bytes(state.game.name) > 256);
  assert.ok(bytes(logic.gameLabel(state)) <= 256);
  // GIANT ends with half an emoji, as a JSON escape can carry it: what the
  // view receives is valid text, or the VM would refuse the render.
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.match(GIANT, lone, "the data has half a character");
  for (const a of shown) {
    for (const value of [a.name, a.desc, logic.goalTip(a), logic.achLabel(a)]) assert.doesNotMatch(value, lone, a.id);
  }
  assert.doesNotMatch(state.game.name, lone);
  // The checklist's search keeps 64 characters, never half of one.
  logic.pickTyped(`${"a".repeat(63)}👍🏽tail`);
  assert.doesNotMatch(state.pickQuery, lone);
  assert.equal(state.pickQuery, `${"a".repeat(63)}👍`);
  logic.closePick();
});

test("half a character becomes U+FFFD; whole ones stay", () => {
  assert.equal(logic.wellFormed("plain"), "plain");
  assert.equal(logic.wellFormed("😀 ok"), "😀 ok");
  assert.equal(logic.wellFormed("a\uD83D"), "a\uFFFD");
  assert.equal(logic.wellFormed("\uDE00b"), "\uFFFDb");
  assert.equal(logic.wellFormed("\uD83D\uD83D\uDE00"), "\uFFFD😀");
});
