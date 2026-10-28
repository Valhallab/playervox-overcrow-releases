//! Game events in a scenario: the fake host of a game's service
//! (`gameEvents.warframe.subscribe`). A `gameEvents` step names one game
//! and says what changes, in the words of the service: `playing`,
//! `session`, a feature's status, `info` members merged into the current
//! state, and one event. The fake host keeps the whole value, completes
//! what the step leaves out (an absent nullable member is `null`, a list
//! `[]`, a count `0`, a time the step's time), numbers the event, and
//! publishes the value once it has the service's shape.

use std::collections::{BTreeMap, BTreeSet};

use overcrow_widget_schema::game_events::{GAME_EVENT_FEATURES, warframe};
use overcrow_widget_schema::limits::SERVICE_EVENT_WINDOW;
use overcrow_widget_schema::results::{self, Member, Shape};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{Fixtures, ScenarioError, present, service_returns};

/// A `gameEvents` step: one game, by name, and what changes.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub struct GameEventsStep(pub BTreeMap<String, GameStep>);

/// What changes in a game's events. Absent members keep their value.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameStep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing: Option<bool>,
    /// `null` or `{ startedAt }`.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub session: Option<Value>,
    /// Feature name → `available`, `unavailable` or `undeclared`.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub features: Map<String, Value>,
    /// Members of `info`, merged into the current ones: an object member
    /// merges into the current object, any other value replaces it.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub info: Map<String, Value>,
    /// An event: its type, or `{ type, at?, <state> }` with the state its
    /// type carries; without it, the state is the matching `info` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<Value>,
}

/// The service of a game's events.
pub fn game_service(game: &str) -> Option<&'static str> {
    overcrow_widget_schema::services::SERVICES
        .iter()
        .map(|service| service.name)
        .find(|name| {
            name.strip_prefix("gameEvents.")
                .and_then(|name| name.strip_suffix(".subscribe"))
                == Some(game)
        })
}

fn game_of_service(service: &str) -> Option<&str> {
    service
        .strip_prefix("gameEvents.")
        .and_then(|name| name.strip_suffix(".subscribe"))
        .filter(|game| game_service(game).is_some())
}

/// The feature an event type of `game` belongs to.
pub fn feature_of_event(game: &str, event: &str) -> Option<&'static str> {
    match game {
        "warframe" => warframe::feature_of_event(event),
        _ => None,
    }
}

/// One value the fake host publishes.
#[derive(Clone, Debug, PartialEq)]
pub struct GameEventUpdate {
    /// The index of the step that made it.
    pub step: usize,
    pub service: &'static str,
    pub value: Value,
}

struct Game {
    value: Value,
    seq: u64,
}

/// The fake host of every game's events in one scenario run.
pub struct GameEvents {
    declared: BTreeSet<String>,
    initial: BTreeMap<String, Value>,
    games: BTreeMap<String, Game>,
}

impl GameEvents {
    /// Starts from the scenario's fixture values; a game without one starts
    /// playing, with nothing known, each feature `available` when
    /// `declared` lists it and `undeclared` otherwise.
    pub fn new(fixtures: &Fixtures, declared: &BTreeSet<String>) -> Self {
        Self {
            declared: declared.clone(),
            initial: fixtures
                .subscriptions
                .iter()
                .filter(|(service, _)| game_of_service(service).is_some())
                .map(|(service, value)| (service.clone(), value.clone()))
                .collect(),
            games: BTreeMap::new(),
        }
    }

    /// A `publish` step of a game's service sets its whole value.
    pub fn published(&mut self, service: &str, value: &Value) {
        if let Some(game) = game_of_service(service) {
            self.games.insert(game.to_owned(), game_from(value));
        }
    }

    /// Plays `step` at `now_ms`; `path` names the step in errors.
    pub fn apply(
        &mut self,
        path: &str,
        step: &GameEventsStep,
        now_ms: u64,
    ) -> Result<(&'static str, Value), ScenarioError> {
        let (game, change) = one_game(path, step)?;
        let service = game_service(game).expect("checked by one_game");
        let here = format!("{path}.gameEvents.{game}");
        let state = match self.games.remove(game) {
            Some(state) => state,
            None => match self.initial.get(service) {
                Some(value) => game_from(value),
                None => Game {
                    value: self.default_value(game, service),
                    seq: 0,
                },
            },
        };
        let state = change_game(&here, service, game, state, change, now_ms)?;
        let value = state.value.clone();
        self.games.insert(game.to_owned(), state);
        Ok((service, value))
    }

    fn default_value(&self, game: &str, service: &str) -> Value {
        let features: Map<String, Value> = members(service, "features")
            .iter()
            .map(|member| {
                let declared = self.declared.contains(&format!("{game}.{}", member.name));
                (
                    member.name.to_owned(),
                    json!(if declared { "available" } else { "undeclared" }),
                )
            })
            .collect();
        let info: Map<String, Value> = members(service, "info")
            .iter()
            .map(|member| (member.name.to_owned(), Value::Null))
            .collect();
        json!({
            "playing": true,
            "session": null,
            "features": features,
            "info": info,
            "events": []
        })
    }
}

fn game_from(value: &Value) -> Game {
    let seq = value["events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|event| event["seq"].as_u64())
        .max()
        .unwrap_or(0);
    Game {
        value: value.clone(),
        seq,
    }
}

/// The single game a step names, among those with a service.
pub(crate) fn one_game<'a>(
    path: &str,
    step: &'a GameEventsStep,
) -> Result<(&'a str, &'a GameStep), ScenarioError> {
    let mut games = step.0.iter();
    match (games.next(), games.next()) {
        (Some((game, change)), None) if game_service(game).is_some() => Ok((game, change)),
        (Some((game, _)), None) => Err(ScenarioError::new(
            format!("{path}.gameEvents.{}", crate::report::neutral(game)),
            "no game of this name has events",
        )),
        _ => Err(ScenarioError::new(
            format!("{path}.gameEvents"),
            "name exactly one game",
        )),
    }
}

/// The members of the record `member` of the service's value.
fn members(service: &str, member: &str) -> &'static [Member] {
    let Some(Shape::Record(top)) = service_returns(service).map(resolve) else {
        return &[];
    };
    match top
        .iter()
        .find(|item| item.name == member)
        .map(|item| resolve(item.shape))
    {
        Some(Shape::Record(members)) => members,
        _ => &[],
    }
}

/// `shape` with its names resolved.
fn resolve(shape: Shape) -> Shape {
    match shape {
        Shape::Named(name) => results::shape(name).map_or(shape, |named| resolve(named.shape)),
        other => other,
    }
}

fn change_game(
    here: &str,
    service: &'static str,
    game: &str,
    mut state: Game,
    change: &GameStep,
    now_ms: u64,
) -> Result<Game, ScenarioError> {
    let Some(object) = state.value.as_object_mut() else {
        return Err(ScenarioError::new(
            here,
            "the current value is not an object",
        ));
    };
    if let Some(playing) = change.playing {
        object.insert("playing".to_owned(), Value::Bool(playing));
    }
    if let Some(session) = &change.session {
        let shape = member_shape(service, "session");
        let session = complete(
            &shape,
            Some(session),
            "session",
            &format!("{here}.session"),
            now_ms,
        )?;
        object.insert("session".to_owned(), session);
    }
    for (feature, status) in &change.features {
        let path = format!("{here}.features.{}", crate::report::neutral(feature));
        let Some(member) = members(service, "features")
            .iter()
            .find(|member| member.name == feature.as_str())
        else {
            return Err(ScenarioError::new(path, "no such feature"));
        };
        if !member.shape.matches(status) {
            return Err(ScenarioError::new(
                path,
                "`available`, `unavailable` or `undeclared`",
            ));
        }
        object["features"][feature] = status.clone();
    }
    if !change.info.is_empty() {
        let info_members = members(service, "info");
        for key in change.info.keys() {
            if !info_members
                .iter()
                .any(|member| member.name == key.as_str())
            {
                return Err(ScenarioError::new(
                    format!("{here}.info.{}", crate::report::neutral(key)),
                    "no such member",
                ));
            }
        }
        let merged = merge(&object["info"], &Value::Object(change.info.clone()));
        let info = complete(
            &member_shape(service, "info"),
            Some(&merged),
            "info",
            &format!("{here}.info"),
            now_ms,
        )?;
        object.insert("info".to_owned(), info);
    }
    if let Some(event) = &change.event {
        let event = build_event(
            &format!("{here}.event"),
            service,
            game,
            object,
            event,
            state.seq + 1,
            now_ms,
        )?;
        state.seq += 1;
        let events = object
            .entry("events")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Value::Array(events) = events {
            events.push(event);
            let window = usize::try_from(SERVICE_EVENT_WINDOW.value).unwrap_or(usize::MAX);
            if events.len() > window {
                events.drain(..events.len() - window);
            }
        }
    }
    if !service_returns(service).is_some_and(|shape| shape.matches(&state.value)) {
        return Err(ScenarioError::new(
            here,
            format!("the value does not have the shape of the `{service}` result"),
        ));
    }
    Ok(state)
}

fn member_shape(service: &str, member: &str) -> Shape {
    match service_returns(service).map(resolve) {
        Some(Shape::Record(top)) => top
            .iter()
            .find(|item| item.name == member)
            .map_or(Shape::Json, |item| item.shape),
        _ => Shape::Json,
    }
}

/// The alternative of the game's event shape whose `type` names `event`:
/// the member it carries beside `seq`, `at` and `type`, if any.
fn event_form(service: &str, event: &str) -> Option<Option<Member>> {
    let Shape::List(item) = member_shape(service, "events") else {
        return None;
    };
    let Shape::OneOf(alternatives) = resolve(*item) else {
        return None;
    };
    alternatives.iter().find_map(|alternative| {
        let Shape::Record(members) = resolve(*alternative) else {
            return None;
        };
        let named = members.iter().any(|member| {
            member.name == "type"
                && matches!(member.shape, Shape::Keyword(words) if words.contains(&event))
        });
        named.then(|| {
            members
                .iter()
                .find(|member| !matches!(member.name, "seq" | "at" | "type"))
                .copied()
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn build_event(
    path: &str,
    service: &str,
    game: &str,
    value: &Map<String, Value>,
    event: &Value,
    seq: u64,
    now_ms: u64,
) -> Result<Value, ScenarioError> {
    let empty = Map::new();
    let (kind, given) = match event {
        Value::String(kind) => (kind.as_str(), &empty),
        Value::Object(given) => match given.get("type").and_then(Value::as_str) {
            Some(kind) => (kind, given),
            None => return Err(ScenarioError::new(path, "an event names its `type`")),
        },
        _ => return Err(ScenarioError::new(path, "a type or `{ type, … }`")),
    };
    if feature_of_event(game, kind).is_none() {
        return Err(ScenarioError::new(path, "no event of this type"));
    }
    let Some(carried) = event_form(service, kind) else {
        return Err(ScenarioError::new(path, "no event of this type"));
    };
    let mut out = Map::new();
    out.insert("seq".to_owned(), json!(seq));
    let at = match given.get("at") {
        Some(at) if Shape::Integer.matches(at) => at.clone(),
        Some(_) => {
            return Err(ScenarioError::new(
                format!("{path}.at"),
                "Unix milliseconds",
            ));
        }
        None => json!(now_ms),
    };
    out.insert("at".to_owned(), at);
    out.insert("type".to_owned(), json!(kind));
    for key in given.keys() {
        let known = matches!(key.as_str(), "type" | "at")
            || carried.is_some_and(|member| member.name == key.as_str());
        if !known {
            return Err(ScenarioError::new(
                path,
                format!("this type carries no `{}`", crate::report::neutral(key)),
            ));
        }
    }
    if let Some(member) = carried {
        let state = match given.get(member.name) {
            Some(state) => complete(
                &member.shape,
                Some(state),
                member.name,
                &format!("{path}.{}", member.name),
                now_ms,
            )?,
            None => match current_state(value, member.name) {
                Some(state) => state,
                None => {
                    return Err(ScenarioError::new(
                        path,
                        format!(
                            "give the event's `{}`, or set it in `info` first",
                            member.name
                        ),
                    ));
                }
            },
        };
        out.insert(member.name.to_owned(), state);
    }
    Ok(Value::Object(out))
}

/// The state an event carries when the step does not give it: the `info`
/// member of the same name, or the latest Eidolon of the night.
fn current_state(value: &Map<String, Value>, name: &str) -> Option<Value> {
    let info = value.get("info")?;
    let state = match name {
        "eidolon" => info["eidolons"]["hunts"].as_array()?.last()?.clone(),
        _ => info.get(name)?.clone(),
    };
    (!state.is_null()).then_some(state)
}

/// `patch` merged into `current`: objects member by member, anything else
/// replaced.
fn merge(current: &Value, patch: &Value) -> Value {
    match (current, patch) {
        (Value::Object(current), Value::Object(patch)) => {
            let mut merged = current.clone();
            for (key, value) in patch {
                let next = merge(current.get(key).unwrap_or(&Value::Null), value);
                merged.insert(key.clone(), next);
            }
            Value::Object(merged)
        }
        (_, patch) => patch.clone(),
    }
}

/// `value` completed to `shape`: an absent nullable member is `null`, a
/// list `[]`, a boolean `false`, a time (`…At`, `since`) `now_ms` and
/// another integer `0`; any other absent member, a value of the wrong
/// shape or an unknown member is an error at its path.
fn complete(
    shape: &Shape,
    value: Option<&Value>,
    name: &str,
    path: &str,
    now_ms: u64,
) -> Result<Value, ScenarioError> {
    match shape {
        Shape::Named(named) => match results::shape(named) {
            Some(named) => complete(&named.shape, value, name, path, now_ms),
            None => Err(ScenarioError::new(path, "unknown shape")),
        },
        Shape::Nullable(inner) => match value {
            None | Some(Value::Null) => Ok(Value::Null),
            Some(value) => complete(inner, Some(value), name, path, now_ms),
        },
        Shape::Record(members) => {
            let empty = Map::new();
            let object = match value {
                None => &empty,
                Some(Value::Object(object)) => object,
                Some(_) => return Err(ScenarioError::new(path, "an object")),
            };
            if let Some(key) = object
                .keys()
                .find(|key| !members.iter().any(|member| member.name == key.as_str()))
            {
                return Err(ScenarioError::new(
                    format!("{path}.{}", crate::report::neutral(key)),
                    "no such member",
                ));
            }
            let mut out = Map::new();
            for member in *members {
                let completed = complete(
                    &member.shape,
                    object.get(member.name),
                    member.name,
                    &format!("{path}.{}", member.name),
                    now_ms,
                )?;
                out.insert(member.name.to_owned(), completed);
            }
            Ok(Value::Object(out))
        }
        Shape::List(item) => match value {
            None => Ok(Value::Array(Vec::new())),
            Some(Value::Array(items)) => items
                .iter()
                .enumerate()
                .map(|(index, entry)| {
                    complete(item, Some(entry), name, &format!("{path}[{index}]"), now_ms)
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Some(_) => Err(ScenarioError::new(path, "a list")),
        },
        Shape::Integer if value.is_none() => Ok(if name.ends_with("At") || name == "since" {
            json!(now_ms)
        } else {
            json!(0)
        }),
        Shape::Bool if value.is_none() => Ok(Value::Bool(false)),
        _ => match value {
            None => Err(ScenarioError::new(path, "missing")),
            Some(value) if shape.matches(value) => Ok(value.clone()),
            Some(_) => Err(ScenarioError::new(path, "not of the expected shape")),
        },
    }
}

/// The features of the game a step changes, each with the path that names
/// it: its `info` members, the features it sets other than `undeclared`,
/// and its event's.
pub(crate) fn touched_features(path: &str, step: &GameEventsStep) -> Vec<(String, String)> {
    let Ok((game, change)) = one_game(path, step) else {
        return Vec::new();
    };
    let here = format!("{path}.gameEvents.{game}");
    let known = |feature: &str| {
        GAME_EVENT_FEATURES
            .iter()
            .any(|declared| declared.game == game && declared.feature == feature)
    };
    let mut touched = Vec::new();
    for key in change.info.keys().filter(|key| known(key)) {
        touched.push((format!("{here}.info.{key}"), format!("{game}.{key}")));
    }
    for (key, status) in &change.features {
        if known(key) && *status != "undeclared" {
            touched.push((format!("{here}.features.{key}"), format!("{game}.{key}")));
        }
    }
    let kind = match &change.event {
        Some(Value::String(kind)) => Some(kind.as_str()),
        Some(Value::Object(event)) => event.get("type").and_then(Value::as_str),
        _ => None,
    };
    if let Some(feature) = kind.and_then(|kind| feature_of_event(game, kind)) {
        touched.push((format!("{here}.event"), format!("{game}.{feature}")));
    }
    touched
}
