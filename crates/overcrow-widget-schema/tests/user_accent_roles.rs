//! The roles of the user's accent: a manifest that declares
//! `"accent": "user-roles"` gets a colour for each use of the accent (a
//! fill, the text on it, its hover state, a wash, text and an outline on a
//! surface), readable in the nine accent colours and both themes. A reader
//! that does not know the value refuses the manifest, so the declaration
//! needs the catalog feature `user-accent-roles` beside `user-accent`. In
//! lime the roles are exactly the brand accent family; under
//! `"accent": "user"` the published pair does not move.

use std::collections::BTreeSet;

use overcrow_widget_schema::catalog_v2::{
    FEATURE_USER_ACCENT, FEATURE_USER_ACCENT_ROLES, KNOWN_FEATURES,
};
use overcrow_widget_schema::manifest::validate_manifest;
use overcrow_widget_schema::tokens::{
    AccentDeclaration, AccentRole, AccentRoles, DEFAULT_USER_ACCENT, TOKENS, USER_ACCENTS, token,
    user_accent,
};
use serde_json::{Value, json};

mod contrast;
use contrast::contrast;

/// WCAG AA for normal text.
const TEXT: f64 = 4.5;
/// WCAG 1.4.11 for an indicator that is not text.
const INDICATOR: f64 = 3.0;

/// The surfaces a widget may put an accent colour on.
const SURFACES: [&str; 5] = [
    "--color-surface-panel",
    "--color-surface-raised",
    "--color-surface-hover",
    "--color-surface-field",
    "--color-surface-popover",
];

/// The role tokens, in the order of [`AccentRole::ALL`].
const ROLE_TOKENS: [&str; 7] = [
    "--color-user-accent",
    "--color-on-user-accent",
    "--color-user-accent-hover",
    "--color-user-accent-soft",
    "--color-user-accent-text",
    "--color-user-accent-text-hover",
    "--color-user-accent-outline",
];

fn manifest(accent: &str) -> Value {
    json!({
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
        },
        "accent": accent
    })
}

fn channels(hex: &str) -> Vec<f64> {
    let hex = hex.strip_prefix('#').expect("hex colour");
    (0..hex.len() / 2)
        .map(|index| {
            f64::from(u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).expect("hex"))
        })
        .collect()
}

fn hex(channels: &[f64]) -> String {
    channels.iter().fold(String::from("#"), |mut out, channel| {
        out.push_str(&format!("{:02x}", channel.round().clamp(0.0, 255.0) as u8));
        out
    })
}

/// `from` moved by `amount` (0 to 1) towards `to`, both opaque.
fn mix(from: &str, to: &str, amount: f64) -> String {
    let (from, to) = (channels(from), channels(to));
    hex(&[0, 1, 2].map(|index| from[index] + (to[index] - from[index]) * amount))
}

/// `color` without its alpha: the opaque colour of a surface token. A
/// translucent surface lets what is behind it through; its own colour is
/// the least favourable background of the theme's text.
fn opaque(color: &str) -> &str {
    &color[..7]
}

/// `top` (`#rrggbbaa`) drawn over the opaque `under`.
fn over(top: &str, under: &str) -> String {
    let (top, under) = (channels(top), channels(under));
    let alpha = top[3] / 255.0;
    hex(&[0, 1, 2].map(|index| top[index] * alpha + under[index] * (1.0 - alpha)))
}

fn value(name: &str, dark: bool) -> &'static str {
    let token = token(name).unwrap_or_else(|| panic!("{name}"));
    if dark { token.dark } else { token.light }
}

fn themes() -> [(&'static str, bool); 2] {
    [("dark", true), ("light", false)]
}

fn roles(accent: &overcrow_widget_schema::tokens::UserAccent, dark: bool) -> AccentRoles {
    if dark {
        accent.dark_roles
    } else {
        accent.light_roles
    }
}

#[test]
fn the_declaration_needs_both_catalog_features() {
    assert_eq!(FEATURE_USER_ACCENT_ROLES, "user-accent-roles");
    assert!(KNOWN_FEATURES.contains(&FEATURE_USER_ACCENT_ROLES));
    let declared =
        validate_manifest(manifest("user-roles").to_string().as_bytes()).expect("declared");
    assert_eq!(declared.accent, AccentDeclaration::UserRoles);
    assert_eq!(
        declared.features().into_iter().collect::<Vec<_>>(),
        [FEATURE_USER_ACCENT, FEATURE_USER_ACCENT_ROLES]
    );
    // No permission: the declaration widens nothing an update would ask.
    assert_eq!(declared.permissions, Default::default());

    // The reduced form keeps its one feature: a reader of the first accent
    // release still takes it.
    let reduced = validate_manifest(manifest("user").to_string().as_bytes()).expect("reduced");
    assert_eq!(reduced.accent, AccentDeclaration::User);
    assert_eq!(
        reduced.features().into_iter().collect::<Vec<_>>(),
        [FEATURE_USER_ACCENT]
    );

    for refused in [
        "roles",
        "user-role",
        "User-Roles",
        "user-roles ",
        "follow",
        "",
    ] {
        let error = validate_manifest(manifest(refused).to_string().as_bytes()).expect_err(refused);
        assert_eq!(error.as_str(), "accent", "{refused}");
    }
}

#[test]
fn each_declaration_gives_its_tokens() {
    use AccentDeclaration::{None, User, UserRoles};
    assert_eq!(None.as_str(), Option::None);
    assert_eq!(User.as_str(), Some("user"));
    assert_eq!(UserRoles.as_str(), Some("user-roles"));
    assert!(!None.follows_user() && User.follows_user() && UserRoles.follows_user());
    for role in AccentRole::ALL {
        assert!(!None.allows(role), "{role:?}");
        assert!(UserRoles.allows(role), "{role:?}");
        assert_eq!(
            User.allows(role),
            matches!(role, AccentRole::Fill | AccentRole::OnFill),
            "{role:?}"
        );
    }
}

/// Seven tokens, one per role, fixed, whose default is lime.
#[test]
fn every_role_has_its_token() {
    let user: Vec<(&str, AccentRole)> = TOKENS
        .iter()
        .filter_map(|token| token.user_accent.map(|role| (token.name, role)))
        .collect();
    assert_eq!(
        user,
        ROLE_TOKENS
            .into_iter()
            .zip(AccentRole::ALL)
            .collect::<Vec<_>>()
    );
    for (name, role) in ROLE_TOKENS.into_iter().zip(AccentRole::ALL) {
        let token = token(name).expect(name);
        assert!(token.status.is_fixed(), "{name}");
        // The default of a token is lime as `"accent": "user-roles"`
        // gives it, the brand accent family.
        assert_eq!(
            (token.dark, token.light),
            (
                DEFAULT_USER_ACCENT.value(role, true, AccentDeclaration::UserRoles),
                DEFAULT_USER_ACCENT.value(role, false, AccentDeclaration::UserRoles)
            ),
            "{name}"
        );
    }
}

/// Lime is the brand: a widget that follows a user who kept lime draws
/// exactly what it drew with the brand accent tokens, in both themes.
#[test]
fn lime_is_exactly_the_brand_accent_family() {
    let lime = user_accent("lime").expect("lime");
    assert_eq!(DEFAULT_USER_ACCENT, *lime);
    for (theme, dark) in themes() {
        let roles = roles(lime, dark);
        for (role, brand) in [
            (roles.fill, "--color-accent"),
            (roles.on_fill, "--color-on-accent"),
            (roles.hover, "--color-accent-hover"),
            (roles.soft, "--color-accent-soft"),
            (roles.text, "--color-accent"),
            (roles.text_hover, "--color-accent-hover"),
            (roles.outline, "--color-accent"),
        ] {
            assert_eq!(role, value(brand, dark), "{theme}: {brand}");
        }
    }
    // The dark theme, the one users have: these exact values.
    assert_eq!(
        lime.dark_roles,
        AccentRoles {
            fill: "#a3e635",
            on_fill: "#09090b",
            hover: "#b5f153",
            soft: "#a3e6351c",
            text: "#a3e635",
            text_hover: "#b5f153",
            outline: "#a3e635",
        }
    );
}

/// Every other colour keeps its published fill and text, and derives the
/// other roles from them by the rules of `USER_ACCENTS`.
#[test]
fn the_other_colours_follow_the_rules() {
    for accent in USER_ACCENTS.iter().filter(|accent| accent.name != "lime") {
        for (theme, dark) in themes() {
            let label = format!("{} ({theme})", accent.name);
            let published = if dark { accent.dark } else { accent.light };
            let roles = roles(accent, dark);
            assert_eq!(
                (roles.fill, roles.on_fill),
                (published.fill, published.on_fill),
                "{label}"
            );
            let (white, black) = ("#ffffff", "#000000");
            let dark_text_on_fill = contrast(roles.on_fill, black) < contrast(roles.on_fill, white);
            let hover = match (dark, dark_text_on_fill) {
                (true, _) => mix(roles.fill, white, 0.2),
                (false, true) => mix(roles.fill, white, 0.15),
                (false, false) => mix(roles.fill, black, 0.15),
            };
            assert_eq!(roles.hover, hover, "{label}: hover");
            let soft_alpha = &value("--color-accent-soft", dark)[7..];
            assert_eq!(
                roles.soft,
                format!("{}{soft_alpha}", roles.fill),
                "{label}: soft"
            );
            let reaches = |ratio: f64| {
                SURFACES
                    .iter()
                    .all(|surface| contrast(roles.fill, opaque(value(surface, dark))) >= ratio)
            };
            let fallback = value("--color-text", dark);
            let text = if reaches(TEXT) { roles.fill } else { fallback };
            assert_eq!(roles.text, text, "{label}: text");
            let outline = if reaches(INDICATOR) {
                roles.fill
            } else {
                fallback
            };
            assert_eq!(roles.outline, outline, "{label}: outline");
            let text_hover = if dark {
                mix(roles.text, white, 0.2)
            } else {
                mix(roles.text, black, 0.15)
            };
            assert_eq!(roles.text_hover, text_hover, "{label}: text hover");
        }
    }
}

/// Red is a fill under white text, never a text colour nor an outline on
/// the dark panel: both roles take the text colour.
#[test]
fn red_is_never_a_text_colour_on_the_dark_panel() {
    let red = user_accent("red").expect("red").dark_roles;
    assert_eq!((red.fill, red.on_fill), ("#991b1b", "#ffffff"));
    assert!(contrast(red.fill, opaque(value("--color-surface-panel", true))) < INDICATOR);
    assert_eq!(red.text, value("--color-text", true));
    assert_eq!(red.outline, value("--color-text", true));
    for role in [red.text, red.text_hover, red.outline] {
        assert_ne!(role, red.fill);
        assert_ne!(role, red.hover);
    }
}

/// Every role keeps its WCAG contrast in the nine colours and both themes,
/// on each surface a widget may put it on, on the accent's wash over that
/// surface, and, for an indicator, on the track of a control over it.
///
/// One exception, named: lime in the light theme is the brand's
/// `--color-accent` (`#4d7c0f`), a provisional value that no user gets today
/// (PlayerVox OverCrow has no light theme yet); it stays the brand so that
/// lime changes nothing, and misses the ratio in the cells listed below.
#[test]
fn every_role_keeps_its_contrast_on_every_surface() {
    let mut missed = BTreeSet::new();
    for accent in USER_ACCENTS {
        for (theme, dark) in themes() {
            let roles = roles(&accent, dark);
            let mut check = |role: &str, color: &str, on: &str, under: &str, least: f64| {
                let ratio = contrast(color, under);
                if ratio < least {
                    missed.insert(format!(
                        "{} {theme}: {role} on {on} is {ratio:.2}:1",
                        accent.name
                    ));
                }
            };
            check("on-fill", roles.on_fill, "fill", roles.fill, TEXT);
            check("on-fill", roles.on_fill, "hover", roles.hover, TEXT);
            for surface in SURFACES {
                let name = surface.trim_start_matches("--color-surface-");
                let plain = opaque(value(surface, dark));
                let wash = over(roles.soft, plain);
                let track = over(value("--color-border-strong", dark), plain);
                for (role, color) in [("text", roles.text), ("text-hover", roles.text_hover)] {
                    check(role, color, name, plain, TEXT);
                    check(role, color, &format!("wash over {name}"), &wash, TEXT);
                }
                check("outline", roles.outline, name, plain, INDICATOR);
                check(
                    "outline",
                    roles.outline,
                    &format!("wash over {name}"),
                    &wash,
                    INDICATOR,
                );
                check(
                    "outline",
                    roles.outline,
                    &format!("track over {name}"),
                    &track,
                    INDICATOR,
                );
            }
        }
    }
    let brand_lime_in_light: BTreeSet<String> = [
        "lime light: outline on track over hover is 2.61:1",
        "lime light: outline on track over raised is 2.99:1",
        "lime light: text on hover is 3.94:1",
        "lime light: text on wash over field is 4.26:1",
        "lime light: text on wash over hover is 3.41:1",
        "lime light: text on wash over panel is 4.10:1",
        "lime light: text on wash over popover is 4.26:1",
        "lime light: text on wash over raised is 3.89:1",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(missed, brand_lime_in_light);
}

/// `"accent": "user"` keeps the published pair, lime included; only
/// `"accent": "user-roles"` reads the roles.
#[test]
fn the_reduced_form_keeps_its_published_values() {
    for accent in USER_ACCENTS {
        for (theme, dark) in themes() {
            let label = format!("{} ({theme})", accent.name);
            let published = if dark { accent.dark } else { accent.light };
            let roles = roles(&accent, dark);
            for declaration in [AccentDeclaration::User, AccentDeclaration::None] {
                assert_eq!(
                    accent.value(AccentRole::Fill, dark, declaration),
                    published.fill,
                    "{label}"
                );
                assert_eq!(
                    accent.value(AccentRole::OnFill, dark, declaration),
                    published.on_fill,
                    "{label}"
                );
            }
            for role in AccentRole::ALL {
                assert_eq!(
                    accent.value(role, dark, AccentDeclaration::UserRoles),
                    roles.get(role),
                    "{label}: {role:?}"
                );
            }
        }
    }
    let lime = user_accent("lime").expect("lime");
    assert_eq!(
        lime.value(AccentRole::OnFill, true, AccentDeclaration::User),
        "#18181b"
    );
    assert_eq!(
        lime.value(AccentRole::OnFill, true, AccentDeclaration::UserRoles),
        "#09090b"
    );
    assert_eq!(
        lime.value(AccentRole::Fill, false, AccentDeclaration::User),
        "#84cc16"
    );
    assert_eq!(
        lime.value(AccentRole::Fill, false, AccentDeclaration::UserRoles),
        "#4d7c0f"
    );
}
