// Warframe mission rewards: what the node of the mission can give, and
// when the next rotation comes. Everything comes from PlayerVox OverCrow's
// Warframe game events (`warframe.mission`, `warframe.progress`,
// `warframe.rewards`); the widget keeps only the last mission in its
// storage, for the summary shown after the game. No network.
//
// Warframe tells what happens about 10 s late (sometimes 26 s): the widget
// never waits for `reward_given`. It counts down to `nextRewardAt`, and
// when that moment passes it moves on to the next rotation by itself; the
// late update then says what the widget already shows.
import {
  formatNumber,
  gameEvents,
  host,
  initState,
  onHost,
  option,
  storage,
  t,
  timers,
  type Timer,
  type WarframeEvents,
  type WarframeMission,
  type WarframeProgress,
  type WarframeRewardTable,
} from "@overcrow/sdk";

/** Survival pays a rotation every 5 minutes of mission. */
export const ROTATION_MS = 300_000;
/** Defense pays a rotation every 5 waves. */
export const ROTATION_WAVES = 5;
/** Rows of a table before "+ n more", by layout. */
export const ROWS_LIST = 10;
export const ROWS_COMPACT = 2;
export const ROWS_STACK = 3;
export const ROWS_STACK_COMPACT = 1;
/** Full turns wide (three columns) from this width. */
export const WIDE_FROM = 580;
/** The storage key of the last mission. */
export const LAST_KEY = "last";

const CYCLE = ["A", "A", "B", "C"] as const;
type Letter = (typeof CYCLE)[number];
type Tone = "accent" | "success" | "danger" | "warning" | "muted";
type Result = NonNullable<WarframeMission["result"]>;
export type Layout = "line" | "compact" | "standard" | "wide";
export type Order = "rarest" | "likely";

/** The last mission, kept for the summary after the game. */
export type LastMission = {
  node: string;
  planet: string;
  faction: string;
  factionId: string;
  typeId: string;
  typeName: string;
  result: Result | null;
  durationSeconds: number | null;
  rewards: number;
  endedAt: number;
};

export interface Row {
  id: string;
  name: string;
  qty: string;
  chance: string;
}

/** One table as shown: its rows, then "+ n more" when it is cut. */
export interface Section {
  id: string;
  /** `section`, or `section listed` for the one table that pays now. */
  cls: string;
  title: string;
  rows: Row[];
  more: string;
  open: boolean;
  /** Wide: the column of the rotation in progress, in accent. */
  now: boolean;
  /** Wide: a rotation already earned in this cycle, with a check. */
  earned: boolean;
}

export interface Cell {
  id: string;
  label: string;
  cls: string;
  earned: boolean;
}

export interface Pill {
  id: string;
  text: string;
  icon: string;
}

export interface Box {
  icon: string;
  tone: Tone;
  title: string;
  text: string;
  /** `tone-warning` when the title itself is the warning (a refusal). */
  titleCls: string;
}

/**
 * What the view shows. Texts that change with time hold `{time}` or
 * `{ago}`, filled in by the view from `state.now`: the screen itself only
 * changes when something happens, or when a rotation comes.
 */
export interface Screen {
  eyebrow: string;
  eyebrowIcon: string;
  tone: Tone;
  /** The header's value: the wave, or nothing. */
  clock: string;
  clockIcon: string;
  /** The mission clock counts from here, Unix ms; `null` without one. */
  clockFrom: number | null;
  node: string;
  planet: string;
  faction: string;
  factionCls: string;
  pills: Pill[];
  heroLabel: string;
  /** The hero's number; `{time}` counts down to `heroAt`. */
  heroValue: string;
  heroAt: number | null;
  heroSub: string;
  subAt: number | null;
  /** A plain line instead of a hero: before the mission, after it. */
  info: string;
  track: Cell[];
  /** The tables, one under the other. */
  sections: Section[];
  /** Wide: the rotations side by side, then `sections` under them. */
  cols: Section[];
  source: boolean;
  empty: Box | null;
  line: string;
  lineValue: string;
  lineIcon: string;
  lineTone: Tone;
  /** One line: words after the value ("· Access denied"); empty without. */
  lineAfter: string;
  /** `{ago}` counts from here, Unix ms. */
  agoFrom: number | null;
  /** An error beside what stays known, in amber; empty without one. */
  status: string;
}

/** Everything the screen is made of. */
export interface Input {
  /** The latest value; `null` before the first. */
  value: WarframeEvents | null;
  /** The subscription's failure code, if it failed. */
  failure: string | null;
  last: LastMission | null;
  now: number;
  layout: Layout;
  order: Order;
  /** Tables unfolded by a click. */
  open: readonly string[];
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    s: Screen;
    now: number;
    open: string[];
  }
}

// ---------------------------------------------------------------- numbers

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** A clock: 1:48, 13:12, 1:02:03. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A countdown, rounded up as a timer is: 0:01 until the very moment. */
export function countdownText(ms: number): string {
  return clockText(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

/** "20 min 41", "1 h 05 min", "41 s": how long a mission lasted. */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  if (h > 0) return t("dur-hm", { h, m: pad(m) });
  if (m > 0) return t("dur-ms", { m, s: pad(s) });
  return t("dur-s", { s });
}

/** "13 min", "1 h 05 min", "41 s": a rough length. */
export function minutesText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  if (h > 0) return t("dur-hm", { h, m: pad(m) });
  if (m > 0) return t("dur-m", { m });
  return t("dur-s", { s: total });
}

/** "just now", "12 min ago", "2 h ago", "3 d ago". */
export function agoText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return t("ago-now");
  if (minutes < 60) return t("ago-min", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ago-h", { n: hours });
  return t("ago-d", { n: Math.floor(hours / 24) });
}

/** A chance from 0 to 1 as a rate: "12.50%", "12.50 %" in French. */
export function rateText(chance: number): string {
  const n = formatNumber(chance * 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return t("rate", { n });
}

// --------------------------------------------------------------- rotations

/** Where a mission stands, the rewards Warframe has not told yet included. */
export interface Projection {
  /** Rewards given, those whose moment passed included. */
  rewards: number;
  /** The place of the next reward in A A B C. */
  pos: number;
  letter: Letter;
  /** Survival: when the next reward comes, Unix ms. */
  nextAt: number | null;
  /** Defense: the wave of the next reward. */
  nextWave: number | null;
}

function letterAt(pos: number): Letter {
  return CYCLE[((pos % 4) + 4) % 4] ?? "A";
}

/**
 * The rotation of the next reward at `now`. Survival: once `nextRewardAt`
 * passes, the reward counts as given and the next one is 5 minutes later,
 * without waiting for Warframe's late `reward_given`. Defense: a wave
 * already past `nextRewardWave` means its reward was given. `null` when
 * the progress does not count rotations.
 */
export function project(progress: WarframeProgress | null, now: number): Projection | null {
  if (progress === null || progress.rotation === null) return null;
  const base = Math.max(0, progress.rewards);
  let late = 0;
  let nextAt: number | null = null;
  let nextWave: number | null = null;
  if (progress.nextRewardAt !== null) {
    if (now >= progress.nextRewardAt) {
      late = Math.floor((now - progress.nextRewardAt) / ROTATION_MS) + 1;
    }
    nextAt = progress.nextRewardAt + late * ROTATION_MS;
  } else if (progress.nextRewardWave !== null) {
    const wave = progress.wave ?? 0;
    if (wave > progress.nextRewardWave) {
      late = Math.ceil((wave - progress.nextRewardWave) / ROTATION_WAVES);
    }
    nextWave = progress.nextRewardWave + late * ROTATION_WAVES;
  }
  const rewards = base + late;
  // The host counts A A B C from the rewards given, as we do; if it ever
  // names another letter, its letter wins.
  let pos = rewards % 4;
  if (late === 0 && letterAt(pos) !== progress.rotation) {
    pos = progress.rotation === "A" ? 0 : progress.rotation === "B" ? 2 : 3;
  }
  return { rewards, pos, letter: letterAt(pos), nextAt, nextWave };
}

/** The cycle A A B C: earned cells checked, the next one in accent. */
export function track(pos: number, earned: number, current: boolean): Cell[] {
  return CYCLE.map((label, i) => ({
    id: `${i}`,
    label,
    cls: `cell${i < earned ? " earned" : ""}${current && i === pos ? " now" : ""}`,
    earned: i < earned,
  }));
}

// ------------------------------------------------------------------ tables

/**
 * The rows of a table in the chosen order: the rarest first (the default),
 * or the most likely first. Stable on ties, whatever order the host gives.
 */
export function sortItems<T extends { chance: number }>(items: readonly T[], order: Order): T[] {
  const sign = order === "likely" ? -1 : 1;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => sign * (a.item.chance - b.item.chance) || a.i - b.i)
    .map((x) => x.item);
}

/** "+ 6 more at 6.25%", or "+ 11 more, 2.26% to 9.68%" when they differ. */
export function moreText(hidden: readonly { chance: number }[]): string {
  if (hidden.length === 0) return "";
  const rates = hidden.map((r) => Math.round(r.chance * 10_000));
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  if (lo === hi) return t("more-same", { count: hidden.length, rate: rateText(lo / 10_000) });
  return t("more-range", { count: hidden.length, low: rateText(lo / 10_000), high: rateText(hi / 10_000) });
}

/**
 * A table as shown: `cap` rows, then "+ n more" for the rest, unless only
 * one would be hidden (then it shows). Unfolded, every row.
 */
export function section(
  id: string,
  title: string,
  table: WarframeRewardTable,
  cap: number,
  order: Order,
  open: readonly string[],
): Section {
  const items = sortItems(table.items, order);
  const unfolded = open.includes(id);
  const shown = unfolded || items.length <= cap + 1 ? items : items.slice(0, cap);
  return {
    id,
    cls: "section",
    title,
    rows: shown.map((item, i) => ({
      id: `${i}-${item.id}`,
      name: item.name,
      qty: item.quantity > 1 ? `×${formatNumber(item.quantity)}` : "",
      chance: rateText(item.chance),
    })),
    more: moreText(items.slice(shown.length)),
    open: unfolded,
    now: false,
    earned: false,
  };
}

/** The node's tables, sorted out. */
interface Tables {
  /** The mission's rotations, by letter. */
  rotations: Partial<Record<Letter, WarframeRewardTable>>;
  /** The mission's table without rotations: one reward at the end. */
  end: WarframeRewardTable | null;
  /** Caches and extra tables. */
  others: WarframeRewardTable[];
}

function sortTables(tables: readonly WarframeRewardTable[]): Tables {
  const out: Tables = { rotations: {}, end: null, others: [] };
  for (const table of tables) {
    if (table.items.length === 0) continue;
    if (table.kind !== "mission") out.others.push(table);
    else if (table.rotation === null) out.end ??= table;
    else out.rotations[table.rotation] ??= table;
  }
  return out;
}

function hasRotations(tables: Tables): boolean {
  return Object.keys(tables.rotations).length > 0;
}

function otherTitle(table: WarframeRewardTable): string {
  const key = table.kind === "caches" ? "caches" : "extra";
  return table.rotation === null ? t(key) : t(`${key}-rotation`, { r: table.rotation });
}

/** Caches and extra tables, under the mission's; only the listed rotation's. */
function otherSections(tables: Tables, letter: Letter | null, cap: number, input: Input, prefix: string): Section[] {
  return tables.others
    .map((table, i) => ({ table, i }))
    .filter(({ table }) => table.rotation === null || letter === null || table.rotation === letter)
    .map(({ table, i }) => section(`${prefix}:${table.kind}-${table.rotation ?? "x"}-${i}`, otherTitle(table), table, cap, input.order, input.open));
}

// ------------------------------------------------------------------ screen

const TYPE_ICONS: Readonly<Record<string, string>> = {
  survival: "timer",
  void_cascade: "timer",
  defense: "shield",
  shrine_defense: "shield",
  excavation: "pickaxe",
  interception: "radio-tower",
  disruption: "zap",
};

const FACTIONS = new Set(["grineer", "corpus", "infested", "corrupted", "sentient", "murmur", "narmer"]);

/** How a type pays its rotations, when it is known. */
function cadence(typeId: string): "time" | "waves" | "rounds" | "excavation" | null {
  if (typeId === "survival") return "time";
  if (typeId === "defense") return "waves";
  if (typeId === "interception" || typeId === "disruption") return "rounds";
  if (typeId === "excavation") return "excavation";
  return null;
}

function blank(): Screen {
  return {
    eyebrow: t("title"),
    eyebrowIcon: "gift",
    tone: "muted",
    clock: "",
    clockIcon: "clock-3",
    clockFrom: null,
    node: "",
    planet: "",
    faction: "",
    factionCls: "dot f-unknown",
    pills: [],
    heroLabel: "",
    heroValue: "",
    heroAt: null,
    heroSub: "",
    subAt: null,
    info: "",
    track: [],
    sections: [],
    cols: [],
    source: false,
    empty: null,
    line: t("title"),
    lineValue: "",
    lineIcon: "gift",
    lineTone: "muted",
    agoFrom: null,
    status: "",
    lineAfter: "",
  };
}

function waiting(icon: string, tone: Tone, title: string, text: string): Screen {
  return { ...blank(), empty: { icon, tone, title, text, titleCls: "" }, line: title, lineIcon: icon, lineTone: tone };
}

function nodeName(mission: WarframeMission): string {
  return mission.node.name ?? t("new-node");
}

function typeName(mission: WarframeMission): string {
  return mission.type?.name ?? t("mission");
}

/** The header of a mission: node, planet, faction, Steel Path and Fissure. */
function header(mission: WarframeMission): Screen {
  const s = blank();
  s.node = nodeName(mission);
  s.planet = mission.planet?.name ?? "";
  s.faction = mission.faction?.name ?? "";
  const fid = mission.faction?.id ?? "";
  s.factionCls = `dot f-${FACTIONS.has(fid) ? fid : "unknown"}`;
  for (const modifier of mission.modifiers) {
    if (modifier.id === "steel_path") s.pills.push({ id: "sp", text: modifier.name, icon: "flame" });
  }
  if (mission.fissure !== null) {
    s.pills.push({ id: "fi", text: t("fissure", { era: mission.fissure.name ?? mission.fissure.id }), icon: "hexagon" });
  }
  return s;
}

/** The rotations stacked, a few rows each: before the mission, or when its progress is unknown. */
function stacked(s: Screen, tables: Tables, input: Input): void {
  const compact = input.layout === "compact";
  const cap = compact ? ROWS_STACK_COMPACT : ROWS_STACK;
  const letters = (["A", "B", "C"] as const).filter((l) => tables.rotations[l] !== undefined);
  if (input.layout === "wide") {
    s.cols = letters.map((l) => section(`col:${l}`, t("stack-rotation", { r: l }), tables.rotations[l] as WarframeRewardTable, ROWS_LIST, input.order, input.open));
    s.sections = otherSections(tables, null, ROWS_LIST, input, "list");
  } else {
    s.sections = letters.map((l) => section(`stack:${l}`, t("stack-rotation", { r: l }), tables.rotations[l] as WarframeRewardTable, cap, input.order, input.open));
    if (!compact) s.sections.push(...otherSections(tables, null, cap, input, "stack"));
  }
  s.source = true;
}

/** The one table that pays: listed in full (capped), or the wide columns. */
function listed(s: Screen, tables: Tables, letter: Letter | null, earned: number, input: Input): void {
  const compact = input.layout === "compact";
  const cap = compact ? ROWS_COMPACT : ROWS_LIST;
  if (letter === null) {
    if (tables.end === null) return;
    s.sections = [section("end", t("list-end"), tables.end, cap, input.order, input.open)];
  } else if (input.layout === "wide") {
    s.cols = (["A", "B", "C"] as const)
      .filter((l) => tables.rotations[l] !== undefined)
      .map((l) => ({
        ...section(`col:${l}`, t("stack-rotation", { r: l }), tables.rotations[l] as WarframeRewardTable, ROWS_LIST, input.order, input.open),
        now: l === letter,
        earned: l !== letter && CYCLE.some((c, i) => c === l && i < earned),
      }));
  } else {
    const table = tables.rotations[letter];
    if (table === undefined) return stacked(s, tables, input);
    s.sections = [section(`list:${letter}`, t("list-rotation", { r: letter }), table, cap, input.order, input.open)];
  }
  if (!compact) s.sections.push(...otherSections(tables, letter, cap, input, "list"));
  for (const sec of s.sections) sec.cls = "section listed";
  s.source = true;
}

/**
 * What an end reward gives, in a few words for One line: the words its
 * items share ("Loki" for Loki's three blueprints), else the rarest item.
 */
export function endReward(table: WarframeRewardTable): string {
  const names = sortItems(table.items, "rarest").map((item) => item.name);
  const words = names.map((name) => name.split(" "));
  const first = words[0] ?? [];
  let n = 0;
  while (n < first.length && words.every((w) => w[n] === first[n])) n += 1;
  const shared = first.slice(0, n).join(" ").replace(/[\s\-–—:,(]+$/u, "");
  return names.length > 1 && shared.length >= 2 ? shared : (names[0] ?? "");
}

/** "One rotation every 5 min · C at 20 min", by type. */
function cadenceInfo(typeId: string): string {
  const c = cadence(typeId);
  return c === null ? "" : t(`cadence-${c}`);
}

function cadenceLine(node: string, typeId: string): string {
  const c = cadence(typeId);
  return c === null ? t("line-untracked", { node }) : t(`line-cadence-${c}`, { node });
}

/** The tables part shared by every mission before its end. */
function loot(s: Screen, mission: WarframeMission, rewardsFeature: string, keepLine = false): Tables | null {
  if (mission.rewards === null) {
    let line = s.line;
    if (rewardsFeature === "undeclared") {
      // Refused: the status line says so.
    } else if (rewardsFeature === "unavailable") {
      s.empty = { icon: "package-x", tone: "muted", title: t("rewards-off-title"), text: t("rewards-off-text"), titleCls: "" };
      line = t("line-rewards-off", { node: s.node });
    } else if (mission.node.name === null) {
      s.empty = { icon: "package-open", tone: "muted", title: t("unknown-title"), text: t("unknown-text"), titleCls: "" };
      line = t("line-unknown", { node: s.node });
    } else {
      // A hero says more than "no loot table".
      if (s.heroValue === "" && s.info === "") s.info = t("info-no-table");
      line = t("line-no-table", { node: s.node });
    }
    if (!keepLine) s.line = line;
    return null;
  }
  return sortTables(mission.rewards.tables);
}

function before(mission: WarframeMission, input: Input, rewardsFeature: string): Screen {
  const s = header(mission);
  const typeId = mission.type?.id ?? "";
  const picked = mission.state === "selected";
  s.eyebrow = t(picked ? "state-selected" : "state-loading", { type: typeName(mission) });
  s.eyebrowIcon = picked ? "map-pin" : "hourglass";
  s.tone = "accent";
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = "accent";
  s.line = t("line-type", { node: s.node, type: typeName(mission) });
  const tables = loot(s, mission, rewardsFeature);
  if (tables === null) {
    // A new node: its loot is not out yet, but its type still says when C comes.
    if (mission.node.name === null && s.empty !== null) s.info = cadenceInfo(typeId);
    return s;
  }
  if (hasRotations(tables)) {
    s.info = cadenceInfo(typeId);
    if (cadence(typeId) !== null) s.line = cadenceLine(s.node, typeId);
    stacked(s, tables, input);
  } else if (tables.end !== null) {
    s.info = t("info-end-reward");
    s.line = t("line-reward", { node: s.node, reward: endReward(tables.end) });
    listed(s, tables, null, 0, input);
  } else {
    stacked(s, tables, input);
  }
  return s;
}

function live(mission: WarframeMission, progress: WarframeProgress | null, input: Input, rewardsFeature: string): Screen {
  const s = header(mission);
  const typeId = mission.type?.id ?? "";
  s.eyebrow = t("state-live", { type: typeName(mission) });
  s.eyebrowIcon = TYPE_ICONS[typeId] ?? "crosshair";
  s.tone = "accent";
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = "accent";
  s.clockFrom = mission.startedAt;
  const p = project(progress, input.now);
  const fissure = mission.fissure !== null ? ` · ${t("fissure-reactant")}` : "";

  if (p !== null) {
    const earned = p.pos;
    s.track = track(p.pos, earned, true);
    if (p.nextAt !== null) {
      // The mission clock: the next reward is due at 5 min × (rewards + 1).
      s.clockFrom = p.nextAt - ROTATION_MS * (p.rewards + 1);
      s.heroLabel = t("hero-time", { r: p.letter });
      s.heroValue = "{time}";
      s.heroAt = p.nextAt;
      const cDone = Math.floor(p.rewards / 4);
      if (p.letter === "C") {
        s.heroSub = t("sub-then-a", { min: 5 * (p.rewards + 2) });
      } else if (cDone === 0) {
        s.heroSub = t("sub-c-in");
        s.subAt = p.nextAt + ROTATION_MS * (3 - p.pos);
      } else {
        s.heroSub = t("sub-c-count", { count: cDone, min: 5 * (p.rewards + (3 - p.pos) + 1) });
      }
      s.heroSub += fissure;
      s.line = t("line-time", { node: s.node, r: p.letter });
      s.lineValue = "{time}";
    } else if (p.nextWave !== null && progress?.wave != null) {
      const waves = Math.max(1, p.nextWave - progress.wave + 1);
      s.clockFrom = null;
      s.clock = t("clock-wave", { wave: progress.wave });
      s.clockIcon = "shield";
      s.heroLabel = t("hero-waves", { r: p.letter });
      s.heroValue = `${waves}`;
      s.heroSub = t("sub-waves", { r: p.letter, wave: p.nextWave }) + fissure;
      s.line = t("line-time", { node: s.node, r: p.letter });
      s.lineValue = t(waves === 1 ? "waves-1" : "waves-n", { n: waves });
    } else if (progress?.round != null) {
      s.info = t("info-round", { r: p.letter, round: progress.round + 1 });
      s.line = t("line-round", { node: s.node, r: p.letter, round: progress.round + 1 });
    } else {
      s.info = t("info-next", { r: p.letter });
      s.line = t("line-next", { node: s.node, r: p.letter });
    }
    const tables = loot(s, mission, rewardsFeature, true);
    if (tables !== null) {
      if (hasRotations(tables)) listed(s, tables, p.letter, earned, input);
      else if (tables.end !== null) listed(s, tables, null, 0, input);
    }
    return s;
  }

  // No rotation counted: one reward at the end, or rotations we cannot follow.
  s.line = t("line-type", { node: s.node, type: typeName(mission) });
  const tables = loot(s, mission, rewardsFeature);
  if (tables === null) return s;
  if (hasRotations(tables)) {
    s.clockFrom = null;
    s.info = cadenceInfo(typeId) || t("info-untracked");
    s.line = cadenceLine(s.node, typeId);
    stacked(s, tables, input);
  } else if (tables.end !== null) {
    s.info = t("info-end-reward");
    s.line = t("line-reward", { node: s.node, reward: endReward(tables.end) });
    listed(s, tables, null, 0, input);
  } else {
    // Only caches or extra tables.
    stacked(s, tables, input);
  }
  return s;
}

const RESULT_TONE: Readonly<Record<Result, Tone>> = { succeeded: "success", failed: "danger", aborted: "warning" };
const RESULT_ICON: Readonly<Record<Result, string>> = { succeeded: "circle-check", failed: "circle-x", aborted: "log-out" };

/** The last mission from what Warframe last told. */
export function lastFrom(mission: WarframeMission, progress: WarframeProgress | null, fallbackAt: number): LastMission {
  return {
    node: nodeName(mission),
    planet: mission.planet?.name ?? "",
    faction: mission.faction?.name ?? "",
    factionId: mission.faction?.id ?? "",
    typeId: mission.type?.id ?? "",
    typeName: typeName(mission),
    result: mission.result,
    durationSeconds: mission.durationSeconds,
    rewards: progress?.rewards ?? 0,
    endedAt: mission.endedAt ?? fallbackAt,
  };
}

function rotationsText(n: number): string {
  return n === 1 ? t("rotations-1") : t("rotations-n", { count: n });
}

/**
 * After the mission: a summary without tables, since the real loot is on
 * the game's end screen. `fresh` right after it in this session; otherwise
 * "last mission" while playing, or "2 h ago" with the game closed.
 */
function after(last: LastMission, how: "fresh" | "last" | "closed"): Screen {
  const s = blank();
  s.node = last.node;
  s.planet = last.planet;
  s.faction = last.faction;
  s.factionCls = `dot f-${FACTIONS.has(last.factionId) ? last.factionId : "unknown"}`;
  const result = last.result;
  const lost = result === "failed" || result === "aborted";
  const word = t(`res-${result ?? "ended"}`);
  if (how === "fresh") {
    s.eyebrow = t("state-result", { type: last.typeName, result: word });
    s.eyebrowIcon = result === null ? "flag" : RESULT_ICON[result];
    s.tone = result === null ? "muted" : RESULT_TONE[result];
  } else if (how === "last") {
    s.eyebrow = t("state-last", { type: last.typeName });
    s.eyebrowIcon = "rocket";
  } else {
    s.eyebrow = last.typeName;
    s.eyebrowIcon = "clock-3";
    s.agoFrom = last.endedAt;
  }
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = how === "fresh" ? s.tone : "muted";
  const d = last.durationSeconds;
  if (result === "failed") {
    s.info = d === null ? t("summary-failed-nod") : t("summary-failed", { duration: minutesText(d) });
  } else if (result === "aborted") {
    s.info = t("summary-aborted");
  } else if (last.rewards > 0) {
    const key = last.rewards === 1 ? "summary-rotation-1" : "summary-rotations";
    s.info = d === null ? rotationsText(last.rewards) : t(key, { count: last.rewards, duration: durationText(d) });
  } else if (d !== null) {
    s.info = t(result === "succeeded" ? "summary-succeeded" : "summary-ended", { duration: durationText(d) });
  }
  if (!lost && last.rewards > 0) {
    const inCycle = last.rewards - 4 * Math.floor((last.rewards - 1) / 4);
    s.track = track(-1, inCycle, false);
  }
  const parts = [last.node];
  if (how === "closed") {
    parts.push(!lost && last.rewards > 0 ? rotationsText(last.rewards) : word, "{ago}");
  } else {
    parts.push(word);
    if (!lost && last.rewards > 0) parts.push(rotationsText(last.rewards));
  }
  s.line = parts.join(" · ");
  return s;
}

/** The whole screen, from what is known at `input.now`. */
/** The features the widget declares, in the manifest's order. */
const DECLARED = ["mission", "progress", "rewards"] as const;

/** The first declared feature the user refused, if any. */
export function refused(input: Input): (typeof DECLARED)[number] | null {
  if (input.failure === "permission_denied") return "mission";
  const features = input.value?.features;
  if (features === undefined) return null;
  return DECLARED.find((f) => features[f] === "undeclared") ?? null;
}

/** What is known, or `null` when nothing is. */
function known(input: Input): Screen | null {
  const value = input.value;
  const mission = value?.info.mission ?? null;
  const progress = value?.info.progress ?? null;
  const playing = value?.playing ?? false;
  const rewardsFeature = value?.features.rewards ?? "available";
  if (mission !== null && !playing) return after(lastFrom(mission, progress, input.now), "closed");
  if (mission !== null) {
    if (mission.state === "ended") return after(lastFrom(mission, progress, input.now), "fresh");
    if (mission.state === "in_progress") return live(mission, progress, input, rewardsFeature);
    return before(mission, input, rewardsFeature);
  }
  if (input.last !== null) return after(input.last, playing && input.failure === null ? "last" : "closed");
  return null;
}

/**
 * The whole screen, from what is known at `input.now`. An error never
 * takes the place of a value still known: it goes beside it, in amber.
 */
export function buildScreen(input: Input): Screen {
  const denied = refused(input);
  const unreadable =
    denied === null &&
    (input.failure !== null || (input.value?.playing === true && input.value.features.mission === "unavailable"));
  const s = known(input);
  if (s === null) {
    if (denied !== null) {
      const box = waiting("circle-alert", "warning", t("denied", { feature: t(`feature-${denied}`) }), "");
      return { ...box, empty: { ...(box.empty as Box), titleCls: "tone-warning" }, line: t("line-denied") };
    }
    if (unreadable) return waiting("circle-alert", "warning", t("unavailable-title"), t("unavailable-text"));
    return waiting("gift", "muted", t("first-title"), t("first-text"));
  }
  if (denied !== null) {
    s.status = t("denied", { feature: t(`feature-${denied}`) });
  } else if (unreadable) {
    s.status = t("status-unreadable");
  }
  if (s.status !== "") {
    s.lineIcon = "circle-alert";
    s.lineTone = "warning";
  }
  if (denied !== null) {
    // One line never cuts its text: the value that stays, then the refusal.
    if (s.lineValue !== "") {
      s.line = "";
      s.lineAfter = t("line-denied-after");
    } else {
      s.line = t("line-denied-value", { value: s.node || s.line.split(" · ")[0] || "" });
    }
  }
  return s;
}

// ------------------------------------------------------------------ widget

/** The layout: the menu's choice; Full turns wide from `WIDE_FROM`. */
export function layout(): Layout {
  const chosen = String(option("layout", "full"));
  if (chosen === "line" || chosen === "compact") return chosen;
  return host.viewport.width >= WIDE_FROM ? "wide" : "standard";
}

export function lootOrder(): Order {
  return option("order", "rarest") === "likely" ? "likely" : "rarest";
}

function isLast(v: unknown): v is LastMission {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const str = (k: string) => typeof o[k] === "string";
  const num = (k: string) => typeof o[k] === "number" && Number.isFinite(o[k]);
  return (
    str("node") && str("planet") && str("faction") && str("factionId") && str("typeId") && str("typeName") &&
    (o.result === null || o.result === "succeeded" || o.result === "failed" || o.result === "aborted") &&
    (o.durationSeconds === null || num("durationSeconds")) && num("rewards") && num("endedAt")
  );
}

let value: WarframeEvents | null = null;
let failure: string | null = null;
let last: LastMission | null = null;
let shown = "";
let ticker: Timer | null = null;

const state = initState({ s: blank(), now: Date.now(), open: [] as string[] });

function inputNow(): Input {
  return { value, failure, last, now: Date.now(), layout: layout(), order: lootOrder(), open: state.open };
}

/** Rebuilds the screen; the view only changes when it does. */
function refresh(): void {
  const input = inputNow();
  const next = buildScreen(input);
  const text = JSON.stringify(next);
  if (text !== shown) {
    shown = text;
    state.s = next;
  }
  state.now = input.now;
  arm(next, input.now);
}

/**
 * One timer, on the second the countdown or the clock changes, or on the
 * minute for "2 h ago". A hidden widget does not tick; it refreshes when
 * shown again.
 */
function arm(s: Screen, now: number): void {
  ticker?.cancel();
  ticker = null;
  const anchor = s.heroAt ?? s.subAt ?? s.clockFrom;
  let delay: number | null = null;
  if (anchor !== null) {
    delay = (((anchor - now) % 1000) + 1000) % 1000 || 1000;
  } else if (s.agoFrom !== null) {
    delay = 60_000 - ((((now - s.agoFrom) % 60_000) + 60_000) % 60_000) || 60_000;
  }
  if (delay !== null) ticker = timers.after(delay, refresh);
}

/** Keeps the mission that just ended, for the summary after the game. */
function remember(mission: WarframeMission, progress: WarframeProgress | null): void {
  if (mission.state !== "ended") return;
  const next = lastFrom(mission, progress, Date.now());
  if (last !== null && JSON.stringify(last) === JSON.stringify(next)) return;
  last = next;
  storage.set({ key: LAST_KEY, value: next }).catch(() => undefined);
}

let mission = "";
gameEvents.warframe.subscribe((update) => {
  if (!update.ok) {
    failure = update.error.code;
    refresh();
    return;
  }
  failure = null;
  value = update.value;
  const m = value.info.mission;
  if (m !== null) {
    remember(m, value.info.progress);
    // A new mission folds the tables unfolded for the previous one.
    const key = `${m.node.id}|${m.selectedAt ?? m.loadingAt ?? m.startedAt ?? ""}`;
    if (key !== mission) {
      mission = key;
      if (state.open.length > 0) state.open = [];
    }
  }
  refresh();
});

storage
  .get({ key: LAST_KEY })
  .then((stored) => {
    if (last === null && isLast(stored)) {
      last = stored;
      refresh();
    }
  })
  .catch(() => undefined);

onHost((changed) => {
  if (changed.some((k) => k === "options" || k === "locale" || k === "viewport" || k === "visible")) {
    refresh();
  }
});

refresh();

/** Unfolds or folds a table, in Interactive mode. */
export function toggle(id: string): void {
  state.open = state.open.includes(id) ? state.open.filter((x) => x !== id) : [...state.open, id];
  refresh();
}

// -------------------------------------------------------------------- view

export function rootClass(): string {
  return `wf mission ${layout()} theme-${host.theme}`;
}

/** A text with its `{time}` or `{ago}` filled in at `now`. */
export function at(text: string, s: Screen, now: number, target: number | null = s.heroAt): string {
  if (text.includes("{time}")) return text.replace("{time}", countdownText((target ?? now) - now));
  if (text.includes("{ago}") && s.agoFrom !== null) return text.replace("{ago}", agoText(now - s.agoFrom));
  return text;
}

/** One line's accessible label: everything, the refusal's whole sentence included. */
export function lineLabel(s: Screen, now: number): string {
  return [at(s.line, s, now), at(s.lineValue, s, now), s.status].filter((x) => x !== "").join(" · ");
}

export function eyebrowText(s: Screen, now: number): string {
  return s.agoFrom === null ? s.eyebrow : t("state-ago", { type: s.eyebrow, ago: agoText(now - s.agoFrom) });
}

export function heroSubText(s: Screen, now: number): string {
  return at(s.heroSub, s, now, s.subAt);
}

export function clockValue(s: Screen, now: number): string {
  return s.clockFrom === null ? s.clock : clockText(now - s.clockFrom);
}

export function hasClock(s: Screen): boolean {
  return s.clockFrom !== null || s.clock !== "";
}

export function hasText(text: string): boolean {
  return text !== "";
}

export function interactive(): boolean {
  return host.mode === "interactive";
}

export function colCls(c: Section): string {
  return c.now ? "col now" : "col";
}
