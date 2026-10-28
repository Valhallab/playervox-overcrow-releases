// Unit tests of the mission briefing's logic on @overcrow/sdk/testing:
// the embedded weaknesses, the advice of each mission, the modifier lines
// and the state the view shows for each value of the subscription.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const MESSAGES = read("../locales/en.json");
const START = Date.UTC(2026, 9, 28, 15);
const SERVICE = "gameEvents.warframe.subscribe";

const vm = installRuntime({ now: START, host: { messages: MESSAGES, grants: ["gameEvents"] } });
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const named = (id, name) => ({ id, name });
const features = (mission = "available", world = "available") => ({
  location: "undeclared",
  mission,
  progress: "undeclared",
  squad: "undeclared",
  eidolons: "undeclared",
  world,
  rewards: "undeclared",
});

function mission(changes = {}) {
  return {
    state: "selected",
    node: named("SolNode195", "Hydron"),
    planet: named("sedna", "Sedna"),
    type: named("defense", "Defense"),
    faction: named("grineer", "Grineer"),
    enemyLevel: { min: 30, max: 40 },
    fissure: null,
    modifiers: [],
    selectedAt: START,
    loadingAt: null,
    startedAt: null,
    endedAt: null,
    result: null,
    durationSeconds: null,
    rewards: null,
    ...changes,
  };
}

// The game's terms as the fake host sends them, in English.
const GLOSSARY = {
  language: "en",
  damage: {
    impact: "Impact",
    puncture: "Puncture",
    slash: "Slash",
    heat: "Heat",
    cold: "Cold",
    electricity: "Electricity",
    toxin: "Toxin",
    blast: "Blast",
    corrosive: "Corrosive",
    gas: "Gas",
    magnetic: "Magnetic",
    radiation: "Radiation",
    viral: "Viral",
  },
  era: { lith: "Lith", meso: "Meso", neo: "Neo", axi: "Axi", requiem: "Requiem", omnia: "Omnia" },
  fissure: {
    lith: "Lith Fissure",
    meso: "Meso Fissure",
    neo: "Neo Fissure",
    axi: "Axi Fissure",
    requiem: "Requiem Fissure",
    omnia: "Omnia Fissure",
  },
  activity: { void_fissure: "Void Fissure" },
  faction: {
    grineer: "Grineer",
    corpus: "Corpus",
    infested: "Infested",
    corrupted: "Corrupted",
    sentient: "Sentient",
    narmer: "Narmer",
    murmur: "The Murmur",
    scaldra: "Scaldra",
    techrot: "Techrot",
    tenno: "Tenno",
  },
  term: { reactant: "Reactant", relic: "Relic", credits: "Credits" },
};

function value({
  playing = true,
  session = { startedAt: START - 60_000, language: "en" },
  mission: m = null,
  world = null,
  feats = features(),
  glossary = GLOSSARY,
} = {}) {
  return {
    playing,
    session,
    glossary,
    features: feats,
    info: { location: null, mission: m, progress: null, squad: null, eidolons: null, world },
    events: [],
  };
}

const ids = (list) => list.map((each) => each.id);

// The functions called alone read the glossary of the latest value built.
logic.build(value(), null);

// The weaknesses of the official wiki's overview table (Damage 3.0),
// written out again so that a slip in the widget's table shows here.
test("weaknesses: each faction's types, as the wiki gives them", () => {
  const table = Object.fromEntries(
    Object.entries(logic.WEAKNESSES).map(([faction, { use, avoid }]) => [faction, `${use.join("+")} / ${avoid.join("+")}`]),
  );
  assert.deepEqual(table, {
    grineer: "impact+corrosive / ",
    corpus: "puncture+magnetic / ",
    infested: "slash+heat / ",
    corrupted: "puncture+viral / radiation",
    sentient: "cold+radiation / corrosive",
    narmer: "slash+toxin / magnetic",
    murmur: "electricity+radiation / viral",
    scaldra: "impact+corrosive / gas",
    techrot: "magnetic+gas / cold",
  });
});

test("weaknesses: every type and faction is the glossary's, none is both used and avoided", () => {
  for (const [faction, { use, avoid }] of Object.entries(logic.WEAKNESSES)) {
    for (const id of [...use, ...avoid]) assert.ok(Object.hasOwn(GLOSSARY.damage, id), `${faction}: ${id}`);
    assert.deepEqual(use.filter((id) => avoid.includes(id)), [], faction);
    assert.ok(Object.hasOwn(GLOSSARY.faction, faction), faction);
  }
  assert.deepEqual(Object.keys(MESSAGES).sort(), Object.keys(read("../locales/fr.json")).sort());
});

test("names: every name of the game comes from the glossary, none from the locales", () => {
  const fr = read("../locales/fr.json");
  for (const key of Object.keys(MESSAGES)) assert.doesNotMatch(key, /^(damage|faction|fissure|eidolon|activity)-/, key);
  for (const text of [...Object.values(MESSAGES), ...Object.values(fr)]) {
    assert.doesNotMatch(text, /Grineer|Corpus|Corrupted|Corrompus|Reactant|Réactif|Impact|Fissure/, text);
  }
  // A game in French: its terms, whatever the app's language.
  const french = {
    ...GLOSSARY,
    language: "fr",
    damage: { ...GLOSSARY.damage, impact: "Impact", corrosive: "Corrosif" },
    fissure: { ...GLOSSARY.fissure, neo: "Fissure Neo" },
    faction: { ...GLOSSARY.faction, grineer: "Grineer", corrupted: "Corrompus" },
    term: { ...GLOSSARY.term, reactant: "Réactif" },
  };
  const brief = logic.build(value({ glossary: french, mission: mission({ faction: named("grineer", null), fissure: named("neo", "Neo") }) }), null);
  assert.deepEqual(logic.names(brief.use), "Impact, Corrosif");
  assert.deepEqual([brief.faction, brief.mods[0].title, brief.mods[0].text], ["Grineer", "Fissure Neo", "Collect 10 Réactif from Corrompus enemies"]);
  logic.build(value(), null);
});

test("advice: none for a faction without weaknesses or unknown", () => {
  assert.equal(logic.adviceFor("tenno", mission()), null);
  assert.equal(logic.adviceFor("anything_new", mission()), null);
});

test("advice: the Cambion Drift's Infested get none, Deimos' star chart keeps the Infested's", () => {
  const drift = { planet: named("deimos", "Deimos"), type: named("free_roam", "Free Roam") };
  assert.equal(logic.adviceFor("infested", drift), null);
  assert.equal(logic.adviceFor("infested", { planet: named("deimos", "Deimos"), type: null }), null);
  assert.deepEqual(logic.adviceFor("infested", { planet: named("deimos", "Deimos"), type: named("defense", "Defense") }).use, ["slash", "heat"]);
  // The Murmur of Deimos keep theirs.
  assert.deepEqual(logic.adviceFor("murmur", drift).use, ["electricity", "radiation"]);
});

test("advice: on Jupiter, Magnetic only for the Corpus (the Amalgams resist nothing else of theirs)", () => {
  assert.deepEqual(logic.adviceFor("corpus", { planet: named("jupiter", "Jupiter"), type: null }), { use: ["magnetic"], avoid: [] });
  assert.deepEqual(logic.adviceFor("corpus", { planet: named("lua", "Lua"), type: null }).use, ["puncture", "magnetic"]);
});

test("level: a range, a single level, or nothing", () => {
  assert.equal(logic.levelText({ min: 30, max: 40 }), "Lv. 30–40");
  assert.equal(logic.levelText({ min: 40, max: 40 }), "Lv. 40");
  assert.equal(logic.levelText(null), "");
});

test("modifiers: the Steel Path first, then the Fissure, then the others in the game's order", () => {
  const lines = logic.modifiers(
    mission({
      fissure: named("neo", "Neo"),
      modifiers: [
        { id: "arbitration", name: "Arbitration", stage: null },
        { id: "steel_path", name: "Steel Path", stage: null },
      ],
    }),
    null,
  );
  assert.deepEqual(
    lines.map(({ id, title, text }) => [id, title, text]),
    [
      ["steel_path", "Steel Path", ""],
      ["fissure", "Neo Fissure", "Collect 10 Reactant from Corrupted enemies"],
      ["arbitration", "Arbitration", "Drones first · no self-revive"],
    ],
  );
});

test("modifiers: no Reactant hint in a Void Storm; a Fissure of an era the glossary lacks stays generic", () => {
  const lines = logic.modifiers(
    mission({ fissure: named("someday", null), modifiers: [{ id: "void_storm", name: "Void Storm", stage: null }] }),
    null,
  );
  assert.deepEqual(lines[0], { id: "fissure", icon: "hexagon", title: "Void Fissure", text: "" });
  assert.deepEqual(lines[1], { id: "void_storm", icon: "tornado", title: "Void Storm", text: "" });
});

const SORTIE_WORLD = {
  updatedAt: START,
  sortie: {
    boss: named("sargas_ruk", "General Sargas Ruk"),
    faction: named("grineer", "Grineer"),
    endsAt: START + 3_600_000,
    missions: [
      { node: named("SolNode32", "Tethys"), planet: null, type: null, modifier: named("augmented_armor", "Augmented Enemy Armor") },
      { node: named("SolNode42", "Helene"), planet: null, type: null, modifier: named("sniper_only", "Sniper Only") },
      { node: named("SolNode110", "Hyperion"), planet: null, type: null, modifier: named("eximus_stronghold", null) },
    ],
  },
  archonHunt: null,
  fissures: [],
  cycles: { cetus: null, vallis: null, cambion: null },
  resets: { daily: START, weekly: START },
  voidTrader: null,
  circuit: null,
};

test("sortie: the condition of its stage, matched on the node", () => {
  const helene = mission({ node: named("SolNode42", "Helene") });
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: 2 }, helene, SORTIE_WORLD), "Sniper Only");
  // A stage that does not match the node: found by the node.
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: 1 }, helene, SORTIE_WORLD), "Sniper Only");
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: null }, helene, SORTIE_WORLD), "Sniper Only");
  // A condition without a name yet, another node, or no world: nothing.
  const hyperion = mission({ node: named("SolNode110", "Hyperion") });
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: 3 }, hyperion, SORTIE_WORLD), "");
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: 2 }, mission(), SORTIE_WORLD), "");
  assert.equal(logic.sortieCondition({ id: "sortie", name: "Sortie", stage: 2 }, helene, null), "");
});

test("sortie: the title carries the stage when it is known", () => {
  const [line] = logic.modifiers(mission({ modifiers: [{ id: "sortie", name: "Sortie", stage: 2 }] }), null);
  assert.equal(line.title, "Sortie 2/3");
  const [plain] = logic.modifiers(mission({ modifiers: [{ id: "sortie", name: "Sortie", stage: null }] }), null);
  assert.equal(plain.title, "Sortie");
});

test("state: waits for a mission, briefs it in full when chosen, loading and in mission, keeps it after", () => {
  assert.equal(state.brief.mode, "wait");
  vm.push(SERVICE, value());
  assert.deepEqual([state.brief.mode, state.brief.waitText], ["wait", "Pick a mission to see the briefing."]);

  vm.push(SERVICE, value({ mission: mission() }));
  assert.equal(state.brief.mode, "full");
  assert.equal(state.brief.where, "Hydron · Sedna · Defense");
  assert.equal(state.brief.faction, "Grineer");
  assert.equal(state.brief.dot, "dot f-grineer");
  assert.deepEqual(ids(state.brief.use), ["impact", "corrosive"]);
  assert.deepEqual(state.brief.avoid, []);
  assert.equal(state.root, "wf briefing full theme-dark");

  vm.push(SERVICE, value({ mission: mission({ state: "loading", loadingAt: START }) }));
  assert.equal(state.brief.mode, "full");
  assert.equal(state.brief.eyebrow, "");
  // In mission the briefing stays whole: only the Layout option folds it.
  vm.push(SERVICE, value({ mission: mission({ state: "in_progress", loadingAt: START, startedAt: START }) }));
  assert.equal(state.brief.mode, "full");
  assert.equal(state.brief.eyebrow, "");
  assert.equal(logic.names(state.brief.use), "Impact, Corrosive");
  assert.equal(state.root, "wf briefing full theme-dark");
  // After it, the last briefing stays until the next node is chosen, marked as past.
  vm.push(SERVICE, value({ mission: mission({ state: "ended", result: "succeeded", startedAt: START, endedAt: START }) }));
  assert.deepEqual([state.brief.mode, state.brief.eyebrow, state.brief.faction], ["full", "Last mission", "Grineer"]);
  assert.deepEqual(ids(state.brief.use), ["impact", "corrosive"]);
  vm.push(SERVICE, value({ mission: mission({ node: named("SolNode26", "Lith"), planet: named("earth", "Earth") }) }));
  assert.deepEqual([state.brief.mode, state.brief.eyebrow, state.brief.where], ["full", "", "Lith · Earth · Defense"]);
});

test("state: One line folds the briefing in mission too, and waits after it", () => {
  vm.setHost({ options: { layout: "line" } });
  vm.push(SERVICE, value({ mission: mission({ state: "in_progress", loadingAt: START, startedAt: START }) }));
  assert.equal(state.brief.mode, "strip");
  vm.push(SERVICE, value({ mission: mission({ state: "ended", result: "aborted", startedAt: START, endedAt: START }) }));
  assert.deepEqual([state.brief.mode, state.brief.waitText], ["wait", "Pick a mission"]);
  vm.setHost({ options: { layout: "full" } });
  assert.deepEqual([state.brief.mode, state.brief.eyebrow], ["full", "Last mission"]);
});

test("state: Warframe closed, the mission data unavailable", () => {
  vm.push(SERVICE, value({ playing: false, mission: mission() }));
  assert.deepEqual([state.brief.waitText, state.brief.waitIcon], ["Run Warframe to see the briefing.", "power"]);
  vm.push(SERVICE, value({ mission: mission(), feats: features("unavailable") }));
  assert.deepEqual([state.brief.waitText, state.brief.waitTone], ["Mission not found yet.", "warning"]);
});

test("state: a mission of an earlier launch is not briefed", () => {
  vm.push(SERVICE, value({ session: { startedAt: START }, mission: mission({ selectedAt: START - 7_200_000 }) }));
  assert.equal(state.brief.mode, "wait");
  vm.push(SERVICE, value({ session: { startedAt: START }, mission: mission({ selectedAt: START }) }));
  assert.equal(state.brief.mode, "full");
});

test("state: an unknown faction or none says there is no advice; names fall back to the glossary's, then to the ID's absence", () => {
  vm.push(SERVICE, value({ mission: mission({ faction: null, node: named("SolNode999", null), planet: null }) }));
  assert.deepEqual(
    [state.brief.where, state.brief.faction, state.brief.dot, state.brief.note],
    ["Defense", "Unknown enemies", "dot f-unknown", "No advice yet for these enemies."],
  );
  assert.equal(state.root, "wf briefing full unknown theme-dark");
  vm.push(SERVICE, value({ mission: mission({ faction: named("techrot", null) }) }));
  assert.deepEqual([state.brief.faction, state.brief.dot, state.brief.note], ["Techrot", "dot f-techrot", ""]);
  assert.deepEqual(ids(state.brief.avoid), ["cold"]);
  vm.push(SERVICE, value({ mission: mission({ faction: named("tenno", "Tenno"), enemyLevel: null }) }));
  assert.deepEqual([state.brief.faction, state.brief.dot, state.brief.level], ["Tenno", "dot f-unknown", ""]);
  assert.deepEqual(state.brief.use, []);
});

test("state: One line folds the chosen mission; wide only at 500 px with modifiers", () => {
  vm.setHost({ options: { layout: "line" } });
  vm.push(SERVICE, value({ mission: mission() }));
  assert.equal(state.brief.mode, "strip");
  vm.setHost({ options: { layout: "full" } });
  assert.equal(state.brief.mode, "full");
  vm.setHost({ viewport: { width: 540, height: 240 } });
  assert.equal(state.root, "wf briefing full theme-dark");
  vm.push(SERVICE, value({ mission: mission({ modifiers: [{ id: "steel_path", name: "Steel Path", stage: null }] }) }));
  assert.equal(state.root, "wf briefing full wide theme-dark");
  vm.setHost({ viewport: { width: 300, height: 240 } });
  assert.equal(state.root, "wf briefing full theme-dark");
});

test("state: a failure says the mission is not found and subscribes again 30 s later; a refusal waits", () => {
  const before = vm.subscriptions.filter((each) => each.service === SERVICE).length;
  vm.fail(SERVICE, "unavailable");
  assert.deepEqual([state.brief.waitText, state.brief.waitTone], ["Mission not found yet.", "warning"]);
  vm.advance(30_000);
  assert.equal(vm.subscriptions.filter((each) => each.service === SERVICE).length, before + 1);
  vm.push(SERVICE, value({ mission: mission() }));
  assert.equal(state.brief.mode, "full");

  vm.fail(SERVICE, "permission_denied");
  // A refusal is the user's choice, not a failure: a lock, not the alert of "not found".
  assert.deepEqual([state.brief.waitText, state.brief.waitIcon], ["Allow “Warframe: missions” in the Control Center.", "lock"]);
  assert.equal(state.brief.waitLabel, "Allow “Warframe: missions” in the Control Center.");
  // In One line, the family's short form, never cut: the value still shown
  // (the faction of the briefed mission), or where to go without one. The
  // whole sentence stays the accessible label.
  vm.setHost({ options: { layout: "line" } });
  assert.deepEqual(
    [state.brief.waitText, state.brief.waitIcon, state.brief.waitLabel],
    ["Grineer · Access denied", "lock", "Allow “Warframe: missions” in the Control Center."],
  );
  const none = logic.build(null, "permission_denied");
  assert.deepEqual([none.waitText, none.waitLabel], ["Access denied · Control Center", "Allow “Warframe: missions” in the Control Center."]);
  const ended = logic.build(value({ mission: mission({ state: "ended" }) }), "permission_denied");
  assert.equal(ended.waitText, "Access denied · Control Center");
  vm.setHost({ options: { layout: "full" } });
  vm.advance(60_000);
  assert.equal(vm.subscriptions.filter((each) => each.service === SERVICE).length, before + 1);
});

test("where: node, planet and type; a node named after its mission does not repeat the type", () => {
  const where = (node, planet, type) => logic.whereText({ node: named("SolNode0", node), planet: planet && named("p", planet), type: type && named("t", type) });
  assert.equal(where("Hydron", "Sedna", "Defense"), "Hydron · Sedna · Defense");
  // Höllvania's nodes, as Digital Extremes names them (Public Export, EN and FR).
  assert.equal(where("Exterminate: Techrot", "Höllvania", "Extermination"), "Exterminate: Techrot · Höllvania");
  assert.equal(where("Extermination: Techrot", "Höllvanie", "Extermination"), "Extermination: Techrot · Höllvanie");
  assert.equal(where("Assassinat: Char H-09", "Höllvanie", "Assassinat"), "Assassinat: Char H-09 · Höllvanie");
  assert.equal(where("Legacyte Harvest", "Höllvania", "Legacyte Harvest"), "Legacyte Harvest · Höllvania");
  assert.equal(where("Hell-Scrub: Techrot", "Höllvania", "Survival"), "Hell-Scrub: Techrot · Höllvania · Survival");
  assert.equal(where("Place du Solstice", "Höllvanie", "Défense"), "Place du Solstice · Höllvanie · Défense");
  // Short words must match whole: "Mot" is no "Motel".
  assert.equal(where("Mot", "Void", "Mobile Defense"), "Mot · Void · Mobile Defense");
  assert.equal(where(null, null, "Defense"), "Defense");
  assert.equal(where(null, "Deimos", "Netracell"), "Deimos · Netracell");
});

test("state: One line keeps its waiting lines short, the whole sentence as their label", () => {
  vm.setHost({ options: { layout: "line" } });
  const pick = logic.build(value(), null);
  assert.deepEqual([pick.waitText, pick.waitLabel], ["Pick a mission", "Pick a mission to see the briefing."]);
  const closed = logic.build(value({ playing: false }), null);
  assert.deepEqual([closed.waitText, closed.waitLabel], ["Run Warframe", "Run Warframe to see the briefing."]);
  const missing = logic.build(value({ feats: features("unavailable") }), null);
  assert.deepEqual([missing.waitText, missing.waitLabel], ["Mission not found yet.", "Mission not found yet."]);
  vm.setHost({ options: { layout: "full" } });
  assert.equal(logic.build(value(), null).waitText, "Pick a mission to see the briefing.");
});
