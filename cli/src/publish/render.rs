//! The human output of `submit` and `status`. Every text that comes from
//! the API (names, messages of diagnostics, review remarks) or from the
//! project goes through [`crate::sanitize`].

use std::collections::BTreeMap;

use overcrow_widget_format::Position;
use serde_json::Value;

use super::api::KeyInfo;
use crate::diag::Diagnostic;
use crate::sanitize;

/// The files sent, by path, to show the lines a diagnostic points at.
pub type Files = BTreeMap<String, Vec<u8>>;

/// The day of an API time (`2027-01-11T11:00:00+01:00` → `2027-01-11`).
pub fn date(text: &str) -> String {
    sanitize::line(text.get(..10).unwrap_or(text))
}

pub fn key_line(key: &KeyInfo, hint: &str) -> String {
    format!(
        "Key        {} ({hint}…), {}, expires {}",
        sanitize::line(&key.name),
        sanitize::line(&key.widget_id),
        date(&key.expires_at)
    )
}

/// The six lines of the creator space's checks.
pub fn check_label(key: &str) -> String {
    match key {
        "manifest" => "Manifest".into(),
        "version" => "Version number".into(),
        "code" => "Code analysis".into(),
        "build" => "Package build".into(),
        "permissions" => "Permissions".into(),
        "size" => "Size and resources".into(),
        other => sanitize::line(other),
    }
}

pub fn check_line(status: &str, key: &str) -> String {
    format!("  {:<8} {}", sanitize::line(status), check_label(key))
}

/// A version state in words.
pub fn state_words(state: &str) -> String {
    match state {
        "checking" => "being checked".into(),
        "checks_failed" => "checks failed".into(),
        "ready" => "waiting in the creator space".into(),
        "in_review" => "in review".into(),
        "changes_requested" => "changes requested".into(),
        "superseded" => "replaced by a newer submission".into(),
        "discarded" => "abandoned".into(),
        other => sanitize::line(other),
    }
}

/// A diagnostic of the API, with the line of the sent file it points at.
pub fn diagnostic(value: &Value, files: Option<&Files>) -> String {
    let text = |field: &str| value[field].as_str().map(sanitize::line);
    let code = text("code").unwrap_or_else(|| "unknown".into());
    let message = text("message").unwrap_or_default();
    let mut diagnostic = if value["severity"] == "warning" {
        Diagnostic::warning(code, message)
    } else {
        Diagnostic::error(code, message)
    };
    let file = value["file"].as_str();
    if let Some(file) = file {
        diagnostic = diagnostic.in_file(file);
    }
    let number = |field: &str| value[field].as_u64().and_then(|n| u32::try_from(n).ok());
    if let (Some(line), Some(column)) = (number("line"), number("column")) {
        diagnostic = diagnostic.at(Position { line, column });
    }
    if let Some(help) = text("help") {
        diagnostic = diagnostic.help(help);
    }
    let source = file
        .zip(files)
        .and_then(|(file, files)| files.get(file))
        .and_then(|bytes| std::str::from_utf8(bytes).ok());
    diagnostic.render(source)
}

/// What keeps a ready version out of review, in words.
pub fn blocker(value: &Value) -> String {
    let code = value["code"].as_str().unwrap_or("unknown");
    let list = |field: &str| {
        value[field]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|item| match item {
                        Value::String(text) => sanitize::line(text),
                        other => sanitize::line(&other.to_string()),
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|text| !text.is_empty())
    };
    let text = match code {
        "justification_missing" => match list("permissions") {
            Some(keys) => format!("a justification is missing for: {keys}"),
            None => "a justification is missing for a new permission".into(),
        },
        "privacy_policy_required" => {
            "the widget uses the network: add a privacy policy to its listing".into()
        }
        "listing_incomplete" => match list("missing") {
            Some(fields) => format!("the listing is not complete: {fields}"),
            None => "the listing is not complete".into(),
        },
        "review_limit_new_publisher" => {
            "another of your widgets is in review: until one is approved, a new publisher has one at a time".into()
        }
        "agreement_acceptance_required" => "accept the new creator agreement first".into(),
        "publish_key_revoked" => {
            "the publish key was revoked meanwhile: send it to review in the creator space".into()
        }
        "widget_not_submittable" => "the widget cannot receive versions now".into(),
        _ => String::new(),
    };
    format!("  {:<28} {text}", sanitize::line(code))
        .trim_end()
        .to_owned()
}

/// Review remarks (file, line, rule, text), shown whatever other fields
/// they carry.
pub fn remark(value: &Value) -> String {
    let field = |name: &str| match &value[name] {
        Value::String(text) => Some(sanitize::line(text)),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    };
    let place = match (field("file"), field("line")) {
        (Some(file), Some(line)) => format!("{file}:{line} "),
        (Some(file), None) => format!("{file} "),
        _ => String::new(),
    };
    let rule = field("rule")
        .map(|rule| format!("[rule {rule}] "))
        .unwrap_or_default();
    let text = field("text")
        .or_else(|| field("message"))
        .unwrap_or_else(|| sanitize::line(&value.to_string()));
    format!("  {place}{rule}{text}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_blocker_of_the_api_reads_as_a_sentence() {
        for (value, said) in [
            (
                json!({"code": "justification_missing", "permissions": ["storage", "capability:x"]}),
                "a justification is missing for: storage, capability:x",
            ),
            (
                json!({"code": "privacy_policy_required"}),
                "add a privacy policy",
            ),
            (
                json!({"code": "listing_incomplete", "missing": ["description.en", "support"]}),
                "the listing is not complete: description.en, support",
            ),
            (
                json!({"code": "review_limit_new_publisher", "status": "conflict"}),
                "one at a time",
            ),
            (
                json!({"code": "agreement_acceptance_required", "version": 2}),
                "creator agreement",
            ),
            (
                json!({"code": "publish_key_revoked", "status": "conflict"}),
                "send it to review in the creator space",
            ),
            (
                json!({"code": "widget_not_submittable"}),
                "cannot receive versions",
            ),
        ] {
            let line = blocker(&value);
            assert!(line.contains(said), "{line}");
        }
        assert_eq!(
            blocker(&json!({"code": "new_rule\u{1b}[2J"})),
            "  new_rule\\u{1b}[2J"
        );
    }

    #[test]
    fn remarks_show_their_place_and_rule() {
        assert_eq!(
            remark(
                &json!({"file": "logic.ts", "line": 48, "rule": "4.2", "text": "Use JSON.parse."})
            ),
            "  logic.ts:48 [rule 4.2] Use JSON.parse."
        );
        assert_eq!(remark(&json!({"message": "Thanks."})), "  Thanks.");
    }
}
