//! The generated TypeScript sources of `@overcrow/sdk` are current: they
//! match the schema byte for byte (ADR 0004, contract job).

use std::fs;
use std::path::PathBuf;

use overcrow_widget_schema::limits;
use overcrow_widget_schema::typescript::{AUTHOR_LIMITS, OUTPUT_DIR, files};

fn repository() -> PathBuf {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo");
    PathBuf::from(manifest).join("../..")
}

#[test]
fn generated_sdk_sources_are_current() {
    let directory = repository().join(OUTPUT_DIR);
    let generated = files();
    for (name, content) in &generated {
        let committed = fs::read_to_string(directory.join(name))
            .unwrap_or_else(|error| panic!("{OUTPUT_DIR}/{name}: {error}"));
        assert!(
            committed == *content,
            "{OUTPUT_DIR}/{name} is stale: run `cargo run -p overcrow-widget-schema --example sdk-types`"
        );
    }
    let mut on_disk: Vec<String> = fs::read_dir(&directory)
        .expect("generated directory")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    on_disk.sort();
    let mut expected: Vec<String> = generated
        .iter()
        .map(|(name, _)| (*name).to_owned())
        .collect();
    expected.sort();
    assert_eq!(on_disk, expected, "no stray file in {OUTPUT_DIR}");
}

#[test]
fn generation_is_deterministic() {
    assert_eq!(files(), files());
}

#[test]
fn author_limits_exist_once() {
    for (index, key) in AUTHOR_LIMITS.iter().enumerate() {
        assert!(
            limits::ALL.iter().any(|limit| limit.key == *key),
            "unknown limit {key}"
        );
        assert!(!AUTHOR_LIMITS[index + 1..].contains(key), "duplicate {key}");
    }
}

#[test]
fn every_service_and_shape_is_typed() {
    let generated = files();
    let schema = &generated
        .iter()
        .find(|(name, _)| *name == "schema.ts")
        .expect("schema.ts")
        .1;
    let maps = &schema[schema
        .find("export interface ServiceParamsMap")
        .expect("maps")..];
    for service in overcrow_widget_schema::services::SERVICES {
        let key = format!("readonly \"{}\":", service.name);
        assert_eq!(
            maps.matches(&key).count(),
            2,
            "{}: params and result",
            service.name
        );
    }
    for shape in overcrow_widget_schema::results::SHAPES {
        assert!(
            schema.contains(&format!("export interface {} ", shape.name))
                || schema.contains(&format!("export type {} = ", shape.name))
                || shape.name == "ServiceError",
            "{}",
            shape.name
        );
    }
    assert!(!schema.contains("unknown;"), "every field has a type");
}
