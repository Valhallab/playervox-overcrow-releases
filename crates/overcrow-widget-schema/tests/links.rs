//! Links a widget opens in the user's browser: `permissions.links` and
//! `links.open`. Every refused declaration is a case; the addresses a rule
//! lets through are checked by `link_allowed`, which the host and the test
//! runtime call on the path their URL parser gives.

use overcrow_widget_schema::catalog_v2::KNOWN_FEATURES;
use overcrow_widget_schema::limits::MAX_LINK_RULES;
use overcrow_widget_schema::links::{
    FEATURE_OPEN_LINKS, LinkRule, canonical_link_path, link_allowed,
};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::permissions::{SensitiveRule, permission};
use overcrow_widget_schema::services::{Requirement, ServiceKind, service};
use serde_json::{Value, json};

fn base(permissions: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.run-log",
        "version": "1.0.0",
        "name": {"en": "Run log", "fr": "Journal de course"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 200, "height": 100},
            "min": {"width": 100, "height": 50},
            "max": {"width": 400, "height": 200}
        },
        "permissions": permissions
    })
}

fn links(rules: Value) -> Value {
    base(json!({ "links": rules }))
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

fn rule(origin: &str, prefix: &str) -> LinkRule {
    LinkRule {
        origin: origin.to_owned(),
        path_prefix: prefix.to_owned(),
    }
}

#[test]
fn a_rule_is_an_origin_and_an_optional_path_prefix() {
    let manifest = validate(&links(json!([
        {"origin": "https://runlog.example", "pathPrefix": "/runs/"},
        {"origin": "https://help.runlog.example"},
        {"origin": "https://runlog.example:8443", "pathPrefix": "/settings"}
    ])))
    .expect("valid");
    assert_eq!(
        manifest.permissions.links,
        [
            rule("https://help.runlog.example", "/"),
            rule("https://runlog.example", "/runs/"),
            rule("https://runlog.example:8443", "/settings"),
        ]
        .into_iter()
        .collect()
    );
    assert!(manifest.features().contains(FEATURE_OPEN_LINKS));
    assert!(KNOWN_FEATURES.contains(&FEATURE_OPEN_LINKS));
    // Without links, no feature.
    let plain = validate(&base(json!({"storage": true}))).expect("valid");
    assert!(plain.permissions.links.is_empty());
    assert!(!plain.features().contains(FEATURE_OPEN_LINKS));
}

#[test]
fn refused_rules() {
    let too_many: Vec<Value> = (0..=MAX_LINK_RULES.value)
        .map(|index| json!({"origin": format!("https://site{index}.example")}))
        .collect();
    for (rules, error) in [
        // Only canonical HTTPS origins, as the network rules take them.
        (json!([{"origin": "http://runlog.example"}]), "link_rule"),
        (json!([{"origin": "https://RunLog.example"}]), "link_rule"),
        (json!([{"origin": "https://runlog.example/"}]), "link_rule"),
        (
            json!([{"origin": "https://user@runlog.example"}]),
            "link_rule",
        ),
        (json!([{"origin": "https://127.0.0.1"}]), "link_rule"),
        (json!([{"origin": "https://localhost"}]), "link_rule"),
        (
            json!([{"origin": "https://runlog.example:443"}]),
            "link_rule",
        ),
        // A prefix of literal segments, from `/`.
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": ""}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "runs"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a//b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a/../b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a/%2e%2e/b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a?b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a#b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/a\\b"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": format!("/{}", "a".repeat(256))}]),
            "link_rule",
        ),
        // The same rule twice, or one that another covers: the list the
        // reviewer reads says exactly what the widget opens.
        (
            json!([{"origin": "https://runlog.example"}, {"origin": "https://runlog.example", "pathPrefix": "/"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/runs/"},
                   {"origin": "https://runlog.example", "pathPrefix": "/runs/best"}]),
            "link_rule",
        ),
        (
            json!([{"origin": "https://runlog.example", "pathPrefix": "/runs"},
                   {"origin": "https://runlog.example", "pathPrefix": "/runs/"}]),
            "link_rule",
        ),
        (Value::Array(too_many), "link_rule"),
        // Not a list, or a rule of another shape.
        (json!({"origin": "https://runlog.example"}), "shape"),
        (
            json!([{"origin": "https://runlog.example", "path": "/"}]),
            "shape",
        ),
        (json!(["https://runlog.example"]), "shape"),
    ] {
        assert_eq!(
            validate(&links(rules.clone())).err(),
            Some(error),
            "{rules}"
        );
    }
    // Distinct prefixes that do not cover each other are fine.
    validate(&links(json!([
        {"origin": "https://runlog.example", "pathPrefix": "/runs"},
        {"origin": "https://runlog.example", "pathPrefix": "/runs-archive/"}
    ])))
    .expect("distinct");
}

#[test]
fn a_link_carries_no_sensitive_data_away() {
    // The address of a page is data that leaves the computer: a widget
    // that reads sensitive data opens no link, as it reaches no network.
    let error = validate(&base(json!({
        "links": [{"origin": "https://runlog.example"}],
        "capabilities": ["journal.read"]
    })));
    assert_eq!(error.err(), Some("sensitive_egress"));
    let rule = permission("links").expect("links permission");
    assert_eq!(rule.with_sensitive, SensitiveRule::Forbidden);
    validate(&base(json!({
        "links": [{"origin": "https://runlog.example"}],
        "capabilities": ["telemetry.read"]
    })))
    .expect("not sensitive");
}

#[test]
fn with_an_account_links_stay_on_its_service() {
    // An integrated service: only the pages PlayerVox lists for it, never
    // a redirector that would carry the account's data to another site.
    let steam = |origin: &str, prefix: &str| {
        base(json!({
            "accounts": [{"service": "steam"}],
            "network": [{
                "origin": "https://api.steampowered.com",
                "method": "GET",
                "path": "/ISteamUser/GetPlayerSummaries/v2/",
                "account": "steam"
            }],
            "links": [{"origin": origin, "pathPrefix": prefix}]
        }))
    };
    validate(&steam("https://steamcommunity.com", "/my/edit/")).expect("privacy settings");
    validate(&steam("https://steamcommunity.com", "/my/")).expect("the player's profile");
    validate(&steam("https://store.steampowered.com", "/app/")).expect("a store page");
    for (origin, prefix) in [
        // Steam's redirector to any address.
        ("https://steamcommunity.com", "/linkfilter/"),
        // The whole site would include it.
        ("https://steamcommunity.com", "/"),
        ("https://store.steampowered.com", "/login/"),
        // Another host under a Steam domain, or another site.
        ("https://partner.steampowered.com", "/"),
        ("https://steamcommunity.com:8443", "/my/"),
        ("https://runlog.example", "/my/"),
        ("https://steamcommunity.com.runlog.example", "/my/"),
    ] {
        assert_eq!(
            validate(&steam(origin, prefix)).err(),
            Some("account_link"),
            "{origin}{prefix}"
        );
    }
    // A declared account: the exact origins of its routes and of its key
    // page, port included.
    let declared = |origin: &str| {
        base(json!({
            "accounts": [{
                "id": "runlog",
                "name": "Run Log",
                "mode": "key",
                "origins": ["https://api.runlog.example"],
                "send": {"header": "X-Key"},
                "key": {
                    "format": {"charset": "hex", "minLength": 32, "maxLength": 32},
                    "page": "https://runlog.example/settings/api"
                }
            }],
            "links": [{"origin": origin}]
        }))
    };
    validate(&declared("https://runlog.example")).expect("the key page's origin");
    validate(&declared("https://api.runlog.example")).expect("an origin");
    for origin in [
        "https://other.example",
        "https://www.runlog.example",
        "https://runlog.example:8443",
        "https://api.runlog.example:8443",
    ] {
        assert_eq!(
            validate(&declared(origin)).err(),
            Some("account_link"),
            "{origin}"
        );
    }
}

#[test]
fn new_links_widen_the_permissions() {
    let one = validate(&links(
        json!([{"origin": "https://runlog.example", "pathPrefix": "/runs/"}]),
    ))
    .expect("valid");
    let two = validate(&links(json!([
        {"origin": "https://runlog.example", "pathPrefix": "/runs/"},
        {"origin": "https://help.runlog.example"}
    ])))
    .expect("valid");
    let wider = validate(&links(json!([{"origin": "https://runlog.example"}]))).expect("valid");
    assert!(two.permissions.widens(&one.permissions));
    assert!(!one.permissions.widens(&two.permissions));
    assert!(wider.permissions.widens(&one.permissions));
}

#[test]
fn link_allowed_matches_whole_segments_of_canonical_paths() {
    let rules = [
        rule("https://runlog.example", "/runs/"),
        rule("https://runlog.example", "/app"),
        rule("https://help.runlog.example", "/"),
        rule("https://runlog.example:8443", "/settings"),
    ];
    let allowed = |origin: &str, path: &str| link_allowed(&rules, origin, path).is_some();
    assert!(allowed("https://runlog.example", "/runs/"));
    assert!(allowed("https://runlog.example", "/runs/42"));
    assert!(allowed("https://runlog.example", "/runs/42/splits/"));
    assert!(!allowed("https://runlog.example", "/runs"));
    assert!(!allowed("https://runlog.example", "/Runs/42"));
    assert!(allowed("https://runlog.example", "/app"));
    assert!(allowed("https://runlog.example", "/app/570"));
    assert!(!allowed("https://runlog.example", "/apps"));
    assert!(!allowed("https://runlog.example", "/"));
    assert!(allowed("https://help.runlog.example", "/"));
    assert!(allowed("https://help.runlog.example", "/faq/linking"));
    assert!(allowed("https://runlog.example:8443", "/settings/privacy"));
    assert!(!allowed("https://runlog.example", "/settings"));
    // Another origin: another host, scheme or port.
    assert!(!allowed("https://evil.example", "/runs/1"));
    assert!(!allowed("http://runlog.example", "/runs/1"));
    assert!(!allowed("https://runlog.example:444", "/runs/1"));
    // A path the URL parser would not give, or with encoded or dot
    // segments, is never allowed: the host refuses it as `url_invalid`.
    for path in [
        "",
        "runs/1",
        "/runs//1",
        "/runs/../app",
        "/runs/./1",
        "/runs/%2e%2e/app",
        "/runs/a%20b",
        "/runs/1?x",
        "/runs/1#x",
        "/runs\\1",
    ] {
        assert!(!canonical_link_path(path), "{path}");
        assert!(!allowed("https://runlog.example", path), "{path}");
    }
    assert!(canonical_link_path("/"));
    assert!(canonical_link_path("/runs/42/"));
    assert!(canonical_link_path("/app/570/Dota_2~x.y-z"));
}

#[test]
fn links_open_is_a_confirmed_gesture_call() {
    let open = service("links.open").expect("links.open");
    assert_eq!(open.requires, Requirement::Permission("links"));
    assert_eq!(open.kind, ServiceKind::Call);
    assert!(open.gesture, "a link opens only on the user's click");
    assert!(open.confirm, "the host asks the user");
    assert_eq!(open.params.len(), 1);
    assert_eq!(open.params[0].name, "url");
    assert!(open.params[0].required);
}
