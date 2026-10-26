//! Third-party accounts in scenarios: `host.accounts` names any account,
//! and an HTTP fixture says whether its request carries the account.

use overcrow_widget_scenario::{AccountState, FixtureMatch, Scenario, ScenarioError, parse};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest_value};
use serde_json::{Value, json};

/// The integrated Steam service: its account is `steam`.
fn steam() -> Manifest {
    validate_manifest_value(json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.steam-stats",
        "version": "1.0.0",
        "name": {"en": "Steam stats", "fr": "Stats Steam"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 300, "height": 170},
            "max": {"width": 300, "height": 170}
        },
        "permissions": {
            "accounts": [{"service": "steam"}],
            "network": [
                {
                    "origin": "https://api.steampowered.com",
                    "method": "GET",
                    "path": "/ISteamUser/GetPlayerSummaries/v2/",
                    "queryParams": {"steamids": {"type": "slug", "maxLength": 17}},
                    "account": "steam"
                },
                {
                    "origin": "https://avatars.steamstatic.com",
                    "method": "GET",
                    "path": "/{file}",
                    "pathParams": {"file": {"type": "slug", "maxLength": 64}}
                }
            ]
        }
    }))
    .expect("manifest")
}

const SUMMARY: &str = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?steamids=1";

fn scenario(host: Value, http: Value, steps: Value) -> Result<Scenario, ScenarioError> {
    // A scenario plays at least one step.
    let steps = if steps == json!([]) {
        json!([{"advance": {"ms": 1000}}])
    } else {
        steps
    };
    parse(
        &serde_json::to_vec(&json!({
            "scenarioVersion": 1,
            "name": "accounts",
            "host": host,
            "fixtures": {"http": http},
            "steps": steps,
        }))
        .expect("bytes"),
    )
}

fn against(scenario: &Scenario) -> Result<(), String> {
    scenario.check_against(&steam()).map_err(|error| error.path)
}

#[test]
fn a_declared_account_takes_its_states() {
    for state in ["connected", "disconnected", "pending", "refused", "expired"] {
        let read = scenario(json!({"accounts": {"steam": state}}), json!([]), json!([]))
            .unwrap_or_else(|error| panic!("{state}: {error}"));
        assert_eq!(against(&read), Ok(()), "{state}");
    }
    let read = scenario(
        json!({"accounts": {"steam": "refused"}}),
        json!([]),
        json!([]),
    )
    .expect("read");
    assert_eq!(read.host.accounts.state("steam"), AccountState::Refused);
    // Unlisted accounts are connected, the host's included.
    assert_eq!(
        read.host.accounts.state("playervox"),
        AccountState::Connected
    );
    // The host's accounts keep their states.
    let read = scenario(
        json!({"accounts": {"playervox": "offline", "twitch": "expired"}}),
        json!([]),
        json!([]),
    )
    .expect("host accounts");
    assert_eq!(read.host.accounts.state("twitch"), AccountState::Expired);
    assert_eq!(against(&read), Ok(()));
}

#[test]
fn an_unknown_account_or_state_is_an_error() {
    // Not an account ID at all: refused when read.
    let error = scenario(
        json!({"accounts": {"Steam": "connected"}}),
        json!([]),
        json!([]),
    )
    .expect_err("not an ID");
    assert_eq!(error.path, "host.accounts.Steam");
    // `refused` is for a declared account, `offline` for the host's.
    let error = scenario(
        json!({"accounts": {"twitch": "refused"}}),
        json!([]),
        json!([]),
    )
    .expect_err("host account refused");
    assert_eq!(error.path, "host.accounts.twitch");
    let error = scenario(
        json!({"accounts": {"steam": "offline"}}),
        json!([]),
        json!([]),
    )
    .expect_err("declared account offline");
    assert_eq!(error.path, "host.accounts.steam");
    // An ID the manifest does not declare.
    let read = scenario(
        json!({"accounts": {"quests": "connected"}}),
        json!([]),
        json!([]),
    )
    .expect("grammar only");
    assert_eq!(against(&read), Err("host.accounts.quests".to_owned()));
    // A step changes accounts with the same checks.
    let read = scenario(
        json!({}),
        json!([]),
        json!([{"host": {"accounts": {"quests": "expired"}}}]),
    )
    .expect("grammar only");
    assert_eq!(
        against(&read),
        Err("steps[0].host.accounts.quests".to_owned())
    );
    let error = scenario(
        json!({}),
        json!([]),
        json!([{"host": {"accounts": {"steam": "offline"}}}]),
    )
    .expect_err("offline declared account in a step");
    assert_eq!(error.path, "steps[0].host.accounts.steam");
}

#[test]
fn an_account_grant_is_declared_by_the_manifest() {
    let read = scenario(
        json!({"grants": ["account:steam", "network"]}),
        json!([]),
        json!([]),
    )
    .expect("grants");
    assert_eq!(against(&read), Ok(()));
    let read = scenario(json!({"grants": ["account:quests"]}), json!([]), json!([]))
        .expect("grammar only");
    assert_eq!(against(&read), Err("host.grants".to_owned()));
    let error = scenario(json!({"grants": ["account:Steam"]}), json!([]), json!([]))
        .expect_err("not an account ID");
    assert_eq!(error.path, "host.grants");
}

#[test]
fn a_fixture_names_a_declared_account() {
    let fixture = |account: &str| {
        json!([{
            "request": {"method": "GET", "url": SUMMARY, "account": account},
            "response": {"status": 200, "contentType": "application/json", "body": "{}"}
        }])
    };
    let read = scenario(json!({}), fixture("steam"), json!([])).expect("fixture");
    assert_eq!(against(&read), Ok(()));
    let read = scenario(json!({}), fixture("quests"), json!([])).expect("grammar only");
    assert_eq!(
        against(&read),
        Err("fixtures.http[0].request.account".to_owned())
    );
    let error = scenario(json!({}), fixture("Steam!"), json!([])).expect_err("not an ID");
    assert_eq!(error.path, "fixtures.http[0].request.account");
}

#[test]
fn a_fixture_answers_only_a_request_sent_as_it_says() {
    let read = scenario(
        json!({}),
        json!([
            {
                "request": {"method": "GET", "url": SUMMARY, "account": "steam"},
                "response": {"status": 200, "body": "{}"}
            },
            {
                "request": {"method": "GET", "url": "https://avatars.steamstatic.com/a"},
                "response": {"status": 200, "body": ""}
            }
        ]),
        json!([]),
    )
    .expect("fixtures");
    let [with, without] = [&read.fixtures.http[0], &read.fixtures.http[1]];
    assert_eq!(
        with.answer("GET", SUMMARY, Some("steam")),
        FixtureMatch::Answers
    );
    // Sent without the account, while the fixture says it carries it.
    assert_eq!(
        with.answer("GET", SUMMARY, None),
        FixtureMatch::AccountMismatch
    );
    let avatar = "https://avatars.steamstatic.com/a";
    assert_eq!(without.answer("GET", avatar, None), FixtureMatch::Answers);
    // Sent with an account, while the fixture says it does not.
    assert_eq!(
        without.answer("GET", avatar, Some("steam")),
        FixtureMatch::AccountMismatch
    );
    assert_eq!(
        with.answer("POST", SUMMARY, Some("steam")),
        FixtureMatch::Other
    );
    assert_eq!(without.answer("GET", SUMMARY, None), FixtureMatch::Other);
}

#[test]
fn a_scenario_without_accounts_reads_as_before() {
    let read = scenario(
        json!({"accounts": {"playervox": "expired"}}),
        json!([]),
        json!([]),
    )
    .expect("host accounts");
    let again = parse(&serde_json::to_vec(&read).expect("serialize")).expect("again");
    assert_eq!(again, read);
    assert_eq!(read.host.accounts.state("playervox"), AccountState::Expired);
    assert_eq!(read.host.accounts.state("twitch"), AccountState::Connected);
}

/// A declared account of a fictitious service reads the same way.
#[test]
fn a_declared_account_reads_as_a_service() {
    let manifest = validate_manifest_value(json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.run-log",
        "version": "1.0.0",
        "name": {"en": "Run log", "fr": "Journal de course"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 300, "height": 170},
            "max": {"width": 300, "height": 170}
        },
        "permissions": {
            "accounts": [{
                "id": "runlog",
                "name": "Run Log",
                "mode": "key",
                "origins": ["https://api.runlog.example"],
                "send": {"header": "X-Api-Key"},
                "key": {
                    "format": {"charset": "alnum", "minLength": 16, "maxLength": 64},
                    "page": "https://runlog.example/settings/api"
                }
            }],
            "network": [{
                "origin": "https://api.runlog.example",
                "method": "GET",
                "path": "/v1/runs",
                "account": "runlog"
            }]
        }
    }))
    .expect("manifest");
    let read = scenario(
        json!({"accounts": {"runlog": "refused"}}),
        json!([{"request": {"method": "GET", "url": "https://api.runlog.example/v1/runs", "account": "runlog"},
                "response": {"status": 200, "body": "{}"}}]),
        json!([]),
    )
    .expect("read");
    assert_eq!(
        read.check_against(&manifest).map_err(|error| error.path),
        Ok(())
    );
    assert_eq!(read.host.accounts.state("runlog"), AccountState::Refused);
    // The Steam account is not this widget's.
    let other = scenario(
        json!({"accounts": {"steam": "connected"}}),
        json!([]),
        json!([]),
    )
    .expect("read");
    assert!(other.check_against(&manifest).is_err());
}

/// The Twitch service is the host's Twitch account: its states are the
/// host's (`offline`, never `refused`), and a fixture names it.
#[test]
fn the_twitch_service_is_the_hosts_twitch_account() {
    let manifest = validate_manifest_value(json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.live-goals",
        "version": "1.0.0",
        "name": {"en": "Live goals", "fr": "Objectifs du live"},
        "sizing": {
            "fit": "none",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 300, "height": 170},
            "max": {"width": 300, "height": 170}
        },
        "permissions": {
            "accounts": [{"service": "twitch", "scopes": ["channel:read:goals"]}],
            "network": [{
                "origin": "https://api.twitch.tv",
                "method": "GET",
                "path": "/helix/goals",
                "queryParams": {"broadcaster_id": {"type": "slug", "maxLength": 32}},
                "account": "twitch"
            }]
        }
    }))
    .expect("manifest");
    for state in ["connected", "disconnected", "pending", "expired", "offline"] {
        let read = scenario(json!({"accounts": {"twitch": state}}), json!([]), json!([]))
            .unwrap_or_else(|error| panic!("{state}: {error}"));
        assert_eq!(
            read.check_against(&manifest).map_err(|error| error.path),
            Ok(()),
            "{state}"
        );
    }
    assert!(
        scenario(
            json!({"accounts": {"twitch": "refused"}}),
            json!([]),
            json!([])
        )
        .is_err()
    );
    let granted = scenario(
        json!({"grants": ["network", "account:twitch"]}),
        json!([]),
        json!([]),
    )
    .expect("the service's grant");
    assert_eq!(
        granted.check_against(&manifest).map_err(|error| error.path),
        Ok(())
    );
    let read = scenario(
        json!({}),
        json!([{"request": {"method": "GET", "url": "https://api.twitch.tv/helix/goals?broadcaster_id=1", "account": "twitch"},
                "response": {"status": 200, "body": "{}"}}]),
        json!([]),
    )
    .expect("read");
    assert_eq!(
        read.check_against(&manifest).map_err(|error| error.path),
        Ok(())
    );
}

/// Live Twitch events are a data subscription: a scenario gives their
/// first value and publishes the next ones, checked against their shape.
#[test]
fn twitch_events_are_published_by_the_scenario() {
    let live = json!({"state": "live", "reason": null, "events": [
        {"seq": 1, "type": "channel.goal.progress", "at": 1_761_200_000_000_u64, "data": {"id": "1"}}
    ]});
    let read = |value: Value| {
        parse(
            &serde_json::to_vec(&json!({
                "scenarioVersion": 1,
                "name": "events",
                "fixtures": {"subscriptions": {
                    "twitch.events.subscribe": {"state": "off", "reason": "connecting", "events": []}
                }},
                "steps": [{"publish": {"service": "twitch.events.subscribe", "value": value}}],
            }))
            .expect("bytes"),
        )
    };
    read(live).expect("a live update");
    let error = read(json!({"state": "live", "events": []})).expect_err("not the shape");
    assert_eq!(error.path, "steps[0].publish.value");
    let error = read(json!({"state": "off", "reason": "token", "events": []})).expect_err("reason");
    assert_eq!(error.path, "steps[0].publish.value");
}

/// Local Steam events too: the first value and the next ones, each checked
/// against its shape (`stats.saved`, `{ appid }`).
#[test]
fn steam_events_are_published_by_the_scenario() {
    let saved = json!({"state": "live", "reason": null, "events": [
        {"seq": 1, "type": "stats.saved", "at": 1_761_505_519_565_u64, "data": {"appid": 2_315_050}}
    ]});
    let read = |value: Value| {
        parse(
            &serde_json::to_vec(&json!({
                "scenarioVersion": 1,
                "name": "events",
                "fixtures": {"subscriptions": {
                    "steam.events.subscribe": {"state": "off", "reason": "unavailable", "events": []}
                }},
                "steps": [{"publish": {"service": "steam.events.subscribe", "value": value}}],
            }))
            .expect("bytes"),
        )
    };
    read(saved).expect("a saved game");
    let error = read(json!({"state": "live", "reason": null, "events": [
        {"seq": 1, "type": "channel.follow", "at": 1, "data": {}}
    ]}))
    .expect_err("a Twitch type");
    assert_eq!(error.path, "steps[0].publish.value");
}
