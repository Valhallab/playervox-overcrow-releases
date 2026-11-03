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
  typeAtLoading: false,
  relic: null,
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
const GLOSSARY_FR = { language: "fr", term: { reactant: "Réactif", relic: "Relique", credits: "Crédits" } };
/** A value of the game events; `features` changes only the features it names. */
const value = (info, { features = {}, ...over } = {}) => ({
  playing: true,
  session: { startedAt: START - 600_000, language: "en" },
  glossary: GLOSSARY_EN,
  features: { location: "undeclared", mission: "available", progress: "available", squad: "undeclared", eidolons: "undeclared", world: "available", rewards: "available", ...features },
  info: { location: null, mission: null, progress: null, squad: null, eidolons: null, world: null, ...info },
  events: [],
  ...over,
});
const input = (v, over = {}) => ({ value: v, failure: null, last: null, now: vm.now, layout: "standard", order: "rarest", open: [], mode: "interactive", width: 300, height: 520, ...over });
/** The screen of `value(info, valueOver)`, with the input's `over`. */
const screen = (info, over = {}, valueOver = {}) => logic.buildScreen(input(value(info, valueOver), over));
/** A progress that counts no rotation. */
const untracked = () => progress(0, { rotation: null, cycle: null });
/** A mission picked, not started yet. */
const picked = (over = {}) => mission({ state: "selected", startedAt: null, ...over });
/** One hour of Survival, succeeded. */
const ENDED_HOUR = mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 3734.4, earned: earned(12), credits: 128450 });
/** Runs `fn` with the app in French, then in English again. */
const inFrench = (fn) => {
  vm.setHost({ locale: "fr", messages: FR });
  try {
    return fn();
  } finally {
    vm.setHost({ locale: "en", messages: EN });
  }
};
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
  const a = screen({ mission: mission(), progress: survival(2, START + 15 * MIN) }, { now });
  const b = screen({ mission: mission(), progress: survival(3, START + 20 * MIN) }, { now });
  assert.deepEqual(a, b);
  assert.equal(a.heroLabel, "Rotation C in");
  assert.equal(logic.at(a.heroValue, a, now), "4:34");
  assert.equal(logic.heroSubText(a, now), "Then A in 9:34", "always the reward after the next one");
  assert.equal(logic.clockValue(a, now), "15:26");
});

test("survival before the panel is hacked: no countdown, no rotation in progress, the mission clock runs", () => {
  const now = START + 11_000;
  const s = screen({ mission: mission(), progress: progress(0, { clock: "waiting" }) }, { now });
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
  const r = screen({ mission: mission(), progress: survival(0, hacked + 5 * MIN) }, { now: hacked + 60_000 });
  assert.equal(logic.at(r.heroValue, r, hacked + 60_000), "4:00");
  assert.equal(logic.clockValue(r, hacked + 60_000), "1:45");
  assert.deepEqual(cells(r), ["A:cell now", "A:cell", "B:cell", "C:cell"]);
});

test("endless cycles: the cells restart after C with the cycle's number; one hour of Survival", () => {
  const now = START + 41 * MIN + 5_000;
  const c2 = screen({ mission: mission(), progress: survival(8, START + 45 * MIN) }, { now });
  assert.equal(c2.trackLabel, "Cycle 3");
  assert.deepEqual(cells(c2), ["A:cell now", "A:cell", "B:cell", "C:cell"]);
  const p = survival(11, START + 60 * MIN);
  const hour = logic.project(p, START + 60 * MIN);
  assert.equal(hour.rewards, 12);
  assert.deepEqual(hour.cycle, { number: 4, rotations: ["A", "A", "B", "C"], earned: 0 });
  assert.deepEqual(hour.totals, { A: 6, B: 3, C: 3 });
  const s = screen({ mission: mission(), progress: p }, { now: START + 56 * MIN });
  assert.deepEqual(cells(s), ["A:cell earned", "A:cell earned", "B:cell earned", "C:cell now"]);
  assert.equal(s.sections[0].got, "C earned ×2", "the table of a rotation already earned says so");
});

test("arbitration: A A B B, then C for ever; the cells then show the totals and the C to come", () => {
  const arb = mission({ modifiers: [{ id: "arbitration", name: "Arbitration", stage: null }] });
  const p = progress(3, { clock: "running", nextRewardAt: START + 20 * MIN }, true);
  const after = logic.project(p, START + 20 * MIN);
  assert.deepEqual(after.cycle, { number: 2, rotations: ["C", "C", "C", "C"], earned: 0 });
  assert.equal(after.letter, "C");
  const s = screen({ mission: arb, progress: progress(5, { clock: "running", nextRewardAt: START + 30 * MIN }, true) }, { now: START + 28 * MIN });
  assert.deepEqual(cells(s), ["A ×2:cell earned", "B ×2:cell earned", "C ×1:cell earned", "C:cell now"]);
  assert.equal(s.trackLabel, "");
  assert.equal(logic.heroSubText(s, START + 28 * MIN), "Then C in 7:00");
  assert.deepEqual(s.pills.map((x) => x.text), ["Arbitration"]);
});

test("defense: the owner's words on one line, the current wave and its enemies under it", () => {
  const def = mission(HYDRON);
  const s = screen({ mission: def, progress: defense(2, 8, 9, { total: 32, left: 14 }) });
  assert.equal(s.heroInline, true);
  assert.equal(s.heroLabel, "Rotation B at the end of wave ");
  assert.equal(s.heroValue, "9");
  assert.equal(s.heroCls, "next-big");
  assert.equal(s.heroSub, "Now: wave 8 · 14 enemies left");
  assert.equal(logic.clockValue(s, START + 25 * MIN), "25:00", "the header keeps the mission clock");
  assert.equal([s.line, s.lineValue].join(" "), "Hydron · B at end of wave 9");
  const pays = screen({ mission: def, progress: defense(2, 9, 9, { total: 34, left: 1 }) });
  assert.equal(pays.heroLabel, "Rotation B at the end of ");
  assert.equal(pays.heroValue, "this wave");
  assert.equal(pays.heroCls, "next-big word accent");
  assert.equal([pays.line, pays.lineValue].join(" "), "Hydron · B at end of this wave", "One line stays within its 260 px");
  assert.equal(pays.heroSub, "Now: wave 9 · 1 enemy left");
  const cleared = screen({ mission: def, progress: defense(3, 9, 12, { total: 34, left: 0 }) });
  assert.equal(cleared.heroLabel, "Rotation C at the end of wave ");
  assert.equal(cleared.heroValue, "12");
  assert.equal(cleared.heroSub, "Wave 9 done");
  const counting = screen({ mission: def, progress: defense(6, 20, 21, { total: 40, left: null }) });
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
  const s = screen({ mission: picked(), progress: null });
  assert.equal(s.eyebrow, "Survival · picked");
  assert.equal(s.info, "One rotation every 5 min · C at 20 min");
  assert.deepEqual(s.sections.map((x) => x.title), ["Rotation A", "Rotation B", "Rotation C"]);
  assert.equal(s.track.length, 0);
  const d = screen({ mission: picked(HYDRON), progress: null });
  assert.equal(d.info, "One rotation every 3 waves · C at wave 12");
  assert.equal(d.line, "Hydron · C at wave 12");
});

test("unknown progress (Excavation, Disruption): stacked tables, no rotation made up", () => {
  const exc = mission({ type: { id: "excavation", name: "Excavation" } });
  const s = screen({ mission: exc, progress: untracked() });
  assert.equal(s.heroValue, "");
  assert.equal(s.track.length, 0);
  assert.equal(s.sections.length, 3);
  const dis = screen({ mission: mission({ type: { id: "disruption", name: "Disruption" } }), progress: progress(2, { round: 2, rotation: "B", cycle: null }) });
  assert.equal(dis.track.length, 0, "a Disruption has no cycle");
});

test("interception: the rotation at the end of the next round", () => {
  const s = screen({ mission: mission({ type: { id: "interception", name: "Interception" } }), progress: progress(2, { round: 2 }) });
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

test("Compact: the height never moves within a mission, empty lines up to the node's longest rotation", () => {
  const now = START + 60_000;
  const a = screen({ mission: mission(), progress: survival(0, START + 5 * MIN) }, { now, layout: "compact" });
  const b = screen({ mission: mission(), progress: survival(2, START + 15 * MIN) }, { now: START + 14 * MIN, layout: "compact" });
  assert.equal(a.sections[0].rows.length + a.sections[0].fill.length, 3);
  assert.equal(b.sections[0].rows.length + b.sections[0].fill.length, 3);
  assert.equal(b.sections[0].fill.length, 1);
  const long = { source: "node", tables: [MOT.tables[0], { kind: "mission", rotation: "B", items: Array.from({ length: 14 }, (_, i) => item(`x${i}`, `X${i}`, 0.05)) }, MOT.tables[2]] };
  const c = screen({ mission: mission({ rewards: long }), progress: survival(0, START + 5 * MIN) }, { now });
  assert.deepEqual([c.sections[0].rows.length, c.sections[0].fill.length, c.sections[0].fillMore], [3, 0, false], "Full: the user's frame keeps the height, no empty line");
  const compact = screen({ mission: mission({ rewards: long }), progress: survival(0, START + 5 * MIN) }, { now, layout: "compact" });
  assert.deepEqual([compact.sections[0].rows.length, compact.sections[0].fill.length, compact.sections[0].fillMore], [3, 0, true], "Compact: A's 3 rows; B has + n more, an empty one here");
});

test("where the loot comes from: an Arbitration's own table, a Sortie's reward, a Nightmare mod", () => {
  const arbTables = { source: "arbitration", tables: MOT.tables };
  const arb = screen({ mission: mission({ rewards: arbTables, modifiers: [{ id: "arbitration", name: "Arbitration", stage: null }] }), progress: progress(5, { clock: "running", nextRewardAt: START + 30 * MIN }, true) }, { now: START + 28 * MIN });
  assert.equal(arb.sections[0].title, "Arbitration · rotation C");
  const one = { kind: "mission", rotation: null, items: [item("forma", "Forma", 0.025), item("legendary_core", "Legendary Core", 0.0019)] };
  const sortie = screen({ mission: mission({ rewards: { source: "sortie", tables: [one] }, faction: null, modifiers: [{ id: "sortie", name: "Sortie", stage: 1 }] }), progress: untracked() });
  assert.deepEqual(sortie.sections.map((x) => x.title), ["Sortie reward"]);
  assert.equal(sortie.info, "Just one, after the 3rd mission");
  assert.equal(sortie.heroValue, "");
  assert.equal(sortie.track.length, 0);
  assert.equal(sortie.sections[0].rows[0].name, "Legendary Core");
  assert.deepEqual(sortie.pills.map((x) => x.text), ["Sortie 1/3"]);
  assert.equal(sortie.line, "Mot · reward after the 3rd mission");
  const mod = { kind: "mission", rotation: "A", items: [item("blaze", "Blaze", 0.0101), item("ice_storm", "Ice Storm", 0.1897)] };
  const nightmare = screen({ mission: mission({ type: { id: "extermination", name: "Extermination" }, rewards: { source: "nightmare", tables: [mod] }, modifiers: [{ id: "nightmare", name: "Nightmare", stage: null }] }), progress: untracked() });
  assert.deepEqual(nightmare.sections.map((x) => x.title), ["Nightmare mod, once"]);
  assert.equal(nightmare.track.length, 0);
  assert.equal(nightmare.line, "Mot · Nightmare mod, once");
});

test("no loot: known on loading, or no published table; a new node; loot unavailable", () => {
  const iliad = { node: { id: "SolNode305", name: "Iliad" }, planet: { id: "phobos", name: "Phobos" }, type: { id: "assassination", name: "Assassination" }, faction: null };
  const pending = screen({ mission: picked({ ...iliad, rewards: null, rewardsPending: true }), progress: null });
  assert.equal(pending.empty.icon, "hourglass");
  assert.equal(pending.empty.title, "Loot known on loading");
  assert.equal(pending.empty.titleCls, "muted");
  assert.equal(pending.line, "Iliad · loot on loading");
  const archon = screen({ mission: mission({ ...iliad, state: "loading", startedAt: null, rewards: null, modifiers: [{ id: "archon_hunt", name: "Archon Hunt", stage: 3 }] }), progress: null });
  assert.equal(archon.empty.icon, "package-x");
  assert.equal(archon.empty.title, "No published loot table for this mission");
  assert.equal(archon.line, "Iliad · no table");
  assert.deepEqual([archon.lineIcon, archon.lineTone], ["package-x", "muted"], "One line shows the panel's crossed-out box");
  assert.deepEqual([pending.lineIcon, pending.lineTone], ["hourglass", "muted"], "and the hourglass while it waits");
  assert.deepEqual(archon.pills.map((x) => x.text), ["Archon Hunt"]);
  const ext = screen({ mission: picked({ type: { id: "extermination", name: "Exterminate" }, rewards: null }), progress: null });
  assert.equal(ext.empty.title, "No published loot table for this mission", "an ordinary Exterminate, from its pick");
  assert.equal(ext.source, false);
  const fresh = screen({ mission: mission({ state: "loading", node: { id: "SolNode999", name: null }, rewards: null }), progress: null });
  assert.equal(fresh.node, "New node");
  assert.equal(fresh.empty.title, "Loot not published yet");
  const s = screen({ mission: mission({ rewards: null }), progress: survival(2, START + 15 * MIN) }, { now: START + MIN }, { features: { rewards: "unavailable" } });
  assert.equal(s.empty.title, "Loot unavailable for now");
  assert.equal(s.heroLabel, "Rotation B in");
});

test("an end reward without rotation names it in One line", () => {
  const ps = { source: "node", tables: [{ kind: "mission", rotation: null, items: [item("loki_systems_blueprint", "Loki Systems Blueprint", 0.2256)] }] };
  const ass = screen({ mission: mission({ type: { id: "assassination", name: "Assassination" }, rewards: ps }), progress: untracked() });
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
  assert.deepEqual([ok.factsTop, ok.factsLead, ok.factsGot], ["", "1:02:14 · ", "A ×6 · B ×3 · C ×3"]);
  assert.deepEqual(ok.recap.map((r) => r.label + r.text), ["End bonus: 128,450 Credits"], "the end bonus on its own line");
  assert.equal(ok.factsCls, "facts-got");
  assert.equal(ok.track.length + ok.sections.length + ok.cols.length, 0, "no cells, no tables");
  assert.equal(ok.source, false);
  assert.equal(logic.hasClock(ok), false);
  assert.equal(ok.line, "Mot · A ×6 · B ×3 · C ×3");
  const wide = logic.buildScreen(input(ended({}), { layout: "wide" }));
  assert.equal(wide.cols.length, 0);
  const onlyA = logic.buildScreen(input(ended({ earned: earned(2), credits: 34300, durationSeconds: 393.6 })));
  assert.equal(onlyA.factsGot, "A ×2");
  const def = screen({ mission: mission({ ...HYDRON, state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1530.4, earned: earned(8), credits: 61870 }), progress: defense(8, 24, 27, { total: 44, left: 0 }) });
  assert.deepEqual([def.factsTop, def.factsLead, def.factsGot], ["25:30 · 24 waves", "", "A ×4 · B ×2 · C ×2"], "a Defense on two lines, never cut in a group");
  assert.deepEqual(def.recap.map((r) => r.text), ["61,870 Credits"]);
  const noCredits = logic.buildScreen(input(ended({ credits: null })));
  assert.deepEqual(noCredits.recap, []);
});

test("the recap of a mission lost: the duration and the rotations lost, in neutral", () => {
  const lost = (result, n) => value({ mission: mission({ state: "ended", result, endedAt: START, durationSeconds: 880, earned: earned(n), credits: null }), progress: progress(n) });
  const aborted = logic.buildScreen(input(lost("aborted", 2)));
  assert.equal(aborted.tone, "warning");
  assert.deepEqual([aborted.factsLead, aborted.factsGot], ["14:40 · ", "Rotations lost: A ×2"]);
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
  const v = value({ mission: ENDED_HOUR, progress: progress(12) }, { playing: false });
  const now = START + 2 * 3600_000 + 5 * MIN;
  const s = logic.buildScreen(input(v, { now }));
  assert.equal(logic.eyebrowText(s, now), "Survival · succeeded · 2 h ago");
  assert.equal(s.tone, "success");
  assert.equal(s.factsGot, "A ×6 · B ×3 · C ×3");
  assert.equal(logic.at(s.line, s, now), "Mot · A ×6 · B ×3 · C ×3 · 2 h ago");
});

test("the stored last mission: the recap's facts, and an older stored shape ignored", () => {
  const last = logic.lastFrom(ENDED_HOUR, progress(12), START, "Credits");
  assert.deepEqual(last.got, { A: 6, B: 3, C: 3 });
  assert.equal(last.credits, 128450);
  assert.equal(logic.isLast(last), true);
  assert.equal(logic.isLast({ ...last, typeId: "survival", rewards: 12 }), true, "a mission stored with fields this version no longer keeps");
  const s = screen({}, { last });
  assert.equal(s.eyebrow, "Survival · last mission");
  assert.deepEqual(s.recap.map((r) => r.text), ["128,450 Credits"]);
  const old = { node: "Mot", planet: "Void", faction: "Corrupted", factionId: "corrupted", typeId: "survival", typeName: "Survival", result: "succeeded", durationSeconds: 1241, rewards: 4, endedAt: START };
  assert.equal(logic.isLast(old), false);
});

test("the screen at start, refused, unreadable", () => {
  assert.equal(logic.buildScreen(input(null)).empty.title, "Pick a mission");
  const denied = logic.buildScreen(input(null, { failure: "permission_denied" }));
  assert.equal(denied.empty.title, "Allow “Warframe: missions” in the Control Center.");
  assert.equal(denied.empty.titleCls, "tone-warning");
  assert.equal(denied.line, "Access denied · Control Center");
  assert.equal(screen({}, {}, { features: { mission: "unavailable" } }).empty.title, "Missions can't be read");
});

test("an error never takes the place of a value still known: it goes beside it", () => {
  const now = START + MIN;
  const running = value({ mission: mission(), progress: survival(2, START + 15 * MIN) });
  const lost = logic.buildScreen(input(running, { now, failure: "permission_denied" }));
  assert.equal(lost.heroLabel, "Rotation B in");
  assert.equal(lost.status, "Allow “Warframe: missions” in the Control Center.");
  assert.equal([lost.line, logic.at(lost.lineValue, lost, now), lost.lineAfter].join("|"), "|14:00|· Access denied");
  const s = screen({ mission: mission({ rewards: null }), progress: survival(2, START + 15 * MIN) }, { now }, { features: { rewards: "undeclared" } });
  assert.equal(s.status, "Allow “Warframe: rewards” in the Control Center.");
  assert.equal(s.empty, null, "no false 'no loot table'");
  const last = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1241, earned: earned(4), credits: 20000 }), progress(4), START, "Credits");
  const kept = screen({}, { last }, { features: { mission: "unavailable" } });
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
  vm.push(SERVICE, value({ mission: picked({ selectedAt: vm.now + 5 }), progress: null }));
  await flush();
  assert.deepEqual(state.open, []);
  assert.equal(state.s.eyebrow, "Survival · picked");
});

test("French app, English game: the widget's words in French, the game's names as the game writes them", () =>
  inFrench(() => {
    const now = START + 13 * MIN + 12_000;
    const s = screen({ mission: mission(), progress: survival(2, START + 15 * MIN) }, { now });
    assert.equal(s.heroLabel, "Rotation B dans");
    assert.equal(logic.heroSubText(s, now), "Puis C dans 6:48");
    assert.equal(s.eyebrow, "Survival · en cours");
    assert.equal(s.sections[0].rows[0].chance, "12.50 %");
    const def = screen({ mission: mission(HYDRON), progress: defense(2, 8, 9, { total: 32, left: 14 }) });
    assert.equal(def.heroLabel, "Rotation B à la fin de la vague ");
    assert.equal(def.heroSub, "En cours : vague 8 · 14 ennemis restants");
    const end = screen({ mission: ENDED_HOUR, progress: progress(12) });
    assert.deepEqual(end.recap.map((r) => r.label + r.text), ["Prime de fin : 128,450 Credits"], "the game's word for credits");
    const frGame = screen({ mission: ENDED_HOUR, progress: progress(12) }, {}, { glossary: GLOSSARY_FR });
    assert.deepEqual(frGame.recap.map((r) => r.text), ["128,450 Crédits"]);
  }));

// ------------------------------------------------- the user's height, Sortie, Fissure, Circuit, open worlds

const SORTIE_ITEMS = [
  ["legendary_core", "Legendary Core", 0.0019, 1], ["kitgun_riven_mod", "Kitgun Riven Mod", 0.01, 1], ["zaw_riven_mod", "Zaw Riven Mod", 0.01, 1],
  ["shotgun_riven_mod", "Shotgun Riven Mod", 0.022, 1], ["exilus_warframe_adapter", "Exilus Warframe Adapter", 0.025, 1], ["forma", "Forma", 0.025, 1],
  ["orokin_catalyst_blueprint", "Orokin Catalyst Blueprint", 0.025, 1], ["orokin_reactor_blueprint", "Orokin Reactor Blueprint", 0.025, 1],
  ["affinity_booster", "Affinity Booster", 0.0327, 1], ["mod_drop_chance_booster", "Mod Drop Chance Booster", 0.0327, 1],
  ["resource_drop_chance_booster", "Resource Drop Chance Booster", 0.0327, 1], ["pistol_riven_mod", "Pistol Riven Mod", 0.07, 1],
  ["rifle_riven_mod", "Rifle Riven Mod", 0.07, 1], ["melee_riven_mod", "Melee Riven Mod", 0.098, 1], ["endo", "Endo", 0.12, 4000], ["kuva", "Kuva", 0.12, 6000],
  ["ayatan_anasa_sculpture", "Ayatan Anasa Sculpture", 0.28, 1],
].map(([id, name, chance, qty]) => item(id, name, chance, qty));
const MORAX = { node: { id: "SolNode57", name: "Morax" }, planet: { id: "europa", name: "Europa" }, faction: { id: "corpus", name: "Corpus" } };
const sortie = (over = {}) =>
  mission({
    ...MORAX,
    type: { id: "excavation", name: "Excavation" },
    rewards: { source: "sortie", tables: [{ kind: "mission", rotation: null, items: SORTIE_ITEMS }] },
    modifiers: [{ id: "sortie", name: "Sortie", stage: 1 }],
    ...over,
  });

test("the manifest: the user's size, never the widget's; the world for the Circuit's picks", () => {
  const manifest = read("../manifest.json");
  assert.equal(manifest.sizing.fit, "none");
  assert.deepEqual([manifest.sizing.preferred, manifest.sizing.min, manifest.sizing.max], [{ width: 300, height: 520 }, { width: 200, height: 40 }, { width: 640, height: 1200 }]);
  assert.deepEqual(manifest.permissions.gameEvents, ["warframe.mission", "warframe.progress", "warframe.rewards", "warframe.world"]);
});

test("passive: as many rows as the height holds, then + n more for the commonest; interactive: every row, in a scroll", () => {
  const v = value({ mission: sortie(), progress: untracked() });
  const at = (height, mode = "passive") => logic.buildScreen(input(v, { mode, height })).sections[0];
  assert.deepEqual([at(400).rows.length, at(400).more], [7, "+ 10 more, 2.50% to 28.00%"]);
  assert.deepEqual([at(560).rows.length, at(560).more], [13, "+ 4 more, 9.80% to 28.00%"]);
  assert.deepEqual([at(720).rows.length, at(720).more], [17, ""]);
  assert.deepEqual(at(720).rows.map((r) => r.name).slice(0, 2), ["Legendary Core", "Kitgun Riven Mod"], "the rarest first");
  for (const height of [400, 560, 720]) {
    const s = logic.buildScreen(input(v, { mode: "interactive", height }));
    assert.deepEqual([s.sections[0].rows.length, s.sections[0].more, s.scroll], [17, "", true], `${height} px`);
  }
  const tiny = at(200);
  assert.equal(tiny.rows.length, 1, "always one row");
  assert.equal(tiny.more, "+ 16 more, 1.00% to 28.00%");
  const likely = logic.buildScreen(input(v, { mode: "passive", height: 400, order: "likely" })).sections[0];
  assert.equal(likely.rows[0].name, "Ayatan Anasa Sculpture");
  assert.equal(likely.more, "+ 10 more, 0.19% to 3.27%");
  const compact = logic.buildScreen(input(v, { mode: "passive", height: 720, layout: "compact" })).sections[0];
  assert.equal(compact.rows.length, 2, "Compact keeps its rows");
});

test("passive: the tables share the height row by row, the shortest first; no room is left for a row more", () => {
  const s = screen({ mission: picked(), progress: null }, { mode: "passive", height: 520 });
  assert.deepEqual(s.sections.map((x) => x.rows.length), [3, 2, 2], "short tables shown whole");
  const many = (letter, n, base) => ({ kind: "mission", rotation: letter, items: Array.from({ length: n }, (_, i) => item(`${letter}${i}`, `${letter}${i}`, base + i / 1000)) });
  const three = { source: "node", tables: [many("A", 3, 0.2), many("B", 20, 0.01), many("C", 8, 0.05)] };
  const stacked = screen({ mission: picked({ rewards: three }), progress: null }, { mode: "passive", height: 400 });
  // 400 px: 202 px for the rows (3 titles, 2 gaps): A whole (87), then one row each and + n more for B and C (98).
  assert.deepEqual(stacked.sections.map((x) => [x.rows.length, x.more]), [[3, ""], [1, "+ 19 more, 1.10% to 2.90%"], [1, "+ 7 more, 5.10% to 5.70%"]]);
  const roomy = screen({ mission: picked({ rewards: three }), progress: null }, { mode: "passive", height: 560 });
  assert.deepEqual(roomy.sections.map((x) => x.rows.length), [3, 4, 4], "every row the height gives, shared");
  const p = screen({ mission: mission({ rewards: three }), progress: survival(2, START + 15 * MIN) }, { mode: "passive", height: 400, now: START + 11 * MIN });
  assert.deepEqual([p.sections[0].title, p.sections[0].rows.length, p.sections[0].fill.length, p.sections[0].more], ["Possible loot · rotation B", 6, 0, "+ 14 more, 1.60% to 2.90%"]);
});

test("Sortie: its table from the pick; a type not known before loading names no type", () => {
  const pick = sortie({ state: "selected", startedAt: null, loadingAt: null, type: null, typeAtLoading: true });
  const s = screen({ mission: pick, progress: null });
  assert.equal(s.eyebrow, "Sortie");
  assert.equal(s.eyebrowIcon, "map-pin");
  assert.deepEqual(s.sections.map((x) => x.title), ["Sortie reward"]);
  assert.equal(s.info, "Just one, after the 3rd mission");
  assert.deepEqual(s.pills.map((x) => x.text), ["Sortie 1/3"]);
  assert.equal(s.line, "Morax · reward after the 3rd mission");
  const known = screen({ mission: sortie({ state: "selected", startedAt: null }), progress: null });
  assert.equal(known.eyebrow, "Excavation · picked");
  const live = screen({ mission: sortie(), progress: untracked() });
  assert.equal(live.eyebrow, "Excavation · in progress");
});

const relicItem = (id, name, rarity, chance, over = {}) => ({ id, name, quantity: 1, rarity, chance, icon: null, iconPending: false, category: "blueprint", ...over });
const F5 = [["fulmin_prime_receiver", "Fulmin Prime Receiver", "rare"], ["paris_prime_grip", "Paris Prime Grip", "uncommon"], ["shade_prime_systems", "Shade Prime Systems", "uncommon"], ["bronco_prime_blueprint", "Bronco Prime Blueprint", "common"], ["gunsen_prime_blueprint", "Gunsen Prime Blueprint", "common"], ["orthos_prime_handle", "Orthos Prime Handle", "common"]];
const RADIANT = { rare: 0.1, uncommon: 0.2, common: 0.1667 };
const relic = (refinement, over = {}) => ({
  id: "meso_f5_relic",
  name: "Meso F5 Relic",
  era: { id: "meso", name: "Meso" },
  refinement: refinement === null ? null : { id: refinement, name: refinement === "radiant" ? "Radiant" : "Intact" },
  icon: "asset:00000000000000f5",
  iconPending: false,
  items: F5.map(([id, name, rarity]) => relicItem(id, name, rarity, refinement === null ? null : RADIANT[rarity])),
  reward: null,
  ...over,
});
const ROCHE = { node: { id: "SolNode304", name: "Roche" }, planet: { id: "phobos", name: "Phobos" }, faction: { id: "corpus", name: "Corpus" }, type: { id: "extermination", name: "Exterminate" } };
const fissure = (r, over = {}) => mission({ ...ROCHE, fissure: { id: "meso", name: "Meso" }, rewards: null, relic: r, ...over });

test("Fissure: your relic on top, its items the rarest first at its refinement's rates", () => {
  const s = screen({ mission: fissure(relic("radiant")), progress: untracked() });
  assert.equal(s.empty, null, "no 'no table' for the node");
  assert.equal(s.info, "10 Reactant to open the relic");
  const head = s.sections[0];
  assert.deepEqual([head.relic, head.title, head.name, head.badge, head.badgeCls, head.img], [true, "Your relic", "Meso F5 Relic", "Radiant", "ref-chip", "asset:00000000000000f5"]);
  assert.deepEqual(head.rows.map((r) => `${r.name} ${r.chance}`), [
    "Fulmin Prime Receiver 10.00%", "Bronco Prime Blueprint 16.67%", "Gunsen Prime Blueprint 16.67%", "Orthos Prime Handle 16.67%", "Paris Prime Grip 20.00%", "Shade Prime Systems 20.00%",
  ]);
  assert.equal(s.source, true);
  assert.equal(s.line, "Roche · Meso F5 Relic");
  assert.equal(s.lineIcon, "hexagon");
  assert.deepEqual(s.pills.map((x) => x.text), ["Meso Fissure"]);
});

test("Fissure: a refinement the game's words do not tell shows the rarity, never a made-up rate; a relic without items", () => {
  const s = screen({ mission: fissure(relic(null)), progress: null });
  const head = s.sections[0];
  assert.deepEqual([head.badge, head.badgeCls], ["Refinement unknown", "ref-chip unknown"]);
  assert.deepEqual(head.rows.map((r) => r.chance), ["rare", "uncommon", "uncommon", "common", "common", "common"]);
  const fr = inFrench(() => screen({ mission: fissure(relic(null)), progress: null }));
  assert.deepEqual(fr.sections[0].rows.map((r) => r.chance), ["rare", "peu commun", "peu commun", "commun", "commun", "commun"]);
  assert.deepEqual([fr.sections[0].title, fr.sections[0].badge, fr.info], ["Votre relique", "Raffinement inconnu", "10 réactifs pour ouvrir la relique"]);
  const bare = screen({ mission: fissure(relic("intact", { items: [], icon: null, iconPending: false })), progress: null });
  assert.deepEqual([bare.sections[0].rows.length, bare.sections[0].more, bare.sections[0].glyph, bare.empty], [0, "", "hexagon", null]);
  const surv = screen({ mission: mission({ fissure: { id: "meso", name: "Meso" }, relic: relic("radiant") }), progress: survival(1, START + 10 * MIN) }, { now: START + 6 * MIN });
  assert.deepEqual(surv.sections.map((x) => x.title), ["Your relic", "Possible loot · rotation A"], "the node's table under the relic");
  assert.equal(logic.heroSubText(surv, START + 6 * MIN), "Then B in 9:00");
  assert.equal(surv.info, "10 Reactant to open the relic");
});

test("the recap: your relic, never 'obtained'; the end bonus on its own line, the credits in the game's word", () => {
  const ended = mission({ ...ROCHE, fissure: { id: "meso", name: "Meso" }, rewards: null, state: "ended", result: "succeeded", endedAt: START, durationSeconds: 131, credits: 1900, relic: relic("radiant", { reward: relicItem("orthos_prime_handle", "Orthos Prime Handle", "common", 0.1667, { icon: "asset:00000000000000aa" }) }) });
  const s = screen({ mission: ended, progress: null });
  assert.equal(s.info, "Succeeded in 2 min 11");
  assert.deepEqual(s.recap.map((r) => [r.img, r.icon, r.label, r.text, r.cls]), [
    ["asset:00000000000000aa", "", "Your relic: ", "Orthos Prime Handle", "recap-value"],
    ["", "coins", "End bonus: ", "1,900 Credits", "recap-value num"],
  ]);
  assert.equal(s.sections.length, 0);
  assert.equal(s.line, "Roche · Orthos Prime Handle");
  assert.equal(JSON.stringify(s).includes("btained"), false);
  const last = logic.lastFrom(ended, null, START, "Credits");
  assert.equal(logic.isLast(last), true);
  assert.deepEqual(last.relic, { name: "Orthos Prime Handle", icon: "asset:00000000000000aa", glyph: "scroll-text" });
  const stored = screen({}, { last: { ...last, relic: { ...last.relic, icon: "" } } });
  assert.deepEqual(stored.recap[0].icon, "scroll-text", "without its image, our icon of its kind");
  const surv = screen({ mission: mission({ state: "ended", result: "succeeded", endedAt: START, durationSeconds: 1039, earned: earned(4), credits: 40000 }), progress: progress(4) });
  assert.deepEqual([surv.factsLead, surv.factsGot], ["17:19 · ", "A ×2 · B ×1 · C ×1"]);
  assert.deepEqual(surv.recap.map((r) => r.label + r.text), ["End bonus: 40,000 Credits"]);
  const fr = inFrench(() => screen({ mission: ended, progress: null }, {}, { glossary: GLOSSARY_FR }));
  assert.deepEqual(fr.recap.map((r) => r.label + r.text), ["Votre relique : Orthos Prime Handle", "Prime de fin : 1,900 Crédits"]);
  const lost = screen({ mission: { ...ended, result: "aborted", credits: null, relic: relic("radiant") }, progress: null });
  assert.deepEqual(lost.recap, []);
});

const ROUND = { kind: "round", rotation: null, items: [item("aggristone", "Aggristone", 0.3775, 7), item("dracroot", "Dracroot", 0.0025), item("kovnik", "Kovnik", 0.22)] };
const CIRCUIT = { node: { id: "SolNode238", name: "The Circuit" }, planet: { id: "duviri", name: "Duviri" }, faction: null, type: { id: "circuit", name: "The Circuit" } };
const world = (picked) => ({
  updatedAt: START, sortie: null, archonHunt: null, fissures: [], cycles: { cetus: null, vallis: null, cambion: null }, resets: { daily: START + 3600_000, weekly: START + 86400_000 }, voidTrader: null, nightwave: null,
  circuit: {
    normal: [{ id: "titania", name: "Titania" }, { id: "nekros", name: "Nekros" }, { id: "wukong", name: "Wukong" }],
    steelPath: [{ id: "paris_incarnon_genesis", name: "Paris Incarnon Genesis" }, { id: "lato_incarnon_genesis", name: "Lato Incarnon Genesis" }, { id: "boar_incarnon_genesis", name: "Boar Incarnon Genesis" }],
    picked,
  },
});
const circuit = (over = {}) => mission({ ...CIRCUIT, rewards: { source: "circuit", tables: [ROUND] }, ...over });

test("the Circuit: each round's table, then this week's tiers from the pick; no rotation", () => {
  const v = value({ mission: circuit(), progress: progress(3, { round: 3 }), world: world({ normal: ["titania"], steelPath: [] }) });
  const s = logic.buildScreen(input(v));
  assert.deepEqual(s.sections.map((x) => x.title), ["Each round", "This week’s tiers · Titania"]);
  assert.deepEqual(s.sections[0].rows.map((r) => r.name), ["Dracroot", "Kovnik", "Aggristone"]);
  assert.deepEqual(s.sections[1].rows.map((r) => `${r.name} ${r.chance}`), ["Neuroptics tier 2", "Chassis tier 5", "Augment tier 7", "Systems tier 8", "Blueprint tier 10"]);
  assert.deepEqual([s.sections[1].more, s.sections[1].note], ["", "Tiers 1, 3, 4, 6, 9: random"]);
  assert.deepEqual([s.track.length, s.heroValue, s.info, s.trackLabel], [0, "", "", ""]);
  assert.equal(s.eyebrowIcon, "infinity");
  assert.equal(s.line, "The Circuit · this week’s tiers");
  assert.equal(JSON.stringify(s).includes("not tracked"), false);
  const none = screen({ mission: circuit({ state: "selected", startedAt: null }), progress: null, world: world({ normal: [], steelPath: [] }) });
  assert.equal(none.sections[1].title, "This week’s tiers");
  const fr = inFrench(() => logic.buildScreen(input(v)));
  assert.deepEqual(fr.sections.map((x) => x.title), ["Chaque manche", "Paliers de la semaine · Titania"]);
  assert.deepEqual(fr.sections[1].rows.map((r) => `${r.name} ${r.chance}`), ["Neuroptiques palier 2", "Châssis palier 5", "Augment palier 7", "Systèmes palier 8", "Plan palier 10"]);
  assert.equal(fr.sections[1].note, "Paliers 1, 3, 4, 6, 9 : au hasard");
});

test("the Circuit on the Steel Path: the two Incarnon picked, or yours unnamed when this session did not show them", () => {
  const steel = circuit({ modifiers: [{ id: "steel_path", name: "Steel Path", stage: null }] });
  const s = screen({ mission: steel, progress: null, world: world({ normal: ["titania"], steelPath: ["paris_incarnon_genesis", "lato_incarnon_genesis"] }) });
  assert.equal(s.sections[1].title, "This week’s tiers · Incarnon");
  assert.deepEqual(s.sections[1].rows.map((r) => `${r.name} ${r.chance}`), ["Paris Incarnon Genesis tier 5 or 10", "Lato Incarnon Genesis tier 5 or 10"]);
  assert.equal(s.sections[1].note, "Tiers 1 to 4, 6 to 9: random");
  const unseen = screen({ mission: steel, progress: null, world: world({ normal: [], steelPath: [] }) });
  assert.deepEqual(unseen.sections[1].rows.map((r) => `${r.name} ${r.chance}`), ["Your two Incarnon tier 5 or 10"]);
  const fr = inFrench(() => screen({ mission: steel, progress: null, world: world({ normal: [], steelPath: [] }) }));
  assert.deepEqual(fr.sections[1].rows.map((r) => `${r.name} ${r.chance}`), ["Vos deux Incarnon palier 5 ou 10"]);
  assert.equal(fr.sections[1].note, "Paliers 1 à 4, 6 à 9 : au hasard");
});

const DRIFT = { node: { id: "SolNode229", name: "Cambion Drift" }, planet: { id: "deimos", name: "Deimos" }, faction: { id: "infested", name: "Infested" }, type: { id: "free_roam", name: "Free Roam" } };

test("an open world by its gate: its header, no table; once left, the last real mission of the session or the first screen", () => {
  const s = screen({ mission: mission({ ...DRIFT, rewards: null }), progress: null }, { now: START + 305_000 });
  assert.equal(s.eyebrow, "Free Roam · in progress");
  assert.equal(s.eyebrowIcon, "map");
  assert.equal(logic.clockValue(s, START + 305_000), "5:05");
  assert.deepEqual([s.empty.icon, s.empty.title, s.empty.titleCls, s.empty.iconCls], ["map", "No table in an open world", "soft", "soft"]);
  assert.equal(s.line, "Cambion Drift · no table");
  const left = { seq: 9, type: "mission_left", at: START + 400_000, mission: mission({ ...DRIFT, rewards: null }) };
  const fresh = screen({}, {}, { events: [left] });
  assert.equal(fresh.empty.title, "Pick a mission");
  const old = logic.lastFrom(mission({ state: "ended", result: "succeeded", endedAt: START - 3600_000, durationSeconds: 600, earned: earned(2), credits: 100 }), progress(2), START, "Credits");
  assert.equal(screen({}, { last: old }, { events: [left] }).empty.title, "Pick a mission", "a mission of an earlier session is not this session's");
  const recent = { ...old, endedAt: START - 60_000 };
  assert.equal(screen({}, { last: recent }, { events: [left] }).eyebrow, "Survival · last mission");
});

test("the stored recap keeps the game's word for credits, and not the relic's image of this session", async () => {
  const reward = relicItem("orthos_prime_handle", "Orthos Prime Handle", "common", 0.1667, { icon: "asset:00000000000000aa" });
  vm.push(SERVICE, value({ mission: fissure(relic("radiant", { reward }), { state: "ended", result: "succeeded", endedAt: vm.now, durationSeconds: 131, credits: 1900, startedAt: vm.now - 131_000 }), progress: null }));
  await flush();
  const saved = vm.lastCall("storage.set");
  assert.equal(saved.params.value.creditsName, "Credits");
  assert.deepEqual(saved.params.value.relic, { name: "Orthos Prime Handle", icon: "", glyph: "scroll-text" });
  assert.deepEqual(state.s.recap.map((r) => r.img), ["asset:00000000000000aa", ""], "this session still shows it");
});
