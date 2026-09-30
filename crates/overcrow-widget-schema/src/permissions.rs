//! Manifest permissions and host capabilities (ADR 0001, D7). Declaring either
//! grants nothing: activation requires consent recorded by the host.

use crate::limits::{MAX_ENUM_VALUES, MAX_HTTP_DECLARED_RESPONSE_BYTES, MAX_NETWORK_PATH_BYTES};
use crate::model::{Field, Status, ValueType};

/// How a permission combines with a sensitive capability.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SensitiveRule {
    Allowed,
    /// The manifest is rejected.
    Forbidden,
    /// Allowed, but data lives only as long as the VM process.
    ProcessLifetime,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Permission {
    pub name: &'static str,
    pub summary: &'static str,
    pub with_sensitive: SensitiveRule,
}

pub const PERMISSIONS: &[Permission] = &[
    Permission {
        name: "network",
        summary: "Exact HTTPS routes reachable through the host broker, at most `MAX_NETWORK_RULES` rules.",
        with_sensitive: SensitiveRule::Forbidden,
    },
    Permission {
        name: "storage",
        summary: "Host-managed key-value storage partitioned by widget ID, within `STORAGE_QUOTA_BYTES`.",
        with_sensitive: SensitiveRule::ProcessLifetime,
    },
    Permission {
        name: "clipboardWrite",
        summary: "Text clipboard writes on a current Interactive gesture.",
        with_sensitive: SensitiveRule::Forbidden,
    },
    Permission {
        name: "gameEvents",
        summary: "Named semantic game events `overcrow.game.<name>.v1`, at most `MAX_GAME_EVENTS`.",
        with_sensitive: SensitiveRule::Allowed,
    },
    Permission {
        name: "capabilities",
        summary: "Host services listed below.",
        with_sensitive: SensitiveRule::Allowed,
    },
];

/// One network rule; the grammar and matcher of the Web runtime are kept
/// unchanged, `pathPrefix` stays rejected.
pub const NETWORK_RULE_FIELDS: &[Field] = &[
    Field::required(
        "origin",
        ValueType::Record("origin"),
        "Canonical `https://host[:port]` origin, host ≤ `MAX_DNS_NAME_BYTES` with labels ≤ `MAX_DNS_LABEL_BYTES`; no credentials, IP literal or local name.",
    ),
    Field::required(
        "method",
        ValueType::Keyword(&["GET", "POST", "PUT", "PATCH", "DELETE"]),
        "One method.",
    ),
    Field::required(
        "path",
        ValueType::Text(&MAX_NETWORK_PATH_BYTES),
        "Complete path; `{name}` segments are typed path parameters.",
    ),
    Field::optional(
        "pathParams",
        ValueType::Record("name → ParameterConstraint"),
        "Constraint of every `{name}` segment, at most `MAX_PATH_PARAMS`.",
    ),
    Field::optional(
        "queryParams",
        ValueType::Record("name → ParameterConstraint"),
        "Allowed query parameters, at most `MAX_QUERY_PARAMS`, each optionally `required`; others are refused.",
    ),
    Field::optional(
        "maxResponseBytes",
        ValueType::Integer {
            min: 1,
            max: MAX_HTTP_DECLARED_RESPONSE_BYTES.value as i64,
        },
        "Largest response body of this route, 1..=`MAX_HTTP_DECLARED_RESPONSE_BYTES`; `MAX_HTTP_RESPONSE_BYTES` when absent. Not for `as: \"image\"`, which keeps `MAX_HTTP_RESPONSE_BYTES`. When several rules allow a request, the largest bound applies.",
    ),
];

/// `ParameterConstraint` types, discriminated by `type`.
pub const PARAMETER_CONSTRAINTS: &[Field] = &[
    Field::required(
        "integer",
        ValueType::Record("{ min, max }"),
        "Decimal without leading zero, 0..=2^53 - 1.",
    ),
    Field::required(
        "slug",
        ValueType::Record("{ maxLength }"),
        "ASCII letters of either case, digits, `_` and `-`, at least one character, as the broker matches it; `maxLength` 1..=`MAX_SLUG_PARAMETER_BYTES`.",
    ),
    Field::required(
        "enum",
        ValueType::ListOf("literal segment", &MAX_ENUM_VALUES),
        "One of the listed values, each ≤ `MAX_ENUM_VALUE_BYTES`.",
    ),
    Field::required(
        "string",
        ValueType::Record("{ maxLength }"),
        "Query parameters only; any text without control characters; `maxLength` 1..=`MAX_STRING_PARAMETER_BYTES`.",
    ),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Capability {
    pub name: &'static str,
    pub summary: &'static str,
    /// Sensitive capabilities exclude `network` and `clipboardWrite` and make
    /// `storage` process-lifetime only.
    pub sensitive: bool,
    /// Account connection the host must hold before the service answers.
    pub account: Option<&'static str>,
    pub status: Status,
}

const fn capability(
    name: &'static str,
    sensitive: bool,
    account: Option<&'static str>,
    status: Status,
    summary: &'static str,
) -> Capability {
    Capability {
        name,
        summary,
        sensitive,
        account,
        status,
    }
}

const PLAYERVOX: Option<&str> = Some("PlayerVox");
const TWITCH: Option<&str> = Some("Twitch");

pub const CAPABILITIES: &[Capability] = &[
    capability(
        "telemetry.read",
        false,
        None,
        Status::Fixed,
        "CPU, RAM and temperature samples of the active game.",
    ),
    capability(
        "fps.read",
        false,
        None,
        Status::Fixed,
        "Frame rate of the active game when the host has a source.",
    ),
    capability(
        "media.read",
        true,
        None,
        Status::Fixed,
        "Now-playing metadata and cover art handle.",
    ),
    capability(
        "media.control",
        true,
        None,
        Status::Fixed,
        "Previous, play/pause and next.",
    ),
    capability(
        "session.read",
        false,
        None,
        Status::Fixed,
        "Duration of the active game session, without the game identity.",
    ),
    capability(
        "stopwatch.read",
        false,
        None,
        Status::Fixed,
        "State of the host's single manual stopwatch and its shortcuts.",
    ),
    capability(
        "stopwatch.control",
        false,
        None,
        Status::Fixed,
        "Start, pause and reset the host's single manual stopwatch.",
    ),
    capability(
        "notes.read",
        true,
        None,
        Status::Fixed,
        "The user's notes and checklists: one document shared by every game.",
    ),
    capability(
        "notes.write",
        true,
        None,
        Status::Fixed,
        "Create, select, save, check and delete notes; text only through host-bound intents.",
    ),
    capability(
        "playervox.score.read",
        true,
        None,
        Status::Fixed,
        "Public PlayerVox score of the active game; sensitive because it reveals the game.",
    ),
    capability(
        "playervox.rating.read",
        true,
        PLAYERVOX,
        Status::Fixed,
        "The user's own rating of the active game.",
    ),
    capability(
        "playervox.rating.write",
        true,
        PLAYERVOX,
        Status::Fixed,
        "Publish a rating and review through a host-bound intent.",
    ),
    capability(
        "playervox.reviews.read",
        true,
        PLAYERVOX,
        Status::Fixed,
        "Paged player reviews of the active game, optionally from followed players only.",
    ),
    capability(
        "journal.read",
        true,
        None,
        Status::Fixed,
        "Play sessions of the active game: local ones, plus cloud ones while PlayerVox is connected.",
    ),
    capability(
        "journal.delete",
        true,
        None,
        Status::Fixed,
        "Delete a journal session after native confirmation; cloud rows need PlayerVox.",
    ),
    capability(
        "twitch.chat.read",
        true,
        TWITCH,
        Status::Fixed,
        "Join, read and leave a Twitch channel chat, and keep favourite channels.",
    ),
    capability(
        "twitch.chat.compose",
        true,
        TWITCH,
        Status::Fixed,
        "Send a chat message through a host-bound intent; the host allows 20 messages per 30 s and answers `busy` beyond.",
    ),
];

pub fn permission(name: &str) -> Option<&'static Permission> {
    PERMISSIONS
        .iter()
        .find(|permission| permission.name == name)
}

pub fn capability_named(name: &str) -> Option<&'static Capability> {
    CAPABILITIES
        .iter()
        .find(|capability| capability.name == name)
}
