// Warframe dailies and weeklies: what is left to do today and this week,
// and when it resets, a box per part (a stage, a Netracell, a Nightwave
// challenge). The world (Sortie, Archon Hunt, Circuit, Nightwave, Baro
// Ki'Teer) comes from PlayerVox OverCrow even with the game closed. A
// finished mission, a pick the game showed or a challenge it wrote
// complete ticks itself; the player's hand always wins.
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
  type WarframeGlossary,
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
/** An activity a game event just finished shows "just now" this long. */
export const FRESH_MS = 5 * MINUTE;
/** The world is old ("offline") when the host has not read it for this long; it reads it every 5 minutes. */
export const STALE_MS = 15 * MINUTE;
/** The widget becomes "wide" (two columns) from this width, logical px. */
const WIDE_PX = 560;
const STORAGE_KEY = "ticks";
/** Nightwave challenges kept at most (the world gives 16 at most; old ones go at their end). */
const MAX_KEPT_CHALLENGES = 64;
/** The longest ID or name kept in storage, in characters. */
const MAX_TEXT = 256;

/** The activities, in their order on screen. */
export const ACTIVITIES = ["sortie", "archon", "netracells", "circuit", "steel", "nightwave"] as const;
export type ActivityId = (typeof ACTIVITIES)[number];
type Period = "day" | "week";
const PERIOD: Record<ActivityId, Period> = {
  sortie: "day",
  archon: "week",
  netracells: "week",
  circuit: "week",
  steel: "week",
  nightwave: "week",
};
/** The menu row that tracks each activity. */
const TRACK: Record<ActivityId, string> = {
  sortie: "track-sortie",
  archon: "track-archon",
  netracells: "track-netracells",
  circuit: "track-circuit",
  steel: "track-circuit-steel",
  nightwave: "track-nightwave",
};
const STAGES = 3;
const CELLS = 5;
type Staged = "sortie" | "archon";
type Circuit = "circuit" | "steel";
/** How many rewards the player picks a week: one Warframe, two Incarnon adapters. */
const PICKS: Record<Circuit, number> = { circuit: 1, steel: 2 };

// Storage.

/**
 * A part (a stage, a Netracell, a challenge): `at` when the game ticked it
 * (0: not), and what the player set by hand, which always wins: `hand`
 * `true` or `false`, absent when never set, at `handAt`.
 */
export interface Part {
  at: number;
  hand?: boolean;
  handAt?: number;
}
/** A mission type the game told only at loading, kept with its stage and node. */
export interface Learned {
  node: string;
  id: string;
  name: string;
}
export interface Stages {
  parts: Part[];
  types: (Learned | null)[];
}
/** The Circuit's picks: what the game showed this week, and the player's own, which wins. */
export interface Picks {
  auto: string[];
  hand: string[] | null;
}
export interface CircuitTicks {
  /** When the player ticked it (0: not): only a click ticks it. */
  done: number;
  picks: Picks;
}
/** A Nightwave challenge, kept until it ends. */
export interface Challenge extends Part {
  endsAt: number;
}
/** What the widget keeps between runs. */
export interface Ticks {
  v: 2;
  /** The `at` of the last mission event handled: a restart never ticks it twice. */
  lastAt: number;
  /** When the day's period ends (the Sortie's reset). */
  dayEnd: number;
  /** When the week's period ends (Monday 00:00 UTC). */
  weekEnd: number;
  sortie: Stages;
  archon: Stages;
  netracells: Part[];
  circuit: CircuitTicks;
  steel: CircuitTicks;
  /** By challenge ID. */
  nightwave: Record<string, Challenge>;
}

const freshParts = (count: number): Part[] => Array.from({ length: count }, () => ({ at: 0 }));
const freshStages = (): Stages => ({ parts: freshParts(STAGES), types: new Array<Learned | null>(STAGES).fill(null) });
const freshCircuit = (): CircuitTicks => ({ done: 0, picks: { auto: [], hand: null } });

export function emptyTicks(): Ticks {
  return {
    v: 2,
    lastAt: 0,
    dayEnd: 0,
    weekEnd: 0,
    sortie: freshStages(),
    archon: freshStages(),
    netracells: freshParts(CELLS),
    circuit: freshCircuit(),
    steel: freshCircuit(),
    nightwave: {},
  };
}

const time = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" && value.length <= MAX_TEXT ? value : null;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function readPart(value: unknown): Part {
  const raw = record(value);
  const part: Part = { at: time(raw?.at) };
  if (typeof raw?.hand === "boolean") {
    part.hand = raw.hand;
    part.handAt = time(raw.handAt);
  }
  return part;
}

function readParts(value: unknown, count: number): Part[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => readPart(list[index]));
}

function readStages(value: unknown): Stages {
  const raw = record(value);
  const types = Array.isArray(raw?.types) ? raw.types : [];
  return {
    parts: readParts(raw?.parts, STAGES),
    types: Array.from({ length: STAGES }, (_, index) => {
      const one = record(types[index]);
      const node = text(one?.node);
      const id = text(one?.id);
      const name = text(one?.name);
      return node !== null && id !== null && name !== null ? { node, id, name } : null;
    }),
  };
}

const ids = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.map(text).filter((id): id is string => id !== null).slice(0, max) : [];

function readCircuit(value: unknown, id: Circuit): CircuitTicks {
  const raw = record(value);
  const picks = record(raw?.picks);
  return {
    done: time(raw?.done),
    picks: { auto: ids(picks?.auto, PICKS[id]), hand: Array.isArray(picks?.hand) ? ids(picks.hand, PICKS[id]) : null },
  };
}

/** The stored ticks, checked member by member: anything else starts empty (no older format to read). */
export function readTicks(value: unknown): Ticks {
  const ticks = emptyTicks();
  const raw = record(value);
  if (raw === null || raw.v !== 2) return ticks;
  ticks.lastAt = time(raw.lastAt);
  ticks.dayEnd = time(raw.dayEnd);
  ticks.weekEnd = time(raw.weekEnd);
  ticks.sortie = readStages(raw.sortie);
  ticks.archon = readStages(raw.archon);
  ticks.netracells = readParts(raw.netracells, CELLS);
  ticks.circuit = readCircuit(raw.circuit, "circuit");
  ticks.steel = readCircuit(raw.steel, "steel");
  const challenges = record(raw.nightwave) ?? {};
  for (const [id, one] of Object.entries(challenges).slice(0, MAX_KEPT_CHALLENGES)) {
    const endsAt = time(record(one)?.endsAt);
    if (text(id) !== null && endsAt > 0) ticks.nightwave[id] = { ...readPart(one), endsAt };
  }
  return ticks;
}

// Parts.

/** Done: what the hand set, else what the game ticked. */
export const isDone = (part: Part): boolean => part.hand ?? part.at > 0;
/** When it was done; 0 when it is not. */
const doneAt = (part: Part): number => (part.hand === true ? part.handAt ?? 0 : part.hand === false ? 0 : part.at);
/** Set by hand against what the game says: the hand shows. */
export const contradicted = (part: Part): boolean => part.hand !== undefined && part.hand !== part.at > 0;

/** A click on a part: the hand sets the other state. */
function flip(part: Part, now: number): void {
  part.hand = !isDone(part);
  part.handAt = now;
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

/** Starts a new period for each one that ended, and forgets the challenges that ended. Returns whether anything changed. */
export function roll(ticks: Ticks, world: WarframeWorld | null, now: number): boolean {
  let changed = false;
  if (now >= ticks.dayEnd) {
    ticks.dayEnd = dayEndOf(world, now);
    ticks.sortie = freshStages();
    changed = true;
  }
  if (now >= ticks.weekEnd) {
    ticks.weekEnd = weekEndOf(world, now);
    ticks.archon = freshStages();
    ticks.netracells = freshParts(CELLS);
    ticks.circuit = freshCircuit();
    ticks.steel = freshCircuit();
    changed = true;
  }
  for (const [id, challenge] of Object.entries(ticks.nightwave)) {
    if (challenge.endsAt <= now) {
      delete ticks.nightwave[id];
      changed = true;
    }
  }
  return changed;
}

const periodHas = (ticks: Ticks, period: Period, at: number): boolean =>
  period === "day" ? at >= ticks.dayEnd - DAY && at < ticks.dayEnd : at >= ticks.weekEnd - WEEK && at < ticks.weekEnd;

// What the game tells.

/** The Sortie or the Archon Hunt of the world while it runs: just after a reset the world may still hold the last one. */
function current<T extends { endsAt: number }>(list: T | null | undefined, now: number): T | null {
  return list !== null && list !== undefined && list.endsAt > now ? list : null;
}

/** The stage (1 to 3) of a mission in a list of the world, by its node. */
function stageByNode(missions: readonly WarframeWorldMission[] | undefined, node: string): number | null {
  const index = missions?.findIndex((mission) => mission.node.id === node) ?? -1;
  return index >= 0 && index < STAGES ? index + 1 : null;
}

/** The game ticks a part; a part set by hand stays as the hand set it. */
function tickAuto(part: Part | undefined, at: number): boolean {
  if (part === undefined || part.at !== 0) return false;
  part.at = at;
  return true;
}

/** The staged activities a mission belongs to, with its stage. */
function stagesOf(mission: WarframeMission, world: WarframeWorld | null, at: number): { id: Staged; stage: number }[] {
  const found: { id: Staged; stage: number }[] = [];
  for (const modifier of mission.modifiers) {
    const id: Staged | null = modifier.id === "sortie" ? "sortie" : modifier.id === "archon_hunt" ? "archon" : null;
    if (id === null) continue;
    const list = current(id === "sortie" ? world?.sortie : world?.archonHunt, at);
    const stage = modifier.stage ?? stageByNode(list?.missions, mission.node.id);
    if (stage !== null && stage >= 1 && stage <= STAGES) found.push({ id, stage });
  }
  return found;
}

/**
 * Ticks what a mission that ended at `at` did: a stage of the Sortie or of
 * the Archon Hunt, or a Netracell. Only a success counts, once, in the
 * period it happened. Returns whether anything changed.
 */
export function handleMission(ticks: Ticks, mission: WarframeMission, at: number, world: WarframeWorld | null): boolean {
  if (mission.result !== "succeeded") return false;
  let changed = false;
  for (const { id, stage } of stagesOf(mission, world, at)) {
    if (periodHas(ticks, PERIOD[id], at)) changed = tickAuto(ticks[id].parts[stage - 1], at) || changed;
  }
  if (mission.type?.id === "netracell" && periodHas(ticks, "week", at)) {
    // The next free cell; one set by hand only when none is left.
    const cells = ticks.netracells;
    const free = cells.find((cell) => cell.at === 0 && cell.hand === undefined) ?? cells.find((cell) => cell.at === 0);
    changed = tickAuto(free, at) || changed;
  }
  return changed;
}

/**
 * Keeps the type the game chose at loading for a stage whose published
 * type it replaces: it survives a restart of the game, until the reset.
 */
export function learnType(ticks: Ticks, mission: WarframeMission, world: WarframeWorld | null, now: number): boolean {
  const type = mission.type;
  if (!mission.typeAtLoading || type === null || type.name === null) return false;
  let changed = false;
  for (const { id, stage } of stagesOf(mission, world, now)) {
    const kept = ticks[id].types[stage - 1];
    if (kept?.node === mission.node.id && kept.id === type.id && kept.name === type.name) continue;
    ticks[id].types[stage - 1] = { node: mission.node.id, id: type.id, name: type.name };
    changed = true;
  }
  return changed;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * What the world tells this week: the Circuit's picks the game showed, and
 * the Nightwave challenges it wrote complete, kept until they end.
 */
export function syncWorld(ticks: Ticks, world: WarframeWorld | null, now: number): boolean {
  let changed = false;
  const circuit = world?.circuit ?? null;
  if (circuit !== null) {
    for (const [id, offered, picked] of [
      ["circuit", circuit.normal, circuit.picked.normal],
      ["steel", circuit.steelPath, circuit.picked.steelPath],
    ] as const) {
      const seen = picked.filter((pick) => offered.some((reward) => reward.id === pick)).slice(0, PICKS[id]);
      if (seen.length > 0 && !sameSet(seen, ticks[id].picks.auto)) {
        ticks[id].picks.auto = [...seen];
        changed = true;
      }
    }
  }
  for (const challenge of world?.nightwave?.challenges ?? []) {
    if (!challenge.completed || challenge.endsAt <= now) continue;
    const kept = ticks.nightwave[challenge.id];
    if (kept === undefined) {
      if (Object.keys(ticks.nightwave).length >= MAX_KEPT_CHALLENGES) continue;
      ticks.nightwave[challenge.id] = { at: now, endsAt: challenge.endsAt };
      changed = true;
    } else if (kept.at === 0) {
      kept.at = now;
      changed = true;
    }
  }
  return changed;
}

// Clicks.

/** The challenges of the world that have not ended. */
function challengesOf(world: WarframeWorld | null, now: number): NonNullable<WarframeWorld["nightwave"]>["challenges"] {
  return (world?.nightwave?.challenges ?? []).filter((challenge) => challenge.endsAt > now);
}

/** A click on a part: `sortie.1`, `netracells.4`, `nightwave.<challenge>`. Returns whether anything changed. */
export function tickPart(ticks: Ticks, id: string, world: WarframeWorld | null, now: number): boolean {
  const dot = id.indexOf(".");
  const activity = id.slice(0, dot);
  const key = id.slice(dot + 1);
  if (activity === "nightwave") {
    const challenge = challengesOf(world, now).find((each) => each.id === key);
    if (challenge === undefined) return false;
    let kept = ticks.nightwave[key];
    if (kept === undefined) {
      if (Object.keys(ticks.nightwave).length >= MAX_KEPT_CHALLENGES) return false;
      kept = { at: 0, endsAt: challenge.endsAt };
      ticks.nightwave[key] = kept;
    }
    flip(kept, now);
    return true;
  }
  const parts = activity === "sortie" || activity === "archon" ? ticks[activity].parts : activity === "netracells" ? ticks.netracells : null;
  const part = parts?.[Number(key)];
  if (part === undefined || !/^\d$/.test(key)) return false;
  flip(part, now);
  return true;
}

/** A click on the Circuit's own box: only a click ticks it. */
export function toggleActivity(ticks: Ticks, id: string, now: number): boolean {
  if (id !== "circuit" && id !== "steel") return false;
  ticks[id].done = ticks[id].done === 0 ? now : 0;
  return true;
}

/** The picks shown: the player's, else the game's. */
const picksOf = (picks: Picks): string[] => picks.hand ?? picks.auto;

/**
 * A click on a reward of the Circuit (`circuit.<id>`, `steel.<id>`): picks
 * it, or takes it back. One Warframe, two Incarnon adapters: a new pick
 * beyond replaces the oldest. Returns whether anything changed.
 */
export function pick(ticks: Ticks, id: string, world: WarframeWorld | null): boolean {
  const dot = id.indexOf(".");
  const which = id.slice(0, dot);
  const reward = id.slice(dot + 1);
  if (which !== "circuit" && which !== "steel") return false;
  const offered = which === "circuit" ? world?.circuit?.normal : world?.circuit?.steelPath;
  if (offered === undefined || !offered.some((each) => each.id === reward)) return false;
  const picks = picksOf(ticks[which].picks).filter((each) => offered.some((one) => one.id === each));
  const next = picks.includes(reward) ? picks.filter((each) => each !== reward) : [...picks, reward].slice(-PICKS[which]);
  ticks[which].picks.hand = next;
  return true;
}

// The view model.

export interface PartView {
  id: string;
  text: string;
  icon: string;
  iconCls: string;
  textCls: string;
  /** Set by hand against the game: the hand in the right column. */
  hand: boolean;
  label: string;
}
export interface GroupView {
  id: string;
  /** "Daily", "Weekly", "Elite" for Nightwave; empty otherwise. */
  title: string;
  /** `parts` (one under the other) or `cells` (a row). */
  cls: string;
  parts: PartView[];
  /** A row of cells: the hand at its end. */
  hand: boolean;
}
export interface ChoiceView {
  id: string;
  text: string;
  cls: string;
  /** A "·" between two names (Passive only). */
  sep: boolean;
  label: string;
}
export interface ActView {
  id: ActivityId;
  name: string;
  icon: string;
  iconCls: string;
  value: string;
  valueCls: string;
  /** One quiet line under the name ("List when back online"). */
  meta: string;
  /** The Archon Shard: its image, or our icon when none will come; the Archon's name beside it. */
  shard: string;
  shardGlyph: string;
  shardText: string;
  choices: ChoiceView[];
  /** The player's picks override what the game showed: the hand at the end of the names. */
  choicesHand: boolean;
  groups: GroupView[];
  /** "+ 4 challenges": what Passive folds at the end of a long list. */
  more: string;
  /** The box of the activity itself is the button (the Circuit). */
  toggle: boolean;
  cls: string;
  label: string;
}
export interface Section {
  id: string;
  title: string;
  reset: string;
  acts: ActView[];
}
export interface Column {
  id: string;
  groups: Section[];
}
export interface Model {
  left: string;
  leftCls: string;
  cols: Column[];
  baro: string;
  baroHere: boolean;
  hint: string;
  hintIcon: string;
  hintTone: string;
  status: string;
  /** Interactive only: what ticks itself, and what to do otherwise. */
  note: string;
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

export interface Inputs {
  ticks: Ticks;
  world: WarframeWorld | null;
  worldStatus: "available" | "unavailable" | "undeclared";
  source: Source;
  tracked: Record<ActivityId, boolean>;
  baro: boolean;
  now: number;
  interactive: boolean;
  /** The content's width, logical px. */
  width: number;
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

/** A name of the game that never breaks inside: a line wraps between names, not in one. */
const whole = (name: string): string => name.replaceAll(" ", " ");

/** The game's activities this widget names, from the glossary of the subscription. */
type Glossary = {
  readonly activity: Pick<WarframeGlossary["activity"], "sortie" | "archon_hunt" | "netracells" | "circuit" | "nightwave" | "baro_ki_teer" | "steel_path">;
};

/**
 * The game's English names, as PlayerVox OverCrow falls back to them, until
 * the first value brings the game's own (a refusal brings none).
 */
const ENGLISH: Glossary = {
  activity: {
    sortie: "Sortie",
    archon_hunt: "Archon Hunt",
    netracells: "Netracells",
    circuit: "The Circuit",
    nightwave: "Nightwave",
    baro_ki_teer: "Baro Ki'Teer",
    steel_path: "The Steel Path",
  },
};

let glossary: Glossary = ENGLISH;

/**
 * The name of a term of the game by its ID, in the game's language. The
 * one place that names them: no name of the game is in the locales.
 */
function gameName(id: keyof Glossary["activity"]): string {
  return glossary.activity[id];
}

/** An activity's name; the Steel Path's Circuit says both. */
export function activityName(id: ActivityId): string {
  switch (id) {
    case "archon":
      return gameName("archon_hunt");
    case "steel":
      // "The Circuit · Steel Path": the mode's name without its article.
      return `${gameName("circuit")} · ${gameName("steel_path").replace(/^(The|La) /, "")}`;
    default:
      return gameName(id);
  }
}

/** The Archon's own name: "Boreal" of "Archon Boreal", as the game's words end with it. */
function archonShort(name: string | null): string {
  if (name === null) return "";
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}

/** A part's icon and classes: done (green check, struck through), progressed this session (dotted circle), or to do. */
function partView(id: string, label: string, textValue: string, done: boolean, opts: { going?: boolean; pending?: boolean; hand?: boolean } = {}): PartView {
  const going = !done && opts.going === true;
  const base = t(done ? "label-done-short" : "label-todo", { name: label });
  return {
    id,
    text: textValue,
    icon: done ? "circle-check" : going ? "circle-dot" : "circle",
    iconCls: done ? "part-icon done" : going ? "part-icon part-going" : "part-icon",
    textCls: `part-text${done ? " done" : ""}${opts.pending === true ? " pending" : ""}`,
    hand: opts.hand === true,
    label: opts.hand === true ? t("label-by-hand", { label: base }) : base,
  };
}

/** The text of a stage: its type, the type the game told at loading, "Morax · Europa" until then, or "1st mission" without the world. */
function stageText(mission: WarframeWorldMission | undefined, learned: Learned | null, index: number): { text: string; pending: boolean } {
  if (mission === undefined) return { text: t(`stage-${index + 1}`), pending: true };
  if (mission.type?.name !== null && mission.type?.name !== undefined) return { text: mission.type.name, pending: false };
  if (learned !== null && learned.node === mission.node.id) return { text: learned.name, pending: false };
  const node = mission.node.name;
  if (node === null) return { text: t(`stage-${index + 1}`), pending: true };
  const planet = mission.planet?.name ?? null;
  return { text: planet === null ? node : `${node} · ${planet}`, pending: true };
}

interface Built {
  act: ActView;
  done: boolean;
  /** When it was done, and whether the game's tick did it (for "just now"). */
  at: number;
  auto: boolean;
}

/** An activity's head: its icon, its count or the time it was done. */
function headOf(id: ActivityId, inputs: Inputs, counted: number, total: number, done: boolean, at: number, auto: boolean, count: boolean): Pick<ActView, "icon" | "iconCls" | "value" | "valueCls" | "cls" | "label"> & { fresh: boolean } {
  const name = activityName(id);
  if (done) {
    const fresh = auto && inputs.now - at < FRESH_MS;
    const value = at === 0 ? "" : fresh ? t("just-now") : when(at, inputs.now);
    return {
      icon: "circle-check",
      iconCls: "check-icon done",
      value,
      valueCls: fresh ? "row-value when tone-success" : "row-value when",
      cls: "act done",
      label: value === "" ? t("label-done-short", { name }) : t("label-done", { name, when: value }),
      fresh,
    };
  }
  const value = count && total > 0 ? `${counted}/${total}` : "";
  return {
    icon: counted > 0 ? "circle-dashed" : "circle",
    iconCls: counted > 0 ? "check-icon part" : "check-icon todo",
    value,
    valueCls: "row-value",
    cls: "act",
    label: t(value === "" ? "label-todo" : "label-count", { name, count: value }),
    fresh: false,
  };
}

const blankAct = (id: ActivityId): ActView => ({
  id,
  name: activityName(id),
  icon: "circle",
  iconCls: "check-icon todo",
  value: "",
  valueCls: "row-value",
  meta: "",
  shard: "",
  shardGlyph: "",
  shardText: "",
  choices: [],
  choicesHand: false,
  groups: [],
  more: "",
  toggle: false,
  cls: "act",
  label: "",
});

/** The latest time among done parts, and whether the game's tick was the last. */
function lastOf(parts: readonly Part[]): { at: number; auto: boolean } {
  let at = 0;
  let auto = false;
  for (const part of parts) {
    const each = doneAt(part);
    if (each >= at) {
      at = each;
      auto = part.hand === undefined;
    }
  }
  return { at, auto };
}

function stagedAct(id: Staged, inputs: Inputs): Built {
  const { ticks, now } = inputs;
  const stages = ticks[id];
  const list = id === "sortie" ? current(inputs.world?.sortie, now) : current(inputs.world?.archonHunt, now);
  const parts = stages.parts.map((part, index) => {
    const shown = stageText(list?.missions[index], stages.types[index] ?? null, index);
    return partView(`${id}.${index}`, shown.text, shown.text, isDone(part), { pending: shown.pending, hand: contradicted(part) });
  });
  const counted = stages.parts.filter(isDone).length;
  const done = counted === STAGES;
  const last = lastOf(stages.parts);
  const head = headOf(id, inputs, counted, STAGES, done, last.at, last.auto, true);
  const act: ActView = { ...blankAct(id), ...head, groups: [{ id: "stages", title: "", cls: "parts", parts, hand: false }] };
  if (id === "archon" && !done && list !== null) {
    const hunt = inputs.world?.archonHunt ?? null;
    const shard = hunt?.shard ?? null;
    if (shard !== null) {
      act.shard = shard.icon ?? "";
      act.shardGlyph = shard.icon === null && !shard.iconPending ? "gem" : "";
      act.shardText = archonShort(hunt?.boss.name ?? null);
    }
  }
  return { act, done, at: last.at, auto: last.auto };
}

function netracellsAct(inputs: Inputs): Built {
  const cells = inputs.ticks.netracells;
  const parts = cells.map((cell, index) => {
    // The label says the hand; the icon shows once, at the end of the row.
    const view = partView(`netracells.${index}`, t("cell", { n: index + 1 }), "", isDone(cell), { hand: contradicted(cell) });
    return { ...view, hand: false };
  });
  const counted = cells.filter(isDone).length;
  const done = counted === CELLS;
  const last = lastOf(cells);
  const head = headOf("netracells", inputs, counted, CELLS, done, last.at, last.auto, true);
  const hand = cells.some(contradicted);
  return {
    act: { ...blankAct("netracells"), ...head, groups: [{ id: "cells", title: "", cls: "cells", parts, hand }] },
    done,
    at: last.at,
    auto: last.auto,
  };
}

function circuitAct(id: Circuit, inputs: Inputs): Built {
  const circuit = inputs.ticks[id];
  const offered = (id === "circuit" ? inputs.world?.circuit?.normal : inputs.world?.circuit?.steelPath) ?? [];
  const done = circuit.done !== 0;
  const picks = picksOf(circuit.picks).filter((each) => offered.some((reward) => reward.id === each));
  const choices: ChoiceView[] = [];
  for (const reward of offered) {
    if (reward.name === null) continue;
    if (choices.length > 0) choices.push({ id: `sep-${reward.id}`, text: "·", cls: "choice-sep", sep: true, label: "" });
    const picked = picks.includes(reward.id);
    const cls = done ? "choice other" : picks.length === 0 ? "choice" : picked ? "choice picked" : "choice other";
    choices.push({
      id: `${id}.${reward.id}`,
      text: reward.name,
      cls,
      sep: false,
      label: t(picked ? "label-picked" : "label-pick", { name: reward.name }),
    });
  }
  const head = headOf(id, inputs, 0, 0, done, circuit.done, false, false);
  const hand = circuit.picks.hand !== null && !sameSet(picks, circuit.picks.auto.filter((each) => offered.some((reward) => reward.id === each)));
  return {
    act: { ...blankAct(id), ...head, toggle: true, choices, choicesHand: hand },
    done,
    at: circuit.done,
    auto: false,
  };
}

const KINDS = ["daily", "weekly", "elite"] as const;

function nightwaveAct(inputs: Inputs): Built {
  const { ticks, now } = inputs;
  const season = inputs.world?.nightwave ?? null;
  if (season === null) {
    return { act: { ...blankAct("nightwave"), meta: t("nightwave-waiting"), label: t("label-todo", { name: activityName("nightwave") }) }, done: false, at: 0, auto: false };
  }
  const challenges = challengesOf(inputs.world, now);
  const kept = (id: string): Part => ticks.nightwave[id] ?? { at: 0 };
  const groups: GroupView[] = [];
  for (const kind of KINDS) {
    const parts = challenges
      .filter((challenge) => challenge.kind === kind)
      .map((challenge) => {
        const part = kept(challenge.id);
        return partView(`nightwave.${challenge.id}`, challenge.name, challenge.name, isDone(part), {
          going: challenge.progressed,
          hand: contradicted(part),
        });
      });
    if (parts.length > 0) groups.push({ id: kind, title: t(`kind-${kind}`), cls: "parts", parts, hand: false });
  }
  const states = challenges.map((challenge) => kept(challenge.id));
  const counted = states.filter(isDone).length;
  const done = challenges.length > 0 && counted === challenges.length;
  const last = lastOf(states);
  const head = headOf("nightwave", inputs, counted, challenges.length, done, last.at, last.auto, true);
  return { act: { ...blankAct("nightwave"), ...head, groups }, done, at: last.at, auto: last.auto };
}

// Heights, logical px, for the Passive fold: the box model of style.ocss.
const H = {
  /** The panel's padding, top and bottom. */
  pad: 20,
  /** Between the panel's blocks (header, hint, lists, Baro, status, note). */
  gap: 6,
  header: 17,
  hint: 16,
  status: 14,
  /** Baro's line, its rule and padding. */
  foot: 19,
  /** Interactive: the note's rule and padding, then each of its lines. */
  noteTop: 5,
  noteLine: 15,
  /** Between Today and This week. */
  sections: 8,
  /** A section's title, its rule and padding. */
  sectionHead: 21,
  /** A second line when its title and reset do not fit one (French, narrow). */
  sectionLine: 14,
  /** Px per character: the title's capitals, spaced, and the reset's 12 px text. */
  titlePx: 7,
  resetPx: 6,
  /** An activity's name line, its padding and the gap to the next. */
  act: 23,
  part: 17,
  cells: 21,
  subTitle: 15,
  choices: 18,
  meta: 18,
  more: 17,
  /**
   * Px per character of the choices' 12 px text: measured 6.3 on the
   * rendered rows, a little more so that a wrap is not missed, no more so
   * that a row that fits is not counted twice.
   */
  charPx: 6.5,
  /** A choice's padding and the gap after it. */
  choicePad: 12,
};

/** The height of an activity as shown, logical px. */
function actHeight(act: ActView, width: number): number {
  let height = H.act;
  if (act.meta !== "") height += H.meta;
  if (act.choices.length > 0) {
    // The names wrap within the body's width: count the lines.
    const room = Math.max(1, width - 24);
    let lines = 1;
    let used = 0;
    for (const choice of act.choices) {
      const w = choice.text.length * H.charPx + (choice.sep ? 0 : H.choicePad);
      if (used > 0 && used + w > room) {
        lines += 1;
        used = 0;
      }
      used += w;
    }
    height += lines * H.choices;
  }
  for (const group of act.groups) {
    if (group.title !== "") height += H.subTitle;
    height += group.cls === "cells" ? H.cells : group.parts.length * H.part;
  }
  if (act.more !== "") height += H.more;
  return height;
}

/** Lines of an 11 px line of text (Baro, the note): measured 4.9 px per character, 5.5 counted. */
const textLines = (value: string, width: number): number => Math.max(1, Math.ceil((value.length * 5.5) / Math.max(1, width)));

/** The height of a column of sections. */
function columnHeight(sections: readonly Section[], width: number): number {
  let height = 0;
  sections.forEach((section, index) => {
    if (index > 0) height += H.sections;
    const head = section.title.length * H.titlePx + section.reset.length * H.resetPx + 6;
    height += H.sectionHead + (head > width ? H.sectionLine : 0);
    height += section.acts.reduce((sum, act) => sum + actHeight(act, width), 0);
  });
  return height;
}

/** The whole panel's height; Interactive adds the note at its foot. */
export function panelHeight(model: Model, width: number, interactive = false): number {
  const inner = width - H.pad;
  const columns = model.cols.length;
  const colWidth = columns > 1 ? (inner - 16) / 2 : inner;
  const blocks = [H.header, Math.max(...model.cols.map((col) => columnHeight(col.groups, colWidth)), 0)];
  if (model.hint !== "") blocks.push(H.hint * textLines(model.hint, inner - 20));
  if (model.baro !== "") blocks.push(H.foot + 14 * (textLines(model.baro, inner - 20) - 1));
  if (model.status !== "") blocks.push(H.status);
  if (interactive && model.note !== "") blocks.push(H.noteTop + H.noteLine * textLines(model.note, inner));
  return H.pad + blocks.reduce((sum, each) => sum + each, 0) + H.gap * (blocks.length - 1);
}

/**
 * The frame's largest height (the manifest's), logical px: the panel stops
 * there. 680 points are 1,020 px at 150 %, 48 px short of a 1080p screen.
 */
export const MAX_HEIGHT = 680;

/** Px the estimate keeps clear of the largest height: a wrap it misses never cuts the panel. */
const FOLD_MARGIN = 8;

/**
 * Passive: when the panel would pass its largest height, the end of the
 * Nightwave list folds into "+ N challenges", the elite ones first.
 */
function fold(model: Model, width: number): void {
  const night = model.cols.flatMap((col) => col.groups.flatMap((section) => section.acts)).find((act) => act.id === "nightwave");
  if (night === undefined || night.groups.length === 0) return;
  let hidden = 0;
  const total = night.groups.reduce((sum, group) => sum + group.parts.length, 0);
  while (panelHeight(model, width) > MAX_HEIGHT - FOLD_MARGIN && hidden < total) {
    const last = night.groups[night.groups.length - 1];
    if (last === undefined) break;
    last.parts = last.parts.slice(0, -1);
    if (last.parts.length === 0) night.groups.pop();
    hidden += 1;
    night.more = t(hidden === 1 ? "more-one" : "more-other", { count: hidden });
  }
}

function baroOf(inputs: Inputs): { text: string; here: boolean } {
  const trader = inputs.world?.voidTrader ?? null;
  if (!inputs.baro || trader === null || inputs.now >= trader.leavesAt) return { text: "", here: false };
  const relayName = trader.relay?.name ?? null;
  const relay = relayName === null ? null : whole(relayName);
  const name = gameName("baro_ki_teer");
  if (inputs.now >= trader.arrivesAt) {
    const leaves = dayAndTime(trader.leavesAt, inputs.now);
    return {
      text: relay === null ? t("baro-here", { name, leaves }) : t("baro-here-at", { name, relay, leaves }),
      here: true,
    };
  }
  const arrives = dayAndTime(trader.arrivesAt, inputs.now);
  return {
    text: relay === null ? t("baro-arrives", { name, arrives }) : t("baro-arrives-at", { name, arrives, relay }),
    here: false,
  };
}

/** What the view shows, from the ticks, the world and the options. */
export function buildModel(inputs: Inputs): Model {
  const { ticks, now } = inputs;
  const built = new Map<ActivityId, Built>();
  for (const id of ACTIVITIES) {
    if (!inputs.tracked[id]) continue;
    const one =
      id === "sortie" || id === "archon"
        ? stagedAct(id, inputs)
        : id === "netracells"
          ? netracellsAct(inputs)
          : id === "circuit" || id === "steel"
            ? circuitAct(id, inputs)
            : nightwaveAct(inputs);
    // Passive: a finished activity folds to its line, with its time.
    if (one.done && !inputs.interactive) {
      one.act.groups = [];
      one.act.more = "";
    }
    built.set(id, one);
  }
  const acts = [...built.values()];
  const left = acts.filter((one) => !one.done).length;
  const wide = inputs.width >= WIDE_PX;
  const section = (period: Period, ids: readonly ActivityId[], key: string): Section | null => {
    const list = ids.map((id) => built.get(id)?.act).filter((act): act is ActView => act !== undefined);
    if (list.length === 0) return null;
    const end = period === "day" ? ticks.dayEnd : ticks.weekEnd;
    return {
      id: key,
      title: t(period === "day" ? "today" : "this-week"),
      reset: t("resets-in", { in: inTime(end - now) }),
      acts: list,
    };
  };
  const day = section("day", ["sortie"], "day");
  const weekIds = ACTIVITIES.filter((id) => PERIOD[id] === "week");
  const present = <T,>(list: (T | null)[]): T[] => list.filter((each): each is T => each !== null);
  let cols: Column[];
  if (wide) {
    // Wide: Nightwave on the right, the rest on the left.
    const left = present([day, section("week", weekIds.filter((id) => id !== "nightwave"), "week")]);
    const right = present([section("week", ["nightwave"], "week-nightwave")]);
    cols = [{ id: "left", groups: left }, { id: "right", groups: right }].filter((col) => col.groups.length > 0);
  } else {
    cols = [{ id: "one", groups: present([day, section("week", weekIds, "week")]) }].filter((col) => col.groups.length > 0);
  }
  const baro = baroOf(inputs);

  let hint = "";
  let hintIcon = "";
  let hintTone = "muted";
  if (inputs.source === "refused") {
    [hint, hintIcon, hintTone] = [t("hint-refused"), "circle-alert", "warning"];
  } else if (inputs.source === "unavailable") {
    [hint, hintIcon, hintTone] = [t("hint-unavailable"), "circle-alert", "warning"];
  }

  let status = "";
  if (inputs.world !== null && now - inputs.world.updatedAt > STALE_MS) {
    status = t("offline-since", { when: when(inputs.world.updatedAt, now) });
  } else if (inputs.world === null && inputs.worldStatus === "unavailable") {
    status = t("offline");
  }

  // The one line: the latest activity a game event just finished, else what is left.
  const fresh = acts
    .filter((one) => one.done && one.auto && now - one.at < FRESH_MS)
    .sort((a, b) => b.at - a.at)[0];
  const count = left === 0 ? t("all-done") : t("to-do", { count: left });
  // The first list's reset: the Sortie's when it is tracked, else the week's.
  const firstPeriod: Period | null = built.has("sortie") ? "day" : acts.length > 0 ? "week" : null;
  const nextReset =
    firstPeriod === null
      ? ""
      : t(firstPeriod === "day" ? "line-reset-sortie" : "line-reset-week", {
          name: activityName("sortie"),
          in: inTime((firstPeriod === "day" ? ticks.dayEnd : ticks.weekEnd) - now),
        });
  const empty = acts.length === 0;
  const success = fresh !== undefined || left === 0;
  // Refused: the count stays, the way to fix it comes beside it, in amber.
  const refused = inputs.source === "refused";
  // One line, refused: beside a value, only "Access denied"; without one,
  // where to fix it. The whole sentence stays in the label and in Full.
  const line = empty ? (refused ? t("line-refused-full") : t("line-empty")) : fresh !== undefined ? t("fresh", { name: fresh.act.name }) : count;
  const lineValue = empty ? "" : refused ? t("line-refused") : fresh !== undefined ? count : nextReset;

  const model: Model = {
    left: empty ? "" : count,
    leftCls: left === 0 ? "left all" : "left",
    cols,
    baro: baro.text,
    baroHere: baro.here,
    hint,
    hintIcon,
    hintTone,
    status,
    note: empty ? "" : t("note"),
    line,
    lineValue,
    lineValueCls: refused ? "line-reset tone-warning" : "line-reset",
    lineCls: empty && refused ? "line-main tone-warning" : !empty && success ? "line-main tone-success" : "line-main",
    lineLabel: refused ? `${lineValue === "" ? line : `${line} · ${lineValue}`}. ${t("hint-refused")}` : lineValue === "" ? line : `${line} · ${lineValue}`,
    empty,
  };
  if (!inputs.interactive) fold(model, inputs.width);
  return model;
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
  for (const id of ACTIVITIES) result[id] = option(TRACK[id], true);
  return result;
}

const inputsNow = (): Inputs => ({
  ticks,
  world,
  worldStatus,
  source,
  tracked: tracked(),
  baro: option("track-baro", true),
  now: Date.now(),
  interactive: host.mode === "interactive",
  width: host.viewport.width,
});

function refresh(): void {
  state.model = buildModel(inputsNow());
}

function save(): void {
  void storage.set({ key: STORAGE_KEY, value: ticks as unknown as JsonValue }).catch(() => null);
}

/** Handles a value of the game's events: the world, then the missions not handled yet. */
export function receive(value: WarframeEvents): void {
  glossary = value.glossary;
  world = value.info.world ?? world;
  worldStatus = value.features.world;
  source = value.features.mission === "available" ? "available" : "unavailable";
  const now = Date.now();
  let changed = roll(ticks, world, now);
  changed = syncWorld(ticks, world, now) || changed;
  const mission = value.info.mission;
  if (mission !== null) changed = learnType(ticks, mission, world, now) || changed;
  for (const event of value.events) {
    if (event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    if (!("mission" in event)) continue;
    changed = learnType(ticks, event.mission, world, now) || changed;
    if (event.type !== "mission_ended" || event.at <= ticks.lastAt) continue;
    ticks.lastAt = event.at;
    handleMission(ticks, event.mission, event.at, world);
    changed = true;
  }
  if (changed) save();
  refresh();
}

/** Interactive: a click on a part (a stage, a cell, a challenge). */
export function tick(id: string): void {
  if (!loaded) return;
  roll(ticks, world, Date.now());
  if (tickPart(ticks, id, world, Date.now())) save();
  refresh();
}

/** Interactive: a click on the Circuit's box. */
export function check(id: string): void {
  if (!loaded) return;
  roll(ticks, world, Date.now());
  if (toggleActivity(ticks, id, Date.now())) save();
  refresh();
}

/** Interactive: a click on a reward of the Circuit. */
export function pickChoice(id: string): void {
  if (!loaded) return;
  roll(ticks, world, Date.now());
  if (pick(ticks, id, world)) save();
  refresh();
}

/** "line", or "wide" (two columns) or "standard"; the width alone decides. */
export function layout(): string {
  if (option("layout", "full") === "line") return "line";
  return host.viewport.width >= WIDE_PX ? "wide" : "standard";
}

export function interactive(): boolean {
  return host.mode === "interactive";
}

export function rootClass(): string {
  return `checklist ${layout()}${interactive() ? " live" : ""}`;
}

export function hasText(value: string): boolean {
  return value !== "";
}

const state = initState({ model: buildModel(inputsNow()) });

// The mode folds or opens the finished activities, the width the columns.
onHost(() => refresh());

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
