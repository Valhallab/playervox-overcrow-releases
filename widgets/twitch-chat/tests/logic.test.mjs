// Unit tests of the Twitch chat widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const messages = (locale) => JSON.parse(read(`locales/${locale}.json`));

const START = Date.UTC(2026, 0, 1, 12);
const vm = installRuntime({
  now: START,
  host: {
    grants: ["twitch.chat.read", "twitch.chat.compose"],
    mode: "interactive",
    messages: messages("en"),
    options: { "passive-lifetime": 30 },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const SERVICE = "twitch.chat.subscribe";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const live = () => vm.subscriptions.filter((subscription) => !subscription.cancelled);

/** A chat message as the host delivers it, received now unless `changes` say otherwise. */
const message = (id, text = `text of ${id}`, changes = {}) => ({
  id,
  author: "Juniper",
  color: "#ff7f50",
  badges: [],
  fragments: [{ text }],
  reply: null,
  deleted: false,
  receivedAt: vm.now,
  ...changes,
});
/** A message of 16 runs, the most the host delivers. */
const longest = (id, changes = {}) =>
  message(id, "", {
    fragments: Array.from({ length: 16 }, (_, index) =>
      index % 2 === 0 ? { text: `run ${index} ` } : { emote: `asset:${index}`, alt: "ocGem" },
    ),
    ...changes,
  });
const many = (count, from = 1, make = message) =>
  Array.from({ length: count }, (_, index) => make(`m${from + index}`));

let generation = 0;
/** A value of the subscription: a delta of the current generation. */
const chat = (changes = {}) => ({
  account: "connected",
  channel: "juniper_plays",
  joinState: "joined",
  failure: null,
  favorites: [],
  canSend: true,
  generation,
  reset: false,
  messages: [],
  removed: [],
  skipped: 0,
  ...changes,
});
const delta = (changes) => vm.push(SERVICE, chat(changes));
const ids = (rows = state.rows) => rows.map((row) => (row.gap > 0 ? `gap:${row.gap}` : row.id));

/** A new generation in Interactive mode: an empty joined chat, nothing in flight. */
function fresh(changes = {}) {
  vm.setHost({ mode: "interactive", options: { "passive-lifetime": 30 } });
  generation += 1;
  delta({ reset: true, ...changes });
}

test("it subscribes once and waits for the host's first answer", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    [SERVICE],
  );
  assert.equal(vm.calls.length, 0);
  assert.equal(logic.phase(state), "waiting");
  assert.equal(logic.heading(state), "Twitch");
  assert.equal(logic.statusKey(state), "inactive");
  assert.equal(logic.dotClass(state), "dot");
  assert.equal(logic.selecting(state), false);
  assert.equal(logic.composing(state), false);
  assert.equal(vm.timers.length, 0, "nothing ticks");
});

test("a channel login is trimmed, without its #, lowercased, 1 to 25 ASCII letters, digits and _", () => {
  assert.equal(logic.normalizeChannel("juniper_plays"), "juniper_plays");
  assert.equal(logic.normalizeChannel("  Juniper_Plays \n"), "juniper_plays");
  assert.equal(logic.normalizeChannel("#River_Otter"), "river_otter");
  assert.equal(logic.normalizeChannel(" #MOSS42 "), "moss42");
  assert.equal(logic.normalizeChannel("a"), "a", "one character is enough");
  assert.equal(logic.normalizeChannel("a".repeat(25)), "a".repeat(25));
  assert.equal(logic.normalizeChannel(`#${"B".repeat(25)}`), "b".repeat(25), "the # is not counted");
  for (const invalid of [
    "",
    "   ",
    "#",
    "##moss",
    "# moss",
    "a".repeat(26),
    "juniper plays",
    "juniper-plays",
    "juniper.plays",
    "juniper/plays",
    "@juniper",
    "junipér",
    "ジュニパー",
    "moss\u0000",
  ]) {
    assert.equal(logic.normalizeChannel(invalid), null, JSON.stringify(invalid));
  }
});

test("a delta appends new messages and replaces a known one in place", () => {
  const first = logic.applyDelta([], chat({ messages: many(3) }), vm.now);
  assert.deepEqual(ids(first.rows), ["m1", "m2", "m3"]);
  assert.equal(first.appended, 3);
  const edited = message("m2", "edited", { author: "Moss", color: null });
  const second = logic.applyDelta(first.rows, chat({ messages: [edited, message("m4")] }), vm.now);
  assert.deepEqual(ids(second.rows), ["m1", "m2", "m3", "m4"], "m2 keeps its place");
  assert.equal(second.appended, 1, "a replacement is not a new message");
  assert.equal(second.rows[1].author, "Moss: ");
  assert.equal(second.rows[1].color, null);
  assert.deepEqual(second.rows[1].parts, [{ key: "0", text: "edited", emote: "" }]);
  assert.equal(second.rows[1].key, first.rows[1].key, "the same row of the list");
  assert.deepEqual(ids(first.rows), ["m1", "m2", "m3"], "the previous rows are not changed");
});

test("removed IDs and deleted messages leave the history", () => {
  const { rows } = logic.applyDelta([], chat({ messages: many(4) }), vm.now);
  const removed = logic.applyDelta(rows, chat({ removed: ["m2", "unknown"] }), vm.now);
  assert.deepEqual(ids(removed.rows), ["m1", "m3", "m4"]);
  assert.equal(removed.appended, 0);
  const deleted = logic.applyDelta(
    removed.rows,
    chat({ messages: [message("m3", "", { deleted: true }), message("m9", "", { deleted: true }), message("m5")] }),
    vm.now,
  );
  assert.deepEqual(ids(deleted.rows), ["m1", "m4", "m5"], "a deleted message is never shown");
  assert.equal(deleted.appended, 1);
});

test("a reset replaces the whole history", () => {
  const { rows } = logic.applyDelta([], chat({ messages: many(4) }), vm.now);
  const reset = logic.applyDelta(rows, chat({ reset: true, messages: many(2, 7), skipped: 5 }), vm.now);
  assert.deepEqual(ids(reset.rows), ["m7", "m8"], "and has no mark of messages left out");
  assert.equal(reset.appended, 2);
  assert.deepEqual(ids(logic.applyDelta(rows, chat({ reset: true }), vm.now).rows), []);
});

test("messages the host left out are marked by one row, before those it delivered", () => {
  const { rows } = logic.applyDelta([], chat({ messages: many(2) }), vm.now);
  const sampled = logic.applyDelta(rows, chat({ skipped: 3, messages: [message("m3")] }), vm.now);
  assert.deepEqual(ids(sampled.rows), ["m1", "m2", "gap:3", "m3"]);
  assert.equal(sampled.appended, 4, "what arrived, shown or not");
  const gap = sampled.rows[2];
  assert.equal(gap.id, "");
  assert.equal(gap.nodes, 1);
  assert.equal(gap.cls, "gap");
  assert.equal(logic.gapText(gap.gap), "3 messages not shown");
  assert.equal(logic.gapText(1), "1 message not shown");

  // Two gaps in a row are one.
  const quiet = logic.applyDelta(sampled.rows, chat({ skipped: 2 }), vm.now);
  assert.deepEqual(ids(quiet.rows), ["m1", "m2", "gap:3", "m3", "gap:2"]);
  const merged = logic.applyDelta(quiet.rows, chat({ skipped: 4, messages: [message("m4")] }), vm.now);
  assert.deepEqual(ids(merged.rows), ["m1", "m2", "gap:3", "m3", "gap:6", "m4"]);
  assert.equal(merged.rows[4].key, quiet.rows[4].key, "the same row, with a larger count");
  assert.equal(merged.appended, 5);
  assert.notEqual(merged.rows[2].key, merged.rows[4].key, "each gap has its own key");

  // A removal between two gaps makes them neighbours, not one row: the
  // next delta adds to the last.
  const emptied = logic.applyDelta(merged.rows, chat({ removed: ["m4"], skipped: 1 }), vm.now);
  assert.deepEqual(ids(emptied.rows), ["m1", "m2", "gap:3", "m3", "gap:7"]);
});

test("a gap never opens the history", () => {
  const alone = logic.applyDelta([], chat({ skipped: 9 }), vm.now);
  assert.deepEqual(ids(alone.rows), []);
  assert.equal(alone.appended, 9);
  const leading = logic.applyDelta([], chat({ skipped: 9, messages: many(2) }), vm.now);
  assert.deepEqual(ids(leading.rows), ["m1", "m2"]);
  // The message before a gap was removed.
  const { rows } = logic.applyDelta([], chat({ messages: [message("m1")] }), vm.now);
  const after = logic.applyDelta(rows, chat({ skipped: 2, messages: [message("m2")] }), vm.now);
  assert.deepEqual(ids(logic.applyDelta(after.rows, chat({ removed: ["m1"] }), vm.now).rows), ["m2"]);
});

test("the history keeps the last 200 messages", () => {
  assert.equal(logic.HISTORY_MAX, 200);
  const { rows } = logic.applyDelta([], chat({ reset: true, messages: many(205) }), vm.now);
  assert.equal(rows.length, 200);
  assert.equal(rows[0].id, "m6");
  assert.equal(rows.at(-1).id, "m205");
  // One more: the oldest leaves. Gaps are not counted as messages.
  const next = logic.applyDelta(rows, chat({ skipped: 2, messages: [message("m206")] }), vm.now);
  assert.equal(next.rows.filter((row) => row.gap === 0).length, 200);
  assert.equal(next.rows[0].id, "m7");
  assert.deepEqual(ids(next.rows.slice(-3)), ["m205", "gap:2", "m206"]);
  // A replacement drops nothing.
  const replaced = logic.applyDelta(next.rows, chat({ messages: [message("m100", "edited")] }), vm.now);
  assert.equal(replaced.rows[0].id, "m7");
  assert.equal(replaced.rows.length, next.rows.length);
});

test("the history stays within its scene node budget, the oldest rows leaving first", () => {
  assert.equal(logic.messageRow(message("m1")).nodes, 5, "the row, its text, the author, the icon, one run");
  assert.equal(logic.messageRow(longest("m1")).nodes, 20);
  const replied = longest("m1", { reply: { author: "Moss", text: "first\nsecond" } });
  assert.equal(logic.messageRow(replied).nodes, 21);
  assert.equal(logic.messageRow(replied).context, "Moss: first second", "the context is one line");
  assert.equal(logic.messageRow(replied).cls, "row replied");

  const nodes = (rows) => rows.reduce((sum, row) => sum + row.nodes, 0);
  const full = logic.applyDelta([], chat({ reset: true, messages: many(200, 1, longest) }), vm.now).rows;
  assert.equal(full.length, Math.floor(logic.ROW_NODE_BUDGET / 20));
  assert.equal(full.length, 180);
  assert.ok(nodes(full) <= logic.ROW_NODE_BUDGET);
  assert.equal(full.at(-1).id, "m200", "the newest stay");
  assert.equal(full[0].id, "m21");

  const next = logic.applyDelta(full, chat({ messages: [replied, longest("m201")] }), vm.now).rows;
  assert.ok(nodes(next) <= logic.ROW_NODE_BUDGET);
  assert.equal(next.at(-1).id, "m201");
  // 200 ordinary messages fit whole.
  const plain = logic.applyDelta([], chat({ reset: true, messages: many(200) }), vm.now).rows;
  assert.equal(plain.length, 200);
  assert.ok(nodes(plain) <= logic.ROW_NODE_BUDGET);
});

test("a row carries the author, each run, the emotes with their names and the reply tooltip", () => {
  const row = logic.messageRow(
    message("m1", "", {
      author: "River_Otter",
      fragments: [{ text: "hello " }, { emote: "asset:7", alt: "ocSmile" }, { text: " there" }],
    }),
  );
  assert.equal(row.key, "m:m1");
  assert.equal(row.author, "River_Otter: ");
  assert.deepEqual(row.parts, [
    { key: "0", text: "hello ", emote: "" },
    { key: "1", text: "ocSmile", emote: "asset:7" },
    { key: "2", text: " there", emote: "" },
  ]);
  assert.equal(row.tip, "Reply to River_Otter");
  assert.equal(row.context, "");
  assert.equal(row.cls, "row");
  const long = logic.messageRow(message("m2", "", { author: "é".repeat(200) }));
  assert.ok(new TextEncoder().encode(long.tip).length <= 256, "a tooltip within the label bound");
  assert.equal(logic.cutBytes("héllo", 2), "h");
  assert.equal(logic.oneLine(" a \r\n b\n\nc "), "a b c");
});

test("the first value shows the chat: heading, status, history and composer", () => {
  fresh({ messages: many(3), favorites: ["juniper_plays"] });
  assert.equal(logic.phase(state), "chat");
  assert.equal(logic.heading(state), "#juniper_plays");
  assert.equal(logic.statusKey(state), "connected");
  assert.deepEqual(ids(state.shown), ["m1", "m2", "m3"]);
  assert.equal(state.shown, state.rows, "Interactive mode shows the history itself");
  assert.equal(logic.composing(state), true);
  assert.equal(logic.composerClass(state), "composer");
  assert.equal(logic.composerHint(state), "send-hint");
  assert.equal(logic.emptyKey(state), "no-messages");
  assert.equal(logic.isFavorite(state), true);
  assert.equal(logic.starClass(state), "star on");
  assert.equal(logic.favoriteLabel(state), "Unfavorite #juniper_plays");
  assert.equal(logic.favoriteTip(state), "favorite-remove");
  assert.deepEqual(logic.composers(state), [generation], "the form's key is the generation");
  assert.equal(vm.timers.length, 0, "Interactive mode runs no timer");
});

test("the status says each state of the connection and each failure", () => {
  const shown = (changes) => {
    fresh(changes);
    return [
      logic.statusKey(state),
      logic.dotClass(state),
      logic.failureKey(state),
      vm.host.messages[logic.statusKey(state)],
    ];
  };
  assert.deepEqual(shown({ joinState: "idle", canSend: false }), ["disconnected", "dot", "", "DISCONNECTED"]);
  assert.deepEqual(shown({ joinState: "connecting", canSend: false }), ["connecting", "dot warn", "", "CONNECTING"]);
  assert.equal(logic.composerHint(state), "waiting-hint");
  assert.deepEqual(shown({ joinState: "joined" }), ["connected", "dot ok", "", "CONNECTED"]);
  assert.deepEqual(shown({ joinState: "reconnecting", canSend: false }), [
    "reconnecting",
    "dot warn",
    "",
    "RECONNECTING",
  ]);
  const failed = (failure) => shown({ joinState: "failed", failure, canSend: false });
  assert.deepEqual(failed("channel_unavailable"), [
    "channel-unavailable",
    "dot failed",
    "channel-unavailable",
    "CHANNEL UNAVAILABLE",
  ]);
  assert.deepEqual(failed("connection"), ["connection-error", "dot failed", "connection-error", "CONNECTION ERROR"]);
  assert.deepEqual(failed("provider"), ["twitch-error", "dot failed", "twitch-error", "TWITCH ERROR"]);
  assert.deepEqual(failed("limit"), ["limit", "dot failed", "limit", "Another widget is using Twitch chat"]);
  assert.deepEqual(failed(null), ["twitch-error", "dot failed", "twitch-error", "TWITCH ERROR"]);

  // No channel: the selector in Interactive mode, a sentence in Passive mode.
  assert.deepEqual(shown({ channel: null, joinState: "idle", canSend: false }), [
    "disconnected",
    "dot",
    "",
    "DISCONNECTED",
  ]);
  assert.equal(logic.phase(state), "no-channel");
  assert.equal(logic.heading(state), "Twitch");
  assert.equal(logic.selecting(state), true);
  assert.equal(logic.composing(state), false);
  vm.setHost({ mode: "passive" });
  assert.equal(logic.selecting(state), false);

  // Under the host's account panel the widget says the account's state.
  for (const [account, phase] of [
    ["signed_out", "signed-out"],
    ["expired", "signed-out"],
    ["pending", "pending"],
  ]) {
    assert.deepEqual(shown({ account, channel: null, joinState: "idle", canSend: false }), [
      "inactive",
      "dot",
      "",
      "INACTIVE",
    ]);
    assert.equal(logic.phase(state), phase, account);
    assert.equal(logic.heading(state), "Twitch");
    assert.equal(logic.selecting(state), false, "no selector without the account");
    assert.equal(logic.composing(state), false);
  }
});

test("new messages are counted only while the user scrolled away", () => {
  fresh({ messages: many(3) });
  delta({ messages: [message("m4")] });
  assert.equal(state.unread, 0, "following the end");
  assert.equal(state.following, true);

  logic.stuck(false);
  assert.equal(state.following, false);
  delta({ messages: [message("m5"), message("m6")] });
  assert.equal(state.unread, 2);
  assert.equal(logic.unreadText(state.unread), "2 new messages");
  delta({ messages: [message("m5", "edited")] });
  assert.equal(state.unread, 2, "a replacement is not a new message");
  delta({ removed: ["m1"] });
  assert.equal(state.unread, 2, "nor a removal");
  delta({ skipped: 4, messages: [message("m7")] });
  assert.equal(state.unread, 7, "messages left out are new too");

  logic.stuck(true);
  assert.equal(state.unread, 0, "back at the end");
  assert.equal(state.following, true);

  logic.stuck(false);
  delta({ messages: [message("m8")] });
  assert.equal(logic.unreadText(state.unread), "1 new message");
  logic.latest();
  assert.equal(state.unread, 0, "the button returns to the latest");
  assert.equal(state.following, true);
});

test("the unread count is capped, also when the history is full, and a reset clears it", () => {
  fresh({ messages: many(200) });
  logic.stuck(false);
  delta({ messages: many(5, 201) });
  assert.equal(state.rows.length, 200, "the ring is full");
  assert.equal(state.unread, 5, "and the new messages still count");
  delta({ skipped: 500, messages: many(5, 206) });
  assert.equal(state.unread, logic.HISTORY_MAX);
  delta({ reset: true, messages: many(3) });
  assert.equal(state.unread, 0);
  assert.equal(state.following, true, "a reset shows the end");
});

test("another channel or account clears the history, the reply, the draft and the unread count", () => {
  fresh({ messages: many(3) });
  logic.replyTo("m2");
  logic.drafted("half a sentence");
  logic.stuck(false);
  delta({ messages: [message("m4")] });
  logic.keyed("Enter");
  logic.toggleSelector();
  logic.channelTyped("river");
  assert.deepEqual(
    [state.reply?.id, state.draft, state.unread, state.sending, state.selecting, state.channelDraft],
    ["m2", "half a sentence", 1, true, true, "river"],
  );

  // The host says so with a new generation, here without `reset`.
  generation += 1;
  delta({ channel: "river_otter", messages: [message("n1")] });
  assert.deepEqual(ids(), ["n1"], "nothing of the previous channel");
  assert.equal(logic.heading(state), "#river_otter");
  assert.equal(state.reply, null);
  assert.equal(state.draft, "");
  assert.equal(state.unread, 0);
  assert.equal(state.following, true);
  assert.equal(state.sending, false);
  assert.equal(state.sendError, "");
  assert.equal(state.notice, "");
  assert.equal(state.selecting, false);
  assert.equal(state.channelDraft, "");
  assert.deepEqual(logic.composers(state), [generation], "a new form, with an empty field");
  assert.equal(vm.timers.length, 0, "the wait for the send's answer is over");

  // The same generation keeps them.
  logic.replyTo("n1");
  logic.drafted("kept");
  delta({ messages: [message("n2")] });
  assert.equal(state.reply?.id, "n1");
  assert.equal(state.draft, "kept");
});

test("the reply target follows its message and goes with it", () => {
  fresh({ messages: [message("m1", "hi", { author: "River_Otter" }), message("m2")] });
  logic.replyTo("unknown");
  assert.equal(state.reply, null);
  logic.replyTo("m1");
  assert.deepEqual(state.reply, { id: "m1", author: "River_Otter" });
  assert.equal(logic.replyingTo(state), "Replying to River_Otter");
  assert.equal(logic.replyTarget(state), "m1");
  delta({ messages: [message("m3")] });
  assert.equal(logic.replyTarget(state), "m1", "kept while its message is in the history");
  delta({ removed: ["m1"] });
  assert.equal(state.reply, null, "removed by a moderator");
  assert.equal(logic.replyTarget(state), null);
  assert.equal(logic.replyingTo(state), "");

  logic.replyTo("m2");
  delta({ messages: [message("m2", "", { deleted: true })] });
  assert.equal(state.reply, null, "deleted");

  logic.replyTo("m3");
  delta({ reset: true, messages: [message("m4")] });
  assert.equal(state.reply, null, "not in the new list");

  logic.replyTo("m4");
  delta({ messages: many(200, 5) });
  assert.equal(state.reply, null, "too old for the history");

  logic.replyTo("m204");
  logic.cancelReply();
  assert.equal(state.reply, null);
});

test("the fade starts at two thirds of the lifetime and ends with it", () => {
  assert.equal(logic.FADE_LEVELS, 32);
  assert.equal(logic.fadeLevel(0, 30_000), 0);
  assert.equal(logic.fadeLevel(20_000, 30_000), 0, "opaque until two thirds");
  assert.equal(logic.fadeLevel(20_001, 30_000), 1);
  assert.equal(logic.fadeLevel(22_500, 30_000), 8);
  assert.equal(logic.fadeLevel(25_000, 30_000), 16, "half-way, half opaque");
  assert.equal(logic.fadeLevel(29_999, 30_000), 32);
  assert.equal(logic.fadeLevel(30_000, 30_000), 32);
  assert.equal(logic.fadeLevel(90_000, 30_000), 32, "never beyond the last level");
  assert.equal(logic.fadeLevel(-5_000, 30_000), 0, "a message of the future is opaque");
  assert.equal(logic.fadeLevel(4_000, 6_000), 0);
  assert.equal(logic.fadeLevel(5_000, 6_000), 16);
  let previous = 0;
  for (let age = 0; age <= 120_000; age += 250) {
    const level = logic.fadeLevel(age, 120_000);
    assert.ok(level >= previous && level - previous <= 1, `one level at a time at ${age} ms`);
    previous = level;
  }
});

test("the fade's step is the longest transition of the style within a sixteenth of the fade", () => {
  assert.deepEqual(logic.FADE_STEPS_MS, [100, 200, 400, 800, 1600]);
  assert.equal(logic.fadeStepMs(5_000), 100);
  assert.equal(logic.fadeStepMs(9_000), 100);
  assert.equal(logic.fadeStepMs(10_000), 200);
  assert.equal(logic.fadeStepMs(30_000), 400);
  assert.equal(logic.fadeStepMs(60_000), 800);
  assert.equal(logic.fadeStepMs(120_000), 1600);
  const style = read("style.ocss");
  for (const step of logic.FADE_STEPS_MS) {
    assert.ok(style.includes(`.ease-${step} {\n  transition: opacity ${step}ms linear;`), `.ease-${step}`);
  }
  for (let level = 1; level <= logic.FADE_LEVELS; level += 1) {
    const opacity = 1 - level / logic.FADE_LEVELS;
    assert.ok(style.includes(`.fade-${level} {\n  opacity: ${opacity};`), `.fade-${level}`);
  }
});

test("Passive mode shows the last 12 messages younger than the lifetime", () => {
  assert.equal(logic.PASSIVE_MAX, 12);
  const now = vm.now;
  const aged = (id, age) => logic.messageRow(message(id, id, { receivedAt: now - age }));
  const rows = [
    ...Array.from({ length: 6 }, (_, index) => aged(`old${index}`, 12_000)),
    logic.gapRow(4, now - 11_000),
    ...Array.from({ length: 11 }, (_, index) => aged(`new${index}`, 1_000)),
  ];
  const shown = logic.passiveRows(rows, now, 30_000);
  assert.equal(shown.length, 12);
  assert.deepEqual(
    ids(shown),
    ["old5", ...Array.from({ length: 11 }, (_, index) => `new${index}`)],
    "the last twelve, without the mark of messages left out",
  );
  assert.ok(shown.every((row, index) => row === rows.filter((each) => each.gap === 0).slice(-12)[index]));

  // Expired messages leave; they are still counted among the last twelve.
  const mixed = [aged("a", 31_000), aged("b", 30_000), aged("c", 29_999), aged("d", 5_000)];
  assert.deepEqual(ids(logic.passiveRows(mixed, now, 30_000)), ["c", "d"]);
  const stale = [aged("recent", 1_000), ...Array.from({ length: 12 }, (_, index) => aged(`s${index}`, 40_000))];
  assert.deepEqual(ids(logic.passiveRows(stale, now, 30_000)), [], "an older message does not come back");
  assert.deepEqual(ids(logic.passiveRows([], now, 30_000)), []);
});

test("a Passive row is opaque until two thirds, then aims at its opacity one step later", () => {
  const now = vm.now;
  const cls = (age, lifetime = 30_000) => {
    const row = logic.messageRow(message("m1", "hi", { receivedAt: now - age }));
    return logic.passiveRows([row], now, lifetime)[0]?.cls;
  };
  assert.equal(cls(0), "row");
  assert.equal(cls(19_600), "row", "one step before two thirds: still its own class");
  assert.equal(cls(20_000), "row fade-1 ease-400");
  assert.equal(cls(24_600), "row fade-16 ease-400");
  assert.equal(cls(29_600), "row fade-32 ease-400", "transparent when it leaves");
  assert.equal(cls(29_999), "row fade-32 ease-400");
  assert.equal(cls(30_000), undefined);
  assert.equal(cls(3_000, 5_000), "row");
  assert.equal(cls(4_000, 5_000), "row fade-15 ease-100");
  assert.equal(cls(100_000, 120_000), "row fade-17 ease-1600");
  const replied = logic.messageRow(
    message("m1", "hi", { receivedAt: now - 25_000, reply: { author: "Moss", text: "hey" } }),
  );
  assert.equal(logic.passiveRows([replied], now, 30_000)[0].cls, "row replied fade-17 ease-400");
});

test("the next change of a Passive row: the start of the first fade, then one step", () => {
  const now = vm.now;
  const aged = (age) => logic.messageRow(message("m", "hi", { receivedAt: now - age }));
  assert.equal(logic.nextFadeMs([], now, 30_000), null, "nothing shows: nothing to wait for");
  assert.equal(logic.nextFadeMs([aged(1_000)], now, 30_000), 18_600);
  assert.equal(logic.nextFadeMs([aged(1_000), aged(9_000)], now, 30_000), 10_600, "the oldest decides");
  assert.equal(logic.nextFadeMs([aged(19_600)], now, 30_000), 400);
  assert.equal(logic.nextFadeMs([aged(25_000), aged(0)], now, 30_000), 400, "one step while a message fades");
  assert.equal(logic.nextFadeMs([aged(4_900)], now, 5_000), 100, "never under the host's shortest timer");
  assert.equal(logic.nextFadeMs([aged(0)], now, 120_000), 78_400);
});

test("the lifetime is the menu row's, within 5 to 120 s", () => {
  const lifetime = (value) => {
    vm.setHost({ options: value === undefined ? {} : { "passive-lifetime": value } });
    return logic.lifetimeMs();
  };
  assert.equal(lifetime(undefined), 30_000);
  assert.equal(lifetime(5), 5_000);
  assert.equal(lifetime(120), 120_000);
  assert.equal(lifetime(1), 5_000);
  assert.equal(lifetime(900), 120_000);
  assert.equal(lifetime("60"), 30_000, "not a number");
  assert.equal(lifetime(Number.NaN), 30_000);
  vm.setHost({ options: { "passive-lifetime": 30 } });
});

test("one timer drives the fade and stops once nothing shows", () => {
  fresh({
    messages: [
      message("m1", "older", { receivedAt: vm.now - 9_000 }),
      message("m2", "newer", { receivedAt: vm.now - 1_000 }),
    ],
  });
  assert.equal(vm.timers.length, 0);
  vm.setHost({ mode: "passive" });
  assert.deepEqual(ids(state.shown), ["m1", "m2"]);
  assert.deepEqual(
    state.shown.map((row) => row.cls),
    ["row", "row"],
  );
  assert.equal(logic.composerClass(state), "composer hidden");
  assert.equal(logic.emptyKey(state), "no-recent");
  assert.equal(vm.timers.length, 1, "one timer");
  assert.equal(vm.timers[0].repeat, false);
  assert.equal(vm.timers[0].dueAt - vm.now, 10_600, "asleep until the first fade is one step away");

  assert.equal(vm.advance(10_599), 0);
  assert.equal(vm.advance(1), 1);
  assert.equal(state.shown[0].cls, "row", "m1 is 19.6 s old");
  assert.equal(vm.advance(400), 1);
  assert.deepEqual(
    state.shown.map((row) => row.cls),
    ["row fade-1 ease-400", "row"],
  );
  assert.equal(vm.timers.length, 1);
  vm.advance(4_800);
  assert.deepEqual(
    state.shown.map((row) => row.cls),
    ["row fade-17 ease-400", "row"],
    "m1 half-way",
  );
  vm.advance(5_200);
  assert.deepEqual(ids(state.shown), ["m2"], "m1 expired at 30 s");
  assert.equal(state.rows.length, 2, "the history keeps it for Interactive mode");
  assert.equal(vm.timers.length, 1, "m2 still shows");

  // A message arriving meanwhile shows at once, with the same single timer.
  delta({ messages: [message("m3", "late")] });
  assert.deepEqual(ids(state.shown), ["m2", "m3"]);
  assert.equal(vm.timers.length, 1);

  const ticks = vm.advance(30_000);
  assert.deepEqual(ids(state.shown), [], "everything expired");
  assert.ok(ticks > 0 && ticks <= 2 * (10_000 / 400) + 4, `${ticks} ticks for two fades`);
  assert.equal(vm.timers.length, 0, "nothing ticks any more");
  assert.equal(vm.advance(600_000), 0);

  // Interactive mode shows the whole history again, without a timer.
  vm.setHost({ mode: "interactive" });
  assert.deepEqual(ids(state.shown), ["m1", "m2", "m3"]);
  assert.ok(state.shown.every((row) => row.cls === "row"));
  assert.equal(vm.timers.length, 0);
});

test("the fade follows the lifetime row and the mode, and runs nothing in Interactive mode", () => {
  fresh({ messages: [message("m1", "hi", { receivedAt: vm.now - 8_000 })] });
  vm.setHost({ mode: "passive" });
  assert.equal(state.shown[0].cls, "row");
  vm.setHost({ options: { "passive-lifetime": 10 } });
  assert.equal(state.shown[0].cls, "row fade-15 ease-200", "8 s of a 10 s lifetime");
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt - vm.now, 200);
  vm.setHost({ options: { "passive-lifetime": 5 } });
  assert.deepEqual(ids(state.shown), [], "older than the new lifetime");
  assert.equal(vm.timers.length, 0);
  vm.setHost({ options: { "passive-lifetime": 120 } });
  assert.equal(state.shown[0].cls, "row");
  assert.equal(vm.timers.length, 1);
  vm.setHost({ mode: "interactive" });
  assert.equal(vm.timers.length, 0);
  // Shown again after a pause, the rows are aged at once.
  vm.setHost({ mode: "passive", options: { "passive-lifetime": 30 } });
  vm.setHost({ visible: false });
  vm.advance(15_000);
  vm.setHost({ visible: true });
  assert.equal(state.shown[0].cls, "row fade-11 ease-400", "23 s old");
  vm.advance(60_000);
  assert.equal(vm.timers.length, 0);
});

test("the row tooltips follow the interface language", () => {
  fresh({ messages: [message("m1", "hi", { author: "Moss" })] });
  assert.equal(state.rows[0].tip, "Reply to Moss");
  vm.setHost({ locale: "fr", messages: messages("fr") });
  assert.equal(state.rows[0].tip, "Répondre à Moss");
  assert.equal(state.shown[0].tip, "Répondre à Moss");
  assert.equal(logic.unreadText(1), "1 nouveau message");
  assert.equal(logic.unreadText(3), "3 nouveaux messages");
  assert.equal(logic.gapText(1), "1 message non affiché");
  assert.equal(logic.gapText(12), "12 messages non affichés");
  vm.setHost({ locale: "en", messages: messages("en") });
  assert.equal(state.rows[0].tip, "Reply to Moss");
});

test("a message is sent by Enter or the button, one at a time, and the draft goes once accepted", () => {
  fresh({ messages: many(2) });
  assert.equal(logic.canSubmit(state), false, "nothing typed");
  logic.drafted("   ");
  assert.equal(logic.canSubmit(state), false, "only spaces");
  logic.drafted("good evening");
  assert.equal(logic.canSubmit(state), true);
  assert.equal(logic.sendMark(state), "");

  logic.keyed("a");
  assert.equal(state.sending, false, "only Enter sends");
  logic.keyed("Enter");
  assert.equal(state.sending, true);
  assert.equal(logic.sendMark(state), "sending");
  assert.equal(logic.sendMarkClass(state), "pending");
  assert.equal(logic.canSubmit(state), false, "one send at a time");
  assert.equal(vm.timers.length, 1, "the wait for OverCrow's answer");
  const due = vm.timers[0].dueAt;
  vm.advance(1_000);
  logic.sendPressed();
  logic.keyed("Enter");
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, due, "a second gesture changes nothing");
  assert.equal(vm.calls.length, 0, "the logic sends nothing itself: the form is OverCrow's");
  assert.deepEqual(ids(), ["m1", "m2"], "no local echo in the history");

  logic.submitted("accepted", undefined);
  assert.equal(state.sending, false);
  assert.equal(state.draft, "", "OverCrow emptied its field");
  assert.equal(state.sendError, "");
  assert.equal(logic.sendMark(state), "");
  assert.equal(vm.timers.length, 0, "no timer left");

  // The button, with a reply target: both go with the accepted message.
  logic.replyTo("m1");
  logic.drafted("and you?");
  logic.sendPressed();
  assert.equal(state.sending, true);
  assert.equal(logic.replyTarget(state), "m1", "the target stays on the form while it is sent");
  logic.submitted("accepted", undefined);
  assert.equal(state.reply, null);
  assert.equal(state.draft, "");
});

test("a refused message keeps its draft and its reply target, and says why", () => {
  const refusal = (outcome, code) => {
    fresh({ messages: many(2) });
    logic.replyTo("m2");
    logic.drafted("a question");
    logic.sendPressed();
    logic.submitted(outcome, code === undefined ? undefined : { code });
    assert.equal(state.sending, false, code);
    assert.equal(state.draft, "a question", "the draft is kept");
    assert.equal(state.reply?.id, "m2", "and the reply target");
    assert.equal(logic.sendMark(state), "not-sent");
    assert.equal(logic.sendMarkClass(state), "unsent");
    assert.equal(logic.canSubmit(state), true, "it can be sent again");
    assert.equal(vm.timers.length, 0);
    return vm.host.messages[state.sendError];
  };
  assert.equal(refusal("rejected", "busy"), "Too many messages. Wait a moment, then try again.");
  assert.equal(refusal("rejected", "permission_denied"), "This chat does not accept your messages right now.");
  for (const code of ["unavailable", "not_connected", "stale_context", "invalid_request", "timeout", "gesture_required"]) {
    assert.equal(refusal("rejected", code), "Message was not accepted. Try again.", code);
  }
  assert.equal(refusal("rejected", undefined), "Message was not accepted. Try again.");
  assert.equal(refusal("cancelled", undefined), "Message was not sent. Try again.");

  // The next send clears the message, and an accepted one the draft.
  logic.keyed("Enter");
  assert.equal(state.sendError, "");
  assert.equal(logic.sendMark(state), "sending");
  logic.submitted("accepted", undefined);
  assert.equal(state.draft, "");
  assert.equal(logic.sendMark(state), "");
});

test("Enter on an empty field says nothing", () => {
  fresh();
  logic.keyed("Enter");
  assert.equal(state.sending, false);
  assert.equal(vm.timers.length, 0);
  // OverCrow refuses the empty message; nothing was awaited.
  logic.submitted("rejected", { code: "invalid_request" });
  assert.equal(state.sendError, "");
  assert.equal(logic.sendMark(state), "");
  logic.drafted("  ");
  logic.keyed("Enter");
  logic.submitted("rejected", { code: "invalid_request" });
  assert.equal(state.sendError, "", "nor on spaces");
});

test("nothing is sent while the chat cannot take a message", () => {
  fresh({ joinState: "connecting", canSend: false });
  logic.drafted("too early");
  assert.equal(logic.canSubmit(state), false);
  logic.keyed("Enter");
  logic.sendPressed();
  assert.equal(state.sending, false);
  assert.equal(vm.timers.length, 0);
  delta({ joinState: "joined", canSend: true });
  assert.equal(logic.canSubmit(state), true, "the draft is still there once joined");
  vm.setHost({ mode: "passive" });
  assert.equal(logic.canSubmit(state), false, "never in Passive mode");
  logic.keyed("Enter");
  assert.equal(state.sending, false);
  vm.setHost({ mode: "interactive" });
  assert.equal(state.draft, "too early", "the draft outlives Passive mode");
  assert.equal(logic.canSubmit(state), true);
});

test("should OverCrow give no answer, the composer comes back after 40 s", () => {
  fresh();
  logic.drafted("anyone?");
  logic.sendPressed();
  vm.advance(logic.ANSWER_MS - 1);
  assert.equal(state.sending, true);
  vm.advance(1);
  assert.equal(state.sending, false);
  assert.equal(state.sendError, "error-not-accepted");
  assert.equal(state.draft, "anyone?");
  assert.equal(logic.canSubmit(state), true);
  assert.equal(vm.timers.length, 0);
});

test("joining a channel calls the host with the normalized login", async () => {
  fresh({ channel: null, joinState: "idle", canSend: false, favorites: ["moss_and_fern"] });
  const calls = vm.calls.length;
  assert.equal(logic.canJoin(state), false);
  logic.join();
  logic.channelTyped("not a channel");
  assert.equal(logic.canJoin(state), false);
  logic.join();
  assert.equal(vm.calls.length, calls, "an invalid name calls nothing");

  logic.channelTyped("  #Juniper_Plays ");
  assert.equal(logic.canJoin(state), true);
  logic.join();
  assert.equal(vm.calls.length, calls + 1);
  assert.equal(vm.lastCall().service, "twitch.chat.join");
  assert.deepEqual(vm.lastCall().params, { channel: "juniper_plays" });
  vm.lastCall().resolve(null);
  await flush();
  assert.equal(
    state.channelDraft,
    "  #Juniper_Plays ",
    "the field keeps its text, so the logic keeps it too",
  );
  assert.equal(logic.canJoin(state), true);
  assert.equal(state.notice, "");
  assert.equal(state.channel, null, "the channel is the host's to announce");
  // The host publishes the channel: the selector leaves, and the next one
  // is a new, empty field.
  const selector = state.selector;
  vm.push(SERVICE, chat({ generation: 2, channel: "juniper_plays" }));
  assert.equal(logic.selecting(state), false);
  assert.equal(state.channelDraft, "");
  assert.notEqual(state.selector, selector);
  assert.deepEqual(logic.selectors(state), [state.selector]);

  logic.joinFavorite("moss_and_fern");
  assert.deepEqual(vm.lastCall("twitch.chat.join").params, { channel: "moss_and_fern" });
  vm.lastCall().resolve(null);
  await flush();
});

test("changing channel keeps the chat until the host joined another", async () => {
  fresh({ messages: many(2) });
  logic.toggleSelector();
  assert.equal(logic.selecting(state), true);
  assert.equal(logic.phase(state), "chat", "the chat stays under the selector");
  logic.channelTyped("river_otter");
  logic.toggleSelector();
  assert.equal(logic.selecting(state), false);
  assert.equal(state.channelDraft, "", "closing the selector forgets what was typed");
  logic.toggleSelector();
  vm.setHost({ mode: "passive" });
  assert.equal(logic.selecting(state), false, "no selector in Passive mode");
  vm.setHost({ mode: "interactive" });
  logic.channelTyped("river_otter");
  logic.join();
  vm.lastCall("twitch.chat.join").resolve(null);
  await flush();
  assert.equal(state.selecting, false, "the selector closes once the host took the channel");
  assert.deepEqual(ids(), ["m1", "m2"]);
});

test("each refusal of a channel or favorite change has its message", async () => {
  const refused = async (act, service, code) => {
    fresh({ favorites: ["moss_and_fern"] });
    logic.toggleSelector();
    logic.channelTyped("river_otter");
    act();
    assert.equal(vm.lastCall().service, service);
    vm.lastCall().reject(code);
    await flush();
    return state.notice === "" ? "" : vm.host.messages[state.notice];
  };
  for (const [act, service] of [
    [logic.join, "twitch.chat.join"],
    [() => logic.joinFavorite("moss_and_fern"), "twitch.chat.join"],
    [logic.toggleFavorite, "twitch.chat.favorite"],
    [logic.leave, "twitch.chat.leave"],
  ]) {
    assert.equal(await refused(act, service, "busy"), "Twitch is busy. Try again.", service);
    assert.equal(await refused(act, service, "unavailable"), "Could not save Twitch widget settings.", service);
    assert.equal(await refused(act, service, "quota_exceeded"), "Favorite channel limit reached.", service);
    assert.equal(await refused(act, service, "timeout"), "Could not save Twitch widget settings.", service);
    // The account or the channel changed meanwhile: the state says so.
    assert.equal(await refused(act, service, "not_connected"), "", service);
    assert.equal(await refused(act, service, "stale_context"), "", service);
  }
  assert.equal(logic.noticeKey(null), "error-settings");

  // A refused join keeps the selector and what was typed; the next
  // gesture clears the message.
  await refused(logic.join, "twitch.chat.join", "busy");
  assert.equal(state.selecting, true);
  assert.equal(state.channelDraft, "river_otter");
  logic.join();
  assert.equal(state.notice, "");
  vm.lastCall().resolve(null);
  await flush();
});

test("the star adds the channel to the favorites or removes it, up to the host's limit", async () => {
  fresh();
  assert.equal(logic.isFavorite(state), false);
  assert.equal(logic.starClass(state), "star");
  assert.equal(logic.favoriteLabel(state), "Favorite #juniper_plays");
  assert.equal(logic.favoriteTip(state), "favorite-add");
  logic.toggleFavorite();
  assert.equal(vm.lastCall().service, "twitch.chat.favorite");
  assert.deepEqual(vm.lastCall().params, { channel: "juniper_plays", favorite: true });
  vm.lastCall().resolve(null);
  await flush();
  assert.equal(logic.isFavorite(state), false, "until the host says so");

  delta({ favorites: ["moss_and_fern", "juniper_plays"] });
  assert.equal(logic.isFavorite(state), true);
  logic.toggleFavorite();
  assert.deepEqual(vm.lastCall().params, { channel: "juniper_plays", favorite: false });
  vm.lastCall().resolve(null);
  await flush();

  // Twenty favorites: no room for another, but one of them can leave.
  const twenty = Array.from({ length: 20 }, (_, index) => `channel_${index}`);
  delta({ favorites: twenty });
  assert.equal(logic.favoriteFull(state), true);
  assert.equal(logic.favoriteTip(state), "favorite-limit");
  const calls = vm.calls.length;
  logic.toggleFavorite();
  assert.equal(vm.calls.length, calls, "nothing is asked");
  delta({ favorites: [...twenty.slice(1), "juniper_plays"] });
  assert.equal(logic.favoriteFull(state), false);
  logic.toggleFavorite();
  assert.deepEqual(vm.lastCall().params, { channel: "juniper_plays", favorite: false });
  vm.lastCall().resolve(null);
  await flush();

  // Without a channel there is nothing to mark.
  fresh({ channel: null, joinState: "idle", canSend: false });
  const before = vm.calls.length;
  logic.toggleFavorite();
  assert.equal(vm.calls.length, before);
});

test("leaving asks the host to forget the channel", async () => {
  fresh({ messages: many(2) });
  logic.leave();
  assert.equal(vm.lastCall().service, "twitch.chat.leave");
  assert.deepEqual(vm.lastCall().params, {});
  vm.lastCall().resolve(null);
  await flush();
  assert.equal(state.notice, "");
  assert.equal(state.channel, "juniper_plays", "until the host says so");
  generation += 1;
  delta({ channel: null, joinState: "idle", canSend: false, reset: true });
  assert.equal(logic.phase(state), "no-channel");
  assert.deepEqual(ids(), []);
});

test("a failed source says so and the widget asks again 5 s later", () => {
  fresh({ messages: many(2) });
  logic.drafted("kept");
  assert.equal(vm.fail(SERVICE, "unavailable"), 1);
  assert.equal(logic.phase(state), "unavailable");
  assert.equal(logic.heading(state), "Twitch");
  assert.equal(logic.statusKey(state), "inactive");
  assert.equal(logic.composing(state), false);
  assert.equal(logic.selecting(state), false);
  assert.equal(live().length, 0);
  assert.equal(vm.timers.length, 1);
  vm.advance(logic.RETRY_MS - 1);
  assert.equal(live().length, 0);
  vm.advance(1);
  assert.equal(live().length, 1, "one new subscription");
  assert.equal(logic.phase(state), "unavailable", "until the host answers");
  assert.equal(vm.timers.length, 0);
  delta({ reset: true, messages: many(3) });
  assert.equal(logic.phase(state), "chat");
  assert.deepEqual(ids(), ["m1", "m2", "m3"]);
  assert.equal(state.draft, "kept", "the same generation: the form and its draft stayed");
  assert.equal(logic.composing(state), true);

  // It fails again: one retry at a time.
  vm.fail(SERVICE, "unavailable");
  assert.equal(vm.timers.length, 1);
  vm.advance(logic.RETRY_MS);
  assert.equal(live().length, 1);
  delta({ reset: true });
});

/** Every message key the view and the logic can ask for. */
function usedKeys() {
  const keys = new Set();
  const literal = /\bt\(\s*"([^"]+)"/g;
  for (const source of [read("view.ocml"), read("logic.ts")]) {
    for (const match of source.matchAll(literal)) {
      keys.add(match[1]);
    }
  }
  // Keys the logic computes: every status, tooltip, hint, mark and error.
  const view = (changes) => ({ ...state, ...changes });
  for (const joinState of ["idle", "connecting", "joined", "reconnecting", "failed"]) {
    for (const failure of [null, "channel_unavailable", "connection", "provider", "limit"]) {
      keys.add(logic.statusKey(view({ joinState, failure })));
    }
  }
  keys.add(logic.statusKey(view({ account: "signed_out" })));
  const twenty = Array.from({ length: 20 }, (_, index) => `channel_${index}`);
  for (const favorites of [[], ["juniper_plays"], twenty]) {
    keys.add(logic.favoriteTip(view({ channel: "juniper_plays", favorites })));
  }
  for (const interactive of [true, false]) {
    keys.add(logic.emptyKey(view({ interactive })));
  }
  for (const canSend of [true, false]) {
    keys.add(logic.composerHint(view({ canSend })));
  }
  keys.add(logic.sendMark(view({ sending: true })));
  keys.add(logic.sendMark(view({ sending: false, sendError: "error-not-accepted" })));
  const codes = [
    null,
    "invalid_request",
    "permission_denied",
    "gesture_required",
    "not_connected",
    "stale_context",
    "unavailable",
    "busy",
    "cancelled",
    "quota_exceeded",
    "unsupported",
    "timeout",
  ];
  for (const code of codes) {
    keys.add(logic.sendErrorKey(code));
    keys.add(logic.noticeKey(code));
  }
  keys.delete("");
  return [...keys].sort();
}

test("every message the view or the logic uses exists in English and French", () => {
  fresh();
  const [en, fr] = [messages("en"), messages("fr")];
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort(), "the same keys in both files");
  const used = usedKeys();
  assert.ok(used.length >= 45, `${used.length} keys found`);
  for (const key of used) {
    assert.equal(typeof en[key], "string", `en: ${key}`);
    assert.equal(typeof fr[key], "string", `fr: ${key}`);
    assert.ok(en[key].trim() !== "" && fr[key].trim() !== "", key);
  }
  // A message with a placeholder has the same one in both languages.
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(en[key]), placeholders(fr[key]), key);
  }
});
