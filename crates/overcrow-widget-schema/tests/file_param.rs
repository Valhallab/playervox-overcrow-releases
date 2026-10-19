//! The `file` parameter constraint: a path or query value
//! `<name>.<extension>`, for files such as the icons of an image CDN
//! (`<hash>.jpg`). Every refused declaration is a case; the values a rule
//! lets through are the broker's, tested in `overcrow-widget-net`.

use overcrow_widget_schema::catalog_v2::{FEATURE_NETWORK_FILE_PARAM, KNOWN_FEATURES};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use serde_json::{Value, json};

fn manifest(constraint: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.achievement-icons",
        "version": "1.0.0",
        "name": {"en": "Icons", "fr": "Icônes"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 200, "height": 100},
            "min": {"width": 100, "height": 50},
            "max": {"width": 400, "height": 200}
        },
        "permissions": {
            "network": [{
                "origin": "https://cdn.example.test",
                "method": "GET",
                "path": "/images/apps/{app}/{file}",
                "pathParams": {
                    "app": {"type": "integer", "min": 1, "max": 99_999_999},
                    "file": constraint
                }
            }]
        }
    })
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

fn jpg() -> Value {
    json!({"type": "file", "maxLength": 64, "extensions": ["jpg"]})
}

#[test]
fn a_file_parameter_needs_its_feature() {
    let accepted = validate(&manifest(jpg())).expect("valid");
    assert_eq!(FEATURE_NETWORK_FILE_PARAM, "network-file-param");
    assert!(KNOWN_FEATURES.contains(&FEATURE_NETWORK_FILE_PARAM));
    assert_eq!(
        accepted.features().into_iter().collect::<Vec<_>>(),
        ["network-file-param"]
    );
    // In a query too.
    let mut value = manifest(json!({"type": "integer", "min": 1, "max": 2}));
    value["permissions"]["network"][0]["queryParams"] = json!({"name": jpg()});
    let accepted = validate(&value).expect("query");
    assert_eq!(
        accepted.features().into_iter().collect::<Vec<_>>(),
        ["network-file-param"]
    );
    // Without one, no feature.
    let plain = validate(&manifest(json!({"type": "slug", "maxLength": 64}))).expect("slug");
    assert!(plain.features().is_empty());
    // Several extensions.
    validate(&manifest(
        json!({"type": "file", "maxLength": 128, "extensions": ["jpg", "png", "webp"]}),
    ))
    .expect("three");
}

#[test]
fn a_file_parameter_is_bounded_and_its_extensions_closed() {
    for constraint in [
        json!({"type": "file"}),
        json!({"type": "file", "maxLength": 64}),
        json!({"type": "file", "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": 0, "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": 2, "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": 129, "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": 1.5, "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": "64", "extensions": ["jpg"]}),
        json!({"type": "file", "maxLength": 64, "extensions": []}),
        json!({"type": "file", "maxLength": 64, "extensions": "jpg"}),
        json!({"type": "file", "maxLength": 64, "extensions": ["jpg", "jpg"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["JPG"]}),
        json!({"type": "file", "maxLength": 64, "extensions": [".jpg"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["tar.gz"]}),
        json!({"type": "file", "maxLength": 64, "extensions": [""]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["j-g"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["é"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["abcdefghi"]}),
        json!({"type": "file", "maxLength": 64, "extensions": [1]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["a", "b", "c", "d", "e", "f", "g", "h", "i"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["jpg"], "values": ["a.jpg"]}),
        json!({"type": "file", "maxLength": 64, "extensions": ["jpg"], "required": true}),
        json!({"type": "file", "maxLength": 64, "extensions": null}),
    ] {
        assert_eq!(
            validate(&manifest(constraint.clone())).err(),
            Some("network_rule"),
            "{constraint}"
        );
    }
}
