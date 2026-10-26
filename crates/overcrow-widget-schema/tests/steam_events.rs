//! Local Steam events: a widget that names the Steam service lists in
//! `events` the types it wants. Steam pushes nothing; the Steam client of
//! the user's computer saves each account's stats of a game in its own
//! file, and the host tells the widget when that file of the account the
//! widget names changes (`steam.events.subscribe`): the game and the time,
//! never the file's content. A reader that does not know these events
//! refuses the manifest: it needs the catalog feature `steam-events`.

use overcrow_widget_schema::catalog_v2::{
    FEATURE_STEAM_EVENTS, FEATURE_TWITCH_EVENTS, KNOWN_FEATURES,
};
use overcrow_widget_schema::integrated::{
    EventCondition, EventValue, STEAM, STEAM_EVENT_TYPES, TWITCH, project_event,
};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::results::shape;
use overcrow_widget_schema::services::{Requirement, SERVICES, ServiceKind};
use serde_json::{Value, json};

fn steam(account: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.achievements",
        "version": "1.0.0",
        "name": {"en": "Achievements", "fr": "Succès"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 200, "height": 96},
            "max": {"width": 480, "height": 480}
        },
        "permissions": {
            "accounts": [account],
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
        }
    })
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

#[test]
fn the_table_is_one_local_type() {
    assert_eq!(STEAM_EVENT_TYPES, ["stats.saved"]);
    let table: Vec<_> = STEAM
        .events
        .iter()
        .map(|event| (event.kind, event.version, event.scope, event.condition))
        .collect();
    assert_eq!(
        table,
        [("stats.saved", "1", None, EventCondition::LocalClient)]
    );
    let saved = STEAM.event("stats.saved").expect("listed");
    assert_eq!(saved.fields.len(), 1);
    assert_eq!(saved.fields[0].name, "appid");
    assert_eq!(saved.fields[0].value, EventValue::Integer);
    assert_eq!(STEAM.events_feature, Some(FEATURE_STEAM_EVENTS));
    // Twitch's types all keep their scope and their channel.
    for event in TWITCH.events {
        assert!(event.scope.is_some(), "{}", event.kind);
        assert_ne!(event.condition, EventCondition::LocalClient);
    }
}

#[test]
fn events_need_their_feature() {
    assert_eq!(FEATURE_STEAM_EVENTS, "steam-events");
    assert!(KNOWN_FEATURES.contains(&FEATURE_STEAM_EVENTS));
    let manifest =
        validate(&steam(json!({"service": "steam", "events": ["stats.saved"]}))).expect("events");
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-steam", "steam-events"]
    );
    let account = manifest.account().expect("declared");
    assert_eq!(
        account
            .events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        ["stats.saved"]
    );
    let manifest = validate(&steam(json!({"service": "steam"}))).expect("no events");
    assert!(manifest.account().unwrap().events.is_empty());
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-steam"]
    );
}

#[test]
fn a_key_service_takes_its_events_without_scopes() {
    for (case, events) in [
        ("empty list", json!([])),
        ("unknown type", json!(["stats.stored"])),
        ("a Twitch type", json!(["channel.goal.end"])),
        ("twice", json!(["stats.saved", "stats.saved"])),
        ("not text", json!([1])),
        ("not a list", json!("stats.saved")),
        ("case", json!(["Stats.Saved"])),
    ] {
        let value = steam(json!({"service": "steam", "events": events}));
        assert_eq!(validate(&value).err(), Some("account"), "{case}");
    }
    // Steam still takes no scopes.
    let value = steam(json!({"service": "steam", "scopes": [], "events": ["stats.saved"]}));
    assert!(validate(&value).is_err());
}

#[test]
fn twitch_takes_no_steam_type() {
    let mut value = steam(json!({
        "service": "twitch",
        "scopes": ["channel:read:goals"],
        "events": ["stats.saved"]
    }));
    value["permissions"]["network"] = json!([]);
    assert_eq!(validate(&value).err(), Some("account"));
    assert_eq!(TWITCH.events_feature, Some(FEATURE_TWITCH_EVENTS));
}

#[test]
fn events_never_widen_the_permissions() {
    let without = validate(&steam(json!({"service": "steam"})))
        .expect("without")
        .permissions;
    let with = validate(&steam(json!({"service": "steam", "events": ["stats.saved"]})))
        .expect("with")
        .permissions;
    assert_eq!(with.accounts, without.accounts);
    assert!(!with.widens(&without));
    assert!(!without.widens(&with));
}

#[test]
fn the_projection_is_the_game_alone() {
    let saved = STEAM.event("stats.saved").expect("listed");
    let data = project_event(saved, &json!({"appid": 2_315_050, "path": "/home/x"})).unwrap();
    assert_eq!(data, json!({"appid": 2_315_050}));
}

#[test]
fn the_service_of_the_events() {
    let service = SERVICES
        .iter()
        .find(|service| service.name == "steam.events.subscribe")
        .expect("listed");
    assert_eq!(service.kind, ServiceKind::Subscribe);
    assert_eq!(service.requires, Requirement::Service("steam"));
    assert!(!service.gesture);
    let steamid = service
        .params
        .iter()
        .find(|field| field.name == "steamid")
        .expect("steamid");
    assert!(steamid.required);
    assert!(service.params.iter().any(|field| field.name == "types"));
    let shape = shape("SteamEvents").expect("named").shape;
    let update = json!({
        "state": "live", "reason": null,
        "events": [{"seq": 1, "type": "stats.saved", "at": 1_761_505_519_565_u64,
                    "data": {"appid": 2_315_050}}]
    });
    assert!(shape.matches(&update));
    assert!(shape.matches(&json!({"state": "off", "reason": "unavailable", "events": []})));
    assert!(!shape.matches(&json!({"state": "off", "reason": "unavailable",
        "events": [{"seq": 1, "type": "channel.follow", "at": 1, "data": {}}]})));
    assert!(!shape.matches(&json!({"state": "off", "reason": "token", "events": []})));
}

/// What the events tell stays between the widget and Steam: a widget with
/// the Steam account reaches no other origin and opens no other site, with
/// `events` as without.
#[test]
fn a_widget_with_the_events_reaches_steam_alone() {
    let events = json!({"service": "steam", "events": ["stats.saved"]});
    let mut value = steam(events.clone());
    value["permissions"]["network"]
        .as_array_mut()
        .unwrap()
        .push(json!({"origin": "https://example.com", "method": "GET", "path": "/collect"}));
    assert_eq!(validate(&value).err(), Some("account_origin"));
    let mut value = steam(events);
    value["permissions"]["links"] = json!([{"origin": "https://example.com"}]);
    assert_eq!(validate(&value).err(), Some("account_link"));
}
