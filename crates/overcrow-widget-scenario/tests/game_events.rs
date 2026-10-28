//! Game events in a scenario: a `gameEvents` step changes what the game
//! tells the widget, in its own words (`info` members merged into the
//! current state, then an event of the step's type), and the scenario's
//! fake host publishes the whole value of the game's service. A creator
//! replays a session — mission loaded, wave 5, mission succeeded —
//! without knowing how PlayerVox OverCrow learns it.

use std::collections::BTreeSet;

use overcrow_widget_scenario::{DEFAULT_START_AT, GameEvents, parse};
use overcrow_widget_schema::manifest::validate_manifest;
use serde_json::{Value, json};

fn scenario(fixtures: Value, steps: Value) -> Value {
    json!({"scenarioVersion": 1, "name": "warframe", "fixtures": fixtures, "steps": steps})
}

fn read(
    value: &Value,
) -> Result<overcrow_widget_scenario::Scenario, overcrow_widget_scenario::ScenarioError> {
    parse(&serde_json::to_vec(value).expect("bytes"))
}

fn declared(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn session() -> Value {
    scenario(
        json!({}),
        json!([
            {"gameEvents": {"warframe": {
                "info": {"mission": {
                    "state": "loading",
                    "node": {"id": "SolNode195", "name": "Hydron"},
                    "type": {"id": "defense", "name": "Defense"}
                }},
                "event": "mission_loading"
            }}},
            {"advance": {"ms": 30_000}},
            {"gameEvents": {"warframe": {
                "info": {"mission": {"state": "in_progress"}, "progress": {"wave": 5}},
                "event": "wave_started"
            }}},
            {"gameEvents": {"warframe": {
                "info": {"mission": {"state": "ended", "result": "succeeded", "durationSeconds": 300.5}},
                "event": "mission_ended"
            }}}
        ]),
    )
}

#[test]
fn a_session_is_played_without_writing_a_line() {
    let scenario = read(&session()).expect("valid");
    let updates = scenario
        .game_event_updates(&declared(&["warframe.mission", "warframe.progress"]))
        .expect("played");
    assert_eq!(
        updates
            .iter()
            .map(|update| (update.step, update.service))
            .collect::<Vec<_>>(),
        [
            (0, "gameEvents.warframe.subscribe"),
            (2, "gameEvents.warframe.subscribe"),
            (3, "gameEvents.warframe.subscribe"),
        ]
    );
    let first = &updates[0].value;
    assert_eq!(first["playing"], json!(true));
    assert_eq!(first["session"], Value::Null);
    assert_eq!(
        first["features"],
        json!({
            "location": "undeclared", "mission": "available", "progress": "available",
            "squad": "undeclared", "eidolons": "undeclared", "world": "undeclared",
            "rewards": "undeclared"
        })
    );
    assert_eq!(
        first["info"]["mission"],
        json!({
            "state": "loading",
            "node": {"id": "SolNode195", "name": "Hydron"},
            "planet": null,
            "type": {"id": "defense", "name": "Defense"},
            "faction": null,
            "enemyLevel": null,
            "fissure": null,
            "modifiers": [],
            "selectedAt": null,
            "loadingAt": null,
            "startedAt": null,
            "endedAt": null,
            "result": null,
            "durationSeconds": null,
            "rewards": null,
            "rewardsPending": false,
            "earned": null,
            "credits": null
        })
    );
    assert_eq!(first["info"]["progress"], Value::Null);
    assert_eq!(
        first["glossary"],
        overcrow_widget_schema::game_events::warframe::english_glossary()
    );
    assert_eq!(first["events"].as_array().unwrap().len(), 1);
    assert_eq!(first["events"][0]["seq"], json!(1));
    assert_eq!(first["events"][0]["at"], json!(DEFAULT_START_AT));
    assert_eq!(first["events"][0]["type"], json!("mission_loading"));
    assert_eq!(first["events"][0]["mission"], first["info"]["mission"]);

    let wave = &updates[1].value;
    assert_eq!(wave["info"]["mission"]["state"], json!("in_progress"));
    assert_eq!(wave["info"]["mission"]["node"]["id"], json!("SolNode195"));
    assert_eq!(
        wave["info"]["progress"],
        json!({"wave": 5, "waveEnemies": null, "round": null, "rewards": 0, "rotation": null,
               "earned": {"rotations": [], "totals": {"A": 0, "B": 0, "C": 0}},
               "cycle": null, "clock": null, "nextRewardAt": null, "nextRewardWave": null})
    );
    assert_eq!(wave["events"][1]["seq"], json!(2));
    assert_eq!(wave["events"][1]["at"], json!(DEFAULT_START_AT + 30_000));
    assert_eq!(wave["events"][1]["progress"], wave["info"]["progress"]);

    let ended = &updates[2].value;
    let events = ended["events"].as_array().unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event["seq"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [1, 2, 3]
    );
    assert_eq!(events[2]["type"], json!("mission_ended"));
    assert_eq!(events[2]["mission"]["result"], json!("succeeded"));
    assert_eq!(events[2]["mission"]["durationSeconds"], json!(300.5));
}

#[test]
fn the_steps_are_checked_against_the_manifest() {
    let manifest = |events: Value| {
        validate_manifest(
            json!({
                "schemaVersion": 1, "apiVersion": 1, "id": "nova.mission", "version": "1.0.0",
                "name": {"en": "Mission", "fr": "Mission"},
                "sizing": {"fit": "height", "preferred": {"width": 300, "height": 170},
                           "min": {"width": 200, "height": 96}, "max": {"width": 480, "height": 480}},
                "permissions": {"gameEvents": events}
            })
            .to_string()
            .as_bytes(),
        )
        .expect("manifest")
    };
    let scenario = read(&session()).expect("valid");
    scenario
        .check_against(&manifest(json!(["warframe.mission", "warframe.progress"])))
        .expect("both declared");
    let error = scenario
        .check_against(&manifest(json!(["warframe.mission"])))
        .expect_err("progress is not declared");
    assert_eq!(error.path, "steps[2].gameEvents.warframe.info.progress");
    let rewards = read(&scenario_of(json!({"info": {"mission": {
        "state": "selected", "node": {"id": "SolNode195"},
        "rewards": {"tables": [{"kind": "mission", "rotation": "A", "items": [
            {"id": "orokin_cell", "name": "Orokin Cell", "quantity": 1, "chance": 0.25}
        ]}]}
    }}})))
    .expect("valid alone");
    rewards
        .check_against(&manifest(json!(["warframe.mission", "warframe.rewards"])))
        .expect("rewards declared");
    let error = rewards
        .check_against(&manifest(json!(["warframe.mission"])))
        .expect_err("rewards are not declared");
    assert_eq!(
        error.path,
        "steps[0].gameEvents.warframe.info.mission.rewards"
    );
    let squad = read(&scenario_of(json!({"event": {"type": "member_joined",
        "member": {"name": "Ember", "you": false}}})))
    .expect("valid alone");
    let error = squad
        .check_against(&manifest(json!(["warframe.mission"])))
        .expect_err("squad is not declared");
    assert_eq!(error.path, "steps[0].gameEvents.warframe.event");
}

fn scenario_of(step: Value) -> Value {
    scenario(json!({}), json!([{"gameEvents": {"warframe": step}}]))
}

#[test]
fn incomplete_or_unknown_steps_are_refused_with_their_path() {
    for (step, path) in [
        (
            json!({"info": {"mission": {"state": "loading", "node": {"name": "Hydron"}}}}),
            "steps[0].gameEvents.warframe.info.mission.node.id",
        ),
        (
            json!({"info": {"mission": {"node": {"id": "SolNode195"}}}}),
            "steps[0].gameEvents.warframe.info.mission.state",
        ),
        (
            json!({"info": {"mission": {"state": "paused", "node": {"id": "SolNode195"}}}}),
            "steps[0].gameEvents.warframe.info.mission.state",
        ),
        (
            json!({"info": {"inventory": {}}}),
            "steps[0].gameEvents.warframe.info.inventory",
        ),
        (
            json!({"event": "relic_opened"}),
            "steps[0].gameEvents.warframe.event",
        ),
        (
            json!({"event": "mission_started"}),
            "steps[0].gameEvents.warframe.event",
        ),
        (
            json!({"event": {"type": "night_started", "mission": {}}}),
            "steps[0].gameEvents.warframe.event",
        ),
        (
            json!({"features": {"mission": "maybe"}}),
            "steps[0].gameEvents.warframe.features.mission",
        ),
    ] {
        let error = read(&scenario_of(step.clone())).expect_err(&step.to_string());
        assert_eq!(error.path, path, "{step}");
    }
    let unknown_game = scenario(json!({}), json!([{"gameEvents": {"tetris": {}}}]));
    assert!(read(&unknown_game).is_err());
}

#[test]
fn the_events_window_keeps_the_latest_sixteen() {
    let steps: Vec<Value> = (0..20)
        .map(|_| json!({"gameEvents": {"warframe": {"event": "night_started"}}}))
        .collect();
    let scenario = read(&scenario(json!({}), Value::Array(steps))).expect("valid");
    let updates = scenario
        .game_event_updates(&declared(&["warframe.eidolons"]))
        .expect("played");
    let last = &updates.last().unwrap().value;
    let seqs: Vec<u64> = last["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, (5..=20).collect::<Vec<_>>());
}

#[test]
fn a_fixture_gives_the_first_value_and_a_step_changes_the_rest() {
    let first = json!({
        "playing": false,
        "session": null,
        "features": {
            "location": "undeclared", "mission": "available", "progress": "undeclared",
            "squad": "available", "eidolons": "undeclared", "world": "undeclared", "rewards": "undeclared"
        },
        "info": {"location": null, "mission": null, "progress": null,
                 "squad": {"members": [{"name": "Nova", "you": true}]}, "eidolons": null, "world": null},
        "events": [{"seq": 4, "at": 1, "type": "member_joined", "member": {"name": "Nova", "you": true}}]
    });
    let value = scenario(
        json!({"subscriptions": {"gameEvents.warframe.subscribe": first}}),
        json!([
            {"gameEvents": {"warframe": {
                "playing": true,
                "session": {"startedAt": 1_767_225_000_000_u64},
                "features": {"squad": "unavailable"},
                "event": {"type": "member_left", "member": {"name": "Nova", "you": true}}
            }}}
        ]),
    );
    let scenario = read(&value).expect("valid");
    let updates = scenario
        .game_event_updates(&declared(&["warframe.mission", "warframe.squad"]))
        .expect("played");
    let value = &updates[0].value;
    assert_eq!(value["playing"], json!(true));
    assert_eq!(value["session"]["startedAt"], json!(1_767_225_000_000_u64));
    assert_eq!(value["features"]["squad"], json!("unavailable"));
    assert_eq!(value["events"][1]["seq"], json!(5));
    assert_eq!(value["events"][1]["type"], json!("member_left"));
}

#[test]
fn a_game_the_manifest_lists_starts_with_a_first_value() {
    // Without a fixture, the fake host's first value: playing, nothing
    // known, the listed features available and the others undeclared.
    let steps = json!([{"expect": {"state": "running"}}]);
    let bare = read(&scenario(json!({}), steps.clone())).expect("valid");
    let events = GameEvents::new(&bare.fixtures, &declared(&["warframe.mission"]));
    let starts = events.start_values();
    assert_eq!(starts.len(), 1);
    let (service, value) = &starts[0];
    assert_eq!(*service, "gameEvents.warframe.subscribe");
    assert_eq!(value["playing"], json!(true));
    assert_eq!(value["session"], Value::Null);
    assert_eq!(value["features"]["mission"], json!("available"));
    assert_eq!(value["features"]["squad"], json!("undeclared"));
    assert_eq!(value["info"]["mission"], Value::Null);
    assert_eq!(value["events"], json!([]));
    assert_eq!(value["glossary"]["language"], json!("en"));
    assert_eq!(value["glossary"]["damage"]["corrosive"], json!("Corrosive"));
    let shape = overcrow_widget_schema::results::shape("WarframeEvents").expect("shape");
    assert!(shape.shape.matches(value), "{value}");
    // No feature of the game listed: no value.
    assert!(
        GameEvents::new(&bare.fixtures, &declared(&[]))
            .start_values()
            .is_empty()
    );
    // A fixture gives the first value itself.
    let first = value.clone();
    let fixed = read(&scenario(
        json!({"subscriptions": {"gameEvents.warframe.subscribe": first}}),
        steps,
    ))
    .expect("valid");
    assert!(
        GameEvents::new(&fixed.fixtures, &declared(&["warframe.mission"]))
            .start_values()
            .is_empty()
    );
}

#[test]
fn the_glossary_and_the_language_play_like_the_rest() {
    let steps = json!([
        {"gameEvents": {"warframe": {
            "session": {"startedAt": 1_767_225_000_000_u64, "language": "fr"},
            "glossary": {"language": "fr", "damage": {"corrosive": "Corrosif"},
                         "term": {"reactant": "Réactif"}}
        }}},
        {"gameEvents": {"warframe": {"session": {"startedAt": 1_767_225_000_000_u64}}}}
    ]);
    let played = read(&scenario(json!({}), steps)).expect("valid");
    let updates = played
        .game_event_updates(&declared(&["warframe.mission"]))
        .expect("played");
    let first = &updates[0].value;
    assert_eq!(first["session"]["language"], json!("fr"));
    assert_eq!(first["glossary"]["language"], json!("fr"));
    assert_eq!(first["glossary"]["damage"]["corrosive"], json!("Corrosif"));
    // The other words keep their English.
    assert_eq!(first["glossary"]["damage"]["impact"], json!("Impact"));
    assert_eq!(first["glossary"]["term"]["reactant"], json!("Réactif"));
    // A session without a language: not read yet.
    assert_eq!(updates[1].value["session"]["language"], Value::Null);

    // A word the glossary does not have, a language it is never in.
    for (glossary, path) in [
        (
            json!({"damage": {"void": "Void"}}),
            "gameEvents.warframe.glossary.damage.void",
        ),
        (
            json!({"weapons": {}}),
            "gameEvents.warframe.glossary.weapons",
        ),
        (
            json!({"language": "de"}),
            "gameEvents.warframe.glossary.language",
        ),
    ] {
        let steps = json!([{"gameEvents": {"warframe": {"glossary": glossary}}}]);
        let error = read(&scenario(json!({}), steps))
            .and_then(|scenario| {
                scenario
                    .game_event_updates(&declared(&["warframe.mission"]))
                    .map(|_| scenario)
            })
            .err()
            .expect("refused");
        assert!(
            error.path.ends_with(path),
            "{} {}",
            error.path,
            error.message
        );
    }

    // A fixture written without the glossary has the English one.
    let mut fixture = GameEvents::new(
        &read(&scenario(
            json!({}),
            json!([{"expect": {"state": "running"}}]),
        ))
        .expect("valid")
        .fixtures,
        &declared(&["warframe.mission"]),
    )
    .start_values()
    .remove(0)
    .1;
    fixture.as_object_mut().unwrap().remove("glossary");
    let fixed = read(&scenario(
        json!({"subscriptions": {"gameEvents.warframe.subscribe": fixture}}),
        json!([{"gameEvents": {"warframe": {"playing": false}}}]),
    ))
    .expect("valid");
    let updates = fixed
        .game_event_updates(&declared(&["warframe.mission"]))
        .expect("played");
    assert_eq!(updates[0].value["glossary"]["language"], json!("en"));
}

#[test]
fn rewards_are_the_nodes_unless_a_step_says_whose() {
    let items = json!([{"id": "forma", "name": "Forma", "quantity": 1, "chance": 0.025}]);
    let steps = json!([
        {"gameEvents": {"warframe": {"info": {"mission": {
            "state": "selected", "node": {"id": "SolNode195"},
            "rewards": {"tables": [{"kind": "mission", "rotation": null, "items": items}]}
        }}}}},
        {"gameEvents": {"warframe": {"info": {"mission": {
            "rewards": {"source": "sortie"}
        }}}}},
        {"gameEvents": {"warframe": {"info": {"mission": {
            "rewards": null, "rewardsPending": true
        }}}}}
    ]);
    let played = read(&scenario(json!({}), steps)).expect("valid");
    let updates = played
        .game_event_updates(&declared(&["warframe.mission", "warframe.rewards"]))
        .expect("played");
    let mission = |index: usize| updates[index].value["info"]["mission"].clone();
    assert_eq!(mission(0)["rewards"]["source"], json!("node"));
    assert_eq!(mission(0)["rewardsPending"], json!(false));
    assert_eq!(mission(1)["rewards"]["source"], json!("sortie"));
    assert_eq!(
        mission(1)["rewards"]["tables"][0]["items"][0]["id"],
        json!("forma")
    );
    assert_eq!(mission(2)["rewards"], Value::Null);
    assert_eq!(mission(2)["rewardsPending"], json!(true));
}
