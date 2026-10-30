//! Game events, per game: `permissions.gameEvents` names the features of a
//! game the widget follows (`warframe.mission`, `warframe.progress`…), and
//! `gameEvents.warframe.subscribe` gives their state and their latest
//! events, ready to show. They are not sensitive. A reader that does not
//! know them refuses the manifest: it needs the catalog feature
//! `game-events-warframe`.

use std::collections::BTreeSet;

use overcrow_widget_schema::catalog_v2::KNOWN_FEATURES;
use overcrow_widget_schema::game_events::{
    FEATURE_GAME_EVENTS_WARFRAME, GAME_EVENT_FEATURES, game_event_feature, warframe,
};
use overcrow_widget_schema::limits::{
    ALL, MAX_GAME_EVENT_NAME_BYTES, MAX_WARFRAME_EARNED, MAX_WARFRAME_FISSURES, MAX_WARFRAME_HUNTS,
    MAX_WARFRAME_MODIFIERS, MAX_WARFRAME_REWARD_ITEMS, MAX_WARFRAME_REWARD_TABLES,
    MAX_WARFRAME_SQUAD,
};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::results::{Shape, shape};
use overcrow_widget_schema::services::{Requirement, SERVICES, ServiceKind};
use serde_json::{Value, json};

fn widget(permissions: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.mission",
        "version": "1.0.0",
        "name": {"en": "Mission", "fr": "Mission"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 200, "height": 96},
            "max": {"width": 480, "height": 480}
        },
        "permissions": permissions
    })
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

fn matches(name: &str, value: &Value) -> bool {
    shape(name).expect("named shape").shape.matches(value)
}

#[test]
fn warframe_has_seven_features() {
    let table: Vec<_> = GAME_EVENT_FEATURES
        .iter()
        .map(|feature| {
            (
                feature.name,
                feature.game,
                feature.feature,
                feature.catalog_feature,
            )
        })
        .collect();
    let expected: Vec<_> = warframe::FEATURES
        .iter()
        .map(|feature| {
            (
                format!("warframe.{feature}"),
                "warframe",
                *feature,
                FEATURE_GAME_EVENTS_WARFRAME,
            )
        })
        .collect();
    assert_eq!(
        warframe::FEATURES,
        [
            "location", "mission", "progress", "squad", "eidolons", "world", "rewards"
        ]
    );
    assert_eq!(table.len(), expected.len());
    for (row, expected) in table.iter().zip(&expected) {
        assert_eq!(
            (row.0, row.1, row.2, row.3),
            (expected.0.as_str(), expected.1, expected.2, expected.3)
        );
    }
    assert_eq!(FEATURE_GAME_EVENTS_WARFRAME, "game-events-warframe");
    assert!(KNOWN_FEATURES.contains(&FEATURE_GAME_EVENTS_WARFRAME));
    assert!(game_event_feature("warframe.squad").is_some());
    assert!(game_event_feature("warframe").is_none());
}

#[test]
fn a_widget_declares_the_features_it_follows() {
    let manifest = validate(&widget(json!({
        "gameEvents": ["warframe.mission", "warframe.progress"]
    })))
    .expect("valid");
    assert_eq!(
        manifest.permissions.game_events,
        BTreeSet::from([
            "warframe.mission".to_owned(),
            "warframe.progress".to_owned()
        ])
    );
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        [FEATURE_GAME_EVENTS_WARFRAME]
    );
    // Without game events, no feature.
    let none = validate(&widget(json!({"storage": true}))).expect("valid");
    assert!(none.features().is_empty());
}

#[test]
fn former_and_unknown_names_are_refused() {
    for events in [
        json!(["overcrow.game.match.v1"]),
        json!(["overcrow.game.session.v1"]),
        json!(["warframe.inventory"]),
        json!(["Warframe.mission"]),
        json!(["warframe"]),
        json!(["warframe.mission", "warframe.mission"]),
        json!([""]),
    ] {
        assert!(
            validate(&widget(json!({"gameEvents": events}))).is_err(),
            "{events}"
        );
    }
}

#[test]
fn game_events_are_not_sensitive() {
    let manifest = validate(&widget(json!({
        "gameEvents": warframe::FEATURES.iter().map(|feature| format!("warframe.{feature}")).collect::<Vec<_>>(),
        "network": [{"origin": "https://drops.example.com", "method": "GET", "path": "/nodes"}],
        "links": [{"origin": "https://wiki.example.com"}],
        "clipboardWrite": true,
        "storage": true
    })))
    .expect("game events beside every way out");
    assert_eq!(manifest.permissions.game_events.len(), 7);
    assert!(!manifest.permissions.has_sensitive_capability());
}

#[test]
fn warframe_events_come_by_one_subscription() {
    assert!(
        SERVICES
            .iter()
            .all(|service| service.name != "gameEvents.subscribe")
    );
    assert!(shape("GameEvent").is_none());
    let service = SERVICES
        .iter()
        .find(|service| service.name == "gameEvents.warframe.subscribe")
        .expect("listed");
    assert_eq!(service.requires, Requirement::Permission("gameEvents"));
    assert_eq!(service.kind, ServiceKind::Subscribe);
    assert!(service.params.is_empty());
    assert!(!service.gesture);
    assert_eq!(service.returns, Shape::Named("WarframeEvents"));
}

fn node() -> Value {
    json!({"id": "SolNode195", "name": "Hydron"})
}

fn named(id: &str, name: &str) -> Value {
    json!({"id": id, "name": name})
}

fn mission(state: &str) -> Value {
    json!({
        "state": state,
        "node": node(),
        "planet": named("sedna", "Sedna"),
        "type": named("defense", "Defense"),
        "faction": named("grineer", "Grineer"),
        "enemyLevel": {"min": 30, "max": 40},
        "fissure": named("axi", "Axi"),
        "modifiers": [{"id": "steel_path", "name": "Steel Path", "stage": null}],
        "selectedAt": 1_793_000_000_000_u64,
        "loadingAt": 1_793_000_010_000_u64,
        "startedAt": 1_793_000_030_000_u64,
        "endedAt": if state == "ended" { json!(1_793_000_330_500_u64) } else { Value::Null },
        "result": if state == "ended" { json!("succeeded") } else { Value::Null },
        "durationSeconds": if state == "ended" { json!(300.5) } else { Value::Null },
        "rewards": if state == "in_progress" { rewards() } else { Value::Null },
        "rewardsPending": state == "selected",
        "earned": if state == "selected" { Value::Null } else { earned() },
        "credits": if state == "ended" { json!(34_300) } else { Value::Null }
    })
}

fn earned() -> Value {
    json!({"rotations": ["A", "A", "B", "C", "A"], "totals": {"A": 3, "B": 1, "C": 1}})
}

/// The glossary in English, every word of its lists.
fn glossary() -> Value {
    let words = |list: &[overcrow_widget_schema::game_events::Named]| {
        list.iter()
            .map(|word| (word.id.to_owned(), json!(word.english)))
            .collect::<serde_json::Map<_, _>>()
    };
    json!({
        "language": "en",
        "damage": words(warframe::DAMAGE_TYPES),
        "era": words(warframe::ERAS),
        "fissure": words(warframe::FISSURES),
        "activity": words(warframe::ACTIVITIES),
        "place": words(warframe::PLACES),
        "eidolon": words(warframe::EIDOLONS),
        "faction": words(warframe::FACTIONS),
        "cycle": words(warframe::CYCLE_STATES),
        "term": words(warframe::TERMS),
        "icons": {"damage": icons()}
    })
}

/// A symbol for Impact, none yet for the other damage types.
fn icons() -> Value {
    warframe::DAMAGE_TYPES
        .iter()
        .map(|damage| {
            let icon = if damage.id == "impact" {
                json!("asset:0000000000000001")
            } else {
                Value::Null
            };
            (damage.id.to_owned(), icon)
        })
        .collect::<serde_json::Map<_, _>>()
        .into()
}

fn rewards() -> Value {
    json!({"source": "node", "tables": [
        {"kind": "mission", "rotation": "A", "items": [
            {"id": "orokin_cell", "name": "Cellule Orokin", "quantity": 3, "chance": 0.0769,
             "icon": "asset:0000000000000002", "iconPending": false, "category": "resource"},
            {"id": "zid_an_core", "name": "Zid-An Core", "quantity": 1, "chance": 0.01,
             "icon": null, "iconPending": true, "category": "other"}
        ]},
        {"kind": "caches", "rotation": null, "items": []}
    ]})
}

fn progress() -> Value {
    json!({
        "wave": 5,
        "waveEnemies": {"total": 19, "left": 7},
        "round": null,
        "rewards": 1,
        "rotation": "A",
        "earned": {"rotations": ["A"], "totals": {"A": 1, "B": 0, "C": 0}},
        "cycle": {"number": 1, "rotations": ["A", "A", "B", "C"], "earned": 1},
        "clock": null,
        "nextRewardAt": null,
        "nextRewardWave": 6
    })
}

fn hunt() -> Value {
    json!({
        "eidolon": named("teralyst", "Teralyst"),
        "spawnedAt": 1_793_000_100_123_u64,
        "weakpoints": 4,
        "capturedAt": 1_793_000_190_456_u64,
        "killedAt": null,
        "fledAt": null
    })
}

fn world() -> Value {
    let world_mission = json!({
        "node": node(),
        "planet": named("sedna", "Sedna"),
        "type": named("defense", "Defense"),
        "modifier": named("augmented_armor", "Augmented Enemy Armor")
    });
    json!({
        "updatedAt": 1_793_000_000_000_u64,
        "sortie": {
            "boss": named("captain_vor", "Captain Vor"),
            "faction": named("grineer", "Grineer"),
            "endsAt": 1_793_050_000_000_u64,
            "missions": [world_mission.clone(), world_mission.clone(), world_mission.clone()]
        },
        "archonHunt": {
            "boss": named("amar", "Archon Amar"),
            "endsAt": 1_793_400_000_000_u64,
            "missions": [world_mission]
        },
        "fissures": [{
            "node": node(),
            "planet": named("sedna", "Sedna"),
            "type": named("defense", "Defense"),
            "era": named("axi", "Axi"),
            "steelPath": false,
            "voidStorm": false,
            "endsAt": 1_793_003_000_000_u64
        }],
        "cycles": {
            "cetus": {"state": named("night", "Night"), "endsAt": 1_793_001_000_000_u64},
            "vallis": null,
            "cambion": {"state": named("vome", "Vome"), "endsAt": 1_793_001_000_000_u64}
        },
        "resets": {"daily": 1_793_059_200_000_u64, "weekly": 1_793_404_800_000_u64},
        "voidTrader": {
            "arrivesAt": 1_793_100_000_000_u64,
            "leavesAt": 1_793_272_800_000_u64,
            "relay": named("strata_relay", "Strata Relay")
        },
        "circuit": null
    })
}

fn full() -> Value {
    json!({
        "playing": true,
        "session": {"startedAt": 1_792_999_000_000_u64, "language": "fr"},
        "glossary": glossary(),
        "features": {
            "location": "available",
            "mission": "available",
            "progress": "available",
            "squad": "unavailable",
            "eidolons": "undeclared",
            "world": "available",
            "rewards": "available"
        },
        "info": {
            "location": {"kind": "mission", "place": named("SolNode195", "Hydron"), "since": 1_793_000_030_000_u64},
            "mission": mission("in_progress"),
            "progress": progress(),
            "squad": {"members": [{"name": "Nova", "you": true}]},
            "eidolons": {"night": true, "hunts": [hunt()]},
            "world": world()
        },
        "events": [
            {"seq": 1, "at": 1_793_000_000_000_u64, "type": "mission_selected", "mission": mission("selected")},
            {"seq": 2, "at": 1_793_000_330_500_u64, "type": "mission_ended", "mission": mission("ended")},
            {"seq": 3, "at": 1_793_000_100_000_u64, "type": "wave_started", "progress": progress()},
            {"seq": 4, "at": 1_793_000_100_000_u64, "type": "night_started"},
            {"seq": 5, "at": 1_793_000_190_456_u64, "type": "eidolon_captured", "eidolon": hunt()},
            {"seq": 6, "at": 1_793_000_000_000_u64, "type": "member_joined", "member": {"name": "Ember", "you": false}},
            {"seq": 7, "at": 1_793_000_000_000_u64, "type": "location_changed",
             "location": {"kind": "orbiter", "place": null, "since": 1_793_000_000_000_u64}}
        ]
    })
}

#[test]
fn a_full_value_has_the_shape() {
    assert!(matches("WarframeEvents", &full()));
    let empty = json!({
        "playing": false,
        "session": null,
        "glossary": glossary(),
        "features": {
            "location": "undeclared", "mission": "available", "progress": "undeclared",
            "squad": "undeclared", "eidolons": "undeclared", "world": "undeclared",
            "rewards": "undeclared"
        },
        "info": {
            "location": null, "mission": null, "progress": null,
            "squad": null, "eidolons": null, "world": null
        },
        "events": []
    });
    assert!(matches("WarframeEvents", &empty));
    // A session whose language is not read yet; a Survival before its clock.
    let mut value = full();
    value["session"]["language"] = Value::Null;
    value["info"]["progress"]["clock"] = json!("waiting");
    value["info"]["progress"]["waveEnemies"] = json!({"total": 15, "left": null});
    value["info"]["progress"]["cycle"] = Value::Null;
    assert!(matches("WarframeEvents", &value));
    // The glossary is never absent.
    let mut value = full();
    value.as_object_mut().unwrap().remove("glossary");
    assert!(!matches("WarframeEvents", &value));
}

#[test]
fn the_glossary_has_every_word_of_its_lists() {
    let Some(Shape::Record(members)) = shape("WarframeGlossary").map(|named| named.shape) else {
        panic!("a record");
    };
    let groups: Vec<_> = members.iter().map(|member| member.name).collect();
    assert_eq!(
        groups,
        [
            "language", "damage", "era", "fissure", "activity", "place", "eidolon", "faction",
            "cycle", "term", "icons"
        ]
    );
    for (group, list) in [
        ("damage", warframe::DAMAGE_TYPES),
        ("era", warframe::ERAS),
        ("fissure", warframe::FISSURES),
        ("activity", warframe::ACTIVITIES),
        ("place", warframe::PLACES),
        ("eidolon", warframe::EIDOLONS),
        ("faction", warframe::FACTIONS),
        ("cycle", warframe::CYCLE_STATES),
        ("term", warframe::TERMS),
    ] {
        let member = members
            .iter()
            .find(|member| member.name == group)
            .expect(group);
        let Shape::Record(words) = member.shape else {
            panic!("{group}: a record");
        };
        assert_eq!(
            words.iter().map(|word| word.name).collect::<Vec<_>>(),
            list.iter().map(|word| word.id).collect::<Vec<_>>(),
            "{group}"
        );
        assert!(
            words.iter().all(|word| word.shape == Shape::Text),
            "{group}"
        );
        // A word missing, or one more, is refused.
        let mut value = glossary();
        value[group].as_object_mut().unwrap().remove(list[0].id);
        assert!(!matches("WarframeGlossary", &value), "{group}");
        let mut value = glossary();
        value[group]["extra"] = json!("Extra");
        assert!(!matches("WarframeGlossary", &value), "{group}");
    }
    assert_eq!(warframe::DAMAGE_TYPES.len(), 13);
    assert_eq!(
        warframe::FISSURES
            .iter()
            .map(|fissure| fissure.id)
            .collect::<Vec<_>>(),
        warframe::ERAS.iter().map(|era| era.id).collect::<Vec<_>>()
    );
    assert_eq!(warframe::LANGUAGES.len(), 15);
    assert!(
        warframe::GLOSSARY_LANGUAGES
            .iter()
            .all(|language| warframe::LANGUAGES.contains(language))
    );
}

#[test]
fn the_glossary_has_a_symbol_per_damage_type() {
    let Some(Shape::Record(members)) = shape("WarframeGlossaryIcons").map(|named| named.shape)
    else {
        panic!("a record");
    };
    assert_eq!(
        members.iter().map(|member| member.name).collect::<Vec<_>>(),
        ["damage"]
    );
    let Shape::Record(symbols) = members[0].shape else {
        panic!("a record");
    };
    assert_eq!(
        symbols.iter().map(|symbol| symbol.name).collect::<Vec<_>>(),
        warframe::DAMAGE_TYPES
            .iter()
            .map(|damage| damage.id)
            .collect::<Vec<_>>()
    );
    assert!(
        symbols
            .iter()
            .all(|symbol| symbol.shape == Shape::Nullable(&Shape::Asset))
    );
    assert!(matches("WarframeGlossary", &glossary()));
    // A handle only: never a package path or an address.
    for refused in [
        json!("assets/impact.png"),
        json!("https://wiki.warframe.com/images/DmgImpactSmall64.png"),
        json!(1),
    ] {
        let mut value = glossary();
        value["icons"]["damage"]["impact"] = refused;
        assert!(!matches("WarframeGlossary", &value));
    }
    let mut value = glossary();
    value["icons"]["damage"]
        .as_object_mut()
        .unwrap()
        .remove("viral");
    assert!(!matches("WarframeGlossary", &value), "a symbol missing");
    let mut value = glossary();
    value.as_object_mut().unwrap().remove("icons");
    assert!(!matches("WarframeGlossary", &value), "never absent");
    // The host without them gives every symbol `null`.
    let english = warframe::english_glossary();
    assert!(matches("WarframeGlossary", &english), "{english}");
    assert!(
        english["icons"]["damage"]
            .as_object()
            .unwrap()
            .values()
            .all(Value::is_null)
    );
}

#[test]
fn a_reward_has_its_image_and_its_kind() {
    assert_eq!(
        warframe::REWARD_CATEGORIES,
        [
            "relic",
            "mod",
            "resource",
            "blueprint",
            "warframe_part",
            "weapon_part",
            "arcane",
            "currency",
            "other"
        ]
    );
    let item = rewards()["tables"][0]["items"][0].clone();
    assert!(matches("WarframeReward", &item));
    for (member, refused) in [
        ("icon", json!("assets/orokin_cell.png")),
        ("iconPending", Value::Null),
        ("category", json!("cosmetic")),
        ("category", Value::Null),
    ] {
        let mut value = item.clone();
        value[member] = refused;
        assert!(!matches("WarframeReward", &value), "{member}");
    }
    for member in ["icon", "iconPending", "category"] {
        let mut value = item.clone();
        value.as_object_mut().unwrap().remove(member);
        assert!(!matches("WarframeReward", &value), "{member} absent");
    }
}

#[test]
fn each_event_has_one_form() {
    let events = full()["events"].as_array().unwrap().clone();
    for event in &events {
        assert!(matches("WarframeEvent", event), "{event}");
    }
    // The data member must be the one of its type.
    let mut wrong = events[0].clone();
    wrong["type"] = json!("wave_started");
    assert!(!matches("WarframeEvent", &wrong));
    let mut two = events[0].clone();
    two["progress"] = progress();
    assert!(!matches("WarframeEvent", &two));
    let mut bare = events[3].clone();
    bare["type"] = json!("mission_ended");
    assert!(!matches("WarframeEvent", &bare));
    let unknown = json!({"seq": 9, "at": 1, "type": "relic_opened"});
    assert!(!matches("WarframeEvent", &unknown));
}

#[test]
fn values_out_of_their_words_are_refused() {
    for (path, value) in [
        ("/features/mission", json!("maybe")),
        ("/info/mission/state", json!("paused")),
        ("/info/mission/result", json!("won")),
        ("/info/mission/modifiers/0/id", json!("hard_mode")),
        ("/info/progress/rotation", json!("D")),
        ("/info/location/kind", json!("ship")),
        ("/info/mission/rewards/tables/0/kind", json!("bonus")),
        ("/info/mission/rewards/source", json!("archon_hunt")),
        ("/info/mission/rewards/tables/0/items/0/name", Value::Null),
        ("/info/mission/node/id", Value::Null),
        ("/session/language", json!("xx")),
        ("/glossary/language", json!("de")),
        ("/info/progress/clock", json!("paused")),
        ("/info/progress/earned/rotations/0", json!("D")),
        ("/info/progress/earned/totals/A", json!(1.5)),
        ("/info/progress/cycle/rotations/0", json!("E")),
        ("/info/progress/waveEnemies/total", Value::Null),
        ("/info/mission/credits", json!("34300")),
    ] {
        let mut value_of = full();
        *value_of.pointer_mut(path).expect(path) = value;
        assert!(!matches("WarframeEvents", &value_of), "{path}");
    }
}

#[test]
fn a_node_is_its_key_and_its_name() {
    let mut value = full();
    value["info"]["mission"]["node"]["englishName"] = json!("Hydron");
    assert!(!matches("WarframeEvents", &value));
}

#[test]
fn the_bounds_are_listed() {
    for (limit, value) in [
        (&MAX_GAME_EVENT_NAME_BYTES, 128),
        (&MAX_WARFRAME_SQUAD, 8),
        (&MAX_WARFRAME_HUNTS, 16),
        (&MAX_WARFRAME_MODIFIERS, 8),
        (&MAX_WARFRAME_FISSURES, 64),
        (&MAX_WARFRAME_REWARD_TABLES, 9),
        (&MAX_WARFRAME_REWARD_ITEMS, 64),
        (&MAX_WARFRAME_EARNED, 64),
    ] {
        assert_eq!(limit.value, value, "{}", limit.key);
        assert!(
            ALL.iter().any(|listed| listed.key == limit.key),
            "{}",
            limit.key
        );
    }
}

#[test]
fn our_ids_are_stable_snake_case_and_distinct() {
    for (list, name) in [
        (warframe::PLANETS, "planets"),
        (warframe::MISSION_TYPES, "mission types"),
        (warframe::FACTIONS, "factions"),
        (warframe::ERAS, "eras"),
        (warframe::PLACES, "places"),
        (warframe::EIDOLONS, "eidolons"),
        (warframe::CYCLE_STATES, "cycle states"),
        (warframe::MODIFIERS, "modifiers"),
        (warframe::SORTIE_MODIFIERS, "sortie modifiers"),
        (warframe::BOSSES, "bosses"),
        (warframe::DAMAGE_TYPES, "damage types"),
        (warframe::FISSURES, "fissures"),
        (warframe::ACTIVITIES, "activities"),
        (warframe::TERMS, "terms"),
    ] {
        let mut seen = BTreeSet::new();
        assert!(!list.is_empty(), "{name}");
        for entry in list {
            assert!(
                !entry.id.is_empty()
                    && entry.id.bytes().all(|byte| byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || byte == b'_')
                    && !entry.id.starts_with('_')
                    && !entry.id.ends_with('_'),
                "{name}: {}",
                entry.id
            );
            assert!(!entry.english.is_empty(), "{name}: {}", entry.id);
            assert!(seen.insert(entry.id), "{name}: {} twice", entry.id);
        }
    }
    assert_eq!(
        warframe::ERAS.iter().map(|era| era.id).collect::<Vec<_>>(),
        ["lith", "meso", "neo", "axi", "requiem", "omnia"]
    );
    assert_eq!(
        warframe::EIDOLONS
            .iter()
            .map(|eidolon| eidolon.id)
            .collect::<Vec<_>>(),
        ["teralyst", "gantulyst", "hydrolyst"]
    );
}

#[test]
fn the_modifier_words_are_the_listed_modifiers() {
    assert_eq!(
        warframe::MODIFIER_IDS,
        warframe::MODIFIERS
            .iter()
            .map(|modifier| modifier.id)
            .collect::<Vec<_>>()
    );
}

#[test]
fn each_event_belongs_to_one_feature() {
    for (events, feature) in [
        (warframe::MISSION_EVENTS, "mission"),
        (warframe::PROGRESS_EVENTS, "progress"),
        (warframe::CYCLE_EVENTS, "eidolons"),
        (warframe::EIDOLON_EVENTS, "eidolons"),
        (warframe::SQUAD_EVENTS, "squad"),
        (warframe::LOCATION_EVENTS, "location"),
    ] {
        for event in events {
            assert_eq!(warframe::feature_of_event(event), Some(feature), "{event}");
        }
    }
    assert_eq!(warframe::feature_of_event("relic_opened"), None);
}
