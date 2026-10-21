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
    // Routes a service is known to answer secrets on, whatever their words
    // (the table the MCP audit reads too): YouTube's live streams give
    // their ingestion key.
    for (origin, path) in [
        ("https://www.googleapis.com", "/youtube/v3/liveStreams"),
        ("https://youtube.googleapis.com", "/youtube/v3/livestreams"),
        ("https://api.twitch.tv", "/helix/streams/key"),
    ] {
        let report = admit(json!({"network": [{
            "origin": origin, "method": "GET", "path": path
        }]}));
        assert_eq!(
            hints(&report),
            [hint("review.secret_route", "/permissions/network/0")],
            "{origin}{path}"
        );
    }
    // Whatever the rule lets the widget write there: an `enum` that holds
    // the known segment, a free parameter, a final slash.
    for rule in [
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/v3/{resource}",
            "pathParams": {"resource": {"type": "enum", "values": ["videos", "liveStreams"]}}}),
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/v3/{resource}",
            "pathParams": {"resource": {"type": "slug", "maxLength": 32}}}),
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/{version}/liveStreams",
            "pathParams": {"version": {"type": "slug", "maxLength": 8}}}),
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/v3/liveStreams/"}),
    ] {
        let report = admit(json!({"network": [rule.clone()]}));
        assert_eq!(
            hints(&report),
            [hint("review.secret_route", "/permissions/network/0")],
            "{rule}"
        );
    }
    for rule in [
        json!({"origin": "https://www.googleapis.com", "method": "GET", "path": "/youtube/v3/videos"}),
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/v3/{resource}",
            "pathParams": {"resource": {"type": "enum", "values": ["videos", "channels"]}}}),
        json!({"origin": "https://www.googleapis.com", "method": "GET",
            "path": "/youtube/v3/{n}",
            "pathParams": {"n": {"type": "integer", "min": 1, "max": 9}}}),
    ] {
        let report = admit(json!({"network": [rule.clone()]}));
        assert_eq!(hints(&report), [], "{rule}");
    }
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

/// A declared OAuth account `quests`: the browser (`loopback`) or a device
/// code, its token endpoint on the account's origin.
fn quests(flow: &str, change: impl FnOnce(&mut Value)) -> Value {
    let mut oauth = json!({
        "clientId": "nova-quest-log",
        "flow": flow,
        "token": "https://api.quests.example/oauth/token",
        "scopes": [
            {"name": "quests:read", "access": "read"},
            {"name": "quests:track", "access": "write"}
        ]
    });
    if flow == "loopback" {
        oauth["authorize"] = json!("https://auth.quests.example/oauth/authorize");
    } else {
        oauth["device"] = json!("https://api.quests.example/oauth/device");
        oauth["verify"] = json!("https://quests.example/device");
    }
    let mut declared = json!({
        "id": "quests",
        "name": "Quest Log",
        "mode": "oauth",
        "origins": ["https://api.quests.example"],
        "oauth": oauth
    });
    change(&mut declared);
    json!({
        "accounts": [declared],
        "network": [{
            "origin": "https://api.quests.example",
            "method": "GET",
            "path": "/v1/me/quests",
            "account": "quests"
        }]
    })
}

/// The help of a review hint `code`.
fn help(report: &Value, code: &str) -> String {
    report["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|diagnostic| diagnostic["code"] == code)
        .and_then(|diagnostic| diagnostic["help"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// A page of a declared OAuth account (`authorize` or `verify`) may
/// redirect elsewhere, to an integrated service or a large provider, while
/// its `token` relays: the reviewer signs in and notes where each page
/// ends. Every declared OAuth account says so, whatever its hosts.
#[test]
fn an_oauth_account_points_at_its_sign_in_pages() {
    let account = "/permissions/accounts/0";
    let report = admit(quests("loopback", |_| {}));
    assert_eq!(hints(&report), [hint("review.oauth_pages", account)]);
    assert_eq!(
        message(&report, "review.oauth_pages"),
        "the OAuth account Quest Log signs the player in at auth.quests.example and gets its tokens from api.quests.example"
    );
    let help = help(&report, "review.oauth_pages");
    for words in [
        "test account",
        "final address of each page",
        "consent page",
        "integrated service",
        "origins",
        "scopes",
        "reviewer manual, OAuth accounts",
    ] {
        assert!(help.contains(words), "{words}: {help}");
    }
    let report = admit(quests("device", |_| {}));
    assert_eq!(hints(&report), [hint("review.oauth_pages", account)]);
    assert_eq!(
        message(&report, "review.oauth_pages"),
        "the OAuth account Quest Log has the player enter a code at quests.example and gets its tokens from api.quests.example"
    );
    // A key account has no sign-in page.
    assert_eq!(hints(&admit(tracker(|_| {}))), []);
}

/// The human review of a declared OAuth account: its client and flow, the
/// page the player signs in on, its scopes and whether it can change the
/// account.
#[test]
fn the_human_review_shows_an_oauth_accounts_client_page_and_scopes() {
    for (flow, page) in [
        ("loopback", "https://auth.quests.example/oauth/authorize"),
        ("device", "https://quests.example/device"),
    ] {
        let (_temporary, root) = project(quests(flow, |_| {}));
        let output = cli(&["admit", path(&root), "--publisher", "nova"]);
        assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
        let shown = text(&output.stdout);
        for line in [
            "account         Quest Log (quests), OAuth sign-in, sent only to https://api.quests.example [CAN CHANGE THE ACCOUNT]",
            &format!(
                "OAuth client nova-quest-log ({flow}), sign-in page {page}, scopes quests:read (read), quests:track (write)"
            ),
        ] {
            assert!(shown.contains(line), "{line}\n{shown}");
        }
    }
    // Read scopes and GET routes only: it cannot change the account.
    let (_temporary, root) = project(quests("loopback", |declared| {
        declared["oauth"]["scopes"] = json!([{"name": "quests:read", "access": "read"}]);
    }));
    let output = cli(&["admit", path(&root), "--publisher", "nova"]);
    let shown = text(&output.stdout);
    let line = shown
        .lines()
        .find(|line| line.trim_start().starts_with("account "))
        .unwrap_or_default();
    assert!(
        line.contains("Quest Log") && !line.contains("[CAN CHANGE THE ACCOUNT]"),
        "{shown}"
    );
    let report = admit(quests("loopback", |declared| {
        declared["oauth"]["scopes"] = json!([{"name": "quests:read", "access": "read"}]);
    }));
    let item = report["review"]
        .as_array()
        .expect("review")
        .iter()
        .find(|item| item["kind"] == "account")
        .expect("account item")
        .clone();
    assert_eq!(item["writes"], false, "{item}");
    assert_eq!(item["oauth"]["flow"], "loopback", "{item}");
}

/// A scope declared `read` whose name says it writes, edits, manages or
/// deletes: the player is shown "read" only.
#[test]
fn a_read_scope_whose_name_writes_is_pointed_at() {
    let account = "/permissions/accounts/0";
    for name in [
        "user:write:chat",
        "channel:manage:broadcast",
        "chat:edit",
        "quests.delete",
        "WriteQuests",
    ] {
        let report = admit(quests("loopback", |declared| {
            declared["oauth"]["scopes"] = json!([{"name": name, "access": "read"}]);
        }));
        assert_eq!(
            hints(&report),
            [
                hint("review.oauth_pages", account),
                hint("review.read_scope_writes", account)
            ],
            "{name}"
        );
        let message = message(&report, "review.read_scope_writes");
        assert!(
            message.contains(name) && message.contains("read"),
            "{message}"
        );
    }
    for name in ["quests:read", "user:read:chat", "overwrite_free", "rewrite"] {
        let report = admit(quests("loopback", |declared| {
            declared["oauth"]["scopes"] = json!([{"name": name, "access": "read"}]);
        }));
        assert_eq!(
            hints(&report),
            [hint("review.oauth_pages", account)],
            "{name}"
        );
    }
    // A scope declared `write` says so already.
    let report = admit(quests("loopback", |declared| {
        declared["oauth"]["scopes"] = json!([{"name": "user:write:chat", "access": "write"}]);
    }));
    assert_eq!(hints(&report), [hint("review.oauth_pages", account)]);
}

/// An address or an ID of a declared account that reads as PlayerVox,
/// OverCrow or an integrated service, through Twitch's CDN names and an
/// internationalized host decoded first.
#[test]
fn an_oauth_page_or_id_that_reads_as_a_service_is_pointed_at() {
    let account = "/permissions/accounts/0";
    for (authorize, service) in [
        (
            "https://playervox-link.quests.example/oauth/authorize",
            "PlayerVox",
        ),
        ("https://auth.0vercrow.example/oauth/authorize", "OverCrow"),
        ("https://ttvnw-auth.example/oauth/authorize", "Twitch"),
        ("https://auth.jtvnw-login.example/oauth/authorize", "Twitch"),
        // `twitсh`, its `с` Cyrillic.
        ("https://xn--twith-4ye.example/oauth/authorize", "Twitch"),
        ("https://st3am-login.example/oauth/authorize", "Steam"),
    ] {
        let report = admit(quests("loopback", |declared| {
            declared["oauth"]["authorize"] = json!(authorize);
        }));
        assert_eq!(
            hints(&report),
            [
                hint("review.oauth_pages", account),
                hint("review.service_name_in_host", account)
            ],
            "{authorize}"
        );
        let message = message(&report, "review.service_name_in_host");
        assert!(
            message.ends_with(&format!("reads as {service}")),
            "{message}"
        );
    }
    let report = admit(quests("device", |declared| {
        declared["oauth"]["verify"] = json!("https://xn--layervox-4bh.example/device");
    }));
    let shown = message(&report, "review.service_name_in_host");
    // The address as the browser shows it, and as written.
    assert!(
        shown.contains("рlayervox.example") && shown.contains("xn--layervox-4bh.example"),
        "{shown}"
    );
    let with_id = |id: &str| {
        let mut permissions = quests("loopback", |declared| declared["id"] = json!(id));
        permissions["network"][0]["account"] = json!(id);
        admit(permissions)
    };
    for (id, service) in [
        ("twitch-api", "Twitch"),
        ("tw1tch", "Twitch"),
        ("steamstats", "Steam"),
        ("overcrow-sync", "OverCrow"),
    ] {
        let report = with_id(id);
        assert_eq!(
            hints(&report),
            [
                hint("review.oauth_pages", account),
                hint("review.service_name_in_id", account)
            ],
            "{id}"
        );
        let message = message(&report, "review.service_name_in_id");
        assert!(
            message.contains(id) && message.ends_with(&format!("reads as {service}")),
            "{message}"
        );
    }
    assert_eq!(
        hints(&with_id("quest-log")),
        [hint("review.oauth_pages", account)]
    );
}
