//! The answers of the publish API (`/api/v1/publish/*`, JSON in
//! `snake_case`), read into what `submit` and `status` decide on. A missing
//! or mistyped field the CLI needs makes the answer unreadable; unknown
//! fields are ignored (the API only adds fields). The whole version object
//! is kept as the API gave it, for display and for `--format json`
//! ([`camelize`]). This file depends only on `serde_json`: the
//! `publish_responses` fuzz target includes it.

use serde_json::{Map, Value};

/// Why an answer cannot be read: the field the CLI needed.
pub type Unreadable = &'static str;

/// `GET /publish/key`.
#[derive(Clone, Debug)]
pub struct KeyInfo {
    pub name: String,
    pub expires_at: String,
    pub widget_id: String,
    /// The manifest name `{en, fr}`, or null before a first version.
    pub widget_name: Value,
    pub publisher: String,
}

/// `GET /publish/context`: what the pre-check needs.
#[derive(Clone, Debug)]
pub struct Context {
    pub widget_status: String,
    pub last_approved: Option<Approved>,
    pub minimum_version: String,
    pub privacy_policy: bool,
    pub support: bool,
    pub quota: Quota,
    pub review_available: bool,
    pub review_blocked_by: Option<String>,
    pub agreement_version: u64,
    pub agreement_accepted: bool,
    pub limits: Value,
}

/// The last approved version and its manifest (for `admit --previous`).
#[derive(Clone, Debug)]
pub struct Approved {
    pub version: String,
    pub manifest: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Quota {
    pub limit: u64,
    pub remaining: u64,
    pub next_submission_at: Option<String>,
}

/// The signed upload of a submission.
#[derive(Clone, Debug)]
pub struct Upload {
    pub method: String,
    pub url: String,
    /// Exactly what the PUT carries (sorted by name).
    pub headers: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub struct Submission {
    pub id: u64,
    /// `pending_upload`, `finalized`, `expired` or `refused`.
    pub state: String,
    pub version_id: Option<u64>,
    pub refused_reason: Option<String>,
}

/// `POST /publish/submissions` (with the quota) and `GET
/// /publish/submissions/:id`.
#[derive(Clone, Debug)]
pub struct SubmissionReply {
    pub submission: Submission,
    pub upload: Option<Upload>,
    pub quota: Option<Quota>,
}

/// `POST /publish/submissions/:id/finalize`.
#[derive(Clone, Debug)]
pub struct Finalized {
    pub version: Version,
}

/// A version: what the CLI decides on, and the API's whole object.
#[derive(Clone, Debug)]
pub struct Version {
    pub id: u64,
    pub version: String,
    pub state: String,
    pub review_type: Option<String>,
    pub build_problem: Option<String>,
    pub poll_after_seconds: Option<u64>,
    pub value: Value,
}

/// An error answer `{code, error, …}`.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ApiError {
    pub code: String,
    pub message: Option<String>,
    pub retry_after: Option<u64>,
    pub next_submission_at: Option<String>,
    pub minimum_version: Option<String>,
    pub expired_at: Option<String>,
    /// `(field, code)` of `validation_failed`.
    pub fields: Vec<(String, String)>,
}

fn object(bytes: &[u8]) -> Result<Map<String, Value>, Unreadable> {
    match serde_json::from_slice(bytes) {
        Ok(Value::Object(object)) => Ok(object),
        _ => Err("not a JSON object"),
    }
}

fn text(value: &Value, field: Unreadable) -> Result<String, Unreadable> {
    value.as_str().map(str::to_owned).ok_or(field)
}

fn optional_text(value: &Value, field: Unreadable) -> Result<Option<String>, Unreadable> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => Ok(Some(text.clone())),
        _ => Err(field),
    }
}

fn number(value: &Value, field: Unreadable) -> Result<u64, Unreadable> {
    value.as_u64().ok_or(field)
}

fn flag(value: &Value, field: Unreadable) -> Result<bool, Unreadable> {
    value.as_bool().ok_or(field)
}

pub fn parse_key(bytes: &[u8]) -> Result<KeyInfo, Unreadable> {
    let answer = Value::Object(object(bytes)?);
    Ok(KeyInfo {
        name: text(&answer["name"], "name")?,
        expires_at: text(&answer["expires_at"], "expires_at")?,
        widget_id: text(&answer["widget"]["widget_id"], "widget.widget_id")?,
        widget_name: answer["widget"]["name"].clone(),
        publisher: text(&answer["publisher"]["handle"], "publisher.handle")?,
    })
}

fn quota(value: &Value) -> Result<Quota, Unreadable> {
    Ok(Quota {
        limit: number(&value["limit"], "quota.limit")?,
        remaining: number(&value["remaining"], "quota.remaining")?,
        next_submission_at: optional_text(
            &value["next_submission_at"],
            "quota.next_submission_at",
        )?,
    })
}

pub fn parse_context(bytes: &[u8]) -> Result<Context, Unreadable> {
    let answer = Value::Object(object(bytes)?);
    let last_approved = match &answer["last_approved"] {
        Value::Null => None,
        approved => Some(Approved {
            version: text(&approved["version"], "last_approved.version")?,
            manifest: match &approved["manifest"] {
                manifest @ Value::Object(_) => manifest.clone(),
                _ => return Err("last_approved.manifest"),
            },
        }),
    };
    Ok(Context {
        widget_status: text(&answer["widget"]["status"], "widget.status")?,
        last_approved,
        minimum_version: text(&answer["minimum_version"], "minimum_version")?,
        privacy_policy: flag(
            &answer["listing"]["privacy_policy_url"],
            "listing.privacy_policy_url",
        )?,
        support: flag(&answer["listing"]["support"], "listing.support")?,
        quota: quota(&answer["submissions"])?,
        review_available: flag(&answer["review"]["available"], "review.available")?,
        review_blocked_by: optional_text(&answer["review"]["blocked_by"], "review.blocked_by")?,
        agreement_version: number(&answer["agreement"]["version"], "agreement.version")?,
        agreement_accepted: flag(&answer["agreement"]["accepted"], "agreement.accepted")?,
        limits: match &answer["limits"] {
            limits @ Value::Object(_) => limits.clone(),
            _ => return Err("limits"),
        },
    })
}

fn submission(value: &Value) -> Result<Submission, Unreadable> {
    Ok(Submission {
        id: number(&value["id"], "submission.id")?,
        state: text(&value["state"], "submission.state")?,
        version_id: match &value["version_id"] {
            Value::Null => None,
            id => Some(number(id, "submission.version_id")?),
        },
        refused_reason: optional_text(&value["refused_reason"], "submission.refused_reason")?,
    })
}

fn upload(value: &Value) -> Result<Option<Upload>, Unreadable> {
    if value.is_null() {
        return Ok(None);
    }
    let headers = value["headers"]
        .as_object()
        .ok_or("upload.headers")?
        .iter()
        .map(|(name, value)| Ok((name.clone(), text(value, "upload.headers")?)))
        .collect::<Result<Vec<_>, Unreadable>>()?;
    Ok(Some(Upload {
        method: text(&value["method"], "upload.method")?,
        url: text(&value["url"], "upload.url")?,
        headers,
    }))
}

pub fn parse_submission(bytes: &[u8]) -> Result<SubmissionReply, Unreadable> {
    let answer = Value::Object(object(bytes)?);
    Ok(SubmissionReply {
        submission: submission(&answer["submission"])?,
        upload: upload(&answer["upload"])?,
        quota: match &answer["quota"] {
            Value::Null => None,
            value => Some(quota(value)?),
        },
    })
}

pub fn parse_finalized(bytes: &[u8]) -> Result<Finalized, Unreadable> {
    let answer = Value::Object(object(bytes)?);
    submission(&answer["submission"])?;
    Ok(Finalized {
        version: version(&answer["version"])?,
    })
}

fn version(value: &Value) -> Result<Version, Unreadable> {
    if !value.is_object() {
        return Err("version");
    }
    Ok(Version {
        id: number(&value["id"], "version.id")?,
        version: text(&value["version"], "version.version")?,
        state: text(&value["state"], "version.state")?,
        review_type: optional_text(&value["review_type"], "version.review_type")?,
        build_problem: optional_text(&value["build_problem"], "version.build_problem")?,
        poll_after_seconds: value["poll_after_seconds"].as_u64(),
        value: value.clone(),
    })
}

pub fn parse_version(bytes: &[u8]) -> Result<Version, Unreadable> {
    version(&Value::Object(object(bytes)?)["version"])
}

pub fn parse_versions(bytes: &[u8]) -> Result<Vec<Version>, Unreadable> {
    Value::Object(object(bytes)?)["versions"]
        .as_array()
        .ok_or("versions")?
        .iter()
        .map(version)
        .collect()
}

/// An error answer, or `None` when it has no `code` (a proxy's page).
pub fn parse_error(bytes: &[u8]) -> Option<ApiError> {
    let answer = Value::Object(object(bytes).ok()?);
    let maybe = |field: &str| answer[field].as_str().map(str::to_owned);
    Some(ApiError {
        code: maybe("code")?,
        message: maybe("error").or_else(|| maybe("message")),
        retry_after: answer["retry_after"].as_u64(),
        next_submission_at: maybe("next_submission_at"),
        minimum_version: maybe("minimum_version"),
        expired_at: maybe("expired_at"),
        fields: answer["fields"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                Some((
                    item["field"].as_str()?.to_owned(),
                    item["code"].as_str()?.to_owned(),
                ))
            })
            .collect(),
    })
}

/// `value` with every object key in camelCase (`review_blockers` →
/// `reviewBlockers`), recursively; values are unchanged.
pub fn camelize(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    // Maps keyed by names a creator chose (the parameters of a
                    // network route) are kept as written.
                    let named = DATA_MAPS.contains(&key.as_str());
                    let value = if named {
                        value.clone()
                    } else {
                        camelize(value)
                    };
                    (camel_case(key), value)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(camelize).collect()),
        other => other.clone(),
    }
}

/// Keys whose object is keyed by data, not by field names.
const DATA_MAPS: [&str; 4] = ["pathParams", "queryParams", "path_params", "query_params"];

fn camel_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut upper = false;
    for character in key.chars() {
        if character == '_' && !out.is_empty() {
            upper = true;
        } else if upper {
            out.extend(character.to_uppercase());
            upper = false;
        } else {
            out.push(character);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn bytes(value: &Value) -> Vec<u8> {
        value.to_string().into_bytes()
    }

    pub fn key_answer() -> Value {
        json!({
            "name": "GitHub Actions", "prefix": "ocw_pub_q9Xe", "scope": "submit",
            "expires_at": "2027-01-11T10:00:00Z",
            "widget": {"widget_id": "nova.lol-timers", "name": {"en": "LoL Timers", "fr": "Minuteurs LoL"}},
            "publisher": {"handle": "nova"}
        })
    }

    pub fn context_answer() -> Value {
        json!({
            "widget": {"widget_id": "nova.lol-timers", "status": "listed"},
            "last_approved": {"version": "1.2.0", "manifest": {"schemaVersion": 1, "id": "nova.lol-timers"}},
            "minimum_version": "1.2.1",
            "listing": {"privacy_policy_url": true, "support": true},
            "submissions": {"limit": 20, "remaining": 17, "next_submission_at": null},
            "review": {"available": true, "blocked_by": null},
            "agreement": {"version": 1, "accepted": true},
            "limits": {"archive_bytes": 33554432, "unpacked_bytes": 67108864, "unpacked_files": 2000,
                       "release_notes_chars": 500, "justification_chars": 500, "review_message_chars": 2000}
        })
    }

    fn submission(state: &str, version_id: Value) -> Value {
        json!({
            "id": 812, "state": state, "version": "1.3.1", "refused_reason": null,
            "archive": {"bytes": 188416, "sha256": "0b".repeat(32)},
            "expires_at": "2026-10-10T11:00:00Z", "created_at": "2026-10-10T10:00:00Z",
            "finalized_at": null, "version_id": version_id
        })
    }

    fn upload() -> Value {
        json!({
            "method": "PUT", "url": "https://storage.example/bucket/incoming/a.zip?X-Amz-Signature=s",
            "headers": {"Content-Length": "188416", "Content-Type": "application/zip",
                        "x-amz-checksum-sha256": "C7c=", "x-amz-sdk-checksum-algorithm": "SHA256"},
            "expires_at": "2026-10-10T10:15:00Z"
        })
    }

    pub fn version_answer(state: &str) -> Value {
        json!({
            "id": 77, "version": "1.3.1", "state": state, "review_type": "full",
            "build_status": "running", "widget_id": "nova.lol-timers",
            "created_at": "2026-10-10T10:00:00Z", "name": null, "release_notes": {},
            "checks": [{"key": "manifest", "status": "passed", "diagnostics": []}],
            "diagnostics": [], "review_blockers": [{"code": "privacy_policy_required"}],
            "complete_in_portal": null, "build_problem": null, "poll_after_seconds": 3,
            "remarks": [], "deadline": null
        })
    }

    #[test]
    fn the_key_answer_is_read() {
        let key = parse_key(&bytes(&key_answer())).expect("a key");
        assert_eq!(key.name, "GitHub Actions");
        assert_eq!(key.widget_id, "nova.lol-timers");
        assert_eq!(key.publisher, "nova");
        assert_eq!(key.expires_at, "2027-01-11T10:00:00Z");
        let mut missing = key_answer();
        missing["widget"]
            .as_object_mut()
            .expect("object")
            .remove("widget_id");
        assert!(parse_key(&bytes(&missing)).is_err());
    }

    #[test]
    fn the_context_is_read() {
        let context = parse_context(&bytes(&context_answer())).expect("a context");
        assert_eq!(context.widget_status, "listed");
        let previous = context.last_approved.as_ref().expect("approved");
        assert_eq!(previous.version, "1.2.0");
        assert_eq!(previous.manifest["id"], "nova.lol-timers");
        assert_eq!(context.minimum_version, "1.2.1");
        assert!(context.privacy_policy && context.support);
        assert_eq!(context.quota.remaining, 17);
        assert_eq!(context.quota.next_submission_at, None);
        assert!(context.review_available && context.agreement_accepted);
        assert_eq!(context.limits["unpacked_files"], 2000);
        let mut first = context_answer();
        first["last_approved"] = Value::Null;
        first["review"] = json!({"available": false, "blocked_by": "nova.other"});
        let context = parse_context(&bytes(&first)).expect("a context");
        assert!(context.last_approved.is_none());
        assert_eq!(context.review_blocked_by.as_deref(), Some("nova.other"));
        for field in ["minimum_version", "submissions", "agreement", "listing"] {
            let mut broken = context_answer();
            broken.as_object_mut().expect("object").remove(field);
            assert!(parse_context(&bytes(&broken)).is_err(), "{field}");
        }
        let mut wrong = context_answer();
        wrong["submissions"]["remaining"] = json!("17");
        assert!(parse_context(&bytes(&wrong)).is_err());
    }

    #[test]
    fn submissions_and_their_upload_are_read() {
        let created = json!({
            "submission": submission("pending_upload", Value::Null), "upload": upload(),
            "quota": {"limit": 20, "remaining": 16, "next_submission_at": null}
        });
        let reply = parse_submission(&bytes(&created)).expect("a submission");
        assert_eq!(reply.submission.id, 812);
        assert_eq!(reply.submission.state, "pending_upload");
        assert_eq!(reply.submission.version_id, None);
        let upload = reply.upload.expect("an upload");
        assert_eq!(upload.method, "PUT");
        assert!(upload.url.starts_with("https://storage.example/"));
        assert_eq!(upload.headers.len(), 4);
        assert!(
            upload
                .headers
                .contains(&("Content-Type".into(), "application/zip".into()))
        );
        // A finalized one, read again: no upload.
        let finalized = json!({"submission": submission("finalized", json!(77)), "upload": null});
        let reply = parse_submission(&bytes(&finalized)).expect("a submission");
        assert_eq!(reply.submission.version_id, Some(77));
        assert!(reply.upload.is_none());
        let mut bad = created.clone();
        bad["upload"]["headers"]["Content-Length"] = json!(188416);
        assert!(
            parse_submission(&bytes(&bad)).is_err(),
            "a header is a string"
        );
    }

    #[test]
    fn versions_are_read_and_kept_whole() {
        let finalized = json!({
            "submission": submission("finalized", json!(77)),
            "version": version_answer("checking")
        });
        let reply = parse_finalized(&bytes(&finalized)).expect("finalized");
        assert_eq!(reply.version.id, 77);
        assert_eq!(reply.version.state, "checking");
        assert_eq!(reply.version.poll_after_seconds, Some(3));
        let version =
            parse_version(&bytes(&json!({"version": version_answer("ready")}))).expect("a version");
        assert_eq!(version.state, "ready");
        assert_eq!(
            version.value["review_blockers"][0]["code"],
            "privacy_policy_required"
        );
        let list = parse_versions(&bytes(&json!({"versions": [
            {"id": 77, "version": "1.3.1", "state": "in_review", "review_type": "full",
             "build_status": "succeeded", "widget_id": "nova.lol-timers",
             "created_at": "2026-10-10T10:00:00Z", "name": null, "release_notes": {}},
            {"id": 70, "version": "1.3.0", "state": "checks_failed", "review_type": null,
             "build_status": "succeeded", "widget_id": "nova.lol-timers",
             "created_at": "2026-10-09T10:00:00Z", "name": null, "release_notes": {}}
        ]})))
        .expect("versions");
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].review_type, None);
        let mut broken = version_answer("checking");
        broken["id"] = json!("77");
        assert!(parse_version(&bytes(&json!({"version": broken}))).is_err());
    }

    #[test]
    fn errors_are_read_by_their_code() {
        let error = parse_error(&bytes(&json!({
            "code": "submission_limit_reached", "error": "Limit reached.",
            "next_submission_at": "2026-10-11T08:00:00Z", "retry_after": 60
        })))
        .expect("an error");
        assert_eq!(error.code, "submission_limit_reached");
        assert_eq!(error.message.as_deref(), Some("Limit reached."));
        assert_eq!(
            error.next_submission_at.as_deref(),
            Some("2026-10-11T08:00:00Z")
        );
        assert_eq!(error.retry_after, Some(60));
        let fields = parse_error(&bytes(&json!({
            "code": "validation_failed", "error": "Invalid.",
            "fields": [{"field": "release_notes.fr", "code": "text"}]
        })))
        .expect("an error");
        assert_eq!(
            fields.fields,
            [("release_notes.fr".to_owned(), "text".to_owned())]
        );
        assert!(parse_error(b"<html>Bad gateway</html>").is_none());
        assert!(parse_error(&bytes(&json!({"error": "no code"}))).is_none());
    }

    #[test]
    fn answers_that_are_not_objects_are_unreadable() {
        for answer in [&b""[..], b"null", b"[]", b"\"text\"", b"{", b"<html>"] {
            assert!(parse_key(answer).is_err());
            assert!(parse_context(answer).is_err());
            assert!(parse_submission(answer).is_err());
            assert!(parse_finalized(answer).is_err());
            assert!(parse_version(answer).is_err());
            assert!(parse_versions(answer).is_err());
        }
    }

    #[test]
    fn camelize_renames_every_key() {
        assert_eq!(
            camelize(&json!({
                "review_blockers": [{"code": "justification_missing", "missing_permissions": ["storage"]}],
                "complete_in_portal": {"message": "m", "url": "u"},
                "release_notes": {"en": "x"},
                "poll_after_seconds": 3,
                "already": 1
            })),
            json!({
                "reviewBlockers": [{"code": "justification_missing", "missingPermissions": ["storage"]}],
                "completeInPortal": {"message": "m", "url": "u"},
                "releaseNotes": {"en": "x"},
                "pollAfterSeconds": 3,
                "already": 1
            })
        );
        assert_eq!(
            camelize(&json!(["a_b", 1])),
            json!(["a_b", 1]),
            "values stay"
        );
        // Names a creator chose stay as written.
        let details = json!({"permissions": {"details": [{
            "kind": "network",
            "pathParams": {"page_size": {"type": "slug", "maxLength": 4}},
            "queryParams": {"a_b": {"type": "enum"}, "aB": {"type": "enum"}}
        }]}});
        assert_eq!(camelize(&details), details);
    }
}
