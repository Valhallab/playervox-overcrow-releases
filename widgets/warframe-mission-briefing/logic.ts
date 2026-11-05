// Warframe mission briefing: what the chosen mission is up against and
// what hurts it, read during the loading screen. It opens when a mission is
// chosen on the star chart and stays whole through the loading and the
// mission; after it, the last briefing stays, marked as past, until the next
// node is chosen. Only the Layout option folds it into one line. Everything comes from
// two features of Warframe's game events, `warframe.mission` and
// `warframe.world` (the condition of the day's Sortie); the weaknesses are
// embedded below. No network, no storage.
import {
  gameEvents,
  host,
  initState,
  onHost,
  option,
  t,
  timers,
  type IconName,
  type Timer,
  type WarframeEvents,
  type WarframeGlossary,
  type WarframeMission,
  type WarframeModifier,
  type WarframeWorld,
} from "@overcrow/sdk";

// Faction weaknesses of Damage 3.0 (Update 36.0, 2024-06-18; Scaldra and
// Techrot, Update 38). Source: the official Warframe wiki,
// https://wiki.warframe.com/w/Damage/Overview_Table (revision of
// 2026-10-01) and its faction pages, checked on 2026-10-28. "+" is x1.5
// damage taken, "-" x0.5. Each faction here is weak to two types; only
// factions with a resistance have `avoid`. Sub-factions are handled in
// `advice`: Kuva Grineer share the Grineer's weaknesses; Corpus Amalgams
// (Jupiter) are weak to Magnetic only among the Corpus' two; the Deimos
// Infested (the Cambion Drift and Deimos' nodes) are weak to Blast and Gas
// and resist Viral (`REGIONAL`). Each type shows the game's symbol, from
// the official wiki, when PlayerVox OverCrow has it; our icon otherwise.
interface Weakness {
  readonly use: readonly DamageId[];
  readonly avoid: readonly DamageId[];
}

/** The damage types the game's glossary names. */
type DamageId = keyof WarframeGlossary["damage"];

export const WEAKNESSES: Readonly<Record<string, Weakness>> = {
  grineer: { use: ["impact", "corrosive"], avoid: [] },
  corpus: { use: ["puncture", "magnetic"], avoid: [] },
  infested: { use: ["slash", "heat"], avoid: [] },
  corrupted: { use: ["puncture", "viral"], avoid: ["radiation"] },
  sentient: { use: ["cold", "radiation"], avoid: ["corrosive"] },
  narmer: { use: ["slash", "toxin"], avoid: ["magnetic"] },
  murmur: { use: ["electricity", "radiation"], avoid: ["viral"] },
  scaldra: { use: ["impact", "corrosive"], avoid: ["gas"] },
  techrot: { use: ["magnetic", "gas"], avoid: ["cold"] },
};

/**
 * A faction's weaknesses on one planet, when they differ from its own:
 * Deimos' Infested, the Cambion Drift's included, are weak to Blast and Gas
 * and resist Viral (the official wiki's Damage/Overview_Table); Jupiter's
 * Corpus include the Amalgams of the Gas City, which Magnetic hurts as much
 * and Puncture does not.
 */
export const REGIONAL: Readonly<Record<string, Readonly<Record<string, Weakness>>>> = {
  infested: { deimos: { use: ["blast", "gas"], avoid: ["viral"] } },
  corpus: { jupiter: { use: ["magnetic"], avoid: [] } },
};

/** Each damage type's Lucide icon; its name comes from the game's glossary. */
const DAMAGE_ICONS: Readonly<Record<DamageId, IconName>> = {
  impact: "hammer",
  puncture: "arrow-down-to-dot",
  slash: "sword",
  cold: "snowflake",
  electricity: "zap",
  heat: "flame",
  toxin: "droplet",
  blast: "bomb",
  corrosive: "flask-conical",
  gas: "cloud-fog",
  magnetic: "magnet",
  radiation: "radiation",
  viral: "biohazard",
};

/** A neutral icon for each modifier; none carries a state colour. */
const MODIFIER_ICONS: Readonly<Record<WarframeModifier["id"], IconName>> = {
  steel_path: "flame",
  arbitration: "scale",
  sortie: "swords",
  archon_hunt: "crown",
  nightmare: "moon",
  void_storm: "tornado",
  alert: "bell",
  lich: "skull",
};

export interface Damage {
  readonly id: DamageId;
  readonly name: string;
  readonly icon: IconName;
  /** The game's symbol (an `asset:` handle); empty: our icon in its place. */
  readonly src: string;
}

export interface Modifier {
  readonly id: string;
  readonly icon: IconName;
  readonly title: string;
  readonly text: string;
}

/** What the view shows, built again at each change. */
export interface Brief {
  /** `wait`: one line saying what to do; `full`: the briefing; `strip`: the briefing in One line. */
  readonly mode: "wait" | "full" | "strip";
  readonly waitText: string;
  readonly waitIcon: IconName;
  readonly waitTone: "muted" | "warning";
  /** The whole sentence, for screen readers, when the line is short. */
  readonly waitLabel: string;
  /** "Last mission" over the briefing of an ended mission; empty otherwise. */
  readonly eyebrow: string;
  /** Node · planet · type. */
  readonly where: string;
  readonly level: string;
  readonly faction: string;
  readonly dot: string;
  readonly use: readonly Damage[];
  readonly avoid: readonly Damage[];
  readonly mods: readonly Modifier[];
  /** Said instead of advice when the enemies have none. */
  readonly note: string;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    brief: Brief;
  }
}

/** Every field of a Brief, empty: each mode fills its own. */
const BLANK: Brief = {
  mode: "wait",
  waitText: "",
  waitIcon: "map-pin",
  waitTone: "muted",
  waitLabel: "",
  eyebrow: "",
  where: "",
  level: "",
  faction: "",
  dot: "",
  use: [],
  avoid: [],
  mods: [],
  note: "",
};

/** The latest value of the subscription, `null` before the first. */
let latest: WarframeEvents | null = null;
/** Why the subscription failed, or `null`. */
let failure: string | null = null;

const state = initState({ brief: build(null, null) });

function refresh(): void {
  state.brief = build(latest, failure);
}

function subscribe(): void {
  gameEvents.warframe.subscribe((update) => {
    if (update.ok) {
      latest = update.value;
      failure = null;
    } else {
      failure = update.error.code;
      // A refusal lasts until the user grants it again, which restarts the
      // widget; anything else is retried.
      if (failure !== "permission_denied") retryLater();
    }
    refresh();
  });
}

let retry: Timer | null = null;
function retryLater(): void {
  retry?.cancel();
  retry = timers.after(30_000, () => {
    retry = null;
    subscribe();
  });
}

// The viewport and the theme only change the root's class, which the view
// reads from `rootClass` at each evaluation.
onHost((changed) => {
  if (changed.some((key) => key === "locale" || key === "options" || key === "messages")) refresh();
});

subscribe();

function wait(text: string, icon: IconName, tone: Brief["waitTone"] = "muted", label = text): Brief {
  return { ...BLANK, waitText: text, waitIcon: icon, waitTone: tone, waitLabel: label };
}

/** A waiting line: in One line its short form (`<key>-line`), never cut, the whole sentence as its label. */
function waitShort(key: string, icon: IconName, line: boolean, short = t(`${key}-line`), tone: Brief["waitTone"] = "muted"): Brief {
  const sentence = t(key);
  return line ? wait(short, icon, tone, sentence) : wait(sentence, icon, tone);
}

/** The briefing of `value`, or the line that says why there is none. */
export function build(value: WarframeEvents | null, failed: string | null): Brief {
  const line = option("layout", "full") === "line";
  // Full keeps an ended mission's briefing, so that the panel never folds
  // by itself; One line has no room to mark it as past and waits instead.
  const last = value === null ? null : lastBriefed(value);
  const mission = line && last?.state === "ended" ? null : last;
  // Game events are one grant: the sentence names the first feature
  // declared. In One line, the family's short form, never cut: the value
  // still shown (the faction of the briefed mission), or where to go.
  if (failed === "permission_denied") {
    const short = value === null || mission === null ? t("refused-line") : t("refused-value", { value: factionName(mission, value.glossary) });
    return waitShort("refused", "lock", line, short, "warning");
  }
  if (failed !== null) return wait(t("unavailable"), "circle-alert", "warning");
  if (value === null) return waitShort("pick-mission", "map-pin", line);
  if (!value.playing) return waitShort("game-closed", "power", line);
  if (value.features.mission === "unavailable") return wait(t("unavailable"), "circle-alert", "warning");
  if (mission === null) return waitShort("pick-mission", "map-pin", line);
  return briefing(mission, value.info.world, value.glossary, line ? "strip" : "full");
}

/** The latest mission of this launch of Warframe, ended or not. */
function lastBriefed(value: WarframeEvents): WarframeMission | null {
  const mission = value.info.mission;
  if (!value.playing || mission === null || beforeSession(mission, value.session)) return null;
  return mission;
}

/** The faction's name, the glossary's when the host has none, or "Unknown enemies". */
function factionName(mission: WarframeMission, glossary: WarframeGlossary): string {
  const id = mission.faction?.id ?? null;
  return (id === null ? null : (mission.faction?.name ?? gameName(glossary, "faction", id))) ?? t("unknown-enemies");
}

/** A mission of an earlier launch of Warframe: the host keeps it until the next. */
function beforeSession(mission: WarframeMission, session: WarframeEvents["session"]): boolean {
  if (session === null) return false;
  const at = mission.startedAt ?? mission.loadingAt ?? mission.selectedAt;
  return at !== null && at < session.startedAt;
}

function briefing(mission: WarframeMission, world: WarframeWorld | null, glossary: WarframeGlossary, mode: "full" | "strip"): Brief {
  const factionId = mission.faction?.id ?? null;
  const advice = factionId === null ? null : adviceFor(factionId, mission);
  const use = advice === null ? [] : damages(advice.use, glossary);
  return {
    ...BLANK,
    mode,
    eyebrow: mission.state === "ended" ? t("last-mission") : "",
    where: whereText(mission),
    level: levelText(mission.enemyLevel),
    faction: factionName(mission, glossary),
    // A faction we have advice for has a dot colour of its own; the others are grey.
    dot: `dot f-${advice === null ? "unknown" : factionId}`,
    use,
    avoid: advice === null ? [] : damages(advice.avoid, glossary),
    mods: modifiers(mission, world, glossary),
    note: use.length === 0 ? t("no-advice") : "",
  };
}

/**
 * "Hydron · Sedna · Defense". Some nodes are named after their mission
 * (Höllvania's "Exterminate: Techrot"): their type is not said twice.
 */
export function whereText(mission: Pick<WarframeMission, "node" | "planet" | "type">): string {
  const node = mission.node.name;
  const type = mission.type?.name ?? null;
  const parts = [node, mission.planet?.name ?? null, type !== null && node !== null && coversType(node, type) ? null : type];
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

/** Whether every word of `type` begins like a word of `node` (6 letters, or the whole shorter word), accents aside. */
function coversType(node: string, type: string): boolean {
  const nodeWords = words(node);
  const typeWords = words(type);
  return (
    typeWords.length > 0 &&
    typeWords.every((word) =>
      nodeWords.some((other) => {
        const length = Math.min(6, word.length, other.length);
        return word.slice(0, length) === other.slice(0, length) && (length === 6 || word === other);
      }),
    )
  );
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * The advice for `factionId` in `mission`, or `null` when the enemies of
 * the mission have none we are sure of.
 */
export function adviceFor(factionId: string, mission: Pick<WarframeMission, "planet" | "type">): Weakness | null {
  if (!Object.hasOwn(WEAKNESSES, factionId)) return null;
  const planet = mission.planet?.id ?? null;
  const regional = Object.hasOwn(REGIONAL, factionId) ? REGIONAL[factionId] : undefined;
  if (planet !== null && regional !== undefined && Object.hasOwn(regional, planet)) return regional[planet] ?? null;
  return WEAKNESSES[factionId] ?? null;
}

/**
 * The name of a term of the game by its ID, in the game's language, from
 * the glossary PlayerVox OverCrow sends; `null` for an ID it does not
 * know. The one place that names them: no name of the game is ours.
 */
function gameName(glossary: WarframeGlossary, kind: "damage" | "faction" | "fissure", id: string): string | null {
  const names: Readonly<Record<string, string>> = glossary[kind];
  return Object.hasOwn(names, id) ? (names[id] ?? null) : null;
}

function damages(ids: readonly DamageId[], glossary: WarframeGlossary): Damage[] {
  // A type without a name is left out, never shown by its ID.
  return ids.flatMap((id) => {
    const name = gameName(glossary, "damage", id);
    const src = glossary.icons?.damage[id] ?? "";
    return name === null ? [] : [{ id, name, icon: DAMAGE_ICONS[id], src }];
  });
}

/** "Lv. 30–40", "Lv. 30", or nothing. */
export function levelText(level: WarframeMission["enemyLevel"]): string {
  if (level === null) return "";
  return level.min === level.max ? t("level", { level: level.min }) : t("level-range", { min: level.min, max: level.max });
}

/**
 * One line per modifier, in the mockups' order: the Steel Path, the Void
 * Fissure, then the others as the game gives them. A line carries a hint
 * only when it helps.
 */
export function modifiers(mission: WarframeMission, world: WarframeWorld | null, glossary: WarframeGlossary): Modifier[] {
  const line = (each: WarframeModifier): Modifier => ({
    id: each.id,
    icon: MODIFIER_ICONS[each.id],
    title: modifierTitle(each),
    text: modifierText(each, mission, world),
  });
  const steelPath = mission.modifiers.filter((each) => each.id === "steel_path");
  const others = mission.modifiers.filter((each) => each.id !== "steel_path");
  const fissure: Modifier[] = [];
  if (mission.fissure !== null) {
    // In a Railjack Void Storm the relics open without Reactant.
    const storm = mission.modifiers.some((each) => each.id === "void_storm");
    const reactant = glossary.term.reactant;
    const corrupted = gameName(glossary, "faction", "corrupted");
    fissure.push({
      id: "fissure",
      icon: "hexagon",
      title: gameName(glossary, "fissure", mission.fissure.id) ?? glossary.activity.void_fissure,
      text: storm || corrupted === null ? "" : t("reactant-hint", { reactant, corrupted }),
    });
  }
  return [...steelPath.map(line), ...fissure, ...others.map(line)];
}

function modifierTitle(modifier: WarframeModifier): string {
  return modifier.stage === null ? modifier.name : t("stage", { name: modifier.name, stage: modifier.stage });
}

function modifierText(modifier: WarframeModifier, mission: WarframeMission, world: WarframeWorld | null): string {
  if (modifier.id === "arbitration") return t("arbitration-hint");
  if (modifier.id === "sortie") return sortieCondition(modifier, mission, world);
  return "";
}

/** The condition of this Sortie mission, from the world of the day; nothing without it. */
export function sortieCondition(modifier: WarframeModifier, mission: WarframeMission, world: WarframeWorld | null): string {
  const missions = world?.sortie?.missions ?? [];
  const staged = modifier.stage === null ? undefined : missions[modifier.stage - 1];
  const match = staged?.node.id === mission.node.id ? staged : missions.find((each) => each.node.id === mission.node.id);
  return match?.modifier?.name ?? "";
}

/** About the width of a text of One line, in px: 7 a letter, 13 a CJK character. */
function textWidth(text: string): number {
  let width = 0;
  for (const c of text) width += (c.codePointAt(0) ?? 0) >= 0x2e80 ? 13 : 7;
  return width;
}

/**
 * Whether One line can show the damage symbols and keep the faction's
 * whole name beside them, at `width` px: the padding, the dot and the
 * separators (54 px), each type's symbol and name (20 px and its name),
 * 8 px between two types, then the faction's name.
 */
export function symbolsFit(brief: Brief, width: number): boolean {
  if (brief.use.length === 0) return true;
  const types = brief.use.reduce((sum, each) => sum + 20 + textWidth(each.name), 0) + 8 * (brief.use.length - 1);
  return 54 + types + textWidth(brief.faction) <= width;
}

/**
 * Side by side only when there is something to put on the right. One line
 * names the types without their symbols when the faction would lose its
 * name beside them (under 260 px, or the Murmur's two long names).
 */
export function rootClass(brief: Brief): string {
  const wide = brief.mode === "full" && host.viewport.width >= 500 && brief.mods.length > 0 ? " wide" : "";
  const unknown = brief.mode !== "wait" && brief.use.length === 0 ? " unknown" : "";
  const narrow = brief.mode === "strip" && !symbolsFit(brief, host.viewport.width) ? " narrow" : "";
  return `wf briefing ${brief.mode}${wide}${unknown}${narrow} theme-${host.theme}`;
}

/** "Impact, Corrosive". */
export function names(list: readonly Damage[]): string {
  return list.map((each) => each.name).join(", ");
}
