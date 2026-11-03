// Warframe mission rewards: what the node of the mission can give, and
// when the next rotation comes. Everything comes from PlayerVox OverCrow's
// Warframe game events (`warframe.mission`, `warframe.progress`,
// `warframe.rewards`, and `warframe.world` for the Circuit's picks of the
// week); the widget keeps only the last mission in its
// storage, for the recap shown after the game. No network. Names from the
// game come as the game writes them; the widget's own words follow the app.
//
// Warframe tells what happens a little late (a second or more): the widget
// never waits for `reward_given`. It counts down to `nextRewardAt`, and
// when that moment passes it moves on to the next rotation by itself; the
// late update then says what the widget already shows. The game never says
// which item a rotation gave: the widget shows the rotations, not items.
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
  type WarframeRelic,
  type WarframeReward,
  type WarframeRewardTable,
} from "@overcrow/sdk";

/** Survival pays a rotation every 5 minutes of mission. */
export const ROTATION_MS = 300_000;
/** Defense pays a rotation every 3 waves (Mirror Defense every 2): the
 * host's next wave tells which; this is the step when it cannot. */
export const ROTATION_WAVES = 3;
/** Rows of a table before "+ n more": Compact's, and Full's wide columns.
 * Full otherwise shows as many rows as the user's height holds (Passive),
 * or every row in a scroll (Interactive). */
export const ROWS_LIST = 10;
export const ROWS_COMPACT = 2;
export const ROWS_STACK_COMPACT = 1;
/** A table's row, and its "+ n more" line, in logical px. */
export const ROW_H = 29;
export const MORE_H = 20;
/** Full turns wide (three columns) from this width. */
export const WIDE_FROM = 580;
/** The storage key of the last mission. */
export const LAST_KEY = "last";

type Letter = "A" | "B" | "C";
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
  /** Rotations earned, by letter. */
  got: Partial<Record<Letter, number>>;
  credits: number | null;
  /** The game's word for credits, in the game's language. */
  creditsName: string;
  /** The waves of a Defense; `null` for another type. */
  waves: number | null;
  /** Steel Path, Arbitration, Sortie…, as in the mission's header. */
  pills: Pill[];
  /** What the player's own relic gave in a Void Fissure: its name, its
   * image (an `asset:` handle, empty once stored) and our icon of its kind. */
  relic: { name: string; icon: string; glyph: string } | null;
};

export interface Row {
  id: string;
  name: string;
  qty: string;
  chance: string;
  /** The item's image from the game (an `asset:` handle); empty without. */
  icon: string;
  /** Our icon of the item's kind when no image will come; empty while one may. */
  glyph: string;
  /** Its chance from 0 to 1, for "+ n more"; -1 when it has none (a tier, a rarity). */
  p: number;
}

/** Our icon of each kind of item, when the game's image will not come. */
const KIND_ICONS: Readonly<Record<WarframeReward["category"], string>> = {
  relic: "hexagon",
  mod: "layers",
  resource: "gem",
  blueprint: "scroll-text",
  warframe_part: "user-round",
  weapon_part: "sword",
  arcane: "sparkles",
  currency: "coins",
  other: "package",
};

/**
 * The image of an item: the game's once PlayerVox OverCrow has it; an empty
 * tile while it may still come; our icon of its kind when none will.
 */
export function itemImage(item: WarframeReward): Pick<Row, "icon" | "glyph"> {
  if (item.icon !== null && item.icon !== undefined) return { icon: item.icon, glyph: "" };
  if (item.iconPending === true) return { icon: "", glyph: "" };
  return { icon: "", glyph: KIND_ICONS[item.category] ?? "package" };
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
  /** "×3": how many times this rotation was earned; empty when never. */
  got: string;
  /** Empty lines that keep the height of the longest rotation. */
  fill: string[];
  /** An empty "+ n more" line, when another rotation has one. */
  fillMore: boolean;
  /** A line of its own under the rows ("Tiers 1, 3, 4, 6, 9: random"). */
  note: string;
  /** The equipped relic's block in place of the title: its image (or
   * `glyph`), `name` and refinement chip (`badge`, `badgeCls`). */
  relic: boolean;
  img: string;
  glyph: string;
  name: string;
  badge: string;
  badgeCls: string;
}

/** A line of the recap: "Your relic: …", "End bonus: …". */
export interface RecapRow {
  id: string;
  /** The item's image, or empty for `icon`. */
  img: string;
  icon: string;
  label: string;
  text: string;
  cls: string;
}

export interface Cell {
  id: string;
  label: string;
  cls: string;
  earned: boolean;
  /** `check` when earned, empty otherwise. */
  icon: string;
}

/** A modifier's chip; a type, so that the stored last mission is JSON. */
export type Pill = {
  id: string;
  text: string;
  icon: string;
};

export interface Box {
  icon: string;
  tone: Tone;
  title: string;
  text: string;
  /** `tone-warning` when the title itself is the warning (a refusal);
   * `soft` for a plain fact (an open world has no table). */
  titleCls: string;
  /** `soft`: a smaller icon for a plain fact. */
  iconCls: string;
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
  /** The hero value's class: `next-value`; in Defense `next-big`, and
   * `next-big word accent` for "this wave". */
  heroCls: string;
  /** Defense: the label and its number on one line. */
  heroInline: boolean;
  /** An icon in place of the number: the countdown has not started. */
  heroIcon: string;
  heroSub: string;
  /** "Cycle 2" before the cells from the second cycle on. */
  trackLabel: string;
  /** The recap's one line of facts: duration, rotations (in green), credits. */
  factsLead: string;
  /** A Defense's first line of facts: duration · waves. */
  factsTop: string;
  factsGot: string;
  factsCls: string;
  factsTail: string;
  subAt: number | null;
  /** A plain line instead of a hero: before the mission, after it. */
  info: string;
  track: Cell[];
  /** The tables, one under the other. */
  sections: Section[];
  /** Wide: the rotations side by side, then `sections` under them. */
  cols: Section[];
  /** Interactive: the tables scroll. */
  scroll: boolean;
  /** The recap's lines under its facts. */
  recap: RecapRow[];
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
  mode: "passive" | "interactive";
  /** The widget's size, logical px: the user's (the widget never changes it). */
  width: number;
  height: number;
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

type Cycle = NonNullable<WarframeProgress["cycle"]>;

/** Where a mission stands, the rewards Warframe has not told yet included. */
export interface Projection {
  /** Rewards given, those whose moment passed included. */
  rewards: number;
  letter: Letter;
  /** The cycle of the next reward: its number, its rotations, how many are earned. */
  cycle: Cycle;
  /** How many times each rotation was earned. */
  totals: Record<Letter, number>;
  /** Survival: when the next reward comes, Unix ms. */
  nextAt: number | null;
  /** Defense: the wave of the next reward. */
  nextWave: number | null;
  /** Survival before its clock starts (the panel is not hacked yet). */
  waiting: boolean;
}

/** The cycle after this one: A A B C again; Arbitrations go on with C C C C. */
function nextCycle(c: Cycle): Cycle {
  const arbitration = c.rotations.join("") === "AABB" || c.rotations.join("") === "CCCC";
  return { number: c.number + 1, rotations: arbitration ? ["C", "C", "C", "C"] : [...c.rotations], earned: 0 };
}

/** Moves on by one reward. */
function step(c: Cycle): Cycle {
  return c.earned + 1 >= c.rotations.length ? nextCycle(c) : { ...c, earned: c.earned + 1 };
}

/**
 * The rotation of the next reward at `now`. Survival: once `nextRewardAt`
 * passes, the reward counts as given and the next one is 5 minutes later,
 * without waiting for Warframe's late `reward_given`. Defense: a wave
 * already past `nextRewardWave` means its reward was given. `null` when
 * the progress does not count rotations.
 */
export function project(progress: WarframeProgress | null, now: number): Projection | null {
  const p = progress;
  if (p === null || p.rotation === null || p.cycle === null) return null;
  let late = 0;
  let nextAt: number | null = null;
  let nextWave: number | null = null;
  if (p.nextRewardAt !== null) {
    if (now >= p.nextRewardAt) late = Math.floor((now - p.nextRewardAt) / ROTATION_MS) + 1;
    nextAt = p.nextRewardAt + late * ROTATION_MS;
  } else if (p.nextRewardWave !== null) {
    const wave = p.wave ?? 0;
    // The host's waves are 3, 6, 9… (Mirror Defense 2, 4, 6…): its step.
    const every = Math.round(p.nextRewardWave / (Math.max(0, p.rewards) + 1)) || ROTATION_WAVES;
    if (wave > p.nextRewardWave) late = Math.ceil((wave - p.nextRewardWave) / every);
    nextWave = p.nextRewardWave + late * every;
  }
  let cycle = p.cycle;
  const totals = { ...p.earned.totals };
  for (let i = 0; i < late; i += 1) {
    const l = cycle.rotations[cycle.earned] ?? "A";
    totals[l] += 1;
    cycle = step(cycle);
  }
  return {
    rewards: Math.max(0, p.rewards) + late,
    letter: cycle.rotations[cycle.earned] ?? "A",
    cycle,
    totals,
    nextAt,
    nextWave,
    waiting: p.clock === "waiting",
  };
}

/** The cycle's cells: earned ones in green, the next one outlined. */
export function track(c: Cycle, current: boolean): Cell[] {
  return c.rotations.map((label, i) => ({
    id: `${i}`,
    label,
    cls: `cell${i < c.earned ? " earned" : ""}${current && i === c.earned ? " now" : ""}`,
    earned: i < c.earned,
    icon: i < c.earned ? "check" : "",
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

/** "+ 6 more at 6.25%", or "+ 11 more, 2.26% to 9.68%" when they differ;
 * "+ 2 more" for rows without a chance (a rarity, a tier). */
export function moreText(hidden: readonly { chance: number }[]): string {
  if (hidden.length === 0) return "";
  if (hidden.some((r) => r.chance < 0)) return t("more-count", { count: hidden.length });
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
  const rows = sortItems(table.items, order).map((item, i) => ({
    id: `${i}-${item.id}`,
    name: item.name,
    qty: item.quantity > 1 ? `×${formatNumber(item.quantity)}` : "",
    chance: rateText(item.chance),
    ...itemImage(item),
    p: item.chance,
  }));
  return rowsSection(id, title, rows, cap, open);
}

/** Rows as a table: `cap` of them, then "+ n more" (all of them with a
 * single one to hide, or unfolded). `cap` is infinite in Full. */
function rowsSection(id: string, title: string, all: Row[], cap: number, open: readonly string[]): Section {
  const unfolded = open.includes(id);
  const rows = unfolded || all.length <= cap + 1 ? all : all.slice(0, cap);
  return {
    id,
    cls: "section",
    title,
    rows,
    more: moreText(all.slice(rows.length).map((r) => ({ chance: r.p }))),
    open: unfolded,
    now: false,
    earned: false,
    got: "",
    fill: [],
    fillMore: false,
    note: "",
    relic: false,
    img: "",
    glyph: "",
    name: "",
    badge: "",
    badgeCls: "",
  };
}

/** The rows of one table for a layout: Compact's few, Full wide's ten,
 * every row otherwise (Passive then cuts them to the height). */
function capOf(input: Input, compact: number): number {
  if (input.layout === "compact") return compact;
  return input.layout === "wide" ? ROWS_LIST : Infinity;
}

/** The node's tables, sorted out. */
interface Tables {
  /** The mission's rotations, by letter. */
  rotations: Partial<Record<Letter, WarframeRewardTable>>;
  /** The mission's table without rotations: one reward at the end. */
  end: WarframeRewardTable | null;
  /** Caches and extra tables. */
  others: WarframeRewardTable[];
  /** Where the tables come from: `node`, `arbitration`, `sortie`, `nightmare`. */
  source: string;
  /** The modifier's name in the game's language ("Arbitration"). */
  sourceName: string;
}

function sortTables(tables: readonly WarframeRewardTable[]): Tables {
  const out: Tables = { rotations: {}, end: null, others: [], source: "node", sourceName: "" };
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
  circuit: "infinity",
  free_roam: "map",
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
    heroCls: "next-value",
    heroInline: false,
    heroIcon: "",
    heroSub: "",
    trackLabel: "",
    factsLead: "",
    factsTop: "",
    factsGot: "",
    factsCls: "facts-got",
    factsTail: "",
    subAt: null,
    info: "",
    track: [],
    sections: [],
    cols: [],
    scroll: false,
    recap: [],
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
  return { ...blank(), empty: { icon, tone, title, text, titleCls: "", iconCls: "" }, line: title, lineIcon: icon, lineTone: tone };
}

function nodeName(mission: WarframeMission): string {
  return mission.node.name ?? t("new-node");
}

/** The type's name; while the game has not chosen it yet (a Sortie mission
 * whose type is known at loading), the activity's name alone. */
function typeName(mission: WarframeMission): string {
  return mission.type?.name ?? (typeLater(mission) ?? t("mission"));
}

/** "Sortie" while the type is known only at loading; `null` otherwise. */
function typeLater(mission: WarframeMission): string | null {
  if (mission.type !== null || !mission.typeAtLoading) return null;
  const activity = mission.modifiers.find((m) => m.id === "sortie" || m.id === "archon_hunt");
  return activity?.name ?? t("mission");
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
    if (modifier.id === "arbitration") s.pills.push({ id: "ar", text: modifier.name, icon: "scale" });
    if (modifier.id === "sortie") s.pills.push({ id: "so", text: modifier.stage === null ? modifier.name : `${modifier.name} ${modifier.stage}/3`, icon: "swords" });
    if (modifier.id === "nightmare") s.pills.push({ id: "nm", text: modifier.name, icon: "moon" });
    if (modifier.id === "archon_hunt") s.pills.push({ id: "ah", text: modifier.name, icon: "crown" });
    if (modifier.id === "alert") s.pills.push({ id: "al", text: modifier.name, icon: "siren" });
  }
  if (mission.fissure !== null) {
    s.pills.push({ id: "fi", text: t("fissure", { era: mission.fissure.name ?? mission.fissure.id }), icon: "hexagon" });
  }
  return s;
}

/** The rotations stacked, a few rows each: before the mission, or when its progress is unknown. */
function stacked(s: Screen, tables: Tables, input: Input): void {
  const compact = input.layout === "compact";
  const cap = capOf(input, ROWS_STACK_COMPACT);
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
function listed(s: Screen, tables: Tables, letter: Letter | null, got: Partial<Record<Letter, number>>, input: Input): void {
  const compact = input.layout === "compact";
  const cap = capOf(input, ROWS_COMPACT);
  if (letter === null) {
    if (tables.end === null) return;
    s.sections = [section("end", t("list-end"), tables.end, cap, input.order, input.open)];
  } else if (input.layout === "wide") {
    s.cols = (["A", "B", "C"] as const)
      .filter((l) => tables.rotations[l] !== undefined)
      .map((l) => ({
        ...section(`col:${l}`, t("stack-rotation", { r: l }), tables.rotations[l] as WarframeRewardTable, ROWS_LIST, input.order, input.open),
        now: l === letter,
        earned: (got[l] ?? 0) > 0,
        got: (got[l] ?? 0) > 0 ? `×${got[l]}` : "",
      }));
  } else {
    const table = tables.rotations[letter];
    if (table === undefined) return stacked(s, tables, input);
    const n = got[letter] ?? 0;
    const title = tables.source === "arbitration" ? t("list-arbitration", { name: tables.sourceName, r: letter }) : t("list-rotation", { r: letter });
    const sec = section(`list:${letter}`, title, table, cap, input.order, input.open);
    // Compact: the same height for every rotation of the node, so that
    // "+ n more" never moves when the next rotation comes. Full needs no
    // empty line: the panel fills the user's frame.
    const rows = (x: WarframeRewardTable) => (x.items.length <= cap + 1 ? x.items.length : cap);
    const all = Object.values(tables.rotations) as WarframeRewardTable[];
    const most = sec.open || cap === Infinity ? sec.rows.length : Math.max(...all.map(rows));
    const anyMore = all.some((x) => x.items.length > cap + 1);
    s.sections = [{
      ...sec,
      got: n > 0 ? t("got-already", { r: letter, n }) : "",
      fill: Array.from({ length: Math.max(0, most - sec.rows.length) }, (_, i) => `f${i}`),
      fillMore: anyMore && !sec.open && sec.more === "",
    }];
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
    // One line of "known on loading" or "no table" shows the panel's icon.
    let icon = "";
    if (rewardsFeature === "undeclared") {
      // Refused: the status line says so.
    } else if (mission.type?.id === "free_roam") {
      // An open world by its hub's gate: a walk, no table.
      s.empty = { icon: "map", tone: "muted", title: t("open-world-title"), text: "", titleCls: "soft", iconCls: "soft" };
      line = t("line-loot-none", { node: s.node });
      icon = "map";
    } else if (rewardsFeature === "unavailable") {
      s.empty = { icon: "package-x", tone: "muted", title: t("rewards-off-title"), text: t("rewards-off-text"), titleCls: "", iconCls: "" };
      line = t("line-rewards-off", { node: s.node });
    } else if (mission.node.name === null) {
      s.empty = { icon: "package-open", tone: "muted", title: t("unknown-title"), text: t("unknown-text"), titleCls: "", iconCls: "" };
      line = t("line-unknown", { node: s.node });
    } else if (mission.rewardsPending) {
      // Not known yet: a node of today's Sortie or Archon Hunt is only
      // told apart at loading.
      s.empty = { icon: "hourglass", tone: "muted", title: t("loot-later-title"), text: "", titleCls: "muted", iconCls: "" };
      line = t("line-loot-later", { node: s.node });
      icon = "hourglass";
    } else if (mission.relic !== null) {
      // A Void Fissure on a node without a table: the relic is what it gives.
      line = t("line-relic", { node: s.node, relic: mission.relic.name });
      icon = "hexagon";
    } else {
      // No published table: Archon Hunt, Alert, Netracell, or a type without one.
      s.empty = { icon: "package-x", tone: "muted", title: t("loot-none-title"), text: "", titleCls: "", iconCls: "" };
      line = t("line-loot-none", { node: s.node });
      icon = "package-x";
    }
    if (!keepLine) {
      s.line = line;
      if (icon !== "") {
        s.lineIcon = icon;
        s.lineTone = icon === "hexagon" ? "accent" : "muted";
      }
    }
    return null;
  }
  const tables = sortTables(mission.rewards.tables);
  tables.source = mission.rewards.source;
  tables.sourceName = mission.modifiers.find((m) => m.id === tables.source)?.name ?? "";
  return tables;
}

/**
 * A Sortie's reward (after its third mission) or a Nightmare mod (once):
 * one table, no rotations to count. `false` for a node's own tables.
 */
function oneTable(s: Screen, tables: Tables, input: Input): boolean {
  if (tables.source !== "sortie" && tables.source !== "nightmare") return false;
  const table = tables.end ?? Object.values(tables.rotations)[0];
  if (table === undefined) return false;
  const cap = capOf(input, ROWS_COMPACT);
  const title = t(`list-${tables.source}`, { name: tables.sourceName });
  s.sections = [{ ...section("one", title, table, cap, input.order, input.open), cls: "section listed" }];
  if (tables.source === "sortie") s.info = t("info-sortie");
  s.line = t(`line-${tables.source}`, { node: s.node, name: tables.sourceName });
  s.source = true;
  return true;
}

/** The Circuit's fixed tiers of the week, as the official wiki gives them:
 * the picked Warframe's parts, its augment at tier 7. */
const CIRCUIT_TIERS: readonly (readonly [string, number, string])[] = [
  ["neuroptics", 2, "scroll-text"],
  ["chassis", 5, "scroll-text"],
  ["augment", 7, "layers"],
  ["systems", 8, "scroll-text"],
  ["blueprint", 10, "scroll-text"],
];

function tierRow(id: string, name: string, chance: string, glyph: string): Row {
  return { id, name, qty: "", chance, icon: "", glyph, p: -1 };
}

/**
 * The Circuit: what each round gives, then this week's tiers, written from
 * the pick the game showed in this session (the tier reached is never
 * known). `false` for any other mission.
 */
function circuit(s: Screen, mission: WarframeMission, tables: Tables, input: Input): boolean {
  if (tables.source !== "circuit") return false;
  const cap = capOf(input, ROWS_COMPACT);
  const round = tables.others.find((x) => x.kind === "round") ?? tables.end;
  s.sections = round === undefined || round === null ? [] : [section("round", t("circuit-round"), round, cap, input.order, input.open)];
  const week = input.value?.info.world?.circuit ?? null;
  const named = (list: readonly { id: string; name: string | null }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? id;
  let tiers: Section;
  if (mission.modifiers.some((m) => m.id === "steel_path")) {
    const picked = (week?.picked.steelPath ?? []).slice(0, 2);
    const rows = picked.length > 0
      ? picked.map((id, i) => tierRow(`${i}-${id}`, named(week?.steelPath, id), t("circuit-tier-either"), "sword"))
      : [tierRow("yours", t("circuit-incarnon-yours"), t("circuit-tier-either"), "sword")];
    tiers = { ...rowsSection("tiers", t("circuit-tiers-incarnon"), rows, cap, input.open), note: t("circuit-random-steel") };
  } else {
    const id = week?.picked.normal[0];
    const title = id === undefined ? t("circuit-tiers-plain") : t("circuit-tiers", { w: named(week?.normal, id) });
    const rows = CIRCUIT_TIERS.map(([part, n, glyph]) => tierRow(part, t(`circuit-${part}`), t("circuit-tier", { n }), glyph));
    tiers = { ...rowsSection("tiers", title, rows, cap, input.open), note: t("circuit-random") };
  }
  s.sections.push(tiers);
  for (const sec of s.sections) sec.cls = "section listed";
  s.info = "";
  s.line = t("line-circuit", { node: s.node });
  s.lineIcon = "infinity";
  s.source = true;
  return true;
}

/** The order of a relic's items when its refinement, hence its rates, is not known. */
const RARITY: Readonly<Record<string, number>> = { rare: 0, uncommon: 1, common: 2 };

/** The equipped relic: its block, then its items at its refinement's rates. */
export function relicSection(relic: WarframeRelic, value: WarframeEvents | null, input: Input): Section {
  const items = relic.items.map((item) => ({ item, chance: item.chance ?? RARITY[item.rarity] ?? 2 }));
  const rows = sortItems(items, input.order).map(({ item }, i) => ({
    id: `${i}-${item.id}`,
    name: item.name,
    qty: item.quantity > 1 ? `×${formatNumber(item.quantity)}` : "",
    chance: item.chance === null ? t(`rarity-${item.rarity}`) : rateText(item.chance),
    ...itemImage(item as unknown as WarframeReward),
    p: item.chance ?? -1,
  }));
  const ref = relic.refinement;
  const glossary = value?.glossary.refinement as Readonly<Record<string, string>> | undefined;
  const image = itemImage({ icon: relic.icon, iconPending: relic.iconPending, category: "relic" } as WarframeReward);
  return {
    ...rowsSection("relic", t("your-relic"), rows, capOf(input, ROWS_COMPACT), input.open),
    cls: "section listed",
    relic: true,
    img: image.icon,
    glyph: image.glyph,
    name: relic.name,
    badge: ref === null ? t("refinement-unknown") : (ref.name ?? glossary?.[ref.id] ?? ref.id),
    badgeCls: ref === null ? "ref-chip unknown" : "ref-chip",
  };
}

/** A Void Fissure's relic, once the game asked to confirm it: on top of the tables. */
function withRelic(s: Screen, mission: WarframeMission, input: Input): void {
  if (mission.relic === null) return;
  s.sections.unshift(relicSection(mission.relic, input.value, input));
  s.info = s.info === "" ? t("relic-reactant") : `${s.info} · ${t("fissure-reactant")}`;
  s.source = true;
}

function before(mission: WarframeMission, input: Input, rewardsFeature: string): Screen {
  const s = header(mission);
  const typeId = mission.type?.id ?? "";
  const picked = mission.state === "selected";
  s.eyebrow = typeLater(mission) ?? t(picked ? "state-selected" : "state-loading", { type: typeName(mission) });
  s.eyebrowIcon = picked ? "map-pin" : "hourglass";
  s.tone = "accent";
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = "accent";
  s.line = t("line-type", { node: s.node, type: typeName(mission) });
  const tables = loot(s, mission, rewardsFeature);
  if (tables === null) {
    // A new node: its loot is not out yet, but its type still says when C comes.
    if (mission.node.name === null && s.empty !== null) s.info = cadenceInfo(typeId);
    withRelic(s, mission, input);
    return s;
  }
  if (oneTable(s, tables, input) || circuit(s, mission, tables, input)) return s;
  if (hasRotations(tables)) {
    s.info = cadenceInfo(typeId);
    if (cadence(typeId) !== null) s.line = cadenceLine(s.node, typeId);
    stacked(s, tables, input);
  } else if (tables.end !== null) {
    s.info = t("info-end-reward");
    s.line = t("line-reward", { node: s.node, reward: endReward(tables.end) });
    listed(s, tables, null, {}, input);
  } else {
    stacked(s, tables, input);
  }
  withRelic(s, mission, input);
  return s;
}

function live(mission: WarframeMission, progress: WarframeProgress | null, input: Input, rewardsFeature: string): Screen {
  const s = header(mission);
  const typeId = mission.type?.id ?? "";
  s.eyebrow = typeLater(mission) ?? t("state-live", { type: typeName(mission) });
  s.eyebrowIcon = TYPE_ICONS[typeId] ?? "crosshair";
  s.tone = "accent";
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = "accent";
  s.clockFrom = mission.startedAt;
  const special = mission.rewards !== null ? loot(blank(), mission, rewardsFeature) : null;
  if (special !== null && (oneTable(s, special, input) || circuit(s, mission, special, input))) return s;
  const p = project(progress, input.now);
  // With the relic known, its block says how to open it.
  const fissure = mission.fissure !== null && mission.relic === null ? ` · ${t("fissure-reactant")}` : "";

  if (p !== null) {
    // Arbitrations pay C for ever after their first A A B B: the cells
    // then say what was earned, and the C to come.
    const allC = p.cycle.rotations.every((l) => l === "C");
    if (allC) {
      s.track = (["A", "B", "C"] as const)
        .filter((l) => p.totals[l] > 0)
        .map((l) => ({ id: l, label: `${l} ×${p.totals[l]}`, cls: "cell earned", earned: true, icon: "check" }));
      s.track.push({ id: "next", label: "C", cls: "cell now", earned: false, icon: "" });
      s.trackLabel = "";
    } else {
      s.track = track(p.cycle, !p.waiting);
      s.trackLabel = t("cycle", { n: p.cycle.number });
    }
    if (p.waiting) {
      // Survival before the panel is hacked: its countdown has not started.
      s.heroLabel = t("hero-waiting");
      s.heroIcon = "hourglass";
      s.heroSub = t("sub-waiting", { r: p.letter });
      s.line = t("line-waiting", { node: s.node });
    } else if (p.nextAt !== null) {
      s.heroLabel = t("hero-time", { r: p.letter });
      s.heroValue = "{time}";
      s.heroAt = p.nextAt;
      const after = step(p.cycle);
      s.heroSub = t("sub-then", { r: after.rotations[after.earned] ?? "A" });
      s.subAt = p.nextAt + ROTATION_MS;
      s.heroSub += fissure;
      s.line = t("line-time", { node: s.node, r: p.letter });
      s.lineValue = "{time}";
    } else if (p.nextWave !== null && progress?.wave != null) {
      // Defense: the waves until the reward, counted as the game shows
      // them; the header has the game's wave.
      const wave = progress.wave;
      const left = progress.waveEnemies?.left ?? null;
      const done = left === 0;
      const waves = Math.max(1, p.nextWave - wave + (done ? 0 : 1));
      // The header keeps the mission clock; the wave goes with its enemies.
      s.heroSub = (done
        ? t("sub-wave-done", { wave })
        : left !== null
          ? t(left === 1 ? "sub-wave-left-1" : "sub-wave-left", { wave, n: left })
          : t("sub-wave-now", { wave })) + fissure;
      // The owner's own words, on one line: "Rotation B at the end of
      // wave 9", the wave large; "this wave" when it pays.
      s.heroInline = true;
      const pays = waves === 1 && !done;
      s.heroLabel = t(pays ? "hero-wave-this" : "hero-wave-end", { r: p.letter });
      s.heroValue = pays ? t("this-wave") : `${p.nextWave}`;
      s.heroCls = pays ? "next-big word accent" : "next-big";
      s.line = t(pays ? "line-reward-at" : "line-wave", { node: s.node, r: p.letter });
      s.lineValue = pays ? t("this-wave") : `${p.nextWave}`;
    } else if (progress?.round != null) {
      s.info = t("info-round", { r: p.letter, round: progress.round + 1 });
      s.line = t("line-round", { node: s.node, r: p.letter, round: progress.round + 1 });
    } else {
      s.info = t("info-next", { r: p.letter });
      s.line = t("line-next", { node: s.node, r: p.letter });
    }
    const earned = p.totals;
    const tables = loot(s, mission, rewardsFeature, true);
    if (tables !== null) {
      if (hasRotations(tables)) listed(s, tables, p.letter, earned, input);
      else if (tables.end !== null) listed(s, tables, null, {}, input);
    }
    withRelic(s, mission, input);
    return s;
  }

  // No rotation counted: one reward at the end, or rotations we cannot follow.
  s.line = t("line-type", { node: s.node, type: typeName(mission) });
  const tables = loot(s, mission, rewardsFeature);
  if (tables === null) {
    withRelic(s, mission, input);
    return s;
  }
  if (hasRotations(tables)) {
    s.clockFrom = null;
    s.info = cadenceInfo(typeId) || t("info-untracked");
    s.line = cadenceLine(s.node, typeId);
    stacked(s, tables, input);
  } else if (tables.end !== null) {
    s.info = t("info-end-reward");
    s.line = t("line-reward", { node: s.node, reward: endReward(tables.end) });
    listed(s, tables, null, {}, input);
  } else {
    // Only caches or extra tables.
    stacked(s, tables, input);
  }
  withRelic(s, mission, input);
  return s;
}

const RESULT_TONE: Readonly<Record<Result, Tone>> = { succeeded: "success", failed: "danger", aborted: "warning" };
const RESULT_ICON: Readonly<Record<Result, string>> = { succeeded: "circle-check", failed: "circle-x", aborted: "log-out" };

/** The last mission from what Warframe last told. */
export function lastFrom(mission: WarframeMission, progress: WarframeProgress | null, fallbackAt: number, creditsName = ""): LastMission {
  const got: Partial<Record<Letter, number>> = { ...(mission.earned?.totals ?? {}) };
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
    got,
    credits: mission.credits === null ? null : Math.round(mission.credits),
    creditsName,
    waves: mission.type?.id === "defense" ? (progress?.wave ?? null) : null,
    pills: header(mission).pills,
    relic: relicReward(mission.relic),
  };
}

/** What the player's own relic gave, for the recap. */
function relicReward(relic: WarframeRelic | null): LastMission["relic"] {
  const reward = relic?.reward ?? null;
  if (reward === null) return null;
  return { name: reward.name, icon: reward.icon ?? "", glyph: KIND_ICONS[reward.category] ?? "package" };
}

/** "A ×6 · B ×3 · C ×3". */
function gotText(got: Partial<Record<Letter, number>>): string {
  return (["A", "B", "C"] as const).filter((l) => (got[l] ?? 0) > 0).map((l) => `${l} ×${got[l]}`).join(" · ");
}

/**
 * After the mission: the recap. The rotations earned (the game does not
 * say which item), how long, the credits, and what those rotations could
 * give. `fresh` right after it in this session; otherwise "last mission"
 * while playing, or "2 h ago" with the game closed.
 */
function after(last: LastMission, how: "fresh" | "last" | "closed", input: Input): Screen {
  const s = blank();
  s.node = last.node;
  s.planet = last.planet;
  s.faction = last.faction;
  s.factionCls = `dot f-${FACTIONS.has(last.factionId) ? last.factionId : "unknown"}`;
  s.pills = last.pills;
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
    s.eyebrow = result === null ? last.typeName : t("state-result", { type: last.typeName, result: word });
    s.eyebrowIcon = result === null ? "clock-3" : RESULT_ICON[result];
    s.tone = result === null ? "muted" : RESULT_TONE[result];
    s.agoFrom = last.endedAt;
  }
  s.lineIcon = s.eyebrowIcon;
  s.lineTone = how === "fresh" ? s.tone : "muted";
  const d = last.durationSeconds;
  const got = last.got ?? {};
  const total = Object.values(got).reduce((a, n) => a + (n ?? 0), 0);
  // The game never says which item was won: one line of facts, no tables.
  // Duration · (waves ·) rotations · credits; what was lost when it was.
  const lead: string[] = [];
  if (d !== null) lead.push(clockText(d * 1000));
  const waves = last.waves;
  if (waves !== null && !lost) lead.push(t(waves === 1 ? "facts-wave" : "facts-waves", { n: waves }));
  if (total > 0) {
    // A Defense has one fact more: its duration and waves go on a line of
    // their own rather than wrap in the middle of a group.
    if (waves !== null && !lost) s.factsTop = lead.join(" · ");
    else s.factsLead = lead.length > 0 ? `${lead.join(" · ")} · ` : "";
    s.factsGot = lost ? t("facts-lost", { got: gotText(got) }) : gotText(got);
    s.factsCls = lost ? "facts-got lost" : "facts-got";
  } else if (result === "failed") {
    s.info = d === null ? t("summary-failed-nod") : t("summary-failed", { duration: minutesText(d) });
  } else if (result === "aborted") {
    s.info = t("summary-aborted");
  } else if (d !== null) {
    s.info = t(result === "succeeded" ? "summary-succeeded" : "summary-ended", { duration: durationText(d) });
  }
  // Under the facts: what the player's relic gave (never "obtained": the
  // game does not say which relic of the squad was chosen), the end bonus.
  const relic = last.relic ?? null;
  if (relic !== null) {
    s.recap.push({ id: "relic", img: relic.icon, icon: relic.icon === "" ? relic.glyph : "", label: t("recap-relic"), text: relic.name, cls: "recap-value" });
  }
  if (!lost && last.credits !== null) {
    const text = t("facts-credits", { n: formatNumber(last.credits), credits: last.creditsName });
    s.recap.push({ id: "bonus", img: "", icon: "coins", label: t("recap-bonus"), text, cls: "recap-value num" });
  }
  const what = !lost && total > 0 ? gotText(got) : !lost && relic !== null ? relic.name : word;
  s.line = (how === "closed" ? [last.node, what, "{ago}"] : [last.node, what]).join(" · ");
  return s;
}

/** The whole screen, from what is known at `input.now`. */
/** The features the widget declares, in the manifest's order. */
const DECLARED = ["mission", "progress", "rewards", "world"] as const;

/** The first declared feature the user refused, if any. */
export function refused(input: Input): (typeof DECLARED)[number] | null {
  if (input.failure === "permission_denied") return "mission";
  const features = input.value?.features;
  if (features === undefined) return null;
  return DECLARED.find((f) => features[f] === "undeclared") ?? null;
}

/** The game's word for credits, in the game's language. */
function creditsName(value: WarframeEvents | null): string {
  return value?.glossary.term.credits ?? "";
}

/** What is known, or `null` when nothing is. */
function known(input: Input): Screen | null {
  const value = input.value;
  const mission = value?.info.mission ?? null;
  const progress = value?.info.progress ?? null;
  const playing = value?.playing ?? false;
  const rewardsFeature = value?.features.rewards ?? "available";
  if (mission !== null && !playing) return after(lastFrom(mission, progress, input.now, creditsName(value)), "closed", input);
  if (mission !== null) {
    if (mission.state === "ended") return after(lastFrom(mission, progress, input.now, creditsName(value)), "fresh", input);
    if (mission.state === "in_progress") return live(mission, progress, input, rewardsFeature);
    return before(mission, input, rewardsFeature);
  }
  if (input.last !== null) {
    // Out of an open world: the last real mission of this session, if any.
    const left = value?.events.some((e) => e.type === "mission_left") ?? false;
    const session = value?.session?.startedAt ?? null;
    if (left && session !== null && input.last.endedAt < session) return null;
    return after(input.last, playing && input.failure === null ? "last" : "closed", input);
  }
  return null;
}

// ------------------------------------------------------------- the height

/**
 * The heights the widget knows of its blocks, logical px: the style's
 * sizes at the engine's line height (1.3). Passive Full fits its tables
 * in what they leave of the user's height.
 */
const H = {
  pad: 20,
  gap: 8,
  eyebrow: 16,
  headGap: 3,
  place: 21,
  /** The faction and modifier chips; the faction's name alone is lower. */
  meta: 19,
  metaText: 15,
  hero: 34,
  heroInline: 57,
  line12: 16,
  track: 20,
  factsGap: 2,
  recap: 24,
  recapGap: 4,
  empty: 24,
  emptyIcon: 20,
  emptyIconSoft: 16,
  emptyGap: 6,
  emptyTitle: 17,
  small: 15,
  caption: 13,
  title: 13,
  listedGap: 4,
  relicHead: 35,
  tablesGap: 8,
} as const;

/** How many lines a text takes at `px` in `width`, roughly (a Latin average). */
function textLines(text: string, px: number, width: number): number {
  if (text === "") return 0;
  return Math.max(1, Math.ceil((text.length * px * 0.52) / Math.max(1, width)));
}

/** The panel's height without its tables, as the view lays it out. */
function fixedHeight(s: Screen, width: number): number {
  const inner = width - H.pad;
  const blocks: number[] = [];
  let head = H.eyebrow;
  if (s.node !== "") {
    head += H.headGap + H.place;
    if (s.pills.length > 0) head += H.headGap + H.meta;
    else if (s.faction !== "") head += H.headGap + H.metaText;
  }
  blocks.push(head);
  if (s.heroInline) blocks.push(H.heroInline);
  else if (s.heroValue !== "" || s.heroIcon !== "") blocks.push(H.hero);
  if (s.info !== "") blocks.push(textLines(s.info, 12, inner) * H.line12);
  if (s.track.length > 0) blocks.push(H.track);
  if (s.factsGot !== "") blocks.push(s.factsTop !== "" ? 2 * H.line12 + H.factsGap : H.line12);
  if (s.recap.length > 0) blocks.push(s.recap.length * H.recap + (s.recap.length - 1) * H.recapGap);
  if (s.empty !== null) {
    let box = H.empty + (s.empty.iconCls === "soft" ? H.emptyIconSoft : H.emptyIcon) + H.emptyGap;
    box += textLines(s.empty.title, 13, inner - 16) * H.emptyTitle;
    if (s.empty.text !== "") box += H.emptyGap + textLines(s.empty.text, 11, inner - 16) * H.small;
    blocks.push(box);
  }
  blocks.push(0); // the tables, fitted below
  blocks.push(0); // the room left under them
  if (s.status !== "") blocks.push(textLines(s.status, 10, inner - 16) * H.caption);
  if (s.source) blocks.push(H.caption);
  return H.pad + blocks.reduce((a, b) => a + b, 0) + H.gap * (blocks.length - 1);
}

/** A table's height around its rows: its title or the relic's block, its note. */
function overhead(sec: Section): number {
  const head = sec.relic ? H.relicHead : H.title;
  return head + (sec.cls.includes("listed") ? H.listedGap : 0) + (sec.note !== "" ? MORE_H : 0);
}

/** The rows' height: `shown` lines, and "+ n more" when some are cut. */
function rowsHeight(lines: number, shown: number): number {
  return shown >= lines ? lines * ROW_H : shown * ROW_H + MORE_H;
}

/**
 * Passive Full: as many rows as the user's height holds. The tables share
 * it row by row, the shortest first, a table's last row before any other;
 * each keeps at least one row, and
 * "+ n more" folds its commonest (the rarest come first).
 */
export function fitTables(s: Screen, width: number, height: number): void {
  const secs = s.sections;
  if (secs.length === 0) return;
  let room = height - fixedHeight(s, width) - (secs.length - 1) * H.tablesGap;
  for (const sec of secs) room -= overhead(sec);
  const all = secs.map((sec) => sec.rows.length);
  const shown = all.map((n) => Math.min(1, n));
  let used = all.reduce((a, n, i) => a + rowsHeight(n, shown[i] ?? 0), 0);
  // The shortest table first, then the order of the screen.
  const order = all.map((n, i) => ({ n, i })).sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.i);
  // A row that completes a table first: it costs less than its "+ 1 more".
  const last = (i: number) => ((shown[i] ?? 0) + 1 === all[i] ? 0 : 1);
  for (;;) {
    const next = order
      .filter((i) => (shown[i] ?? 0) < (all[i] ?? 0))
      .sort((a, b) => last(a) - last(b) || (shown[a] ?? 0) - (shown[b] ?? 0))
      .find((i) => used + rowsHeight(all[i] ?? 0, (shown[i] ?? 0) + 1) - rowsHeight(all[i] ?? 0, shown[i] ?? 0) <= room);
    if (next === undefined) break;
    const n = all[next] ?? 0;
    const k = shown[next] ?? 0;
    used += rowsHeight(n, k + 1) - rowsHeight(n, k);
    shown[next] = k + 1;
  }
  secs.forEach((sec, i) => {
    const k = shown[i] ?? 0;
    if (k >= sec.rows.length) return;
    sec.more = moreText(sec.rows.slice(k).map((r) => ({ chance: r.p })));
    sec.rows = sec.rows.slice(0, k);
  });
}

/**
 * The whole screen, from what is known at `input.now`. An error never
 * takes the place of a value still known: it goes beside it, in amber.
 */
export function buildScreen(input: Input): Screen {
  const s = screenOf(input);
  s.scroll = s.sections.length > 0 || s.cols.length > 0;
  if (input.layout === "standard" && input.mode === "passive") fitTables(s, input.width, input.height);
  return s;
}

function screenOf(input: Input): Screen {
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

/** A stored last mission of this version's shape; an older one is ignored. */
export function isLast(v: unknown): v is LastMission {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const str = (k: string) => typeof o[k] === "string";
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const got = o.got as Record<string, unknown> | null;
  const pills = o.pills;
  const relic = o.relic as Record<string, unknown> | null | undefined;
  return (
    (relic === null || (typeof relic === "object" && relic !== undefined && ["name", "icon", "glyph"].every((k) => typeof relic[k] === "string"))) &&
    str("node") && str("planet") && str("faction") && str("factionId") && str("typeId") && str("typeName") && str("creditsName") &&
    (o.result === null || o.result === "succeeded" || o.result === "failed" || o.result === "aborted") &&
    (o.durationSeconds === null || num(o.durationSeconds)) && num(o.rewards) && num(o.endedAt) &&
    (o.credits === null || num(o.credits)) && (o.waves === null || num(o.waves)) &&
    typeof got === "object" && got !== null && Object.entries(got).every(([k, n]) => (k === "A" || k === "B" || k === "C") && num(n)) &&
    Array.isArray(pills) && pills.length <= 8 &&
    pills.every((x) => typeof x === "object" && x !== null && ["id", "text", "icon"].every((k) => typeof (x as Record<string, unknown>)[k] === "string"))
  );
}

let value: WarframeEvents | null = null;
let failure: string | null = null;
let last: LastMission | null = null;
let shown = "";
let ticker: Timer | null = null;

const state = initState({ s: blank(), now: Date.now(), open: [] as string[] });

function inputNow(): Input {
  return {
    value,
    failure,
    last,
    now: Date.now(),
    layout: layout(),
    order: lootOrder(),
    open: state.open,
    mode: interactive() ? "interactive" : "passive",
    width: host.viewport.width,
    height: host.viewport.height,
  };
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
function remember(mission: WarframeMission, progress: WarframeProgress | null, credits: string): void {
  if (mission.state !== "ended") return;
  const next = lastFrom(mission, progress, Date.now(), credits);
  if (last !== null && JSON.stringify(last) === JSON.stringify(next)) return;
  last = next;
  // An image handle is the session's: the stored recap shows our icon instead.
  const stored = { ...next, relic: next.relic === null ? null : { ...next.relic, icon: "" } };
  storage.set({ key: LAST_KEY, value: stored }).catch(() => undefined);
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
    remember(m, value.info.progress, creditsName(value));
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
  return `wf mission ${layout()} theme-${host.theme}${interactive() ? " live" : ""}`;
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
