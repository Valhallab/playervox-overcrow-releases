// A restart: the stored ticks come back with what the hand set and the
// types learned at loading, the host repeats its latest events (their seq
// starts again at 1, their at does not change), and none is ticked twice.
// Also the pure helpers, in French.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { DAY, GLOSSARY, HOUR, NOW, SORTIE_END, WEEK_END, ended, replaced, sortie, value, world } from "./fixtures.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("../locales/fr.json", import.meta.url), "utf8"));
const vm = installRuntime({
  now: NOW,
  host: {
    locale: "fr",
    messages: MESSAGES,
    mode: "passive",
    grants: ["storage"],
    viewport: { width: 300, height: 600 },
    region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 60 },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const act = (id) => state.model.cols.flatMap((col) => col.groups.flatMap((group) => group.acts)).find((each) => each.id === id);
const parts = (id) => act(id).groups.flatMap((group) => group.parts);

const FIRST = NOW - 2 * HOUR;
const SECOND = NOW - HOUR;
const stored = {
  v: 2,
  lastAt: FIRST,
  dayEnd: SORTIE_END,
  weekEnd: WEEK_END,
  sortie: { parts: [{ at: FIRST }, { at: 0 }, { at: 0 }], types: [null, { node: "SolNode2", id: "excavation", name: "Excavation" }, null] },
  archon: { parts: [{ at: NOW - DAY, hand: false, handAt: NOW - DAY + HOUR }, { at: 0 }, { at: 0 }], types: [null, null, null] },
  netracells: [{ at: 0 }, { at: 0 }, { at: 0, hand: true, handAt: NOW - DAY }, { at: 0 }, { at: 0 }],
  circuit: { done: NOW - DAY, picks: { auto: ["trinity"], hand: ["ember"] } },
  steel: { done: 0, picks: { auto: ["lato", "paris"], hand: null } },
  nightwave: { artist: { at: NOW - 3 * HOUR, endsAt: SORTIE_END + 8 * HOUR } },
};

/** The world after the game restarted: stage 2's type unknown again, no pick, nothing completed. */
function restarted() {
  const each = world(NOW);
  each.sortie.missions[1] = replaced("SolNode2", "Morax");
  return each;
}

test("after a restart, what the hand set and the types learned stay; events handled are not ticked again", async () => {
  vm.calls.find((call) => call.service === "storage.get").resolve(stored);
  await flush();
  vm.push(
    "gameEvents.warframe.subscribe",
    value({
      worldValue: restarted(),
      events: [
        ended(1, FIRST, { modifiers: [sortie(1)] }),
        // The same stage again before the restart's last event: skipped.
        ended(2, FIRST - 1000, { modifiers: [sortie(3)] }),
        ended(3, SECOND, { node: "SolNode3", modifiers: [sortie(3)] }),
      ],
    }),
  );
  await flush();
  assert.equal(act("sortie").value, "2/3");
  assert.equal(parts("sortie")[1].text, "Excavation");
  assert.equal(parts("sortie")[1].textCls, "part-text");
  assert.deepEqual([act("archon").value, parts("archon")[0].hand], ["0/3", true]);
  assert.deepEqual([act("netracells").value, act("netracells").groups[0].hand], ["1/5", true]);
  assert.deepEqual([act("circuit").value, act("circuit").choicesHand], ["mer. 11:00", true]);
  assert.equal(act("circuit").choices.find((each) => each.text === "Ember").cls, "choice other", "done: every name grey");
  assert.equal(act("steel").choices.filter((each) => each.cls === "choice picked").map((each) => each.text).join(), "Lato,Paris");
  assert.equal(parts("nightwave")[0].icon, "circle-check");
  assert.equal(state.model.left, "5 à faire");
  assert.equal(state.model.hint, "");
  const set = vm.calls.filter((call) => call.service === "storage.set").at(-1);
  assert.equal(set.params.value.lastAt, SECOND);
  assert.deepEqual(set.params.value.sortie.parts, [{ at: FIRST }, { at: 0 }, { at: SECOND }]);
});

test("French wording: the resets, the stages by rank, Nightwave's kinds, the Archon's own name", async () => {
  assert.equal(state.model.cols[0].groups[0].reset, "reset dans 6\u00a0h");
  assert.equal(state.model.cols[0].groups[1].reset, "reset dans 3\u00a0j\u00a014\u00a0h");
  assert.equal(state.model.baro, "Baro Ki'Teer arrive ven. 14:00 · Larunda Relay");
  assert.deepEqual(act("nightwave").groups.map((group) => group.title), ["Du jour", "Semaine", "Élite"]);
  assert.equal(parts("netracells")[2].label, "Cellule 3\u00a0: fait, réglé à la main");
  const french = world(NOW);
  french.archonHunt.boss = { id: "archon_boreal", name: "Archonte Boréal" };
  vm.push("gameEvents.warframe.subscribe", value({ worldValue: french }));
  await flush();
  assert.equal(act("archon").shardText, "Boréal");
  const nameless = world(NOW);
  nameless.archonHunt.shard = null;
  vm.push("gameEvents.warframe.subscribe", value({ worldValue: nameless }));
  await flush();
  assert.deepEqual([act("archon").shard, act("archon").shardText], ["", ""]);
  const pending = world(NOW);
  pending.archonHunt.shard = { ...pending.archonHunt.shard, icon: null, iconPending: true };
  vm.push("gameEvents.warframe.subscribe", value({ worldValue: pending }));
  await flush();
  assert.deepEqual([act("archon").shard, act("archon").shardGlyph], ["", ""], "its image may still come");
  pending.archonHunt.shard = { ...pending.archonHunt.shard, iconPending: false };
  vm.push("gameEvents.warframe.subscribe", value({ worldValue: pending }));
  await flush();
  assert.deepEqual([act("archon").shard, act("archon").shardGlyph], ["", "gem"], "none will come: our icon");
  const stages = logic.buildModel({
    ticks: logic.emptyTicks(),
    world: null,
    worldStatus: "unavailable",
    source: "available",
    tracked: { sortie: true, archon: true, netracells: true, circuit: true, steel: true, nightwave: true },
    baro: true,
    now: NOW,
    interactive: false,
    width: 300,
  });
  assert.deepEqual(
    stages.cols[0].groups[0].acts[0].groups[0].parts.map((each) => each.text),
    ["1ʳᵉ mission", "2ᵉ mission", "3ᵉ mission"],
  );
  assert.equal(logic.inTime(42 * 60_000), "42\u00a0min");
  assert.equal(logic.inTime(48 * HOUR), "2\u00a0j");
});

test("a game in English, the app in French: the game's names, the widget's French", async () => {
  vm.push("gameEvents.warframe.subscribe", value());
  await flush();
  assert.deepEqual(
    state.model.cols.flatMap((col) => col.groups.flatMap((group) => group.acts.map((each) => each.name))),
    ["Sortie", "Archon Hunt", "Netracells", "The Circuit", "The Circuit · Steel Path", "Nightwave"],
  );
  const french = {
    ...GLOSSARY,
    language: "fr",
    activity: { ...GLOSSARY.activity, archon_hunt: "Chasse aux Archontes", nightwave: "Ondes Nocturnes", circuit: "Le Circuit", steel_path: "La Route de l'Acier" },
  };
  vm.push("gameEvents.warframe.subscribe", value({ glossary: french }));
  await flush();
  assert.equal(act("archon").name, "Chasse aux Archontes");
  assert.equal(act("steel").name, "Le Circuit · Route de l'Acier");
  assert.equal(act("nightwave").name, "Ondes Nocturnes");
});

test("names: no name of the game in the locales", () => {
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));
    for (const [key, text] of Object.entries(messages)) {
      assert.doesNotMatch(key, /^(activity|fresh)-/, key);
      assert.doesNotMatch(text, /Sortie|Archon|Netracell|Circuit|Nightwave|Baro/, `${locale} ${key}`);
    }
  }
});

test("the resets without the world", () => {
  assert.equal(logic.nextSortieReset(NOW), SORTIE_END);
  assert.equal(logic.nextSortieReset(SORTIE_END), SORTIE_END + DAY);
  assert.equal(logic.nextWeeklyReset(NOW), WEEK_END);
  assert.equal(logic.nextWeeklyReset(WEEK_END), WEEK_END + 7 * DAY);
  assert.equal(logic.nextWeeklyReset(WEEK_END - 1), WEEK_END);
  assert.equal(logic.dayEndOf(world(NOW, { sortie: { ...world().sortie, endsAt: SORTIE_END - DAY } }), NOW), SORTIE_END);
});

test("stored values that are not ticks of this version start empty", () => {
  const v1 = { v: 1, lastAt: 5, intro: true, activities: { sortie: { parts: [1, 2, 3], done: null } } };
  for (const junk of [null, 3, "x", [], { v: 3 }, v1, { v: 2, lastAt: -5, sortie: { parts: ["a", { at: "x", hand: "yes" }] }, nightwave: { x: { at: 1 } } }]) {
    const ticks = logic.readTicks(junk);
    assert.equal(ticks.lastAt, 0);
    assert.deepEqual(ticks.sortie.parts, [{ at: 0 }, { at: 0 }, { at: 0 }]);
    assert.equal(ticks.netracells.length, 5);
    assert.deepEqual(ticks.nightwave, {}, "a challenge without its end is not kept");
  }
  assert.deepEqual(logic.readTicks(stored), stored);
});
