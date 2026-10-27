//! The active game: `game.subscribe` gives a widget that declares
//! `game.read` the name and Steam app ID of the game being played. The game
//! is not sensitive, so a widget with the network or an account may declare
//! it, and the PlayerVox score no longer counts as sensitive either. A
//! reader that does not know this refuses such a manifest: it needs the
//! catalog feature `active-game`.

use overcrow_widget_schema::catalog_v2::{FEATURE_ACTIVE_GAME, KNOWN_FEATURES};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::permissions::capability_named;
use overcrow_widget_schema::results::{Shape, shape};
use overcrow_widget_schema::services::{Requirement, SERVICES, ServiceKind};
use serde_json::{Value, json};

fn widget(permissions: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.guides",
        "version": "1.0.0",
        "name": {"en": "Guides", "fr": "Guides"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 200, "height": 96},
            "max": {"width": 480, "height": 480}
        },
        "permissions": permissions
    })
}

fn network() -> Value {
    json!([{"origin": "https://guides.example.com", "method": "GET", "path": "/games"}])
}

fn steam() -> Value {
    json!({
        "accounts": [{"service": "steam"}],
        "capabilities": ["game.read"],
        "network": [{
            "origin": "https://api.steampowered.com",
            "method": "GET",
            "path": "/ISteamUserStats/GetPlayerAchievements/v1/",
            "queryParams": {
                "steamid": {"type": "slug", "maxLength": 17, "required": true},
                "appid": {"type": "slug", "maxLength": 10, "required": true}
            },
            "account": "steam"
        }]
    })
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

fn features(value: &Value) -> Vec<&'static str> {
    validate(value)
        .expect("valid")
        .features()
        .into_iter()
        .collect()
}

#[test]
fn the_game_and_the_score_are_not_sensitive() {
    let game = capability_named("game.read").expect("listed");
    assert!(!game.sensitive);
    assert_eq!(game.account, None);
    assert!(!capability_named("playervox.score.read").unwrap().sensitive);
    // Personal data stays sensitive.
    for name in [
        "notes.read",
        "media.read",
        "journal.read",
        "playervox.rating.read",
        "playervox.reviews.read",
        "twitch.chat.read",
    ] {
        assert!(capability_named(name).unwrap().sensitive, "{name}");
    }
}

#[test]
fn the_game_goes_with_the_network_and_an_account() {
    let value =
        widget(json!({"capabilities": ["game.read"], "network": network(), "storage": true}));
    let manifest = validate(&value).expect("network");
    assert!(!manifest.permissions.has_sensitive_capability());
    let value = widget(json!({
        "capabilities": ["game.read"],
        "links": [{"origin": "https://guides.example.com"}],
        "clipboardWrite": true
    }));
    assert!(validate(&value).is_ok());
    assert!(validate(&widget(steam())).is_ok());
    // A sensitive capability still refuses them.
    let value = widget(json!({"capabilities": ["game.read", "notes.read"], "network": network()}));
    assert_eq!(validate(&value).err(), Some("sensitive_egress"));
}

#[test]
fn the_game_needs_its_feature() {
    assert_eq!(FEATURE_ACTIVE_GAME, "active-game");
    assert!(KNOWN_FEATURES.contains(&FEATURE_ACTIVE_GAME));
    assert_eq!(
        features(&widget(json!({"capabilities": ["game.read"]}))),
        ["active-game"]
    );
    assert_eq!(features(&widget(steam())), ["active-game", "service-steam"]);
    assert!(features(&widget(json!({"capabilities": ["session.read"]}))).is_empty());
}

/// A released reader still holds the score sensitive and refuses it beside
/// any way out: such a manifest needs the feature, the score alone does not.
#[test]
fn the_score_with_a_way_out_needs_the_feature() {
    let score = || json!({"capabilities": ["playervox.score.read"]});
    assert!(features(&widget(score())).is_empty());
    let mut with_network = score();
    with_network["network"] = network();
    let mut with_links = score();
    with_links["links"] = json!([{"origin": "https://guides.example.com"}]);
    let mut with_clipboard = score();
    with_clipboard["clipboardWrite"] = json!(true);
    let mut with_account = steam();
    with_account["capabilities"] = json!(["playervox.score.read"]);
    for (case, permissions) in [("network", with_network), ("clipboard", with_clipboard)] {
        assert_eq!(features(&widget(permissions)), ["active-game"], "{case}");
    }
    assert_eq!(features(&widget(with_links)), ["active-game", "open-links"]);
    assert_eq!(
        features(&widget(with_account)),
        ["active-game", "service-steam"]
    );
    // Storage alone was already allowed: process-lifetime on a released
    // reader, durable on this one.
    let mut with_storage = score();
    with_storage["storage"] = json!(true);
    assert!(features(&widget(with_storage)).is_empty());
}

#[test]
fn the_service_of_the_game() {
    let service = SERVICES
        .iter()
        .find(|service| service.name == "game.subscribe")
        .expect("listed");
    assert_eq!(service.kind, ServiceKind::Subscribe);
    assert_eq!(service.requires, Requirement::Capability("game.read"));
    assert!(service.params.is_empty());
    assert_eq!(service.returns, Shape::Nullable(&Shape::Named("Game")));
    let game = shape("Game").expect("named").shape;
    assert!(game.matches(&json!({"steamAppId": 1_806_840, "name": "100 Hidden Frogs"})));
    assert!(game.matches(&json!({"steamAppId": null, "name": "Manual game"})));
    assert!(game.matches(&json!({"steamAppId": null, "name": null})));
    assert!(!game.matches(&json!({"steamAppId": 1_806_840})));
    assert!(!game.matches(&json!({"steamAppId": "1806840", "name": null})));
    assert!(!game.matches(&json!({"steamAppId": 1, "name": null, "pid": 4})));
}
