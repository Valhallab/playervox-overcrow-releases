// Synthetic Warframe values for the unit tests, in the shapes of
// gameEvents.warframe.subscribe. Every instant is taken from Thursday
// 2026-10-29 10:00 UTC: the Sortie ends at 16:00 UTC, the week on Monday
// 2026-11-02 00:00 UTC, Baro Ki'Teer comes on Friday at 13:00 UTC.
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = Date.UTC(2026, 9, 29, 10);
export const SORTIE_END = Date.UTC(2026, 9, 29, 16);
export const WEEK_END = Date.UTC(2026, 10, 2);

const named = (id, name) => ({ id, name });
const mission = (node, nodeName, type, typeName, modifier = null) => ({
  node: named(node, nodeName),
  planet: named("europa", "Europa"),
  type: type === null ? null : named(type, typeName),
  modifier,
  typeAtLoading: false,
});
/** A stage whose published type the game replaces: its type comes at loading. */
export const replaced = (node, nodeName) => ({ ...mission(node, nodeName, null, null), typeAtLoading: true });

/** A Nightwave challenge. */
export const challenge = (id, name, kind, endsAt, changes = {}) => ({
  id,
  name,
  kind,
  standing: kind === "elite" ? 7000 : kind === "weekly" ? 4500 : 1000,
  endsAt,
  progressed: false,
  completed: false,
  ...changes,
});

export function world(now = NOW, changes = {}) {
  return {
    updatedAt: now,
    sortie: {
      boss: named("vor", "Captain Vor"),
      faction: named("grineer", "Grineer"),
      endsAt: SORTIE_END,
      missions: [
        mission("SolNode1", "Galatea", "rescue", "Rescue"),
        mission("SolNode2", "Apollodorus", "disruption", "Disruption"),
        mission("SolNode3", "Ose", "mobile_defense", "Mobile Defense"),
      ],
    },
    archonHunt: {
      boss: named("archon_nira", "Archon Nira"),
      endsAt: WEEK_END,
      missions: [
        mission("SolNode4", "Kiliken", "rescue", "Rescue"),
        mission("SolNode5", "Draco", "survival", "Survival"),
        mission("SolNode6", "Oestrus", "assassination", "Assassination"),
      ],
      shard: { id: "amber", name: "Amber Archon Shard", icon: "asset:amber-shard", iconPending: false },
    },
    fissures: [],
    cycles: { cetus: null, vallis: null, cambion: null },
    resets: { daily: Date.UTC(2026, 9, 30), weekly: WEEK_END },
    voidTrader: {
      arrivesAt: Date.UTC(2026, 9, 30, 13),
      leavesAt: Date.UTC(2026, 10, 1, 13),
      relay: named("larunda_relay", "Larunda Relay"),
    },
    circuit: {
      normal: [named("excalibur", "Excalibur"), named("trinity", "Trinity"), named("ember", "Ember")],
      steelPath: ["braton", "lato", "skana", "paris", "kunai"].map((id) => named(id, id[0].toUpperCase() + id.slice(1))),
      picked: { normal: [], steelPath: [] },
    },
    nightwave: {
      endsAt: WEEK_END + 60 * DAY,
      challenges: [
        challenge("artist", "Artist", "daily", SORTIE_END + 8 * HOUR),
        challenge("detonator", "Detonator", "daily", SORTIE_END + 8 * HOUR),
        challenge("mission_complete", "Mission Complete", "weekly", WEEK_END),
        challenge("gatherer", "Gatherer", "weekly", WEEK_END),
        challenge("mirror_mirror", "Mirror, Mirror", "elite", WEEK_END),
      ],
    },
    ...changes,
  };
}

const FEATURES = {
  location: "undeclared",
  mission: "available",
  progress: "undeclared",
  squad: "undeclared",
  eidolons: "undeclared",
  world: "available",
  rewards: "undeclared",
};

/** The game's terms as the fake host sends them, in English (this widget's part). */
export const GLOSSARY = {
  language: "en",
  activity: {
    sortie: "Sortie",
    archon_hunt: "Archon Hunt",
    netracells: "Netracells",
    circuit: "The Circuit",
    nightwave: "Nightwave",
    baro_ki_teer: "Baro Ki'Teer",
    void_fissure: "Void Fissure",
    arbitration: "Arbitration",
    steel_path: "The Steel Path",
    void_storm: "Void Storm",
  },
};

/** A whole subscription value; `mission` is the current one. */
export function value({ worldValue = world(), events = [], features = {}, glossary = GLOSSARY, mission = null } = {}) {
  return {
    playing: true,
    session: { startedAt: NOW - HOUR, language: glossary.language },
    glossary,
    features: { ...FEATURES, ...features },
    info: { location: null, mission, progress: null, squad: null, eidolons: null, world: worldValue },
    events,
  };
}

/** A mission of the game at `at`; `typeAtLoading` with a type: the type the game told at loading. */
export function missionAt(
  at,
  { node = "SolNode1", type = "rescue", typeName = null, modifiers = [], result = "succeeded", state = "ended", typeAtLoading = false } = {},
) {
  const ended = state === "ended";
  return {
    state,
    node: { id: node, name: null },
    planet: null,
    type: type === null ? null : { id: type, name: typeName },
    faction: null,
    enemyLevel: null,
    fissure: null,
    modifiers,
    selectedAt: null,
    loadingAt: null,
    startedAt: at - 600_000,
    endedAt: ended ? at : null,
    result: ended ? result : null,
    durationSeconds: ended ? 600 : null,
    rewards: null,
    rewardsPending: false,
    earned: null,
    credits: null,
    typeAtLoading,
    relic: null,
  };
}

/** A mission event at `at`: `mission_ended` unless `event` says another. */
export function ended(seq, at, options = {}) {
  const event = options.event ?? "mission_ended";
  const state = { mission_loading: "loading", mission_started: "in_progress", mission_ended: "ended" }[event] ?? "selected";
  return { seq, at, type: event, mission: missionAt(at, { ...options, state }) };
}

export const sortie = (stage) => ({ id: "sortie", name: "Sortie", stage });
export const archon = (stage) => ({ id: "archon_hunt", name: "Archon Hunt", stage });
