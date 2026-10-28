// A night on the Plains: a perfect tricap that sets the first best, a second
// one compared with it position by position, a Gantulyst killed, then the
// Hydrolyst gone at dawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { MINUTE, NIGHT_END, SECOND, START, advance, eidolon, fakeStorage, messages, send, settle, texts, value } from "./fake.mjs";

const vm = installRuntime({ now: START, host: { messages: messages("en"), grants: ["storage", "gameEvents"] } });
const store = fakeStorage();
await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, store);

const T = START; // the first Teralyst appears at 20:00:00.000
const first = [
  eidolon("teralyst", T, { captured: T + 108_220 }),
  eidolon("gantulyst", T + 150_000, { captured: T + 240_270 }),
  eidolon("hydrolyst", T + 300_000, { captured: T + 435_370 }),
];

test("the night waits for the first spawn, with the night left", async () => {
  await send(vm, store, value());
  assert.deepEqual(texts(state.view), {
    label: "Night left",
    big: "30:00",
    hint: "The timer starts at the first spawn.",
    chip: "",
    rows: [],
    line: "Night left 30:00",
  });
});

test("the hunt runs from the first spawn; a capture shows up late, exact", async () => {
  await send(vm, store, value({ hunts: [first[0]].map((h) => ({ ...h, capturedAt: null })) }));
  await advance(vm, store, 60 * SECOND);
  assert.equal(state.view.label, "Hunt in progress");
  assert.equal(state.view.big, "01:00");
  assert.equal(state.view.hint, "No best yet");
  assert.equal(state.view.chip, "Night 29:00");
  assert.deepEqual(texts(state.view).rows, ["Teralyst running", "Gantulyst —", "Hydrolyst —"]);
  // The capture at 01:48.22 is told 26 s later: the timer does not go back.
  await advance(vm, store, 74 * SECOND);
  assert.equal(state.view.big, "02:14");
  await send(vm, store, value({ hunts: [first[0]] }));
  assert.equal(state.view.big, "02:14");
  assert.deepEqual(texts(state.view).rows, ["Teralyst 01:48.22", "Gantulyst running", "Hydrolyst —"]);
});

test("a perfect tricap freezes the exact total and becomes the first best", async () => {
  vm.advance(T + 460_000 - vm.now);
  await send(vm, store, value({ hunts: first }));
  assert.deepEqual(texts(state.view), {
    label: "Tricap",
    big: "07:15.37",
    hint: "Your first best",
    chip: "Night 22:20",
    rows: ["Teralyst 01:48.22", "Gantulyst 02:12.05", "Hydrolyst 03:15.10"],
    line: "Tricap 07:15.37 New best",
  });
  assert.equal(state.view.pill, "New best");
  assert.deepEqual(store.get("best"), { s: T, total: 435_370, splits: [108_220, 132_050, 195_100], prev: null });
  assert.deepEqual(store.get("history"), [{ s: T, end: T + 435_370, caps: 3, total: 435_370 }]);
});

const U = T + 8 * MINUTE;
const second = [
  // Named by position: the host could not tell which Eidolon it was.
  eidolon(null, U, { captured: U + 105_120 }),
  eidolon(null, U + 150_000, { captured: U + 242_000 }),
  eidolon(null, U + 300_000, { captured: U + 420_000 }),
];

test("an unnamed Eidolon takes its position; splits are compared position by position", async () => {
  vm.advance(U + 110 * SECOND - vm.now);
  await send(vm, store, value({ hunts: [...first, second[0]] }));
  assert.equal(state.view.label, "Hunt in progress");
  assert.equal(state.view.hint, "3.10 s ahead of your best after Teralyst");
  assert.equal(state.view.hintCls, "hint tone-success");
  assert.deepEqual(texts(state.view).rows, ["Teralyst −3.10 01:45.12", "Gantulyst running", "Hydrolyst —"]);
  assert.equal(texts(state.view).line, "01:50 −3.10 Night 20:10");
  await send(vm, store, value({ hunts: [...first, second[0], second[1]] }));
  assert.equal(state.view.hint, "1.73 s behind your best after Gantulyst");
  assert.equal(state.view.hintCls, "hint tone-warning");
  assert.deepEqual(texts(state.view).rows, ["Teralyst −3.10 01:45.12", "Gantulyst +4.83 02:16.88", "Hydrolyst running"]);
});

test("a faster tricap is the new best, against the previous one", async () => {
  vm.advance(U + 425 * SECOND - vm.now);
  await send(vm, store, value({ hunts: [...first, ...second] }));
  assert.equal(state.view.big, "07:00.00");
  assert.equal(state.view.hint, "Previous best 07:15.37 · −15.37 s");
  assert.deepEqual(store.get("best").prev, { total: 435_370, splits: [108_220, 132_050, 195_100] });
  // A new best is compared with the one it beats.
  assert.deepEqual(texts(state.view).rows, ["Teralyst \u22123.10 01:45.12", "Gantulyst +4.83 02:16.88", "Hydrolyst \u221217.10 02:58.00"]);
  assert.equal(store.get("history").length, 2);
});

const V = U + 8 * MINUTE;

test("a Gantulyst killed: tricap missed, the timer frozen at its death", async () => {
  const third = [eidolon("teralyst", V, { captured: V + 100_000 }), eidolon("gantulyst", V + 150_000, { killed: V + 230_000 })];
  vm.advance(V + 250 * SECOND - vm.now);
  await send(vm, store, value({ hunts: [...first, ...second, ...third] }));
  assert.equal(state.view.label, "Tricap missed");
  assert.equal(state.view.big, "03:50.00");
  assert.equal(state.view.hint, "1\u00a0capture of\u00a03\u00a0\u00b7 Gantulyst killed");
  assert.equal(state.view.hintCls, "hint tone-warning");
  assert.deepEqual(texts(state.view).rows, ["Teralyst \u22125.12 01:40.00", "Gantulyst killed 02:10.00", "Hydrolyst \u2014"]);
  assert.equal(texts(state.view).line, "Tricap missed 03:50.00 Night 9:50");
  await advance(vm, store, SECOND);
  assert.equal(state.view.big, "03:50.00");
  assert.equal(store.get("history").at(-1).end, V + 230_000);
});

test("the Hydrolyst gone at dawn: the timer freezes on the real duration", async () => {
  const third = [eidolon("teralyst", V, { captured: V + 100_000 }), eidolon("gantulyst", V + 150_000, { killed: V + 230_000 })];
  const X = V + 340 * SECOND;
  const fourth = [
    eidolon("teralyst", X, { captured: X + 100_000 }),
    eidolon("gantulyst", X + 120_000, { captured: X + 250_000 }),
    eidolon("hydrolyst", X + 300_000, { fled: NIGHT_END + 12_000 }),
  ];
  vm.advance(NIGHT_END + 40 * SECOND - vm.now);
  const day = { state: { id: "day", name: "Day" }, endsAt: NIGHT_END + 100 * MINUTE };
  await send(vm, store, value({ hunts: [...first, ...second, ...third, ...fourth], night: false, cetus: day }));
  assert.equal(state.view.label, "Tricap missed");
  assert.equal(state.view.big, exactOf(NIGHT_END + 12_000 - X));
  assert.equal(state.view.hint, "2 captures of 3\u00a0\u00b7 Hydrolyst fled at dawn");
  assert.equal(state.view.cycleIcon, "sun");
  assert.equal(state.view.chip, "");
  assert.equal(texts(state.view).rows.at(-1), "Hydrolyst fled " + exactOf(NIGHT_END + 12_000 - (X + 250_000)));
  assert.equal(texts(state.view).line, "Tricap missed " + exactOf(NIGHT_END + 12_000 - X));
  // The killed run ended when the next one began; neither is a best.
  const history = store.get("history");
  assert.deepEqual(history.map((past) => [past.caps, past.total]), [[3, 435_370], [3, 420_000], [1, null], [2, null]]);
  assert.equal(store.get("best").total, 420_000);
});

test("after a while, the day at Cetus comes back", async () => {
  await advance(vm, store, 11 * MINUTE);
  assert.equal(state.view.label, "Night in");
  assert.equal(state.view.big, "1:28:20");
});

function exactOf(ms) {
  const centis = Math.floor(ms / 10);
  const minutes = String(Math.floor(centis / 6000)).padStart(2, "0");
  const seconds = String(Math.floor(centis / 100) % 60).padStart(2, "0");
  return `${minutes}:${seconds}.${String(centis % 100).padStart(2, "0")}`;
}
