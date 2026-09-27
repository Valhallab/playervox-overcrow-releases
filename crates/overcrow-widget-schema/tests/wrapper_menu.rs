//! Conformance fixtures of the `wrapper.menu` manifest section. An invalid
//! fixture is named `<expected error>--<case>.json`.

use std::{fs, path::PathBuf};

use overcrow_widget_schema::wrapper::validate_wrapper;
use serde_json::Value;

fn fixtures(kind: &str) -> Vec<(String, Value)> {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/wrapper-menu")
        .join(kind);
    let mut fixtures: Vec<_> = fs::read_dir(&directory)
        .expect("fixture directory exists")
        .map(|entry| {
            let path = entry.expect("fixture entry is readable").path();
            let name = path
                .file_stem()
                .expect("fixture has a name")
                .to_string_lossy()
                .into_owned();
            let text = fs::read_to_string(&path).expect("fixture is UTF-8");
            (name, serde_json::from_str(&text).expect("fixture is JSON"))
        })
        .collect();
    fixtures.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(!fixtures.is_empty(), "no {kind} fixtures");
    fixtures
}

#[test]
fn valid_fixtures_are_accepted() {
    for (name, wrapper) in fixtures("valid") {
        assert_eq!(validate_wrapper(&wrapper), Ok(()), "{name}");
    }
}

#[test]
fn invalid_fixtures_fail_with_the_named_error() {
    for (name, wrapper) in fixtures("invalid") {
        let (expected, _) = name
            .split_once("--")
            .expect("invalid fixture names its error");
        let error = validate_wrapper(&wrapper).expect_err(&name);
        assert_eq!(error.as_str(), expected, "{name}");
    }
}
