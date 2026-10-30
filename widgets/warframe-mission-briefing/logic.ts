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
// and resist Viral. Each type shows the game's symbol, from the official
// wiki, when PlayerVox OverCrow has it; our icon otherwise.
interface Weakness {
  readonly use: readonly DamageId[];
  readonly avoid: readonly DamageId[];
}

type DamageId =
  | "impact"
  | "puncture"
  | "slash"
  | "cold"
  | "electricity"
  | "heat"
  | "toxin"
  | "blast"
  | "corrosive"
  | "gas"
  | "magnetic"
  | "radiation"
  | "viral";

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

/** Factions with a dot colour of their own (the others are grey). */
const FACTION_DOTS = new Set(Object.keys(WEAKNESSES));

export interface Damage {
  readonly id: DamageId;
  readonly name: string;
  readonly icon: IconName;
  readonly cls: string;
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
    root: string;
  }
}

/** The game's terms in the game's language, from the value being built; `null` before the first. */
let glossary: WarframeGlossary | null = null;

/** The latest value of the subscription, `null` before the first. */
let latest: WarframeEvents | null = null;
/** Why the subscription failed, or `null`. */
let failure: string | null = null;

const state = initState({ brief: build(null, null), root: "" });
state.root = rootClass(state.brief);

function refresh(): void {
  state.brief = build(latest, failure);
  state.root = rootClass(state.brief);
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

let retry: { cancel(): void } | null = null;
function retryLater(): void {
  retry?.cancel();
  retry = timers.after(30_000, () => {
    retry = null;
    subscribe();
  });
}

onHost((changed) => {
  if (changed.some((key) => key === "locale" || key === "options" || key === "viewport" || key === "theme" || key === "messages")) {
    refresh();
  }
});

subscribe();

function wait(text: string, icon: IconName, tone: Brief["waitTone"] = "muted", label = text): Brief {
  return {
    mode: "wait",
    waitText: text,
    waitIcon: icon,
    waitTone: tone,
    waitLabel: label,
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
}

/** A waiting line whose sentence would not fit One line: its short form there, the sentence as its label. */
function waitShort(key: string, icon: IconName): Brief {
  const sentence = t(key);
  return option("layout", "full") === "line" ? wait(t(`${key}-line`), icon, "muted", sentence) : wait(sentence, icon);
}

/** The briefing of `value`, or the line that says why there is none. */
export function build(value: WarframeEvents | null, failed: string | null): Brief {
  glossary = value?.glossary ?? glossary;
  // Game events are one grant: the sentence names the first feature
  // declared. In One line, the family's short form, never cut: the value
  // still shown (the faction of the briefed mission), or where to go.
  if (failed === "permission_denied") {
    if (option("layout", "full") !== "line") return wait(t("refused"), "lock", "warning");
    const shown = value === null ? null : briefed(value);
    const text = shown === null ? t("refused-line") : t("refused-value", { value: factionName(shown) });
    return wait(text, "lock", "warning", t("refused"));
  }
  if (failed !== null) return wait(t("unavailable"), "circle-alert", "warning");
  if (value === null) return waitShort("pick-mission", "map-pin");
  if (!value.playing) return waitShort("game-closed", "power");
  if (value.features.mission === "unavailable") return wait(t("unavailable"), "circle-alert", "warning");
  // Full keeps an ended mission's briefing, so that the panel never folds
  // by itself; One line has no room to mark it as past and waits instead.
  const strip = option("layout", "full") === "line";
  const mission = strip ? briefed(value) : briefed(value) ?? lastBriefed(value);
  if (mission === null) return waitShort("pick-mission", "map-pin");
  return briefing(mission, value.info.world, strip ? "strip" : "full");
}

/** The mission to brief: chosen, loading or in progress, of this launch of Warframe. */
function briefed(value: WarframeEvents): WarframeMission | null {
  const mission = lastBriefed(value);
  return mission === null || mission.state === "ended" ? null : mission;
}

/** The latest mission of this launch of Warframe, ended or not. */
function lastBriefed(value: WarframeEvents): WarframeMission | null {
  const mission = value.info.mission;
  if (!value.playing || mission === null || beforeSession(mission, value.session)) return null;
  return mission;
}

/** The faction's name, ours when the host has none, or "Unknown enemies". */
function factionName(mission: WarframeMission): string {
  const id = mission.faction?.id ?? null;
  return (id === null ? null : (mission.faction?.name ?? gameName("faction", id))) ?? t("unknown-enemies");
}

/** A mission of an earlier launch of Warframe: the host keeps it until the next. */
function beforeSession(mission: WarframeMission, session: WarframeEvents["session"]): boolean {
  if (session === null) return false;
  const at = mission.startedAt ?? mission.loadingAt ?? mission.selectedAt;
  return at !== null && at < session.startedAt;
}

function briefing(mission: WarframeMission, world: WarframeWorld | null, mode: "full" | "strip"): Brief {
  const factionId = mission.faction?.id ?? null;
  const advice = factionId === null ? null : adviceFor(factionId, mission);
  const use = advice === null ? [] : damages(advice.use);
  return {
    mode,
    waitText: "",
    waitIcon: "map-pin",
    waitTone: "muted",
    waitLabel: "",
    eyebrow: mission.state === "ended" ? t("last-mission") : "",
    where: whereText(mission),
    level: levelText(mission.enemyLevel),
    faction: factionName(mission),
    dot: `dot f-${factionId !== null && FACTION_DOTS.has(factionId) ? factionId : "unknown"}`,
    use,
    avoid: advice === null ? [] : damages(advice.avoid),
    mods: modifiers(mission, world),
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
  const weakness = WEAKNESSES[factionId];
  if (weakness === undefined) return null;
  const planet = mission.planet?.id ?? null;
  // Deimos' Infested, the Cambion Drift's included, are the Deimos
  // Infested: weak to Blast and Gas, resistant to Viral (the official
  // wiki's Damage/Overview_Table).
  if (factionId === "infested" && planet === "deimos") return { use: ["blast", "gas"], avoid: ["viral"] };
  // Jupiter's Corpus include the Amalgams of the Gas City: Magnetic hurts
  // both, Puncture only the Corpus.
  if (factionId === "corpus" && planet === "jupiter") return { use: ["magnetic"], avoid: [] };
  return weakness;
}

/**
 * The name of a term of the game by its ID, in the game's language, from
 * the glossary PlayerVox OverCrow sends; `null` for an ID it does not
 * know. The one place that names them: no name of the game is ours.
 */
function gameName(kind: "damage" | "faction" | "fissure", id: string): string | null {
  const names: Readonly<Record<string, string>> | undefined = glossary?.[kind];
  return names !== undefined && Object.hasOwn(names, id) ? (names[id] ?? null) : null;
}

function damages(ids: readonly DamageId[]): Damage[] {
  // A type without a name is left out, never shown by its ID.
  return ids.flatMap((id) => {
    const name = gameName("damage", id);
    const src = glossary?.icons?.damage[id] ?? "";
    return name === null ? [] : [{ id, name, icon: DAMAGE_ICONS[id], cls: `d-${id}`, src }];
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
export function modifiers(mission: WarframeMission, world: WarframeWorld | null): Modifier[] {
  const lines: Modifier[] = [];
  const steelPath = mission.modifiers.find((each) => each.id === "steel_path");
  if (steelPath !== undefined) lines.push({ id: "steel_path", icon: "flame", title: steelPath.name, text: "" });
  if (mission.fissure !== null) {
    // In a Railjack Void Storm the relics open without Reactant.
    const storm = mission.modifiers.some((each) => each.id === "void_storm");
    const reactant = glossary?.term.reactant ?? null;
    const corrupted = gameName("faction", "corrupted");
    lines.push({
      id: "fissure",
      icon: "hexagon",
      title: gameName("fissure", mission.fissure.id) ?? glossary?.activity.void_fissure ?? "",
      text: storm || reactant === null || corrupted === null ? "" : t("reactant-hint", { reactant, corrupted }),
    });
  }
  for (const each of mission.modifiers) {
    if (each.id === "steel_path") continue;
    lines.push({ id: each.id, icon: MODIFIER_ICONS[each.id], title: modifierTitle(each), text: modifierText(each, mission, world) });
  }
  return lines;
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

/**
 * Side by side only when there is something to put on the right. One line
 * under 260 px names the types without their symbols, so that the faction
 * keeps its name.
 */
export function rootClass(brief: Brief): string {
  const wide = brief.mode === "full" && host.viewport.width >= 500 && brief.mods.length > 0 ? " wide" : "";
  const unknown = brief.mode !== "wait" && brief.use.length === 0 ? " unknown" : "";
  const narrow = brief.mode === "strip" && host.viewport.width < 260 ? " narrow" : "";
  return `wf briefing ${brief.mode}${wide}${unknown}${narrow} theme-${host.theme}`;
}

/** "Impact, Corrosive". */
export function names(list: readonly Damage[]): string {
  return list.map((each) => each.name).join(", ");
}
