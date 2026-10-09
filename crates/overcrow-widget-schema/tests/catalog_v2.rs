//! Shared vectors of the creator portal contract: identifier rules
//! (`fixtures/identifiers/`) and the signed catalog v2
//! (`fixtures/catalog-v2/`).

// The v1 generator provides the conformance key and the fixtures root.
mod catalog_v2_gen;
#[allow(dead_code)]
mod fixture_gen;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use overcrow_widget_schema::catalog::{
    self, CONFORMANCE_KEY_ID, CatalogError, Document, Origin, TargetStatus, verify_target_package,
};
use overcrow_widget_schema::catalog_v2::{
    self, CatalogV2, CatalogV2Error, display_text, email, link, spdx_license,
};
use overcrow_widget_schema::identifiers::{
    Owner, domains_overlap, handle_syntax, id_owner, validate_domain, validate_handle,
    validate_publisher_name,
};
use overcrow_widget_schema::limits::{
    MAX_CATEGORY_LABEL_CHARS, MAX_GAME_NAME_CHARS, MAX_LISTING_DESCRIPTION_CHARS,
    MAX_PUBLISHER_NAME_CHARS,
};
use ring::signature::{ED25519, KeyPair as _, UnparsedPublicKey};
use serde_json::Value;

use fixture_gen::{NOW, conformance_key};

fn fixtures() -> PathBuf {
    PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("run by Cargo")).join("fixtures")
}

fn vector_file(relative: &str) -> Value {
    let path = fixtures().join(relative);
    let bytes = fs::read(&path).unwrap_or_else(|_| panic!("{} is readable", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|_| panic!("{} is JSON", path.display()))
}

fn cases<'a>(file: &'a Value, list: &str) -> &'a [Value] {
    let cases = file[list].as_array().expect("a list of cases");
    assert!(!cases.is_empty(), "no {list}");
    cases
}

fn text<'a>(case: &'a Value, field: &str) -> &'a str {
    case[field]
        .as_str()
        .unwrap_or_else(|| panic!("{case} has a text `{field}`"))
}

fn outcome<E: Copy>(result: Result<(), E>, name: impl Fn(E) -> &'static str) -> &'static str {
    result.map_or_else(name, |()| "ok")
}

#[test]
fn identifier_vectors() {
    let handles = vector_file("identifiers/handles.json");
    for case in cases(&handles, "cases") {
        let handle = text(case, "handle");
        assert_eq!(
            outcome(validate_handle(handle), |error| error.as_str()),
            text(case, "registration"),
            "registration of {handle:?}"
        );
        assert_eq!(
            outcome(handle_syntax(handle), |error| error.as_str()),
            text(case, "catalog"),
            "grammar of {handle:?}"
        );
    }

    let domains = vector_file("identifiers/domains.json");
    for case in cases(&domains, "cases") {
        let domain = text(case, "domain");
        assert_eq!(
            outcome(validate_domain(domain, text(case, "handle")), |error| error
                .as_str()),
            text(case, "expected"),
            "{case}"
        );
    }
    for case in cases(&domains, "overlaps") {
        assert_eq!(
            Value::Bool(domains_overlap(text(case, "a"), text(case, "b"))),
            case["overlap"],
            "{case}"
        );
    }

    let names = vector_file("identifiers/names.json");
    for case in cases(&names, "cases") {
        let name = text(case, "name");
        assert_eq!(
            outcome(
                validate_publisher_name(name, text(case, "handle")),
                |error| { error.as_str() }
            ),
            text(case, "expected"),
            "{case}"
        );
    }

    let ids = vector_file("identifiers/widget-ids.json");
    for case in cases(&ids, "cases") {
        let owned: Vec<String> = case["domains"]
            .as_array()
            .expect("domains")
            .iter()
            .map(|domain| domain.as_str().expect("domain text").to_owned())
            .collect();
        let (expected, domain) = match id_owner(text(case, "id"), text(case, "handle"), &owned) {
            Ok(Owner::Handle) => ("handle", None),
            Ok(Owner::Domain(domain)) => ("domain", Some(domain)),
            Err(error) => (error.as_str(), None),
        };
        assert_eq!(expected, text(case, "expected"), "{case}");
        assert_eq!(domain, case["domain"].as_str(), "{case}");
    }
}

#[test]
fn listing_field_vectors() {
    let fields = vector_file("catalog-v2/fields.json");
    for case in cases(&fields, "cases") {
        let value = text(case, "value");
        let valid = match text(case, "field") {
            "publisherName" => display_text(value, MAX_PUBLISHER_NAME_CHARS.value, false),
            "description" => display_text(value, MAX_LISTING_DESCRIPTION_CHARS.value, true),
            "categoryLabel" => display_text(value, MAX_CATEGORY_LABEL_CHARS.value, false),
            "gameName" => display_text(value, MAX_GAME_NAME_CHARS.value, false),
            "link" => link(value),
            "email" => email(value),
            "spdxLicense" => spdx_license(value),
            other => panic!("unknown field {other}"),
        };
        assert_eq!(Value::Bool(valid), case["valid"], "{case}");
    }
}

fn read(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap_or_else(|_| panic!("{} is readable", path.display()))
}

/// `(case name, bytes)` of every file of `fixtures/<directory>`, sorted.
fn files(directory: &str) -> Vec<(String, Vec<u8>)> {
    let directory = fixtures().join(directory);
    let mut files: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|_| panic!("{} exists", directory.display()))
        .map(|entry| {
            let path = entry.expect("vector entry").path();
            let name = path
                .file_stem()
                .expect("vector has a name")
                .to_string_lossy()
                .into_owned();
            (name, read(&path))
        })
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no vectors in {}", directory.display());
    files
}

/// What a host does: open the envelope, trust only the conformance key,
/// verify the signature, then validate the payload at the vectors' clock.
fn catalog_v2(bytes: &[u8]) -> Result<CatalogV2, String> {
    let envelope = catalog_v2::open_envelope(bytes).map_err(|error| error.as_str().to_owned())?;
    if envelope.key_id != CONFORMANCE_KEY_ID {
        return Err("key_unknown".to_owned());
    }
    UnparsedPublicKey::new(&ED25519, conformance_key().public_key().as_ref())
        .verify(&envelope.signed_message(), &envelope.signature)
        .map_err(|_| "signature".to_owned())?;
    catalog_v2::validate_catalog(&envelope.payload, NOW, Origin::Production)
        .map_err(|error| error.as_str().to_owned())
}

fn valid(name: &str) -> CatalogV2 {
    let bytes = read(&fixtures().join(format!("catalog-v2/valid/{name}.json")));
    catalog_v2(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"))
}

#[test]
fn generated_v2_vectors_are_current_and_deterministic() {
    let generated = catalog_v2_gen::generate();
    let mut committed = BTreeMap::new();
    for directory in catalog_v2_gen::GENERATED_DIRS {
        for entry in fs::read_dir(fixtures().join(directory)).expect("generated directory") {
            let path = entry.expect("entry").path();
            let relative = path.strip_prefix(fixtures()).expect("inside fixtures");
            committed.insert(relative.to_string_lossy().replace('\\', "/"), read(&path));
        }
    }
    let names = |map: &BTreeMap<String, Vec<u8>>| map.keys().cloned().collect::<Vec<_>>();
    assert_eq!(
        names(&committed),
        names(&generated),
        "run `cargo run -p overcrow-widget-schema --example fixtures`"
    );
    for (path, bytes) in &generated {
        assert!(committed[path] == *bytes, "{path} is stale");
    }
    assert_eq!(
        catalog_v2_gen::generate(),
        generated,
        "generation is deterministic"
    );
}

#[test]
fn catalog_v2_vectors() {
    for (name, bytes) in files("catalog-v2/valid") {
        catalog_v2(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    for (name, bytes) in files("catalog-v2/invalid") {
        let expected = name
            .split_once("--")
            .map(|(error, _)| error)
            .unwrap_or_else(|| panic!("{name} names its error"));
        let error = catalog_v2(&bytes).expect_err(&name);
        assert_eq!(error, expected, "{name}");
    }
}

#[test]
fn catalog_v2_vectors_mean_what_they_say() {
    let full = valid("full");
    assert_eq!(full.publishers.len(), 3);
    assert_eq!(full.widgets.len(), 3);
    assert_eq!(full.targets.len(), 4);
    assert!(full.widgets[0].built_in && full.targets[0].target.built_in);
    assert_eq!(full.targets[1].target.status, TargetStatus::Revoked);
    assert_eq!(full.targets[2].release_notes.len(), 2);

    // Every listed version is a real package.
    let archives = catalog_v2_gen::archives();
    for listed in &full.targets {
        let target = &listed.target;
        let key = format!("{}/{}", target.manifest.id, target.manifest.version);
        verify_target_package(&archives[&key], target)
            .unwrap_or_else(|error| panic!("{key}: {}", error.as_str()));
    }

    assert_eq!(valid("unknown-members"), full);
    assert_eq!(valid("requires-target"), full);
    let malformed = valid("requires-malformed");
    assert_eq!(malformed.widgets, full.widgets[..2]);
    assert_eq!(malformed.targets, full.targets[..3]);
    let skipped = valid("requires-widget");
    assert_eq!(skipped.widgets, full.widgets);
    assert_eq!(skipped.targets, full.targets);
    assert_eq!(valid("new-category").widgets[1].listing.category, "racing");
    assert_eq!(
        valid("spdx-expression").widgets[2].listing.spdx_license,
        "GPL-3.0-or-later WITH Classpath-exception-2.0"
    );
    assert_eq!(
        valid("suspended-built-in").targets[0].target.status,
        TargetStatus::SecuritySuspended
    );
    let empty = valid("empty");
    assert!(empty.widgets.is_empty() && empty.targets.is_empty());
    assert_eq!(empty.categories.len(), 7);
}

/// An application of the 0.6 line reads only v1, a v2 application only v2:
/// neither envelope opens as the other.
#[test]
fn v1_and_v2_envelopes_never_cross() {
    for (name, bytes) in files("catalog-v2/valid") {
        assert_eq!(
            catalog::open_envelope(&bytes, Document::Catalog),
            Err(CatalogError::FormatVersion),
            "{name}"
        );
    }
    for (name, bytes) in files("catalog/valid") {
        assert_eq!(
            catalog_v2::open_envelope(&bytes),
            Err(CatalogV2Error::FormatVersion),
            "{name}"
        );
    }
}
