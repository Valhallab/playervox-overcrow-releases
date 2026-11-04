// Drives the widget one VM turn at a time, as the host does: one answer, one
// timer or one user action per turn, its promise continuations drained
// before the next. Run by engine-turns.test.mjs in a child process, one game
// per process (the runtime is installed once):
//   node [--jitless] [--expose-gc] tests/turn-driver.mjs MODE COUNT
// It prints one JSON object. Modes:
// - `timing`: the player's path on a game of COUNT achievements, the time
//   of each turn (garbage collection taken out) and the list items the
//   widget handled in it;
// - `check`: the same path, then actions while a job runs (tick, option,
//   language, a new read), with what the view showed after each turn and
//   what a computation in one go gives;
// - `memory`: the heap with the game read, then with the search's keys;
// - `same-turn`: whether each action's result shows in its own turn.
import { readFileSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, MANIFEST_BOUNDS, achievementsOf, fakeSteam } from "./steam-fake.mjs";

const [mode = "timing", countText = "5000"] = process.argv.slice(2);
const count = Number(countText);
const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const FR = JSON.parse(readFileSync(new URL("../locales/fr.json", import.meta.url), "utf8"));
const vm = installRuntime({
  now: Date.UTC(2026, 0, 1, 12),
  host: { messages: EN, grants: ["storage", "network", "account:steam"], mode: "interactive" },
  accounts: { steam: "signed_out" },
});
const steam = fakeSteam();
steam.bounds = MANIFEST_BOUNDS;
steam.storage.set("profile", { steamid: ID, input: ID });
const APPID = 100;
// One in four unlocked, the newest last; beyond 5,000 the schema exceeds
// its bound and the names come from the player's achievements.
const unlocked = Object.fromEntries(Array.from({ length: count }, (_, n) => n).filter((n) => n % 4 === 0).map((n) => [`ACH_${n}`, 1767000000 + n]));
steam.games[APPID] = { name: "Endless Archive", schema: achievementsOf(count), unlocked };
steam.recent = [APPID];
steam.playing = APPID;
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

// Garbage collection pauses, to take out of the turns they fall in.
const pauses = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) pauses.push([entry.startTime, entry.startTime + entry.duration]);
}).observe({ entryTypes: ["gc"] });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const work = () => (typeof logic.workDone === "function" ? logic.workDone() : 0);

const turns = [];
let phase = "start";
/** What the view shows of the achievements, as plain IDs. */
function shown() {
  const ids = (list) => list.map((a) => a.id);
  const lists = state.lists;
  return JSON.stringify({
    game: state.game === null ? null : [state.game.unlocked, state.game.total, state.game.known],
    picking: state.picking,
    latest: lists.latest?.id ?? null,
    tracked: ids(lists.tracked),
    recent: ids(lists.recent),
    missing: ids(lists.missing),
    pick: ids(lists.pick),
    pickLeft: state.pickLeft,
    pickCapped: state.pickCapped,
  });
}
const views = [];
/** One VM turn: `fn` and the continuations it starts. */
async function turn(label, fn) {
  await flush();
  const before = work();
  const start = performance.now();
  fn();
  await flush();
  const end = performance.now();
  // The observer reports a pause a little later.
  await flush();
  const gc = pauses.filter(([from, to]) => to > start && from < end).reduce((sum, [from, to]) => sum + Math.min(to, end) - Math.max(from, start), 0);
  turns.push({ phase, label, ms: end - start - gc, gc, work: work() - before });
  const view = shown();
  if (views.at(-1)?.view !== view) views.push({ phase, view });
}
function answer(call) {
  const service = call.service;
  if (service === "storage.get") return turn(service, () => call.resolve(steam.storage.get(call.params.key) ?? null));
  if (service === "storage.set") {
    const size = Buffer.byteLength(JSON.stringify(call.params.value));
    if (size > 64 * 1024) return turn(service, () => call.reject("quota_exceeded"));
    steam.storage.set(call.params.key, structuredClone(call.params.value));
    return turn(service, () => call.resolve(null));
  }
  if (service === "storage.remove") {
    steam.storage.delete(call.params.key);
    return turn(service, () => call.resolve(null));
  }
  if (service === "http.fetch") {
    // The answer is built before the turn: the host gives it ready.
    const reply = steam.handle(call.params.url);
    const route = call.params.url.replace(/\?.*/, "").split("/").slice(-3, -2).join("");
    return turn(`http ${route}`, () => (reply.error ? call.reject(reply.error) : call.resolve(reply.value)));
  }
  return turn(service, () => call.reject("unavailable"));
}
/** The next turn: an answer first, else the next timer within `until`. */
async function step(until = vm.now) {
  const open = vm.calls.find((call) => !call.settled);
  if (open !== undefined) {
    await answer(open);
    return true;
  }
  const next = vm.timers[0];
  if (next === undefined || next.dueAt > until) return false;
  await turn(`timer ${next.intervalMs}`, () => vm.advance(next.dueAt - vm.now));
  return true;
}
async function run(ms) {
  const until = vm.now + ms;
  while (await step(until));
  vm.advance(until - vm.now);
  await flush();
}
const act = (label, fn) => turn(label, fn);
const setOptions = (changes) => act(`options ${JSON.stringify(changes)}`, () => vm.setHost({ options: { ...vm.host.options, ...changes } }));
const firstMissing = () => logic.pickList(state).find((a) => !a.achieved && !logic.isTracked(a, state));

/** The view's lists as one computation over the whole list gives them. */
function reference() {
  const all = logic.achievements();
  const order = vm.host.options.order ?? "easiest";
  const nameKey = (a) => logic.sortKey(logic.achName(a));
  const stable = (list, before) => list.map((a, index) => [a, index]).sort(([a, i], [b, j]) => (before(a, b) ? -1 : before(b, a) ? 1 : i - j)).map(([a]) => a);
  const missingBefore = (a, b) => {
    if (order === "name") return nameKey(a) < nameKey(b);
    if ((a.rarity < 0) !== (b.rarity < 0)) return b.rarity < 0;
    return order === "rarest" ? a.rarity < b.rarity : a.rarity > b.rarity;
  };
  const recent = stable(all.filter((a) => a.achieved), (a, b) => a.at > b.at).slice(0, 9);
  const trackedIds = state.tracked;
  const tracked = trackedIds.flatMap((id) => all.find((a) => a.id === id) ?? []);
  return {
    unlocked: all.filter((a) => a.achieved).length,
    total: all.length,
    latest: recent[0]?.id ?? null,
    tracked: [...tracked.filter((a) => !a.achieved), ...tracked.filter((a) => a.achieved)].map((a) => a.id),
    recent: recent.map((a) => a.id),
    missing: stable(all.filter((a) => !a.achieved), missingBefore).slice(0, 15).map((a) => a.id),
    names: all.slice(0, 3).map((a) => a.name),
  };
}
function current() {
  const lists = state.lists;
  return {
    unlocked: state.game?.unlocked,
    total: state.game?.total,
    latest: lists.latest?.id ?? null,
    tracked: lists.tracked.map((a) => a.id),
    recent: lists.recent.map((a) => a.id),
    missing: lists.missing.map((a) => a.id),
    names: logic.achievements().slice(0, 3).map((a) => a.name),
  };
}

// --- the player's path
const heap = () => {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};
const memory = {};
await flush();
memory.empty = heap();
await run(0);
phase = "read";
await act("connected", () => vm.setAccount("steam", "connected"));
await run(3 * 60_000);
memory.read = heap();
const read = { phase: state.phase, unlocked: state.game?.unlocked, total: state.game?.total, known: state.game?.known };

if (mode === "same-turn") {
  // A game of a usual size: each result in the turn of its action.
  const seen = {};
  const check = async (name, fn, test) => {
    await act(name, fn);
    seen[name] = test();
  };
  await check("open", () => logic.openPick(), () => state.picking && logic.pickList(state).length > 0);
  await check("more", () => logic.showMorePicks(), () => logic.pickList(state).length === Math.min(100, count - Math.ceil(count / 4)));
  await check("search", () => logic.pickTyped("Achievement 12"), () => logic.pickList(state).every((a) => a.name.includes("Achievement 12")) && logic.pickList(state).length > 0);
  const id = firstMissing().id;
  await check("tick", () => logic.toggleTrack(id), () => state.lists.tracked.some((a) => a.id === id));
  await check("close", () => logic.closePick(), () => !state.picking);
  await check("order", () => vm.setHost({ options: { ...vm.host.options, order: "name" } }), () => JSON.stringify(current().missing) === JSON.stringify(reference().missing));
  steam.games[APPID].unlocked[id] = Math.floor(Date.now() / 1000);
  vm.advance(60_000);
  while (await step());
  seen.read = state.lists.latest?.id === id;
  console.log(JSON.stringify({ mode, count, read, seen }));
  process.exit(0);
}

/** Virtual time from an action to its result in the view (`done`), turn by turn. */
const latency = {};
async function timed(name, fn, done) {
  const from = vm.now;
  await act(name, fn);
  while (!done() && vm.now - from < 10_000) {
    if (!(await step(from + 10_000))) break;
  }
  latency[name] = vm.now - from;
  await run(2000);
}
phase = "open";
await timed("open", () => logic.openPick(), () => state.picking);
phase = "more";
await timed("more", () => logic.showMorePicks(), () => logic.pickList(state).length >= 100);
phase = "search";
await timed("search", () => logic.pickTyped("Achievement 123"), () => logic.pickList(state).every((a) => a.name.startsWith("Achievement 123")));
const searched = logic.pickList(state).map((a) => a.name);
phase = "keys";
// Keystroke by keystroke, 120 ms apart: the last one counts.
const typed = "Achievement 99";
for (let length = 1; length <= typed.length; length += 1) {
  await act("key", () => logic.pickTyped(typed.slice(0, length)));
  await run(120);
}
await run(2000);
const keyed = logic.pickList(state).map((a) => a.name);
phase = "tick";
const ticked = firstMissing()?.id ?? "";
await act("tick", () => logic.toggleTrack(ticked));
await run(2000);
phase = "close";
await act("close", () => logic.closePick());
await run(2000);
phase = "order";
await setOptions({ order: "name" });
await run(2000);
phase = "minute";
await run(2 * 60_000);
memory.all = heap();
if (mode === "memory") {
  // The index and the sort keys alone, as the widget builds them for this list.
  const names = logic.achievements().map((a) => [a.id, a.name]);
  const before = heap();
  const index = new Map(names.map(([id], position) => [id, position]));
  const keys = names.map(([, name]) => logic.sortKey(name));
  memory.indexAndKeys = heap() - before;
  void [index.size, keys.length];
}

const out = { mode, count, units: logic.TURN_UNITS, latency, read, searched, keyed, ticked, tracked: [...state.tracked], memory };
if (mode === "check") {
  out.final = { current: current(), reference: reference() };
  // Actions while the view's job runs: each one's result is the one-go one.
  const during = async (name, start, action) => {
    phase = name;
    const from = views.length;
    await act(`${name} start`, start);
    await step();
    await act(name, action);
    await run(3 * 60_000);
    out[name] = { current: current(), reference: reference(), tracked: [...state.tracked], views: views.slice(from).map((entry) => entry.view) };
  };
  const minute = () => vm.advance(60_000 - (vm.now % 60_000) + 1);
  const unlock = (n) => {
    steam.games[APPID].unlocked[`ACH_${n}`] = Math.floor(Date.now() / 1000);
  };
  const tickWhile = firstMissingOf();
  await during("tick-during", () => { unlock(1); minute(); }, () => logic.toggleTrack(tickWhile));
  out["tick-during"].ticked = tickWhile;
  await during("option-during", () => { unlock(2); minute(); }, () => vm.setHost({ options: { ...vm.host.options, order: "rarest" } }));
  await during("locale-during", () => { unlock(3); minute(); }, () => vm.setHost({ locale: "fr", messages: FR }));
  await during("read-during", () => { unlock(5); minute(); }, () => { unlock(6); minute(); });
}
if (mode === "timing") out.turns = turns;
console.log(JSON.stringify(out));
process.exit(0);

/** A missing achievement that is not tracked yet, from the full list. */
function firstMissingOf() {
  return logic.achievements().find((a) => !a.achieved && !state.tracked.includes(a.id))?.id ?? "";
}
