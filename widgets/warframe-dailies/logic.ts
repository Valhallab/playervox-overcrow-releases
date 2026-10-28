// Warframe dailies and weeklies: what is left to do today and this week,
// and when it resets. The world (Sortie, Archon Hunt, Circuit, Baro
// Ki'Teer) comes from PlayerVox OverCrow even with the game closed; a
// finished mission ticks its activity on its own; a click ticks the rest.
import {
  formatTime,
  gameEvents,
  host,
  initState,
  localTime,
  onHost,
  option,
  storage,
  t,
  timers,
  type JsonValue,
  type WarframeEvents,
  type WarframeMission,
  type WarframeWorld,
  type WarframeWorldMission,
} from "@overcrow/sdk";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The Sortie resets at 16:00 UTC, when the world does not say. */
const SORTIE_RESET_UTC_HOUR = 16;
/** A tick a finished mission made shows "just now" this long. */
export const FRESH_MS = 5 * MINUTE;
/** The world is old ("offline") when the host has not read it for this long; it reads it every 5 minutes. */
export const STALE_MS = 15 * MINUTE;
/** The widget becomes "wide" (two columns) from this width, logical px. */
const WIDE_PX = 560;
const STORAGE_KEY = "ticks";

/** The activities, in their order on screen. */
export const ACTIVITIES = ["sortie", "archon", "netracells", "circuit", "nightwave"] as const;
export type ActivityId = (typeof ACTIVITIES)[number];
type Period = "day" | "week";
const PERIOD: Record<ActivityId, Period> = {
  sortie: "day",
  archon: "week",
  netracells: "week",
  circuit: "week",
  nightwave: "week",
};
/** Parts a finished mission ticks (Sortie and Archon stages, Netracells runs); 0 for by hand only. */
const PARTS: Record<ActivityId, number> = { sortie: 3, archon: 3, netracells: 5, circuit: 0, nightwave: 0 };

// Storage.

/** When an activity was done, and whether by a click. */
export interface Done {
  at: number;
  hand: boolean;
}
/** One activity of the period: the `at` of each part done (0: not yet), and when it was all done. */
export interface Activity {
  parts: number[];
  done: Done | null;
}
/** What the widget keeps between runs. */
export interface Ticks {
  v: 1;
  /** The `at` of the last mission event handled: a restart never ticks it twice. */
  lastAt: number;
  /** The first tick happened: the first-run hint goes. */
  intro: boolean;
  /** When the day's period ends (the Sortie's reset). */
  dayEnd: number;
  /** When the week's period ends (Monday 00:00 UTC). */
  weekEnd: number;
  activities: Record<ActivityId, Activity>;
}

const freshActivity = (id: ActivityId): Activity => ({ parts: new Array<number>(PARTS[id]).fill(0), done: null });

export function emptyTicks(): Ticks {
  const activities = {} as Record<ActivityId, Activity>;
  for (const id of ACTIVITIES) activities[id] = freshActivity(id);
  return { v: 1, lastAt: 0, intro: false, dayEnd: 0, weekEnd: 0, activities };
}

const time = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** The stored ticks, checked member by member: anything else starts empty. */
export function readTicks(value: unknown): Ticks {
  const ticks = emptyTicks();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ticks;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) return ticks;
  ticks.lastAt = time(raw.lastAt);
  ticks.intro = raw.intro === true;
  ticks.dayEnd = time(raw.dayEnd);
  ticks.weekEnd = time(raw.weekEnd);
  const activities = raw.activities as Record<string, unknown> | undefined;
  for (const id of ACTIVITIES) {
    const one = activities?.[id] as { parts?: unknown; done?: unknown } | undefined;
    if (one === undefined || one === null || typeof one !== "object") continue;
    const parts = Array.isArray(one.parts) ? one.parts : [];
    for (let i = 0; i < PARTS[id]; i += 1) ticks.activities[id].parts[i] = time(parts[i]);
    const done = one.done as { at?: unknown; hand?: unknown } | null | undefined;
    if (done !== null && typeof done === "object" && time(done.at) > 0) {
      ticks.activities[id].done = { at: time(done.at), hand: done.hand === true };
    }
  }
  return ticks;
}

// Resets.

/** The next 16:00 UTC after `now`. */
export function nextSortieReset(now: number): number {
  const day = Math.floor(now / DAY) * DAY;
  const reset = day + SORTIE_RESET_UTC_HOUR * HOUR;
  return reset > now ? reset : reset + DAY;
}

/** The next Monday 00:00 UTC after `now`. */
export function nextWeeklyReset(now: number): number {
  const day = Math.floor(now / DAY) * DAY;
  // 1970-01-01 was a Thursday: day 0 is weekday 4.
  const weekday = (Math.floor(now / DAY) + 4) % 7;
  return day + ((8 - weekday) % 7 || 7) * DAY;
}

/** The end of the day's period: the Sortie's end when the world gives a future one. */
export function dayEndOf(world: WarframeWorld | null, now: number): number {
  const end = world?.sortie?.endsAt;
  return end !== undefined && end > now && end - now <= DAY ? end : nextSortieReset(now);
}

/** The end of the week's period: the world's weekly reset when it is ahead. */
export function weekEndOf(world: WarframeWorld | null, now: number): number {
  const end = world?.resets.weekly;
  return end !== undefined && end > now && end - now <= WEEK ? end : nextWeeklyReset(now);
}

/** Starts a new period for each one that ended. Returns whether anything changed. */
export function roll(ticks: Ticks, world: WarframeWorld | null, now: number): boolean {
  let changed = false;
  if (now >= ticks.dayEnd) {
    ticks.dayEnd = dayEndOf(world, now);
    for (const id of ACTIVITIES) if (PERIOD[id] === "day") ticks.activities[id] = freshActivity(id);
    changed = true;
  }
  if (now >= ticks.weekEnd) {
    ticks.weekEnd = weekEndOf(world, now);
    for (const id of ACTIVITIES) if (PERIOD[id] === "week") ticks.activities[id] = freshActivity(id);
    changed = true;
  }
  return changed;
}

const periodHas = (ticks: Ticks, period: Period, at: number): boolean =>
  period === "day" ? at >= ticks.dayEnd - DAY && at < ticks.dayEnd : at >= ticks.weekEnd - WEEK && at < ticks.weekEnd;

// Missions.

/** The stage (1 to 3) of a mission in a list of the world, by its node. */
function stageByNode(missions: readonly WarframeWorldMission[] | undefined, node: string): number | null {
  const index = missions?.findIndex((mission) => mission.node.id === node) ?? -1;
  return index >= 0 && index < 3 ? index + 1 : null;
}

function tickPart(ticks: Ticks, id: ActivityId, index: number, at: number): boolean {
  const activity = ticks.activities[id];
  if (activity.done !== null || index < 0 || index >= PARTS[id] || activity.parts[index] !== 0) return false;
  activity.parts[index] = at;
  if (activity.parts.every((part) => part !== 0)) activity.done = { at, hand: false };
  ticks.intro = true;
  return true;
}

/**
 * Ticks what a mission that ended at `at` did: a stage of the Sortie or of
 * the Archon Hunt, or a Netracell. Only a success counts, once, in the
 * period it happened. Returns whether anything changed.
 */
export function handleMission(ticks: Ticks, mission: WarframeMission, at: number, world: WarframeWorld | null): boolean {
  if (mission.result !== "succeeded") return false;
  let changed = false;
  for (const modifier of mission.modifiers) {
    const id: ActivityId | null =
      modifier.id === "sortie" ? "sortie" : modifier.id === "archon_hunt" ? "archon" : null;
    if (id === null || !periodHas(ticks, PERIOD[id], at)) continue;
    const list = id === "sortie" ? world?.sortie : world?.archonHunt;
    const missions = list !== null && list !== undefined && list.endsAt > at ? list.missions : undefined;
    const stage = modifier.stage ?? stageByNode(missions, mission.node.id);
    if (stage !== null) changed = tickPart(ticks, id, stage - 1, at) || changed;
  }
  if (mission.type?.id === "netracell" && periodHas(ticks, "week", at)) {
    const index = ticks.activities.netracells.parts.indexOf(0);
    changed = tickPart(ticks, "netracells", index, at) || changed;
  }
  return changed;
}

/** A click: ticks an activity by hand, or unticks it. Unticking a click goes back to what missions did. */
export function toggle(ticks: Ticks, id: ActivityId, now: number): void {
  const activity = ticks.activities[id];
  if (activity.done === null) {
    activity.done = { at: now, hand: true };
    ticks.intro = true;
  } else if (activity.done.hand && activity.parts.some((part) => part === 0)) {
    activity.done = null;
  } else {
    ticks.activities[id] = freshActivity(id);
  }
}

// The view model.

export interface Row {
  id: ActivityId;
  icon: string;
  iconCls: string;
  name: string;
  sub: string;
  value: string;
  valueCls: string;
  byHand: boolean;
  rowCls: string;
  label: string;
}
export interface Group {
  id: Period;
  title: string;
  reset: string;
  rows: Row[];
}
export interface Model {
  left: string;
  leftCls: string;
  groups: Group[];
  baro: string;
  baroHere: boolean;
  hint: string;
  hintIcon: string;
  hintTone: string;
  status: string;
  line: string;
  lineValue: string;
  lineValueCls: string;
  lineCls: string;
  /** The accessible label of the one line: its text, or the whole refusal. */
  lineLabel: string;
  empty: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    model: Model;
  }
}

/** Where the game's events stand. */
type Source = "waiting" | "available" | "unavailable" | "refused";

interface Inputs {
  ticks: Ticks;
  world: WarframeWorld | null;
  worldStatus: "available" | "unavailable" | "undeclared";
  source: Source;
  tracked: Record<ActivityId, boolean>;
  baro: boolean;
  now: number;
}

/** "6 h", "3 j 14 h", "42 min": a duration, never written as a time of day. */
export function inTime(ms: number): string {
  if (ms < HOUR) return t("in-minutes", { minutes: Math.max(1, Math.ceil(ms / MINUTE)) });
  const hours = Math.round(ms / HOUR);
  if (hours <= 24) return t("in-hours", { hours });
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? t("in-whole-days", { days }) : t("in-days", { days, hours: hours % 24 });
}

const sameLocalDay = (a: number, b: number): boolean => {
  const x = localTime(a);
  const y = localTime(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/** "09:12" today, "mar. 21:42" another day. */
export function when(at: number, now: number): string {
  if (sameLocalDay(at, now)) return formatTime(at);
  return t("weekday-time", { day: t(`weekday-${localTime(at).weekday}`), time: formatTime(at) });
}

/** "ven. 14:00" within the week, "ven. 13 nov. 14:00" beyond. */
function dayAndTime(at: number, now: number): string {
  const local = localTime(at);
  const params = { day: t(`weekday-${local.weekday}`), time: formatTime(at) };
  if (at - now < 6 * DAY) return t("weekday-time", params);
  return t("date-time", { ...params, date: local.day, month: t(`month-${local.month}`) });
}

const names = (list: readonly (string | null)[]): string => list.filter((name) => name !== null && name !== "").join(", ");

const typeNames = (missions: readonly WarframeWorldMission[], keep: (index: number) => boolean): string =>
  names(missions.filter((_, index) => keep(index)).map((mission) => mission.type?.name ?? mission.node.name));

/** The Sortie or the Archon Hunt of the world while it runs: just after a reset the world may still hold the last one. */
function current<T extends { endsAt: number }>(list: T | null | undefined, now: number): T | null {
  return list !== null && list !== undefined && list.endsAt > now ? list : null;
}

function subOf(id: ActivityId, activity: Activity, world: WarframeWorld | null, now: number): string {
  if (activity.done !== null) return "";
  const counted = activity.parts.filter((part) => part !== 0).length;
  switch (id) {
    case "sortie":
    case "archon": {
      const running = id === "sortie" ? current(world?.sortie, now) : current(world?.archonHunt, now);
      const missions = running?.missions ?? [];
      if (counted > 0) {
        const left = typeNames(missions, (index) => activity.parts[index] === 0);
        return left === "" ? "" : t("remaining", { list: left });
      }
      const list = typeNames(missions, () => true);
      const boss = id === "archon" ? current(world?.archonHunt, now)?.boss.name ?? null : null;
      return boss !== null && list !== "" ? t("boss-list", { boss, list }) : list;
    }
    case "circuit":
      return names(world?.circuit?.normal.map((reward) => reward.name) ?? []);
    case "nightwave":
      return t("nightwave-sub");
    default:
      return "";
  }
}

function rowOf(id: ActivityId, inputs: Inputs): Row {
  const activity = inputs.ticks.activities[id];
  const name = t(`activity-${id}`);
  const sub = subOf(id, activity, inputs.world, inputs.now);
  const base = { id, name, sub, byHand: false };
  if (activity.done !== null) {
    const fresh = !activity.done.hand && inputs.now - activity.done.at < FRESH_MS;
    const value = fresh ? t("just-now") : when(activity.done.at, inputs.now);
    return {
      ...base,
      icon: "circle-check",
      iconCls: "check-icon done",
      value,
      valueCls: fresh ? "row-value when tone-success" : "row-value when",
      byHand: activity.done.hand,
      rowCls: fresh ? "item done fresh" : "item done",
      label: t(activity.done.hand ? "label-done-hand" : "label-done", { name, when: value }),
    };
  }
  const counted = activity.parts.filter((part) => part !== 0).length;
  // Without the game's events a count of 0 says nothing: no "0/3".
  const value =
    PARTS[id] === 0 || (counted === 0 && (inputs.source === "unavailable" || inputs.source === "refused"))
      ? ""
      : `${counted}/${PARTS[id]}`;
  const partial = counted > 0;
  return {
    ...base,
    icon: partial ? "circle-dashed" : "circle",
    iconCls: partial ? "check-icon part" : "check-icon todo",
    value,
    valueCls: "row-value",
    rowCls: "item",
    label: t(value === "" ? "label-todo" : "label-count", { name, count: value }),
  };
}

function baroOf(inputs: Inputs): { text: string; here: boolean } {
  const trader = inputs.world?.voidTrader ?? null;
  if (!inputs.baro || trader === null || inputs.now >= trader.leavesAt) return { text: "", here: false };
  const relay = trader.relay?.name ?? null;
  if (inputs.now >= trader.arrivesAt) {
    const leaves = dayAndTime(trader.leavesAt, inputs.now);
    return {
      text: relay === null ? t("baro-here", { leaves }) : t("baro-here-at", { relay, leaves }),
      here: true,
    };
  }
  const arrives = dayAndTime(trader.arrivesAt, inputs.now);
  return { text: relay === null ? t("baro-arrives", { arrives }) : t("baro-arrives-at", { arrives, relay }), here: false };
}

/** What the view shows, from the ticks, the world and the options. */
export function buildModel(inputs: Inputs): Model {
  const { ticks, now } = inputs;
  const groups: Group[] = [];
  for (const period of ["day", "week"] as const) {
    const ids = ACTIVITIES.filter((id) => PERIOD[id] === period && inputs.tracked[id]);
    if (ids.length === 0) continue;
    const end = period === "day" ? ticks.dayEnd : ticks.weekEnd;
    groups.push({
      id: period,
      title: t(period === "day" ? "today" : "this-week"),
      reset: t("resets-in", { in: inTime(end - now) }),
      rows: ids.map((id) => rowOf(id, inputs)),
    });
  }
  const rows = groups.flatMap((group) => group.rows);
  const left = rows.filter((row) => ticks.activities[row.id].done === null).length;
  const baro = baroOf(inputs);

  let hint = "";
  let hintIcon = "";
  let hintTone = "muted";
  if (inputs.source === "refused") {
    [hint, hintIcon, hintTone] = [t("hint-refused"), "circle-alert", "warning"];
  } else if (inputs.source === "unavailable") {
    [hint, hintIcon, hintTone] = [t("hint-unavailable"), "circle-alert", "warning"];
  } else if (!ticks.intro && rows.length > 0) {
    [hint, hintIcon] = [t("hint-first-run"), "info"];
  }

  let status = "";
  if (inputs.world !== null && now - inputs.world.updatedAt > STALE_MS) {
    status = t("offline-since", { when: when(inputs.world.updatedAt, now) });
  } else if (inputs.world === null && inputs.worldStatus === "unavailable") {
    status = t("offline");
  }

  // The one line: the latest activity a mission just finished, else what is left.
  const fresh = rows
    .filter((row) => row.rowCls.includes("fresh"))
    .sort((a, b) => (ticks.activities[b.id].done?.at ?? 0) - (ticks.activities[a.id].done?.at ?? 0))[0];
  const count = left === 0 ? t("all-done") : t("to-do", { count: left });
  const firstReset = groups[0];
  const nextReset =
    firstReset === undefined
      ? ""
      : t(firstReset.id === "day" ? "line-reset-sortie" : "line-reset-week", { in: inTime((firstReset.id === "day" ? ticks.dayEnd : ticks.weekEnd) - now) });
  const success = fresh !== undefined || left === 0;
  // Refused: the count stays, the way to fix it comes beside it, in amber.
  const refused = inputs.source === "refused";

  // One line, refused: beside a value, only "Access denied"; without one,
  // where to fix it. The whole sentence stays in the label and in Full.
  const line = rows.length === 0 ? (refused ? t("line-refused-full") : t("line-empty")) : fresh !== undefined ? t(`fresh-${fresh.id}`) : count;
  const lineValue = rows.length === 0 ? "" : refused ? t("line-refused") : fresh !== undefined ? count : nextReset;

  return {
    left: rows.length === 0 ? "" : count,
    leftCls: left === 0 ? "left all" : "left",
    groups,
    baro: baro.text,
    baroHere: baro.here,
    hint,
    hintIcon,
    hintTone,
    status,
    line,
    lineValue,
    lineValueCls: refused ? "line-reset tone-warning" : "line-reset",
    lineCls:
      rows.length === 0 && refused ? "line-main tone-warning" : rows.length > 0 && success ? "line-main tone-success" : "line-main",
    lineLabel: refused ? `${lineValue === "" ? line : `${line} · ${lineValue}`}. ${t("hint-refused")}` : lineValue === "" ? line : `${line} · ${lineValue}`,
    empty: rows.length === 0,
  };
}

// The widget.

let ticks = emptyTicks();
let loaded = false;
let lastSeq = 0;
let world: WarframeWorld | null = null;
let worldStatus: Inputs["worldStatus"] = "available";
let source: Source = "waiting";

function tracked(): Record<ActivityId, boolean> {
  const result = {} as Record<ActivityId, boolean>;
  for (const id of ACTIVITIES) result[id] = option(`track-${id}`, true);
  return result;
}

function refresh(): void {
  state.model = buildModel({
    ticks,
    world,
    worldStatus,
    source,
    tracked: tracked(),
    baro: option("track-baro", true),
    now: Date.now(),
  });
}

function save(): void {
  void storage.set({ key: STORAGE_KEY, value: ticks as unknown as JsonValue }).catch(() => null);
}

/** Handles a value of the game's events: the world, then the missions not handled yet. */
export function receive(value: WarframeEvents): void {
  world = value.info.world ?? world;
  worldStatus = value.features.world;
  source = value.features.mission === "available" ? "available" : "unavailable";
  let changed = roll(ticks, world, Date.now());
  for (const event of value.events) {
    if (event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    if (event.type !== "mission_ended" || event.at <= ticks.lastAt) continue;
    ticks.lastAt = event.at;
    handleMission(ticks, event.mission, event.at, world);
    changed = true;
  }
  if (changed) save();
  refresh();
}

/** A click on an activity, in Interactive mode. */
export function check(id: ActivityId): void {
  if (!loaded) return;
  roll(ticks, world, Date.now());
  toggle(ticks, id, Date.now());
  save();
  refresh();
}

/** "line", or "wide" (two columns) or "standard"; the width alone decides. */
export function layout(): string {
  if (option("layout", "full") === "line") return "line";
  return host.viewport.width >= WIDE_PX ? "wide" : "standard";
}

export function rootClass(): string {
  return `wf checklist ${layout()}`;
}

export function hasText(text: string): boolean {
  return text !== "";
}

/** Wide: Baro sits under the first list, the short one. */
export function baroIn(model: Model, groupId: string): string {
  return layout() === "wide" && model.groups[0]?.id === groupId ? model.baro : "";
}

const state = initState({ model: buildModel({ ticks, world, worldStatus, source, tracked: tracked(), baro: true, now: Date.now() }) });

onHost((changed) => {
  if (changed.includes("options") || changed.includes("locale") || changed.includes("region")) refresh();
});

// Every minute: the resets count down, "just now" ages, a period may end.
timers.atEach("minute", () => {
  if (loaded && roll(ticks, world, Date.now())) save();
  refresh();
});

async function start(): Promise<void> {
  ticks = readTicks(await storage.get({ key: STORAGE_KEY }).catch(() => null));
  loaded = true;
  if (roll(ticks, world, Date.now())) save();
  refresh();
  gameEvents.warframe.subscribe((update) => {
    if (update.ok) {
      receive(update.value);
      return;
    }
    source = update.error.code === "permission_denied" ? "refused" : "unavailable";
    refresh();
  });
}

void start();
