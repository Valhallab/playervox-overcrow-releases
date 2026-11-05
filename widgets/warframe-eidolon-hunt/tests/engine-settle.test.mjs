// When a tricap attempt ends. A killed Eidolon cannot be followed (the next
// one needs the shards of a capture): the attempt ends at its death. Should
// the next one appear anyway, the attempt goes on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { MINUTE, START, messages } from "./fake.mjs";

installRuntime({ now: START, host: { messages: messages("en") } });
const logic = await loadLogic();

const T = START;
const leg = (e, s, ends = {}) => ({ s, e, c: ends.c ?? null, k: ends.k ?? null, f: ends.f ?? null });
const settled = (legs, now) => logic.settle(logic.cut(legs, null), now, null, 0);

test("an Eidolon killed, then the Hydrolyst captured: missed, ended at the Hydrolyst", () => {
  const [run] = settled(
    [leg("teralyst", T, { c: T + 100_000 }), leg("gantulyst", T + 150_000, { k: T + 230_000 }), leg("hydrolyst", T + 300_000, { c: T + 420_000 })],
    T + 430_000,
  );
  assert.equal(run.outcome, "killed");
  assert.equal(run.end, T + 420_000);
});

test("the Teralyst killed, then both others captured: missed, ended at the Hydrolyst", () => {
  const [run] = settled(
    [leg("teralyst", T, { k: T + 100_000 }), leg(null, T + 150_000, { c: T + 230_000 }), leg(null, T + 300_000, { c: T + 420_000 })],
    T + 430_000,
  );
  assert.equal(run.outcome, "killed");
  assert.equal(run.end, T + 420_000);
});

test("the Teralyst killed: missed, ended at its death", () => {
  const [run] = settled([leg("teralyst", T, { k: T + 100_000 })], T + 5 * MINUTE);
  assert.equal(run.outcome, "killed");
  assert.equal(run.end, T + 100_000);
});

test("the Gantulyst killed: missed, ended at its death", () => {
  const [run] = settled([leg("teralyst", T, { c: T + 100_000 }), leg("gantulyst", T + 150_000, { k: T + 230_000 })], T + 5 * MINUTE);
  assert.equal(run.outcome, "killed");
  assert.equal(run.end, T + 230_000);
});

test("the next Eidolon appears after a kill all the same: the attempt goes on", () => {
  const [run] = settled([leg("teralyst", T, { k: T + 100_000 }), leg(null, T + 150_000)], T + 5 * MINUTE);
  assert.equal(run.outcome, "open");
  assert.equal(run.end, null);
});
