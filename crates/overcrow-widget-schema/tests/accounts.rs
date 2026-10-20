//! Third-party accounts (ADR 0009): every refused case is a test that fails
//! without its check. Each case mutates one of the valid examples.

use overcrow_widget_schema::accounts::{AccountMode, Delivery, OAuthFlow, ScopeParam};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use serde_json::{Value, json};

fn base(permissions: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.steam-stats",
        "version": "1.0.0",
        "name": {"en": "Steam stats", "fr": "Stats Steam"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 280, "height": 140},
            "max": {"width": 480, "height": 480}
        },
        "permissions": permissions
    })
}

/// `nova.steam-stats` of the design: a key in `X-WebAPI-Key`.
fn key() -> Value {
    base(json!({
        "storage": true,
        "accounts": [{
            "id": "runlog",
            "name": "Run Log",
            "mode": "key",
            "origins": ["https://api.runlog.example", "https://img.runlog.example"],
            "send": {"header": "X-WebAPI-Key"},
            "key": {
                "format": {"charset": "hex", "minLength": 32, "maxLength": 32},
                "page": "https://runlog.example/settings/api"
            },
            "refusedStatus": [401, 403]
        }],
        "network": [
            {
                "origin": "https://api.runlog.example",
                "method": "GET",
                "path": "/ISteamUser/GetPlayerSummaries/v2/",
                "queryParams": {"steamids": {"type": "slug", "maxLength": 17, "required": true}},
                "maxResponseBytes": 65536,
                "account": "runlog"
            },
            {
                "origin": "https://api.runlog.example",
                "method": "GET",
                "path": "/ISteamUserStats/GetPlayerAchievements/v1/",
                "queryParams": {
                    "steamid": {"type": "slug", "maxLength": 17, "required": true},
                    "appid": {"type": "integer", "min": 1, "max": 99_999_999, "required": true},
                    "l": {"type": "enum", "values": ["english", "french"]}
                },
                "account": "runlog"
            },
            {
                "origin": "https://img.runlog.example",
                "method": "GET",
                "path": "/{file}",
                "pathParams": {"file": {"type": "slug", "maxLength": 64}}
            }
        ]
    }))
}

/// `nova.live-followers`: OAuth by device code.
fn device() -> Value {
    base(json!({
        "accounts": [{
            "id": "twitch-api",
            "name": "Stream Stats",
            "mode": "oauth",
            "origins": ["https://api.streamstats.example", "https://id.streamstats.example"],
            "oauth": {
                "clientId": "abcdefghijklmnopqrstuvwxyz0123",
                "flow": "device",
                "device": "https://id.streamstats.example/oauth2/device",
                "verify": "https://streamstats.example/activate",
                "token": "https://id.streamstats.example/oauth2/token",
                "revoke": "https://id.streamstats.example/oauth2/revoke",
                "validate": "https://id.streamstats.example/oauth2/validate",
                "scopes": [{"name": "moderator:read:followers", "access": "read"}],
                "scopeParam": "scopes",
                "clientIdHeader": "Client-Id"
            }
        }],
        "network": [{
            "origin": "https://api.streamstats.example",
            "method": "GET",
            "path": "/helix/channels/followers",
            "queryParams": {"broadcaster_id": {"type": "slug", "maxLength": 32, "required": true}},
            "account": "twitch-api"
        }]
    }))
}

/// `nova.quest-log`: OAuth in the browser with a loopback redirect.
fn loopback() -> Value {
    base(json!({
        "accounts": [{
            "id": "quests",
            "name": "Quest Log",
            "mode": "oauth",
            "origins": [
                "https://api.quests.example",
                "https://img.quests.example",
                "https://quests.example"
            ],
            "oauth": {
                "clientId": "nova-overcrow-widget",
                "flow": "loopback",
                "authorize": "https://quests.example/oauth/authorize",
                "token": "https://quests.example/oauth/token",
                "revoke": "https://quests.example/oauth/revoke",
                "scopes": [
                    {"name": "quests:read", "access": "read"},
                    {"name": "quests:track", "access": "write"}
                ]
            }
        }],
        "network": [
            {
                "origin": "https://api.quests.example",
                "method": "GET",
                "path": "/v1/me/quests",
                "queryParams": {"status": {"type": "enum", "values": ["active", "done"]}},
                "account": "quests"
            },
            {
                "origin": "https://api.quests.example",
                "method": "POST",
                "path": "/v1/me/quests/{id}/track",
                "pathParams": {"id": {"type": "integer", "min": 1, "max": 9_007_199_254_740_991_i64}},
                "account": "quests"
            },
            {
                "origin": "https://img.quests.example",
                "method": "GET",
                "path": "/icons/{file}",
                "pathParams": {"file": {"type": "slug", "maxLength": 64}}
            }
        ]
    }))
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

/// Applies `change` to a copy of `manifest` and expects `error`.
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

fn account(value: &mut Value) -> &mut Value {
    &mut value["permissions"]["accounts"][0]
}

#[test]
fn the_examples_of_the_design_are_accepted() {
    let steam = validate(&key()).expect("key");
    let account = steam.account().expect("declared");
    assert_eq!(account.id, "runlog");
    assert_eq!(account.mode, AccountMode::Key);
    assert_eq!(account.refused_status, [401, 403]);
    assert!(account.required, "required by default");
    assert_eq!(
        account.send,
        Some(Delivery::Header {
            name: "X-WebAPI-Key".into(),
            scheme: None
        })
    );
    assert_eq!(
        steam.features().into_iter().collect::<Vec<_>>(),
        ["account-key"]
    );
    assert_eq!(steam.permissions.accounts.len(), 1);

    let followers = validate(&device()).expect("device");
    let oauth = followers
        .account()
        .and_then(|a| a.oauth.as_ref())
        .expect("oauth");
    assert_eq!(oauth.flow, OAuthFlow::Device);
    assert_eq!(oauth.scope_param, ScopeParam::Scopes);
    assert_eq!(
        followers.features().into_iter().collect::<Vec<_>>(),
        ["account-oauth"]
    );

    let quests = validate(&loopback()).expect("loopback");
    let account = quests.account().expect("declared");
    assert!(account.has_write_scope());
    assert_eq!(account.refused_status, [401], "default");
    let oauth = account.oauth.as_ref().expect("oauth");
    assert_eq!(oauth.scope_param, ScopeParam::Scope, "default");
}

#[test]
fn a_manifest_without_an_account_needs_no_feature() {
    let mut value = key();
    value["permissions"] = json!({"storage": true});
    let manifest = validate(&value).expect("valid");
    assert!(manifest.features().is_empty());
    assert!(manifest.account().is_none());
    assert!(manifest.permissions.accounts.is_empty());
}

#[test]
fn no_minimum_size_is_imposed() {
    accepted(&key(), "a small widget", |value| {
        value["sizing"] = json!({
            "fit": "none",
            "preferred": {"width": 120, "height": 60},
            "min": {"width": 120, "height": 60},
            "max": {"width": 120, "height": 60}
        });
    });
}

#[test]
fn one_account_at_most() {
    refused(&key(), "account", "two accounts", |value| {
        let mut second = account(value).clone();
        second["id"] = json!("steam-two");
        value["permissions"]["accounts"]
            .as_array_mut()
            .expect("list")
            .push(second);
    });
    refused(&key(), "shape", "not a list", |value| {
        value["permissions"]["accounts"] = json!({"id": "runlog"});
    });
    // An empty list needs no feature, yet a reader that does not know the
    // field refuses it: the whole catalog would break for older readers.
    refused(&key(), "account", "an empty list", |value| {
        value["permissions"]["accounts"] = json!([]);
        for rule in value["permissions"]["network"]
            .as_array_mut()
            .expect("rules")
        {
            rule.as_object_mut().expect("rule").remove("account");
        }
    });
}

#[test]
fn account_id_grammar() {
    for id in [
        "Steam",
        "s",
        "1steam",
        "steam-",
        "st--eam",
        "st_eam",
        "playervox",
        "",
    ] {
        refused(&key(), "account", id, |value| {
            account(value)["id"] = json!(id);
            // The routes follow, so only the ID is wrong.
            for rule in value["permissions"]["network"]
                .as_array_mut()
                .expect("rules")
            {
                if rule.get("account").is_some() {
                    rule["account"] = json!(id);
                }
            }
        });
    }
    let longest = format!("s{}", "a".repeat(31));
    refused(&key(), "account", "33 bytes", |value| {
        account(value)["id"] = json!(format!("{longest}a"));
    });
    accepted(&key(), "32 bytes", |value| {
        account(value)["id"] = json!(longest);
        for rule in value["permissions"]["network"]
            .as_array_mut()
            .expect("rules")
        {
            if rule.get("account").is_some() {
                rule["account"] = json!(longest);
            }
        }
    });
}

#[test]
fn account_name_is_plain_and_not_reserved() {
    for name in [
        "PlayerVox",
        "Player Vox",
        "playervox API",
        "0verCrow",
        "OverCrow",
        "Valhallab",
        "PlayerV\u{043e}\u{0445}",
        "\u{202e}Steam",
        "Ste\u{200b}am",
        "Steam\n",
        " Steam",
        "",
        "\u{1d413}witch",
    ] {
        refused(&key(), "account", name, |value| {
            account(value)["name"] = json!(name);
        });
    }
    // Bidirectional and invisible formatting without any reserved word: the
    // text check alone refuses them.
    for name in [
        "Run\u{202e}Log",
        "Run\u{202d}Log",
        "\u{2066}Run Log\u{2069}",
        "\u{2067}Run Log",
        "Run\u{200f}Log",
        "Run\u{200e}Log",
        "Run\u{061c}Log",
        "Run\u{feff}Log",
        "Run\u{2060}Log",
    ] {
        refused(&key(), "account", name, |value| {
            account(value)["name"] = json!(name);
        });
    }
    accepted(&key(), "the same name without them", |value| {
        account(value)["name"] = json!("Run Log");
    });
    refused(&key(), "account", "33 characters", |value| {
        account(value)["name"] = json!("é".repeat(33));
    });
    accepted(&key(), "32 characters", |value| {
        account(value)["name"] = json!("é".repeat(32));
    });
}

#[test]
fn mode_and_its_object() {
    refused(&key(), "account", "unknown mode", |value| {
        account(value)["mode"] = json!("password");
    });
    refused(&key(), "account", "key mode with oauth", |value| {
        account(value)["oauth"] = device()["permissions"]["accounts"][0]["oauth"].clone();
    });
    refused(&key(), "account", "key mode without key", |value| {
        account(value)
            .as_object_mut()
            .expect("account")
            .remove("key");
    });
    refused(&key(), "account", "key mode without send", |value| {
        account(value)
            .as_object_mut()
            .expect("account")
            .remove("send");
    });
    refused(&device(), "account", "oauth mode with key", |value| {
        account(value)["key"] = key()["permissions"]["accounts"][0]["key"].clone();
    });
    refused(&device(), "account", "oauth mode with send", |value| {
        account(value)["send"] = json!({"header": "X-Key"});
    });
    refused(&device(), "account", "oauth mode without oauth", |value| {
        account(value)
            .as_object_mut()
            .expect("account")
            .remove("oauth");
    });
    refused(&key(), "shape", "unknown field", |value| {
        account(value)["password"] = json!(true);
    });
}

#[test]
fn origins_are_distinct_canonical_https() {
    for origins in [
        json!([]),
        json!([
            "https://a.example",
            "https://b.example",
            "https://c.example",
            "https://d.example",
            "https://api.runlog.example"
        ]),
        json!(["https://api.runlog.example", "https://api.runlog.example"]),
        json!(["http://api.steampowered.com"]),
        json!(["https://127.0.0.1"]),
        json!(["https://api.runlog.example:443"]),
        json!(["https://api.runlog.example/"]),
        json!(["https://API.steampowered.com"]),
        json!([3]),
    ] {
        refused(&key(), "account", &origins.to_string(), |value| {
            account(value)["origins"] = origins.clone();
        });
    }
}

#[test]
fn required_and_refused_status() {
    accepted(&key(), "optional account", |value| {
        account(value)["required"] = json!(false);
    });
    refused(&key(), "account", "required as text", |value| {
        account(value)["required"] = json!("no");
    });
    for statuses in [
        json!([]),
        json!([401, 401]),
        json!([500]),
        json!([402]),
        json!(["401"]),
        json!(401),
    ] {
        refused(&key(), "account", &statuses.to_string(), |value| {
            account(value)["refusedStatus"] = statuses.clone();
        });
    }
    accepted(&key(), "403 only", |value| {
        account(value)["refusedStatus"] = json!([403]);
    });
}

#[test]
fn send_header_is_a_header_the_broker_does_not_own() {
    for header in [
        "Host",
        "Cookie",
        "cookie",
        "Set-Cookie",
        "Content-Length",
        "Content-Type",
        "content-encoding",
        "Transfer-Encoding",
        "TE",
        "Trailer",
        "Connection",
        "Keep-Alive",
        "Upgrade",
        "Accept",
        "Accept-Encoding",
        "If-None-Match",
        "User-Agent",
        "Referer",
        "Origin",
        "Range",
        "Expect",
        "Proxy-Authorization",
        "Sec-Fetch-Mode",
        "Forwarded",
        "X-FORWARDED-FOR",
        "X Key",
        "X:Key",
        "",
    ] {
        refused(&key(), "account", header, |value| {
            account(value)["send"] = json!({ "header": header });
        });
    }
    refused(&key(), "account", "65 bytes", |value| {
        account(value)["send"] = json!({ "header": "x".repeat(65) });
    });
    accepted(&key(), "Authorization with a scheme", |value| {
        account(value)["send"] = json!({"header": "Authorization", "scheme": "Token"});
    });
    accepted(&key(), "Authorization alone", |value| {
        account(value)["send"] = json!({"header": "authorization"});
    });
    for (send, case) in [
        (
            json!({"header": "X-Key", "scheme": "Bearer"}),
            "scheme without Authorization",
        ),
        (
            json!({"header": "Authorization", "scheme": "Bear er"}),
            "scheme with a space",
        ),
        (
            json!({"header": "Authorization", "scheme": "1Bearer"}),
            "scheme with a digit first",
        ),
        (
            json!({"header": "Authorization", "scheme": "B".repeat(17)}),
            "scheme of 17 bytes",
        ),
        (
            json!({"header": "X-Key", "query": "key"}),
            "header and query",
        ),
        (json!({"scheme": "Bearer"}), "scheme alone"),
        (json!({}), "nothing"),
        (json!({"query": "1key"}), "query name"),
        (json!({"query": "api-key"}), "query name with a hyphen"),
    ] {
        refused(&key(), "account", case, |value| {
            account(value)["send"] = send.clone();
        });
    }
    refused(&key(), "shape", "unknown send field", |value| {
        account(value)["send"] = json!({"cookie": "session"});
    });
}

#[test]
fn send_query_belongs_to_the_host() {
    accepted(&key(), "a query parameter", |value| {
        account(value)["send"] = json!({"query": "key"});
    });
    refused(
        &key(),
        "account",
        "declared by a route of the account",
        |value| {
            account(value)["send"] = json!({"query": "key"});
            value["permissions"]["network"][0]["queryParams"]["key"] =
                json!({"type": "slug", "maxLength": 32});
        },
    );
    accepted(&key(), "declared by a route without the account", |value| {
        account(value)["send"] = json!({"query": "key"});
        value["permissions"]["network"][2] = json!({
            "origin": "https://img.runlog.example",
            "method": "GET",
            "path": "/{file}",
            "pathParams": {"file": {"type": "slug", "maxLength": 64}},
            "queryParams": {"key": {"type": "slug", "maxLength": 8}}
        });
    });
}

#[test]
fn key_format_and_page() {
    for (format, case) in [
        (
            json!({"charset": "hex", "minLength": 7, "maxLength": 32}),
            "min 7",
        ),
        (
            json!({"charset": "hex", "minLength": 32, "maxLength": 513}),
            "max 513",
        ),
        (
            json!({"charset": "hex", "minLength": 33, "maxLength": 32}),
            "min above max",
        ),
        (
            json!({"charset": "utf8", "minLength": 32, "maxLength": 32}),
            "unknown charset",
        ),
        (
            json!({"charset": "hex", "minLength": 32.5, "maxLength": 33}),
            "fraction",
        ),
    ] {
        refused(&key(), "account", case, |value| {
            account(value)["key"]["format"] = format.clone();
        });
    }
    refused(&key(), "shape", "format without maxLength", |value| {
        account(value)["key"]["format"] = json!({"charset": "hex", "minLength": 32});
    });
    for page in [
        "http://steamcommunity.com/dev/apikey",
        "https://runlog.example/settings/api#key",
        "https://me@steamcommunity.com/dev/apikey",
        "https://steamcommunity.com",
        "https://runlog.example/settings/api?app={id}",
        "steamcommunity.com/dev/apikey",
    ] {
        refused(&key(), "account", page, |value| {
            account(value)["key"]["page"] = json!(page);
        });
    }
    refused(&key(), "account", "513 bytes", |value| {
        account(value)["key"]["page"] = json!(format!("https://example.com/{}", "a".repeat(493)));
    });
    accepted(&key(), "a static query", |value| {
        account(value)["key"]["page"] = json!("https://example.com/settings?tab=tokens");
    });
}

#[test]
fn oauth_client_and_flow() {
    for (client, case) in [
        (json!(""), "empty"),
        (json!("abc def"), "space"),
        (json!("é"), "not ASCII"),
        (json!("a".repeat(129)), "129 bytes"),
        (json!(3), "number"),
    ] {
        refused(&device(), "account", case, |value| {
            account(value)["oauth"]["clientId"] = client.clone();
        });
    }
    refused(&device(), "shape", "no clientId", |value| {
        account(value)["oauth"]
            .as_object_mut()
            .expect("oauth")
            .remove("clientId");
    });
    for field in ["clientSecret", "client", "user", "secret", "redirectUri"] {
        refused(&device(), "shape", field, |value| {
            account(value)["oauth"][field] = json!("x");
        });
    }
    refused(
        &device(),
        "account",
        "device flow without device",
        |value| {
            account(value)["oauth"]
                .as_object_mut()
                .expect("oauth")
                .remove("device");
        },
    );
    refused(
        &device(),
        "account",
        "device flow without verify",
        |value| {
            account(value)["oauth"]
                .as_object_mut()
                .expect("oauth")
                .remove("verify");
        },
    );
    refused(
        &device(),
        "account",
        "device flow with authorize",
        |value| {
            account(value)["oauth"]["authorize"] =
                json!("https://id.streamstats.example/oauth2/authorize");
        },
    );
    refused(
        &loopback(),
        "account",
        "loopback without authorize",
        |value| {
            account(value)["oauth"]
                .as_object_mut()
                .expect("oauth")
                .remove("authorize");
        },
    );
    refused(&loopback(), "account", "loopback with device", |value| {
        account(value)["oauth"]["device"] = json!("https://quests.example/oauth/device");
    });
    refused(&loopback(), "account", "loopback with verify", |value| {
        account(value)["oauth"]["verify"] = json!("https://quests.example/activate");
    });
    refused(&loopback(), "shape", "no token", |value| {
        account(value)["oauth"]
            .as_object_mut()
            .expect("oauth")
            .remove("token");
    });
    refused(&loopback(), "account", "unknown flow", |value| {
        account(value)["oauth"]["flow"] = json!("password");
    });
}

#[test]
fn oauth_endpoints_are_static_https() {
    for field in ["token", "device", "verify", "revoke", "validate"] {
        for url in [
            "http://id.twitch.tv/oauth2/x",
            "https://id.streamstats.example/oauth2/x?a=b",
            "https://id.streamstats.example/oauth2/x#f",
            "https://me@id.twitch.tv/oauth2/x",
            "https://10.0.0.1/oauth2/x",
            "https://id.streamstats.example",
        ] {
            refused(&device(), "account", &format!("{field} {url}"), |value| {
                account(value)["oauth"][field] = json!(url);
            });
        }
    }
    refused(&loopback(), "account", "authorize over http", |value| {
        account(value)["oauth"]["authorize"] = json!("http://quests.example/oauth/authorize");
    });
}

#[test]
fn oauth_scopes() {
    let many: Vec<Value> = (0..17)
        .map(|index| json!({"name": format!("scope{index}"), "access": "read"}))
        .collect();
    for (scopes, case) in [
        (json!([]), "none"),
        (json!(many), "17"),
        (
            json!([{"name": "a", "access": "read"}, {"name": "a", "access": "write"}]),
            "duplicate",
        ),
        (json!([{"name": "", "access": "read"}]), "empty name"),
        (json!([{"name": "a b", "access": "read"}]), "space"),
        (json!([{"name": "a\"b", "access": "read"}]), "quote"),
        (json!([{"name": "a\\b", "access": "read"}]), "backslash"),
        (
            json!([{"name": "x".repeat(129), "access": "read"}]),
            "129 bytes",
        ),
        (json!([{"name": "a", "access": "admin"}]), "access"),
    ] {
        refused(&device(), "account", case, |value| {
            account(value)["oauth"]["scopes"] = scopes.clone();
        });
    }
    refused(&device(), "shape", "scope without access", |value| {
        account(value)["oauth"]["scopes"] = json!([{"name": "a"}]);
    });
    for name in [
        "channel:read:stream_key",
        "StreamKey",
        "user:STREAM_KEY:read",
    ] {
        refused(&device(), "account_scope", name, |value| {
            account(value)["oauth"]["scopes"] = json!([{"name": name, "access": "read"}]);
        });
    }
}

#[test]
fn scope_param_and_client_id_header() {
    accepted(&device(), "scope", |value| {
        account(value)["oauth"]["scopeParam"] = json!("scope");
    });
    for param in ["Scope", "scp", ""] {
        refused(&device(), "account", param, |value| {
            account(value)["oauth"]["scopeParam"] = json!(param);
        });
    }
    for header in ["Authorization", "authorization", "Cookie", "Client Id"] {
        refused(&device(), "account", header, |value| {
            account(value)["oauth"]["clientIdHeader"] = json!(header);
        });
    }
}

#[test]
fn routes_name_the_declared_account() {
    refused(&key(), "network_rule", "an undeclared account", |value| {
        value["permissions"]["network"][0]["account"] = json!("stem");
    });
    refused(
        &key(),
        "network_rule",
        "an account that is not text",
        |value| {
            value["permissions"]["network"][0]["account"] = json!(3);
        },
    );
    refused(&key(), "network_rule", "no account declared", |value| {
        value["permissions"]
            .as_object_mut()
            .expect("permissions")
            .remove("accounts");
    });
}

#[test]
fn an_account_confines_the_network_to_its_origins() {
    refused(
        &key(),
        "account_origin",
        "a route without the account",
        |value| {
            value["permissions"]["network"][2]["origin"] = json!("https://cdn.example.org");
        },
    );
    refused(
        &key(),
        "account_origin",
        "a route with the account",
        |value| {
            value["permissions"]["network"][0]["origin"] = json!("https://api.example.org");
        },
    );
}

#[test]
fn an_account_excludes_sensitive_capabilities_and_the_clipboard() {
    refused(&key(), "sensitive_egress", "media.read", |value| {
        value["permissions"]["capabilities"] = json!(["media.read"]);
    });
    refused(&key(), "sensitive_egress", "the clipboard", |value| {
        value["permissions"]["clipboardWrite"] = json!(true);
    });
    refused(
        &key(),
        "sensitive_egress",
        "the clipboard without network",
        |value| {
            value["permissions"]["clipboardWrite"] = json!(true);
            value["permissions"]
                .as_object_mut()
                .expect("permissions")
                .remove("network");
        },
    );
    accepted(&key(), "a capability that is not sensitive", |value| {
        value["permissions"]["capabilities"] = json!(["fps.read"]);
    });
}

fn rule(path: &str, account: Option<&str>) -> Value {
    let mut rule = json!({
        "origin": "https://api.runlog.example",
        "method": "GET",
        "path": path,
    });
    let params: serde_json::Map<String, Value> = path
        .split('/')
        .filter_map(|segment| segment.strip_prefix('{')?.strip_suffix('}'))
        .map(|name| (name.to_owned(), json!({"type": "slug", "maxLength": 32})))
        .collect();
    if !params.is_empty() {
        rule["pathParams"] = Value::Object(params);
    }
    if let Some(account) = account {
        rule["account"] = json!(account);
    }
    rule
}

#[test]
fn overlapping_routes_carry_the_same_account() {
    for (first, second) in [
        ("/v1/{id}", "/v1/me"),
        ("/v1/{a}", "/v1/{b}"),
        ("/{a}/x", "/y/{b}"),
        ("/v1/{a}/", "/v1/me/"),
    ] {
        refused(
            &key(),
            "account_overlap",
            &format!("{first} {second}"),
            |value| {
                value["permissions"]["network"] =
                    json!([rule(first, Some("runlog")), rule(second, None)]);
            },
        );
        refused(
            &key(),
            "account_overlap",
            &format!("{second} {first}"),
            |value| {
                value["permissions"]["network"] =
                    json!([rule(first, None), rule(second, Some("runlog"))]);
            },
        );
        accepted(&key(), "same account", |value| {
            value["permissions"]["network"] =
                json!([rule(first, Some("runlog")), rule(second, Some("runlog"))]);
        });
    }
    for (first, second) in [
        ("/v1/me", "/v1/me/"),
        ("/v1/", "/v1/{x}"),
        ("/v1/a", "/v1/b"),
        ("/v1/{x}", "/v1/{x}/y"),
    ] {
        accepted(&key(), "no common URL", |value| {
            value["permissions"]["network"] =
                json!([rule(first, Some("runlog")), rule(second, None)]);
        });
    }
    accepted(&key(), "different methods", |value| {
        let mut post = rule("/v1/me", None);
        post["method"] = json!("POST");
        value["permissions"]["network"] = json!([rule("/v1/me", Some("runlog")), post]);
    });
    refused(
        &key(),
        "account_overlap",
        "query parameters do not separate",
        |value| {
            let mut with_query = rule("/v1/me", None);
            with_query["queryParams"] = json!({"a": {"type": "slug", "maxLength": 4}});
            value["permissions"]["network"] = json!([rule("/v1/me", Some("runlog")), with_query]);
        },
    );
}

#[test]
fn routes_never_target_an_oauth_endpoint() {
    for endpoint in [
        "https://id.streamstats.example/oauth2/token",
        "https://id.streamstats.example/oauth2/device",
        "https://id.streamstats.example/oauth2/revoke",
        "https://id.streamstats.example/oauth2/validate",
        "https://streamstats.example/activate",
    ] {
        let (origin, path) = endpoint
            .strip_prefix("https://")
            .and_then(|rest| rest.split_once('/'))
            .map(|(host, path)| (format!("https://{host}"), format!("/{path}")))
            .expect("url");
        for method in ["GET", "POST"] {
            refused(
                &device(),
                "account_endpoint",
                &format!("{method} {endpoint}"),
                |value| {
                    let origins = account(value)["origins"].as_array_mut().expect("origins");
                    if !origins.contains(&json!(origin)) {
                        origins.push(json!(origin));
                    }
                    value["permissions"]["network"]
                        .as_array_mut()
                        .expect("rules")
                        .push(json!({
                            "origin": origin,
                            "method": method,
                            "path": path,
                            "account": "twitch-api"
                        }));
                },
            );
        }
    }
    refused(
        &device(),
        "account_endpoint",
        "a parameter covers the endpoint",
        |value| {
            value["permissions"]["network"]
                .as_array_mut()
                .expect("rules")
                .push(json!({
                    "origin": "https://id.streamstats.example",
                    "method": "GET",
                    "path": "/oauth2/{step}",
                    "pathParams": {"step": {"type": "enum", "values": ["keys"]}}
                }));
        },
    );
    refused(
        &loopback(),
        "account_endpoint",
        "the authorization endpoint",
        |value| {
            account(value)["origins"] = json!([
                "https://api.quests.example",
                "https://img.quests.example",
                "https://quests.example"
            ]);
            value["permissions"]["network"]
                .as_array_mut()
                .expect("rules")
                .push(json!({
                    "origin": "https://quests.example",
                    "method": "GET",
                    "path": "/oauth/authorize"
                }));
        },
    );
    accepted(&device(), "the same path on another origin", |value| {
        value["permissions"]["network"]
            .as_array_mut()
            .expect("rules")
            .push(json!({
                "origin": "https://api.streamstats.example",
                "method": "GET",
                "path": "/oauth2/token",
                "account": "twitch-api"
            }));
    });
}

#[test]
fn any_change_of_the_declaration_widens() {
    let before = validate(&key()).expect("valid").permissions;
    let mut changed = key();
    account(&mut changed)["origins"] = json!(["https://api.runlog.example"]);
    changed["permissions"]["network"]
        .as_array_mut()
        .expect("rules")
        .truncate(2);
    let after = validate(&changed).expect("valid").permissions;
    assert!(after.widens(&before), "another declaration is a new item");
    let mut without = key();
    without["permissions"] = json!({"storage": true});
    let without = validate(&without).expect("valid").permissions;
    assert!(before.widens(&without), "adding the account widens");
    assert!(!without.widens(&before), "removing it does not");
}

#[test]
fn endpoints_that_receive_a_secret_are_on_the_accounts_origins() {
    // The host sends the code and PKCE verifier to `token`, tokens to
    // `revoke` and `validate`: a publisher's server there would get them.
    for field in ["token", "device", "revoke", "validate"] {
        refused(&device(), "account", field, |value| {
            account(value)["oauth"][field] = json!("https://login.nova.example/oauth2/x");
        });
    }
    refused(&loopback(), "account", "loopback token", |value| {
        account(value)["oauth"]["token"] = json!("https://tokens.nova.example/token");
    });
    // The pages the browser opens receive nothing from the host.
    accepted(&loopback(), "authorize on another origin", |value| {
        account(value)["oauth"]["authorize"] = json!("https://auth.quests.example/authorize");
    });
    accepted(&device(), "verify on another origin", |value| {
        account(value)["oauth"]["verify"] = json!("https://activate.example/code");
    });
}

#[test]
fn a_route_reaches_an_endpoint_whatever_its_case_or_final_slash() {
    // A service may serve `/OAuth2/Token/` as its token endpoint.
    for path in ["/OAuth2/Token", "/oauth2/token/", "/OAUTH2/{step}/"] {
        refused(&device(), "account_endpoint", path, |value| {
            let mut rule = json!({
                "origin": "https://id.streamstats.example",
                "method": "POST",
                "path": path,
                "account": "twitch-api"
            });
            if path.contains('{') {
                rule["pathParams"] = json!({"step": {"type": "slug", "maxLength": 16}});
            }
            value["permissions"]["network"]
                .as_array_mut()
                .expect("rules")
                .push(rule);
        });
    }
}

#[test]
fn stream_key_scopes_are_refused_in_any_spelling() {
    for name in [
        "channel:read:stream-key",
        "Stream.Key",
        "stream:key",
        "streamKey",
        "read_STREAM__KEY",
    ] {
        refused(&device(), "account_scope", name, |value| {
            account(value)["oauth"]["scopes"] = json!([{"name": name, "access": "read"}]);
        });
    }
}

#[test]
fn account_services_need_a_declared_and_granted_account() {
    use overcrow_widget_schema::results::shape;
    use overcrow_widget_schema::services::{Requirement, SERVICE_ERRORS, SERVICES, ServiceKind};
    let service = |name: &str| {
        SERVICES
            .iter()
            .find(|service| service.name == name)
            .unwrap_or_else(|| panic!("{name} is a service"))
    };
    let subscribe = service("account.subscribe");
    assert_eq!(subscribe.requires, Requirement::Account);
    assert_eq!(subscribe.kind, ServiceKind::Subscribe);
    assert!(!subscribe.gesture);
    let connect = service("account.connect");
    assert_eq!(connect.requires, Requirement::Account);
    assert_eq!(connect.kind, ServiceKind::Call);
    assert!(connect.gesture, "the panel opens on a click only");
    for service in [subscribe, connect] {
        assert_eq!(service.params.len(), 1);
        assert_eq!(service.params[0].name, "id");
        assert!(service.params[0].required);
    }
    assert!(SERVICE_ERRORS.contains(&"account_refused"));
    let status = shape("AccountStatus").expect("named shape");
    for state in ["signed_out", "pending", "connected", "refused", "expired"] {
        assert!(status.shape.matches(&json!({ "state": state })), "{state}");
    }
    assert!(!status.shape.matches(&json!({"state": "offline"})));
    assert!(
        !status
            .shape
            .matches(&json!({"state": "connected", "name": "me"}))
    );
}

#[test]
fn scope_names_and_client_ids_read_the_same_everywhere() {
    // A service decodes `%XX` and splits on `+` or `,`: such a name would
    // request another scope than the one reviewed, or hide `stream_key`.
    for name in [
        "channel:read:stream%5Fkey",
        "user:read+channel:read:stream_key",
        "user:read,admin",
        "a&scope=admin",
        "a=b",
        "a?b",
        "a#b",
        "a;b",
        "é",
    ] {
        refused(&device(), "account", name, |value| {
            account(value)["oauth"]["scopes"] = json!([{"name": name, "access": "read"}]);
        });
    }
    accepted(&device(), "a URL scope", |value| {
        account(value)["oauth"]["scopes"] = json!([
            {"name": "https://www.example.com/auth/read.only", "access": "read"},
            {"name": "user-read_private", "access": "read"}
        ]);
    });
    for client in ["abc&scope=admin", "abc%26", "abc+def", "abc/def", "abc:def"] {
        refused(&device(), "account", client, |value| {
            account(value)["oauth"]["clientId"] = json!(client);
        });
    }
    accepted(&device(), "a dotted client ID", |value| {
        account(value)["oauth"]["clientId"] = json!("123-abc.apps.example~x_y");
    });
}

#[test]
fn a_stream_key_scope_is_named_only_when_nothing_else_is_wrong() {
    refused(
        &device(),
        "account",
        "with a token outside origins",
        |value| {
            account(value)["oauth"]["scopes"] =
                json!([{"name": "channel:read:stream_key", "access": "read"}]);
            account(value)["oauth"]["token"] = json!("https://login.nova.example/token");
        },
    );
    refused(
        &device(),
        "account",
        "with an invalid validate endpoint",
        |value| {
            account(value)["oauth"]["scopes"] =
                json!([{"name": "channel:read:stream_key", "access": "read"}]);
            account(value)["oauth"]["validate"] = json!("http://id.twitch.tv/oauth2/validate");
        },
    );
}

#[test]
fn more_headers_the_broker_or_the_connection_owns_are_refused() {
    for header in [
        "Http2-Settings",
        "Cookie2",
        "Max-Forwards",
        "Alt-Used",
        "Early-Data",
        "Priority",
        "X-Forwarded",
    ] {
        refused(&key(), "account", header, |value| {
            account(value)["send"] = json!({ "header": header });
        });
    }
}

#[test]
fn a_route_reaches_an_endpoint_through_a_format_suffix() {
    for path in ["/oauth2/token.json", "/OAuth2/Token.XML"] {
        refused(&device(), "account_endpoint", path, |value| {
            value["permissions"]["network"]
                .as_array_mut()
                .expect("rules")
                .push(json!({
                    "origin": "https://id.streamstats.example",
                    "method": "POST",
                    "path": path,
                    "account": "twitch-api"
                }));
        });
    }
}
