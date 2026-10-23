//! Live Twitch events: a widget that names the Twitch service lists in
//! `events` the EventSub types it wants; each is in the host's table and
//! read by a scope the widget itself declares. The host subscribes and
//! sends the widget a closed, bounded projection of each event
//! (`twitch.events.subscribe`). A reader that does not know `events`
//! refuses the manifest: it needs the catalog feature `twitch-events`.

use overcrow_widget_schema::catalog_v2::{FEATURE_TWITCH_EVENTS, KNOWN_FEATURES};
use overcrow_widget_schema::integrated::{
    EventCondition, STEAM, ServiceEvent, TWITCH, TWITCH_EVENT_TYPES, project_event,
};
use overcrow_widget_schema::limits::{
    MAX_SERVICE_EVENT_BYTES, MAX_SERVICE_EVENTS, SERVICE_EVENT_WINDOW,
};
use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::results::shape;
use overcrow_widget_schema::services::{Requirement, SERVICES, ServiceKind};
use serde_json::{Value, json};

const GOALS: [&str; 3] = [
    "channel.goal.begin",
    "channel.goal.progress",
    "channel.goal.end",
];

fn base(account: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": 1,
        "id": "nova.live-goals",
        "version": "1.0.0",
        "name": {"en": "Live goals", "fr": "Objectifs"},
        "sizing": {
            "fit": "height",
            "preferred": {"width": 300, "height": 170},
            "min": {"width": 200, "height": 96},
            "max": {"width": 480, "height": 480}
        },
        "permissions": {
            "accounts": [account],
            "network": [{
                "origin": "https://api.twitch.tv",
                "method": "GET",
                "path": "/helix/goals",
                "queryParams": {"broadcaster_id": {"type": "slug", "maxLength": 32, "required": true}},
                "account": "twitch"
            }]
        }
    })
}

fn twitch(events: Value) -> Value {
    base(json!({
        "service": "twitch",
        "scopes": ["channel:read:goals", "moderator:read:followers"],
        "events": events
    }))
}

fn validate(value: &Value) -> Result<Manifest, &'static str> {
    validate_manifest(value.to_string().as_bytes()).map_err(|error| error.as_str())
}

#[test]
fn events_need_their_feature() {
    assert_eq!(FEATURE_TWITCH_EVENTS, "twitch-events");
    assert!(KNOWN_FEATURES.contains(&FEATURE_TWITCH_EVENTS));
    let manifest = validate(&twitch(json!(GOALS))).expect("goal events");
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-twitch", "twitch-events"]
    );
    let account = manifest.account().expect("declared");
    assert_eq!(
        account
            .events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        GOALS
    );
    // Without `events`, the service alone.
    let mut value = twitch(json!([]));
    value["permissions"]["accounts"][0]
        .as_object_mut()
        .unwrap()
        .remove("events");
    let manifest = validate(&value).expect("no events");
    assert!(manifest.account().unwrap().events.is_empty());
    assert_eq!(
        manifest.features().into_iter().collect::<Vec<_>>(),
        ["service-twitch"]
    );
}

#[test]
fn each_event_is_of_the_table_and_read_by_a_declared_scope() {
    // The follow is read by `moderator:read:followers`, declared.
    validate(&twitch(json!(["channel.follow"]))).expect("follow");
    for (case, events) in [
        ("empty list", json!([])),
        ("unknown type", json!(["channel.raid"])),
        ("chat is the host's", json!(["channel.chat.message"])),
        ("a scope not declared", json!(["channel.cheer"])),
        ("twice", json!(["channel.goal.end", "channel.goal.end"])),
        ("not text", json!([1])),
        ("not a list", json!("channel.goal.end")),
        ("a version suffix", json!(["channel.goal.end@1"])),
        ("case", json!(["Channel.Goal.End"])),
    ] {
        assert_eq!(validate(&twitch(events)).err(), Some("account"), "{case}");
    }
    let mut many: Vec<Value> = Vec::new();
    for _ in 0..=MAX_SERVICE_EVENTS.value {
        many.push(json!("channel.goal.end"));
    }
    assert_eq!(validate(&twitch(Value::Array(many))).err(), Some("account"));
}

#[test]
fn only_a_service_with_events_takes_them() {
    let steam = base(json!({"service": "steam", "events": ["channel.goal.end"]}));
    assert_eq!(validate(&steam).err(), Some("account"));
    assert!(STEAM.events.is_empty());
    assert_eq!(STEAM.events_feature, None);
}

#[test]
fn events_never_widen_the_permissions() {
    let mut without = twitch(json!([]));
    without["permissions"]["accounts"][0]
        .as_object_mut()
        .unwrap()
        .remove("events");
    let without = validate(&without).expect("without").permissions;
    let with = validate(&twitch(json!(["channel.goal.progress", "channel.follow"])))
        .expect("with")
        .permissions;
    // The events read what the scopes, already granted, open by Helix:
    // the permission `account:twitch` keeps its detail.
    assert_eq!(with.accounts, without.accounts);
    assert!(!with.widens(&without));
    assert!(!without.widens(&with));
}

#[test]
fn the_table_is_the_eighteen_types_of_the_read_scopes() {
    let table: Vec<(&str, &str, &str)> = TWITCH
        .events
        .iter()
        .map(|event| (event.kind, event.version, event.scope))
        .collect();
    assert_eq!(
        table,
        [
            ("channel.goal.begin", "1", "channel:read:goals"),
            ("channel.goal.progress", "1", "channel:read:goals"),
            ("channel.goal.end", "1", "channel:read:goals"),
            ("channel.follow", "2", "moderator:read:followers"),
            ("channel.hype_train.begin", "2", "channel:read:hype_train"),
            (
                "channel.hype_train.progress",
                "2",
                "channel:read:hype_train"
            ),
            ("channel.hype_train.end", "2", "channel:read:hype_train"),
            ("channel.cheer", "1", "bits:read"),
            ("channel.subscribe", "1", "channel:read:subscriptions"),
            (
                "channel.subscription.gift",
                "1",
                "channel:read:subscriptions"
            ),
            (
                "channel.subscription.message",
                "1",
                "channel:read:subscriptions"
            ),
            ("channel.poll.begin", "1", "channel:read:polls"),
            ("channel.poll.progress", "1", "channel:read:polls"),
            ("channel.poll.end", "1", "channel:read:polls"),
            ("channel.prediction.begin", "1", "channel:read:predictions"),
            (
                "channel.prediction.progress",
                "1",
                "channel:read:predictions"
            ),
            ("channel.prediction.lock", "1", "channel:read:predictions"),
            ("channel.prediction.end", "1", "channel:read:predictions"),
        ]
    );
    assert_eq!(TWITCH.events_feature, Some(FEATURE_TWITCH_EVENTS));
    assert_eq!(
        TWITCH_EVENT_TYPES,
        table.iter().map(|(kind, _, _)| *kind).collect::<Vec<_>>()
    );
    for event in TWITCH.events {
        // Every scope is a read scope a widget may ask for.
        assert!(TWITCH.scope(event.scope).is_some(), "{}", event.kind);
        let condition = if event.kind == "channel.follow" {
            EventCondition::BroadcasterAndModerator
        } else {
            EventCondition::Broadcaster
        };
        assert_eq!(event.condition, condition, "{}", event.kind);
        assert_eq!(TWITCH.event(event.kind), Some(event));
    }
    assert_eq!(TWITCH.event("channel.raid"), None);
}

fn event(kind: &str) -> &'static ServiceEvent {
    TWITCH.event(kind).expect("in the table")
}

#[test]
fn a_goal_keeps_its_fields_and_nothing_else() {
    let raw = json!({
        "id": "12345", "broadcaster_user_id": "141981764",
        "broadcaster_user_name": "TwitchDev", "broadcaster_user_login": "twitchdev",
        "type": "follower", "description": "Follow goal for Helix testing",
        "current_amount": 27062, "target_amount": 30000,
        "started_at": "2021-07-15T17:16:03.17106713Z",
        "secret": "never", "is_achieved": "not a boolean"
    });
    let data = project_event(event("channel.goal.progress"), &raw).expect("projected");
    assert_eq!(
        data,
        json!({
            "id": "12345", "broadcaster_user_id": "141981764",
            "broadcaster_user_name": "TwitchDev", "broadcaster_user_login": "twitchdev",
            "type": "follower", "description": "Follow goal for Helix testing",
            "current_amount": 27062, "target_amount": 30000,
            "started_at": "2021-07-15T17:16:03.17106713Z",
            "is_achieved": null, "ended_at": null
        })
    );
}

#[test]
fn texts_lists_and_sizes_are_bounded() {
    // A control character reads as a space; a long text is cut.
    let raw = json!({
        "is_anonymous": false, "user_id": "1", "user_login": "nova", "user_name": "No\u{7}va",
        "broadcaster_user_id": "2", "broadcaster_user_login": "b", "broadcaster_user_name": "B",
        "message": "x".repeat(4000), "bits": 100
    });
    let data = project_event(event("channel.cheer"), &raw).expect("cheer");
    assert_eq!(data["user_name"], "No va");
    // Format and bidirectional controls go: a name cannot turn the text
    // around.
    let raw = json!({"user_id": "1", "user_login": "nova",
        "user_name": "No\u{202E}va\u{200B}\u{2066}\u{FEFF}!", "broadcaster_user_id": "2", "bits": 1});
    let data = project_event(event("channel.cheer"), &raw).expect("cheer");
    assert_eq!(data["user_name"], "Nova!");
    let raw = json!({"id": "g", "description": "d".repeat(4000)});
    let data = project_event(event("channel.goal.begin"), &raw).expect("goal");
    assert_eq!(data["description"].as_str().unwrap().chars().count(), 200);
    // An identifier that is not one is null.
    let raw = json!({"id": "a b", "broadcaster_user_id": "2", "total": 1, "level": 1});
    let data = project_event(event("channel.hype_train.end"), &raw).expect("train");
    assert_eq!(data["id"], Value::Null);
    // Lists keep their first items.
    let contributor =
        json!({"user_id": "1", "user_login": "a", "user_name": "A", "type": "bits", "total": 5});
    let raw = json!({"id": "t", "top_contributions": vec![contributor; 50]});
    let data = project_event(event("channel.hype_train.progress"), &raw).expect("train");
    assert_eq!(data["top_contributions"].as_array().unwrap().len(), 10);
    // A prediction at its largest still fits.
    let predictor = json!({"user_id": "1".repeat(32), "user_login": "l".repeat(25), "user_name": "n".repeat(64),
                           "channel_points_won": 1, "channel_points_used": 1});
    let outcome = json!({"id": "o".repeat(64), "title": "t".repeat(400), "color": "blue", "users": 1,
                         "channel_points": 1, "top_predictors": vec![predictor; 20]});
    let raw = json!({"id": "p", "title": "t".repeat(400), "outcomes": vec![outcome; 20]});
    let data = project_event(event("channel.prediction.progress"), &raw).expect("bounded");
    assert!(data.to_string().len() as u64 <= MAX_SERVICE_EVENT_BYTES.value);
    assert_eq!(data["outcomes"].as_array().unwrap().len(), 10);
    assert_eq!(
        data["outcomes"][0]["top_predictors"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    // Not an object: nothing.
    assert_eq!(project_event(event("channel.follow"), &json!([1])), None);
}

#[test]
fn the_service_of_the_events() {
    let service = SERVICES
        .iter()
        .find(|service| service.name == "twitch.events.subscribe")
        .expect("listed");
    assert_eq!(service.kind, ServiceKind::Subscribe);
    assert_eq!(service.requires, Requirement::Service("twitch"));
    assert!(!service.gesture);
    let shape = shape("TwitchEvents").expect("named").shape;
    let update = json!({
        "state": "live", "reason": null,
        "events": [{"seq": 1, "type": "channel.goal.progress", "at": 1_761_200_000_000_u64,
                    "data": {"id": "1"}}]
    });
    assert!(shape.matches(&update));
    assert!(shape.matches(&json!({"state": "off", "reason": "connecting", "events": []})));
    assert!(!shape.matches(&json!({"state": "off", "reason": "token", "events": []})));
    // An update of the window stays far below a frame.
    const {
        assert!(SERVICE_EVENT_WINDOW.value >= 8);
        assert!(SERVICE_EVENT_WINDOW.value * MAX_SERVICE_EVENT_BYTES.value <= 512 * 1024);
    }
}

/// What viewers write (the message of a cheer, of a resubscription) is chat
/// text: Helix does not give it under the scopes a widget declares, and a
/// widget with an account may not read the chat (a sensitive capability).
/// No event carries it.
#[test]
fn viewer_messages_never_reach_a_widget() {
    fn names(
        fields: &[overcrow_widget_schema::integrated::EventField],
        out: &mut Vec<&'static str>,
    ) {
        for field in fields {
            out.push(field.name);
            match field.value {
                overcrow_widget_schema::integrated::EventValue::Object(inner)
                | overcrow_widget_schema::integrated::EventValue::List(_, inner) => {
                    names(inner, out)
                }
                _ => {}
            }
        }
    }
    for entry in TWITCH.events {
        let mut fields = Vec::new();
        names(entry.fields, &mut fields);
        assert!(!fields.contains(&"message"), "{}", entry.kind);
        assert!(!fields.contains(&"text"), "{}", entry.kind);
    }
    let cheer = json!({"is_anonymous": false, "user_id": "1", "user_login": "nova", "user_name": "Nova",
        "broadcaster_user_id": "2", "message": "a viewer's words", "bits": 100});
    let data = project_event(event("channel.cheer"), &cheer).expect("cheer");
    assert_eq!(data.get("message"), None);
    assert_eq!(data["bits"], 100);
    let resub = json!({"user_id": "1", "user_login": "nova", "user_name": "Nova", "broadcaster_user_id": "2",
        "tier": "1000", "message": {"text": "a viewer's words", "emotes": [{"begin": 0, "end": 1, "id": "9"}]},
        "cumulative_months": 15, "streak_months": 1, "duration_months": 6});
    let data =
        project_event(event("channel.subscription.message"), &resub).expect("resubscription");
    assert_eq!(data.get("message"), None);
    assert_eq!(data["cumulative_months"], 15);
    assert!(!data.to_string().contains("a viewer's words"));
}
