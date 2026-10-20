//! `admit`'s review hints through the binary: warnings that point the
//! maintainer at an account or a route, each with its JSON pointer, that
//! refuse nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Value, json};

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(args)
        .output()
        .expect("the CLI runs")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

fn path(path: &Path) -> &str {
    path.to_str().expect("UTF-8 path")
}

/// A counter project of `nova` whose permissions are `permissions`.
fn project(permissions: Value) -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = temporary.path().join("widget");
    let output = cli(&[
        "init",
        path(&root),
        "--template",
        "counter",
        "--id",
        "nova.counter",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let file = root.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(&file).expect("manifest")).expect("JSON manifest");
    manifest["permissions"] = permissions;
    fs::write(&file, manifest.to_string()).expect("manifest");
    let listing = json!({
        "author": "Example",
        "spdxLicense": "MIT",
        "sourceUrl": "https://github.com/example/counter",
        "defaultLocale": "en",
        "localizations": [{"locale": "en", "name": "Counter", "description": "Counts."}]
    });
    fs::write(root.join("listing.json"), listing.to_string()).expect("listing");
    (temporary, root)
}

/// The JSON report of `admit`, which must admit the widget.
fn admit(permissions: Value) -> Value {
    let (_temporary, root) = project(permissions);
    let output = cli(&[
        "admit",
        path(&root),
        "--publisher",
        "nova",
        "--format",
        "json",
    ]);
    let report: Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("one JSON report: {}", text(&output.stdout)));
    assert_eq!(
        output.status.code(),
        Some(0),
        "a hint refuses nothing: {report}"
    );
    report
}

/// `(code, pointer)` of every `review.*` warning.
fn hints(report: &Value) -> Vec<(String, String)> {
    report["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .filter(|diagnostic| {
            diagnostic["code"]
                .as_str()
                .is_some_and(|code| code.starts_with("review."))
        })
        .map(|diagnostic| {
            assert_eq!(diagnostic["severity"], "warning", "{diagnostic}");
            assert_eq!(diagnostic["file"], "manifest.json", "{diagnostic}");
            assert!(diagnostic["help"].is_string(), "{diagnostic}");
            (
                diagnostic["code"].as_str().unwrap_or_default().to_owned(),
                diagnostic["pointer"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect()
}

/// The message of the first warning `code`.
fn message(report: &Value, code: &str) -> String {
    report["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|diagnostic| diagnostic["code"] == code)
        .and_then(|diagnostic| diagnostic["message"].as_str())
        .unwrap_or_default()
        .to_owned()
}

fn hint(code: &str, pointer: &str) -> (String, String) {
    (code.to_owned(), pointer.to_owned())
}

/// A declared key account `tracker` with one route.
fn tracker(account: impl FnOnce(&mut Value)) -> Value {
    let mut declared = json!({
        "id": "tracker",
        "name": "Achievement Tracker",
        "mode": "key",
        "origins": ["https://api.tracker.example"],
        "send": {"header": "X-Key"},
        "key": {
            "format": {"charset": "alnum", "minLength": 40, "maxLength": 64},
            "page": "https://get.tracker.example/key"
        }
    });
    account(&mut declared);
    json!({
        "accounts": [declared],
        "network": [{
            "origin": "https://api.tracker.example",
            "method": "GET",
            "path": "/v1/sync",
            "account": "tracker"
        }]
    })
}

#[test]
fn a_plain_declared_account_has_no_hint() {
    assert_eq!(hints(&admit(tracker(|_| {}))), []);
}

/// I1: a declared account that asks for a key shaped like a Steam key, or
/// whose key page leads elsewhere, can harvest the player's real key.
#[test]
fn a_key_that_reads_as_a_services_is_pointed_at() {
    let account = "/permissions/accounts/0";
    for format in [
        json!({"charset": "hex", "minLength": 32, "maxLength": 32}),
        json!({"charset": "hex", "minLength": 16, "maxLength": 64}),
        // A wider charset holds hex: it accepts a Steam key too.
        json!({"charset": "alnum", "minLength": 32, "maxLength": 32}),
        json!({"charset": "printable", "minLength": 16, "maxLength": 128}),
    ] {
        let report = admit(tracker(|declared| {
            declared["key"]["format"] = format.clone()
        }));
        assert_eq!(
            hints(&report),
            [hint("review.service_key_format", account)],
            "{format}"
        );
        let message = message(&report, "review.service_key_format");
        assert!(
            message.contains("Steam keys (32 hex characters)"),
            "{message}"
        );
    }
    // A format that cannot hold a Steam key.
    for format in [
        json!({"charset": "hex", "minLength": 40, "maxLength": 40}),
        json!({"charset": "alnum", "minLength": 33, "maxLength": 64}),
    ] {
        let report = admit(tracker(|declared| {
            declared["key"]["format"] = format.clone()
        }));
        assert_eq!(hints(&report), [], "{format}");
    }
    for page in [
        "https://www.google.com/url?q=https%3A%2F%2Fsteamcommunity.com%2Fdev%2Fapikey",
        "https://get.tracker.example/go?to=steamcommunity.com",
        "https://get.tracker.example/go?u=%252F%252Fexample.com",
        "https://get.tracker.example/go?u=bit.ly%2Fabc",
    ] {
        let report = admit(tracker(|declared| declared["key"]["page"] = json!(page)));
        assert_eq!(
            hints(&report),
            [hint("review.address_in_key_page", account)],
            "{page}"
        );
    }
    let report = admit(tracker(|declared| {
        declared["key"]["page"] = json!("https://get.tracker.example/key?tab=api-keys&v=2")
    }));
    assert_eq!(hints(&report), [], "a plain static query");
    for (origin, page) in [
        (
            "https://api.steam-tracker.example",
            "https://get.tracker.example/key",
        ),
        (
            "https://api.tracker.example",
            "https://st3am-keys.example/key",
        ),
        (
            "https://api.tracker.example",
            "https://valve.tracker.example/key",
        ),
        (
            "https://api.tw1tch-tools.example",
            "https://get.tracker.example/key",
        ),
    ] {
        let mut permissions = tracker(|declared| {
            declared["origins"] = json!([origin]);
            declared["key"]["page"] = json!(page);
        });
        permissions["network"][0]["origin"] = json!(origin);
        let report = admit(permissions);
        assert_eq!(
            hints(&report),
            [hint("review.service_name_in_host", account)],
            "{origin} {page}"
        );
    }
}

/// m17: a name that imitates the host's own labels.
#[test]
fn a_name_that_imitates_a_host_label_is_pointed_at() {
    for name in [
        "Arena (service intégré)",
        "Arena (integrated service)",
        "Arena Official",
        "Arena officiel",
        "Arena verified",
        "Arena ✓",
        "Arena built-in",
    ] {
        let report = admit(tracker(|declared| declared["name"] = json!(name)));
        assert_eq!(
            hints(&report),
            [hint("review.service_label_name", "/permissions/accounts/0")],
            "{name}"
        );
    }
}

/// I2 and I3: what the review may hide behind one route.
#[test]
fn rules_on_one_route_and_names_in_both_tables_are_pointed_at() {
    let wide = json!({
        "origin": "https://api.tracker.example",
        "method": "GET",
        "path": "/v1/me/{section}",
        "pathParams": {"section": {"type": "slug", "maxLength": 32}},
        "queryParams": {"fields": {"type": "string", "maxLength": 256}},
        "maxResponseBytes": 3_145_728,
        "account": "tracker"
    });
    let mut narrow = wide.clone();
    narrow["pathParams"]["section"] = json!({"type": "enum", "values": ["runs", "stats"]});
    narrow.as_object_mut().unwrap().remove("queryParams");
    narrow["maxResponseBytes"] = json!(4096);
    let mut permissions = tracker(|_| {});
    permissions["network"] = json!([narrow, {
        "origin": "https://api.tracker.example", "method": "GET", "path": "/v1/sync",
        "account": "tracker"
    }, wide]);
    let report = admit(permissions.clone());
    assert_eq!(
        hints(&report),
        [hint("review.same_route", "/permissions/network/2")]
    );
    let message = message(&report, "review.same_route");
    assert!(message.contains("network[0]"), "{message}");

    let mut both = tracker(|_| {});
    both["network"] = json!([{
        "origin": "https://api.tracker.example",
        "method": "GET",
        "path": "/v1/me/{section}",
        "pathParams": {"section": {"type": "slug", "maxLength": 32}},
        "queryParams": {"section": {"type": "enum", "values": ["runs", "stats"]}},
        "account": "tracker"
    }]);
    assert_eq!(
        hints(&admit(both)),
        [hint("review.path_and_query_name", "/permissions/network/0")]
    );
}

/// m15: a route that may return keys or tokens, by its folded path, its
/// parameter names or its `enum` values.
#[test]
fn a_route_that_may_return_secrets_is_pointed_at() {
    let route = |path: &str, params: Value| {
        let mut permissions = tracker(|_| {});
        let mut rule = json!({
            "origin": "https://api.tracker.example",
            "method": "GET",
            "path": path,
            "account": "tracker"
        });
        for (name, value) in params.as_object().into_iter().flatten() {
            rule[name] = value.clone();
        }
        permissions["network"] = json!([rule]);
        permissions
    };
    for (path, params) in [
        ("/v1/streamkey", json!({})),
        ("/v1/stream_key", json!({})),
        ("/v1/accesstoken", json!({})),
        ("/v1/Access-Tokens/list", json!({})),
        ("/v1/me/keys", json!({})),
        ("/v1/api/keys", json!({})),
        (
            "/v1/me/{section}",
            json!({"pathParams": {"section": {"type": "enum", "values": ["runs", "tokens"]}}}),
        ),
        (
            "/v1/{kind}/keys",
            json!({"pathParams": {"kind": {"type": "enum", "values": ["api"]}}}),
        ),
        (
            "/v1/me",
            json!({"queryParams": {"include_secret": {"type": "enum", "values": ["no"]}}}),
        ),
        // Only the value in its place makes the compound (`accesstoken`).
        (
            "/v1/access/{part}",
            json!({"pathParams": {"part": {"type": "enum", "values": ["tokenset"]}}}),
        ),
        (
            "/v1/me",
            json!({"queryParams": {"fields": {"type": "enum", "values": ["password"]}}}),
        ),
    ] {
        let report = admit(route(path, params.clone()));
        assert_eq!(
            hints(&report),
            [hint("review.secret_route", "/permissions/network/0")],
            "{path} {params}"
        );
        // An account route says that it carries the secret too.
        let message = message(&report, "review.secret_route");
        assert!(
            message.contains("carries the account's secret"),
            "{message}"
        );
        let network = report["review"]
            .as_array()
            .expect("review")
            .iter()
            .find(|item| item["kind"] == "network")
            .expect("network item");
        assert_eq!(network["secretHint"], true, "{path}");
    }
    for path in ["/v1/sync", "/v1/hotkeys", "/v1/monkey/runs", "/v1/keyboard"] {
        let report = admit(route(path, json!({})));
        assert_eq!(hints(&report), [], "{path}");
        let network = report["review"]
            .as_array()
            .expect("review")
            .iter()
            .find(|item| item["kind"] == "network")
            .expect("network item");
        assert!(
            network.get("secretHint").is_none(),
            "{path}: absent when false"
        );
    }
    // Without an account, the route is still pointed at.
    let report = admit(json!({"network": [{
        "origin": "https://api.example.com", "method": "GET", "path": "/oauth2/token"
    }]}));
    assert_eq!(
        hints(&report),
        [hint("review.secret_route", "/permissions/network/0")]
    );
    let message = message(&report, "review.secret_route");
    assert!(!message.contains("carries"), "{message}");
}

/// An integrated service is PlayerVox's definition: no account hint.
#[test]
fn an_integrated_service_has_no_account_hint() {
    let report = admit(json!({
        "accounts": [{"service": "steam"}],
        "network": [{
            "origin": "https://api.steampowered.com",
            "method": "GET",
            "path": "/ISteamUser/GetPlayerSummaries/v2/",
            "queryParams": {"steamids": {"type": "slug", "maxLength": 17, "required": true}},
            "account": "steam"
        }]
    }));
    assert_eq!(hints(&report), []);
}

/// m16: the human review shows the parameters, `required` and the key
/// format; a hint shows where it points.
#[test]
fn the_human_review_shows_parameters_required_and_the_key_format() {
    let mut permissions = tracker(|declared| {
        declared["required"] = json!(false);
        declared["key"]["format"] = json!({"charset": "hex", "minLength": 32, "maxLength": 32});
    });
    permissions["network"] = json!([{
        "origin": "https://api.tracker.example",
        "method": "GET",
        "path": "/v1/me/{section}/{icon}",
        "pathParams": {
            "section": {"type": "enum", "values": ["runs", "stats"]},
            "icon": {"type": "file", "maxLength": 64, "extensions": ["png", "jpg"]}
        },
        "queryParams": {
            "fields": {"type": "string", "maxLength": 256},
            "page": {"type": "integer", "min": 1, "max": 99, "required": true},
            "player": {"type": "slug", "maxLength": 17}
        },
        "account": "tracker"
    }]);
    let (_temporary, root) = project(permissions);
    let output = cli(&["admit", path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    let shown = text(&output.stdout);
    for line in [
        "key of 32 hex characters, in header X-Key, from https://get.tracker.example/key",
        "optional: the widget works without it",
        "path   section: one of runs, stats",
        "path   icon: a file name of at most 64 bytes ending in .png or .jpg",
        "query  fields: text of at most 256 bytes, optional",
        "query  page: an integer from 1 to 99, required",
        "query  player: a slug of at most 17 bytes, optional",
    ] {
        assert!(shown.contains(line), "{line}\n{shown}");
    }
    let warnings = text(&output.stderr);
    assert!(
        warnings.contains("warning[review.service_key_format]")
            && warnings.contains("--> manifest.json /permissions/accounts/0"),
        "{warnings}"
    );
}
