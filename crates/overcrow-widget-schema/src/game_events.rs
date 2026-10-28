//! Game events, per game (`permissions.gameEvents`). A widget lists the
//! features of a game it follows, each `<game>.<feature>`, and the game's
//! service (`gameEvents.<game>.subscribe`) gives their state (`info`), their
//! latest events and the status of each feature, ready to show: PlayerVox
//! OverCrow names everything in the user's language and gives stable IDs
//! beside the names, real times in Unix milliseconds and durations in
//! seconds. Game events are not sensitive.
//!
//! Warframe is the first game. Its IDs are ours, in `snake_case`, and never
//! change, except a node's, which is the game's own key (`SolNode195`): the
//! one public data such as drop tables and the world state use.

/// A game's feature a widget may follow.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GameEventFeature {
    /// The name a manifest lists: `<game>.<feature>`.
    pub name: &'static str,
    pub game: &'static str,
    pub feature: &'static str,
    /// The catalog feature a manifest that lists it requires.
    pub catalog_feature: &'static str,
    pub summary: &'static str,
}

/// The Warframe features of the first version. A reader that does not know
/// game events refuses the manifest.
pub const FEATURE_GAME_EVENTS_WARFRAME: &str = "game-events-warframe";

const fn warframe(
    name: &'static str,
    feature: &'static str,
    summary: &'static str,
) -> GameEventFeature {
    GameEventFeature {
        name,
        game: "warframe",
        feature,
        catalog_feature: FEATURE_GAME_EVENTS_WARFRAME,
        summary,
    }
}

/// Every feature a manifest may list in `gameEvents`.
pub const GAME_EVENT_FEATURES: &[GameEventFeature] = &[
    warframe(
        "warframe.location",
        "location",
        "Where the player is: orbiter, relay, hub, open world or mission.",
    ),
    warframe(
        "warframe.mission",
        "mission",
        "The mission chosen, loading, in progress or ended: node, planet, type, faction, enemy levels, Void Fissure era, modifiers, result and duration.",
    ),
    warframe(
        "warframe.progress",
        "progress",
        "The progress of the mission: wave, round, rewards given, the rotation of the next reward and when it comes.",
    ),
    warframe(
        "warframe.squad",
        "squad",
        "The names of the player and of their squad.",
    ),
    warframe(
        "warframe.eidolons",
        "eidolons",
        "Night and day on the Plains of Eidolon, and each Eidolon of the night: spawn, weak points, capture, kill or escape, to the millisecond.",
    ),
    warframe(
        "warframe.world",
        "world",
        "The world of the day and the week: Sortie, Archon Hunt, Void Fissures, the cycles of the open worlds, Baro Ki'Teer and the resets.",
    ),
];

/// The feature named `name`, if a manifest may list it.
pub fn game_event_feature(name: &str) -> Option<&'static GameEventFeature> {
    GAME_EVENT_FEATURES
        .iter()
        .find(|feature| feature.name == name)
}

/// What a widget learns of each feature it may follow: `available` while
/// PlayerVox OverCrow follows it on this computer, `unavailable` when it
/// cannot (the game is not found, or writes in a way it does not know),
/// `undeclared` for a feature the manifest does not list.
pub const FEATURE_STATUSES: &[&str] = &["available", "unavailable", "undeclared"];

/// One of our IDs and its English name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Named {
    pub id: &'static str,
    pub english: &'static str,
}

const fn named(id: &'static str, english: &'static str) -> Named {
    Named { id, english }
}

/// Warframe: the features, the words of the shapes and our IDs.
pub mod warframe {
    use super::{Named, named};

    /// The features, in the order of `info` and `features`.
    pub const FEATURES: &[&str] = &[
        "location", "mission", "progress", "squad", "eidolons", "world",
    ];

    /// Where the player is (`location.kind`).
    pub const LOCATION_KINDS: &[&str] = &[
        "orbiter",
        "relay",
        "hub",
        "open_world",
        "mission",
        "dojo",
        "other",
    ];

    /// The steps of a mission (`mission.state`): chosen on the star chart
    /// (`selected`), loading, in progress, ended.
    pub const MISSION_STATES: &[&str] = &["selected", "loading", "in_progress", "ended"];

    /// How a mission ended, when the game says so.
    pub const RESULTS: &[&str] = &["succeeded", "failed", "aborted"];

    /// Reward rotations.
    pub const ROTATIONS: &[&str] = &["A", "B", "C"];

    pub const MISSION_EVENTS: &[&str] = &[
        "mission_selected",
        "mission_loading",
        "mission_started",
        "mission_ended",
    ];
    pub const PROGRESS_EVENTS: &[&str] = &["wave_started", "reward_given"];
    pub const CYCLE_EVENTS: &[&str] = &["night_started", "day_started"];
    pub const EIDOLON_EVENTS: &[&str] = &[
        "eidolon_spawned",
        "weakpoint_destroyed",
        "eidolon_captured",
        "eidolon_killed",
        "eidolon_fled",
    ];
    pub const SQUAD_EVENTS: &[&str] = &["member_joined", "member_left"];
    pub const LOCATION_EVENTS: &[&str] = &["location_changed"];

    /// The feature an event type belongs to: a widget gets only the events
    /// of the features it lists.
    pub fn feature_of_event(event: &str) -> Option<&'static str> {
        [
            (MISSION_EVENTS, "mission"),
            (PROGRESS_EVENTS, "progress"),
            (CYCLE_EVENTS, "eidolons"),
            (EIDOLON_EVENTS, "eidolons"),
            (SQUAD_EVENTS, "squad"),
            (LOCATION_EVENTS, "location"),
        ]
        .into_iter()
        .find(|(events, _)| events.contains(&event))
        .map(|(_, feature)| feature)
    }

    /// What changes a mission (`mission.modifiers[].id`).
    pub const MODIFIERS: &[Named] = &[
        named("steel_path", "Steel Path"),
        named("arbitration", "Arbitration"),
        named("sortie", "Sortie"),
        named("archon_hunt", "Archon Hunt"),
        named("nightmare", "Nightmare"),
        named("void_storm", "Void Storm"),
        named("alert", "Alert"),
        named("lich", "Kuva Lich"),
    ];

    /// The planets and regions of the star chart (`planet.id`).
    pub const PLANETS: &[Named] = &[
        named("mercury", "Mercury"),
        named("venus", "Venus"),
        named("earth", "Earth"),
        named("mars", "Mars"),
        named("jupiter", "Jupiter"),
        named("saturn", "Saturn"),
        named("uranus", "Uranus"),
        named("neptune", "Neptune"),
        named("pluto", "Pluto"),
        named("ceres", "Ceres"),
        named("eris", "Eris"),
        named("sedna", "Sedna"),
        named("europa", "Europa"),
        named("void", "Void"),
        named("phobos", "Phobos"),
        named("deimos", "Deimos"),
        named("lua", "Lua"),
        named("kuva_fortress", "Kuva Fortress"),
        named("zariman", "Zariman"),
        named("duviri", "Duviri"),
        named("hollvania", "Höllvania"),
        named("dark_refractory", "Dark Refractory"),
    ];

    /// Mission types (`type.id`). A type outside this list is `null`.
    pub const MISSION_TYPES: &[Named] = &[
        named("assassination", "Assassination"),
        named("extermination", "Extermination"),
        named("survival", "Survival"),
        named("rescue", "Rescue"),
        named("sabotage", "Sabotage"),
        named("capture", "Capture"),
        named("spy", "Spy"),
        named("defense", "Defense"),
        named("mobile_defense", "Mobile Defense"),
        named("interception", "Interception"),
        named("hijack", "Hijack"),
        named("hive", "Hive"),
        named("excavation", "Excavation"),
        named("infested_salvage", "Infested Salvage"),
        named("rathuum", "Rathuum"),
        named("junction", "Junction"),
        named("pursuit", "Pursuit"),
        named("rush", "Rush"),
        named("assault", "Assault"),
        named("defection", "Defection"),
        named("free_roam", "Free Roam"),
        named("disruption", "Disruption"),
        named("void_flood", "Void Flood"),
        named("void_cascade", "Void Cascade"),
        named("orphix", "Orphix"),
        named("netracell", "Netracell"),
        named("alchemy", "Alchemy"),
        named("circuit", "The Circuit"),
        named("ascension", "Ascension"),
        named("legacyte_harvest", "Legacyte Harvest"),
        named("shrine_defense", "Shrine Defense"),
    ];

    /// Factions (`faction.id`).
    pub const FACTIONS: &[Named] = &[
        named("grineer", "Grineer"),
        named("corpus", "Corpus"),
        named("infested", "Infested"),
        named("corrupted", "Corrupted"),
        named("sentient", "Sentient"),
        named("narmer", "Narmer"),
        named("murmur", "The Murmur"),
        named("scaldra", "Scaldra"),
        named("techrot", "Techrot"),
        named("tenno", "Tenno"),
    ];

    /// Void Fissure eras (`fissure.id`, `era.id`).
    pub const ERAS: &[Named] = &[
        named("lith", "Lith"),
        named("meso", "Meso"),
        named("neo", "Neo"),
        named("axi", "Axi"),
        named("requiem", "Requiem"),
        named("omnia", "Omnia"),
    ];

    /// Places that are not a node (`location.place.id`, `voidTrader.relay.id`).
    pub const PLACES: &[Named] = &[
        named("drifter_camp", "Drifter's Camp"),
        named("larunda_relay", "Larunda Relay"),
        named("vesper_relay", "Vesper Relay"),
        named("strata_relay", "Strata Relay"),
        named("kronia_relay", "Kronia Relay"),
        named("orcus_relay", "Orcus Relay"),
        named("cetus", "Cetus"),
        named("fortuna", "Fortuna"),
        named("necralisk", "Necralisk"),
        named("sanctum_anatomica", "Sanctum Anatomica"),
        named("chrysalith", "Chrysalith"),
        named("plains_of_eidolon", "Plains of Eidolon"),
        named("orb_vallis", "Orb Vallis"),
        named("cambion_drift", "Cambion Drift"),
    ];

    /// The three Eidolons (`eidolon.id`).
    pub const EIDOLONS: &[Named] = &[
        named("teralyst", "Teralyst"),
        named("gantulyst", "Gantulyst"),
        named("hydrolyst", "Hydrolyst"),
    ];

    /// States of the open worlds' cycles (`cycles.*.state.id`): Cetus,
    /// day and night; Orb Vallis, warm and cold; Cambion Drift, Fass and
    /// Vome.
    pub const CYCLE_STATES: &[Named] = &[
        named("day", "Day"),
        named("night", "Night"),
        named("warm", "Warm"),
        named("cold", "Cold"),
        named("fass", "Fass"),
        named("vome", "Vome"),
    ];

    /// The conditions of a Sortie mission (`modifier.id` of the world).
    pub const SORTIE_MODIFIERS: &[Named] = &[
        named("energy_reduction", "Energy Reduction"),
        named("augmented_armor", "Augmented Enemy Armor"),
        named("enhanced_shields", "Enhanced Enemy Shields"),
        named("eximus_stronghold", "Eximus Stronghold"),
        named("impact_enhancement", "Enemy Physical Enhancement: Impact"),
        named(
            "puncture_enhancement",
            "Enemy Physical Enhancement: Puncture",
        ),
        named("slash_enhancement", "Enemy Physical Enhancement: Slash"),
        named("heat_enhancement", "Enemy Elemental Enhancement: Heat"),
        named("cold_enhancement", "Enemy Elemental Enhancement: Cold"),
        named(
            "electricity_enhancement",
            "Enemy Elemental Enhancement: Electricity",
        ),
        named("toxin_enhancement", "Enemy Elemental Enhancement: Toxin"),
        named("blast_enhancement", "Enemy Elemental Enhancement: Blast"),
        named(
            "corrosive_enhancement",
            "Enemy Elemental Enhancement: Corrosive",
        ),
        named("gas_enhancement", "Enemy Elemental Enhancement: Gas"),
        named(
            "magnetic_enhancement",
            "Enemy Elemental Enhancement: Magnetic",
        ),
        named(
            "radiation_enhancement",
            "Enemy Elemental Enhancement: Radiation",
        ),
        named("viral_enhancement", "Enemy Elemental Enhancement: Viral"),
        named(
            "radiation_pockets",
            "Environmental Hazard: Radiation Pockets",
        ),
        named(
            "electromagnetic_anomalies",
            "Environmental Hazard: Electromagnetic Anomalies",
        ),
        named("dense_fog", "Environmental Effect: Dense Fog"),
        named("fire", "Environmental Hazard: Fire"),
        named(
            "cryogenic_leakage",
            "Environmental Effect: Cryogenic Leakage",
        ),
        named("extreme_cold", "Environmental Effect: Extreme Cold"),
        named("pistol_only", "Weapon Restriction: Pistol Only"),
        named("shotgun_only", "Weapon Restriction: Shotgun Only"),
        named("sniper_only", "Weapon Restriction: Sniper Only"),
        named(
            "assault_rifle_only",
            "Weapon Restriction: Assault Rifle Only",
        ),
        named("melee_only", "Weapon Restriction: Melee Only"),
        named("bow_only", "Weapon Restriction: Bow Only"),
    ];

    /// The bosses of the Sortie and the Archons of the Archon Hunt (`boss.id`).
    pub const BOSSES: &[Named] = &[
        named("captain_vor", "Captain Vor"),
        named("vay_hek", "Councilor Vay Hek"),
        named("sargas_ruk", "General Sargas Ruk"),
        named("kela_de_thaym", "Kela De Thaym"),
        named("lech_kril", "Lieutenant Lech Kril"),
        named("tyl_regor", "Tyl Regor"),
        named("alad_v", "Alad V"),
        named("ambulas", "Ambulas"),
        named("hyena_pack", "Hyena Pack"),
        named("jackal", "Jackal"),
        named("nef_anyo", "Nef Anyo"),
        named("raptors", "The Raptors"),
        named("phorid", "Phorid"),
        named("lephantis", "Lephantis"),
        named("mutalist_alad_v", "Mutalist Alad V"),
        named("corrupted_vor", "Corrupted Vor"),
        named("archon_amar", "Archon Amar"),
        named("archon_nira", "Archon Nira"),
        named("archon_boreal", "Archon Boreal"),
    ];

    /// Modifier IDs only, the words of `WarframeModifier.id`.
    pub const MODIFIER_IDS: &[&str] = &[
        "steel_path",
        "arbitration",
        "sortie",
        "archon_hunt",
        "nightmare",
        "void_storm",
        "alert",
        "lich",
    ];
}
