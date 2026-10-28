// A hunt goes on after Warframe restarts, and after the widget restarts:
// the Eidolons of the night, the best and the past hunts come from storage.
// The night at Cetus is computed from the last known cycle, even offline.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { MINUTE, NIGHT_END, SECOND, START, advance, eidolon, fakeStorage, messages, send, settle, texts, value } from "./fake.mjs";

const T = START;
const DAY = 24 * 60 * MINUTE;
// The widget starts with what an earlier run of it stored: a Teralyst of
// this night already captured, a best and three past days, and junk.
const store = fakeStorage({
  night: { legs: [{ s: T, e: "teralyst", c: T + 108_220, k: null, f: null }, { s: "bad" }], dayAt: 0 },
  best: { s: T - DAY, total: 452_400, splits: [110_000, 140_000, 202_400], prev: null },
  history: [
    { s: T - 2 * DAY, end: T - 2 * DAY + 470_050, caps: 3, total: 470_050 },
    { s: T - DAY, end: T - DAY + 452_400, caps: 3, total: 452_400 },
    { s: T - DAY + 9 * MINUTE, end: T - DAY + 16 * MINUTE, caps: 2, total: null },
    "junk",
  ],
  cetus: NIGHT_END,
});
const vm = installRuntime({
  now: T + 3 * MINUTE,
  host: { messages: messages("fr"), locale: "fr", grants: ["storage", "gameEvents"], viewport: { width: 480, height: 260 } },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, store);

test("before Warframe tells anything, the stored night and best show", () => {
  // Not playing yet: the calm screen, with today's summary.
  assert.equal(state.view.label, "Nuit restante");
  assert.equal(state.view.big, "27:00");
  assert.equal(state.view.hint, "Record 07:32.40 (hier)");
  assert.equal(state.view.layout, "wide");
  assert.deepEqual(
    state.view.days.map((day) => [day.when, day.caps, day.best]),
    [["Hier", "1 tricap", "07:32.40"], ["Lun. 26 oct.", "1 tricap", "07:50.05"]],
  );
  // The best was set yesterday: not green today.
  assert.equal(state.view.days[0].bestCls, "past-best");
});

test("Warframe restarted: the hunt of the stored Teralyst goes on", async () => {
  // A new session tells only what it saw: a Gantulyst it cannot name.
  await send(vm, store, value({ session: T + 2 * MINUTE, hunts: [eidolon(null, T + 150_000, { captured: T + 240_270 })] }));
  assert.equal(state.view.label, "Chasse en cours");
  assert.equal(state.view.big, "03:00");
  assert.deepEqual(texts(state.view).rows, ["Teralyst −1.78 01:48.22", "Gantulyst −7.95 02:12.05", "Hydrolyst en cours"]);
  assert.equal(state.view.hint, "9.73 s d’avance après Gantulyst");
  assert.equal(store.get("night").legs.length, 2, "the junk leg is dropped");
});

test("the next night, away from Cetus' cycle, is computed from the stored anchor", async () => {
  // Warframe closes; three cycles later, the world is not read any more.
  await send(vm, store, value({ playing: false, hunts: [] }));
  vm.advance(NIGHT_END + 3 * 150 * MINUTE - 10 * MINUTE - vm.now);
  await settle(vm, store);
  assert.equal(state.view.label, "Nuit restante");
  assert.equal(state.view.big, "10:00");
  assert.equal(state.view.cycleIcon, "moon");
  vm.advance(15 * MINUTE);
  await settle(vm, store);
  assert.equal(state.view.label, "Nuit dans");
  assert.equal(state.view.big, "1:35:00");
  assert.equal(state.view.cycleIcon, "sun");
});

test("the run left open at dawn is filed as missed", () => {
  assert.equal(store.get("history").length, 4);
  assert.deepEqual(store.get("history").at(-1), { s: T, end: NIGHT_END, caps: 2, total: null });
});

test("Warframe's times unreadable: the night stays, with what to do", async () => {
  await send(vm, store, value({ eidolons: "unavailable" }));
  assert.equal(state.view.hint, "Impossible de lire vos temps : relancez Warframe.");
  assert.equal(state.view.hintCls, "hint tone-warning");
  assert.equal(state.view.big, "1:35:00");
  vm.setHost({ options: { layout: "line" } });
  assert.equal(texts(state.view).line, "Nuit dans 1:35:00 temps illisibles");
  assert.equal(state.view.lineSubCls, "line-sub tone-warning");
  vm.setHost({ options: { layout: "full" } });
});

test("away from the Plains, the night and where you are", async () => {
  await send(vm, store, value({ at: "cetus", cetus: undefined }));
  assert.equal(state.view.hint, "Hors des Plaines");
  assert.equal(state.view.big, "1:35:00");
});

test("the history keeps the last 30 hunts and the best", () => {
  const runs = Array.from({ length: 40 }, (_, index) => ({
    start: T + index * DAY,
    legs: [null, null, null],
    outcome: "fled",
    end: T + index * DAY + 60 * SECOND,
  }));
  const filed = logic.file(runs, store.get("history"), store.get("best"));
  assert.equal(filed.history.length, 30);
  assert.equal(filed.history.at(-1).s, T + 39 * DAY);
  assert.equal(filed.best.total, 452_400);
});

test("stored values of another shape are ignored", () => {
  assert.equal(logic.readBest({ s: 1, total: 2, splits: [1, 2], prev: null }), null);
  assert.deepEqual(logic.readHistory({}), []);
  assert.deepEqual(logic.readLegs(null), { legs: [], dayAt: 0 });
});
