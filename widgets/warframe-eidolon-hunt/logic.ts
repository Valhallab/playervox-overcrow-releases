// Eidolon hunt: the timer of each tricap on the Plains of Eidolon, the
// night left at Cetus, and the user's best tricap and past hunts.
//
// The big number of a hunt is the time since the first Eidolon appeared.
// It never goes back: Warframe tells its events about ten seconds late
// (sometimes 26 s), so a capture shows up late as an exact row, while the
// running timer goes on from the first spawn.
//
// The widget keeps the Eidolons of the night in its storage, so a hunt goes
// on after Warframe or PlayerVox OverCrow restarts. Each tricap is
// Teralyst, Gantulyst, then Hydrolyst: an Eidolon the host cannot name is
// named by its position, and splits are compared with the best tricap
// position by position.
import {
  formatDuration,
  formatNumber,
  gameEvents,
  host,
  initState,
  localTime,
  onHost,
  option,
  storage,
  t,
  timers,
  type IconName,
  type JsonValue,
  type Subscription,
  type Timer,
  type WarframeCycle,
  type WarframeEidolonHunt,
  type WarframeEvents,
} from "@overcrow/sdk";

// --- Time ------------------------------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** A day and a night at Cetus. */
export const CYCLE_MS = 150 * MINUTE;
/** The night, the last 50 minutes of the cycle. */
export const NIGHT_MS = 50 * MINUTE;
/** "Dawn" replaces "Night" in the header this long before the day. */
export const DAWN_WARNING_MS = 5 * MINUTE;
/** How long the end of a night waits for the escape Warframe tells late. */
export const DAWN_GRACE_MS = MINUTE;
/** How long a finished hunt stays on screen while the player is still on the Plains. */
export const RESULT_KEEP_MS = 10 * MINUTE;
/** Past hunts kept. */
export const MAX_HISTORY = 30;
/** Eidolons of the night kept. */
export const MAX_LEGS = 32;
/** The width from which Full shows the past hunts beside the hunt. */
export const WIDE_MIN_WIDTH = 420;
/** The Eidolons of a tricap, in order. */
export const EIDOLONS = ["teralyst", "gantulyst", "hydrolyst"] as const;
const POSITIONS = EIDOLONS.length;

// --- Stored data -----------------------------------------------------------

/** One Eidolon of the night, as stored: Unix ms, `null` until it happened. */
export type Leg = {
  /** When it appeared: its key. */
  s: number;
  /** The host's ID of the Eidolon, or `null` when it could not tell. */
  e: string | null;
  c: number | null;
  k: number | null;
  f: number | null;
};

/** One finished hunt, as stored. */
export type Past = {
  /** First spawn, Unix ms: its key. */
  s: number;
  /** End, Unix ms. */
  end: number;
  /** Eidolons captured. */
  caps: number;
  /** Total of a tricap, ms; `null` for a missed one. */
  total: number | null;
};

/** A tricap to beat: its total and the ms of each position. */
export type Mark = {
  total: number;
  splits: number[];
};

/** The best tricap, as stored. */
export type Best = {
  /** First spawn of that tricap, Unix ms. */
  s: number;
  total: number;
  /** Ms of each position. */
  splits: number[];
  /** The best before it, or `null` for the first: what this one is compared with. */
  prev: Mark | null;
};

const KEY_NIGHT = "night";
const KEY_HISTORY = "history";
const KEY_BEST = "best";
const KEY_CETUS = "cetus";

// --- State -----------------------------------------------------------------

/** What the view shows; built by `build`. */
export interface Row {
  id: string;
  name: string;
  rowCls: string;
  icon: IconName;
  iconCls: string;
  delta: string;
  deltaCls: string;
  time: string;
  timeCls: string;
}

export interface Day {
  id: string;
  when: string;
  caps: string;
  best: string;
  bestCls: string;
}

export interface Segment {
  id: string;
  text: string;
  cls: string;
}

export interface Screen {
  layout: "line" | "standard" | "wide";
  cycleIcon: IconName;
  chip: string;
  chipCls: string;
  label: string;
  pill: string;
  big: string;
  hint: string;
  hintCls: string;
  /** An icon before the hint, `""` for none. */
  hintIcon: IconName | "";
  rows: Row[];
  days: Day[];
  lineIcon: IconName;
  line: Segment[];
  lineSub: string;
  lineSubCls: string;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    view: Screen;
  }
}

/** What the logic knows, outside the view. */
interface Model {
  now: number;
  /** Stored data read (or refused): the widget writes only after. */
  loaded: boolean;
  /** `ok`, `unreadable` (Warframe's times cannot be read) or `refused`. */
  source: "ok" | "unreadable" | "refused";
  playing: boolean;
  /** On the Plains, `null` when unknown. */
  onPlains: boolean | null;
  /** When the last day began on the Plains, as the game told it; 0 before. */
  dayAt: number;
  legs: Leg[];
  history: Past[];
  best: Best | null;
  /** The end of a known night at Cetus, Unix ms, or `null`. */
  nightEnd: number | null;
  /** The largest running total shown for the run starting at `shownStart`. */
  shownStart: number;
  shownMax: number;
}

const model: Model = {
  now: Date.now(),
  loaded: false,
  source: "ok",
  playing: false,
  onPlains: null,
  dayAt: 0,
  legs: [],
  history: [],
  best: null,
  nightEnd: null,
  shownStart: 0,
  shownMax: 0,
};

// --- The Cetus cycle ---------------------------------------------------------

/** The end of a night at Cetus from the world's cycle. */
export function nightEndOf(cycle: WarframeCycle): number {
  return cycle.state.id === "night" ? cycle.endsAt : cycle.endsAt + NIGHT_MS;
}

/** The end of the night that holds `at`, or of the next one when `at` is in the day. */
export function nextNightEnd(anchor: number, at: number): number {
  return anchor + (Math.floor((at - anchor) / CYCLE_MS) + 1) * CYCLE_MS;
}

/** Night or day at `at`, and when it changes; `null` without any anchor. */
export function cycleAt(anchor: number | null, at: number): { night: boolean; endsAt: number } | null {
  if (anchor === null) {
    return null;
  }
  const end = nextNightEnd(anchor, at);
  return at >= end - NIGHT_MS ? { night: true, endsAt: end } : { night: false, endsAt: end - NIGHT_MS };
}

// --- Hunts ---------------------------------------------------------------------

export type Outcome = "open" | "tricap" | "fled" | "killed" | "dawn";

/** One tricap attempt: up to three Eidolons, by position. */
export interface Run {
  start: number;
  legs: (Leg | null)[];
  outcome: Outcome;
  /** When it ended, Unix ms; `null` while open. */
  end: number | null;
}

function legEnd(leg: Leg): number | null {
  return leg.c ?? leg.k ?? leg.f;
}

function positionOf(id: string | null): number {
  return id === null ? -1 : EIDOLONS.indexOf(id as (typeof EIDOLONS)[number]);
}

/** The last position filled in a run. */
function lastPosition(run: Run): number {
  for (let index = POSITIONS - 1; index >= 0; index -= 1) {
    if (run.legs[index] !== null) {
      return index;
    }
  }
  return -1;
}

/** Whether a run can take the Eidolon of the next position. */
function continues(run: Run): boolean {
  const last = lastPosition(run);
  const leg = last >= 0 ? (run.legs[last] ?? null) : null;
  return leg !== null && last < POSITIONS - 1 && leg.f === null && legEnd(leg) !== null;
}

/**
 * The night's Eidolons cut into runs, oldest first. A Teralyst starts a run;
 * a Gantulyst or a Hydrolyst continues the run whose previous Eidolon was
 * captured or killed; an Eidolon the host could not name takes the next
 * position of the open run, or starts one.
 */
export function cut(legs: readonly Leg[], anchor: number | null): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const leg of [...legs].sort((a, b) => a.s - b.s)) {
    let position = positionOf(leg.e);
    const sameNight =
      current !== null &&
      (anchor === null
        ? leg.s - current.start < NIGHT_MS
        : nextNightEnd(anchor, leg.s) === nextNightEnd(anchor, current.start));
    const open = current !== null && sameNight && continues(current);
    if (position < 0) {
      position = open && current !== null ? lastPosition(current) + 1 : 0;
    }
    if (current !== null && open && position === lastPosition(current) + 1) {
      current.legs[position] = leg;
      continue;
    }
    current = { start: leg.s, legs: [null, null, null], outcome: "open", end: null };
    current.legs[position] = leg;
    runs.push(current);
  }
  return runs;
}

/** The end of the night of a run: told by the game, or from the cycle. */
function runNightEnd(run: Run, anchor: number | null, dayAt: number): number {
  if (dayAt > run.start) {
    return dayAt;
  }
  return anchor === null ? run.start + NIGHT_MS : nextNightEnd(anchor, run.start);
}

/** Settles each run's outcome and end at `now`. A later run closes an earlier one. */
export function settle(runs: Run[], now: number, anchor: number | null, dayAt: number): Run[] {
  runs.forEach((run, index) => {
    const legs = run.legs.filter((leg): leg is Leg => leg !== null);
    const last = run.legs[POSITIONS - 1] ?? null;
    const latest = run.legs[lastPosition(run)] ?? null;
    const fled = legs.find((leg) => leg.f !== null);
    const lastEnd = legs.reduce((end, leg) => Math.max(end, legEnd(leg) ?? leg.s), run.start);
    if (run.legs.every((leg) => leg !== null && leg.c !== null)) {
      run.outcome = "tricap";
      run.end = last?.c ?? lastEnd;
    } else if (fled !== undefined) {
      run.outcome = "fled";
      run.end = fled.f;
    } else if (latest !== null && latest.k !== null) {
      // A killed Eidolon gives no shard to summon the next one: the attempt
      // ends at its death. Should the next one appear anyway, it goes on.
      run.outcome = "killed";
      run.end = latest.k;
    } else if (last !== null && last.c !== null) {
      // The Hydrolyst captured after an Eidolon killed: a missed tricap.
      run.outcome = "killed";
      run.end = last.c;
    } else {
      const dawn = runNightEnd(run, anchor, dayAt);
      const waiting = legs.some((leg) => legEnd(leg) === null);
      if (index < runs.length - 1) {
        run.outcome = "dawn";
        run.end = Math.min(dawn, runs[index + 1]?.start ?? dawn);
      } else if (now >= dawn + (waiting ? DAWN_GRACE_MS : 0)) {
        run.outcome = "dawn";
        run.end = dawn;
      }
    }
  });
  return runs;
}

/** Cumulative ms of each position from the run's start, `null` when not captured. */
function marks(run: Run): (number | null)[] {
  return run.legs.map((leg) => (leg !== null && leg.c !== null ? leg.c - run.start : null));
}

/** Ms of each position of a tricap. */
export function splitsOf(run: Run): number[] {
  const at = marks(run);
  return at.map((mark, index) => (mark ?? 0) - (index === 0 ? 0 : (at[index - 1] ?? 0)));
}

function captures(run: Run): number {
  return run.legs.filter((leg) => leg !== null && leg.c !== null).length;
}

// --- Merging what the host tells --------------------------------------------

/** The night's Eidolons with the host's hunts merged in, by spawn time. */
export function merge(legs: readonly Leg[], hunts: readonly WarframeEidolonHunt[], now: number): Leg[] {
  const byStart = new Map<number, Leg>(legs.map((leg) => [leg.s, leg]));
  for (const hunt of hunts) {
    byStart.set(hunt.spawnedAt, {
      s: hunt.spawnedAt,
      e: hunt.eidolon?.id ?? null,
      c: hunt.capturedAt,
      k: hunt.killedAt,
      f: hunt.fledAt,
    });
  }
  return [...byStart.values()]
    .filter((leg) => now - leg.s < CYCLE_MS)
    .sort((a, b) => a.s - b.s)
    .slice(-MAX_LEGS);
}

/** Files the finished runs into the history and the best tricap. */
export function file(
  runs: readonly Run[],
  history: readonly Past[],
  best: Best | null,
): { history: Past[]; best: Best | null; changed: boolean } {
  const byStart = new Map<number, Past>(history.map((past) => [past.s, past]));
  let changed = false;
  let top = best;
  for (const run of runs) {
    if (run.outcome === "open" || run.end === null) {
      continue;
    }
    const total = run.outcome === "tricap" ? run.end - run.start : null;
    const past: Past = { s: run.start, end: run.end, caps: captures(run), total };
    const known = byStart.get(run.start);
    if (!known || known.end !== past.end || known.caps !== past.caps || known.total !== past.total) {
      byStart.set(run.start, past);
      changed = true;
    }
    if (total !== null && top?.s !== run.start && (top === null || total < top.total)) {
      const prev = top === null ? null : { total: top.total, splits: top.splits };
      top = { s: run.start, total, splits: splitsOf(run), prev };
      changed = true;
    }
  }
  const next = [...byStart.values()].sort((a, b) => a.s - b.s).slice(-MAX_HISTORY);
  return { history: next, best: top, changed };
}

// --- Formatting --------------------------------------------------------------

/** Centiseconds, truncated, as the frozen times show them. */
function centis(ms: number): number {
  return Math.floor(Math.max(0, ms) / 10);
}

/** `07:15.37`. */
export function exact(ms: number): string {
  return formatDuration(centis(ms) * 10, { hundredths: true });
}

/** `06:41`, the running timer; `1:02:03` past an hour. */
export function clock(ms: number): string {
  return formatDuration(Math.max(0, ms));
}

/** `2:48`, minutes without a leading zero, for the header. */
export function short(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / SECOND);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** A countdown: whole seconds, rounded up, so it reaches 0:00 at the change. */
function countdown(ms: number): string {
  return clock(Math.ceil(Math.max(0, ms) / SECOND) * SECOND);
}

/** `1.78`, `1:02.40`: the size of a difference of centiseconds. */
export function magnitude(diffCentis: number): string {
  const size = Math.abs(diffCentis);
  return size >= 6000
    ? formatDuration(size * 10, { hundredths: true }).replace(/^0/, "")
    : formatNumber(size / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `+1.78`, `−3.10`, `+1:02.40`: a difference of centiseconds. */
export function signed(diffCentis: number): string {
  const sign = diffCentis > 0 ? "+" : diffCentis < 0 ? "\u2212" : "";
  return sign + magnitude(diffCentis);
}

function tone(diffCentis: number): string {
  return diffCentis > 0 ? "tone-warning" : "tone-success";
}

/** Named by position: a tricap is always Teralyst, Gantulyst, Hydrolyst. */
function eidolonName(position: number): string {
  return t(EIDOLONS[position] ?? "teralyst");
}

function capturesText(count: number): string {
  return t(count === 0 ? "captures-zero" : count === 1 ? "captures-one" : "captures-other", { count });
}

/** `Today`, `Yesterday`, `Sat 26 Oct`, by the user's local day. */
function dayName(at: number, now: number): string {
  const day = dayIndex(at);
  const today = dayIndex(now);
  if (day === today) {
    return t("day-today");
  }
  if (day === today - 1) {
    return t("day-yesterday");
  }
  const local = localTime(at);
  return t("day-date", {
    weekday: t(`weekday-${local.weekday}`),
    day: local.day,
    month: t(`month-${local.month}`),
  });
}

/** `today`, `yesterday`, `26 Oct`: when a best was set. */
function whenText(at: number, now: number): string {
  const day = dayIndex(at);
  const today = dayIndex(now);
  if (day === today) {
    return t("when-today");
  }
  if (day === today - 1) {
    return t("when-yesterday");
  }
  const local = localTime(at);
  return t("date-short", { day: local.day, month: t(`month-${local.month}`) });
}

function dayIndex(at: number): number {
  const local = localTime(at);
  return Math.floor(Date.UTC(local.year, local.month - 1, local.day) / (24 * 60 * MINUTE));
}

function tricapsText(count: number): string {
  return t(count === 1 ? "tricaps-one" : "tricaps-other", { count });
}

// --- The view model --------------------------------------------------------------

function layout(): Screen["layout"] {
  if (option("layout", "full") === "line") {
    return "line";
  }
  return host.viewport.width >= WIDE_MIN_WIDTH ? "wide" : "standard";
}

function blank(): Screen {
  return {
    layout: layout(),
    cycleIcon: "moon",
    chip: "",
    chipCls: "night",
    label: "",
    pill: "",
    big: "",
    hint: "",
    hintCls: "hint",
    hintIcon: "",
    rows: [],
    days: [],
    lineIcon: "moon",
    line: [],
    lineSub: "",
    lineSubCls: "line-sub",
  };
}

/** The past hunts by local day, newest first: three days. */
function days(now: number, best: Best | null, history: readonly Past[]): Day[] {
  const groups = new Map<number, Past[]>();
  for (const past of history) {
    const day = dayIndex(past.s);
    groups.set(day, [...(groups.get(day) ?? []), past]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([day, pasts]) => {
      const tricaps = pasts.filter((past) => past.total !== null);
      const top = tricaps.reduce<number | null>(
        (min, past) => (min === null || (past.total ?? min) < min ? past.total : min),
        null,
      );
      const first = pasts[0]?.s ?? now;
      return {
        id: String(day),
        when: dayName(first, now),
        caps: tricaps.length > 0 ? tricapsText(tricaps.length) : t("no-tricap"),
        best: top === null ? "—" : exact(top),
        // Green: the best tricap, on the day it was set.
        bestCls:
          top !== null && best !== null && top === best.total && dayIndex(best.s) === dayIndex(now)
            ? "past-best tone-success"
            : "past-best",
      };
    });
}

/** "Today: 1 tricap · best 07:32.40 (yesterday)", or `""`. */
function summary(now: number): string {
  const today = dayIndex(now);
  const count = model.history.filter((past) => past.total !== null && dayIndex(past.s) === today).length;
  const parts: string[] = [];
  if (count > 0) {
    parts.push(t("summary-today", { tricaps: tricapsText(count) }));
  }
  if (model.best !== null) {
    parts.push(t(count > 0 ? "summary-best" : "summary-best-first", {
      time: exact(model.best.total),
      when: whenText(model.best.s, now),
    }));
  }
  return parts.join("\u00a0\u00b7 ");
}

/** The calm screen: the night at Cetus, with one line of context. */
function calm(screen: Screen, now: number): Screen {
  const cycle = cycleAt(model.nightEnd, now);
  const icon: IconName = cycle === null || cycle.night ? "moon" : "sun";
  screen.cycleIcon = icon;
  screen.lineIcon = icon;
  if (cycle === null) {
    screen.label = t("cycle-unknown");
    screen.big = "—";
  } else {
    screen.label = t(cycle.night ? "night-left" : "night-in");
    screen.big = countdown(cycle.endsAt - now);
  }
  screen.line = [
    { id: "label", text: screen.label, cls: "line-main" },
    { id: "value", text: screen.big, cls: "line-big" },
  ];
  const newcomer = model.history.length === 0 && model.best === null;
  if (model.source === "refused") {
    // The whole of game events is refused: name the feature the widget lives on.
    screen.hint = t("hint-refused");
    screen.hintCls = "hint tone-warning";
    screen.hintIcon = "circle-alert";
    screen.line = [{ id: "label", text: t("line-refused"), cls: "line-main" }];
    screen.lineSub = t("line-refused-fix");
    screen.lineSubCls = "line-sub tone-warning";
  } else if (model.source === "unreadable") {
    screen.hint = t("hint-unreadable");
    screen.hintCls = "hint tone-warning";
    // The night stays, under its short header label; what is missing follows.
    if (cycle !== null && cycle.night) {
      screen.line = [
        { id: "label", text: t("line-night"), cls: "line-main" },
        { id: "value", text: screen.big, cls: "line-big" },
      ];
    }
    screen.lineSub = t("line-unreadable");
    screen.lineSubCls = "line-sub tone-warning";
  } else if (!model.playing) {
    screen.hint = newcomer ? t("hint-first-run") : summary(now) || t("hint-first-run");
  } else if (model.onPlains === false) {
    screen.hint = newcomer ? t("hint-first-run") : t("hint-away");
  } else {
    screen.hint = t("hint-start");
  }
  screen.days = days(now, model.best, model.history);
  return screen;
}

/** The header's night: "Night 32:14", amber "Dawn 2:48" near the day; nothing by day. */
function chip(screen: Screen, now: number): void {
  const cycle = cycleAt(model.nightEnd, now);
  if (cycle === null || !cycle.night) {
    screen.cycleIcon = cycle === null ? "moon" : "sun";
    return;
  }
  const left = cycle.endsAt - now;
  if (left <= DAWN_WARNING_MS) {
    screen.chip = t("chip-dawn", { time: short(left) });
    screen.chipCls = "night ending";
    screen.lineSub = t("line-dawn", { time: short(left) });
    screen.lineSubCls = "line-sub tone-warning";
  } else {
    screen.chip = t("chip-night", { time: short(left) });
    screen.lineSub = screen.chip;
  }
}

/** The rows of a run, with the difference to the best tricap of each capture. */
function rows(run: Run): Row[] {
  const at = marks(run);
  const best = reference(run);
  const ends = run.legs.map((leg) => {
    const end = leg === null ? null : legEnd(leg);
    return end === null ? null : end - run.start;
  });
  const next = run.outcome === "open" ? lastPosition(run) + (legDone(run) ? 1 : 0) : -1;
  return EIDOLONS.map((id, position) => {
    const leg = run.legs[position] ?? null;
    const row: Row = {
      id,
      name: eidolonName(position),
      rowCls: "split",
      icon: "circle",
      iconCls: "split-icon tone-muted",
      delta: "",
      deltaCls: "delta",
      time: "\u2014",
      timeCls: "split-time soft",
    };
    const end = ends[position] ?? null;
    if (leg !== null && end !== null) {
      // From the end of the Eidolon before, or from this one's spawn.
      const from = (position > 0 ? ends[position - 1] : null) ?? leg.s - run.start;
      const split = centis(end) - centis(from);
      row.time = formatDuration(Math.max(0, split) * 10, { hundredths: true });
      if (leg.c !== null) {
        row.icon = "circle-check";
        row.iconCls = "split-icon tone-success";
        row.timeCls = "split-time";
        const chained = at.slice(0, position + 1).every((mark) => mark !== null);
        if (best !== null && chained) {
          const ref = centis(cumulative(best, position)) - centis(cumulative(best, position - 1));
          const diff = split - ref;
          row.delta = signed(diff);
          row.deltaCls = `delta ${tone(diff)}`;
        }
      } else {
        row.icon = leg.k !== null ? "skull" : "sunrise";
        row.iconCls = "split-icon tone-warning";
        row.delta = t(leg.k !== null ? "killed" : "fled");
        row.deltaCls = "delta tone-warning";
      }
    } else if (position === next) {
      row.rowCls = "split now";
      row.icon = "circle-dot";
      row.iconCls = "split-icon";
      row.time = t("running");
    } else {
      row.rowCls = "split later";
    }
    return row;
  });
}

/** Whether the last Eidolon of an open run is done with, so the next one is awaited. */
function legDone(run: Run): boolean {
  const last = lastPosition(run);
  const leg = last >= 0 ? (run.legs[last] ?? null) : null;
  return leg !== null && legEnd(leg) !== null;
}

/** What a run is compared with: the best tricap, or the one before when it is the best. */
function reference(run: Run): Mark | null {
  const best = model.best;
  if (best === null) {
    return null;
  }
  return best.s === run.start ? best.prev : best;
}

function cumulative(best: Mark, position: number): number {
  let total = 0;
  for (let index = 0; index <= position; index += 1) {
    total += best.splits[index] ?? 0;
  }
  return total;
}

/** The difference to the best tricap after the last capture in a row from the start, centiseconds. */
function behind(run: Run): { diff: number; position: number } | null {
  const best = reference(run);
  if (best === null) {
    return null;
  }
  const at = marks(run);
  let position = -1;
  while (position + 1 < POSITIONS && at[position + 1] !== null) {
    position += 1;
  }
  if (position < 0) {
    return null;
  }
  return { diff: centis(at[position] ?? 0) - centis(cumulative(best, position)), position };
}

/** The screen of a hunt, running or just finished. */
function hunt(screen: Screen, run: Run, now: number): Screen {
  chip(screen, now);
  screen.lineIcon = screen.cycleIcon;
  screen.rows = rows(run);
  screen.days = days(now, model.best, model.history);
  const killed = run.legs.findIndex((leg) => leg !== null && leg.k !== null);
  if (run.outcome === "open") {
    let total = now - run.start;
    if (model.shownStart === run.start) {
      total = Math.max(total, model.shownMax);
    }
    model.shownStart = run.start;
    model.shownMax = total;
    screen.big = clock(total);
    if (killed >= 0) {
      screen.label = t("missed");
      screen.hint = t("hint-killed-on", { name: eidolonName(killed) });
      screen.hintCls = "hint tone-warning";
      screen.line = [
        { id: "label", text: screen.label, cls: "line-main tone-warning" },
        { id: "value", text: screen.big, cls: "line-big" },
      ];
      return screen;
    }
    screen.label = t("hunting");
    const gap = behind(run);
    screen.line = [{ id: "value", text: screen.big, cls: "line-big" }];
    if (gap !== null) {
      // Behind or ahead in words, so the text agrees with its colour.
      screen.hint = t(gap.diff > 0 ? "hint-behind" : "hint-ahead", {
        delta: magnitude(gap.diff),
        name: eidolonName(gap.position),
      });
      screen.hintCls = `hint ${tone(gap.diff)}`;
      screen.line.push({ id: "delta", text: signed(gap.diff), cls: `line-delta ${tone(gap.diff)}` });
    } else if (model.best !== null) {
      screen.hint = t("hint-best", { time: exact(model.best.total) });
    } else {
      screen.hint = t("hint-no-best");
    }
    return screen;
  }
  const end = run.end ?? now;
  screen.big = exact(end - run.start);
  // One line of a result: the result alone, its exact time leaves no room for the night.
  screen.lineSub = "";
  screen.lineSubCls = "line-sub";
  if (run.outcome === "tricap") {
    screen.label = t("tricap");
    const best = model.best;
    if (best !== null && best.s === run.start) {
      screen.pill = t("new-best");
      screen.hint =
        best.prev === null
          ? t("hint-first-best")
          : t("hint-previous", {
              time: exact(best.prev.total),
              delta: signed(centis(best.total) - centis(best.prev.total)),
            });
      screen.hintCls = "hint tone-success";
      screen.line = [
        { id: "label", text: screen.label, cls: "line-main tone-success" },
        { id: "value", text: screen.big, cls: "line-big" },
      ];
      screen.lineSub = screen.pill;
      screen.lineSubCls = "line-sub tone-success";
    } else if (best !== null) {
      const diff = centis(end - run.start) - centis(best.total);
      screen.hint = t("hint-vs-best", { time: exact(best.total), delta: signed(diff) });
      screen.hintCls = `hint ${tone(diff)}`;
      screen.line = [
        { id: "label", text: screen.label, cls: "line-main" },
        { id: "value", text: screen.big, cls: "line-big" },
        { id: "delta", text: signed(diff), cls: `line-delta ${tone(diff)}` },
      ];
    }
    return screen;
  }
  screen.label = t("missed");
  const count = capturesText(captures(run));
  const fled = run.legs.findIndex((leg) => leg !== null && leg.f !== null);
  if (killed >= 0) {
    screen.hint = t("end-killed", { captures: count, name: eidolonName(killed) });
  } else if (fled >= 0) {
    screen.hint = t("end-fled", { captures: count, name: eidolonName(fled) });
  } else {
    screen.hint = t("end-dawn", { captures: count });
  }
  screen.hintCls = "hint tone-warning";
  screen.line = [
    { id: "label", text: screen.label, cls: "line-main tone-warning" },
    { id: "value", text: screen.big, cls: "line-big" },
  ];
  return screen;
}

/** The screen at `now`, from the model. */
export function build(now: number): Screen {
  const screen = blank();
  if (model.source !== "ok") {
    return calm(screen, now);
  }
  const runs = settle(cut(model.legs, model.nightEnd), now, model.nightEnd, model.dayAt);
  fileRuns(runs);
  const run = runs.at(-1);
  if (run !== undefined && model.playing) {
    if (run.outcome === "open") {
      return hunt(screen, run, now);
    }
    const end = run.end ?? now;
    if (model.onPlains !== false && now - end < RESULT_KEEP_MS) {
      return hunt(screen, run, now);
    }
  }
  return calm(screen, now);
}

// --- Storage -------------------------------------------------------------------

function save(key: string, value: JsonValue): void {
  if (!model.loaded) {
    return;
  }
  // Without the user's consent the hunts last as long as the widget runs.
  storage.set({ key, value }).catch(() => {});
}

function fileRuns(runs: readonly Run[]): void {
  const filed = file(runs, model.history, model.best);
  if (!filed.changed) {
    return;
  }
  const bestChanged = filed.best !== model.best;
  model.history = filed.history;
  model.best = filed.best;
  save(KEY_HISTORY, model.history);
  if (bestChanged) {
    save(KEY_BEST, model.best);
  }
}

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isTimeOrNull = (value: unknown): value is number | null => value === null || isTime(value);
const isText = (value: unknown): value is string | null => value === null || typeof value === "string";

/** Stored values, checked: a value of another shape is ignored, never trusted. */
export function readLegs(value: unknown): { legs: Leg[]; dayAt: number } {
  const record = value as { legs?: unknown; dayAt?: unknown } | null;
  const legs = Array.isArray(record?.legs)
    ? (record.legs as Leg[]).filter(
        (leg) =>
          typeof leg === "object" &&
          leg !== null &&
          isTime(leg.s) &&
          isText(leg.e) &&
          isTimeOrNull(leg.c) &&
          isTimeOrNull(leg.k) &&
          isTimeOrNull(leg.f),
      )
    : [];
  return { legs: legs.slice(-MAX_LEGS), dayAt: isTime(record?.dayAt) ? record.dayAt : 0 };
}

export function readHistory(value: unknown): Past[] {
  return Array.isArray(value)
    ? (value as Past[])
        .filter(
          (past) =>
            typeof past === "object" &&
            past !== null &&
            isTime(past.s) &&
            isTime(past.end) &&
            Number.isInteger(past.caps) &&
            isTimeOrNull(past.total),
        )
        .slice(-MAX_HISTORY)
    : [];
}

function isMark(mark: Mark): boolean {
  return (
    typeof mark === "object" &&
    mark !== null &&
    isTime(mark.total) &&
    Array.isArray(mark.splits) &&
    mark.splits.length === POSITIONS &&
    mark.splits.every(isTime)
  );
}

export function readBest(value: unknown): Best | null {
  const best = value as Best | null;
  return typeof best === "object" &&
    best !== null &&
    isTime(best.s) &&
    isTime(best.total) &&
    isMark(best) &&
    (best.prev === null || isMark(best.prev))
    ? best
    : null;
}

// --- Host --------------------------------------------------------------------------

const state = initState({ view: blank() });

function refresh(): void {
  model.now = Date.now();
  state.view = build(model.now);
}

let lastSeq = 0;
let lastSession = -1;

/** One value of `gameEvents.warframe.subscribe`. */
export function receive(value: WarframeEvents): void {
  const now = Date.now();
  const session = value.session?.startedAt ?? 0;
  if (session !== lastSession) {
    // A new subscription or launch numbers its events from 1 again.
    lastSession = session;
    lastSeq = 0;
  }
  model.playing = value.playing;
  model.source = value.features.eidolons === "unavailable" ? "unreadable" : "ok";
  const location = value.info.location;
  model.onPlains =
    location === null ? (value.playing ? null : false) : location.place?.id === "plains_of_eidolon";
  const cetus = value.info.world?.cycles.cetus ?? null;
  if (cetus !== null) {
    const end = nightEndOf(cetus);
    if (end !== model.nightEnd) {
      model.nightEnd = end;
      save(KEY_CETUS, end);
    }
  }
  let dayAt = model.dayAt;
  for (const event of value.events) {
    if (event.seq <= lastSeq) {
      continue;
    }
    lastSeq = event.seq;
    if (event.type === "day_started") {
      dayAt = Math.max(dayAt, event.at);
    }
  }
  const hunts = value.info.eidolons?.hunts ?? [];
  const legs = merge(model.legs, hunts, now);
  if (dayAt !== model.dayAt || JSON.stringify(legs) !== JSON.stringify(model.legs)) {
    model.dayAt = dayAt;
    model.legs = legs;
    save(KEY_NIGHT, { legs, dayAt });
  }
  refresh();
}

let subscription: Subscription | null = null;
let retry: Timer | null = null;

function follow(): void {
  retry?.cancel();
  retry = null;
  subscription?.cancel();
  subscription = gameEvents.warframe.subscribe((update) => {
    if (update.ok) {
      receive(update.value);
      return;
    }
    subscription = null;
    model.source = update.error.code === "permission_denied" ? "refused" : "unreadable";
    refresh();
    retry = timers.after(MINUTE, follow);
  });
}

async function load(): Promise<void> {
  const read = (key: string): Promise<unknown> => storage.get({ key }).catch(() => null);
  const [night, history, best, cetus] = await Promise.all([
    read(KEY_NIGHT),
    read(KEY_HISTORY),
    read(KEY_BEST),
    read(KEY_CETUS),
  ]);
  const stored = readLegs(night);
  model.legs = merge(stored.legs, [], Date.now());
  model.dayAt = stored.dayAt;
  model.history = readHistory(history);
  model.best = readBest(best);
  model.nightEnd = isTime(cetus) ? cetus : null;
  model.loaded = true;
}

onHost((changed) => {
  // Allowed in the Control Center: follow at once, not at the next retry.
  if (changed.includes("grants") && model.source === "refused" && model.loaded) {
    follow();
  }
  if (
    changed.includes("locale") ||
    changed.includes("options") ||
    changed.includes("viewport") ||
    changed.includes("region") ||
    changed.includes("visible")
  ) {
    refresh();
  }
});

refresh();
timers.atEach("second", refresh);
void load().then(() => {
  refresh();
  follow();
});

/** The root's classes: the family's panel and the layout. */
export function rootClass(layout: Screen["layout"]): string {
  return `wf eidolon ${layout}`;
}
