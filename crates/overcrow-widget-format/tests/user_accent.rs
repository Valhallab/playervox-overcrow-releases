//! The user accent tokens in `style.ocss`: the grammar accepts them, and
//! package admission accepts them only from a widget whose manifest
//! declares `"accent": "user"`, so that an older host never receives a
//! style it cannot resolve.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use overcrow_widget_format::ocss::{self, OcssErrorKind};
use overcrow_widget_format::{Position, validate_package_style};
use overcrow_widget_schema::package::{read_package, write_package};
use serde_json::Value;

fn accent_sources() -> BTreeMap<String, Vec<u8>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../overcrow-widget-schema/fixtures/package-src/accent");
    [
        "LICENSE",
        "logic.js",
        "manifest.json",
        "style.ocss",
        "view.json",
    ]
    .into_iter()
    .map(|name| {
        let bytes = fs::read(root.join(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        (name.to_owned(), bytes)
    })
    .collect()
}

fn package_style(files: &BTreeMap<String, Vec<u8>>) -> Result<(), OcssErrorKind> {
    let package = read_package(&write_package(files).expect("package")).expect("valid package");
    validate_package_style(&package).map_err(|error| error.kind)
}

fn without_declaration(mut files: BTreeMap<String, Vec<u8>>) -> BTreeMap<String, Vec<u8>> {
    let mut manifest: Value = serde_json::from_slice(&files["manifest.json"]).expect("manifest");
    manifest.as_object_mut().expect("object").remove("accent");
    files.insert("manifest.json".into(), manifest.to_string().into_bytes());
    files
}

fn check(source: &str, declared: bool) -> Result<(), (OcssErrorKind, Position)> {
    let sheet = ocss::parse(source.as_bytes()).expect("grammar");
    ocss::check_user_accent(&sheet, declared).map_err(|error| (error.kind, error.position))
}

#[test]
fn a_declaring_widget_may_use_the_tokens() {
    assert_eq!(package_style(&accent_sources()), Ok(()));
}

#[test]
fn another_widget_is_refused_at_admission() {
    assert_eq!(
        package_style(&without_declaration(accent_sources())),
        Err(OcssErrorKind::UndeclaredUserAccent)
    );
    assert_eq!(
        OcssErrorKind::UndeclaredUserAccent.as_str(),
        "undeclared_user_accent"
    );
    // Without the tokens, the declaration changes nothing.
    let mut files = without_declaration(accent_sources());
    files.insert(
        "style.ocss".into(),
        b".mine { background-color: var(--color-accent); }".to_vec(),
    );
    assert_eq!(package_style(&files), Ok(()));
}

#[test]
fn every_colour_value_is_checked_at_its_first_mention() {
    let at = |line, column| {
        Err((
            OcssErrorKind::UndeclaredUserAccent,
            Position { line, column },
        ))
    };
    for (source, position) in [
        (".a { color: var(--color-on-user-accent); }", at(1, 17)),
        (
            ".a { background-color: var(--color-user-accent); }",
            at(1, 28),
        ),
        (
            ".a { background: linear-gradient(var(--color-accent), var(--color-user-accent)); }",
            at(1, 59),
        ),
        (
            ".a { border: 1px solid var(--color-user-accent); }",
            at(1, 28),
        ),
        (
            ".a { box-shadow: 0 1px 2px 0 var(--color-user-accent); }",
            at(1, 34),
        ),
        (
            "@keyframes glow { from { color: var(--color-text); } to { color: var(--color-user-accent); } }\n.a { animation: glow 1s; }",
            at(1, 70),
        ),
        // A comment that names the token is not a mention.
        (
            "/* var(--color-user-accent) */\n.a {\n  color: var(--color-on-user-accent);\n}",
            at(3, 14),
        ),
    ] {
        assert_eq!(check(source, false), position, "{source}");
        assert_eq!(check(source, true), Ok(()), "{source}");
    }
    // Named only in a comment: nothing to declare.
    assert_eq!(
        check(
            "/* --color-user-accent */ .a { color: var(--color-text); }",
            false
        ),
        Ok(())
    );
}
