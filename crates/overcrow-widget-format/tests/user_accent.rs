//! The user accent tokens in `style.ocss`: the grammar accepts them, and
//! package admission accepts them only from a widget whose manifest
//! declares the `accent` that gives them (`"user-roles"` for every token,
//! `"user"` for the fill and the text on it), so that an older host never
//! receives a style it cannot resolve.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use overcrow_widget_format::ocss::{self, OcssErrorKind};
use overcrow_widget_format::{Position, validate_package_style};
use overcrow_widget_schema::package::{read_package, write_package};
use overcrow_widget_schema::tokens::{AccentDeclaration, TOKENS};
use serde_json::{Value, json};

/// The sources of the fixture package `name`.
fn sources(name: &str) -> BTreeMap<String, Vec<u8>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../overcrow-widget-schema/fixtures/package-src")
        .join(name);
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

/// `files` with `accent` in its manifest, or without the field.
fn declaring(
    mut files: BTreeMap<String, Vec<u8>>,
    accent: Option<&str>,
) -> BTreeMap<String, Vec<u8>> {
    let mut manifest: Value = serde_json::from_slice(&files["manifest.json"]).expect("manifest");
    let object = manifest.as_object_mut().expect("object");
    match accent {
        Some(accent) => object.insert("accent".into(), json!(accent)),
        None => object.remove("accent"),
    };
    files.insert("manifest.json".into(), manifest.to_string().into_bytes());
    files
}

fn check_as(source: &str, declaration: AccentDeclaration) -> Result<(), (OcssErrorKind, Position)> {
    let sheet = ocss::parse(source.as_bytes()).expect("grammar");
    ocss::check_user_accent(&sheet, declaration).map_err(|error| (error.kind, error.position))
}

#[test]
fn a_declaring_widget_may_use_the_tokens() {
    assert_eq!(package_style(&sources("accent")), Ok(()));
}

#[test]
fn another_widget_is_refused_at_admission() {
    assert_eq!(
        package_style(&declaring(sources("accent"), None)),
        Err(OcssErrorKind::UndeclaredUserAccent)
    );
    assert_eq!(
        OcssErrorKind::UndeclaredUserAccent.as_str(),
        "undeclared_user_accent"
    );
    // Without the tokens, the declaration changes nothing.
    let mut files = declaring(sources("accent"), None);
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
        assert_eq!(
            check_as(source, AccentDeclaration::None),
            position,
            "{source}"
        );
        assert_eq!(
            check_as(source, AccentDeclaration::User),
            Ok(()),
            "{source}"
        );
    }
    // Named only in a comment: nothing to declare.
    assert_eq!(
        check_as(
            "/* --color-user-accent */ .a { color: var(--color-text); }",
            AccentDeclaration::None
        ),
        Ok(())
    );
}

/// The role tokens need `"accent": "user-roles"`: the reduced form gives
/// only the fill and the text on it, and no declaration gives none.
#[test]
fn the_role_tokens_need_the_roles_declaration_at_admission() {
    let roles = sources("accent-roles");
    assert_eq!(package_style(&roles), Ok(()));
    for accent in [Some("user"), None] {
        assert_eq!(
            package_style(&declaring(roles.clone(), accent)),
            Err(OcssErrorKind::UndeclaredUserAccent),
            "{accent:?}"
        );
    }
    // The reduced form's own tokens stay open to both declarations.
    assert_eq!(
        package_style(&declaring(sources("accent"), Some("user-roles"))),
        Ok(())
    );
}

#[test]
fn every_role_token_is_checked_against_the_declaration() {
    let mut seen = 0;
    for token in TOKENS {
        if token.user_accent.is_none() {
            continue;
        }
        seen += 1;
        let source = format!(".a {{ color: var({}); }}", token.name);
        let refused = Err((
            OcssErrorKind::UndeclaredUserAccent,
            Position {
                line: 1,
                column: 17,
            },
        ));
        assert_eq!(
            check_as(&source, AccentDeclaration::None),
            refused,
            "{source}"
        );
        assert_eq!(
            check_as(&source, AccentDeclaration::UserRoles),
            Ok(()),
            "{source}"
        );
        let reduced = ["--color-user-accent", "--color-on-user-accent"].contains(&token.name);
        assert_eq!(
            check_as(&source, AccentDeclaration::User),
            if reduced { Ok(()) } else { refused },
            "{source}"
        );
    }
    assert_eq!(seen, 7);
}

/// Under `"accent": "user"` the refusal points at the first role token,
/// past the tokens the reduced form gives, in any colour slot.
#[test]
fn the_reduced_form_is_refused_at_its_first_role_token() {
    let at = |line, column| {
        Err((
            OcssErrorKind::UndeclaredUserAccent,
            Position { line, column },
        ))
    };
    for (source, none, reduced) in [
        (
            ".a { background: var(--color-user-accent); color: var(--color-user-accent-text); }",
            at(1, 22),
            at(1, 55),
        ),
        (
            ".a { color: var(--color-on-user-accent); }\n.b { border: 1px solid var(--color-user-accent-outline); }",
            at(1, 17),
            at(2, 28),
        ),
        (
            ".a { background: linear-gradient(var(--color-user-accent), var(--color-user-accent-soft)); }",
            at(1, 38),
            at(1, 64),
        ),
        (
            ".a { box-shadow: 0 1px 2px 0 var(--color-user-accent-hover); }",
            at(1, 34),
            at(1, 34),
        ),
        (
            "@keyframes glow { from { color: var(--color-user-accent-text); } to { color: var(--color-user-accent-text-hover); } }\n.a { animation: glow 1s; }",
            at(1, 37),
            at(1, 37),
        ),
        // A comment that names a role token is not a mention.
        (
            "/* var(--color-user-accent-text) */\n.a { color: var(--color-on-user-accent); }",
            at(2, 17),
            Ok(()),
        ),
    ] {
        assert_eq!(check_as(source, AccentDeclaration::None), none, "{source}");
        assert_eq!(
            check_as(source, AccentDeclaration::User),
            reduced,
            "{source}"
        );
        assert_eq!(
            check_as(source, AccentDeclaration::UserRoles),
            Ok(()),
            "{source}"
        );
    }
}
