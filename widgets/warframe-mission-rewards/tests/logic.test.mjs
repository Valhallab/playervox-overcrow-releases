// Unit tests of the mission rewards logic on @overcrow/sdk/testing: the
// rotation at every boundary, endless cycles, the tables in both orders, the
// recap after the mission. The values are synthetic, in the shape of
// Warframe's game events.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const EN = read("../locales/en.json");
const FR = read("../locales/fr.json");
const START = Date.UTC(2026, 9, 28, 18, 0, 0);
const MIN = 60_000;
const SERVICE = "gameEvents.warframe.subscribe";

const vm = installRuntime({
  now: START,
  host: { messages: EN, locale: "en", mode: "interactive", grants: ["storage", "gameEvents"] },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const flush = () => new Promise((resolve) => setImmediate(resolve));

const item = (id, name, chance, quantity = 1) => ({ id, name, quantity, chance, icon: null, iconPending: false, category: "other" });
const MOT = {
  source: "node",
  tables: [
    { kind: "mission", rotation: "A", items: [item("neo_y2_relic", "Neo Y2 Relic", 0.1818), item("aya", "Aya", 0.0909), item("neo_c7_relic", "Neo C7 Relic", 0.0909)] },
    { kind: "mission", rotation: "B", items: [item("neo_c7_relic", "Neo C7 Relic", 0.125), item("aya", "Aya", 0.125)] },
    { kind: "mission", rotation: "C", items: [item("aya", "Aya", 0.2211), item("axi_s21_relic", "Axi S21 Relic", 0.0973)] },
  ],
};
const CYCLE = ["A", "A", "B", "C"];
/** The rotations earned after `n` rewards: A A B C again, or an Arbitration's A A B B then C. */
const letters = (n, arbitration = false) =>
  Array.from({ length: n }, (_, i) => (arbitration ? (i < 4 ? "AABB"[i] : "C") : CYCLE[i % 4]));
const earned = (n, arbitration = false) => {
  const rotations = letters(n, arbitration);
  return { rotations, totals: { A: rotations.filter((l) => l === "A").length, B: rotations.filter((l) => l === "B").length, C: rotations.filter((l) => l === "C").length } };
};
const cycle = (n, arbitration = false) => {
  const number = Math.floor(n / 4) + 1;
  const rotations = arbitration ? (number === 1 ? ["A", "A", "B", "B"] : ["C", "C", "C", "C"]) : CYCLE;
  return { number, rotations, earned: n % 4 };
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
  selectedAt: START - MIN,
  loadingAt: START - 30_000,
  startedAt: START,
  endedAt: null,
  result: null,
  durationSeconds: null,
  rewards: MOT,
  rewardsPending: false,
  earned: null,
  credits: null,
  ...over,
});
/** The progress after `rewards` rewards, as the host gives it. */
const progress = (rewards = 0, over = {}, arbitration = false) => {
  const c = cycle(rewards, arbitration);
  return {
    wave: null,
    waveEnemies: null,
    round: null,
    rewards,
    rotation: c.rotations[c.earned],
    earned: earned(rewards, arbitration),
    cycle: c,
    clock: null,
    nextRewardAt: null,
    nextRewardWave: null,
    ...over,
  };
};
const survival = (rewards, nextRewardAt, over = {}) => progress(rewards, { clock: "running", nextRewardAt, ...over });
const GLOSSARY_EN = { language: "en", term: { reactant: "Reactant", relic: "Relic", credits: "Credits" } };
const value = (info, over = {}) => ({
  playing: true,
  session: { startedAt: START - 600_000, language: "en" },
  glossary: GLOSSARY_EN,
  features: { location: "undeclared", mission: "available", progress: "available", squad: "undeclared", eidolons: "undeclared", world: "undeclared", rewards: "available" },
  info: { location: null, mission: null, progress: null, squad: null, eidolons: null, world: null, ...info },
  events: [],
  ...over,
});
const input = (v, over = {}) => ({ value: v, failure: null, last: null, now: vm.now, layout: "standard", order: "rarest", open: [], ...over });
const HYDRON = { node: { id: "SolNode195", name: "Hydron" }, planet: { id: "sedna", name: "Sedna" }, type: { id: "defense", name: "Defense" }, faction: { id: "grineer", name: "Grineer" } };
const defense = (rewards, wave, nextRewardWave, waveEnemies) => progress(rewards, { wave, nextRewardWave, waveEnemies });
const cells = (s) => s.track.map((c) => `${c.label}:${c.cls}`);

// The storage read at start: nothing stored.
await flush();
vm.lastCall("storage.get")?.resolve(null);
await flush();

test("survival: the countdown, then the next rotation at the very moment, without waiting for Warframe", () => {
  const p = survival(2, START + 15 * MIN);
  const before = logic.project(p, START + 15 * MIN - 1);
  assert.deepEqual([before.letter, before.rewards], ["B", 2]);
  assert.equal(logic.countdownText(before.nextAt - (START + 15 * MIN - 1)), "0:01");
  const at = logic.project(p, START + 15 * MIN);
  assert.equal(at.letter, "C", "at 15:00 sharp, B is given");
  assert.equal(at.rewards, 3);
  assert.deepEqual(at.cycle, { number: 1, rotations: ["A", "A", "B", "C"], earned: 3 });
  assert.deepEqual(at.totals, { A: 2, B: 1, C: 0 });
  assert.equal(at.nextAt, START + 20 * MIN);
});

test("survival: Warframe tells the reward 26 s late; nothing jumps when it does", () => {
  const now = START + 15 * MIN + 26_000;
  const a = logic.buildScreen(input(value({ mission: mission(), progress: survival(2, START + 15 * MIN) }), { now }));
  const b = logic.buildScreen(input(value({ mission: mission(), progress: survival(3, START + 20 * MIN) }), { now }));
  assert.deepEqual(a, b);
  assert.equal(a.heroLabel, "Rotation C in");
  assert.equal(logic.at(a.heroValue, a, now), "4:34");
  assert.equal(logic.heroSubText(a, now), "Then A in 9:34", "always the reward after the next one");
  assert.equal(logic.clockValue(a, now), "15:26");
});

test("survival before the panel is hacked: no countdown, no rotation in progress, the mission clock runs", () => {
  const now = START + 11_000;
  const s = logic.buildScreen(input(value({ mission: mission(), progress: progress(0, { clock: "waiting" }) }), { now }));
  assert.equal(s.heroLabel, "Waiting for the hack");
  assert.equal(s.heroIcon, "hourglass");
  assert.equal(s.heroValue, "");
  assert.equal(s.heroSub, "Rotation A 5 min after the hack");
  assert.deepEqual(cells(s), ["A:cell", "A:cell", "B:cell", "C:cell"]);
  assert.equal(s.trackLabel, "Cycle 1");
  assert.equal(logic.clockValue(s, now), "0:11");
  assert.equal(s.line, "Mot · waiting for the hack");
  assert.equal(s.lineValue, "");
  // Hacked at 0:45: the countdown runs from there; the clock is ahead of it.
  const hacked = START + 45_000;
  const r = logic.buildScreen(input(value({ mission: mission(), progress: survival(0, hacked + 5 * MIN) }), { now: hacked + 60_000 }));
  assert.equal(logic.at(r.heroValue, r, hacked + 60_000), "4:00");
  assert.equal(logic.clockValue(r, hacked + 60_000), "1:45");
  assert.deepEqual(cells(r), ["A:cell now", "A:cell", "B:cell", "C:cell"]);
});

test("endless cycles: the cells restart after C with the cycle's number; one hour of Survival", () => {
  const now = START + 41 * MIN + 5_000;
  const c2 = logic.buildScreen(input(value({ mission: mission(), progress: survival(8, START + 45 * MIN) }), { now }));
  assert.equal(c2.trackLabel, "Cycle 3");
  assert.deepEqual(cells(c2), ["A:cell now", "A:cell", "B:cell", "C:cell"]);
  const p = survival(11, START + 60 * MIN);
  const hour = logic.project(p, START + 60 * MIN);
  assert.equal(hour.rewards, 12);
  assert.deepEqual(hour.cycle, { number: 4, rotations: ["A", "A", "B", "C"], earned: 0 });
  assert.deepEqual(hour.totals, { A: 6, B: 3, C: 3 });
  const s = logic.buildScreen(input(value({ mission: mission(), progress: p }), { now: START + 56 * MIN }));
  assert.deepEqual(cells(s), ["A:cell earned", "A:cell earned", "B:cell earned", "C:cell now"]);
  assert.equal(s.sections[0].got, "C earned ×2", "the table of a rotation already earned says so");
});

test("arbitration: A A B B, then C for ever; the cells then show the totals and the C to come", () => {
  const arb = mission({ modifiers: [{ id: "arbitration", name: "Arbitration", stage: null }] });
  const p = progress(3, { clock: "running", nextRewardAt: START + 20 * MIN }, true);
  const after = logic.project(p, START + 20 * MIN);
  assert.deepEqual(after.cycle, { number: 2, rotations: ["C", "C", "C", "C"], earned: 0 });
  assert.equal(after.letter, "C");
  const s = logic.buildScreen(input(value({ mission: arb, progress: progress(5, { clock: "running", nextRewardAt: START + 30 * MIN }, true) }), { now: START + 28 * MIN }));
  assert.deepEqual(cells(s), ["A ×2:cell earned", "B ×2:cell earned", "C ×1:cell earned", "C:cell now"]);
  assert.equal(s.trackLabel, "");
  assert.equal(logic.heroSubText(s, START + 28 * MIN), "Then C in 7:00");
  assert.deepEqual(s.pills.map((x) => x.text), ["Arbitration"]);
});

test("defense: the owner's words on one line, the current wave and its enemies under it", () => {
  const def = mission(HYDRON);
  const s = logic.buildScreen(input(value({ mission: def, progress: defense(2, 8, 9, { total: 32, left: 14 }) })));
  assert.equal(s.heroInline, true);
  assert.equal(s.heroLabel, "Rotation B at the end of wave ");
  assert.equal(s.heroValue, "9");
  assert.equal(s.heroCls, "next-big");
  assert.equal(s.heroSub, "Now: wave 8 · 14 enemies left");
  assert.equal(s.clock, "", "the header keeps the mission clock");
  assert.equal([s.line, s.lineValue].join(" "), "Hydron · B at end of wave 9");
  const pays = logic.buildScreen(input(value({ mission: def, progress: defense(2, 9, 9, { total: 34, left: 1 }) })));
  assert.equal(pays.heroLabel, "Rotation B at the end of ");
  assert.equal(pays.heroValue, "this wave");
  assert.equal(pays.heroCls, "next-big word accent");
  assert.equal([pays.line, pays.lineValue].join(" "), "Hydron · B at end of this wave", "One line stays within its 260 px");
  assert.equal(pays.heroSub, "Now: wave 9 · 1 enemy left");
  const cleared = logic.buildScreen(input(value({ mission: def, progress: defense(3, 9, 12, { total: 34, left: 0 }) })));
  assert.equal(cleared.heroLabel, "Rotation C at the end of wave ");
  assert.equal(cleared.heroValue, "12");
  assert.equal(cleared.heroSub, "Wave 9 done");
  const counting = logic.buildScreen(input(value({ mission: def, progress: defense(6, 20, 21, { total: 40, left: null }) })));
  assert.equal(counting.heroSub, "Now: wave 20");
  assert.equal(counting.trackLabel, "Cycle 2");
});

test("defense: a wave already past means its reward was given; every 3 waves, every 2 in Mirror Defense", () => {
  const past = logic.project(defense(2, 10, 9, null), START);
  assert.deepEqual([past.letter, past.rewards, past.nextWave], ["C", 3, 12]);
  const mirror = logic.project(progress(1, { wave: 5, nextRewardWave: 4 }), START);
  assert.deepEqual([mirror.rewards, mirror.nextWave], [2, 6]);
  const d24 = logic.project(defense(7, 24, 24, { total: 44, left: 0 }), START);
  assert.deepEqual(d24.totals, { A: 4, B: 2, C: 1 }, "the reward of wave 24 comes with its update");
});

test("before the mission: the three rotations stacked; Defense pays every 3 waves", () => {
  const s = logic.buildScreen(input(value({ mission: mission({ state: "selected", startedAt: null }), progress: null })));
  assert.equal(s.eyebrow, "Survival · picked");
  assert.equal(s.info, "One rotation every 5 min · C at 20 min");
  assert.deepEqual(s.sections.map((x) => x.title), ["Rotation A", "Rotation B", "Rotation C"]);
  assert.equal(s.track.length, 0);
  const d = logic.buildScreen(input(value({ mission: mission({ ...HYDRON, state: "selected", startedAt: null }), progress: null })));
  assert.equal(d.info, "One rotation every 3 waves · C at wave 12");
  assert.equal(d.line, "Hydron · C at wave 12");
});

test("unknown progress (Excavation, Disruption): stacked tables, no rotation made up", () => {
  const exc = mission({ type: { id: "excavation", name: "Excavation" } });
  const s = logic.buildScreen(input(value({ mission: exc, progress: progress(0, { rotation: null, cycle: null }) })));
  assert.equal(s.heroValue, "");
  assert.equal(s.track.length, 0);
  assert.equal(s.sections.length, 3);
  const dis = logic.buildScreen(input(value({ mission: mission({ type: { id: "disruption", name: "Disruption" } }), progress: progress(2, { round: 2, rotation: "B", cycle: null }) })));
  assert.equal(dis.track.length, 0, "a Disruption has no cycle");
});

test("interception: the rotation at the end of the next round", () => {
  const s = logic.buildScreen(input(value({ mission: mission({ type: { id: "interception", name: "Interception" } }), progress: progress(2, { round: 2 }) })));
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

test("images: the game's once the host has it, an empty tile while it may come, our icon of its kind when none will", () => {
  const relic = { ...item("neo_c7_relic", "Neo C7 Relic", 0.125), category: "relic" };
  assert.deepEqual(logic.itemImage({ ...relic, icon: "asset:00000000000000b1" }), { icon: "asset:00000000000000b1", glyph: "" });
  assert.deepEqual(logic.itemImage({ ...relic, iconPending: true }), { icon: "", glyph: "" });
  for (const [category, glyph] of [
    ["relic", "hexagon"],
    ["mod", "layers"],
    ["resource", "gem"],
    ["blueprint", "scroll-text"],
    ["warframe_part", "user-round"],
    ["weapon_part", "sword"],
    ["arcane", "sparkles"],
    ["currency", "coins"],
    ["other", "package"],
  ]) {
    assert.deepEqual(logic.itemImage({ ...relic, category }), { icon: "", glyph }, category);
  }
  // Each row carries its item's.
  const table = { kind: "mission", rotation: "B", items: [{ ...relic, icon: "asset:00000000000000b1" }, { ...item("endo", "Endo", 0.2, 80), category: "currency" }] };
  const rows = logic.section("b", "B", table, 10, "rarest", []).rows;
  assert.deepEqual(rows.map((row) => [row.icon, row.glyph]), [["asset:00000000000000b1", ""], ["", "coins"]]);
});

test("the height never moves within a mission: empty lines up to the node's longest rotation", () => {
  const now = START + 60_000;
  const a = logic.buildScreen(input(value({ mission: mission(), progress: survival(0, START + 5 * MIN) }), { now }));
  const b = logic.buildScreen(input(value({ mission: mission(), progress: survival(2, START + 15 * MIN) }), { now: START + 14 * MIN }));
  assert.equal(a.sections[0].rows.length + a.sections[0].fill.length, 3);
  assert.equal(b.sections[0].rows.length + b.sections[0].fill.length, 3);
  assert.equal(b.sections[0].fill.length, 1);
  const long = { source: "node", tables: [MOT.tables[0], { kind: "mission", rotation: "B", items: Array.from({ length: 14 }, (_, i) => item(`x${i}`, `X${i}`, 0.05)) }, MOT.tables[2]] };
  const c = logic.buildScreen(input(value({ mission: mission({ rewards: long }), progress: survival(0, START + 5 * MIN) }), { now }));
  assert.equal(c.sections[0].fill.length, 7, "10 rows for B: 3 shown, 7 empty");
  assert.equal(c.sections[0].fillMore, true, "B has + n more: an empty one here");
});

test("where the loot comes from: an Arbitration's own table, a Sortie's reward, a Nightmare mod", () => {
  const arbTables = { source: "arbitration", tables: MOT.tables };
  const arb = logic.buildScreen(input(value({ mission: mission({ rewards: arbTables, modifiers: [{ id: "arbitration", name: "Arbitration", stage: null }] }), progress: progress(5, { clock: "running", nextRewardAt: START + 30 * MIN }, true) }), { now: START + 28 * MIN }));
  assert.equal(arb.sections[0].title, "Arbitration · rotation C");
  const one = { kind: "mission", rotation: null, items: [item("forma", "Forma", 0.025), item("legendary_core", "Legendary Core", 0.0019)] };
  const sortie = logic.buildScreen(input(value({ mission: mission({ rewards: { source: "sortie", tables: [one] }, faction: null, modifiers: [{ id: "sortie", name: "Sortie", stage: 1 }] }), progress: progress(0, { rotation: null, cycle: null }) })));
  assert.deepEqual(sortie.sections.map((x) => x.title), ["Sortie reward"]);
  assert.equal(sortie.info, "One, after the 3rd mission");
  assert.equal(sortie.heroValue, "");
  assert.equal(sortie.track.length, 0);
  assert.equal(sortie.sections[0].rows[0].name, "Legendary Core");
  assert.deepEqual(sortie.pills.map((x) => x.text), ["Sortie 1/3"]);
  assert.equal(sortie.line, "Mot · reward after the 3rd mission");
  const mod = { kind: "mission", rotation: "A", items: [item("blaze", "Blaze", 0.0101), item("ice_storm", "Ice Storm", 0.1897)] };
  const nightmare = logic.buildScreen(input(value({ mission: mission({ type: { id: "extermination", name: "Extermination" }, rewards: { source: "nightmare", tables: [mod] }, modifiers: [{ id: "nightmare", name: "Nightmare", stage: null }] }), progress: progress(0, { rotation: null, cycle: null }) })));
  assert.deepEqual(nightmare.sections.map((x) => x.title), ["Nightmare mod, once"]);
  assert.equal(nightmare.track.length, 0);
  assert.equal(nightmare.line, "Mot · Nightmare mod, once");
});

test("no loot: known on loading, or no published table; a new node; loot unavailable", () => {
  const iliad = { node: { id: "SolNode305", name: "Iliad" }, planet: { id: "phobos", name: "Phobos" }, type: { id: "assassination", name: "Assassination" }, faction: null };
  const pending = logic.buildScreen(input(value({ mission: mission({ ...iliad, state: "selected", startedAt: null, rewards: null, rewardsPending: true }), progress: null })));
  assert.equal(pending.empty.icon, "hourglass");
  assert.equal(pending.empty.title, "Loot known on loading");
  assert.equal(pending.empty.titleCls, "muted");
  assert.equal(pending.line, "Iliad · loot on loading");
  const archon = logic.buildScreen(input(value({ mission: mission({ ...iliad, state: "loading", startedAt: null, rewards: null, modifiers: [{ id: "archon_hunt", name: "Archon Hunt", stage: 3 }] }), progress: null })));
  assert.equal(archon.empty.icon, "package-x");
  assert.equal(archon.empty.title, "No published loot table for this mission");
  assert.equal(archon.line, "Iliad · no table");
  assert.deepEqual([archon.lineIcon, archon.lineTone], ["package-x", "muted"], "One line shows the panel's crossed-out box");
  assert.deepEqual([pending.lineIcon, pending.lineTone], ["hourglass", "muted"], "and the hourglass while it waits");
  assert.deepEqual(archon.pills.map((x) => x.text), ["Archon Hunt"]);
  const ext = logic.buildScreen(input(value({ mission: mission({ type: { id: "extermination", name: "Exterminate" }, state: "selected", startedAt: null, rewards: null }), progress: null })));
  assert.equal(ext.empty.title, "No published loot table for this mission", "an ordinary Exterminate, from its pick");
  assert.equal(ext.source, false);
  const fresh = logic.buildScreen(input(value({ mission: mission({ state: "loading", node: { id: "SolNode999", name: null }, rewards: null }), progress: null })));
  assert.equal(fresh.node, "New node");
  assert.equal(fresh.empty.title, "Loot not published yet");
  const off = value({ mission: mission({ rewards: null }), progress: survival(2, START + 15 * MIN) });
  off.features.rewards = "unavailable";
  const s = logic.buildScreen(input(off, { now: START + MIN }));
  assert.equal(s.empty.title, "Loot unavailable for now");
  assert.equal(s.heroLabel, "Rotation B in");
});

test("an end reward without rotation names it in One line", () => {
  const ps = { source: "node", tables: [{ kind: "mission", rotation: null, items: [item("loki_systems_blueprint", "Loki Systems Blueprint", 0.2256)] }] };
  const ass = logic.buildScreen(input(value({ mission: mission({ type: { id: "assassination", name: "Assassination" }, rewards: ps }), progress: progress(0, { rotation: null, cycle: null }) })));
  assert.equal(ass.info, "No rotation: one reward at the end");
  assert.equal(ass.sections[0].title, "End reward");
  assert.equal(ass.line, "Mot · Loki Systems Blueprint");
  const loki = { kind: "mission", rotation: null, items: [item("n", "Loki - Neuroptiques (schéma)", 0.3872), item("c", "Loki - Châssis (schéma)", 0.3872), item("s", "Loki - Systèmes (schéma)", 0.2256)] };
  assert.equal(logic.endReward(loki), "Loki");
});

test("the recap: one line of facts, no table; the rotations in green, the credits in the game's word", () => {
  const ended = (over, p = progress(12)) => value({ mission: mission({ state: "ended", result: "succeeded", endedAt: START + 3734_400, durationSeconds: 3734.4, earned: earned(12), credits: 128450, ...over }), progress: p });
  const ok = logic.buildScreen(input(ended({})));
  assert.equal(ok.eyebrow, "Survival · succeeded");
  assert.equal(ok.tone, "success");
  assert.deepEqual([ok.factsTop, ok.factsLead, ok.factsGot, ok.factsTail], ["", "1:02:14 · ", "A ×6 · B ×3 · C ×3", " · 128,450 Credits"]);
  assert.equal(ok.factsCls, "facts-got");
  assert.equal(ok.track.length + ok.sections.length + ok.cols.length, 0, "no cells, no tables");
  assert.equal(ok.source, false);
  assert.equal(ok.clock, "");
  assert.equal(ok.line, "Mot · A ×6 · B ×3 · C ×3");
  const wide = logic.buildScreen(input(ended({}), { layout: "wide" }));
  assert.equal(wide.cols.length, 0);
  const onlyA = logic.buildScreen(input(ended({ earned: earned(2), credits: 34300, durationSeconds: 393.6 })));
  assert.equal(onlyA.factsGot, "A ×2");
  const def = logic.buildScreen(input(value({ mission: mission({ ...HYDRON, state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1530.4, earned: earned(8), credits: 61870 }), progress: defense(8, 24, 27, { total: 44, left: 0 }) })));
  assert.deepEqual([def.factsTop, def.factsLead, def.factsGot, def.factsTail], ["25:30 · 24 waves", "", "A ×4 · B ×2 · C ×2", " · 61,870 Credits"], "a Defense on two lines, never cut in a group");
  const noCredits = logic.buildScreen(input(ended({ credits: null })));
  assert.equal(noCredits.factsTail, "");
});

test("the recap of a mission lost: the duration and the rotations lost, in neutral", () => {
  const lost = (result, n) => value({ mission: mission({ state: "ended", result, endedAt: START, durationSeconds: 880, earned: earned(n), credits: null }), progress: progress(n) });
  const aborted = logic.buildScreen(input(lost("aborted", 2)));
  assert.equal(aborted.tone, "warning");
  assert.deepEqual([aborted.factsLead, aborted.factsGot, aborted.factsTail], ["14:40 · ", "Rotations lost: A ×2", ""]);
  assert.equal(aborted.factsCls, "facts-got lost");
  assert.equal(aborted.info, "");
  const failed = logic.buildScreen(input(lost("failed", 3)));
  assert.equal(failed.factsGot, "Rotations lost: A ×2 · B ×1");
  assert.equal(failed.tone, "danger");
  const nothing = logic.buildScreen(input(lost("aborted", 0)));
  assert.equal(nothing.info, "Left without extracting: rewards lost.");
  assert.equal(nothing.line, "Mot · aborted");
});

test("game closed: the same recap, its result and how long ago", () => {
  const v = value({ mission: mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 3734.4, earned: earned(12), credits: 128450 }), progress: progress(12) }, { playing: false });
  const now = START + 2 * 3600_000 + 5 * MIN;
  const s = logic.buildScreen(input(v, { now }));
  assert.equal(logic.eyebrowText(s, now), "Survival · succeeded · 2 h ago");
  assert.equal(s.tone, "success");
  assert.equal(s.factsGot, "A ×6 · B ×3 · C ×3");
  assert.equal(logic.at(s.line, s, now), "Mot · A ×6 · B ×3 · C ×3 · 2 h ago");
});

test("the stored last mission: the recap's facts, and an older stored shape ignored", () => {
  const last = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 3734.4, earned: earned(12), credits: 128450 }), progress(12), START, "Credits");
  assert.deepEqual(last.got, { A: 6, B: 3, C: 3 });
  assert.equal(last.credits, 128450);
  assert.equal(logic.isLast(last), true);
  const s = logic.buildScreen(input(value({}), { last }));
  assert.equal(s.eyebrow, "Survival · last mission");
  assert.equal(s.factsTail, " · 128,450 Credits");
  const old = { node: "Mot", planet: "Void", faction: "Corrupted", factionId: "corrupted", typeId: "survival", typeName: "Survival", result: "succeeded", durationSeconds: 1241, rewards: 4, endedAt: START };
  assert.equal(logic.isLast(old), false);
});

test("the screen at start, refused, unreadable", () => {
  assert.equal(logic.buildScreen(input(null)).empty.title, "Pick a mission");
  const denied = logic.buildScreen(input(null, { failure: "permission_denied" }));
  assert.equal(denied.empty.title, "Allow “Warframe: missions” in the Control Center.");
  assert.equal(denied.empty.titleCls, "tone-warning");
  assert.equal(denied.line, "Access denied · Control Center");
  const off = value({});
  off.features.mission = "unavailable";
  assert.equal(logic.buildScreen(input(off)).empty.title, "Missions can't be read");
});

test("an error never takes the place of a value still known: it goes beside it", () => {
  const now = START + MIN;
  const running = value({ mission: mission(), progress: survival(2, START + 15 * MIN) });
  const lost = logic.buildScreen(input(running, { now, failure: "permission_denied" }));
  assert.equal(lost.heroLabel, "Rotation B in");
  assert.equal(lost.status, "Allow “Warframe: missions” in the Control Center.");
  assert.equal([lost.line, logic.at(lost.lineValue, lost, now), lost.lineAfter].join("|"), "|14:00|· Access denied");
  const noLoot = value({ mission: mission({ rewards: null }), progress: survival(2, START + 15 * MIN) });
  noLoot.features.rewards = "undeclared";
  const s = logic.buildScreen(input(noLoot, { now }));
  assert.equal(s.status, "Allow “Warframe: rewards” in the Control Center.");
  assert.equal(s.empty, null, "no false 'no loot table'");
  const last = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1241, earned: earned(4), credits: 20000 }), progress(4), START, "Credits");
  const off = value({});
  off.features.mission = "unavailable";
  const kept = logic.buildScreen(input(off, { last }));
  assert.equal(kept.factsGot, "A ×2 · B ×1 · C ×1");
  assert.equal(kept.status, "Missions can't be read · restart Warframe");
  const refusedLast = logic.buildScreen(input(null, { last, failure: "permission_denied" }));
  assert.equal(refusedLast.line, "Mot · Access denied");
});

test("the widget: the countdown ticks on its second, the rotation moves on alone, the last mission is stored", async () => {
  vm.push(SERVICE, value({ mission: mission(), progress: survival(0, START + 300_000) }));
  await flush();
  assert.equal(state.s.heroLabel, "Rotation A in");
  vm.advance(300_000);
  assert.equal(state.s.heroLabel, "Rotation A in", "the second A");
  assert.equal(logic.at(state.s.heroValue, state.s, state.now), "5:00");
  assert.deepEqual(state.s.track.map((c) => c.cls), ["cell earned", "cell now", "cell", "cell"]);
  vm.advance(300_000);
  assert.equal(state.s.heroLabel, "Rotation B in");
  vm.push(SERVICE, value({ mission: mission({ state: "ended", result: "aborted", endedAt: vm.now, durationSeconds: 600, earned: earned(2) }), progress: progress(2) }));
  await flush();
  const saved = vm.lastCall("storage.set");
  assert.equal(saved.params.key, "last");
  assert.equal(saved.params.value.result, "aborted");
  assert.equal(state.s.factsGot, "Rotations lost: A ×2");
});

test("a relaunched mission folds the unfolded tables and starts again", async () => {
  vm.push(SERVICE, value({ mission: mission({ startedAt: vm.now, selectedAt: vm.now - 1 }), progress: survival(0, vm.now + 300_000) }));
  await flush();
  logic.toggle("list:A");
  assert.deepEqual(state.open, ["list:A"]);
  vm.push(SERVICE, value({ mission: mission({ state: "selected", selectedAt: vm.now + 5, startedAt: null }), progress: null }));
  await flush();
  assert.deepEqual(state.open, []);
  assert.equal(state.s.eyebrow, "Survival · picked");
});

test("French app, English game: the widget's words in French, the game's names as the game writes them", () => {
  vm.setHost({ locale: "fr", messages: FR });
  const now = START + 13 * MIN + 12_000;
  const s = logic.buildScreen(input(value({ mission: mission(), progress: survival(2, START + 15 * MIN) }), { now }));
  assert.equal(s.heroLabel, "Rotation B dans");
  assert.equal(logic.heroSubText(s, now), "Puis C dans 6:48");
  assert.equal(s.eyebrow, "Survival · en cours");
  assert.equal(s.sections[0].rows[0].chance, "12.50 %");
  const def = logic.buildScreen(input(value({ mission: mission(HYDRON), progress: defense(2, 8, 9, { total: 32, left: 14 }) })));
  assert.equal(def.heroLabel, "Rotation B à la fin de la vague ");
  assert.equal(def.heroSub, "En cours : vague 8 · 14 ennemis restants");
  const end = logic.buildScreen(input(value({ mission: mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 3734.4, earned: earned(12), credits: 128450 }), progress: progress(12) })));
  assert.equal(end.factsTail, " · 128,450 Credits", "the game's word for credits");
  const frGame = logic.buildScreen(input(value({ mission: mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 3734.4, earned: earned(12), credits: 128450 }), progress: progress(12) }, { glossary: { language: "fr", term: { reactant: "Réactif", relic: "Relique", credits: "Crédits" } } })));
  assert.equal(frGame.factsTail, " · 128,450 Crédits");
  vm.setHost({ locale: "en", messages: EN });
});
