//! `userAccent`: a scenario sets the user's accent colour, at the start and
//! in `host` steps, only for a manifest that declares `"accent": "user"`.

use overcrow_widget_scenario::{HostChange, Step, UserAccent, parse};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest_value};
use overcrow_widget_schema::tokens::USER_ACCENT_NAMES;
use serde_json::{Value, json};

fn manifest(accent: bool) -> Manifest {
    let mut manifest = json!({
        "schemaVersion": 1, "apiVersion": 1, "id": "nova.daily-goal",
        "version": "1.0.0", "name": {"en": "Daily goal", "fr": "Objectif du jour"},
        "sizing": {"fit": "none", "preferred": {"width": 200, "height": 200},
                   "min": {"width": 100, "height": 100}, "max": {"width": 400, "height": 400}},
    });
    if accent {
        manifest["accent"] = json!("user");
    }
    validate_manifest_value(manifest).expect("manifest")
}

fn scenario(host: Value, steps: Value) -> Result<overcrow_widget_scenario::Scenario, String> {
    parse(
        &serde_json::to_vec(&json!({
            "scenarioVersion": 1, "name": "accent", "host": host, "steps": steps,
        }))
        .expect("bytes"),
    )
    .map_err(|error| error.path)
}

#[test]
fn the_names_are_the_schema_ones_and_lime_is_the_default() {
    for name in USER_ACCENT_NAMES {
        let parsed: UserAccent = serde_json::from_value(json!(name)).expect(name);
        assert_eq!(parsed.as_str(), *name);
        assert_eq!(serde_json::to_value(parsed).expect("name"), json!(name));
    }
    assert_eq!(UserAccent::default().as_str(), "lime");
    for refused in ["green", "Lime", ""] {
        assert!(
            serde_json::from_value::<UserAccent>(json!(refused)).is_err(),
            "{refused}"
        );
    }
    assert!(scenario(json!({"userAccent": "green"}), json!([])).is_err());
}

#[test]
fn a_scenario_sets_the_accent_of_a_declaring_widget() {
    let played = scenario(
        json!({"userAccent": "red"}),
        json!([{"host": {"userAccent": "blue", "theme": "light"}}, {"expect": {"state": "running"}}]),
    )
    .expect("valid");
    assert_eq!(played.host.user_accent, Some(UserAccent::Red));
    assert!(matches!(
        &played.steps[0],
        Step::Host(HostChange {
            user_accent: Some(UserAccent::Blue),
            ..
        })
    ));
    played.check_against(&manifest(true)).expect("declared");

    let at_start = played
        .check_against(&manifest(false))
        .expect_err("undeclared");
    assert_eq!(at_start.path, "host.userAccent");
    let in_a_step = scenario(
        json!({}),
        json!([{"expect": {"state": "running"}}, {"host": {"userAccent": "cyan"}}]),
    )
    .expect("valid")
    .check_against(&manifest(false))
    .expect_err("undeclared");
    assert_eq!(in_a_step.path, "steps[1].host.userAccent");

    // A scenario that does not name it suits both manifests, and writes
    // nothing of it back.
    let plain = scenario(
        json!({"theme": "light"}),
        json!([{"host": {"theme": "dark"}}]),
    )
    .expect("valid");
    plain.check_against(&manifest(false)).expect("plain");
    plain
        .check_against(&manifest(true))
        .expect("plain, declared");
    assert!(
        !serde_json::to_string(&plain.host)
            .expect("host")
            .contains("userAccent")
    );
}
