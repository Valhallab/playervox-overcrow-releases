//! Local Steam data: a widget that names the Steam service lists in `local`
//! what the host reads for it from the Steam client of the user's computer.
//! `achievements`: the unlocked achievements of the account the widget
//! names, for one game, by `steam.achievements.local`, each its API name and
//! unlock time, never a path or anything else of the files. A reader that
//! does not know it refuses the manifest: it needs the catalog feature
//! `steam-local-achievements`.

use overcrow_widget_schema::catalog_v2::{FEATURE_STEAM_LOCAL_ACHIEVEMENTS, KNOWN_FEATURES};
use overcrow_widget_schema::integrated::{STEAM, STEAM_LOCAL_KINDS, TWITCH};
use overcrow_widget_schema::limits::{MAX_ACHIEVEMENT_NAME_BYTES, MAX_LOCAL_ACHIEVEMENTS};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::model::ValueType;
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
                "path": "/ISteamUserStats/GetSchemaForGame/v2/",
                "queryParams": {
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
fn the_table_is_the_achievements() {
    assert_eq!(STEAM_LOCAL_KINDS, ["achievements"]);
    let table: Vec<_> = STEAM
        .local
        .iter()
        .map(|local| (local.kind, local.service, local.feature))
        .collect();
    assert_eq!(
        table,
        [(
            "achievements",
            "steam.achievements.local",
            "steam-local-achievements"
        )]
    );
    assert!(TWITCH.local.is_empty());
    assert_eq!(MAX_LOCAL_ACHIEVEMENTS.value, 4096);
    assert_eq!(MAX_ACHIEVEMENT_NAME_BYTES.value, 128);
}

#[test]
fn local_achievements_need_their_feature() {
    assert_eq!(FEATURE_STEAM_LOCAL_ACHIEVEMENTS, "steam-local-achievements");
    assert!(KNOWN_FEATURES.contains(&FEATURE_STEAM_LOCAL_ACHIEVEMENTS));
    let manifest = validate(&steam(json!({
        "service": "steam",
        "events": ["stats.saved"],
        "local": ["achievements"]
    })))
    .expect("local");
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-steam", "steam-events", "steam-local-achievements"]
    );
    let account = manifest.account().expect("declared");
    assert_eq!(
        account
            .local
            .iter()
            .map(|local| local.kind)
            .collect::<Vec<_>>(),
        ["achievements"]
    );
    let manifest = validate(&steam(json!({"service": "steam"}))).expect("no local");
    assert!(manifest.account().unwrap().local.is_empty());
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-steam"]
    );
}

#[test]
fn only_known_distinct_kinds_are_listed() {
    for (case, local) in [
        ("empty list", json!([])),
        ("unknown kind", json!(["stats"])),
        ("twice", json!(["achievements", "achievements"])),
        ("not text", json!([1])),
        ("not a list", json!("achievements")),
        ("case", json!(["Achievements"])),
        ("a path", json!(["appcache/stats"])),
    ] {
        let value = steam(json!({"service": "steam", "local": local}));
        assert_eq!(validate(&value).err(), Some("account"), "{case}");
    }
}

#[test]
fn twitch_has_no_local_data() {
    let mut value = steam(json!({
        "service": "twitch",
        "scopes": ["channel:read:goals"],
        "local": ["achievements"]
    }));
    value["permissions"]["network"] = json!([]);
    assert_eq!(validate(&value).err(), Some("account"));
}

#[test]
fn a_declared_account_has_no_local_data() {
    let mut value = steam(json!({
        "id": "nova",
        "name": "Nova",
        "mode": "key",
        "origins": ["https://api.nova.example"],
        "send": {"header": "X-Key"},
        "key": {"page": "https://nova.example/key"},
        "local": ["achievements"]
    }));
    value["permissions"]["network"] = json!([]);
    assert!(validate(&value).is_err());
}

/// The player's own data on their screen, which the account lets reach no
/// one but Steam: listing `local` asks no new consent at an update.
#[test]
fn local_data_never_widens_the_permissions() {
    let without = validate(&steam(json!({"service": "steam"})))
        .expect("without")
        .permissions;
    let with = validate(&steam(
        json!({"service": "steam", "local": ["achievements"]}),
    ))
    .expect("with")
    .permissions;
    assert_eq!(with.accounts, without.accounts);
    assert!(!with.widens(&without));
    assert!(!without.widens(&with));
}

#[test]
fn a_widget_with_local_data_reaches_steam_alone() {
    let local = json!({"service": "steam", "local": ["achievements"]});
    let mut value = steam(local.clone());
    value["permissions"]["network"]
        .as_array_mut()
        .unwrap()
        .push(json!({"origin": "https://example.com", "method": "GET", "path": "/collect"}));
    assert_eq!(validate(&value).err(), Some("account_origin"));
    let mut value = steam(local);
    value["permissions"]["links"] = json!([{"origin": "https://example.com"}]);
    assert_eq!(validate(&value).err(), Some("account_link"));
}

#[test]
fn the_service_and_its_result() {
    let service = SERVICES
        .iter()
        .find(|service| service.name == "steam.achievements.local")
        .expect("listed");
    assert_eq!(service.kind, ServiceKind::Call);
    assert_eq!(service.requires, Requirement::Service("steam"));
    assert!(!service.gesture && !service.confirm);
    let params: Vec<_> = service
        .params
        .iter()
        .map(|field| (field.name, field.required))
        .collect();
    assert_eq!(
        params,
        [("steamid", true), ("appid", true), ("offset", false)]
    );
    let appid = service.params.iter().find(|field| field.name == "appid");
    assert_eq!(
        appid.map(|field| field.ty),
        Some(ValueType::Integer {
            min: 1,
            max: 4_294_967_295
        })
    );

    let shape = shape("SteamLocalAchievements").expect("named").shape;
    assert!(shape.matches(&json!({
        "appid": 1_806_840, "total": 2,
        "achievements": [
            {"name": "ACH_FROG_FOUND", "unlockedAt": 1_761_568_118_000_u64},
            {"name": "ACH_FIRST_LEVEL", "unlockedAt": null}
        ]
    })));
    assert!(shape.matches(&json!({"appid": 1_806_840, "total": 0, "achievements": []})));
    // Exact: nothing else of the files.
    assert!(!shape.matches(&json!({
        "appid": 1, "total": 1,
        "achievements": [{"name": "A", "unlockedAt": 1, "displayName": "A"}]
    })));
    assert!(!shape.matches(&json!({
        "appid": 1, "total": 0, "achievements": [], "path": "/home/x"
    })));
    assert!(!shape.matches(&json!({
        "appid": 1, "total": 1, "achievements": [{"name": "A"}]
    })));
}
