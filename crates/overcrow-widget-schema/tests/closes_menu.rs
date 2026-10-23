//! `closesMenu` on a `wrapper.menu` row: a reader that does not know the
//! field refuses the manifest, so a manifest that has it, whatever its
//! value and wherever the row is, needs the catalog feature `menu-closes`.
//! A catalog reader without the feature skips that version and keeps the
//! previous one.

use overcrow_widget_schema::catalog_v2::{FEATURE_MENU_CLOSES, KNOWN_FEATURES};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use serde_json::{Value, json};

fn manifest(menu: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.tracker",
        "version": "1.0.0",
        "name": {"en": "Tracker", "fr": "Suivi"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 200, "height": 100},
            "min": {"width": 100, "height": 50},
            "max": {"width": 400, "height": 200}
        },
        "wrapper": {"menu": menu}
    })
}

fn label(text: &str) -> Value {
    json!({"en": text, "fr": text})
}

fn features(menu: Value) -> Vec<&'static str> {
    let manifest: Manifest =
        validate_manifest(manifest(menu).to_string().as_bytes()).expect("valid manifest");
    manifest.features().into_iter().collect()
}

#[test]
fn a_row_that_names_closes_menu_needs_its_feature() {
    assert_eq!(FEATURE_MENU_CLOSES, "menu-closes");
    assert!(KNOWN_FEATURES.contains(&FEATURE_MENU_CLOSES));
    let action = |closes: Value| json!({"type": "action", "id": "track", "label": label("Track"), "closesMenu": closes});
    assert_eq!(features(json!([action(json!(true))])), ["menu-closes"]);
    // `false` is the default, but an earlier reader refuses the field.
    assert_eq!(features(json!([action(json!(false))])), ["menu-closes"]);
    // In a group's flyout too.
    assert_eq!(
        features(
            json!([{"type": "group", "id": "more", "label": label("More"),
                         "rows": [action(json!(true))]}])
        ),
        ["menu-closes"]
    );
    // A menu without it needs nothing.
    assert!(
        features(json!([{"type": "action", "id": "track", "label": label("Track")}])).is_empty()
    );
    assert!(features(json!([])).is_empty());
}
