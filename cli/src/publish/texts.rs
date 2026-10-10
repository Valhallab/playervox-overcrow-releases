//! The texts sent with a version: public release notes in English and
//! French, a justification per new permission (for the reviewer) and a
//! private message to the review. They come from `--submission FILE`, in
//! camelCase like `manifest.json` (what the MCP server's
//! `prepare_submission` writes), and from `--release-notes-en`,
//! `--release-notes-fr` and `--review-message`, which replace the file's.
//! They are checked as the creator space checks them, then sent in the
//! API's `snake_case`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use overcrow_widget_schema::catalog_v2::display_text;
use overcrow_widget_schema::json::parse_strict;
use serde_json::{Map, Value, json};

use crate::diag::Diagnostic;
use crate::project::read_bounded;

/// Bound of the `--submission` file.
const MAX_FILE_BYTES: u64 = 64 * 1024;
/// The release notes' languages (the creator space's).
const LOCALES: [&str; 2] = ["en", "fr"];
/// Bounds the creator space applies besides the context's.
const MAX_JUSTIFICATIONS: usize = 64;
const MAX_PERMISSION_BYTES: usize = 512;

/// Character bounds of the texts, from the key's context
/// (`limits.*_chars`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Limits {
    pub release_notes: u64,
    pub justification: u64,
    pub review_message: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            release_notes: 500,
            justification: 500,
            review_message: 2000,
        }
    }
}

impl Limits {
    /// The context's `limits`; a bound missing or not a positive integer
    /// keeps its default.
    pub fn from_context(limits: &Value) -> Self {
        let defaults = Self::default();
        let bound = |name: &str, default: u64| {
            limits[name]
                .as_u64()
                .filter(|value| *value > 0)
                .unwrap_or(default)
        };
        Self {
            release_notes: bound("release_notes_chars", defaults.release_notes),
            justification: bound("justification_chars", defaults.justification),
            review_message: bound("review_message_chars", defaults.review_message),
        }
    }
}

/// The options that replace the file's texts.
#[derive(Default)]
pub struct Overrides<'a> {
    pub release_notes_en: Option<&'a str>,
    pub release_notes_fr: Option<&'a str>,
    pub review_message: Option<&'a str>,
}

/// The texts of one submission.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Texts {
    pub release_notes: BTreeMap<String, String>,
    /// `(permission, text)`, in the file's order.
    pub justifications: Vec<(String, String)>,
    pub review_message: Option<String>,
}

impl Texts {
    /// `release_notes` (when any), `justifications` and `review_message`
    /// (when any), as the API takes them.
    pub fn api_fields(&self) -> Map<String, Value> {
        let mut fields = Map::new();
        if !self.release_notes.is_empty() {
            fields.insert("release_notes".into(), json!(self.release_notes));
        }
        fields.insert(
            "justifications".into(),
            Value::Array(
                self.justifications
                    .iter()
                    .map(|(permission, text)| json!({"permission": permission, "text": text}))
                    .collect(),
            ),
        );
        if let Some(message) = &self.review_message {
            fields.insert("review_message".into(), json!(message));
        }
        fields
    }

    /// The permission keys a justification is given for.
    pub fn justified(&self) -> impl Iterator<Item = &str> {
        self.justifications
            .iter()
            .map(|(permission, _)| permission.as_str())
    }
}

/// Reads `file` (if any), then applies `overrides`. An error is a usage
/// error: the file cannot be read or does not have the documented shape.
pub fn load(file: Option<&Path>, overrides: &Overrides<'_>) -> Result<Texts, String> {
    let mut texts = match file {
        Some(path) => read_file(path)?,
        None => Texts::default(),
    };
    for (locale, text) in [
        ("en", overrides.release_notes_en),
        ("fr", overrides.release_notes_fr),
    ] {
        if let Some(text) = text {
            texts.release_notes.insert(locale.into(), text.to_owned());
        }
    }
    if let Some(message) = overrides.review_message {
        texts.review_message = Some(message.to_owned());
    }
    Ok(texts)
}

fn read_file(path: &Path) -> Result<Texts, String> {
    let shown = path.display();
    let bytes = read_bounded(path, MAX_FILE_BYTES)
        .map_err(|error| format!("cannot read {shown}: {error}"))?
        .ok_or_else(|| format!("{shown} is larger than {} KiB", MAX_FILE_BYTES / 1024))?;
    let Some(Value::Object(object)) = parse_strict(&bytes, MAX_FILE_BYTES) else {
        return Err(format!(
            "{shown} is not one JSON object (strict: UTF-8, no duplicate key)"
        ));
    };
    let wrong = |field: &str, shape: &str| format!("{shown}: `{field}` must be {shape}");
    let mut texts = Texts::default();
    for (name, value) in object {
        match (name.as_str(), value) {
            ("releaseNotes", Value::Object(notes)) => {
                for (locale, text) in notes {
                    let Value::String(text) = text else {
                        return Err(wrong(&format!("releaseNotes.{locale}"), "a string"));
                    };
                    if !LOCALES.contains(&locale.as_str()) {
                        return Err(format!(
                            "{shown}: release notes are in en and fr, not `{}`",
                            crate::sanitize::line(&locale)
                        ));
                    }
                    texts.release_notes.insert(locale, text);
                }
            }
            ("releaseNotes", _) => return Err(wrong("releaseNotes", "an object {en, fr}")),
            ("justifications", Value::Array(items)) => {
                for (index, item) in items.into_iter().enumerate() {
                    let entry = justification(item).map_err(|problem| {
                        format!("{shown}: justifications[{index}]: {problem}")
                    })?;
                    texts.justifications.push(entry);
                }
            }
            ("justifications", _) => {
                return Err(wrong(
                    "justifications",
                    "a list of {permission, text} objects",
                ));
            }
            ("reviewMessage", Value::String(message)) => texts.review_message = Some(message),
            ("reviewMessage", Value::Null) => {}
            ("reviewMessage", _) => return Err(wrong("reviewMessage", "a string")),
            (other, _) => {
                return Err(format!(
                    "{shown}: unknown key `{}`; the keys are releaseNotes, justifications and reviewMessage",
                    crate::sanitize::line(other)
                ));
            }
        }
    }
    Ok(texts)
}

/// One `{permission, text}` object, or what is wrong with it.
fn justification(item: Value) -> Result<(String, String), String> {
    let Value::Object(item) = item else {
        return Err("must be a {permission, text} object".into());
    };
    if let Some(other) = item
        .keys()
        .find(|key| *key != "permission" && *key != "text")
    {
        return Err(format!(
            "unknown key `{}`; the keys are permission and text",
            crate::sanitize::line(other)
        ));
    }
    let field = |name: &str| {
        item.get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("`{name}` must be a string"))
    };
    Ok((field("permission")?, field("text")?))
}

/// What the creator space would refuse in `texts`, as diagnostics
/// (`submit.release_notes`, `submit.justification`,
/// `submit.review_message`).
pub fn check(texts: &Texts, limits: &Limits) -> Vec<Diagnostic> {
    let mut found = Vec::new();
    if !texts.release_notes.is_empty() && !texts.release_notes.contains_key("en") {
        found.push(
            Diagnostic::error(
                "submit.release_notes",
                "release notes need an English text (en), as the catalog shows English first",
            )
            .help("add releaseNotes.en, or --release-notes-en"),
        );
    }
    for (locale, text) in &texts.release_notes {
        if !display_text(text, limits.release_notes, true) {
            found.push(
                Diagnostic::error(
                    "submit.release_notes",
                    format!(
                        "the {locale} release notes must be 1 to {} characters of plain text",
                        limits.release_notes
                    ),
                )
                .help("no space at either end, no <, >, tab, control or invisible character; line breaks are fine"),
            );
        }
    }
    if texts.justifications.len() > MAX_JUSTIFICATIONS {
        found.push(Diagnostic::error(
            "submit.justification",
            format!("at most {MAX_JUSTIFICATIONS} justifications"),
        ));
    }
    let mut seen = BTreeSet::new();
    for (permission, text) in &texts.justifications {
        let shown = crate::sanitize::line(permission);
        if permission.is_empty() || permission.len() > MAX_PERMISSION_BYTES {
            found.push(Diagnostic::error(
                "submit.justification",
                format!("a justification names a permission of 1 to {MAX_PERMISSION_BYTES} bytes"),
            ));
        } else if !seen.insert(permission.as_str()) {
            found.push(Diagnostic::error(
                "submit.justification",
                format!("two justifications for {shown}"),
            ));
        }
        if !private_text(text, limits.justification) {
            found.push(
                Diagnostic::error(
                    "submit.justification",
                    format!(
                        "the justification of {shown} must be 1 to {} characters",
                        limits.justification
                    ),
                )
                .help("plain text: no control character but line breaks and tabs"),
            );
        }
    }
    if let Some(message) = &texts.review_message
        && !private_text(message, limits.review_message)
    {
        found.push(
            Diagnostic::error(
                "submit.review_message",
                format!(
                    "the message to the review must be 1 to {} characters",
                    limits.review_message
                ),
            )
            .help("plain text: no control character but line breaks and tabs"),
        );
    }
    found
}

/// Text only PlayerVox reads: not blank (as Ruby's `strip` sees it), at
/// most `max_chars` characters, no control character but line feeds and
/// tabs.
fn private_text(text: &str, max_chars: u64) -> bool {
    let blank = |c: char| matches!(c, '\0' | '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ');
    !text.trim_matches(blank).is_empty()
        && text.chars().count() as u64 <= max_chars
        && text
            .chars()
            .all(|c| !c.is_control() || c == '\n' || c == '\t')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(value: &serde_json::Value) -> (tempfile::TempDir, std::path::PathBuf) {
        let folder = tempfile::tempdir().expect("temporary directory");
        let path = folder.path().join("submission.json");
        std::fs::write(&path, value.to_string()).expect("file");
        (folder, path)
    }

    fn codes(texts: &Texts) -> Vec<String> {
        check(texts, &Limits::default())
            .into_iter()
            .map(|diagnostic| diagnostic.code)
            .collect()
    }

    fn texts(value: serde_json::Value) -> Texts {
        let (_folder, path) = file(&value);
        load(Some(&path), &Overrides::default()).expect("valid texts")
    }

    #[test]
    fn a_complete_file_becomes_the_api_fields() {
        let loaded = texts(json!({
            "releaseNotes": {"en": "Server incident alert.", "fr": "Alerte en cas d'incident."},
            "justifications": [
                {"permission": "network:GET https://api.nova.gg/v1/status", "text": "Shows incidents."}
            ],
            "reviewMessage": "Thanks!"
        }));
        assert!(codes(&loaded).is_empty());
        assert_eq!(
            serde_json::Value::Object(loaded.api_fields()),
            json!({
                "release_notes": {"en": "Server incident alert.", "fr": "Alerte en cas d'incident."},
                "justifications": [
                    {"permission": "network:GET https://api.nova.gg/v1/status", "text": "Shows incidents."}
                ],
                "review_message": "Thanks!"
            })
        );
        assert_eq!(
            loaded.justified().collect::<Vec<_>>(),
            ["network:GET https://api.nova.gg/v1/status"]
        );
    }

    #[test]
    fn everything_is_optional() {
        let none = load(None, &Overrides::default()).expect("no texts");
        assert!(codes(&none).is_empty());
        assert_eq!(
            serde_json::Value::Object(none.api_fields()),
            json!({"justifications": []})
        );
        assert!(codes(&texts(json!({}))).is_empty());
        assert!(codes(&texts(json!({"reviewMessage": null}))).is_empty());
    }

    #[test]
    fn options_replace_the_file() {
        let (_folder, path) = file(&json!({
            "releaseNotes": {"en": "From the file.", "fr": "Du fichier."},
            "reviewMessage": "File."
        }));
        let overrides = Overrides {
            release_notes_en: Some("From the option."),
            review_message: Some("Option."),
            ..Overrides::default()
        };
        let loaded = load(Some(&path), &overrides).expect("texts");
        assert_eq!(loaded.release_notes["en"], "From the option.");
        assert_eq!(loaded.release_notes["fr"], "Du fichier.");
        assert_eq!(loaded.review_message.as_deref(), Some("Option."));
        let only = load(
            None,
            &Overrides {
                release_notes_fr: Some("Corrections."),
                ..Overrides::default()
            },
        )
        .expect("texts");
        assert_eq!(only.release_notes["fr"], "Corrections.");
    }

    #[test]
    fn the_file_must_have_the_documented_shape() {
        for (value, said) in [
            (json!({"release_notes": {"en": "x"}}), "release_notes"),
            (json!({"releaseNotes": {"de": "x"}}), "de"),
            (json!({"releaseNotes": "x"}), "releaseNotes"),
            (json!({"justifications": {}}), "justifications"),
            (
                json!({"justifications": [{"permission": "storage"}]}),
                "text",
            ),
            (
                json!({"justifications": [{"permission": "storage", "text": "x", "why": 1}]}),
                "why",
            ),
            (json!({"reviewMessage": 3}), "reviewMessage"),
            (json!([]), "object"),
        ] {
            let (_folder, path) = file(&value);
            let error = load(Some(&path), &Overrides::default()).expect_err("refused");
            assert!(error.contains(said), "{value}: {error}");
        }
        let folder = tempfile::tempdir().expect("temporary directory");
        let path = folder.path().join("submission.json");
        std::fs::write(&path, r#"{"reviewMessage": "a", "reviewMessage": "b"}"#).expect("file");
        assert!(
            load(Some(&path), &Overrides::default()).is_err(),
            "duplicate key"
        );
        std::fs::write(&path, vec![b' '; 64 * 1024 + 1]).expect("file");
        assert!(
            load(Some(&path), &Overrides::default()).is_err(),
            "too large"
        );
        assert!(
            load(
                Some(&folder.path().join("absent.json")),
                &Overrides::default()
            )
            .is_err()
        );
    }

    #[test]
    fn release_notes_follow_the_catalog() {
        assert_eq!(
            codes(&texts(json!({"releaseNotes": {"fr": "Corrections."}}))),
            ["submit.release_notes"],
            "English first"
        );
        for bad in [
            " Leading space.",
            "<b>Bold</b>",
            "Tab\there",
            "",
            "Zero\u{200b}width",
        ] {
            assert_eq!(
                codes(&texts(json!({"releaseNotes": {"en": bad}}))),
                ["submit.release_notes"],
                "{bad:?}"
            );
        }
        assert!(
            codes(&texts(
                json!({"releaseNotes": {"en": "Line one.\nLine two."}})
            ))
            .is_empty()
        );
        let longest = "é".repeat(500);
        assert!(codes(&texts(json!({"releaseNotes": {"en": longest}}))).is_empty());
        let longer = "é".repeat(501);
        assert_eq!(
            codes(&texts(json!({"releaseNotes": {"en": longer}}))),
            ["submit.release_notes"]
        );
    }

    #[test]
    fn justifications_and_the_message_follow_the_review_rules() {
        let justification = |permission: &str, text: &str| json!({"justifications": [{"permission": permission, "text": text}]});
        assert!(
            codes(&texts(justification(
                "storage",
                "Keeps the timers.\n\tAnd notes."
            )))
            .is_empty()
        );
        for (permission, text) in [("storage", "   "), ("storage", "Bell\u{7}"), ("", "Why.")] {
            assert_eq!(
                codes(&texts(justification(permission, text))),
                ["submit.justification"],
                "{permission:?} {text:?}"
            );
        }
        let long_key = "k".repeat(513);
        assert_eq!(
            codes(&texts(justification(&long_key, "Why."))),
            ["submit.justification"]
        );
        assert_eq!(
            codes(&texts(justification("storage", &"a".repeat(501)))),
            ["submit.justification"]
        );
        // Ruby's strip: an ideographic space is not blank.
        assert!(codes(&texts(justification("storage", "\u{3000}"))).is_empty());
        let twice = json!({"justifications": [
            {"permission": "storage", "text": "One."},
            {"permission": "storage", "text": "Two."}
        ]});
        assert_eq!(codes(&texts(twice)), ["submit.justification"]);
        let many: Vec<serde_json::Value> = (0..65)
            .map(|index| json!({"permission": format!("capability:c{index}"), "text": "Why."}))
            .collect();
        assert_eq!(
            codes(&texts(json!({"justifications": many}))),
            ["submit.justification"]
        );
        assert_eq!(
            codes(&texts(json!({"reviewMessage": "a".repeat(2001)}))),
            ["submit.review_message"]
        );
        assert!(codes(&texts(json!({"reviewMessage": "a".repeat(2000)}))).is_empty());
    }

    #[test]
    fn the_context_may_change_the_bounds() {
        let limits = Limits::from_context(&json!({
            "release_notes_chars": 10, "justification_chars": 5, "review_message_chars": 3
        }));
        let loaded = texts(json!({
            "releaseNotes": {"en": "Eleven char"},
            "justifications": [{"permission": "storage", "text": "Sixty"}],
            "reviewMessage": "Four"
        }));
        let found: Vec<String> = check(&loaded, &limits)
            .into_iter()
            .map(|diagnostic| diagnostic.code)
            .collect();
        assert_eq!(found, ["submit.release_notes", "submit.review_message"]);
        assert_eq!(
            Limits::from_context(&json!({"release_notes_chars": "x"})),
            Limits::default()
        );
    }
}
