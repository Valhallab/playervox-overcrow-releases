// Unit tests of the dailies and weeklies on @overcrow/sdk/testing, with
// synthetic Warframe values (tests/fixtures.mjs). One widget runs through
// the file, in order: a first run, a Sortie in three stages, the hand
// against the game, the Circuit's picks, Nightwave, then a whole week of
// virtual time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { DAY, HOUR, NOW, SORTIE_END, WEEK_END, archon, challenge, ended, missionAt, replaced, sortie, value, world } from "./fixtures.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const SERVICE = "gameEvents.warframe.subscribe";
const vm = installRuntime({
  now: NOW,
  host: {
    messages: MESSAGES,
    mode: "interactive",
    grants: ["storage"],
    viewport: { width: 300, height: 600 },
    // Paris in winter: UTC+1.
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 60 },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const model = () => state.model;
const sections = () => model().cols.flatMap((col) => col.groups);
const act = (id) => sections().flatMap((section) => section.acts).find((each) => each.id === id);
const parts = (id) => act(id).groups.flatMap((group) => group.parts);
const part = (id, index) => parts(id)[index];
const texts = (id) => parts(id).map((each) => each.text);
const done = (id) => parts(id).map((each) => each.icon === "circle-check");
const section = (id) => sections().find((each) => each.id === id);
const saved = () => vm.calls.filter((call) => call.service === "storage.set").at(-1)?.params.value;

let seq = 0;
let currentWorld = () => world(vm.now);
async function push(events = [], options = {}) {
  vm.push(SERVICE, value({ worldValue: currentWorld(), events, ...options }));
  await flush();
}
const next = (at, options) => ended(++seq, at, options);

test("first run: a box per part, everything to do, no help sentence", async () => {
  const get = vm.calls.find((call) => call.service === "storage.get");
  assert.deepEqual(get.params, { key: "ticks" });
  get.resolve(null);
  await flush();
  assert.equal(vm.subscriptions.filter((each) => each.service === SERVICE).length, 1);
  await push();
  assert.equal(model().left, "6 to do");
  assert.equal(model().hint, "");
  assert.equal(model().note, "Ticks itself while PlayerVox OverCrow runs during play. Played without it? Tick by hand.");
  assert.equal(section("day").reset, "resets in 6h");
  assert.equal(section("week").reset, "resets in 3d\u00a014h");
  assert.deepEqual(texts("sortie"), ["Rescue", "Disruption", "Mobile Defense"]);
  assert.deepEqual([act("sortie").value, act("sortie").icon], ["0/3", "circle"]);
  assert.deepEqual(texts("archon"), ["Rescue", "Survival", "Assassination"]);
  assert.deepEqual([act("archon").shard, act("archon").shardText, act("archon").value], ["asset:amber-shard", "Nira", "0/3"]);
  assert.deepEqual([parts("netracells").length, act("netracells").groups[0].cls, act("netracells").value], [5, "cells", "0/5"]);
  assert.deepEqual(
    act("circuit").choices.filter((each) => !each.sep).map((each) => [each.text, each.cls]),
    [["Excalibur", "choice"], ["Trinity", "choice"], ["Ember", "choice"]],
    "nothing seen yet: no pick",
  );
  assert.deepEqual([act("circuit").name, act("circuit").value, act("circuit").toggle], ["The Circuit", "", true]);
  assert.equal(act("steel").name, "The Circuit · Steel Path");
  assert.equal(act("steel").choices.filter((each) => !each.sep).length, 5);
  assert.deepEqual(act("nightwave").groups.map((group) => [group.title, group.parts.length]), [["Daily", 2], ["Weekly", 2], ["Elite", 1]]);
  assert.equal(act("nightwave").value, "0/5");
  assert.equal(model().baro, "Baro Ki'Teer arrives Fri 14:00 · Larunda\u00a0Relay");
  assert.deepEqual([model().line, model().lineValue], ["6 to do", "Sortie resets in 6h"]);
});

test("a Sortie in three stages: by its stage, by its node, then done", async () => {
  vm.advance(20 * 60_000);
  await push([next(vm.now - 15_000, { modifiers: [sortie(1)] })]);
  assert.deepEqual([act("sortie").value, act("sortie").icon], ["1/3", "circle-dashed"]);
  assert.deepEqual(done("sortie"), [true, false, false]);
  assert.deepEqual([part("sortie", 0).textCls, part("sortie", 0).hand], ["part-text done", false]);
  vm.advance(20 * 60_000);
  await push([next(vm.now - 12_000, { node: "SolNode2", type: "disruption", modifiers: [sortie(null)] })]);
  assert.equal(act("sortie").value, "2/3");
  vm.advance(20 * 60_000);
  const at = vm.now - 20_000;
  await push([next(at, { node: "SolNode3", type: "mobile_defense", modifiers: [sortie(3)] })]);
  assert.deepEqual(
    [act("sortie").icon, act("sortie").value, act("sortie").valueCls],
    ["circle-check", "just now", "row-value when tone-success"],
  );
  assert.equal(model().left, "5 to do");
  assert.deepEqual([model().line, model().lineValue, model().lineCls], ["Sortie done", "5 to do", "line-main tone-success"]);
  assert.equal(saved().v, 2);
  assert.deepEqual(saved().sortie.parts, [{ at: NOW + 20 * 60_000 - 15_000 }, { at: NOW + 40 * 60_000 - 12_000 }, { at }]);
  assert.equal(saved().lastAt, at);
  vm.advance(5 * 60_000);
  assert.equal(act("sortie").value, "11:59");
  // Interactive: a finished activity keeps its boxes.
  assert.equal(parts("sortie").length, 3);
});

test("Passive: a finished activity folds to its line; Interactive opens it again", () => {
  vm.setHost({ mode: "passive" });
  assert.deepEqual([act("sortie").groups, act("sortie").value], [[], "11:59"]);
  vm.setHost({ mode: "interactive" });
  assert.equal(parts("sortie").length, 3);
});

test("the hand wins: unticked by hand, a stage the game ticked stays unticked, with the hand", async () => {
  logic.tick("sortie.1");
  assert.deepEqual(done("sortie"), [true, false, true]);
  assert.deepEqual([act("sortie").value, part("sortie", 1).hand, part("sortie", 0).hand], ["2/3", true, false]);
  assert.equal(part("sortie", 1).label, "Disruption: to do, set by hand");
  assert.deepEqual(saved().sortie.parts[1], { at: NOW + 40 * 60_000 - 12_000, hand: false, handAt: vm.now });
  // The same stage again from the game: the hand stays.
  await push([next(vm.now - 1000, { node: "SolNode2", type: "disruption", modifiers: [sortie(2)] })]);
  assert.deepEqual(done("sortie"), [true, false, true]);
  // Ticked again by hand: the game agrees, no hand.
  logic.tick("sortie.1");
  assert.deepEqual([done("sortie"), part("sortie", 1).hand], [[true, true, true], false]);
});

test("a stage ticked by hand shows the hand; the game ticking it later takes the hand away", async () => {
  logic.tick("archon.1");
  assert.deepEqual([done("archon"), part("archon", 1).hand, act("archon").value], [[false, true, false], true, "1/3"]);
  vm.advance(60_000);
  await push([next(vm.now - 10_000, { node: "SolNode5", modifiers: [archon(2)] })]);
  assert.deepEqual([done("archon"), part("archon", 1).hand], [[false, true, false], false]);
});

test("Netracells: the game never fills a cell set by hand; the hand at the end of the row", async () => {
  logic.tick("netracells.0");
  assert.equal(act("netracells").groups[0].hand, true);
  assert.equal(part("netracells", 0).label, "Cell 1: done, set by hand");
  for (let run = 1; run <= 2; run += 1) {
    vm.advance(60_000);
    await push([next(vm.now - 10_000, { node: "SolNode9", type: "netracell" })]);
  }
  assert.deepEqual(done("netracells"), [true, true, true, false, false]);
  assert.deepEqual(saved().netracells.map((cell) => cell.at > 0), [false, true, true, false, false]);
  assert.equal(act("netracells").value, "3/5");
});

test("a failed mission, or an event seen already, ticks nothing", async () => {
  await push([next(vm.now - 1000, { type: "netracell", result: "failed" })]);
  vm.push(SERVICE, value({ worldValue: currentWorld(), events: [ended(seq, vm.now - 500, { type: "netracell" })] }));
  await flush();
  assert.equal(act("netracells").value, "3/5");
});

test("the Circuit: the game's pick in a chip, the player's wins, kept until the weekly reset", async () => {
  currentWorld = () => {
    const each = world(vm.now);
    each.circuit.picked = { normal: ["trinity"], steelPath: ["lato", "paris"] };
    return each;
  };
  await push();
  const shown = (id) => act(id).choices.filter((each) => !each.sep).map((each) => `${each.text}:${each.cls}`);
  assert.deepEqual(shown("circuit"), ["Excalibur:choice other", "Trinity:choice picked", "Ember:choice other"]);
  assert.deepEqual(shown("steel"), ["Braton:choice other", "Lato:choice picked", "Skana:choice other", "Paris:choice picked", "Kunai:choice other"]);
  assert.equal(act("circuit").choicesHand, false);
  // The player picked Ember: one of three, it replaces Trinity.
  logic.pickChoice("circuit.ember");
  assert.deepEqual(shown("circuit"), ["Excalibur:choice other", "Trinity:choice other", "Ember:choice picked"]);
  assert.equal(act("circuit").choicesHand, true);
  assert.deepEqual(saved().circuit.picks, { auto: ["trinity"], hand: ["ember"] });
  // The game says Trinity again: the hand wins.
  await push();
  assert.equal(shown("circuit")[2], "Ember:choice picked");
  // Two of five: a third pick replaces the oldest; a click on a pick takes it back.
  logic.pickChoice("steel.kunai");
  assert.deepEqual(shown("steel").filter((each) => each.endsWith("picked")), ["Paris:choice picked", "Kunai:choice picked"]);
  logic.pickChoice("steel.kunai");
  assert.deepEqual(shown("steel").filter((each) => each.endsWith("picked")), ["Paris:choice picked"]);
  assert.equal(act("steel").choicesHand, true);
  // After a restart of the game the world shows no pick: the week's stay.
  currentWorld = () => world(vm.now);
  await push();
  assert.equal(shown("circuit")[2], "Ember:choice picked");
  assert.equal(shown("steel")[3], "Paris:choice picked");
  // The Circuit itself: only a click ticks it, never with the hand; done, all names grey.
  logic.check("circuit");
  assert.deepEqual([act("circuit").icon, act("circuit").valueCls], ["circle-check", "row-value when"]);
  assert.deepEqual(shown("circuit"), ["Excalibur:choice other", "Trinity:choice other", "Ember:choice other"]);
  logic.check("circuit");
  assert.equal(act("circuit").icon, "circle");
});

test("Nightwave: a challenge the game wrote complete ticks itself and stays ticked until it ends", async () => {
  const withNightwave = (changes) => () => {
    const each = world(vm.now);
    each.nightwave.challenges = each.nightwave.challenges.map((one) => ({ ...one, ...(changes[one.id] ?? {}) }));
    return each;
  };
  currentWorld = withNightwave({ artist: { completed: true }, gatherer: { progressed: true } });
  await push();
  assert.deepEqual(done("nightwave"), [true, false, false, false, false]);
  assert.deepEqual([part("nightwave", 0).hand, part("nightwave", 0).textCls], [false, "part-text done"]);
  assert.deepEqual([part("nightwave", 3).icon, part("nightwave", 3).iconCls], ["circle-dot", "part-icon part-going"]);
  assert.equal(act("nightwave").value, "1/5");
  assert.deepEqual(saved().nightwave.artist, { at: vm.now, endsAt: SORTIE_END + 8 * HOUR });
  // The game restarts: its log no longer says it; the tick stays.
  currentWorld = () => world(vm.now);
  await push();
  assert.deepEqual(done("nightwave"), [true, false, false, false, false]);
  // The player says it is not done: the hand shows, as on a stage.
  logic.tick("nightwave.artist");
  assert.deepEqual([done("nightwave")[0], part("nightwave", 0).hand], [false, true]);
  logic.tick("nightwave.artist");
  // A challenge ticked by hand, the game never said: the hand too.
  logic.tick("nightwave.mirror_mirror");
  assert.deepEqual([done("nightwave")[4], part("nightwave", 4).hand], [true, true]);
  assert.equal(act("nightwave").value, "2/5");
});

test("a Sortie stage whose type the game replaces: its node until loading, then the type, kept until the reset", async () => {
  currentWorld = () => {
    const each = world(vm.now);
    each.sortie.missions[1] = replaced("SolNode2", "Morax");
    return each;
  };
  await push();
  assert.deepEqual(texts("sortie"), ["Rescue", "Morax · Europa", "Mobile Defense"]);
  assert.equal(part("sortie", 1).textCls, "part-text done pending");
  // Loading tells the type; the widget keeps it with the stage.
  const loading = missionAt(vm.now, { node: "SolNode2", type: "excavation", typeName: "Excavation", modifiers: [sortie(2)], state: "loading", typeAtLoading: true });
  await push([], { mission: loading });
  assert.deepEqual(texts("sortie"), ["Rescue", "Excavation", "Mobile Defense"]);
  assert.deepEqual(saved().sortie.types[1], { node: "SolNode2", id: "excavation", name: "Excavation" });
  assert.equal(part("sortie", 1).textCls, "part-text done");
});

test("the tracked activities of the menu, the Steel Path's Circuit on its own row", () => {
  vm.setHost({ options: { "track-circuit-steel": false } });
  assert.equal(act("steel"), undefined);
  assert.equal(act("circuit").name, "The Circuit");
  vm.setHost({ options: { "track-nightwave": false, "track-baro": false, "track-sortie": false } });
  assert.equal(section("day"), undefined);
  assert.equal(model().baro, "");
  assert.match(model().lineValue, /^Week resets in /);
  vm.setHost({ options: { layout: "line" } });
  assert.equal(logic.layout(), "line");
  vm.setHost({
    options: Object.fromEntries(["sortie", "archon", "netracells", "circuit", "circuit-steel", "nightwave"].map((id) => [`track-${id}`, false])),
  });
  assert.equal(model().empty, true);
  assert.equal(model().note, "");
  assert.equal(model().line, "No activity · Widget menu");
  vm.setHost({ options: {} });
  assert.equal(model().empty, false);
});

test("Wide: Nightwave on the right, the rest on the left", () => {
  vm.setHost({ viewport: { width: 600, height: 600 } });
  assert.equal(logic.layout(), "wide");
  assert.deepEqual(
    model().cols.map((col) => col.groups.map((group) => `${group.id}:${group.acts.map((each) => each.id).join(",")}`)),
    [["day:sortie", "week:archon,netracells,circuit,steel"], ["week-nightwave:nightwave"]],
  );
  assert.equal(model().cols[1].groups[0].title, "This week");
  vm.setHost({ viewport: { width: 300, height: 600 } });
  assert.equal(model().cols.length, 1);
});

test("Passive: past the frame's largest height, the end of Nightwave folds into + N challenges", async () => {
  const many = Array.from({ length: 16 }, (_, index) =>
    challenge(`c${index}`, `A Long Challenge Name ${index}`, index < 3 ? "daily" : index < 13 ? "weekly" : "elite", WEEK_END),
  );
  currentWorld = () => {
    const each = { ...world(vm.now), nightwave: { endsAt: WEEK_END + 60 * DAY, challenges: many } };
    // The adapters' whole names: the Steel Path's line wraps.
    each.circuit.steelPath = each.circuit.steelPath.map((reward) => ({ ...reward, name: `${reward.name} Incarnon Genesis` }));
    return each;
  };
  await push([], { features: { mission: "unavailable" } });
  vm.setHost({ viewport: { width: 220, height: 800 } });
  assert.equal(parts("nightwave").length, 16, "Interactive: everything, the list scrolls");
  vm.setHost({ mode: "passive" });
  const shown = parts("nightwave").length;
  assert.ok(logic.panelHeight(model(), 220) <= logic.MAX_HEIGHT, "the panel fits");
  assert.ok(shown < 16 && shown > 0, `${shown} shown`);
  assert.equal(act("nightwave").more, `+ ${16 - shown} challenges`);
  assert.equal(act("nightwave").value, "0/16", "the count still counts them all");
  vm.setHost({ viewport: { width: 300, height: 600 }, mode: "interactive" });
  currentWorld = () => world(vm.now);
  await push();
});

test("Passive: the typical day's full week, 651 px tall, fits under 680 points: nothing folds", () => {
  // The world of the typical-day scenario: French names, the Circuit's picks, Baro's relay.
  const scenario = JSON.parse(readFileSync(new URL("./typical-day.scenario.json", import.meta.url), "utf8"));
  const inputs = (width) => ({
    ticks: logic.emptyTicks(),
    world: scenario.steps[1].gameEvents.warframe.info.world,
    worldStatus: "available",
    source: "available",
    tracked: { sortie: true, archon: true, netracells: true, circuit: true, steel: true, nightwave: true },
    baro: true,
    now: scenario.host.startAt,
    interactive: false,
    width,
  });
  const built = logic.buildModel(inputs(300));
  const night = built.cols.flatMap((col) => col.groups.flatMap((group) => group.acts)).find((each) => each.id === "nightwave");
  assert.equal(night.more, "", "nothing folded");
  assert.equal(night.groups.flatMap((group) => group.parts).length, 10);
  assert.ok(logic.panelHeight(built, 300) <= logic.MAX_HEIGHT);
  // Narrower, the same week passes 680 points: the end of Nightwave folds.
  const narrow = logic.buildModel(inputs(220));
  const folded = narrow.cols.flatMap((col) => col.groups.flatMap((group) => group.acts)).find((each) => each.id === "nightwave");
  assert.ok(logic.panelHeight(narrow, 220) <= logic.MAX_HEIGHT);
  assert.notEqual(folded.more, "");
});

test("the world not read yet: the stages by their rank, Nightwave waits", async () => {
  vm.push(SERVICE, value({ worldValue: null, features: { world: "unavailable" } }));
  await flush();
  // The widget keeps the last world it had; a first run has none.
  const empty = logic.buildModel({
    ticks: logic.emptyTicks(),
    world: null,
    worldStatus: "unavailable",
    source: "available",
    tracked: { sortie: true, archon: true, netracells: true, circuit: true, steel: true, nightwave: true },
    baro: true,
    now: vm.now,
    interactive: true,
    width: 300,
  });
  const find = (id) => empty.cols.flatMap((col) => col.groups.flatMap((group) => group.acts)).find((each) => each.id === id);
  const stageTexts = (id) => find(id).groups[0].parts.map((each) => `${each.text}|${each.textCls}`);
  assert.deepEqual(stageTexts("sortie"), ["1st mission|part-text pending", "2nd mission|part-text pending", "3rd mission|part-text pending"]);
  assert.deepEqual(stageTexts("archon").length, 3);
  assert.equal(find("archon").shardText, "");
  assert.deepEqual([find("circuit").choices, find("steel").choices], [[], []]);
  assert.deepEqual([find("nightwave").meta, find("nightwave").value, find("nightwave").groups], ["List when back online", "", []]);
  assert.deepEqual([empty.status, empty.left, empty.baro], ["Offline", "6 to do", ""]);
});

test("game not detected: only that, the counts stay", async () => {
  await push([], { features: { mission: "unavailable" } });
  assert.equal(model().hint, "Game not detected");
  assert.equal(act("netracells").value, "3/5");
  await push();
  assert.equal(model().hint, "");
});

test("a whole week: the Sortie and its learned type reset each day at 16:00 UTC, the rest on Monday", async () => {
  currentWorld = () => world(vm.now);
  // Past 16:00 UTC: a new Sortie, the week's ticks stay.
  vm.advance(SORTIE_END - vm.now + 60_000);
  assert.deepEqual([act("sortie").value, act("sortie").icon], ["0/3", "circle"]);
  assert.equal(section("day").reset, "resets in 24h");
  assert.deepEqual(saved().sortie.types, [null, null, null]);
  assert.equal(act("netracells").value, "3/5");
  // The world still holds yesterday's Sortie: the stages by their rank.
  await push();
  assert.deepEqual(texts("sortie"), ["1st mission", "2nd mission", "3rd mission"]);
  // Monday 00:00 UTC: everything of the week starts again.
  vm.advance(WEEK_END - vm.now + HOUR);
  for (const id of ["archon", "netracells", "circuit", "steel"]) assert.equal(act(id).icon, "circle", id);
  assert.deepEqual(saved().circuit.picks, { auto: [], hand: null });
  // The challenges that ended went with their ticks.
  assert.deepEqual(saved().nightwave, {});
  assert.equal(saved().weekEnd, WEEK_END + 7 * DAY);
});

test("Baro Ki'Teer at the relay, then gone", async () => {
  const trader = { arrivesAt: vm.now - HOUR, leavesAt: vm.now + 2 * DAY, relay: { id: "larunda_relay", name: "Larunda Relay" } };
  vm.push(SERVICE, value({ worldValue: world(vm.now, { voidTrader: trader }) }));
  await flush();
  assert.equal(model().baroHere, true);
  assert.match(model().baro, /^Baro Ki'Teer at Larunda\u00a0Relay · leaves \w{3} \d\d:\d\d$/);
  vm.push(SERVICE, value({ worldValue: world(vm.now, { voidTrader: null }) }));
  await flush();
  assert.equal(model().baro, "");
});

test("refused game events: the way to fix it, the count stays", () => {
  vm.fail(SERVICE, "permission_denied");
  assert.equal(model().hint, "Allow \u201cWarframe: missions\u201d in the Control Center.");
  assert.notEqual(model().left, "");
  assert.deepEqual([model().lineValue, model().lineValueCls], ["Access denied", "line-reset tone-warning"]);
});

test("the panel stops at 680 points: on a 1080p screen at 150 %, 1,020 px leave 48 px", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.sizing.max.height, 680);
  assert.equal(logic.MAX_HEIGHT, manifest.sizing.max.height);
  assert.ok(logic.MAX_HEIGHT * 1.5 <= 1080 - 48);
});
