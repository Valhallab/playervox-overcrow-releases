//! A local stand-in for the creator space's publish API
//! (`/api/v1/publish/*`, JSON in snake_case) and for its signed upload,
//! for the tests of `submit` and `status`. Nothing reaches the network.
//!
//! Each route answers from a queue of [`Reply`]s (the last one repeats);
//! [`Reply::Auto`] does what the API does. Every request is recorded, and
//! what the API would refuse is recorded as a violation: a request without
//! the CLI's user agent, an API request without the key, an upload that
//! carries the key or whose signed headers or bytes are not the declared
//! ones.
#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

/// The publish key the tests use.
pub const KEY: &str = "ocw_pub_q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";
/// What must never appear in an output: the key without its prefix.
pub const SECRET: &str = "q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";
pub const WIDGET: &str = "nova.lol-timers";
/// The version the API creates when a submission is finalized.
pub const VERSION_ID: u64 = 77;

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header, _)| header.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    /// `"POST /api/v1/publish/submissions"`, the query left out.
    pub fn line(&self) -> String {
        let path = self.path.split('?').next().unwrap_or_default();
        format!("{} {path}", self.method)
    }
}

#[derive(Clone, Debug)]
pub enum Reply {
    /// What the API does.
    Auto,
    /// What the API does, but the connection is cut before the answer.
    Cut,
    Json(u16, Value),
    Raw(u16, Vec<u8>),
}

struct Submission {
    id: u64,
    idempotency_key: String,
    body: Value,
    state: String,
    uploaded: Option<Vec<u8>>,
}

struct State {
    url: String,
    routes: HashMap<&'static str, VecDeque<Reply>>,
    requests: Vec<Request>,
    violations: Vec<String>,
    key: Value,
    context: Value,
    submissions: Vec<Submission>,
    /// What `GET versions/77` answers, poll after poll (the last repeats).
    polls: VecDeque<Value>,
    next_id: u64,
}

pub struct FakeApi {
    pub url: String,
    state: Arc<Mutex<State>>,
}

/// A full version as the API gives it (OpenAPI `Version`).
pub fn version(state: &str) -> Value {
    let pending = state == "checking";
    let status = if pending { "pending" } else { "passed" };
    let checks: Vec<Value> = [
        "manifest",
        "version",
        "code",
        "build",
        "permissions",
        "size",
    ]
    .iter()
    .map(|key| json!({"key": key, "status": status, "diagnostics": []}))
    .collect();
    json!({
        "id": VERSION_ID, "version": "1.3.1", "state": state, "review_type": "quick",
        "build_status": if pending { "running" } else { "succeeded" },
        "widget_id": WIDGET, "created_at": "2026-10-10T12:00:00+02:00",
        "name": {"en": "LoL Timers", "fr": "Minuteurs LoL"}, "release_notes": {},
        "checked_at": null, "review_entered_at": null, "decided_at": null,
        "approved_at": null, "published_at": null,
        "checks": checks, "diagnostics": [], "uses_network": false, "ui_locales": ["en", "fr"],
        "permissions": {"keys": [], "added": [], "changed": [], "removed": [],
                        "previous_version": "1.2.0", "details": []},
        "required_justifications": [], "justifications": [], "review_message": null,
        "review_blockers": [], "complete_in_portal": null, "package": null,
        "sources": {"bytes": 1, "sha256": "00".repeat(32)}, "diff": null,
        "previous_version": "1.2.0", "build_problem": null,
        "poll_after_seconds": if pending { json!(1) } else { Value::Null },
        "history": [], "remarks": [], "deadline": null
    })
}

/// A version whose code check failed on `logic.ts` line `line`.
pub fn failed_version(line: u64) -> Value {
    let mut value = version("checks_failed");
    value["checks"][2] = json!({
        "key": "code", "status": "failed",
        "diagnostics": [{
            "code": "logic.eval", "severity": "error", "file": "logic.ts",
            "line": line, "column": 1, "message": "eval() is not allowed in a widget",
            "help": "to read JSON, use JSON.parse(raw)"
        }]
    });
    value
}

/// A version that passed its checks but waits in the creator space.
pub fn blocked_version() -> Value {
    let mut value = version("ready");
    value["review_blockers"] = json!([{"code": "privacy_policy_required"}]);
    value["complete_in_portal"] = json!({
        "message": "Complete it in the creator space",
        "url": format!("https://overcrow.playervox.com/creators/widgets/{WIDGET}/versions/{VERSION_ID}")
    });
    value
}

pub fn key_answer() -> Value {
    json!({
        "name": "GitHub Actions", "prefix": "ocw_pub_q9Xe", "scope": "submit",
        "expires_at": "2027-01-11T11:00:00+01:00",
        "widget": {"widget_id": WIDGET, "name": {"en": "LoL Timers", "fr": "Minuteurs LoL"}},
        "publisher": {"handle": "nova"}
    })
}

/// The context of an update whose last approved manifest is `previous`.
pub fn context_answer(previous: Option<Value>) -> Value {
    json!({
        "widget": {"widget_id": WIDGET, "status": "listed"},
        "last_approved": previous.map(|manifest| json!({
            "version": manifest["version"].clone(), "manifest": manifest
        })),
        "minimum_version": "1.2.1",
        "listing": {"privacy_policy_url": true, "support": true},
        "submissions": {"limit": 20, "remaining": 17, "next_submission_at": null},
        "review": {"available": true, "blocked_by": null},
        "agreement": {"version": 1, "accepted": true},
        "limits": {"archive_bytes": 33554432, "unpacked_bytes": 67108864, "unpacked_files": 2000,
                   "release_notes_chars": 500, "justification_chars": 500, "review_message_chars": 2000}
    })
}

pub fn error(code: &str, message: &str) -> Value {
    json!({"code": code, "error": message})
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(ALPHABET[(value >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len() / 2)
        .filter_map(|index| u8::from_str_radix(text.get(index * 2..index * 2 + 2)?, 16).ok())
        .collect()
}

impl FakeApi {
    /// Answers an update of [`WIDGET`] whose last approved manifest is
    /// `previous` (`None`: a first version).
    pub fn start(previous: Option<Value>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let url = format!(
            "http://127.0.0.1:{}",
            listener.local_addr().expect("address").port()
        );
        let state = Arc::new(Mutex::new(State {
            url: url.clone(),
            routes: HashMap::new(),
            requests: Vec::new(),
            violations: Vec::new(),
            key: key_answer(),
            context: context_answer(previous),
            submissions: Vec::new(),
            polls: VecDeque::from([version("in_review")]),
            next_id: 812,
        }));
        let shared = Arc::clone(&state);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                serve(stream, &shared);
            }
        });
        Self { url, state }
    }

    /// The replies of `route` (`key`, `context`, `create`, `submission`,
    /// `upload`, `finalize`, `versions`, `version`), in order.
    pub fn on(&self, route: &'static str, replies: Vec<Reply>) {
        self.state
            .lock()
            .unwrap()
            .routes
            .insert(route, replies.into());
    }

    /// What `GET versions/77` answers, poll after poll.
    pub fn polls(&self, versions: Vec<Value>) {
        self.state.lock().unwrap().polls = versions.into();
    }

    pub fn context(&self, edit: impl FnOnce(&mut Value)) {
        edit(&mut self.state.lock().unwrap().context);
    }

    /// Every submission not finalized expires (an hour went by).
    pub fn expire_pending(&self) {
        for submission in &mut self.state.lock().unwrap().submissions {
            if submission.state == "pending_upload" {
                submission.state = "expired".into();
            }
        }
    }

    pub fn requests(&self) -> Vec<Request> {
        self.state.lock().unwrap().requests.clone()
    }

    /// `"GET /api/v1/publish/key"`… in order.
    pub fn lines(&self) -> Vec<String> {
        self.requests().iter().map(Request::line).collect()
    }

    pub fn violations(&self) -> Vec<String> {
        self.state.lock().unwrap().violations.clone()
    }

    /// The bytes of the last upload received.
    pub fn uploaded(&self) -> Option<Vec<u8>> {
        let state = self.state.lock().unwrap();
        state
            .submissions
            .iter()
            .rev()
            .find_map(|submission| submission.uploaded.clone())
    }

    /// The `Idempotency-Key` of every submission request, in order.
    pub fn idempotency_keys(&self) -> Vec<String> {
        self.requests()
            .iter()
            .filter(|request| request.line() == "POST /api/v1/publish/submissions")
            .map(|request| {
                request
                    .header("idempotency-key")
                    .unwrap_or_default()
                    .to_owned()
            })
            .collect()
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();
    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).ok()?;
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        let (name, value) = header.split_once(':')?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    let length: usize = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    Some(Request {
        method,
        path,
        headers,
        body,
    })
}

fn route(request: &Request) -> Option<(&'static str, Option<u64>)> {
    let path = request.path.split('?').next().unwrap_or_default();
    let id = |rest: &str| rest.parse::<u64>().ok();
    let api = path.strip_prefix("/api/v1/publish/");
    Some(match (request.method.as_str(), api) {
        ("GET", Some("key")) => ("key", None),
        ("GET", Some("context")) => ("context", None),
        ("POST", Some("submissions")) => ("create", None),
        ("GET", Some("versions")) => ("versions", None),
        ("GET", Some(rest)) if rest.starts_with("submissions/") => {
            ("submission", id(&rest["submissions/".len()..]))
        }
        ("POST", Some(rest)) if rest.starts_with("submissions/") && rest.ends_with("/finalize") => {
            (
                "finalize",
                id(&rest["submissions/".len()..rest.len() - "/finalize".len()]),
            )
        }
        ("GET", Some(rest)) if rest.starts_with("versions/") => {
            ("version", id(&rest["versions/".len()..]))
        }
        ("PUT", None) if path.starts_with("/upload/") => ("upload", id(&path["/upload/".len()..])),
        _ => return None,
    })
}

fn serve(mut stream: TcpStream, shared: &Arc<Mutex<State>>) {
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    let mut state = shared.lock().unwrap();
    state.requests.push(request.clone());
    let agent = request.header("user-agent").unwrap_or_default();
    if !agent.starts_with("overcrow-widget/") || !agent.ends_with(')') {
        state
            .violations
            .push(format!("{}: user agent {agent:?}", request.line()));
    }
    let Some((name, id)) = route(&request) else {
        drop(state);
        respond(
            &mut stream,
            404,
            &error("not_found", "Not found.").to_string().into_bytes(),
        );
        return;
    };
    let authorization = request.header("authorization");
    if name == "upload" {
        if authorization.is_some() {
            state
                .violations
                .push("the upload carries an Authorization header".into());
        }
    } else if authorization != Some(&format!("Bearer {KEY}")) {
        state.violations.push(format!(
            "{}: authorization {authorization:?}",
            request.line()
        ));
    }
    let queue = state
        .routes
        .entry(name)
        .or_insert_with(|| VecDeque::from([Reply::Auto]));
    let reply = if queue.len() > 1 {
        queue.pop_front().unwrap_or(Reply::Auto)
    } else {
        queue.front().cloned().unwrap_or(Reply::Auto)
    };
    let (status, body, cut) = match reply {
        Reply::Json(status, value) => (status, value.to_string().into_bytes(), false),
        Reply::Raw(status, body) => (status, body, false),
        Reply::Auto | Reply::Cut => {
            let (status, value) = auto(&mut state, name, id, &request);
            let body = value
                .map(|value| value.to_string().into_bytes())
                .unwrap_or_default();
            (status, body, matches!(reply, Reply::Cut))
        }
    };
    drop(state);
    if cut {
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return;
    }
    respond(&mut stream, status, &body);
}

fn respond(stream: &mut TcpStream, status: u16, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status} Fake\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-Request-Id: fake-{status}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn submission_json(submission: &Submission) -> Value {
    let finalized = submission.state == "finalized";
    json!({
        "id": submission.id, "state": submission.state, "version": submission.body["version"],
        "refused_reason": null, "archive": submission.body["archive"],
        "expires_at": "2026-10-10T13:00:00+02:00", "created_at": "2026-10-10T12:00:00+02:00",
        "finalized_at": if finalized { json!("2026-10-10T12:01:00+02:00") } else { Value::Null },
        "version_id": if finalized { json!(VERSION_ID) } else { Value::Null }
    })
}

fn upload_json(url: &str, submission: &Submission) -> Value {
    if submission.state != "pending_upload" {
        return Value::Null;
    }
    let archive = &submission.body["archive"];
    json!({
        "method": "PUT",
        "url": format!("{url}/upload/{}?X-Amz-Signature=fake-signature", submission.id),
        "headers": {
            "Content-Length": archive["bytes"].to_string(),
            "Content-Type": "application/zip",
            "x-amz-checksum-sha256": base64(&unhex(archive["sha256"].as_str().unwrap_or_default())),
            "x-amz-sdk-checksum-algorithm": "SHA256"
        },
        "expires_at": "2026-10-10T12:15:00+02:00"
    })
}

/// What the API does on `name`.
fn auto(state: &mut State, name: &str, id: Option<u64>, request: &Request) -> (u16, Option<Value>) {
    let url = state.url.clone();
    let quota = json!({"limit": 20, "remaining": 16, "next_submission_at": null});
    match name {
        "key" => (200, Some(state.key.clone())),
        "context" => (200, Some(state.context.clone())),
        "create" => {
            let key = request
                .header("idempotency-key")
                .unwrap_or_default()
                .to_owned();
            if key.is_empty() {
                return (
                    400,
                    Some(error(
                        "idempotency_key_required",
                        "Idempotency-Key required.",
                    )),
                );
            }
            let body = request.json();
            if let Some(existing) = state.submissions.iter().find(|s| s.idempotency_key == key) {
                if existing.body != body {
                    return (422, Some(error("idempotency_key_reused", "Another body.")));
                }
                return (
                    200,
                    Some(json!({
                        "submission": submission_json(existing),
                        "upload": upload_json(&url, existing),
                        "quota": quota
                    })),
                );
            }
            let submission = Submission {
                id: state.next_id,
                idempotency_key: key,
                body,
                state: "pending_upload".into(),
                uploaded: None,
            };
            state.next_id += 1;
            let answer = json!({
                "submission": submission_json(&submission),
                "upload": upload_json(&url, &submission),
                "quota": quota
            });
            state.submissions.push(submission);
            (201, Some(answer))
        }
        "submission" => match state.submissions.iter().find(|s| Some(s.id) == id) {
            Some(submission) => (
                200,
                Some(json!({
                    "submission": submission_json(submission),
                    "upload": upload_json(&url, submission)
                })),
            ),
            None => (404, Some(error("not_found", "Not found."))),
        },
        "upload" => {
            let Some(index) = state.submissions.iter().position(|s| Some(s.id) == id) else {
                return (404, None);
            };
            let expected = upload_json(&url, &state.submissions[index]);
            let mut problems = Vec::new();
            for (name, value) in expected["headers"].as_object().into_iter().flatten() {
                if request.header(name) != value.as_str() {
                    problems.push(format!("header {name}: {:?}", request.header(name)));
                }
            }
            let archive = &state.submissions[index].body["archive"];
            let digest: String = Sha256::digest(&request.body)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            if Some(digest.as_str()) != archive["sha256"].as_str()
                || Some(request.body.len() as u64) != archive["bytes"].as_u64()
            {
                problems.push("the bytes are not the declared archive".into());
            }
            if !problems.is_empty() {
                state.violations.extend(problems);
                return (403, None);
            }
            state.submissions[index].uploaded = Some(request.body.clone());
            (200, None)
        }
        "finalize" => {
            let Some(index) = state.submissions.iter().position(|s| Some(s.id) == id) else {
                return (404, Some(error("not_found", "Not found.")));
            };
            if state.submissions[index].state == "expired" {
                return (
                    410,
                    Some(error("submission_expired", "This submission expired.")),
                );
            }
            if state.submissions[index].uploaded.is_none() {
                return (
                    409,
                    Some(error("upload_missing", "The upload has not arrived.")),
                );
            }
            state.submissions[index].state = "finalized".into();
            let answer = json!({
                "submission": submission_json(&state.submissions[index]),
                "version": version("checking")
            });
            (200, Some(answer))
        }
        "versions" => {
            let current = state
                .polls
                .back()
                .cloned()
                .unwrap_or_else(|| version("in_review"));
            let summary: serde_json::Map<String, Value> = [
                "id",
                "version",
                "state",
                "review_type",
                "build_status",
                "widget_id",
                "created_at",
                "name",
                "release_notes",
            ]
            .iter()
            .map(|field| ((*field).to_owned(), current[*field].clone()))
            .collect();
            let mut older = summary.clone();
            older.insert("id".into(), json!(70));
            older.insert("version".into(), json!("1.3.1"));
            older.insert("state".into(), json!("checks_failed"));
            (200, Some(json!({"versions": [summary, older]})))
        }
        "version" => {
            if id != Some(VERSION_ID) && id != Some(70) {
                return (404, Some(error("not_found", "Not found.")));
            }
            let next = if state.polls.len() > 1 {
                state.polls.pop_front()
            } else {
                state.polls.front().cloned()
            };
            (
                200,
                Some(json!({"version": next.unwrap_or_else(|| version("in_review"))})),
            )
        }
        _ => (404, None),
    }
}
