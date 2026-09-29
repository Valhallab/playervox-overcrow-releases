//! The shared test vectors of `vectors/v1.json`: every scenario is read as
//! the CLI and the headless runtime read it.

use std::path::PathBuf;

use overcrow_widget_scenario::{Grants, Scenario, parse, pixels};
use overcrow_widget_schema::manifest::validate_manifest_value;
use serde_json::Value;

fn vectors() -> Value {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let text = std::fs::read(root.join("vectors/v1.json")).expect("vectors");
    serde_json::from_slice(&text).expect("vectors JSON")
}

fn read(case: &Value) -> Result<Scenario, overcrow_widget_scenario::ScenarioError> {
    parse(&serde_json::to_vec(&case["scenario"]).expect("scenario bytes"))
}

#[test]
fn valid_scenarios_parse_with_their_derived_values() {
    let vectors = vectors();
    let manifest = validate_manifest_value(vectors["manifest"].clone()).expect("manifest");
    for case in vectors["valid"].as_array().expect("valid") {
        let name = case["name"].as_str().expect("name");
        let scenario = read(case).unwrap_or_else(|error| panic!("{name}: {error}"));
        let derived = &case["derived"];
        if let Some(scale) = derived["scale"].as_u64() {
            assert_eq!(u64::from(scenario.host.scale), scale, "{name}");
        }
        if let Some(size) = derived["size"].as_array() {
            let actual = scenario.size(&manifest).expect("size");
            assert_eq!(
                [u64::from(actual.width), u64::from(actual.height)],
                [size[0].as_u64().unwrap(), size[1].as_u64().unwrap()],
                "{name}"
            );
            if let Some(expected) = derived["pixels"].as_array() {
                assert_eq!(
                    [
                        u64::from(pixels(actual.width, scenario.host.scale)),
                        u64::from(pixels(actual.height, scenario.host.scale))
                    ],
                    [expected[0].as_u64().unwrap(), expected[1].as_u64().unwrap()],
                    "{name}"
                );
            }
        }
        if let Some(start) = derived["startAt"].as_u64() {
            assert_eq!(scenario.host.start_at, start, "{name}");
        }
        if derived["grantsDeclared"] == Value::Bool(true) {
            assert!(
                matches!(scenario.host.grants, Grants::Declared(_)),
                "{name}"
            );
        }
        if let Some(order) = derived["dateOrder"].as_str() {
            let actual = scenario.host.region.date_order(scenario.host.locale);
            assert_eq!(
                serde_json::to_value(actual).expect("order"),
                Value::from(order),
                "{name}"
            );
        }
        for entry in derived["zone"].as_array().into_iter().flatten() {
            let now = entry[0].as_u64().expect("now");
            let (offset, next) = scenario.host.zone.at(now);
            assert_eq!(
                i64::from(offset),
                entry[1].as_i64().unwrap(),
                "{name} {now}"
            );
            assert_eq!(next, entry[2].as_u64(), "{name} {now}");
        }
        // What a scenario says survives a round trip.
        let again = parse(&serde_json::to_vec(&scenario).expect("serialize")).expect("again");
        assert_eq!(again, scenario, "{name}");
    }
}

#[test]
fn invalid_scenarios_are_refused_at_their_path() {
    let vectors = vectors();
    for case in vectors["invalid"].as_array().expect("invalid") {
        let name = case["name"].as_str().expect("name");
        let error = read(case).expect_err(name);
        assert_eq!(
            error.path,
            case["path"].as_str().expect("path"),
            "{name}: {error}"
        );
    }
}

#[test]
fn scenarios_are_checked_against_the_manifest() {
    let vectors = vectors();
    let manifest = validate_manifest_value(vectors["manifest"].clone()).expect("manifest");
    for case in vectors["againstManifest"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("name");
        let scenario = read(case).unwrap_or_else(|error| panic!("{name}: {error}"));
        match (scenario.check_against(&manifest), case["path"].as_str()) {
            (Ok(()), None) => {}
            (Err(error), Some(path)) => assert_eq!(error.path, path, "{name}: {error}"),
            (outcome, expected) => panic!("{name}: {outcome:?}, expected {expected:?}"),
        }
    }
}

#[test]
fn oversized_files_are_refused_before_parsing() {
    let bytes = vec![b' '; overcrow_widget_scenario::MAX_SCENARIO_BYTES + 1];
    assert!(parse(&bytes).is_err());
}
