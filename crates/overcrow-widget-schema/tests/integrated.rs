//! Integrated services (ADR 0009 §10): a widget names a service of the
//! table (`{ "service": "steam" }`) instead of declaring an account; every
//! refused case is a test that fails without its check.

use overcrow_widget_schema::accounts::{AccountMode, Delivery, OAuthFlow, ScopeAccess, ScopeParam};
use overcrow_widget_schema::integrated::{STEAM, TWITCH};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use serde_json::{Value, json};

fn base(permissions: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.steam-progress",
        "version": "1.0.0",
        "name": {"en": "Steam progress", "fr": "Progression Steam"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 200, "height": 96},
            "max": {"width": 480, "height": 480}
        },
        "permissions": permissions
    })
}

/// The achievements of the game in progress, with the Steam service.
fn steam() -> Value {
    base(json!({
        "storage": true,
        "accounts": [{"service": "steam"}],
        "network": [
            {
                "origin": "https://api.steampowered.com",
                "method": "GET",
                "path": "/ISteamUserStats/GetPlayerAchievements/v1/",
                "queryParams": {
                    "steamid": {"type": "slug", "maxLength": 17, "required": true},
                    "appid": {"type": "integer", "min": 1, "max": 99_999_999, "required": true}
                },
                "account": "steam"
            },
            {
                "origin": "https://api.steampowered.com",
                "method": "GET",
                "path": "/ISteamUser/GetPlayerSummaries/v2/",
                "queryParams": {"steamids": {"type": "slug", "maxLength": 17, "required": true}},
                "account": "steam"
            },
            {
                "origin": "https://steamcdn-a.akamaihd.net",
                "method": "GET",
                "path": "/steamcommunity/public/images/apps/{app}/{file}",
                "pathParams": {
                    "app": {"type": "integer", "min": 1, "max": 99_999_999},
                    "file": {"type": "slug", "maxLength": 64}
                }
            }
        ]
    }))
}

/// The live goals, with the Twitch service.
fn twitch() -> Value {
    base(json!({
        "accounts": [{
            "service": "twitch",
            "scopes": ["channel:read:goals", "moderator:read:followers"],
            "required": false
        }],
        "network": [
            {
                "origin": "https://api.twitch.tv",
                "method": "GET",
                "path": "/helix/goals",
                "queryParams": {"broadcaster_id": {"type": "slug", "maxLength": 32, "required": true}},
                "account": "twitch"
            },
            {
                "origin": "https://api.twitch.tv",
                "method": "GET",
                "path": "/helix/channels/followers",
                "queryParams": {"broadcaster_id": {"type": "slug", "maxLength": 32, "required": true}},
                "account": "twitch"
            },
            {
                "origin": "https://static-cdn.jtvnw.net",
                "method": "GET",
                "path": "/jtv_user_pictures/{file}",
                "pathParams": {"file": {"type": "slug", "maxLength": 128}}
            }
        ]
    }))
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

fn refused(manifest: &Value, error: &str, case: &str, change: impl FnOnce(&mut Value)) {
    let mut value = manifest.clone();
    change(&mut value);
    assert_eq!(validate(&value).err(), Some(error), "{case}");
}

fn accepted(manifest: &Value, case: &str, change: impl FnOnce(&mut Value)) {
    let mut value = manifest.clone();
    change(&mut value);
    if let Err(error) = validate(&value) {
        panic!("{case}: {error}");
    }
}

fn entry(value: &mut Value) -> &mut Value {
    &mut value["permissions"]["accounts"][0]
}

#[test]
fn a_service_takes_its_definition_from_the_table() {
    let manifest = validate(&steam()).expect("steam");
    let account = manifest.account().expect("declared");
    assert_eq!(account.id, "steam");
    assert_eq!(account.name, "Steam");
    assert_eq!(account.mode, AccountMode::Key);
    assert_eq!(account.service, Some(&STEAM));
    assert!(account.required, "required by default");
    assert_eq!(account.refused_status, [401, 403]);
    assert_eq!(
        account.send,
        Some(Delivery::Header {
            name: "X-WebAPI-Key".into(),
            scheme: None
        })
    );
    assert_eq!(
        account.key.as_ref().map(|key| key.page.as_str()),
        Some("https://steamcommunity.com/dev/apikey")
    );
    // `origins` stays where the secret goes; images are apart.
    assert_eq!(account.origins, ["https://api.steampowered.com"]);
    assert!(
        account
            .image_origins
            .iter()
            .any(|origin| origin == "https://steamcdn-a.akamaihd.net")
    );
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-steam"]
    );
    assert_eq!(
        manifest.permissions.accounts.iter().collect::<Vec<_>>(),
        [r#"{"service":"steam"}"#]
    );

    let manifest = validate(&twitch()).expect("twitch");
    let account = manifest.account().expect("declared");
    assert_eq!(account.id, "twitch");
    assert_eq!(account.service, Some(&TWITCH));
    assert!(!account.required);
    let oauth = account.oauth.as_ref().expect("oauth");
    assert_eq!(oauth.client_id, TWITCH.oauth.unwrap().client_id);
    assert_eq!(oauth.flow, OAuthFlow::Device);
    assert_eq!(oauth.scope_param, ScopeParam::Scopes);
    assert_eq!(oauth.client_id_header.as_deref(), Some("Client-Id"));
    let scopes: Vec<(&str, ScopeAccess)> = oauth
        .scopes
        .iter()
        .map(|scope| (scope.name.as_str(), scope.access))
        .collect();
    assert_eq!(
        scopes,
        [
            ("channel:read:goals", ScopeAccess::Read),
            ("moderator:read:followers", ScopeAccess::Read)
        ]
    );
    assert!(!account.has_write_scope());
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-twitch"]
    );
}

#[test]
fn a_service_declaration_has_only_its_own_fields() {
    for (field, value) in [
        ("id", json!("steam")),
        ("name", json!("Steam")),
        ("mode", json!("key")),
        ("origins", json!(["https://api.steampowered.com"])),
        ("send", json!({"header": "X-WebAPI-Key"})),
        (
            "key",
            json!({"format": {"charset": "hex", "minLength": 32, "maxLength": 32}, "page": "https://steamcommunity.com/dev/apikey"}),
        ),
        ("oauth", json!({})),
        ("refusedStatus", json!([401])),
        ("label", json!("Steam")),
    ] {
        refused(&steam(), "shape", field, |value_| {
            entry(value_)[field] = value.clone();
        });
    }
}

#[test]
fn the_service_is_one_of_the_table() {
    for (case, service) in [
        ("unknown", json!("discord")),
        ("upper case", json!("Steam")),
        ("empty", json!("")),
        ("number", json!(3)),
        ("list", json!(["steam"])),
        ("the host's PlayerVox account", json!("playervox")),
    ] {
        refused(&steam(), "account", case, |value| {
            entry(value)["service"] = service;
        });
    }
}

#[test]
fn scopes_are_among_those_the_service_offers() {
    refused(&steam(), "account", "scopes of a key service", |value| {
        entry(value)["scopes"] = json!([]);
    });
    refused(&steam(), "account", "a scope of a key service", |value| {
        entry(value)["scopes"] = json!(["channel:read:goals"]);
    });
    for (case, scopes) in [
        ("not offered", json!(["channel:manage:polls"])),
        ("the host's chat read", json!(["user:read:chat"])),
        ("the host's chat write", json!(["user:write:chat"])),
        ("twice", json!(["channel:read:goals", "channel:read:goals"])),
        (
            "an object",
            json!([{"name": "channel:read:goals", "access": "read"}]),
        ),
        ("not a list", json!("channel:read:goals")),
        ("the stream key", json!(["channel:read:stream_key"])),
    ] {
        refused(&twitch(), "account", case, |value| {
            entry(value)["scopes"] = scopes;
        });
    }
    // Without scopes, only the public endpoints stay open.
    let public = |value: &mut Value| {
        route(value, 0)["path"] = json!("/helix/streams");
        route(value, 1)["path"] = json!("/helix/users");
    };
    accepted(&twitch(), "no scope", |value| {
        entry(value).as_object_mut().unwrap().remove("scopes");
        public(value);
    });
    accepted(&twitch(), "an empty list", |value| {
        entry(value)["scopes"] = json!([]);
        public(value);
    });
    accepted(&twitch(), "every scope the service offers", |value| {
        entry(value)["scopes"] = TWITCH.scopes.iter().map(|scope| scope.name).collect();
    });
}

#[test]
fn required_keeps_its_meaning() {
    refused(&steam(), "account", "required as text", |value| {
        entry(value)["required"] = json!("yes");
    });
    let mut value = steam();
    entry(&mut value)["required"] = json!(false);
    assert!(
        !validate(&value)
            .expect("accepted")
            .account()
            .unwrap()
            .required
    );
}

#[test]
fn one_service_and_nothing_else_in_the_list() {
    refused(&steam(), "account", "two services", |value| {
        value["permissions"]["accounts"] = json!([{"service": "steam"}, {"service": "twitch"}]);
    });
    refused(&steam(), "account", "a service and an account", |value| {
        value["permissions"]["accounts"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id": "quests",
                "name": "Quest Log",
                "mode": "key",
                "origins": ["https://api.quests.example"],
                "send": {"header": "X-Api-Key"},
                "key": {
                    "format": {"charset": "alnum", "minLength": 16, "maxLength": 64},
                    "page": "https://quests.example/settings/api"
                }
            }));
    });
}

#[test]
fn any_change_of_the_declaration_widens() {
    let previous = validate(&twitch()).expect("twitch").permissions;
    let mut value = twitch();
    entry(&mut value)["scopes"] = json!([
        "channel:read:goals",
        "moderator:read:followers",
        "bits:read"
    ]);
    assert!(
        validate(&value)
            .expect("more scopes")
            .permissions
            .widens(&previous)
    );
    let mut value = twitch();
    entry(&mut value)["scopes"] = json!(["channel:read:goals"]);
    // The followers' route needs its scope: it goes with it.
    value["permissions"]["network"]
        .as_array_mut()
        .unwrap()
        .remove(1);
    assert!(
        validate(&value)
            .expect("fewer scopes")
            .permissions
            .widens(&previous),
        "a new detail"
    );
}

fn route(value: &mut Value, index: usize) -> &mut Value {
    &mut value["permissions"]["network"][index]
}

#[test]
fn a_service_confines_the_network_to_its_origins() {
    refused(&steam(), "account_origin", "another origin", |value| {
        route(value, 2)["origin"] = json!("https://cdn.nova.gg");
    });
    refused(
        &steam(),
        "account_origin",
        "the key to an image origin",
        |value| {
            route(value, 2)["account"] = json!("steam");
        },
    );
    refused(
        &twitch(),
        "account_origin",
        "a token endpoint as a route",
        |value| {
            route(value, 0)["origin"] = json!("https://id.twitch.tv");
            route(value, 0)["path"] = json!("/oauth2/validate");
        },
    );
    accepted(&steam(), "an API route without the key", |value| {
        route(value, 1).as_object_mut().unwrap().remove("account");
        route(value, 1)["path"] = json!("/ISteamNews/GetNewsForApp/v2/");
    });
}

#[test]
fn a_service_is_read_only() {
    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        refused(&steam(), "service_route", method, |value| {
            route(value, 0)["method"] = json!(method);
        });
        refused(&steam(), "service_route", method, |value| {
            route(value, 2)["method"] = json!(method);
        });
    }
    // The chat goes through the host's capability, never a widget route.
    refused(&twitch(), "service_route", "the chat send route", |value| {
        route(value, 0)["method"] = json!("POST");
        route(value, 0)["path"] = json!("/helix/chat/messages");
    });
}

#[test]
fn steam_routes_stay_on_the_read_interfaces() {
    for path in [
        "/IStoreService/GetAppList/v1/",
        "/IEconService/GetTradeOffers/v1/",
        "/ieconservice/GetTradeOffers/v1/",
        "/IEconService./GetTradeOffers/v1/",
        "/IGameServersService/GetAccountList/v1/",
        "/IBroadcastService/GetRTMPInfo/v1/",
    ] {
        refused(&steam(), "service_route", path, |value| {
            route(value, 0)["path"] = json!(path);
        });
    }
    refused(
        &steam(),
        "service_route",
        "a parameter for the interface",
        |value| {
            route(value, 0)["path"] = json!("/{interface}/GetTradeOffers/v1/");
            route(value, 0)["pathParams"] = json!({"interface": {"type": "slug", "maxLength": 32}});
        },
    );
    accepted(&steam(), "another read interface", |value| {
        route(value, 0)["path"] = json!("/IPlayerService/GetRecentlyPlayedGames/v1/");
    });
}

/// A route without the key on the secret origin keeps the service's
/// refused paths: the guard is the path, not the account.
#[test]
fn a_route_without_the_key_never_reaches_a_refused_path() {
    for path in [
        "/IEconService/GetTradeOffers/v1/",
        "/IEconService./GetTradeOffers/v1/",
        "/ITwoFactorService/QueryStatus/v1/",
    ] {
        refused(&steam(), "service_route", path, |value| {
            route(value, 1).as_object_mut().unwrap().remove("account");
            route(value, 1)["path"] = json!(path);
        });
    }
    refused(
        &twitch(),
        "service_route",
        "the broadcast key without the token",
        |value| {
            route(value, 0).as_object_mut().unwrap().remove("account");
            route(value, 0)["path"] = json!("/helix/streams/key");
        },
    );
}

#[test]
fn twitch_routes_never_reach_a_secret() {
    for path in [
        "/helix/streams/key",
        "/HELIX/Streams/Key",
        "/helix/streams/key.",
        "/helix/extensions/jwt/secrets",
        "/helix/eventsub/subscriptions",
        "/kraken/streams",
    ] {
        refused(&twitch(), "service_route", path, |value| {
            route(value, 0)["path"] = json!(path);
        });
    }
    refused(
        &twitch(),
        "service_route",
        "a parameter before key",
        |value| {
            route(value, 0)["path"] = json!("/helix/{kind}/key");
            route(value, 0)["pathParams"] =
                json!({"kind": {"type": "enum", "values": ["streams", "clips"]}});
        },
    );
    accepted(&twitch(), "the public stream state", |value| {
        route(value, 0)["path"] = json!("/helix/streams");
    });
}

#[test]
fn a_service_keeps_the_rules_of_an_account() {
    refused(
        &steam(),
        "sensitive_egress",
        "a sensitive capability",
        |value| {
            value["permissions"]["capabilities"] = json!(["twitch.chat.read"]);
        },
    );
    refused(&steam(), "sensitive_egress", "the clipboard", |value| {
        value["permissions"]["clipboardWrite"] = json!(true);
    });
    refused(
        &steam(),
        "account_overlap",
        "two rules, one with the key",
        |value| {
            let mut other = route(value, 0).clone();
            other.as_object_mut().unwrap().remove("account");
            other["path"] = json!("/ISteamUserStats/{method}/v1/");
            other["pathParams"] = json!({"method": {"type": "slug", "maxLength": 64}});
            other.as_object_mut().unwrap().remove("queryParams");
            value["permissions"]["network"]
                .as_array_mut()
                .unwrap()
                .push(other);
        },
    );
    refused(
        &steam(),
        "network_rule",
        "a route naming another account",
        |value| {
            route(value, 0)["account"] = json!("twitch");
        },
    );
}

/// A declared account that looks like an integrated service: the widget
/// must name the service, whose guards then apply.
fn declared(id: &str, name: &str, origin: &str) -> Value {
    base(json!({
        "accounts": [{
            "id": id,
            "name": name,
            "mode": "key",
            "origins": [origin],
            "send": {"header": "X-Api-Key"},
            "key": {
                "format": {"charset": "alnum", "minLength": 16, "maxLength": 64},
                "page": "https://runlog.example/settings/api"
            }
        }],
        "network": [{
            "origin": origin,
            "method": "GET",
            "path": "/v1/runs",
            "account": id
        }]
    }))
}

#[test]
fn a_declared_account_never_stands_for_a_service() {
    validate(&declared("runlog", "Run Log", "https://api.runlog.example"))
        .expect("a fictitious service");
    for (case, value) in [
        (
            "the Steam ID",
            declared("steam", "Run Log", "https://api.runlog.example"),
        ),
        (
            "the Twitch ID",
            declared("twitch", "Run Log", "https://api.runlog.example"),
        ),
        (
            "named Steam",
            declared("runlog", "Steam", "https://api.runlog.example"),
        ),
        (
            "named STEAM",
            declared("runlog", "STEAM", "https://api.runlog.example"),
        ),
        (
            "named S t e a m",
            declared("runlog", "S t e a m", "https://api.runlog.example"),
        ),
        (
            "named 5team",
            declared("runlog", "5team", "https://api.runlog.example"),
        ),
        (
            "named Steam stats",
            declared("runlog", "Steam stats", "https://api.runlog.example"),
        ),
        (
            "named Twitch",
            declared("runlog", "Twitch", "https://api.runlog.example"),
        ),
        (
            "named Tw1tch",
            declared("runlog", "Tw1tch", "https://api.runlog.example"),
        ),
        (
            "the Steam API",
            declared("runlog", "Run Log", "https://api.steampowered.com"),
        ),
        (
            "the Twitch API",
            declared("runlog", "Run Log", "https://api.twitch.tv"),
        ),
        (
            "the Twitch tokens",
            declared("runlog", "Run Log", "https://id.twitch.tv"),
        ),
    ] {
        assert_eq!(validate(&value).err(), Some("account_service"), "{case}");
    }
}

#[test]
fn the_service_keyword_list_is_the_table() {
    use overcrow_widget_schema::accounts::SERVICE_ACCOUNT_FIELDS;
    use overcrow_widget_schema::integrated::INTEGRATED_SERVICES;
    use overcrow_widget_schema::model::ValueType;
    let ValueType::Keyword(keywords) = SERVICE_ACCOUNT_FIELDS[0].ty else {
        panic!("service is a keyword");
    };
    let ids: Vec<&str> = INTEGRATED_SERVICES
        .iter()
        .map(|service| service.id)
        .collect();
    assert_eq!(keywords, ids.as_slice());
}

/// A declared account never sends the player to a service's pages or
/// addresses: the player would fetch their real Steam key for another
/// service, or sign in at Twitch for a publisher's server.
#[test]
fn a_declared_account_never_uses_a_services_addresses() {
    let mut on_key_page = declared("runlog", "Run Log", "https://api.runlog.example");
    entry(&mut on_key_page)["key"]["page"] = json!("https://steamcommunity.com/dev/apikey");
    assert_eq!(
        validate(&on_key_page).err(),
        Some("account_service"),
        "the Steam key page"
    );
    for origin in [
        "https://store.steampowered.com",
        "https://partner.steam-api.com",
        "https://gql.twitch.tv",
        "https://static-cdn.jtvnw.net",
    ] {
        let value = declared("runlog", "Run Log", origin);
        assert_eq!(validate(&value).err(), Some("account_service"), "{origin}");
    }
    let mut oauth = declared("runlog", "Run Log", "https://api.runlog.example");
    let account = entry(&mut oauth).as_object_mut().unwrap();
    account.remove("send");
    account.remove("key");
    account.insert("mode".into(), json!("oauth"));
    account.insert(
        "origins".into(),
        json!(["https://api.runlog.example", "https://id.runlog.example"]),
    );
    account.insert(
        "oauth".into(),
        json!({
            "clientId": "nova-run-log",
            "flow": "loopback",
            "authorize": "https://id.twitch.tv/oauth2/authorize",
            "token": "https://id.runlog.example/token",
            "scopes": [{"name": "runs:read", "access": "read"}]
        }),
    );
    assert_eq!(
        validate(&oauth).err(),
        Some("account_service"),
        "Twitch's sign-in page"
    );
    // Twitch's own page for a device code.
    let account = entry(&mut oauth).as_object_mut().unwrap();
    account.insert(
        "oauth".into(),
        json!({
            "clientId": "nova-run-log",
            "flow": "device",
            "device": "https://id.runlog.example/device",
            "verify": "https://www.twitch.tv/activate",
            "token": "https://id.runlog.example/token",
            "scopes": [{"name": "runs:read", "access": "read"}]
        }),
    );
    assert_eq!(
        validate(&oauth).err(),
        Some("account_service"),
        "Twitch's device page"
    );
    // The same account on its own pages passes.
    entry(&mut oauth)["oauth"]["verify"] = json!("https://runlog.example/activate");
    assert_eq!(validate(&oauth).err(), None, "its own device page");
}

#[test]
fn look_alike_letters_never_hide_a_services_name() {
    for name in [
        "ЅТЕАМ",
        "Ѕteam",
        "Τwitch",
        "ТWITCH",
        "Stеаm",
        "Šteam",
        "Ştеam",
        "Ťwitch",
        "Twiťch",
        "Stearn",
        "Valve keys",
        "VALVE",
    ] {
        let value = declared("runlog", name, "https://api.runlog.example");
        assert_eq!(validate(&value).err(), Some("account_service"), "{name}");
    }
}

/// The Twitch token is shared: a widget reaches only the endpoints whose
/// scope it asked for itself, never one granted for another widget.
#[test]
fn a_twitch_route_needs_the_scope_the_widget_asked_for() {
    refused(
        &twitch(),
        "service_route",
        "a scope another widget asked for",
        |value| {
            route(value, 0)["path"] = json!("/helix/hypetrain/status");
        },
    );
    refused(
        &twitch(),
        "service_route",
        "an endpoint of no scope offered",
        |value| {
            route(value, 0)["path"] = json!("/helix/moderation/banned");
        },
    );
    refused(
        &twitch(),
        "service_route",
        "the goals without their scope",
        |value| {
            entry(value)["scopes"] = json!(["moderator:read:followers"]);
        },
    );
    refused(
        &twitch(),
        "service_route",
        "a deeper path than the endpoint",
        |value| {
            route(value, 0)["path"] = json!("/helix/goals/{id}");
            route(value, 0)["pathParams"] = json!({"id": {"type": "slug", "maxLength": 32}});
        },
    );
    accepted(&twitch(), "a public endpoint without a scope", |value| {
        entry(value)["scopes"] = json!(["moderator:read:followers"]);
        route(value, 0)["path"] = json!("/helix/streams");
    });
    accepted(&twitch(), "the endpoint of a scope it asked for", |value| {
        entry(value)["scopes"] = json!([
            "channel:read:goals",
            "moderator:read:followers",
            "channel:read:hype_train"
        ]);
        route(value, 0)["path"] = json!("/helix/hypetrain/status");
    });
}

/// PlayerVox's own client at Twitch is the Twitch service's: a declared
/// account using it would show PlayerVox's app on Twitch's consent page
/// and send the token to the publisher's endpoints.
#[test]
fn a_declared_account_never_uses_a_services_client() {
    let client = TWITCH.oauth.unwrap().client_id;
    let mut value = declared("runlog", "Run Log", "https://api.runlog.example");
    let account = entry(&mut value).as_object_mut().unwrap();
    account.remove("send");
    account.remove("key");
    account.insert("mode".into(), json!("oauth"));
    account.insert("origins".into(), json!(["https://api.runlog.example"]));
    account.insert(
        "oauth".into(),
        json!({
            "clientId": client,
            "flow": "device",
            "device": "https://api.runlog.example/device",
            "verify": "https://runlog.example/activate",
            "token": "https://api.runlog.example/token",
            "scopes": [{"name": "runs:read", "access": "read"}]
        }),
    );
    assert_eq!(validate(&value).err(), Some("account_service"));
    entry(&mut value)["oauth"]["clientId"] = json!("nova-run-log");
    validate(&value).expect("its own client");
}

/// What a reader refuses of a declared account is frozen: a service or a
/// domain added later must never make a newer reader refuse a manifest an
/// older one accepted (and with it the whole catalog).
#[test]
fn the_readers_guard_is_frozen_and_covers_the_table() {
    use overcrow_widget_schema::integrated::{INTEGRATED_SERVICES, READER_GUARDS, ServiceGuard};
    // The exact image: a name, a domain, an origin or a client added makes
    // newer readers refuse what older ones accepted; one removed relaxes
    // the guard of every reader.
    const FROZEN: &[ServiceGuard] = &[
        ServiceGuard {
            id: "steam",
            names: &["steam", "valve"],
            domains: &[
                "steampowered.com",
                "steamcommunity.com",
                "steamstatic.com",
                "steam-api.com",
                "steamgames.com",
                "steamcontent.com",
                "steamusercontent.com",
                "valvesoftware.com",
            ],
            origins: &["https://steamcdn-a.akamaihd.net"],
            client_ids: &[],
        },
        ServiceGuard {
            id: "twitch",
            names: &["twitch"],
            domains: &["twitch.tv", "jtvnw.net", "twitchcdn.net", "twitchsvc.net"],
            origins: &[],
            client_ids: &["4mnhecoh0nif054yubgwkkj2k7bma2"],
        },
    ];
    assert_eq!(
        READER_GUARDS, FROZEN,
        "frozen: add a service or an address to the producers' checks"
    );
    for service in INTEGRATED_SERVICES {
        let Some(guard) = READER_GUARDS.iter().find(|guard| guard.id == service.id) else {
            continue;
        };
        for domain in service.domains {
            assert!(guard.domains.contains(domain), "{domain}");
        }
        for origin in service.all_origins() {
            let host = origin.trim_start_matches("https://");
            assert!(
                guard.origins.contains(&origin)
                    || guard
                        .domains
                        .iter()
                        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}"))),
                "{origin}"
            );
        }
        if let Some(oauth) = service.oauth {
            assert!(guard.client_ids.contains(&oauth.client_id));
        }
        assert!(
            guard
                .names
                .contains(&service.name.to_ascii_lowercase().as_str())
        );
    }
}

/// The look-alike tables the readers fold an account's name with
/// (`reads_as_any`, `reads_as_reserved_name`) are part of the frozen guard:
/// a letter added makes newer readers refuse a name older ones accepted.
#[test]
fn the_look_alikes_readers_fold_are_frozen() {
    use overcrow_widget_schema::identifiers::{
        CONFUSABLE_LETTERS, STYLIZED_LETTERS, UNICODE_CONFUSABLE_LETTERS,
    };
    use overcrow_widget_schema::package::{hex, sha256};
    let mut image = String::new();
    for (letters, ascii) in CONFUSABLE_LETTERS {
        image.push_str(&format!("{letters}>{ascii}\n"));
    }
    image.push_str("--\n");
    for (look_alike, ascii) in UNICODE_CONFUSABLE_LETTERS {
        image.push_str(&format!("{:x}>{ascii}\n", u32::from(*look_alike)));
    }
    image.push_str("--\n");
    for block in STYLIZED_LETTERS {
        image.push_str(&format!(
            "{:x}-{:x}\n",
            u32::from(*block.start()),
            u32::from(*block.end())
        ));
    }
    assert_eq!(
        (
            CONFUSABLE_LETTERS.len(),
            UNICODE_CONFUSABLE_LETTERS.len(),
            STYLIZED_LETTERS.len()
        ),
        (17, 519, 9),
        "sizes"
    );
    assert_eq!(
        hex(&sha256(image.as_bytes())),
        "ff87b03128baeccb66655ad662bbcd297761f4d59afe8add7e4092ddafff8a00",
        "frozen: a look-alike added or removed changes what readers refuse"
    );
}
