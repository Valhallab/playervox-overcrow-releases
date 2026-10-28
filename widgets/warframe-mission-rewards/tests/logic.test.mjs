// Unit tests of the mission rewards logic on @overcrow/sdk/testing: the
// rotation at every boundary, the tables in both orders, the summary after
// the mission. The values are synthetic, in the shape of Warframe's game
// events.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const EN = read("../locales/en.json");
const FR = read("../locales/fr.json");
const START = Date.UTC(2026, 9, 28, 18, 0, 0);
const SERVICE = "gameEvents.warframe.subscribe";

const vm = installRuntime({
  now: START,
  host: { messages: EN, locale: "en", mode: "interactive", grants: ["storage", "gameEvents"] },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const flush = () => new Promise((resolve) => setImmediate(resolve));

const item = (id, name, chance, quantity = 1) => ({ id, name, quantity, chance });
const MOT = {
  tables: [
    { kind: "mission", rotation: "A", items: [item("neo_y2_relic", "Neo Y2 Relic", 0.1818), item("aya", "Aya", 0.0909), item("neo_c7_relic", "Neo C7 Relic", 0.0909)] },
    { kind: "mission", rotation: "B", items: [item("neo_c7_relic", "Neo C7 Relic", 0.125), item("aya", "Aya", 0.125)] },
    { kind: "mission", rotation: "C", items: [item("aya", "Aya", 0.2211), item("axi_s21_relic", "Axi S21 Relic", 0.0973)] },
  ],
};
const mission = (over = {}) => ({
  state: "in_progress",
  node: { id: "SolNode405", name: "Mot" },
  planet: { id: "void", name: "Void" },
  type: { id: "survival", name: "Survival" },
  faction: { id: "corrupted", name: "Corrupted" },
  enemyLevel: null,
  fissure: null,
  modifiers: [],
  selectedAt: START - 60_000,
  loadingAt: START - 30_000,
  startedAt: START,
  endedAt: null,
  result: null,
  durationSeconds: null,
  rewards: MOT,
  ...over,
});
const progress = (over = {}) => ({ wave: null, round: null, rewards: 0, rotation: "A", nextRewardAt: null, nextRewardWave: null, ...over });
const value = (info, over = {}) => ({
  playing: true,
  session: { startedAt: START - 600_000 },
  features: { location: "undeclared", mission: "available", progress: "available", squad: "undeclared", eidolons: "undeclared", world: "undeclared", rewards: "available" },
  info: { location: null, mission: null, progress: null, squad: null, eidolons: null, world: null, ...info },
  events: [],
  ...over,
});
const input = (v, over = {}) => ({ value: v, failure: null, last: null, now: vm.now, layout: "standard", order: "rarest", open: [], ...over });

// The storage read at start: nothing stored.
await flush();
vm.lastCall("storage.get")?.resolve(null);
await flush();

test("survival: the countdown, then the next rotation at the very moment, without waiting for Warframe", () => {
  const p = progress({ rewards: 2, rotation: "B", nextRewardAt: START + 15 * 60_000 });
  const before = logic.project(p, START + 15 * 60_000 - 1);
  assert.equal(before.letter, "B");
  assert.equal(before.rewards, 2);
  assert.equal(logic.countdownText(before.nextAt - (START + 15 * 60_000 - 1)), "0:01");
  const at = logic.project(p, START + 15 * 60_000);
  assert.equal(at.letter, "C", "at 15:00 sharp, B is given");
  assert.equal(at.rewards, 3);
  assert.equal(at.nextAt, START + 20 * 60_000);
  assert.equal(logic.countdownText(at.nextAt - (START + 15 * 60_000)), "5:00");
});

test("survival: Warframe tells the reward 26 s late; nothing jumps when it does", () => {
  const stale = progress({ rewards: 2, rotation: "B", nextRewardAt: START + 15 * 60_000 });
  const now = START + 15 * 60_000 + 26_000;
  const told = progress({ rewards: 3, rotation: "C", nextRewardAt: START + 20 * 60_000 });
  const a = logic.buildScreen(input(value({ mission: mission(), progress: stale }), { now }));
  const b = logic.buildScreen(input(value({ mission: mission(), progress: told }), { now }));
  assert.deepEqual(a, b);
  assert.equal(a.heroLabel, "Rotation C in");
  assert.equal(logic.at(a.heroValue, a, now), "4:34");
  assert.equal(a.heroSub, "Then A at 25 min");
  assert.equal(logic.clockValue(a, now), "15:26");
});

test("survival: the first cycle counts down to C; later ones count the Cs", () => {
  const now = START + 60_000 * 13 + 12_000;
  const s = logic.buildScreen(input(value({ mission: mission(), progress: progress({ rewards: 2, rotation: "B", nextRewardAt: START + 15 * 60_000 }) }), { now }));
  assert.equal(logic.at(s.heroValue, s, now), "1:48");
  assert.equal(logic.heroSubText(s, now), "C in 6:48");
  assert.deepEqual(s.track.map((c) => c.cls), ["cell earned", "cell earned", "cell now", "cell"]);
  assert.equal(s.sections[0].title, "Possible loot · rotation B");
  assert.equal(logic.at(s.line, s, now) + " " + logic.at(s.lineValue, s, now), "Mot · B in 1:48");
  const later = START + 41 * 60_000 + 5_000;
  const c2 = logic.buildScreen(input(value({ mission: mission(), progress: progress({ rewards: 8, rotation: "A", nextRewardAt: START + 45 * 60_000 }) }), { now: later }));
  assert.equal(c2.heroLabel, "Rotation A in");
  assert.equal(c2.heroSub, "2 C so far · next C at 60 min");
  assert.deepEqual(c2.track.map((c) => c.cls), ["cell now", "cell", "cell", "cell"]);
});

test("defense: waves until the reward, this one included; wave 5 and a wave already past", () => {
  const def = mission({ node: { id: "SolNode195", name: "Hydron" }, type: { id: "defense", name: "Defense" } });
  const at12 = logic.buildScreen(input(value({ mission: def, progress: progress({ wave: 12, rewards: 2, rotation: "B", nextRewardWave: 15 }) })));
  assert.equal(at12.heroLabel, "Waves until B");
  assert.equal(at12.heroValue, "4");
  assert.equal(at12.heroSub, "This one included · B after wave 15");
  assert.equal(at12.clock, "Wave 12");
  assert.equal(at12.lineValue, "4 waves");
  const at5 = logic.buildScreen(input(value({ mission: def, progress: progress({ wave: 5, rewards: 0, rotation: "A", nextRewardWave: 5 }) })));
  assert.equal(at5.heroValue, "1");
  assert.equal(at5.lineValue, "1 wave");
  const past = logic.project(progress({ wave: 6, rewards: 0, rotation: "A", nextRewardWave: 5 }), START);
  assert.deepEqual([past.letter, past.rewards, past.nextWave], ["A", 1, 10]);
});

test("before the mission: the three rotations stacked, three rows each", () => {
  const s = logic.buildScreen(input(value({ mission: mission({ state: "selected", startedAt: null }), progress: null })));
  assert.equal(s.eyebrow, "Survival · picked");
  assert.equal(s.info, "One rotation every 5 min · C at 20 min");
  assert.deepEqual(s.sections.map((x) => x.title), ["Rotation A", "Rotation B", "Rotation C"]);
  assert.equal(s.track.length, 0);
  assert.equal(s.source, true);
  assert.equal(s.line, "Mot · C at 20 min");
});

test("unknown progress (Excavation): stacked tables, no rotation made up", () => {
  const exc = mission({ type: { id: "excavation", name: "Excavation" } });
  const s = logic.buildScreen(input(value({ mission: exc, progress: progress({ rotation: null }) })));
  assert.equal(s.heroValue, "");
  assert.equal(s.track.length, 0);
  assert.equal(s.info, "One rotation per excavator · C at the 4th");
  assert.equal(s.sections.length, 3);
  const spy = logic.buildScreen(input(value({ mission: mission({ type: { id: "spy", name: "Spy" } }), progress: progress({ rotation: null }) })));
  assert.equal(spy.info, "Progress not tracked: all three rotations");
});

test("interception: the rotation at the end of the next round", () => {
  const s = logic.buildScreen(input(value({ mission: mission({ type: { id: "interception", name: "Interception" } }), progress: progress({ round: 2, rewards: 2, rotation: "B" }) })));
  assert.equal(s.info, "Rotation B at the end of round 3");
  assert.equal(s.sections[0].title, "Possible loot · rotation B");
});

test("tables: the rarest first by default, the most likely first on request, ties kept", () => {
  const rows = [item("a", "A", 0.2), item("b", "B", 0.05), item("c", "C", 0.2), item("d", "D", 0.05)];
  assert.deepEqual(logic.sortItems(rows, "rarest").map((r) => r.id), ["b", "d", "a", "c"]);
  assert.deepEqual(logic.sortItems(rows, "likely").map((r) => r.id), ["a", "c", "b", "d"]);
});

test("tables: 10 rows then + n more, with one rate or a range; a single hidden row shows", () => {
  const same = { kind: "mission", rotation: "B", items: Array.from({ length: 16 }, (_, i) => item(`x${i}`, `X${i}`, 0.0625)) };
  const s = logic.section("b", "B", same, 10, "rarest", []);
  assert.equal(s.rows.length, 10);
  assert.equal(s.more, "+ 6 more at 6.25%");
  const mixed = { kind: "mission", rotation: "C", items: [...Array.from({ length: 8 }, (_, i) => item(`r${i}`, `R${i}`, 0.0968)), ...Array.from({ length: 10 }, (_, i) => item(`m${i}`, `M${i}`, 0.0226))] };
  const rare = logic.section("c", "C", mixed, 10, "rarest", []);
  assert.equal(rare.rows[0].chance, "2.26%");
  assert.equal(rare.more, "+ 8 more at 9.68%");
  const likely = logic.section("c", "C", mixed, 10, "likely", []);
  assert.equal(likely.rows[0].chance, "9.68%");
  assert.equal(likely.more, "+ 8 more at 2.26%");
  const eleven = { kind: "mission", rotation: "A", items: Array.from({ length: 11 }, (_, i) => item(`e${i}`, `E${i}`, 0.01 * (i + 1))) };
  assert.equal(logic.section("a", "A", eleven, 10, "rarest", []).rows.length, 11);
  const twelve = { ...eleven, items: [...eleven.items, item("e11", "E11", 0.5)] };
  assert.equal(logic.section("a", "A", twelve, 10, "rarest", []).more, "+ 2 more, 11.00% to 50.00%");
  const open = logic.section("a", "A", twelve, 10, "rarest", ["a"]);
  assert.equal(open.rows.length, 12);
  assert.equal(open.more, "");
});

test("tables: the quantity apart, caches under the mission's table", () => {
  const rewards = { tables: [...MOT.tables, { kind: "caches", rotation: null, items: [item("endo", "Endo", 0.5, 200), item("credits", "Credits", 0.5, 3000)] }] };
  const now = START + 60_000;
  const s = logic.buildScreen(input(value({ mission: mission({ rewards }), progress: progress({ nextRewardAt: START + 300_000 }) }), { now }));
  assert.deepEqual(s.sections.map((x) => x.title), ["Possible loot · rotation A", "Caches"]);
  assert.deepEqual(s.sections[1].rows.map((r) => r.qty), ["×200", "×3,000"]);
});

test("an end reward without rotation, no table, a new node, loot unavailable", () => {
  const ps = { tables: [{ kind: "mission", rotation: null, items: [item("loki_systems_blueprint", "Loki Systems Blueprint", 0.2256)] }] };
  const ass = logic.buildScreen(input(value({ mission: mission({ type: { id: "assassination", name: "Assassination" }, rewards: ps }), progress: progress({ rotation: null }) })));
  assert.equal(ass.info, "No rotation: one reward at the end");
  assert.equal(ass.sections[0].title, "End reward");
  assert.equal(ass.line, "Mot · Loki Systems Blueprint", "One line names the reward");
  const loki = { kind: "mission", rotation: null, items: [item("n", "Loki - Neuroptiques (schéma)", 0.3872), item("c", "Loki - Châssis (schéma)", 0.3872), item("s", "Loki - Systèmes (schéma)", 0.2256)] };
  assert.equal(logic.endReward(loki), "Loki", "the words the items share");
  const ext = logic.buildScreen(input(value({ mission: mission({ type: { id: "extermination", name: "Exterminate" }, rewards: null }), progress: progress({ rotation: null }) })));
  assert.equal(ext.info, "No loot table for this kind of mission.");
  assert.equal(ext.source, false);
  const fresh = logic.buildScreen(input(value({ mission: mission({ state: "loading", node: { id: "SolNode999", name: null }, rewards: null }), progress: null })));
  assert.equal(fresh.node, "New node");
  assert.equal(fresh.empty.title, "Loot not published yet");
  const off = value({ mission: mission({ rewards: null }), progress: progress({ rewards: 2, rotation: "B", nextRewardAt: START + 900_000 }) });
  off.features.rewards = "unavailable";
  const s = logic.buildScreen(input(off, { now: START + 60_000 }));
  assert.equal(s.empty.title, "Loot unavailable for now");
  assert.equal(s.heroLabel, "Rotation B in");
  assert.equal(s.line, "Mot · B in");
});

test("after the mission: a summary without tables; failed and aborted lose the rewards", () => {
  const ended = (result, d = 1241.5) => value({ mission: mission({ state: "ended", result, endedAt: START + d * 1000, durationSeconds: d }), progress: progress({ rewards: 4, rotation: "A", nextRewardAt: START + 1_500_000 }) });
  const ok = logic.buildScreen(input(ended("succeeded")));
  assert.equal(ok.eyebrow, "Survival · succeeded");
  assert.equal(ok.tone, "success");
  assert.equal(ok.info, "4 rotations earned in 20 min 41");
  assert.deepEqual(ok.track.map((c) => c.cls), ["cell earned", "cell earned", "cell earned", "cell earned"]);
  assert.equal(ok.sections.length + ok.cols.length, 0);
  assert.equal(ok.line, "Mot · succeeded · 4 rotations");
  const failed = logic.buildScreen(input(ended("failed", 790)));
  assert.equal(failed.info, "Rewards lost 13 min into the mission.");
  assert.equal(failed.track.length, 0);
  const aborted = logic.buildScreen(input(ended("aborted")));
  assert.equal(aborted.info, "Left without extracting: rewards lost.");
  assert.equal(aborted.tone, "warning");
  assert.equal(aborted.line, "Mot · aborted");
  const silent = logic.buildScreen(input(ended(null)));
  assert.equal(silent.eyebrow, "Survival · ended");
});

test("game closed: the last mission, and how long ago", () => {
  const v = value({ mission: mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1241 }), progress: progress({ rewards: 4 }) }, { playing: false });
  const now = START + 2 * 3600_000 + 5 * 60_000;
  const s = logic.buildScreen(input(v, { now }));
  assert.equal(logic.eyebrowText(s, now), "Survival · 2 h ago");
  assert.equal(logic.at(s.line, s, now), "Mot · 4 rotations · 2 h ago");
});

test("the screen at start, refused, unreadable, and the stored last mission", () => {
  assert.equal(logic.buildScreen(input(null)).empty.title, "Pick a mission");
  const denied = logic.buildScreen(input(null, { failure: "permission_denied" }));
  assert.equal(denied.empty.title, "Allow “Warframe: missions” in the Control Center.");
  assert.equal(denied.empty.tone, "warning");
  assert.equal(denied.empty.titleCls, "tone-warning", "the sentence itself in amber");
  assert.equal(denied.line, "Access denied · Control Center");
  const off = value({});
  off.features.mission = "unavailable";
  assert.equal(logic.buildScreen(input(off)).empty.title, "Missions can't be read");
  const last = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1241 }), progress({ rewards: 4 }), START);
  const s = logic.buildScreen(input(value({}), { last }));
  assert.equal(s.eyebrow, "Survival · last mission");
});

test("an error never takes the place of a value still known: it goes beside it", () => {
  const now = START + 60_000;
  const running = value({ mission: mission(), progress: progress({ rewards: 2, rotation: "B", nextRewardAt: START + 900_000 }) });
  const lost = logic.buildScreen(input(running, { now, failure: "permission_denied" }));
  assert.equal(lost.heroLabel, "Rotation B in", "the last countdown stays");
  assert.equal(lost.status, "Allow “Warframe: missions” in the Control Center.");
  assert.equal(lost.lineTone, "warning");
  const noLoot = value({ mission: mission({ rewards: null }), progress: progress({ rewards: 2, rotation: "B", nextRewardAt: START + 900_000 }) });
  noLoot.features.rewards = "undeclared";
  const s = logic.buildScreen(input(noLoot, { now }));
  assert.equal(s.status, "Allow “Warframe: rewards” in the Control Center.");
  assert.equal(s.info, "", "no false 'no loot table'");
  assert.equal(s.empty, null);
  const last = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1241 }), progress({ rewards: 4 }), START);
  const off = value({});
  off.features.mission = "unavailable";
  const kept = logic.buildScreen(input(off, { last }));
  assert.equal(kept.info, "4 rotations earned in 20 min 41");
  assert.equal(kept.status, "Missions can't be read · restart Warframe");
});

test("the widget: the countdown ticks on its second, the rotation moves on alone, the last mission is stored", async () => {
  vm.push(SERVICE, value({ mission: mission(), progress: progress({ rewards: 0, rotation: "A", nextRewardAt: START + 300_000 }) }));
  await flush();
  assert.equal(state.s.heroLabel, "Rotation A in");
  vm.advance(300_000);
  assert.equal(state.s.heroLabel, "Rotation A in", "the second A");
  assert.equal(logic.at(state.s.heroValue, state.s, state.now), "5:00");
  assert.deepEqual(state.s.track.map((c) => c.cls), ["cell earned", "cell now", "cell", "cell"]);
  vm.advance(300_000);
  assert.equal(state.s.heroLabel, "Rotation B in");
  vm.push(SERVICE, value({ mission: mission({ state: "ended", result: "aborted", endedAt: vm.now, durationSeconds: 600 }), progress: progress({ rewards: 2, rotation: "B" }) }));
  await flush();
  const saved = vm.lastCall("storage.set");
  assert.equal(saved.params.key, "last");
  assert.equal(saved.params.value.result, "aborted");
  assert.equal(state.s.info, "Left without extracting: rewards lost.");
});

test("a relaunched mission folds the unfolded tables and starts again", async () => {
  vm.push(SERVICE, value({ mission: mission({ startedAt: vm.now, selectedAt: vm.now - 1 }), progress: progress({ nextRewardAt: vm.now + 300_000 }) }));
  await flush();
  logic.toggle("list:A");
  assert.deepEqual(state.open, ["list:A"]);
  vm.push(SERVICE, value({ mission: mission({ state: "selected", selectedAt: vm.now + 5, startedAt: null }), progress: null }));
  await flush();
  assert.deepEqual(state.open, []);
  assert.equal(state.s.eyebrow, "Survival · picked");
});

test("French: typographic spaces and words", () => {
  vm.setHost({ locale: "fr", messages: FR });
  const now = START + 60_000 * 13 + 12_000;
  const s = logic.buildScreen(input(value({ mission: mission({ planet: { id: "void", name: "Néant" } }), progress: progress({ rewards: 2, rotation: "B", nextRewardAt: START + 15 * 60_000 }) }), { now }));
  assert.equal(s.heroLabel, "Rotation B dans");
  assert.equal(logic.heroSubText(s, now), "C dans 6:48");
  assert.equal(s.sections[0].rows[0].chance, "12.50 %");
  assert.equal(logic.durationText(1241), "20 min 41");
  vm.setHost({ locale: "en", messages: EN });
});
