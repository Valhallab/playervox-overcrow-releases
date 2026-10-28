// Unit tests of the dailies and weeklies on @overcrow/sdk/testing, with
// synthetic Warframe values (tests/fixtures.mjs). One widget runs through
// the file, in order: a first run, a Sortie in three stages, clicks, then
// a whole week of virtual time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { DAY, HOUR, NOW, SORTIE_END, WEEK_END, archon, ended, sortie, value, world } from "./fixtures.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const SERVICE = "gameEvents.warframe.subscribe";
const vm = installRuntime({
  now: NOW,
  host: {
    messages: MESSAGES,
    mode: "interactive",
    grants: ["storage"],
    // Paris in winter: UTC+1.
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 60 },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const model = () => state.model;
const row = (id) => model().groups.flatMap((group) => group.rows).find((each) => each.id === id);
const group = (id) => model().groups.find((each) => each.id === id);
const saved = () => vm.calls.filter((call) => call.service === "storage.set").at(-1)?.params.value;

let seq = 0;
async function push(events = [], options = {}) {
  vm.push(SERVICE, value({ worldValue: world(vm.now), events, ...options }));
  await flush();
}
const next = (at, options) => ended(++seq, at, options);

test("first run: everything to do, the hint, the world and the resets", async () => {
  const get = vm.calls.find((call) => call.service === "storage.get");
  assert.deepEqual(get.params, { key: "ticks" });
  get.resolve(null);
  await flush();
  assert.equal(vm.subscriptions.filter((each) => each.service === SERVICE).length, 1);
  await push();
  assert.equal(model().left, "5 to do");
  assert.match(model().hint, /tick automatically/);
  assert.equal(group("day").reset, "resets in 6h");
  assert.equal(group("week").reset, "resets in 3d\u00a014h");
  assert.deepEqual(
    [row("sortie").value, row("sortie").sub, row("sortie").icon],
    ["0/3", "Rescue, Disruption, Mobile Defense", "circle"],
  );
  assert.equal(row("archon").sub, "Nira · Rescue, Survival, Assassination");
  assert.equal(row("netracells").value, "0/5");
  assert.deepEqual([row("circuit").sub, row("circuit").value], ["Excalibur, Trinity, Ember", ""]);
  assert.equal(row("nightwave").sub, "This week\u2019s challenges");
  assert.equal(model().baro, "Baro Ki\u2019Teer arrives Fri 14:00 · Larunda Relay");
  assert.equal(model().baroHere, false);
  assert.equal(model().status, "");
  assert.deepEqual([model().line, model().lineValue], ["5 to do", "Sortie resets in 6h"]);
});

test("a Sortie in three stages: by its stage, by its node, then done", async () => {
  vm.advance(20 * 60_000);
  await push([next(vm.now - 15_000, { modifiers: [sortie(1)] })]);
  assert.deepEqual([row("sortie").value, row("sortie").icon], ["1/3", "circle-dashed"]);
  assert.equal(row("sortie").sub, "Remaining: Disruption, Mobile Defense");
  assert.equal(model().hint, "", "the first tick ends the first-run hint");
  // No stage from the host: the node's rank in the Sortie tells it.
  vm.advance(20 * 60_000);
  await push([next(vm.now - 12_000, { node: "SolNode2", type: "disruption", modifiers: [sortie(null)] })]);
  assert.deepEqual([row("sortie").value, row("sortie").sub], ["2/3", "Remaining: Mobile Defense"]);
  vm.advance(20 * 60_000);
  const at = vm.now - 20_000;
  await push([next(at, { node: "SolNode3", type: "mobile_defense", modifiers: [sortie(3)] })]);
  assert.deepEqual(
    [row("sortie").icon, row("sortie").value, row("sortie").valueCls, row("sortie").byHand],
    ["circle-check", "just now", "row-value when tone-success", false],
  );
  assert.equal(model().left, "4 to do");
  assert.deepEqual([model().line, model().lineValue, model().lineCls], ["Sortie done", "4 to do", "line-main tone-success"]);
  assert.deepEqual(saved().activities.sortie, { parts: [NOW + 20 * 60_000 - 15_000, NOW + 40 * 60_000 - 12_000, at], done: { at, hand: false } });
  assert.equal(saved().lastAt, at);
  // "just now" for five minutes, then the time it was done, local.
  vm.advance(5 * 60_000);
  assert.equal(row("sortie").value, "11:59");
  assert.equal(row("sortie").valueCls, "row-value when");
  assert.deepEqual([model().line, model().lineValue], ["4 to do", "Sortie resets in 5h"]);
});

test("a failed mission, or an event seen already, ticks nothing", async () => {
  const before = JSON.stringify(saved());
  await push([next(vm.now - 1000, { type: "netracell", result: "failed" })]);
  assert.equal(row("netracells").value, "0/5");
  vm.push(SERVICE, value({ worldValue: world(vm.now), events: [ended(seq, vm.now - 500, { type: "netracell" })] }));
  await flush();
  assert.equal(row("netracells").value, "0/5");
  assert.equal(JSON.parse(before).activities.netracells.parts.join(), "0,0,0,0,0");
});

test("Netracells count to five, then done", async () => {
  for (let run = 1; run <= 5; run += 1) {
    vm.advance(60_000);
    await push([next(vm.now - 10_000, { node: "SolNode9", type: "netracell" })]);
    if (run < 5) assert.equal(row("netracells").value, `${run}/5`);
  }
  assert.equal(row("netracells").icon, "circle-check");
  assert.equal(model().left, "3 to do");
});

test("the Circuit by hand: a click ticks it with the hand, a second unticks it", async () => {
  logic.check("circuit");
  assert.deepEqual([row("circuit").icon, row("circuit").byHand, row("circuit").sub], ["circle-check", true, ""]);
  assert.equal(row("circuit").label, `Normal Circuit: checked by hand, ${row("circuit").value}`);
  assert.equal(saved().activities.circuit.done.hand, true);
  logic.check("circuit");
  assert.deepEqual([row("circuit").icon, row("circuit").byHand], ["circle", false]);
  logic.check("circuit");
  assert.equal(model().left, "2 to do");
});

test("a click on a started Archon Hunt, then a second, goes back to its stages", async () => {
  vm.advance(60_000);
  await push([next(vm.now - 10_000, { node: "SolNode4", modifiers: [archon(1)] })]);
  assert.deepEqual([row("archon").value, row("archon").sub], ["1/3", "Remaining: Survival, Assassination"]);
  logic.check("archon");
  assert.deepEqual([row("archon").icon, row("archon").byHand], ["circle-check", true]);
  logic.check("archon");
  assert.deepEqual([row("archon").value, row("archon").icon], ["1/3", "circle-dashed"]);
  // A detected tick unticked by a click starts again from nothing.
  logic.check("nightwave");
  logic.check("netracells");
  assert.equal(row("netracells").value, "0/5");
});

test("the tracked activities of the menu decide the list and the count", () => {
  assert.equal(model().left, "2 to do");
  vm.setHost({ options: { "track-nightwave": false, "track-baro": false } });
  assert.equal(row("nightwave"), undefined);
  assert.equal(model().left, "2 to do", "nightwave was done: the count is the same");
  vm.setHost({ options: { "track-nightwave": false, "track-baro": false, "track-archon": false } });
  assert.equal(model().left, "1 to do");
  assert.equal(model().baro, "");
  vm.setHost({ options: { "track-sortie": false } });
  assert.equal(group("day"), undefined);
  assert.match(model().lineValue, /^Week resets in /);
  vm.setHost({ options: { layout: "line" } });
  assert.equal(logic.layout(), "line");
  vm.setHost({ options: { "track-sortie": false, "track-archon": false, "track-netracells": false, "track-circuit": false, "track-nightwave": false } });
  assert.equal(model().empty, true);
  assert.equal(model().line, "No activity · Widget menu");
  vm.setHost({ options: {} });
  assert.equal(model().empty, false);
  assert.equal(logic.layout(), "standard");
  vm.setHost({ viewport: { width: 600, height: 300 } });
  assert.equal(logic.layout(), "wide");
  assert.equal(logic.baroIn(model(), "day"), model().baro);
  assert.equal(logic.baroIn(model(), "week"), "");
  vm.setHost({ viewport: { width: 300, height: 320 } });
});

test("offline: the last world stays, with the time it was read", async () => {
  vm.push(SERVICE, value({ worldValue: world(vm.now - 20 * 60_000) }));
  await flush();
  assert.match(model().status, /^Offline · data from \d\d:\d\d$/);
  assert.equal(row("sortie").sub, "");
  await push();
  assert.equal(model().status, "");
});

test("game not detected: tick by hand, no count that cannot be counted", async () => {
  await push([], { features: { mission: "unavailable" } });
  assert.equal(model().hint, "Game not detected: check by hand.");
  assert.equal(row("archon").value, "1/3", "what was counted stays");
  assert.equal(row("netracells").value, "", "nothing counted: no 0/5");
  await push();
  assert.equal(model().hint, "");
});

test("a whole week: the Sortie resets each day at 16:00 UTC, the rest on Monday", async () => {
  assert.equal(row("circuit").icon, "circle-check");
  const circuitAt = saved().activities.circuit.done.at;
  // Past 16:00 UTC: a new Sortie, the week's ticks stay.
  vm.advance(SORTIE_END - vm.now + 60_000);
  assert.deepEqual([row("sortie").value, row("sortie").icon], ["0/3", "circle"]);
  assert.equal(group("day").reset, "resets in 24h");
  // The world still holds yesterday's Sortie: its missions are not today's.
  await push();
  assert.equal(row("sortie").sub, "");
  assert.equal(row("circuit").icon, "circle-check");
  assert.equal(row("archon").value, "1/3");
  assert.equal(saved().activities.sortie.done, null);
  // A Sortie mission of the previous day, told late, does not count today.
  await push([next(SORTIE_END - 30_000, { node: "SolNode1", modifiers: [sortie(1)] })]);
  assert.equal(row("sortie").value, "0/3");
  // Sunday evening: still the same week.
  vm.advance(WEEK_END - vm.now - HOUR);
  assert.equal(row("circuit").icon, "circle-check");
  assert.equal(row("circuit").value, `Thu ${new Date(circuitAt + HOUR).toISOString().slice(11, 16)}`);
  assert.equal(group("week").reset, "resets in 1h");
  // Monday 00:00 UTC: everything of the week starts again.
  vm.advance(2 * HOUR);
  for (const id of ["archon", "netracells", "circuit", "nightwave"]) {
    assert.equal(row(id).icon, "circle", id);
  }
  assert.equal(group("week").reset, "resets in 6d\u00a023h");
  assert.equal(saved().weekEnd, WEEK_END + 7 * DAY);
});

test("Baro Ki'Teer at the relay, then gone", async () => {
  const trader = { arrivesAt: vm.now - HOUR, leavesAt: vm.now + 2 * DAY, relay: { id: "larunda_relay", name: "Larunda Relay" } };
  vm.push(SERVICE, value({ worldValue: world(vm.now, { voidTrader: trader }) }));
  await flush();
  assert.equal(model().baroHere, true);
  assert.match(model().baro, /^Baro Ki’Teer at Larunda Relay · leaves \w{3} \d\d:\d\d$/);
  vm.push(SERVICE, value({ worldValue: world(vm.now, { voidTrader: { ...trader, relay: null, arrivesAt: vm.now + 9 * DAY, leavesAt: vm.now + 11 * DAY } }) }));
  await flush();
  assert.match(model().baro, /^Baro Ki’Teer arrives \w{3}, \w{3} \d+, \d\d:\d\d$/);
  vm.push(SERVICE, value({ worldValue: world(vm.now, { voidTrader: null }) }));
  await flush();
  assert.equal(model().baro, "");
});

test("refused game events: tick by hand", () => {
  vm.fail(SERVICE, "permission_denied");
  assert.equal(model().hint, "Allow \u201cWarframe: missions\u201d in the Control Center.");
  assert.notEqual(model().left, "", "the count stays beside the refusal");
  assert.deepEqual([model().lineValue, model().lineValueCls], ["Access denied", "line-reset tone-warning"]);
  assert.match(model().lineLabel, /to do · Access denied\. Allow “Warframe: missions” in the Control Center\.$/);
  // Without a value: where to fix it, in the line itself.
  vm.setHost({ options: { "track-sortie": false, "track-archon": false, "track-netracells": false, "track-circuit": false, "track-nightwave": false } });
  assert.deepEqual([model().line, model().lineValue, model().lineCls], ["Access denied · Control Center", "", "line-main tone-warning"]);
});
