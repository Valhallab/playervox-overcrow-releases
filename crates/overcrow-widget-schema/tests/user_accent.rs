//! The user's accent colour: a manifest that declares `"accent": "user"`
//! gets the accent the user chose in PlayerVox OverCrow, by name in the IPC
//! and as the `--color-user-accent` and `--color-on-user-accent` tokens. A
//! reader that does not know the field refuses the manifest, so the
//! declaration needs the catalog feature `user-accent`. The brand accent
//! tokens never change.

use overcrow_widget_schema::catalog_v2::{FEATURE_USER_ACCENT, KNOWN_FEATURES};
use overcrow_widget_schema::ipc::HOST_MESSAGES;
use overcrow_widget_schema::manifest::validate_manifest;
use overcrow_widget_schema::tokens::{
    DEFAULT_USER_ACCENT, TOKENS, USER_ACCENT_NAMES, USER_ACCENTS, token, user_accent,
};
use serde_json::{Value, json};

fn manifest(accent: Option<Value>) -> Value {
    let mut manifest = json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.badge",
        "version": "1.0.0",
        "name": {"en": "Badge", "fr": "Badge"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 200, "height": 100},
            "min": {"width": 100, "height": 50},
            "max": {"width": 400, "height": 200}
        }
    });
    if let Some(accent) = accent {
        manifest["accent"] = accent;
    }
    manifest
}

/// WCAG 2 relative luminance of an opaque `#rrggbb` colour.
fn relative_luminance(hex: &str) -> f64 {
    let hex = hex.strip_prefix('#').expect("hex colour");
    assert_eq!(hex.len(), 6, "opaque colour");
    let channel = |index: usize| {
        let value = f64::from(u8::from_str_radix(&hex[index..index + 2], 16).expect("hex")) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

fn contrast(a: &str, b: &str) -> f64 {
    let (a, b) = (relative_luminance(a), relative_luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

#[test]
fn the_declaration_needs_its_catalog_feature() {
    assert_eq!(FEATURE_USER_ACCENT, "user-accent");
    assert!(KNOWN_FEATURES.contains(&FEATURE_USER_ACCENT));
    let declared =
        validate_manifest(manifest(Some(json!("user"))).to_string().as_bytes()).expect("declared");
    assert!(declared.user_accent);
    assert_eq!(
        declared.features().into_iter().collect::<Vec<_>>(),
        ["user-accent"]
    );
    // No permission: the declaration widens nothing an update would ask.
    assert_eq!(declared.permissions, Default::default());

    let absent = validate_manifest(manifest(None).to_string().as_bytes()).expect("absent");
    assert!(!absent.user_accent);
    assert!(absent.features().is_empty());

    for refused in [
        json!("brand"),
        json!("User"),
        json!(true),
        json!(null),
        json!(["user"]),
    ] {
        let error = validate_manifest(manifest(Some(refused.clone())).to_string().as_bytes())
            .expect_err(&refused.to_string());
        assert_eq!(error.as_str(), "accent", "{refused}");
    }
}

/// Exactly the nine accent colours of PlayerVox, lime first and by default:
/// the light shade in the dark theme, the strong shade in the light theme
/// unless it loses AA under `#18181b`, and red as `#991b1b` under white.
#[test]
fn the_palette_is_the_playervox_one() {
    let palette = [
        ("lime", "#a3e635", "#84cc16"),
        ("amber", "#fbbf24", "#f59e0b"),
        ("red", "#b91c1c", "#991b1b"),
        ("pink", "#fb7185", "#f43f5e"),
        ("purple", "#a78bfa", "#8b5cf6"),
        ("blue", "#60a5fa", "#3b82f6"),
        ("cyan", "#22d3ee", "#06b6d4"),
        ("emerald", "#34d399", "#10b981"),
        ("steel", "#a1a1aa", "#71717a"),
    ];
    assert_eq!(USER_ACCENTS.len(), palette.len());
    assert_eq!(DEFAULT_USER_ACCENT.name, "lime");
    for ((name, shade, strong), accent) in palette.into_iter().zip(USER_ACCENTS) {
        assert_eq!(accent.name, name);
        assert_eq!(user_accent(name), Some(&accent));
        if name == "red" {
            for colours in [accent.dark, accent.light] {
                assert_eq!((colours.fill, colours.on_fill), (strong, "#ffffff"));
            }
            continue;
        }
        assert_eq!((accent.dark.fill, accent.dark.on_fill), (shade, "#18181b"));
        let light = if contrast(strong, "#18181b") >= 4.5 {
            strong
        } else {
            shade
        };
        assert_eq!(
            (accent.light.fill, accent.light.on_fill),
            (light, "#18181b"),
            "{name}"
        );
    }
    assert_eq!(
        USER_ACCENTS
            .iter()
            .map(|accent| accent.name)
            .collect::<Vec<_>>(),
        USER_ACCENT_NAMES
    );
    assert_eq!(user_accent("Lime"), None);
    assert_eq!(user_accent("green"), None);
}

#[test]
fn text_keeps_aa_contrast_on_every_accent_in_both_themes() {
    for accent in USER_ACCENTS {
        for (theme, colours) in [("dark", accent.dark), ("light", accent.light)] {
            let ratio = contrast(colours.on_fill, colours.fill);
            assert!(
                ratio >= 4.5,
                "{} ({theme}): {} on {} is {ratio:.2}:1",
                accent.name,
                colours.on_fill,
                colours.fill
            );
        }
    }
}

#[test]
fn the_tokens_default_to_lime_and_the_brand_accent_does_not_move() {
    let fill = token("--color-user-accent").expect("fill token");
    let on_fill = token("--color-on-user-accent").expect("text token");
    for (token, dark, light) in [
        (
            fill,
            DEFAULT_USER_ACCENT.dark.fill,
            DEFAULT_USER_ACCENT.light.fill,
        ),
        (
            on_fill,
            DEFAULT_USER_ACCENT.dark.on_fill,
            DEFAULT_USER_ACCENT.light.on_fill,
        ),
    ] {
        assert!(
            token.user_accent && token.status.is_fixed(),
            "{}",
            token.name
        );
        assert_eq!((token.dark, token.light), (dark, light), "{}", token.name);
    }
    let user: Vec<&str> = TOKENS
        .iter()
        .filter(|token| token.user_accent)
        .map(|token| token.name)
        .collect();
    assert_eq!(user, ["--color-user-accent", "--color-on-user-accent"]);
    // Published widgets draw these: their values are frozen.
    for (name, dark, light) in [
        ("--color-accent", "#a3e635", "#4d7c0f"),
        ("--color-accent-hover", "#b5f153", "#3f6212"),
        ("--color-accent-soft", "#a3e6351c", "#4d7c0f1f"),
        ("--color-on-accent", "#09090b", "#ffffff"),
    ] {
        let token = token(name).expect(name);
        assert_eq!(
            (token.dark, token.light, token.user_accent),
            (dark, light, false)
        );
    }
}

#[test]
fn the_host_sends_the_name_only_to_a_declaring_widget() {
    let message = |name: &str| {
        HOST_MESSAGES
            .iter()
            .find(|message| message.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    };
    let init = message("Init")
        .fields
        .iter()
        .find(|field| field.name == "userAccent")
        .expect("Init.userAccent");
    assert!(!init.required, "absent without the declaration");
    assert_eq!(init.keywords(), USER_ACCENT_NAMES);
    let change = message("UserAccent");
    assert_eq!(change.frame, 1);
    assert_eq!(change.fields.len(), 1);
    assert!(change.fields[0].required);
    assert_eq!(change.fields[0].name, "userAccent");
    assert_eq!(change.fields[0].keywords(), USER_ACCENT_NAMES);
}
