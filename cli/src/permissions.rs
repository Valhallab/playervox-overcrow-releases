//! Stable keys of the authority a manifest requests, and what an update
//! adds to it. The keys are shared with the creator space and its MCP
//! server: `network:<METHOD> <origin><path>`, `storage`, `clipboardWrite`,
//! `capability:<name>` and `gameEvent:<name>`.
//!
//! A network key names a route; the rest of its rule (path and query
//! constraints, response bound) is its detail. An update whose route stays
//! but gains a rule detail asks for other authority too: such a key is
//! `changed` (widened), and, like an `added` one, calls for a full review,
//! as the host asks the player again (`Permissions::widens`).

use std::collections::{BTreeMap, BTreeSet};

use overcrow_widget_schema::manifest::Manifest;
use serde_json::{Value, json};

/// The review an update needs (creator portal design, §6.3).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewType {
    /// A new permission, network route or capability.
    Full,
    /// Nothing more is requested.
    Quick,
}

impl ReviewType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Quick => "quick",
        }
    }
}

/// What `current` requests compared with `previous`, keys sorted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Comparison {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
    pub review: ReviewType,
}

impl Comparison {
    pub fn to_json(&self) -> Value {
        json!({
            "added": self.added,
            "removed": self.removed,
            "changed": self.changed,
            "reviewType": self.review.as_str(),
        })
    }
}

/// Every key `manifest` requests, with the canonical details of its rules
/// (empty for keys without detail).
pub fn keys(manifest: &Manifest) -> BTreeMap<String, BTreeSet<String>> {
    let permissions = &manifest.permissions;
    let mut keys: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for rule in &permissions.network {
        // Canonical JSON written by the schema; a validated rule always
        // has these three strings.
        let value: Value = serde_json::from_str(rule).unwrap_or(Value::Null);
        let key = format!(
            "network:{} {}{}",
            value["method"].as_str().unwrap_or_default(),
            value["origin"].as_str().unwrap_or_default(),
            value["path"].as_str().unwrap_or_default()
        );
        keys.entry(key).or_default().insert(rule.clone());
    }
    if permissions.storage {
        keys.entry("storage".into()).or_default();
    }
    if permissions.clipboard_write {
        keys.entry("clipboardWrite".into()).or_default();
    }
    for name in &permissions.capabilities {
        keys.entry(format!("capability:{name}")).or_default();
    }
    for event in &permissions.game_events {
        keys.entry(format!("gameEvent:{event}")).or_default();
    }
    keys
}

pub fn compare(previous: &Manifest, current: &Manifest) -> Comparison {
    let (before, after) = (keys(previous), keys(current));
    let added: Vec<String> = after
        .keys()
        .filter(|key| !before.contains_key(*key))
        .cloned()
        .collect();
    let removed = before
        .keys()
        .filter(|key| !after.contains_key(*key))
        .cloned()
        .collect();
    let changed: Vec<String> = after
        .iter()
        // Widened: a rule of the route that the previous version did not
        // have; dropping one of several rules narrows, which is no change.
        .filter(|(key, details)| before.get(*key).is_some_and(|old| !details.is_subset(old)))
        .map(|(key, _)| key.clone())
        .collect();
    let review = if added.is_empty() && changed.is_empty() {
        ReviewType::Quick
    } else {
        ReviewType::Full
    };
    Comparison {
        added,
        removed,
        changed,
        review,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use overcrow_widget_schema::manifest::validate_manifest;

    fn manifest(permissions: Value) -> Manifest {
        let value = json!({
            "schemaVersion": 1,
            "apiVersion": 1,
            "id": "nova.lol-timers",
            "version": "1.0.0",
            "name": {"en": "Timers", "fr": "Minuteurs"},
            "sizing": {
                "fit": "none",
                "preferred": {"width": 200, "height": 100},
                "min": {"width": 200, "height": 100},
                "max": {"width": 200, "height": 100}
            },
            "permissions": permissions,
        });
        validate_manifest(value.to_string().as_bytes()).expect("valid test manifest")
    }

    fn route(path: &str, extra: Value) -> Value {
        let mut rule = json!({"method": "GET", "origin": "https://api.nova.gg", "path": path});
        if let (Value::Object(rule), Value::Object(extra)) = (&mut rule, extra) {
            rule.extend(extra);
        }
        rule
    }

    #[test]
    fn every_kind_of_authority_has_its_stable_key() {
        let keys = keys(&manifest(json!({
            "network": [route("/v1/timers", json!({}))],
            "storage": true,
            "clipboardWrite": true,
            "gameEvents": ["overcrow.game.match.started.v1"],
        })));
        assert_eq!(
            keys.keys().collect::<Vec<_>>(),
            [
                "clipboardWrite",
                "gameEvent:overcrow.game.match.started.v1",
                "network:GET https://api.nova.gg/v1/timers",
                "storage",
            ]
        );
    }

    #[test]
    fn capabilities_are_keyed_by_name() {
        let keys = keys(&manifest(json!({"capabilities": ["fps.read"]})));
        assert!(keys.contains_key("capability:fps.read"), "{keys:?}");
    }

    #[test]
    fn a_new_route_needs_a_full_review() {
        let before = manifest(json!({"network": [route("/v1/timers", json!({}))]}));
        let after = manifest(json!({"network": [
            route("/v1/timers", json!({})),
            route("/v1/champions", json!({})),
        ]}));
        let comparison = compare(&before, &after);
        assert_eq!(
            comparison.added,
            ["network:GET https://api.nova.gg/v1/champions"]
        );
        assert!(comparison.removed.is_empty() && comparison.changed.is_empty());
        assert_eq!(comparison.review, ReviewType::Full);
    }

    #[test]
    fn removing_authority_is_a_quick_review() {
        let before =
            manifest(json!({"network": [route("/v1/timers", json!({}))], "storage": true}));
        let after = manifest(json!({"storage": true}));
        let comparison = compare(&before, &after);
        assert_eq!(
            comparison.removed,
            ["network:GET https://api.nova.gg/v1/timers"]
        );
        assert_eq!(comparison.review, ReviewType::Quick);
        assert_eq!(compare(&after, &after).review, ReviewType::Quick);
    }

    #[test]
    fn a_route_whose_rule_widens_is_changed_and_fully_reviewed() {
        let before = manifest(json!({"network": [route("/v1/timers", json!({}))]}));
        let after = manifest(json!({"network": [route(
            "/v1/timers",
            json!({"queryParams": {"region": {"type": "string", "maxLength": 8}}}),
        )]}));
        let comparison = compare(&before, &after);
        assert!(comparison.added.is_empty());
        assert_eq!(
            comparison.changed,
            ["network:GET https://api.nova.gg/v1/timers"]
        );
        assert_eq!(comparison.review, ReviewType::Full);
        assert_eq!(
            comparison.to_json()["reviewType"],
            json!("full"),
            "the JSON names the review"
        );
    }

    #[test]
    fn dropping_one_of_several_rules_of_a_route_is_no_widening() {
        let narrow = route("/v1/timers", json!({}));
        let wide = route(
            "/v1/timers",
            json!({"queryParams": {"region": {"type": "string", "maxLength": 8}}}),
        );
        let before = manifest(json!({"network": [narrow.clone(), wide]}));
        let after = manifest(json!({"network": [narrow]}));
        let comparison = compare(&before, &after);
        assert!(comparison.changed.is_empty() && comparison.added.is_empty());
        assert_eq!(comparison.review, ReviewType::Quick);
    }
}
