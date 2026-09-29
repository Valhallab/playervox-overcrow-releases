//! Test scenarios of widget API v1 (`docs/widget-testing.md`).
//!
//! A scenario is one JSON file of a widget project, `tests/<name>.scenario.json`.
//! It fixes the host (locale, theme, scale, size, mode, region and time
//! zone, virtual start time, grants, accounts), the answers of the services
//! (fixtures), then plays steps: host changes, input, menu rows, service
//! updates, virtual time, and expectations (reference images, visible text,
//! service calls, state, fault).
//!
//! `overcrow-widget test` checks a scenario with [`parse`] and
//! [`Scenario::check_against`] before it starts the headless runtime, which
//! reads it with the same code. Unknown fields, unknown names and values out
//! of bounds are refused; a fixture that does not have the shape of the
//! service's result is an error of the scenario, never of the widget.
//!
//! [`report`] holds the headless runtime's command-line interface and the
//! report it prints.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use overcrow_widget_schema::ipc::FAULT_CATEGORY_NAMES;
use overcrow_widget_schema::limits::{
    MAX_CLIPBOARD_BYTES, MAX_CONTENT_SCALE, MAX_HTTP_RESPONSE_BYTES, MAX_REQUEST_URL_BYTES,
    MAX_STORAGE_KEY_BYTES, MAX_STORAGE_KEYS, MAX_STORAGE_VALUE_BYTES, MIN_CONTENT_SCALE,
    STORAGE_QUOTA_BYTES,
};
use overcrow_widget_schema::manifest::Manifest;
use overcrow_widget_schema::permissions::capability_named;
use overcrow_widget_schema::services::{Requirement, SERVICE_ERRORS, ServiceKind, service};
use overcrow_widget_schema::wrapper::HOST_FEATURES;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub mod report;

/// The scenario format this crate reads.
pub const SCENARIO_VERSION: u32 = 1;
/// The versions a runtime built from this crate plays.
pub const SUPPORTED_SCENARIO_VERSIONS: &[u32] = &[SCENARIO_VERSION];

/// The file suffix of a scenario in a project's `tests/` directory.
pub const SCENARIO_SUFFIX: &str = ".scenario.json";

/// A scenario file, in bytes.
pub const MAX_SCENARIO_BYTES: usize = 2 * 1024 * 1024;
/// Scenario and capture names (`[a-z0-9][a-z0-9-]*`).
pub const MAX_NAME_BYTES: usize = 64;
/// The description, in characters.
pub const MAX_DESCRIPTION_CHARS: usize = 1024;
pub const MAX_STEPS: usize = 512;
/// Reference images of one scenario.
pub const MAX_CAPTURES: usize = 64;
/// Fixture answers of one scenario: call answers, HTTP answers and
/// confirmations together.
pub const MAX_FIXTURES: usize = 256;
/// Texts of a `text` step, of a `text` or `noText` expectation, a target's
/// text or label, in characters.
pub const MAX_TEXT_CHARS: usize = 1024;
/// Texts listed by one expectation.
pub const MAX_EXPECTED_TEXTS: usize = 32;
/// Calls listed by one expectation.
pub const MAX_EXPECTED_CALLS: usize = 64;
/// One `advance`, and every `advance` of a scenario together: 400 days, the
/// horizon of `region.nextChangeAt`.
pub const MAX_ADVANCE_MS: u64 = 400 * 86_400_000;
/// Offset changes of the scenario's time zone.
pub const MAX_TRANSITIONS: usize = 16;
/// Largest widget side, logical px. At the largest scale an image side
/// stays within [`MAX_IMAGE_SIDE_PX`].
pub const MAX_SIDE: u32 = 1024;
/// Largest image side, physical px.
pub const MAX_IMAGE_SIDE_PX: u32 = 1792;
/// A content type of an HTTP fixture: the host broker's bound.
pub const MAX_HTTP_CONTENT_TYPE_BYTES: usize = 128;
/// A time zone offset, minutes (the `Region` message's range).
pub const MAX_OFFSET_MINUTES: i32 = 840;
/// Largest Unix millisecond a JavaScript number holds exactly.
pub const MAX_UNIX_MS: u64 = (1 << 53) - 1;
/// The virtual start time when a scenario gives none:
/// 2026-01-01T00:00:00Z.
pub const DEFAULT_START_AT: u64 = 1_767_225_600_000;

/// Service calls the scenario's `calls` expectations leave out: the SDK's
/// own timers.
pub const UNLISTED_CALLS: &[&str] = &["timer.start", "timer.cancel"];

/// Error codes a fixture may not answer: the host gives them itself from
/// the grants, the accounts, the gesture rule and the parameter checks,
/// which the headless runtime applies as the overlay does.
pub const HOST_CHECK_ERRORS: &[&str] = &[
    "permission_denied",
    "gesture_required",
    "not_connected",
    "invalid_request",
];

/// Error codes an HTTP fixture may answer: what the broker reports once the
/// request passed the manifest's network rules.
pub const HTTP_FIXTURE_ERRORS: &[&str] = &[
    "resolve_failed",
    "address_denied",
    "too_many_addresses",
    "peer_mismatch",
    "redirect_denied",
    "encoding_denied",
    "content_type_denied",
    "response_metadata_limit",
    "response_body_limit",
    "timeout",
    "transport_failed",
    "busy",
];

/// Keys a `key` step presses (egui key names).
pub const KEYS: &[&str] = &[
    "Enter",
    "Tab",
    "Escape",
    "Space",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
];

// ---------------------------------------------------------------------
// The format.

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub scenario_version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub host: Host,
    #[serde(default)]
    pub fixtures: Fixtures,
    pub steps: Vec<Step>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    En,
    Fr,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Passive,
    Interactive,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NumberFormat {
    #[default]
    Us,
    Fr,
    De,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DateOrder {
    Mdy,
    Dmy,
    Ymd,
}

/// Widget size, logical px.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

/// The user's regional preferences. `dateOrder` follows the locale when
/// absent (`en` `mdy`, `fr` `dmy`), as on the host.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    #[serde(default)]
    pub number_format: NumberFormat,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_order: Option<DateOrder>,
}

impl Region {
    pub fn date_order(&self, locale: Locale) -> DateOrder {
        self.date_order.unwrap_or(match locale {
            Locale::En => DateOrder::Mdy,
            Locale::Fr => DateOrder::Dmy,
        })
    }
}

/// The user's time zone: the UTC offset before the first transition, then
/// each transition's offset from its instant on.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Zone {
    #[serde(default)]
    pub offset_minutes: i32,
    #[serde(default)]
    pub transitions: Vec<Transition>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transition {
    /// Unix milliseconds.
    pub at: u64,
    pub offset_minutes: i32,
}

impl Zone {
    /// The offset in force at `now_ms` and the next change after it: the
    /// `offsetMinutes` and `nextChangeAt` of the `Region` the host sends.
    pub fn at(&self, now_ms: u64) -> (i32, Option<u64>) {
        let offset = self
            .transitions
            .iter()
            .take_while(|transition| transition.at <= now_ms)
            .last()
            .map_or(self.offset_minutes, |transition| transition.offset_minutes);
        let next = self
            .transitions
            .iter()
            .find(|transition| transition.at > now_ms)
            .map(|transition| transition.at);
        (offset, next)
    }
}

/// The items granted: every declared one, or exactly these.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Grants {
    Declared(Declared),
    Items(BTreeSet<String>),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Declared {
    Declared,
}

impl Default for Grants {
    fn default() -> Self {
        Self::Declared(Declared::Declared)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountState {
    #[default]
    Connected,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Accounts {
    #[serde(default)]
    pub playervox: AccountState,
    #[serde(default)]
    pub twitch: AccountState,
}

/// The host at the start of the scenario.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Host {
    #[serde(default)]
    pub locale: Locale,
    #[serde(default)]
    pub theme: Theme,
    /// Content scale in ‰, as `overcrow.host.scale`: 1000 is 100 %.
    #[serde(default = "default_scale")]
    pub scale: u32,
    /// The manifest's preferred size when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default = "yes")]
    pub visible: bool,
    /// Captures include the host wrapper around the content.
    #[serde(default)]
    pub frame: bool,
    /// `#rrggbb` behind the widget; the theme's overlay panel colour when
    /// absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default)]
    pub region: Region,
    #[serde(default)]
    pub zone: Zone,
    /// Virtual Unix milliseconds when the widget starts.
    #[serde(default = "default_start_at")]
    pub start_at: u64,
    /// Values of the manifest's `wrapper.menu` rows; defaults otherwise.
    #[serde(default)]
    pub options: Map<String, Value>,
    #[serde(default)]
    pub grants: Grants,
    #[serde(default)]
    pub accounts: Accounts,
    /// Host data sources of this machine (`requires` rows); all of them
    /// when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub features: Option<BTreeSet<String>>,
    /// The widget's storage before it starts.
    #[serde(default)]
    pub storage: Map<String, Value>,
}

impl Default for Host {
    fn default() -> Self {
        Self {
            locale: Locale::default(),
            theme: Theme::default(),
            scale: default_scale(),
            size: None,
            mode: Mode::default(),
            visible: true,
            frame: false,
            background: None,
            region: Region::default(),
            zone: Zone::default(),
            start_at: DEFAULT_START_AT,
            options: Map::new(),
            grants: Grants::default(),
            accounts: Accounts::default(),
            features: None,
            storage: Map::new(),
        }
    }
}

const fn default_scale() -> u32 {
    1000
}

const fn default_start_at() -> u64 {
    DEFAULT_START_AT
}

const fn yes() -> bool {
    true
}

/// Physical pixels of `logical` px at `scale` ‰, rounded to the nearest.
pub fn pixels(logical: u32, scale: u32) -> u32 {
    ((u64::from(logical) * u64::from(scale) + 500) / 1000) as u32
}

/// Answers of the services.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fixtures {
    /// Provider-backed calls (`stopwatch.toggle`…): answers in call order.
    /// A call beyond them is an error of the scenario.
    #[serde(default)]
    pub calls: BTreeMap<String, Vec<Reply>>,
    /// Capability subscriptions (`fps.subscribe`…): the value at the start;
    /// `publish` steps send the next ones. No data until then when absent.
    #[serde(default)]
    pub subscriptions: BTreeMap<String, Value>,
    /// `http.fetch` answers, each used once, in order among those matching a
    /// request. The manifest's network rules still apply first.
    #[serde(default)]
    pub http: Vec<HttpFixture>,
    /// Answers to the host's native confirmations, in order.
    #[serde(default)]
    pub confirmations: Vec<Confirmation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Reply {
    Value(Value),
    Error(String),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpFixture {
    pub request: HttpRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<HttpResponse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
}

/// What the broker returns: a status, the one content type and the body,
/// as text or in base64 (images). Redirections are refused by the broker
/// (`redirect_denied`), so no 3xx.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpResponse {
    pub status: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
}

impl HttpResponse {
    /// The body's bytes; `None` for invalid base64.
    pub fn body_bytes(&self) -> Option<Vec<u8>> {
        match (&self.body, &self.body_base64) {
            (Some(text), None) => Some(text.as_bytes().to_vec()),
            (None, Some(encoded)) => base64_decode(encoded),
            _ => Some(Vec::new()),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confirmation {
    Accept,
    Cancel,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Step {
    /// Moves the virtual clock forward; due timers fire in order.
    Advance(Advance),
    Host(HostChange),
    Pointer(Pointer),
    Key(Key),
    /// Types text into the focused field (committed input).
    Text(String),
    /// Chooses a `wrapper.menu` row, as the user does in the host menu.
    Menu(MenuStep),
    /// The next value of a capability subscription.
    Publish(Publish),
    Expect(Box<Expect>),
}

/// Moves the virtual clock by `ms`. By default every timer due on the way
/// fires in order, as on a running machine; the runtime paces the ticks to
/// stay within the host's real-time message rate, so hours of minute ticks
/// take seconds. With `jump`, the time moves at once, as on a machine
/// waking from sleep: each due timer fires once, late.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Advance {
    pub ms: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub jump: bool,
}

/// Host changes; absent members keep their value.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostChange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<Locale>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<Mode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<Region>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone: Option<Zone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accounts: Option<Accounts>,
}

impl HostChange {
    fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// Where a pointer step acts: a point of the capture in logical px, the
/// first element showing exactly this text, or the first element with
/// this accessible label.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Pointer {
    /// Press and release of the primary button: a gesture in Interactive
    /// mode.
    Click(Target),
    RightClick(Target),
    /// Hover.
    Move(Target),
    /// The pointer leaves the widget.
    Leave,
    Wheel(Wheel),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Wheel {
    pub target: Target,
    /// Lines; positive `dy` scrolls down.
    #[serde(default)]
    pub dx: f32,
    #[serde(default)]
    pub dy: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    Shift,
    Ctrl,
    Alt,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Key {
    pub key: String,
    #[serde(default)]
    pub modifiers: BTreeSet<Modifier>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MenuStep {
    pub id: String,
    /// The new value of a `toggle`, `slider` or `choice` row; absent for an
    /// `action` row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Publish {
    pub service: String,
    pub value: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExpectedState {
    Starting,
    Running,
    Restarting,
    Failed,
    Refused,
    Stopped,
}

impl ExpectedState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Restarting => "restarting",
            Self::Failed => "failed",
            Self::Refused => "refused",
            Self::Stopped => "stopped",
        }
    }
}

/// What must hold after the previous steps settled. At least one member.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expect {
    /// A reference image: `tests/reference/<scenario>/<image>.png`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Texts the widget shows (each one is the whole text of an element).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<Vec<String>>,
    /// Texts the widget does not show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_text: Option<Vec<String>>,
    /// Exactly the calls since the previous `calls` expectation (or the
    /// start), in order, without [`UNLISTED_CALLS`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<Vec<ExpectedCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<ExpectedState>,
    /// The last fault category of the VM since the start, or `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault: Option<String>,
    /// The last text written to the clipboard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clipboard: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedCall {
    pub service: String,
    /// The exact parameters, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    /// `ok` or the error code the widget received, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
}

// ---------------------------------------------------------------------
// Checks.

/// Why a scenario is refused: where (`steps[3].pointer.click`) and what.
/// Messages quote no scenario text beyond names already checked.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScenarioError {
    pub path: String,
    pub message: String,
}

impl ScenarioError {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for ScenarioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            formatter.write_str(&self.message)
        } else {
            write!(formatter, "{}: {}", self.path, self.message)
        }
    }
}

impl std::error::Error for ScenarioError {}

type Checked = Result<(), ScenarioError>;

/// Reads and checks a scenario file.
pub fn parse(bytes: &[u8]) -> Result<Scenario, ScenarioError> {
    if bytes.len() > MAX_SCENARIO_BYTES {
        return Err(ScenarioError::new("", "the file is too large"));
    }
    // The version first, so that a future format is named as such.
    let version = serde_json::from_slice::<Value>(bytes)
        .map_err(|error| ScenarioError::new("", format!("invalid JSON: {error}")))?
        .get("scenarioVersion")
        .and_then(Value::as_u64);
    match version {
        Some(version) if SUPPORTED_SCENARIO_VERSIONS.contains(&(version as u32)) => {}
        Some(_) => {
            return Err(ScenarioError::new(
                "scenarioVersion",
                "unsupported scenario version",
            ));
        }
        None => return Err(ScenarioError::new("scenarioVersion", "missing or invalid")),
    }
    let scenario: Scenario =
        serde_json::from_slice(bytes).map_err(|error| ScenarioError::new("", error.to_string()))?;
    scenario.check()?;
    Ok(scenario)
}

fn valid_name(name: &str) -> bool {
    (1..=MAX_NAME_BYTES).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// A text of the scenario: bounded, without control characters.
fn check_text(path: &str, text: &str) -> Checked {
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Err(ScenarioError::new(path, "empty or too long"));
    }
    if text.chars().any(char::is_control) {
        return Err(ScenarioError::new(path, "control characters are refused"));
    }
    Ok(())
}

fn check_scale(path: &str, scale: u32) -> Checked {
    if !(MIN_CONTENT_SCALE.value..=MAX_CONTENT_SCALE.value).contains(&u64::from(scale)) {
        return Err(ScenarioError::new(
            path,
            format!(
                "the scale is in ‰, from {} to {}",
                MIN_CONTENT_SCALE.value, MAX_CONTENT_SCALE.value
            ),
        ));
    }
    Ok(())
}

fn check_size(path: &str, size: Size) -> Checked {
    if !(1..=MAX_SIDE).contains(&size.width) || !(1..=MAX_SIDE).contains(&size.height) {
        return Err(ScenarioError::new(
            path,
            format!("each side is from 1 to {MAX_SIDE} logical px"),
        ));
    }
    Ok(())
}

fn check_offset(path: &str, offset: i32) -> Checked {
    if !(-MAX_OFFSET_MINUTES..=MAX_OFFSET_MINUTES).contains(&offset) {
        return Err(ScenarioError::new(
            path,
            format!("offsets are from -{MAX_OFFSET_MINUTES} to {MAX_OFFSET_MINUTES} minutes"),
        ));
    }
    Ok(())
}

fn check_zone(path: &str, zone: &Zone) -> Checked {
    check_offset(&format!("{path}.offsetMinutes"), zone.offset_minutes)?;
    if zone.transitions.len() > MAX_TRANSITIONS {
        return Err(ScenarioError::new(
            format!("{path}.transitions"),
            format!("at most {MAX_TRANSITIONS} transitions"),
        ));
    }
    let mut previous: Option<u64> = None;
    for (index, transition) in zone.transitions.iter().enumerate() {
        let here = format!("{path}.transitions[{index}]");
        check_offset(&format!("{here}.offsetMinutes"), transition.offset_minutes)?;
        if transition.at > MAX_UNIX_MS || previous.is_some_and(|at| transition.at <= at) {
            return Err(ScenarioError::new(
                format!("{here}.at"),
                "transitions are strictly increasing Unix milliseconds",
            ));
        }
        previous = Some(transition.at);
    }
    Ok(())
}

fn check_background(path: &str, colour: &str) -> Checked {
    let valid = colour.len() == 7
        && colour.starts_with('#')
        && colour[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err(ScenarioError::new(path, "a colour is written #rrggbb"));
    }
    Ok(())
}

fn check_target(path: &str, target: &Target) -> Checked {
    let given = usize::from(target.at.is_some())
        + usize::from(target.text.is_some())
        + usize::from(target.label.is_some());
    if given != 1 {
        return Err(ScenarioError::new(
            path,
            "give exactly one of `at`, `text` and `label`",
        ));
    }
    if let Some([x, y]) = target.at
        && !(x.is_finite()
            && y.is_finite()
            && (0.0..=MAX_SIDE as f32).contains(&x)
            && (0.0..=MAX_SIDE as f32).contains(&y))
    {
        return Err(ScenarioError::new(
            format!("{path}.at"),
            format!("a point of the widget, from 0 to {MAX_SIDE} logical px"),
        ));
    }
    if let Some(text) = &target.text {
        check_text(&format!("{path}.text"), text)?;
    }
    if let Some(label) = &target.label {
        check_text(&format!("{path}.label"), label)?;
    }
    Ok(())
}

/// A consentable item: a permission or a capability name.
fn is_item(name: &str) -> bool {
    matches!(
        name,
        "network" | "storage" | "clipboardWrite" | "gameEvents"
    ) || capability_named(name).is_some()
}

fn check_error_code(path: &str, code: &str) -> Checked {
    if !SERVICE_ERRORS.contains(&code) {
        return Err(ScenarioError::new(path, "not a service error code"));
    }
    if HOST_CHECK_ERRORS.contains(&code) {
        return Err(ScenarioError::new(
            path,
            "the host answers this code itself: use `host.grants`, `host.accounts`, Interactive input or the call's parameters",
        ));
    }
    Ok(())
}

/// A provider-backed call: its answers come from the fixtures.
fn provider_call(name: &str) -> Option<&'static overcrow_widget_schema::services::Service> {
    service(name).filter(|service| {
        service.kind == ServiceKind::Call && matches!(service.requires, Requirement::Capability(_))
    })
}

/// A subscription whose data comes from the fixtures.
fn data_subscription(name: &str) -> Option<&'static overcrow_widget_schema::services::Service> {
    service(name).filter(|service| {
        service.kind == ServiceKind::Subscribe
            && matches!(
                service.requires,
                Requirement::Capability(_) | Requirement::Permission("gameEvents")
            )
    })
}

fn check_value(path: &str, service: &str, value: &Value) -> Checked {
    let expected = service_returns(service);
    if !expected.is_some_and(|shape| shape.matches(value)) {
        return Err(ScenarioError::new(
            path,
            format!("the value does not have the shape of the `{service}` result"),
        ));
    }
    Ok(())
}

fn service_returns(name: &str) -> Option<overcrow_widget_schema::results::Shape> {
    service(name).map(|service| service.returns)
}

fn json_bytes(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

impl Scenario {
    /// Every check that needs nothing but the scenario.
    pub fn check(&self) -> Checked {
        if !SUPPORTED_SCENARIO_VERSIONS.contains(&self.scenario_version) {
            return Err(ScenarioError::new(
                "scenarioVersion",
                "unsupported scenario version",
            ));
        }
        if !valid_name(&self.name) {
            return Err(ScenarioError::new(
                "name",
                format!("[a-z0-9][a-z0-9-]*, at most {MAX_NAME_BYTES} bytes"),
            ));
        }
        if let Some(description) = &self.description
            && (description.chars().count() > MAX_DESCRIPTION_CHARS
                || description.chars().any(|c| c.is_control() && c != '\n'))
        {
            return Err(ScenarioError::new(
                "description",
                "too long or with control characters",
            ));
        }
        self.check_host()?;
        self.check_fixtures()?;
        self.check_steps()
    }

    fn check_host(&self) -> Checked {
        let host = &self.host;
        check_scale("host.scale", host.scale)?;
        if let Some(size) = host.size {
            check_size("host.size", size)?;
        }
        if let Some(background) = &host.background {
            check_background("host.background", background)?;
        }
        check_zone("host.zone", &host.zone)?;
        if host.start_at > MAX_UNIX_MS - MAX_ADVANCE_MS {
            return Err(ScenarioError::new(
                "host.startAt",
                "Unix milliseconds, leaving room for the scenario's advances",
            ));
        }
        if let Grants::Items(items) = &host.grants
            && let Some(item) = items.iter().find(|item| !is_item(item))
        {
            return Err(ScenarioError::new(
                "host.grants",
                format!(
                    "unknown permission or capability `{}`",
                    report::neutral(item)
                ),
            ));
        }
        if let Some(features) = &host.features
            && features
                .iter()
                .any(|feature| !HOST_FEATURES.contains(&feature.as_str()))
        {
            return Err(ScenarioError::new(
                "host.features",
                format!("host data sources are {}", HOST_FEATURES.join(", ")),
            ));
        }
        if host.storage.len() > MAX_STORAGE_KEYS.value as usize {
            return Err(ScenarioError::new("host.storage", "too many keys"));
        }
        let mut total = 0_usize;
        for (key, value) in &host.storage {
            let size = json_bytes(value);
            if key.is_empty()
                || key.len() > MAX_STORAGE_KEY_BYTES.value as usize
                || key.chars().any(char::is_control)
            {
                return Err(ScenarioError::new(
                    "host.storage",
                    "a key is empty or too long",
                ));
            }
            if size > MAX_STORAGE_VALUE_BYTES.value as usize {
                return Err(ScenarioError::new("host.storage", "a value is too large"));
            }
            total = total.saturating_add(key.len()).saturating_add(size);
        }
        if total > STORAGE_QUOTA_BYTES.value as usize {
            return Err(ScenarioError::new(
                "host.storage",
                "beyond the storage quota",
            ));
        }
        Ok(())
    }

    fn check_fixtures(&self) -> Checked {
        let fixtures = &self.fixtures;
        let count = fixtures.calls.values().map(Vec::len).sum::<usize>()
            + fixtures.http.len()
            + fixtures.confirmations.len()
            + fixtures.subscriptions.len();
        if count > MAX_FIXTURES {
            return Err(ScenarioError::new(
                "fixtures",
                format!("at most {MAX_FIXTURES} answers"),
            ));
        }
        for (name, replies) in &fixtures.calls {
            let path = format!("fixtures.calls.{}", report::neutral(name));
            if provider_call(name).is_none() {
                return Err(ScenarioError::new(
                    path,
                    "not a provider call: storage, timers and the clipboard are the host's own, `http.fetch` answers come from `fixtures.http`",
                ));
            }
            for (index, reply) in replies.iter().enumerate() {
                let here = format!("{path}[{index}]");
                match reply {
                    Reply::Value(value) => check_value(&format!("{here}.value"), name, value)?,
                    Reply::Error(code) => check_error_code(&format!("{here}.error"), code)?,
                }
            }
        }
        for (name, value) in &fixtures.subscriptions {
            let path = format!("fixtures.subscriptions.{}", report::neutral(name));
            if data_subscription(name).is_none() {
                return Err(ScenarioError::new(path, "not a data subscription"));
            }
            check_value(&path, name, value)?;
        }
        for (index, fixture) in fixtures.http.iter().enumerate() {
            check_http(&format!("fixtures.http[{index}]"), fixture)?;
        }
        Ok(())
    }

    fn check_steps(&self) -> Checked {
        if self.steps.is_empty() || self.steps.len() > MAX_STEPS {
            return Err(ScenarioError::new(
                "steps",
                format!("from 1 to {MAX_STEPS} steps"),
            ));
        }
        let mut images = BTreeSet::new();
        let mut advanced = 0_u64;
        for (index, step) in self.steps.iter().enumerate() {
            let path = format!("steps[{index}]");
            match step {
                Step::Advance(advance) => {
                    advanced = advanced.saturating_add(advance.ms);
                    if advance.ms == 0 || advanced > MAX_ADVANCE_MS {
                        return Err(ScenarioError::new(
                            format!("{path}.advance.ms"),
                            format!("positive, at most {MAX_ADVANCE_MS} ms for the whole scenario"),
                        ));
                    }
                }
                Step::Host(change) => check_change(&format!("{path}.host"), change)?,
                Step::Pointer(pointer) => {
                    let here = format!("{path}.pointer");
                    match pointer {
                        Pointer::Click(target)
                        | Pointer::RightClick(target)
                        | Pointer::Move(target) => check_target(&here, target)?,
                        Pointer::Leave => {}
                        Pointer::Wheel(wheel) => {
                            check_target(&format!("{here}.wheel.target"), &wheel.target)?;
                            if !(wheel.dx.is_finite()
                                && wheel.dy.is_finite()
                                && wheel.dx.abs() <= 100.0
                                && wheel.dy.abs() <= 100.0)
                            {
                                return Err(ScenarioError::new(
                                    format!("{here}.wheel"),
                                    "at most 100 lines each way",
                                ));
                            }
                        }
                    }
                }
                Step::Key(key) => {
                    if !KEYS.contains(&key.key.as_str()) {
                        return Err(ScenarioError::new(
                            format!("{path}.key.key"),
                            "unknown key name",
                        ));
                    }
                }
                Step::Text(text) => check_text(&format!("{path}.text"), text)?,
                Step::Menu(menu) => {
                    if menu.id.is_empty() || menu.id.len() > MAX_NAME_BYTES {
                        return Err(ScenarioError::new(format!("{path}.menu.id"), "invalid"));
                    }
                }
                Step::Publish(publish) => {
                    let here = format!("{path}.publish");
                    if data_subscription(&publish.service).is_none() {
                        return Err(ScenarioError::new(
                            format!("{here}.service"),
                            "not a data subscription",
                        ));
                    }
                    check_value(&format!("{here}.value"), &publish.service, &publish.value)?;
                }
                Step::Expect(expect) => {
                    check_expect(&format!("{path}.expect"), expect)?;
                    if let Some(image) = &expect.image
                        && !images.insert(image.as_str())
                    {
                        return Err(ScenarioError::new(
                            format!("{path}.expect.image"),
                            "image names are unique in a scenario",
                        ));
                    }
                }
            }
        }
        if images.len() > MAX_CAPTURES {
            return Err(ScenarioError::new(
                "steps",
                format!("at most {MAX_CAPTURES} images"),
            ));
        }
        Ok(())
    }

    /// The images the scenario captures, in order.
    pub fn images(&self) -> Vec<&str> {
        self.steps
            .iter()
            .filter_map(|step| match step {
                Step::Expect(expect) => expect.image.as_deref(),
                _ => None,
            })
            .collect()
    }

    /// The checks that need the widget's manifest: grants within the
    /// declaration, menu rows and option values that exist, and the
    /// services a fixture answers declared.
    pub fn check_against(&self, manifest: &Manifest) -> Checked {
        let declared = declared_items(manifest);
        if let Grants::Items(items) = &self.host.grants
            && let Some(item) = items.difference(&declared).next()
        {
            return Err(ScenarioError::new(
                "host.grants",
                format!(
                    "`{}` is not declared by the manifest",
                    report::neutral(item)
                ),
            ));
        }
        let rows = menu_rows(manifest);
        for (id, value) in &self.host.options {
            let path = format!("host.options.{}", report::neutral(id));
            match rows.get(id.as_str()) {
                Some(row) if row.accepts(value) => {}
                Some(_) => return Err(ScenarioError::new(path, "not a value of this row")),
                None => return Err(ScenarioError::new(path, "no such menu row")),
            }
        }
        for (index, step) in self.steps.iter().enumerate() {
            let Step::Menu(menu) = step else {
                continue;
            };
            let path = format!("steps[{index}].menu");
            let Some(row) = rows.get(menu.id.as_str()) else {
                return Err(ScenarioError::new(format!("{path}.id"), "no such menu row"));
            };
            match (&menu.value, row) {
                (None, MenuRow::Action) => {}
                (Some(value), row) if row.accepts(value) => {}
                _ => {
                    return Err(ScenarioError::new(
                        format!("{path}.value"),
                        "a value of this row, or none for an action row",
                    ));
                }
            }
        }
        let requires = |name: &str| service(name).map(|service| service.requires);
        let answered = self
            .fixtures
            .calls
            .keys()
            .chain(self.fixtures.subscriptions.keys());
        for name in answered {
            let item = match requires(name) {
                Some(Requirement::Capability(capability)) => capability,
                Some(Requirement::Permission(permission)) => permission,
                _ => continue,
            };
            if !declared.contains(item) {
                return Err(ScenarioError::new(
                    format!("fixtures.{}", report::neutral(name)),
                    format!("the manifest does not declare `{item}`"),
                ));
            }
        }
        if !self.fixtures.http.is_empty() && !declared.contains("network") {
            return Err(ScenarioError::new(
                "fixtures.http",
                "the manifest does not declare `network`",
            ));
        }
        Ok(())
    }

    /// The widget's size: the scenario's, or the manifest's preferred one.
    pub fn size(&self, manifest: &Manifest) -> Option<Size> {
        self.host.size.or_else(|| {
            let preferred = &manifest.value["sizing"]["preferred"];
            Some(Size {
                width: u32::try_from(preferred["width"].as_u64()?).ok()?,
                height: u32::try_from(preferred["height"].as_u64()?).ok()?,
            })
        })
    }
}

fn check_change(path: &str, change: &HostChange) -> Checked {
    if change.is_empty() {
        return Err(ScenarioError::new(path, "changes nothing"));
    }
    if let Some(scale) = change.scale {
        check_scale(&format!("{path}.scale"), scale)?;
    }
    if let Some(size) = change.size {
        check_size(&format!("{path}.size"), size)?;
    }
    if let Some(zone) = &change.zone {
        check_zone(&format!("{path}.zone"), zone)?;
    }
    Ok(())
}

fn check_http(path: &str, fixture: &HttpFixture) -> Checked {
    let request = &fixture.request;
    if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&request.method.as_str()) {
        return Err(ScenarioError::new(
            format!("{path}.request.method"),
            "GET, POST, PUT, PATCH or DELETE",
        ));
    }
    if !request.url.starts_with("https://")
        || request.url.len() as u64 > MAX_REQUEST_URL_BYTES.value
        || request
            .url
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(ScenarioError::new(
            format!("{path}.request.url"),
            "an HTTPS URL within the request bounds",
        ));
    }
    match (&fixture.response, &fixture.error) {
        (Some(response), None) => {
            let here = format!("{path}.response");
            if !(100..=599).contains(&response.status) || (300..=399).contains(&response.status) {
                return Err(ScenarioError::new(
                    format!("{here}.status"),
                    "100 to 599; the broker refuses redirections (`error: redirect_denied`)",
                ));
            }
            if let Some(content_type) = &response.content_type
                && (content_type.is_empty()
                    || content_type.len() > MAX_HTTP_CONTENT_TYPE_BYTES
                    || content_type
                        .bytes()
                        .any(|byte| !(0x20..=0x7e).contains(&byte)))
            {
                return Err(ScenarioError::new(
                    format!("{here}.contentType"),
                    format!("printable ASCII, 1 to {MAX_HTTP_CONTENT_TYPE_BYTES} bytes"),
                ));
            }
            if response.body.is_some() && response.body_base64.is_some() {
                return Err(ScenarioError::new(
                    here,
                    "give `body` or `bodyBase64`, not both",
                ));
            }
            match response.body_bytes() {
                None => Err(ScenarioError::new(
                    format!("{here}.bodyBase64"),
                    "invalid base64",
                )),
                Some(body) if body.len() as u64 > MAX_HTTP_RESPONSE_BYTES.value => {
                    Err(ScenarioError::new(
                        here,
                        "the body is beyond the broker's bound (`error: response_body_limit`)",
                    ))
                }
                Some(_) => Ok(()),
            }
        }
        (None, Some(code)) => {
            if !HTTP_FIXTURE_ERRORS.contains(&code.as_str()) {
                return Err(ScenarioError::new(
                    format!("{path}.error"),
                    "not an error the broker gives after the network rules",
                ));
            }
            Ok(())
        }
        _ => Err(ScenarioError::new(
            path,
            "give exactly one of `response` and `error`",
        )),
    }
}

fn check_expect(path: &str, expect: &Expect) -> Checked {
    if expect == &Expect::default() {
        return Err(ScenarioError::new(path, "expects nothing"));
    }
    if let Some(image) = &expect.image
        && !valid_name(image)
    {
        return Err(ScenarioError::new(
            format!("{path}.image"),
            format!("[a-z0-9][a-z0-9-]*, at most {MAX_NAME_BYTES} bytes"),
        ));
    }
    for (member, texts) in [("text", &expect.text), ("noText", &expect.no_text)] {
        let Some(texts) = texts else {
            continue;
        };
        if texts.is_empty() || texts.len() > MAX_EXPECTED_TEXTS {
            return Err(ScenarioError::new(
                format!("{path}.{member}"),
                format!("from 1 to {MAX_EXPECTED_TEXTS} texts"),
            ));
        }
        for (index, text) in texts.iter().enumerate() {
            check_text(&format!("{path}.{member}[{index}]"), text)?;
        }
    }
    if let Some(calls) = &expect.calls {
        if calls.len() > MAX_EXPECTED_CALLS {
            return Err(ScenarioError::new(
                format!("{path}.calls"),
                format!("at most {MAX_EXPECTED_CALLS} calls"),
            ));
        }
        for (index, call) in calls.iter().enumerate() {
            let here = format!("{path}.calls[{index}]");
            if service(&call.service).is_none() || UNLISTED_CALLS.contains(&call.service.as_str()) {
                return Err(ScenarioError::new(
                    format!("{here}.service"),
                    "unknown service, or one the expectations leave out (timers)",
                ));
            }
            if let Some(params) = &call.params
                && !params.is_object()
            {
                return Err(ScenarioError::new(format!("{here}.params"), "an object"));
            }
            if let Some(outcome) = &call.outcome
                && outcome != "ok"
                && !SERVICE_ERRORS.contains(&outcome.as_str())
            {
                return Err(ScenarioError::new(
                    format!("{here}.outcome"),
                    "`ok` or a service error code",
                ));
            }
        }
    }
    if let Some(fault) = &expect.fault
        && fault != "none"
        && !FAULT_CATEGORY_NAMES.contains(&fault.as_str())
    {
        return Err(ScenarioError::new(
            format!("{path}.fault"),
            "`none` or a fault category",
        ));
    }
    if let Some(text) = &expect.clipboard
        && text.len() as u64 > MAX_CLIPBOARD_BYTES.value
    {
        return Err(ScenarioError::new(format!("{path}.clipboard"), "too long"));
    }
    Ok(())
}

/// The items a manifest declares, as the host's consent names them.
pub fn declared_items(manifest: &Manifest) -> BTreeSet<String> {
    let permissions = &manifest.permissions;
    let mut items = BTreeSet::new();
    if !permissions.network.is_empty() {
        items.insert("network".to_owned());
    }
    if permissions.storage {
        items.insert("storage".to_owned());
    }
    if permissions.clipboard_write {
        items.insert("clipboardWrite".to_owned());
    }
    if !permissions.game_events.is_empty() {
        items.insert("gameEvents".to_owned());
    }
    items.extend(
        permissions
            .capabilities
            .iter()
            .map(|name| (*name).to_owned()),
    );
    items
}

enum MenuRow {
    Toggle,
    Slider { min: f64, max: f64 },
    Choice(BTreeSet<String>),
    Action,
}

impl MenuRow {
    fn accepts(&self, value: &Value) -> bool {
        match self {
            Self::Toggle => value.is_boolean(),
            Self::Slider { min, max } => value
                .as_f64()
                .is_some_and(|number| (*min..=*max).contains(&number)),
            Self::Choice(values) => value.as_str().is_some_and(|word| values.contains(word)),
            Self::Action => false,
        }
    }
}

/// The value rows of a validated manifest's `wrapper.menu`, groups opened.
fn menu_rows(manifest: &Manifest) -> BTreeMap<&str, MenuRow> {
    fn walk<'a>(rows: &'a [Value], out: &mut BTreeMap<&'a str, MenuRow>) {
        for row in rows {
            let Some(id) = row["id"].as_str() else {
                continue;
            };
            let kind = match row["type"].as_str() {
                Some("toggle") => MenuRow::Toggle,
                Some("slider") => MenuRow::Slider {
                    min: row["min"].as_f64().unwrap_or(0.0),
                    max: row["max"].as_f64().unwrap_or(0.0),
                },
                Some("choice") => MenuRow::Choice(
                    row["choices"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|choice| choice["value"].as_str().map(str::to_owned))
                        .collect(),
                ),
                Some("action") => MenuRow::Action,
                Some("group") => {
                    if let Some(inner) = row["rows"].as_array() {
                        walk(inner, out);
                    }
                    continue;
                }
                _ => continue,
            };
            out.insert(id, kind);
        }
    }
    let mut rows = BTreeMap::new();
    if let Some(menu) = manifest.value["wrapper"]["menu"].as_array() {
        walk(menu, &mut rows);
    }
    rows
}

/// Standard base64 with padding; `None` for anything else.
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    fn sextet(byte: u8) -> Option<u32> {
        Some(match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    }
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for (index, chunk) in bytes.chunks(4).enumerate() {
        let last = index == bytes.len() / 4 - 1;
        let padding = chunk.iter().rev().take_while(|byte| **byte == b'=').count();
        if padding > 2 || (padding > 0 && !last) {
            return None;
        }
        let mut word = 0_u32;
        for byte in &chunk[..4 - padding] {
            word = (word << 6) | sextet(*byte)?;
        }
        word <<= 6 * padding as u32;
        let decoded = word.to_be_bytes();
        out.extend_from_slice(&decoded[1..4 - padding]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_standard_padding() {
        assert_eq!(base64_decode(""), Some(Vec::new()));
        assert_eq!(base64_decode("Zg=="), Some(b"f".to_vec()));
        assert_eq!(base64_decode("Zm8="), Some(b"fo".to_vec()));
        assert_eq!(base64_decode("Zm9v"), Some(b"foo".to_vec()));
        assert_eq!(base64_decode("Zm9vYg=="), Some(b"foob".to_vec()));
        for invalid in ["Zg=", "Zg==Zg==", "Z===", "Zm9v\n", "Zm-v"] {
            assert_eq!(base64_decode(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn zone_gives_the_offset_and_the_next_change() {
        let zone = Zone {
            offset_minutes: 60,
            transitions: vec![
                Transition {
                    at: 1_000,
                    offset_minutes: 120,
                },
                Transition {
                    at: 5_000,
                    offset_minutes: 60,
                },
            ],
        };
        assert_eq!(zone.at(0), (60, Some(1_000)));
        assert_eq!(zone.at(999), (60, Some(1_000)));
        assert_eq!(zone.at(1_000), (120, Some(5_000)));
        assert_eq!(zone.at(5_000), (60, None));
    }
}
