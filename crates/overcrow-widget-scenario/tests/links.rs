//! `links`: a scenario grants it like any other permission, and answers
//! the host's first confirmation of a site with `fixtures.confirmations`.

use overcrow_widget_scenario::{declared_items, parse};
use overcrow_widget_schema::manifest::validate_manifest_value;
use serde_json::{Value, json};

fn manifest(permissions: Value) -> overcrow_widget_schema::manifest::Manifest {
    validate_manifest_value(json!({
        "schemaVersion": 1, "apiVersion": 1, "id": "nova.run-log",
        "version": "1.0.0", "name": {"en": "Run log", "fr": "Journal de course"},
        "sizing": {"fit": "none", "preferred": {"width": 200, "height": 200},
                   "min": {"width": 100, "height": 100}, "max": {"width": 400, "height": 400}},
        "permissions": permissions,
    }))
    .expect("manifest")
}

#[test]
fn links_is_a_grant_of_a_manifest_that_declares_it() {
    let with =
        manifest(json!({"links": [{"origin": "https://runlog.example", "pathPrefix": "/runs/"}]}));
    let without = manifest(json!({"storage": true}));
    assert!(declared_items(&with).contains("links"));
    assert!(!declared_items(&without).contains("links"));
    let scenario = parse(
        &serde_json::to_vec(&json!({
            "scenarioVersion": 1, "name": "open",
            "host": {"mode": "interactive", "grants": ["links"]},
            "fixtures": {"confirmations": ["accept"]},
            "steps": [{"expect": {"state": "running"}}],
        }))
        .expect("bytes"),
    )
    .expect("valid");
    scenario.check_against(&with).expect("declared");
    let error = scenario.check_against(&without).expect_err("undeclared");
    assert_eq!(error.path, "host.grants");
}
