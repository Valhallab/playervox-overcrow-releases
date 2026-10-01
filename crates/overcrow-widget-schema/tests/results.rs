//! Result shapes: every name resolves, every service has one, and
//! `Shape::matches` is exact.

use std::collections::BTreeSet;

use overcrow_widget_schema::results::{SHAPES, Shape, shape};
use overcrow_widget_schema::services::SERVICES;
use serde_json::json;

fn walk(shape: &Shape, names: &mut Vec<&'static str>) {
    match shape {
        Shape::Nullable(inner) | Shape::List(inner) => walk(inner, names),
        Shape::Record(members) => members.iter().for_each(|member| walk(&member.shape, names)),
        Shape::OneOf(shapes) => shapes.iter().for_each(|shape| walk(shape, names)),
        Shape::Named(name) => names.push(name),
        _ => {}
    }
}

#[test]
fn shape_names_are_unique_and_resolve() {
    let mut seen = BTreeSet::new();
    for named in SHAPES {
        assert!(seen.insert(named.name), "duplicate {}", named.name);
        assert!(
            named.name.chars().next().is_some_and(char::is_uppercase),
            "{}",
            named.name
        );
    }
    let mut used = Vec::new();
    for named in SHAPES {
        walk(&named.shape, &mut used);
    }
    for service in SERVICES {
        walk(&service.returns, &mut used);
    }
    for name in &used {
        assert!(shape(name).is_some(), "unknown shape {name}");
    }
    // Every named shape is used, `ServiceError` by the VM and the `submit` event.
    for named in SHAPES {
        assert!(
            named.name == "ServiceError" || used.contains(&named.name),
            "unused shape {}",
            named.name
        );
    }
}

#[test]
fn only_storage_returns_arbitrary_json() {
    for service in SERVICES {
        assert_eq!(
            service.returns == Shape::Json,
            service.name == "storage.get",
            "{}",
            service.name
        );
    }
}

#[test]
fn alternatives_are_told_apart_by_their_keys() {
    fn keys(shape: &Shape) -> Option<BTreeSet<&'static str>> {
        match shape {
            Shape::Record(members) => Some(members.iter().map(|member| member.name).collect()),
            _ => None,
        }
    }
    for named in SHAPES {
        if let Shape::OneOf(shapes) = named.shape {
            let sets: Vec<_> = shapes.iter().map(keys).collect();
            assert!(sets.iter().all(Option::is_some), "{}", named.name);
            for (index, set) in sets.iter().enumerate() {
                assert!(
                    sets[index + 1..].iter().all(|other| other != set),
                    "{}",
                    named.name
                );
            }
        }
    }
}

#[test]
fn records_are_exact() {
    const SESSION: Shape = Shape::Named("Session");
    let session = SESSION;
    assert!(session.matches(&json!({"elapsedMs": 1000, "at": 5})));
    assert!(
        !session.matches(&json!({"elapsedMs": 1000})),
        "missing member"
    );
    assert!(
        !session.matches(&json!({"elapsedMs": 1000, "at": 5, "extra": 1})),
        "extra member"
    );
    assert!(!session.matches(&json!(null)));
    assert!(Shape::Nullable(&SESSION).matches(&json!(null)));
    let rating = Shape::Named("Rating");
    let full = json!({
        "gameplay": 80, "art": 70, "tech": 60, "review": null,
        "publishedAt": null, "offsetMinutes": null,
    });
    assert!(rating.matches(&full));
    let mut missing = full.clone();
    missing.as_object_mut().expect("object").remove("review");
    assert!(
        !rating.matches(&missing),
        "a nullable member is still present"
    );
}

/// `playervox.rating.subscribe` always says its state: a rating, or
/// `null` before the first one, only shows with `ready`.
#[test]
fn the_rating_subscription_carries_its_state() {
    let returns = overcrow_widget_schema::services::service("playervox.rating.subscribe")
        .map(|service| service.returns)
        .expect("service");
    let rating = json!({
        "gameplay": 96, "art": 88, "tech": 94, "review": "Great.",
        "publishedAt": null, "offsetMinutes": null,
    });
    for state in ["idle", "unsupported", "loading", "ready", "unavailable"] {
        assert!(
            returns
                .matches(&json!({"state": state, "name": null, "offline": false, "rating": null})),
            "{state}"
        );
    }
    assert!(returns.matches(
        &json!({"state": "ready", "name": "Portal 2", "offline": true, "rating": rating})
    ));
    assert!(!returns.matches(&json!(null)), "never a bare null");
    assert!(!returns.matches(&rating), "never a bare rating");
    assert!(
        !returns.matches(&json!({"state": "ready", "name": null, "rating": null})),
        "offline is always present"
    );
    assert!(
        !returns.matches(
            &json!({"state": "signed_out", "name": null, "offline": false, "rating": null})
        )
    );
}

/// `playervox.reviews.subscribe` says what to read, never the reviews; a
/// page carries the game's name and each review whether it is hidden.
#[test]
fn the_reviews_subscription_says_what_to_read_and_pages_carry_hidden_reviews() {
    let service = |name| {
        overcrow_widget_schema::services::service(name)
            .map(|service| service.returns)
            .expect("service")
    };
    let state = service("playervox.reviews.subscribe");
    for name in ["idle", "unsupported", "ready"] {
        assert!(
            state.matches(&json!({"state": name, "revision": 3, "offline": false})),
            "{name}"
        );
    }
    assert!(!state.matches(&json!(null)), "never a bare null");
    assert!(
        !state.matches(&json!({"state": "ready", "revision": 3})),
        "offline is always present"
    );
    assert!(!state.matches(&json!({"state": "loading", "revision": 3, "offline": false})));
    assert!(
        !state.matches(&json!({"state": "ready", "revision": 3, "offline": false, "items": []})),
        "the subscription carries no review"
    );

    let page = service("playervox.reviews.page");
    let review = json!({
        "id": "r7", "author": "Mira", "grade": "A", "score": 74,
        "text": "Solid.", "original": null, "hidden": true,
        "publishedAt": 1_789_900_200_000_u64, "offsetMinutes": 120,
    });
    let full = json!({
        "gameName": "Portal 2", "items": [review], "page": 1, "totalPages": 1, "count": 1,
    });
    assert!(page.matches(&full));
    let mut unnamed = full.clone();
    unnamed.as_object_mut().expect("object").remove("gameName");
    assert!(!page.matches(&unnamed), "the game's name is always present");
    let mut unmarked = full;
    unmarked["items"][0]
        .as_object_mut()
        .expect("object")
        .remove("hidden");
    assert!(!page.matches(&unmarked), "hidden is always present");
}

#[test]
fn scalars_are_checked() {
    assert!(Shape::Integer.matches(&json!(9_007_199_254_740_991_u64)));
    assert!(!Shape::Integer.matches(&json!(9_007_199_254_740_992_u64)));
    assert!(Shape::Integer.matches(&json!(-5)));
    assert!(Shape::Integer.matches(&json!(3.0)));
    assert!(!Shape::Integer.matches(&json!(3.5)));
    assert!(!Shape::Integer.matches(&json!("3")));
    assert!(Shape::Number.matches(&json!(61.3)));
    assert!(!Shape::Number.matches(&json!(true)));
    assert!(Shape::Asset.matches(&json!("asset:00000000000000ff")));
    assert!(!Shape::Asset.matches(&json!("assets/cover.png")));
    assert!(!Shape::Asset.matches(&json!("https://example.com/a.png")));
    let error = Shape::Named("ServiceError");
    assert!(error.matches(&json!({"code": "permission_denied"})));
    assert!(!error.matches(&json!({"code": "boom"})));
    assert!(Shape::Json.matches(&json!({"any": [1, "x", null]})));
}

#[test]
fn alternatives_match_exactly_one() {
    let response = Shape::Named("HttpResponse");
    assert!(response.matches(&json!({"status": 200, "contentType": "application/json"})));
    assert!(response.matches(&json!({"status": 200, "contentType": null})));
    assert!(response.matches(&json!({"status": 200, "asset": "asset:0000000000000001"})));
    assert!(!response.matches(&json!({"status": 200})));
    let fragment = Shape::Named("ChatFragment");
    assert!(fragment.matches(&json!({"text": "hi"})));
    assert!(fragment.matches(&json!({"emote": "asset:0000000000000002", "alt": "Kappa"})));
    assert!(!fragment.matches(&json!({"emote": "asset:0000000000000002"})));
}

#[test]
fn nested_lists_and_names_are_checked() {
    let notes = Shape::Named("Notes");
    let note = json!({
        "id": "n1", "title": "Todo", "body": "",
        "items": [{"id": "i1", "text": "Milk", "checked": false}],
    });
    assert!(notes.matches(&json!({"active": "n1", "notes": [note]})));
    let bad = json!({
        "id": "n1", "title": "Todo", "body": "",
        "items": [{"id": "i1", "text": "Milk", "checked": "no"}],
    });
    assert!(!notes.matches(&json!({"active": null, "notes": [bad]})));
    assert!(!Shape::Named("Nope").matches(&json!(null)));
}
