// A restart: the stored ticks come back, the host repeats its latest
// events (their seq starts again at 1, their at does not change), and none
// is ticked twice. Also the pure helpers, in French.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { DAY, GLOSSARY, HOUR, NOW, SORTIE_END, WEEK_END, ended, sortie, value, world } from "./fixtures.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("../locales/fr.json", import.meta.url), "utf8"));
const vm = installRuntime({
  now: NOW,
  host: { locale: "fr", messages: MESSAGES, grants: ["storage"], region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 60 } },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const row = (id) => state.model.groups.flatMap((group) => group.rows).find((each) => each.id === id);

const FIRST = NOW - 2 * HOUR;
const SECOND = NOW - HOUR;
const stored = {
  v: 1,
  lastAt: FIRST,
  intro: true,
  dayEnd: SORTIE_END,
  weekEnd: WEEK_END,
  activities: {
    sortie: { parts: [FIRST, 0, 0], done: null },
    archon: { parts: [0, 0, 0], done: null },
    netracells: { parts: [0, 0, 0, 0, 0], done: null },
    circuit: { parts: [], done: { at: NOW - DAY, hand: true } },
    nightwave: { parts: [], done: null },
  },
};

test("after a restart, the events already handled are not ticked again", async () => {
  vm.calls.find((call) => call.service === "storage.get").resolve(stored);
  await flush();
  vm.push(
    "gameEvents.warframe.subscribe",
    value({
      events: [
        ended(1, FIRST, { modifiers: [sortie(1)] }),
        // The same stage again before the restart's last event: skipped.
        ended(2, FIRST - 1000, { modifiers: [sortie(2)] }),
        ended(3, SECOND, { node: "SolNode2", modifiers: [sortie(2)] }),
      ],
    }),
  );
  await flush();
  assert.equal(row("sortie").value, "2/3");
  assert.equal(row("sortie").sub, "Reste : Mobile Defense");
  assert.deepEqual([row("circuit").byHand, row("circuit").value], [true, "mer. 11:00"]);
  assert.equal(state.model.left, "4 à faire");
  assert.equal(state.model.hint, "");
  const set = vm.calls.filter((call) => call.service === "storage.set").at(-1);
  assert.equal(set.params.value.lastAt, SECOND);
  assert.deepEqual(set.params.value.activities.sortie.parts, [FIRST, SECOND, 0]);
});

test("French wording of the resets, the Archon without a name and Baro", async () => {
  assert.equal(state.model.groups[0].reset, "reset dans 6 h");
  assert.equal(state.model.groups[1].reset, "reset dans 3 j 14 h");
  assert.equal(state.model.baro, "Baro Ki'Teer arrive ven. 14:00 · Larunda Relay");
  const nameless = world(NOW);
  nameless.archonHunt.boss = { id: "boreal", name: null };
  vm.push("gameEvents.warframe.subscribe", value({ worldValue: nameless }));
  await flush();
  assert.equal(row("archon").sub, "Rescue, Survival, Assassination");
  assert.equal(logic.inTime(42 * 60_000), "42 min");
  assert.equal(logic.inTime(48 * HOUR), "2 j");
});

test("a game in English, the app in French: the game's names, the widget's French", async () => {
  vm.push("gameEvents.warframe.subscribe", value());
  await flush();
  assert.deepEqual(state.model.groups.flatMap((group) => group.rows.map((each) => each.name)), [
    "Sortie",
    "Archon Hunt",
    "Netracells",
    "The Circuit (normal)",
    "Nightwave",
  ]);
  const french = {
    ...GLOSSARY,
    language: "fr",
    activity: { ...GLOSSARY.activity, archon_hunt: "Chasse aux Archontes", nightwave: "Onde nocturne" },
  };
  vm.push("gameEvents.warframe.subscribe", value({ glossary: french }));
  await flush();
  assert.equal(row("archon").name, "Chasse aux Archontes");
  assert.equal(row("nightwave").name, "Onde nocturne");
});

test("names: no name of the game in the locales", () => {
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));
    for (const [key, text] of Object.entries(messages)) {
      assert.doesNotMatch(key, /^(activity|fresh)-/, key);
      assert.doesNotMatch(text, /Sortie|Archon|Netracells|Circuit|Nightwave|Baro/, `${locale} ${key}`);
    }
  }
});

test("the resets without the world", () => {
  // Thursday 10:00 UTC: 16:00 the same day, then Monday.
  assert.equal(logic.nextSortieReset(NOW), SORTIE_END);
  assert.equal(logic.nextSortieReset(SORTIE_END), SORTIE_END + DAY);
  assert.equal(logic.nextWeeklyReset(NOW), WEEK_END);
  assert.equal(logic.nextWeeklyReset(WEEK_END), WEEK_END + 7 * DAY);
  assert.equal(logic.nextWeeklyReset(WEEK_END - 1), WEEK_END);
  // A world from yesterday does not hold the day back.
  assert.equal(logic.dayEndOf(world(NOW, { sortie: { ...world().sortie, endsAt: SORTIE_END - DAY } }), NOW), SORTIE_END);
});

test("stored values that are not ticks start empty", () => {
  for (const junk of [null, 3, "x", [], { v: 2 }, { v: 1, lastAt: -5, activities: { sortie: { parts: ["a", 1e3], done: { at: "x" } } } }]) {
    const ticks = logic.readTicks(junk);
    assert.equal(ticks.lastAt, 0);
    assert.equal(ticks.activities.sortie.done, null);
    assert.equal(ticks.activities.sortie.parts.length, 3);
    assert.equal(ticks.activities.netracells.parts.length, 5);
  }
  assert.deepEqual(logic.readTicks(stored), stored);
});
