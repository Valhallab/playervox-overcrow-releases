// Unit tests of the Player reviews widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["playervox.reviews.read"],
    mode: "interactive",
    messages: messages("en"),
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

/** Lets the promises of the settled calls run. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

// Synthetic reviews: 2026-09-20T10:30:00Z and earlier.
const review = (id, changes = {}) => ({
  id: `r${id}`,
  author: `player${id}`,
  grade: "A",
  score: 74,
  text: "Solid.",
  original: null,
  hidden: false,
  publishedAt: 1_789_900_200_000 - id * 86_400_000,
  offsetMinutes: 120,
  ...changes,
});
const page = (number, { total = 3, count = 7, items = 3, gameName = "Portal 2", first = number * 10 } = {}) => ({
  gameName,
  items: Array.isArray(items) ? items : Array.from({ length: items }, (_, index) => review(first + index)),
  page: number,
  totalPages: total,
  count,
});
const reviews = (revision, name = "ready", offline = false) => ({ state: name, revision, offline });
const pages = () => vm.calls.filter((call) => call.service === "playervox.reviews.page");
const pending = () => pages().filter((call) => !call.settled);
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);
const last = () => vm.lastCall("playervox.reviews.page");
const row = (index) => logic.row(state.page, state.reading, state.interactive, index);

/** Publishes a revision and answers the read it starts. */
async function show(revision, value) {
  vm.push("playervox.reviews.subscribe", reviews(revision));
  last().resolve(value);
  await settled();
}

test("it subscribes once, draws the mark and shows Loading without reading", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    ["playervox.reviews.subscribe"],
  );
  assert.equal(state.phase, "loading");
  assert.equal(pages().length, 0, "no page is read before the first revision");
  assert.ok(vm.draws.some((entry) => entry.ref === "mark"), "the mark is drawn once");
  assert.equal(vm.timers.length, 0, "nothing polls");
});

test("a revision reads the first page of every player; the same revision reads nothing", async () => {
  vm.push("playervox.reviews.subscribe", reviews(1));
  assert.equal(state.busy, true, "the paging buttons wait for the read");
  assert.deepEqual(last().params, { page: 1, followedOnly: false });
  last().resolve(page(1));
  await settled();
  assert.equal(state.phase, "ready");
  assert.equal(state.busy, false);
  assert.equal(logic.gameName(state.page), "Portal 2");
  const before = pages().length;
  vm.push("playervox.reviews.subscribe", reviews(1));
  assert.equal(pages().length, before);
  for (const index of [0, 1, 2]) {
    assert.ok(
      vm.draws.some((entry) => entry.ref === `badge-${index}` && entry.commands.length > 0),
      `badge ${index} is drawn`,
    );
  }
});

test("paging reads the page before or after the one shown, one request at a time", async () => {
  await show(2, page(1));
  const before = pages().length;
  logic.turn("previous");
  assert.equal(pages().length, before, "no previous page: nothing is asked");
  assert.equal(logic.canTurn(state.page, "previous", state.busy, state.offline), false);
  assert.equal(logic.canTurn(state.page, "next", state.busy, state.offline), true);
  logic.turn("next");
  logic.turn("next");
  assert.equal(pages().length, before + 1, "rapid clicks do not queue page turns");
  assert.deepEqual(last().params, { page: 2, followedOnly: false });
  assert.equal(logic.canTurn(state.page, "next", state.busy, state.offline), false, "a read is in flight");
  last().resolve(page(2));
  await settled();
  assert.equal(logic.pagerText(state.page), "2 / 3");
  assert.equal(logic.pagerLabel(state.page), "Page 2 of 3");

  // A new revision reads the page shown again, with its number.
  vm.push("playervox.reviews.subscribe", reviews(3));
  assert.deepEqual(last().params, { page: 2, followedOnly: false });
  // PlayerVox answers its last page when the page shown no longer exists.
  last().resolve(page(1, { total: 1, count: 2, items: 2 }));
  await settled();
  assert.equal(logic.pagerText(state.page), "1 / 1");
  assert.equal(logic.canTurn(state.page, "next", state.busy, state.offline), false, "the end of the list");
  vm.push("playervox.reviews.subscribe", reviews(4));
  assert.deepEqual(last().params, { page: 1, followedOnly: false }, "the widget follows the page it was given");
  last().resolve(page(1));
  await settled();

  vm.setHost({ mode: "passive" });
  logic.turn("next");
  assert.equal(pending().length, 0, "Passive never turns a page");
  vm.setHost({ mode: "interactive" });
});

test("a revision during a read reads once more after it", async () => {
  vm.push("playervox.reviews.subscribe", reviews(5));
  const first = last();
  vm.push("playervox.reviews.subscribe", reviews(6));
  vm.push("playervox.reviews.subscribe", reviews(7));
  assert.equal(pending().length, 1, "one request in flight");
  first.resolve(page(1));
  await settled();
  assert.equal(pending().length, 1, "then one more read, not two");
  assert.equal(state.busy, true);
  last().resolve(page(1));
  await settled();
  assert.equal(pending().length, 0);
  assert.equal(state.busy, false);
});

test("a row shows the player, the date in the user's order, the score and the badge's name", async () => {
  await show(8, page(1, { items: [review(1, { author: " Mira\nQuill ", score: 89.6, grade: "S" })] }));
  const shown = row(0);
  assert.equal(shown.author, "Mira Quill");
  assert.equal(shown.date, "09/19/2026");
  assert.equal(shown.score, "90", "rounded half away from zero");
  assert.equal(shown.badge, "Grade S, 90/100", "the host's grade, on the raw score");
  assert.equal(shown.label, "Mira Quill, 09/19/2026, 90/100");
  assert.equal(logic.has(state.page, 0), true);
  assert.equal(logic.has(state.page, 1), false);
  assert.equal(row(1).id, "", "no review there");
  vm.setHost({ region: { ...vm.host.region, dateOrder: "dmy" } });
  assert.equal(row(0).date, "19/09/2026");
  vm.setHost({ region: { ...vm.host.region, dateOrder: "mdy" } });
  // The local time the review carries, not UTC: 23:30 UTC is the next day at +02:00.
  const late = review(0, { publishedAt: Date.UTC(2026, 8, 20, 23, 30), offsetMinutes: 120 });
  assert.equal(logic.dateText(late), "09/21/2026");
  assert.equal(logic.dateText({ ...late, offsetMinutes: -480 }), "09/20/2026");
  assert.equal(logic.dateText({ ...late, publishedAt: -1 }), "—");
  assert.equal(logic.dateText({ ...late, publishedAt: Number.NaN }), "—");
});

test("the count is singular or plural in the user's number format", () => {
  assert.equal(logic.countText(page(1, { count: 1 })), "1 review");
  assert.equal(logic.countText(page(1, { count: 0 })), "0 reviews");
  assert.equal(logic.countText(page(1, { count: 1284 })), "1,284 reviews");
  vm.setHost({ region: { ...vm.host.region, numberFormat: "fr" } });
  assert.equal(logic.countText(page(1, { count: 1284 })), "1 284 reviews");
  vm.setHost({ region: { ...vm.host.region, numberFormat: "us" } });
  assert.equal(logic.pagerText(page(9, { total: 3 })), "3 / 3", "never past the last page");
  assert.equal(logic.pagerText(page(0, { total: 0 })), "1 / 1");
});

test("a long review folds behind Read more; a short one has no button", async () => {
  assert.equal(logic.folds("x".repeat(logic.FOLD_CHARACTERS)), false);
  assert.equal(logic.folds("x".repeat(logic.FOLD_CHARACTERS + 1)), true);
  assert.equal(logic.folds("one\ntwo\nthree"), false);
  assert.equal(logic.folds("one\ntwo\nthree\nfour"), true);
  assert.equal(logic.folds("🎮".repeat(logic.FOLD_CHARACTERS)), false, "characters, not UTF-16 units");
  const long = "word ".repeat(60).trim();
  await show(9, page(1, { items: [review(1, { text: `  ${long}  ` }), review(2)] }));
  assert.equal(row(0).text, long, "trimmed");
  assert.equal(row(0).textClass, "body folded");
  assert.equal(row(0).fold, "Read more");
  assert.equal(row(0).actions, true);
  assert.equal(row(1).fold, "");
  assert.equal(row(1).textClass, "body");
  assert.equal(row(1).actions, false);
  logic.toggleFold("r1");
  assert.equal(row(0).textClass, "body");
  assert.equal(row(0).fold, "Show less");
  logic.toggleFold("r1");
  assert.equal(row(0).fold, "Read more");
  // A folded review gives the host its start only; unfolded, all of it.
  const huge = "é🎮".repeat(4000);
  assert.equal(logic.foldedText(huge), `${"é🎮".repeat(logic.FOLDED_CHARACTERS / 2)}…`);
  assert.equal(logic.foldedText("x".repeat(logic.FOLDED_CHARACTERS)), "x".repeat(logic.FOLDED_CHARACTERS));
  const longest = page(1, { items: [review(1, { text: huge })] });
  assert.equal(logic.row(longest, {}, true, 0).text, logic.foldedText(huge));
  assert.equal(logic.row(longest, { r1: { expanded: true, original: false, revealed: false } }, true, 0).text, huge);
  // Passive shows no button and still folds.
  vm.setHost({ mode: "passive" });
  assert.equal(row(0).fold, "");
  assert.equal(row(0).actions, false);
  assert.equal(row(0).textClass, "body folded");
  logic.toggleFold("r1");
  assert.equal(state.reading.r1.expanded, false, "Passive changes no reading");
  vm.setHost({ mode: "interactive" });
});

test("a translated review is marked and shows its original on request", async () => {
  const translated = review(1, { text: "Solide.", original: "Solid." });
  await show(10, page(1, { items: [translated, review(2), review(3, { text: "ok", original: "  " })] }));
  assert.equal(logic.isTranslated(translated), true);
  assert.equal(row(0).text, "Solide.");
  assert.equal(row(0).translated, true);
  assert.equal(row(0).language, "Show original");
  assert.equal(row(1).translated, false);
  assert.equal(row(1).language, "");
  assert.equal(row(2).translated, false, "a blank original is no translation");
  logic.toggleLanguage("r1");
  assert.equal(row(0).text, "Solid.");
  assert.equal(row(0).translated, false, "the mark goes with the translation");
  assert.equal(row(0).language, "Show translation");
  logic.toggleLanguage("r2");
  assert.equal(row(1).text, "Solid.", "an untranslated review has no other text");
  // Passive keeps the mark and has no button.
  logic.toggleLanguage("r1");
  vm.setHost({ mode: "passive" });
  assert.equal(row(0).translated, true);
  assert.equal(row(0).language, "");
  vm.setHost({ mode: "interactive" });
});

test("a review hidden by the community shows no text until the user asks", async () => {
  await show(11, page(1, { items: [review(1, { hidden: true, text: "Spoilers.", original: "Divulgâchis." })] }));
  assert.equal(row(0).masked, true);
  assert.equal(row(0).text, "");
  assert.equal(row(0).translated, false);
  assert.equal(row(0).actions, false);
  logic.reveal("r1");
  assert.equal(row(0).masked, false);
  assert.equal(row(0).text, "Spoilers.");
  assert.equal(row(0).translated, true);
});

test("reading choices stay through a refresh of the page and start again on another page", async () => {
  await show(12, page(1, { items: [review(1), review(2), review(3)] }));
  logic.toggleFold("r1");
  logic.toggleLanguage("r2");
  logic.reveal("r3");
  // The same page again, without review 3 and with a new one.
  await show(13, page(1, { items: [review(1), review(2), review(4)] }));
  assert.deepEqual(Object.keys(state.reading).sort(), ["r1", "r2"], "only for reviews still on the page");
  assert.equal(state.reading.r1.expanded, true);
  assert.equal(state.reading.r2.original, true);
  // Another page that shares a review starts unread.
  logic.turn("next");
  last().resolve(page(2, { items: [review(1), review(5)] }));
  await settled();
  assert.deepEqual(state.reading, {});
  logic.turn("previous");
  last().resolve(page(1, { items: [review(1), review(2), review(4)] }));
  await settled();
  assert.deepEqual(state.reading, {});
});

test("the followed players filter reads the first page again and has its own empty text", async () => {
  logic.turn("next");
  last().resolve(page(2));
  await settled();
  logic.toggleFold("r20");
  const before = pages().length;
  vm.setHost({ options: { "followed-only": true } });
  assert.equal(pages().length, before + 1);
  assert.deepEqual(last().params, { page: 1, followedOnly: true });
  assert.equal(state.page, null, "the other list's page does not stay");
  assert.equal(state.phase, "loading");
  last().resolve(page(1, { total: 1, count: 0, items: 0 }));
  await settled();
  assert.equal(state.followedOnly, true);
  assert.deepEqual(state.reading, {});
  assert.equal(logic.emptyText(state.followedOnly), "No reviews from the players you follow yet.");
  assert.equal(logic.emptyText(false), "No player reviews for this game yet.");
  // The same value again reads nothing.
  vm.setHost({ options: { "followed-only": true } });
  assert.equal(pages().length, before + 1);
  // A new revision keeps the filter.
  vm.push("playervox.reviews.subscribe", reviews(14));
  assert.deepEqual(last().params, { page: 1, followedOnly: true });
  last().resolve(page(1, { total: 1, count: 0, items: 0 }));
  await settled();
  vm.setHost({ options: { "followed-only": false } });
  assert.deepEqual(last().params, { page: 1, followedOnly: false });
  last().resolve(page(1));
  await settled();
  assert.equal(state.followedOnly, false);
});

test("a filter changed during a read is not answered by the other list's page", async () => {
  vm.push("playervox.reviews.subscribe", reviews(15));
  const stale = last();
  vm.setHost({ options: { "followed-only": true } });
  assert.deepEqual(last().params, { page: 1, followedOnly: true });
  stale.resolve(page(1, { gameName: "every player" }));
  await settled();
  assert.equal(state.page, null, "the late page of the other list is dropped");
  assert.equal(state.busy, true);
  last().resolve(page(1, { total: 1, count: 1, items: 1, gameName: "followed" }));
  await settled();
  assert.equal(logic.gameName(state.page), "followed");
  vm.setHost({ options: { "followed-only": false } });
  last().resolve(page(1));
  await settled();
});

test("another language reads the first page again", async () => {
  logic.turn("next");
  last().resolve(page(2));
  await settled();
  const before = pages().length;
  vm.setHost({ locale: "fr", messages: messages("fr") });
  assert.equal(pages().length, before + 1);
  assert.deepEqual(last().params, { page: 1, followedOnly: false });
  assert.equal(state.page, null);
  last().resolve(page(1, { items: [review(1, { text: "Solide.", original: "Solid." })], count: 1, total: 1 }));
  await settled();
  assert.equal(row(0).language, "Voir l’original");
  assert.equal(logic.countText(state.page), "1 avis");
  assert.equal(logic.pagerLabel(state.page), "Page 1 sur 1");
  // The same language again reads nothing.
  vm.setHost({ locale: "fr", messages: messages("fr") });
  assert.equal(pages().length, before + 1);
  vm.setHost({ locale: "en", messages: messages("en") });
  last().resolve(page(1));
  await settled();
});

test("no game or a game without a Steam app ID clears the reviews; the next game starts on its first page", async () => {
  logic.turn("next");
  last().resolve(page(2));
  await settled();
  logic.toggleFold("r20");
  vm.push("playervox.reviews.subscribe", reviews(15, "idle"));
  assert.equal(state.phase, "idle");
  assert.equal(state.page, null, "nothing of the last game stays");
  assert.deepEqual(state.reading, {});
  assert.ok(
    vm.draws.findLast((entry) => entry.ref === "badge-0").commands.length === 0,
    "its badges are cleared",
  );
  vm.push("playervox.reviews.subscribe", reviews(15, "unsupported"));
  assert.equal(state.phase, "unsupported");
  const before = pages().length;
  assert.equal(pending().length, 0);
  vm.push("playervox.reviews.subscribe", reviews(15));
  assert.equal(state.phase, "loading");
  assert.equal(pages().length, before + 1, "the same revision number of another game still reads");
  assert.deepEqual(last().params, { page: 1, followedOnly: false }, "not the last game's page 2");
  last().resolve(page(1, { gameName: "Hades" }));
  await settled();
  assert.equal(logic.gameName(state.page), "Hades");
});

test("a page answered after the game left is dropped", async () => {
  vm.push("playervox.reviews.subscribe", reviews(16));
  const late = last();
  vm.push("playervox.reviews.subscribe", reviews(16, "idle"));
  late.resolve(page(1, { gameName: "late" }));
  await settled();
  assert.equal(state.page, null);
  assert.equal(state.phase, "idle");
  assert.equal(state.busy, false);
  await show(17, page(1));
});

test("a failed read keeps the page shown and says why; the next revision reads again", async () => {
  const shown = state.page;
  for (const [code, text] of [
    ["unavailable", "PlayerVox is unavailable for this game right now."],
    ["timeout", "PlayerVox is unavailable for this game right now."],
    ["not_connected", "Your connection expired. Link your account again."],
    ["permission_denied", "PlayerVox is unavailable for this game right now."],
  ]) {
    logic.turn("next");
    last().reject(code);
    await settled();
    assert.equal(logic.message(state.problem), text, code);
    assert.equal(state.page, shown, "the page shown stays");
    assert.equal(state.phase, "ready");
    assert.equal(state.busy, false);
  }
  assert.equal(vm.timers.length, 0, "no retry loop: the next revision reads");
  await show(18, page(1));
  assert.equal(state.problem, "");
  assert.equal(logic.message(state.problem), "");
});

test("busy and stale_context are read again a second later, three times at most", async () => {
  vm.push("playervox.reviews.subscribe", reviews(19));
  for (let attempt = 0; attempt < logic.MAX_REREADS; attempt += 1) {
    last().reject("busy");
    await settled();
    assert.equal(state.problem, "", "still trying");
    assert.equal(vm.timers.length, 1);
    assert.equal(vm.timers[0].intervalMs, logic.REREAD_MS);
    vm.advance(logic.REREAD_MS);
    assert.deepEqual(last().params, { page: 1, followedOnly: false });
  }
  last().reject("busy");
  await settled();
  assert.equal(logic.message(state.problem), "An operation is already in progress. Please try again shortly.");
  assert.equal(vm.timers.length, 0);

  // The game or the account changed under a read of page 2: the first page.
  await show(20, page(1));
  logic.turn("next");
  last().reject("stale_context");
  await settled();
  vm.advance(logic.REREAD_MS);
  assert.deepEqual(last().params, { page: 1, followedOnly: false });
  last().resolve(page(1));
  await settled();
  assert.equal(state.problem, "");
});

test("a first read that fails shows the failure without a page", async () => {
  vm.push("playervox.reviews.subscribe", reviews(20, "idle"));
  vm.push("playervox.reviews.subscribe", reviews(21));
  last().reject("unavailable");
  await settled();
  assert.equal(state.phase, "failed");
  assert.equal(logic.message(state.problem), "PlayerVox is unavailable for this game right now.");
  // Another filter reads at once, whatever the failure was.
  for (const code of ["busy", "busy", "busy", "busy"]) {
    vm.advance(logic.REREAD_MS);
    if (pending().length === 0) {
      vm.push("playervox.reviews.subscribe", reviews(21));
    }
    last().reject(code);
    await settled();
  }
  assert.equal(state.phase, "failed");
  assert.equal(state.problem, "read-busy");
  vm.setHost({ options: { "followed-only": true } });
  assert.deepEqual(last().params, { page: 1, followedOnly: true });
  assert.equal(state.phase, "loading");
  assert.equal(state.problem, "");
  last().reject("unavailable");
  await settled();
  vm.setHost({ options: { "followed-only": false } });
  last().reject("unavailable");
  await settled();
  assert.equal(state.phase, "failed");
  // The same revision published again reads again: the page is still missing.
  const before = pages().length;
  vm.push("playervox.reviews.subscribe", reviews(21));
  assert.equal(pages().length, before + 1);
  assert.equal(state.phase, "loading");
  last().resolve(page(1));
  await settled();
  assert.equal(state.phase, "ready");
});

test("offline, the page stays, nothing is read and paging waits; back online, it reads", async () => {
  const shown = state.page;
  const before = pages().length;
  vm.push("playervox.reviews.subscribe", reviews(21, "ready", true));
  assert.equal(state.offline, true);
  assert.equal(state.page, shown);
  assert.equal(logic.canTurn(state.page, "next", state.busy, state.offline), false);
  logic.turn("next");
  vm.push("playervox.reviews.subscribe", reviews(22, "ready", true));
  vm.setHost({ options: { "followed-only": true } });
  assert.equal(pages().length, before, "nothing is read while PlayerVox is unreachable");
  assert.equal(state.page, null, "another filter's page is not shown as this one's");
  assert.equal(state.phase, "loading");
  vm.push("playervox.reviews.subscribe", reviews(22));
  assert.equal(state.offline, false);
  assert.equal(pages().length, before + 1, "one read once PlayerVox is back");
  assert.deepEqual(last().params, { page: 1, followedOnly: true });
  last().resolve(page(1, { total: 1, count: 1, items: 1 }));
  await settled();
  vm.setHost({ options: { "followed-only": false } });
  last().resolve(page(1));
  await settled();
  // Offline with a page and no change: back online reads nothing.
  const quiet = pages().length;
  vm.push("playervox.reviews.subscribe", reviews(22, "ready", true));
  vm.push("playervox.reviews.subscribe", reviews(22));
  assert.equal(pages().length, quiet);
});

test("the neutral badge follows the theme", () => {
  const dark = logic.smallBadge("--", "dark");
  const light = logic.smallBadge("--", "light");
  assert.notDeepEqual(dark, light);
  assert.deepEqual(logic.smallBadge("A", "dark"), logic.smallBadge("A", "light"));
  assert.deepEqual(dark[1], ["scale", logic.SMALL_BADGE / logic.BADGE_CANVAS, logic.SMALL_BADGE / logic.BADGE_CANVAS]);
  const before = vm.draws.length;
  vm.setHost({ theme: "light" });
  assert.equal(vm.draws.length, before + logic.PAGE_SIZE, "each badge is drawn again");
  vm.setHost({ theme: "dark" });
});

test("when the host ends the subscription, the widget says so and subscribes again later", async () => {
  assert.equal(live().length, 1);
  vm.fail("playervox.reviews.subscribe", "unavailable");
  assert.equal(live().length, 0);
  assert.equal(state.phase, "failed");
  assert.equal(state.page, null, "the page shown does not outlive its source");
  assert.equal(logic.message(state.problem), "The reviews are unavailable. Retrying automatically.");
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].intervalMs, logic.RETRY_MS);
  // Another filter meanwhile reads nothing: there is no source.
  const before = pages().length;
  vm.setHost({ options: { "followed-only": true } });
  vm.setHost({ options: { "followed-only": false } });
  assert.equal(pages().length, before);
  assert.equal(logic.message(state.problem), "The reviews are unavailable. Retrying automatically.");
  vm.advance(logic.RETRY_MS);
  assert.equal(live().length, 1, "one new subscription");
  assert.equal(vm.timers.length, 0);
  // The new subscription's first value reads, whatever its revision.
  vm.push("playervox.reviews.subscribe", reviews(22));
  assert.equal(state.phase, "loading");
  assert.equal(state.problem, "");
  last().resolve(page(1));
  await settled();
  assert.equal(state.phase, "ready");
});

test("text bounds: names on one line, labels within the host's bound", () => {
  assert.equal(logic.oneLine(" a \n b\r\n c "), "a b c");
  assert.equal(logic.cutBytes("é".repeat(200), 256).length, 128);
  assert.equal(logic.cutBytes("🎮".repeat(100), 256), "🎮".repeat(64));
  const long = review(1, { author: "x".repeat(128) });
  const shown = logic.row(page(1, { items: [long] }), {}, true, 0);
  assert.ok(new TextEncoder().encode(shown.label).length <= 256);
  assert.equal(shown.authorTip, "x".repeat(128));
  assert.equal(logic.gameName(page(1, { gameName: " Portal\n2 " })), "Portal 2");
  assert.equal(logic.gameName(null), "");
});
