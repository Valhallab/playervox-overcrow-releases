// Unit tests of the PlayerVox Journal widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["journal.read", "journal.delete"],
    mode: "interactive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

/** Lets the promises of the settled calls run. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

// Synthetic sessions: 2026-09-20T18:30:00Z and earlier.
const session = (id, changes = {}) => ({
  id: `s${id}`,
  startedAt: 1_789_929_000_000 - id * 86_400_000,
  offsetMinutes: 120,
  durationMs: 2_700_000,
  source: "local",
  ...changes,
});
const page = (number, { next = null, previous = null, count = 5, gameName = "Portal 2" } = {}) => ({
  gameName,
  items: Array.from({ length: count }, (_, index) => session(number * 10 + index)),
  page: number,
  next,
  previous,
});
const journal = (revision, notice = null) => ({ revision, notice });
const pages = () => vm.calls.filter((call) => call.service === "journal.page");
const pending = () => pages().filter((call) => !call.settled);
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);

/** Publishes a revision and answers the read it starts. */
async function show(revision, value, notice = null) {
  vm.push("journal.subscribe", journal(revision, notice));
  vm.lastCall("journal.page").resolve(value);
  await settled();
}

test("it subscribes once, draws the mark and shows Loading without reading", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    ["journal.subscribe"],
  );
  assert.equal(state.phase, "loading");
  assert.equal(pages().length, 0, "no page is read before the journal's first revision");
  assert.ok(vm.draws.some((entry) => entry.ref === "mark"), "the mark is drawn once");
  assert.equal(vm.timers.length, 0, "nothing polls");
});

test("a revision reads the first page; the same revision reads nothing", async () => {
  vm.push("journal.subscribe", journal(1));
  assert.equal(state.busy, true, "the controls wait for the read");
  assert.deepEqual(vm.lastCall("journal.page").params, {});
  vm.lastCall("journal.page").resolve(page(1, { next: "c2" }));
  await settled();
  assert.equal(state.phase, "ready");
  assert.equal(state.busy, false);
  assert.equal(state.page.page, 1);
  const before = pages().length;
  vm.push("journal.subscribe", journal(1, "offline"));
  assert.equal(pages().length, before, "a notice alone reads nothing");
  assert.equal(state.notice, "offline");
  assert.equal(logic.message(state.problem, state.notice), "Sync is offline. Your sessions stay on this device.");
});

test("paging reads the page's own handle, one request at a time", async () => {
  await show(2, page(1, { next: "c2" }));
  const before = pages().length;
  logic.turn("previous");
  assert.equal(pages().length, before, "no previous page: nothing is asked");
  logic.turn("next");
  logic.turn("next");
  assert.equal(pages().length, before + 1, "rapid clicks do not queue page turns");
  assert.deepEqual(vm.lastCall("journal.page").params, { cursor: "c2" });
  vm.lastCall("journal.page").resolve(page(2, { next: "c3", previous: "c1" }));
  await settled();
  assert.equal(state.page.page, 2);
  assert.equal(logic.pageLabel(state.page), "Page 2");

  // A new revision reads the page shown again, with the same handle.
  vm.push("journal.subscribe", journal(3));
  assert.deepEqual(vm.lastCall("journal.page").params, { cursor: "c2" });
  // The host answers the last page when the page shown no longer exists.
  vm.lastCall("journal.page").resolve(page(1, { next: null, previous: null, count: 2 }));
  await settled();
  assert.equal(state.page.page, 1);
  assert.equal(logic.paged(state.page), false, "one page: no footer");

  vm.setHost({ mode: "passive" });
  logic.turn("next");
  assert.equal(pending().length, 0, "Passive never turns a page");
  vm.setHost({ mode: "interactive" });
});

test("a revision during a read reads once more after it", async () => {
  vm.push("journal.subscribe", journal(4));
  const first = vm.lastCall("journal.page");
  vm.push("journal.subscribe", journal(5));
  vm.push("journal.subscribe", journal(6));
  assert.equal(pending().length, 1, "one request in flight");
  first.resolve(page(1, { next: "c2" }));
  await settled();
  assert.equal(pending().length, 1, "then one more read, not two");
  assert.equal(state.busy, true);
  vm.lastCall("journal.page").resolve(page(1, { next: "c2" }));
  await settled();
  assert.equal(pending().length, 0);
  assert.equal(state.busy, false);
});

test("a deletion asks the host once; declined, nothing changes", async () => {
  await show(7, page(1, { next: "c2" }));
  const shown = state.page;
  const before = pages().length;
  logic.remove("s10");
  logic.remove("s11");
  const deletions = vm.calls.filter((call) => call.service === "journal.delete");
  assert.equal(deletions.length, 1, "one deletion at a time");
  assert.deepEqual(deletions[0].params, { session: "s10" });
  assert.equal(state.busy, true, "the controls wait for the user's answer");
  logic.turn("next");
  assert.equal(pages().length, before, "no page turn while the confirmation is open");
  deletions[0].reject("cancelled");
  await settled();
  assert.equal(state.busy, false);
  assert.equal(state.page, shown, "the page is untouched");
  assert.equal(state.problem, "", "declining is not an error");
  assert.equal(pages().length, before, "and nothing is read");
});

test("an accepted deletion reads the page shown again", async () => {
  const before = pages().length;
  logic.remove("s10");
  vm.lastCall("journal.delete").resolve(null);
  await settled();
  assert.equal(pages().length, before + 1);
  assert.deepEqual(vm.lastCall("journal.page").params, {});
  assert.equal(state.busy, true);
  vm.lastCall("journal.page").resolve(page(1, { count: 4 }));
  await settled();
  assert.equal(state.page.items.length, 4);
  assert.equal(state.busy, false);
});

test("a refused deletion says why, and the next action clears it", async () => {
  await show(8, page(1, { next: "c2" }));
  for (const [code, text] of [
    ["not_connected", "Connect PlayerVox to delete this session."],
    ["busy", "An operation is already in progress. Please try again shortly."],
    ["quota_exceeded", "Journal storage is full. Delete local sessions or synchronize pending deletions."],
    ["unavailable", "The session could not be deleted. Try again."],
    ["stale_context", "The session could not be deleted. Try again."],
  ]) {
    logic.remove("s10");
    vm.lastCall("journal.delete").reject(code);
    await settled();
    assert.equal(logic.message(state.problem, state.notice), text, code);
    assert.equal(state.busy, false);
  }
  logic.turn("next");
  assert.equal(state.problem, "", "a page turn clears the message");
  vm.lastCall("journal.page").resolve(page(2, { previous: "c1" }));
  await settled();
  assert.equal(logic.pageLabel(state.page), "Page 2 · End of the journal");
});

test("without the delete grant or in Passive mode nothing is deleted", () => {
  vm.setHost({ mode: "passive" });
  assert.equal(logic.canRemove(state.interactive), false);
  const before = vm.calls.length;
  logic.remove("s20");
  assert.equal(vm.calls.length, before);
  vm.setHost({ mode: "interactive" });
  assert.equal(logic.canRemove(state.interactive), true);
});

test("no game clears the journal; the next game starts on its first page", async () => {
  assert.equal(state.page.page, 2);
  vm.push("journal.subscribe", null);
  assert.equal(state.phase, "idle");
  assert.equal(state.page, null, "nothing of the last game stays");
  assert.equal(state.notice, null);
  vm.push("journal.subscribe", journal(1));
  assert.equal(state.phase, "loading");
  assert.deepEqual(vm.lastCall("journal.page").params, {}, "not the last game's page 2");
  vm.lastCall("journal.page").resolve(page(1, { gameName: "Hades" }));
  await settled();
  assert.equal(logic.gameName(state.page), "Hades");
});

test("a read answered after the game went is dropped", async () => {
  vm.push("journal.subscribe", journal(2));
  const late = vm.lastCall("journal.page");
  vm.push("journal.subscribe", null);
  late.resolve(page(1));
  await settled();
  assert.equal(state.phase, "idle");
  assert.equal(state.page, null, "the last game's page never shows");
  assert.equal(state.busy, false);
});

test("an unknown handle goes back to the first page", async () => {
  await show(3, page(1, { next: "c2" }));
  logic.turn("next");
  vm.lastCall("journal.page").resolve(page(2, { previous: "c1" }));
  await settled();
  vm.push("journal.subscribe", journal(4));
  vm.lastCall("journal.page").reject("invalid_request");
  await settled();
  assert.deepEqual(vm.lastCall("journal.page").params, {});
  vm.lastCall("journal.page").resolve(page(1, { next: "c2" }));
  await settled();
  assert.equal(state.page.page, 1);
});

test("busy and stale_context read again shortly, a bounded number of times", async () => {
  vm.push("journal.subscribe", journal(5));
  vm.lastCall("journal.page").reject("busy");
  await settled();
  assert.equal(state.problem, "", "a busy host is not shown at once");
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].intervalMs, logic.REREAD_MS);
  vm.advance(logic.REREAD_MS);
  vm.lastCall("journal.page").reject("stale_context");
  await settled();
  vm.advance(logic.REREAD_MS);
  assert.deepEqual(vm.lastCall("journal.page").params, {}, "after a change, from the first page");
  vm.lastCall("journal.page").reject("busy");
  await settled();
  vm.advance(logic.REREAD_MS);
  vm.lastCall("journal.page").reject("busy");
  await settled();
  assert.equal(vm.timers.length, 0, `no more than ${logic.MAX_REREADS} re-reads`);
  assert.equal(state.problem, "read-failed");
  assert.equal(state.phase, "ready", "the page shown stays");
  assert.equal(logic.message(state.problem, state.notice), "The journal is unavailable right now.");
  // The next revision reads again and clears the message.
  await show(6, page(1));
  assert.equal(state.problem, "");
});

test("a failed first read shows the journal's condition and waits for the journal", async () => {
  vm.push("journal.subscribe", null);
  vm.push("journal.subscribe", journal(1, "storage_unavailable"));
  vm.lastCall("journal.page").reject("unavailable");
  await settled();
  assert.equal(state.phase, "failed");
  assert.equal(logic.message(state.problem, state.notice), "Local session storage is unavailable.");
  assert.equal(vm.timers.length, 0, "no polling: the next update reads again");
  const before = pages().length;
  vm.push("journal.subscribe", journal(1, null));
  assert.equal(pages().length, before + 1, "a page still missing is read at the next update");
  vm.lastCall("journal.page").resolve(page(1, { count: 0 }));
  await settled();
  assert.equal(state.phase, "ready");
  assert.equal(state.page.items.length, 0);
});

test("a failed source ends the subscription; the widget subscribes again later", async () => {
  await show(2, page(1));
  vm.fail("journal.subscribe", "unavailable");
  assert.equal(state.phase, "failed");
  assert.equal(state.page, null);
  assert.equal(logic.message(state.problem, state.notice), "The journal is unavailable. Retrying automatically.");
  assert.equal(live().length, 0);
  vm.advance(logic.RETRY_MS - 1);
  assert.equal(live().length, 0);
  vm.advance(1);
  assert.equal(live().length, 1, "one new subscription");
  vm.push("journal.subscribe", journal(1));
  assert.equal(state.phase, "loading");
  assert.equal(state.problem, "");
  vm.lastCall("journal.page").resolve(page(1));
  await settled();
  assert.equal(state.phase, "ready");
});

test("dates follow the session's own offset and the user's date order", () => {
  // 2026-09-20T18:30:00Z.
  const summer = { id: "a", startedAt: 1_789_929_000_000, offsetMinutes: 120, durationMs: 0, source: "local" };
  assert.equal(logic.startText(summer), "09/20/2026 · 20:30");
  // 2026-01-15T11:00:00Z, an hour ahead in winter: its own offset, not today's.
  const winter = { ...summer, startedAt: 1_768_474_800_000, offsetMinutes: 60 };
  assert.equal(logic.startText(winter), "01/15/2026 · 12:00");
  vm.setHost({ region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 0 } });
  assert.equal(logic.startText(summer), "20/09/2026 · 20:30");
  vm.setHost({ region: { numberFormat: "us", dateOrder: "ymd", offsetMinutes: 0 } });
  assert.equal(logic.startText(summer), "2026-09-20 · 20:30");
  vm.setHost({ region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 } });
  // Past midnight in the session's zone: the local day.
  assert.equal(logic.startText({ ...summer, startedAt: 1_789_941_600_000 }), "09/21/2026 · 00:00");
  assert.equal(logic.startText({ ...summer, startedAt: Number.NaN }), "--");
});

test("durations are whole hours and minutes", () => {
  assert.equal(logic.durationText(2_700_000), "0 h 45 min");
  assert.equal(logic.durationText(3_600_000), "1 h 00 min");
  assert.equal(logic.durationText(7_919_999), "2 h 11 min");
  assert.equal(logic.durationText(59_999), "0 h 00 min");
  assert.equal(logic.durationText(7 * 24 * 3_600_000), "168 h 00 min", "no days");
  assert.equal(logic.durationText(-5), "0 h 00 min");
  assert.equal(logic.durationText(Number.NaN), "0 h 00 min");
});

test("rows carry a combined accessible name within the label bound", () => {
  const [row] = logic.rows(page(1, { count: 1 }));
  assert.equal(row.id, "s10");
  assert.equal(row.label, `${row.start}, ${row.duration}`);
  assert.deepEqual(logic.rows(null), []);
  assert.ok(Buffer.byteLength(logic.cutBytes("é".repeat(300), 256)) <= 256);
});

test("the game's name stays on one line; an empty one shows nothing", () => {
  assert.equal(logic.gameName(page(1, { gameName: " Half-Life\n  Alyx " })), "Half-Life Alyx");
  assert.equal(logic.gameName(page(1, { gameName: "" })), "");
  assert.equal(logic.gameName(null), "");
});

test("each journal condition has its text, in French too", () => {
  const french = messages("fr");
  const english = messages("en");
  for (const notice of ["offline", "storage_unavailable", "full", "expired", "busy", "unavailable"]) {
    const key = logic.noticeKey(notice);
    assert.ok(english[key], `en ${key}`);
    assert.ok(french[key], `fr ${key}`);
  }
  assert.equal(logic.noticeKey(null), "");
  assert.deepEqual(Object.keys(french).sort(), Object.keys(english).sort());
  assert.equal(logic.message("", null), "");
  assert.equal(logic.message("delete-failed", "offline"), english["delete-failed"], "the action's failure first");
});
