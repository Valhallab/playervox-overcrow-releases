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
  planet: null,
  type: named(type, typeName),
  modifier,
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
      boss: named("nira", "Nira"),
      endsAt: WEEK_END,
      missions: [
        mission("SolNode4", "Kiliken", "rescue", "Rescue"),
        mission("SolNode5", "Draco", "survival", "Survival"),
        mission("SolNode6", "Oestrus", "assassination", "Assassination"),
      ],
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
      steelPath: [],
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

/** A whole subscription value. */
export function value({ worldValue = world(), events = [], features = {} } = {}) {
  return {
    playing: true,
    session: { startedAt: NOW - HOUR },
    features: { ...FEATURES, ...features },
    info: { location: null, mission: null, progress: null, squad: null, eidolons: null, world: worldValue },
    events,
  };
}

/** A mission that ended at `at`. */
export function ended(seq, at, { node = "SolNode1", type = "rescue", modifiers = [], result = "succeeded" } = {}) {
  return {
    seq,
    at,
    type: "mission_ended",
    mission: {
      state: "ended",
      node: { id: node, name: null },
      planet: null,
      type: { id: type, name: null },
      faction: null,
      enemyLevel: null,
      fissure: null,
      modifiers,
      selectedAt: null,
      loadingAt: null,
      startedAt: at - 600_000,
      endedAt: at,
      result,
      durationSeconds: 600,
      rewards: null,
    },
  };
}

export const sortie = (stage) => ({ id: "sortie", name: "Sortie", stage });
export const archon = (stage) => ({ id: "archon_hunt", name: "Archon Hunt", stage });
