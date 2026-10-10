//! `overcrow-widget submit` and `status`: send a version of a widget to the
//! OverCrow creator space with a publish key, and follow its checks and its
//! review (`docs/content/en/cli.md`). Neither ever asks a question: what is
//! missing is said, with a stable exit status, so that a CI job or the MCP
//! server can run them.

pub mod api;
pub mod client;
mod follow;
mod render;
pub mod secret;
pub mod state;
mod status;
mod submit;
pub mod texts;

use std::process::ExitCode;

use serde_json::{Map, Value, json};

use self::client::{Client, Failure, Origin};
use self::secret::{PublishKey, redact};

pub use self::status::{StatusOptions, status};
pub use self::submit::{SubmitOptions, submit};

/// Version of the JSON object of `submit` and `status`.
const FORMAT: u64 = 1;
/// The creator space reminds the creator this long before a key expires.
const EXPIRY_NOTICE_SECONDS: i64 = 14 * 24 * 3600;

/// How a run ends; its exit status is stable and documented.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// `--dry-run`: nothing is missing, the version would enter review.
    ReadyToSend,
    /// Refused before anything was sent.
    RefusedLocally,
    /// The API refused to start the submission.
    Refused,
    /// The version reached this state (`in_review`, `checks_failed`…).
    State(&'static str),
    /// Sent and checked, waiting in the creator space (`ready`).
    CompleteInPortal,
    Error,
    /// `status` without `--wait`: the answer was read.
    Read,
}

/// The version states, as the API names them.
const STATES: [&str; 12] = [
    "checking",
    "checks_failed",
    "ready",
    "in_review",
    "changes_requested",
    "rejected",
    "approved",
    "published",
    "withdrawn",
    "suspended",
    "superseded",
    "discarded",
];

impl Outcome {
    /// The outcome of a version in `state`.
    pub fn of_state(state: &str) -> Self {
        if state == "ready" {
            return Self::CompleteInPortal;
        }
        STATES
            .iter()
            .find(|known| **known == state)
            .map_or(Self::Error, |known| Self::State(known))
    }

    pub fn code(self) -> u8 {
        match self {
            Self::ReadyToSend | Self::Read => 0,
            Self::State("in_review" | "approved" | "published" | "withdrawn") => 0,
            Self::State("checking") => 4,
            Self::RefusedLocally | Self::Refused | Self::State(_) => 1,
            Self::Error => 2,
            Self::CompleteInPortal => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadyToSend => "ready_to_send",
            Self::RefusedLocally => "refused_locally",
            Self::Refused => "refused",
            Self::State(state) => state,
            Self::CompleteInPortal => "complete_in_portal",
            Self::Error => "error",
            Self::Read => "read",
        }
    }
}

/// What a run prints. Human lines go to stdout as the run goes (none with
/// `--format json`), warnings to stderr; every text is masked.
pub struct Out {
    pub json: bool,
    record: Map<String, Value>,
}

impl Out {
    fn new(command: &str, json: bool) -> Self {
        let mut record = Map::new();
        record.insert("formatVersion".into(), json!(FORMAT));
        record.insert("command".into(), json!(command));
        Self { json, record }
    }

    /// A line of the human output.
    pub fn say(&self, line: &str) {
        if !self.json {
            println!("{}", redact(line));
        }
    }

    /// A warning, whatever the format.
    pub fn warn(&self, line: &str) {
        eprintln!("overcrow-widget: {}", redact(line));
    }

    /// A field of the JSON object.
    pub fn set(&mut self, field: &str, value: Value) {
        self.record.insert(field.to_owned(), value);
    }

    /// Ends the run: the JSON object (with `--format json`) and the status.
    fn finish(mut self, outcome: Outcome) -> ExitCode {
        if outcome != Outcome::Read {
            self.set("outcome", json!(outcome.as_str()));
        }
        self.set("exitCode", json!(outcome.code()));
        self.record.entry("error").or_insert(Value::Null);
        if self.json {
            let text = Value::Object(std::mem::take(&mut self.record)).to_string();
            println!("{}", redact(&crate::sanitize::json(&text)));
        }
        ExitCode::from(outcome.code())
    }

    /// Ends the run on an error: `code` (stable), a sentence, and the
    /// fields the API gave.
    fn fail(mut self, code: &str, message: &str, extra: Map<String, Value>) -> ExitCode {
        self.warn(message);
        let mut error = Map::new();
        error.insert("code".into(), json!(code));
        error.insert("message".into(), json!(message));
        error.extend(extra);
        self.set("error", Value::Object(error));
        self.finish(Outcome::Error)
    }

    /// Ends the run on a failed request.
    fn fail_request(self, failure: &Failure, outcome: Outcome) -> ExitCode {
        let message = failure_message(failure);
        let extra = failure_fields(failure);
        if outcome == Outcome::Error {
            return self.fail(&failure.code(), &message, extra);
        }
        let mut out = self;
        out.warn(&message);
        let mut error = extra;
        error.insert("code".into(), json!(failure.code()));
        error.insert("message".into(), json!(message));
        out.set("error", Value::Object(error));
        out.finish(outcome)
    }
}

/// What to tell a person about a failed request: the API's sentence, and
/// what to do for the errors a creator can act on.
fn failure_message(failure: &Failure) -> String {
    let Failure::Api { error, .. } = failure else {
        return failure.message();
    };
    let what = failure.message();
    match error.code.as_str() {
        "invalid_publish_key" => format!(
            "{what}: the key in {} is not a valid publish key; check the secret, or create a key in the creator space",
            secret::KEY_VARIABLE
        ),
        "publish_key_expired" => {
            format!("{what}: create a new publish key in the creator space and replace the secret")
        }
        "publish_key_revoked" => {
            format!("{what}: this key was revoked; create a new one in the creator space")
        }
        "submission_limit_reached" => match &error.next_submission_at {
            Some(at) => format!(
                "{what} Next submission possible at {}.",
                crate::sanitize::line(at)
            ),
            None => what,
        },
        "version_not_newer" => match &error.minimum_version {
            Some(minimum) => format!(
                "{what} Use version {} or higher in manifest.json.",
                crate::sanitize::line(minimum)
            ),
            None => what,
        },
        _ => what,
    }
}

/// The API's fields of an error, for `--format json`.
fn failure_fields(failure: &Failure) -> Map<String, Value> {
    let mut extra = Map::new();
    if let Some(status) = failure.http_status() {
        extra.insert("httpStatus".into(), json!(status));
    }
    if let Failure::Api { error, .. } = failure {
        for (field, value) in [
            ("nextSubmissionAt", &error.next_submission_at),
            ("minimumVersion", &error.minimum_version),
            ("expiredAt", &error.expired_at),
        ] {
            if let Some(value) = value {
                extra.insert(field.into(), json!(value));
            }
        }
        if let Some(seconds) = error.retry_after {
            extra.insert("retryAfter".into(), json!(seconds));
        }
        if !error.fields.is_empty() {
            extra.insert(
                "fields".into(),
                Value::Array(
                    error
                        .fields
                        .iter()
                        .map(|(field, code)| json!({"field": field, "code": code}))
                        .collect(),
                ),
            );
        }
    }
    extra
}

/// A failed request that the creator can fix (the API refused the
/// submission) rather than an error of the key, the network or the
/// server.
fn refused_by_api(failure: &Failure) -> bool {
    matches!(
        failure,
        Failure::Api { status, error }
            if !matches!(status, 401 | 500..=599)
                && !matches!(error.code.as_str(), "rate_limited" | "idempotency_key_reused" | "storage_unavailable")
    )
}

/// Masks the key in a panic's message: a panic must not print it either.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|text| (*text).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let location = info
            .location()
            .map(|location| format!(" at {}:{}", location.file(), location.line()))
            .unwrap_or_default();
        eprintln!(
            "overcrow-widget: internal error{location}: {}",
            redact(&message)
        );
    }));
}

/// The key, the API and a client, or the end of the run.
fn connect(raw_key: Option<String>, verbose: bool, out: &Out) -> Result<Client, (String, String)> {
    let raw_key = raw_key.ok_or_else(|| {
        (
            "publish_key_missing".to_owned(),
            format!(
                "{} is not set: create a publish key in the creator space (Publisher, Publish keys) and put it in this variable",
                secret::KEY_VARIABLE
            ),
        )
    })?;
    #[cfg(debug_assertions)]
    if std::env::var_os("OVERCROW_WIDGET_TEST_PANIC").is_some() {
        panic!("test panic holding {raw_key}");
    }
    let key = PublishKey::parse(&raw_key).ok_or_else(|| {
        (
            "invalid_publish_key".to_owned(),
            format!(
                "{} does not hold a publish key (ocw_pub_ and 43 characters): copy it again from the creator space",
                secret::KEY_VARIABLE
            ),
        )
    })?;
    let (origin, warning) =
        Origin::from_environment().map_err(|message| ("api_url_invalid".to_owned(), message))?;
    if let Some(warning) = warning {
        out.warn(&warning);
    }
    Ok(Client::new(origin, key, verbose))
}

/// `GET /publish/key`, shown and recorded.
fn read_key(client: &Client, out: &mut Out) -> Result<api::KeyInfo, Failure> {
    let answer = client.get("/api/v1/publish/key")?;
    let key = api::parse_key(&answer.body).map_err(Failure::Response)?;
    let soon = unix_seconds(&key.expires_at)
        .is_some_and(|expires| expires - now_seconds() < EXPIRY_NOTICE_SECONDS);
    out.set(
        "key",
        json!({
            "name": key.name,
            "hint": client.key().hint(),
            "expiresAt": key.expires_at,
            "expiresSoon": soon,
        }),
    );
    out.say(&render::key_line(&key, client.key().hint()));
    if soon {
        out.warn(&format!(
            "this publish key expires on {}: create a new one in the creator space and replace the secret before then",
            render::date(&key.expires_at)
        ));
    }
    Ok(key)
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

/// RFC 3339 (`2027-01-11T11:00:00+01:00`, `…Z`, fractions allowed) to
/// Unix seconds.
fn unix_seconds(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes[10] != b'T' {
        return None;
    }
    let base = overcrow_widget_schema::catalog::parse_timestamp(&format!("{}Z", &text[..19]))?;
    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        rest = &fraction[digits..];
    }
    let offset = match rest {
        "Z" | "z" => 0,
        _ => {
            let (sign, rest) = match rest.as_bytes().first()? {
                b'+' => (1, &rest[1..]),
                b'-' => (-1, &rest[1..]),
                _ => return None,
            };
            let (hours, minutes) = rest.split_once(':')?;
            if hours.len() != 2 || minutes.len() != 2 {
                return None;
            }
            sign * (hours.parse::<i64>().ok()? * 3600 + minutes.parse::<i64>().ok()? * 60)
        }
    };
    Some(base - offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_statuses_follow_the_outcome() {
        for (state, code) in [
            ("in_review", 0),
            ("approved", 0),
            ("published", 0),
            ("checks_failed", 1),
            ("changes_requested", 1),
            ("superseded", 1),
            ("discarded", 1),
            ("ready", 3),
            ("checking", 4),
            ("unknown", 2),
        ] {
            assert_eq!(Outcome::of_state(state).code(), code, "{state}");
        }
        assert_eq!(Outcome::of_state("ready").as_str(), "complete_in_portal");
        assert_eq!(Outcome::RefusedLocally.code(), 1);
        assert_eq!(Outcome::ReadyToSend.code(), 0);
    }

    #[test]
    fn api_times_are_read_with_their_offset() {
        let utc = unix_seconds("2027-01-11T10:00:00Z").expect("UTC");
        assert_eq!(unix_seconds("2027-01-11T11:00:00+01:00"), Some(utc));
        assert_eq!(unix_seconds("2027-01-11T11:00:00.123+01:00"), Some(utc));
        assert_eq!(unix_seconds("2027-01-11T05:00:00-05:00"), Some(utc));
        for bad in [
            "2027-01-11",
            "2027-01-11T11:00:00",
            "2027-01-11T11:00:00+1:00",
            "x",
        ] {
            assert_eq!(unix_seconds(bad), None, "{bad}");
        }
    }
}
