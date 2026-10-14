//! Third-party accounts in scenarios: `host.accounts` names any account,
//! and an HTTP fixture says whether its request carries the account.

use overcrow_widget_scenario::{AccountState, FixtureMatch, Scenario, ScenarioError, parse};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest_value};
use serde_json::{Value, json};

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
            "accounts": [{
                "id": "steam",
                "name": "Steam",
                "mode": "key",
                "origins": ["https://api.steampowered.com", "https://avatars.steamstatic.com"],
                "send": {"header": "X-WebAPI-Key"},
                "key": {
                    "format": {"charset": "hex", "minLength": 32, "maxLength": 32},
                    "page": "https://steamcommunity.com/dev/apikey"
                }
            }],
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
