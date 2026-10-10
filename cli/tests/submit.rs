//! `submit` and `status` end to end through the binary, against a local
//! stand-in for the creator space's publish API (`support/fake_api.rs`):
//! the whole flow, every refusal, cuts and resumes, the signed upload, and
//! the publish key, which never appears in any output or file.

#[path = "support/fake_api.rs"]
mod fake_api;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use fake_api::{FakeApi, KEY, Reply, SECRET, VERSION_ID, error, version};
use serde_json::{Value, json};

const BIN: &str = env!("CARGO_BIN_EXE_overcrow-widget");

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

fn path(path: &Path) -> &str {
    path.to_str().expect("UTF-8 path")
}

/// A widget `nova.lol-timers` 1.3.1, the manifest of its last approved
/// version (1.2.0), and a private cache.
struct Project {
    folder: tempfile::TempDir,
    root: PathBuf,
}

impl Project {
    fn new() -> Self {
        let folder = tempfile::tempdir().expect("temporary directory");
        let root = folder.path().join("lol-timers");
        let output = Command::new(BIN)
            .args([
                "init",
                path(&root),
                "--template",
                "counter",
                "--id",
                fake_api::WIDGET,
            ])
            .output()
            .expect("init");
        assert!(output.status.success(), "{}", text(&output.stderr));
        let project = Self { folder, root };
        project.edit_manifest(|manifest| manifest["version"] = json!("1.3.1"));
        project
    }

    fn manifest(&self) -> Value {
        serde_json::from_slice(&fs::read(self.root.join("manifest.json")).expect("manifest"))
            .expect("JSON")
    }

    fn edit_manifest(&self, edit: impl FnOnce(&mut Value)) {
        let mut manifest = self.manifest();
        edit(&mut manifest);
        fs::write(self.root.join("manifest.json"), manifest.to_string()).expect("manifest");
    }

    /// The approved manifest: this one at 1.2.0.
    fn previous(&self) -> Value {
        let mut manifest = self.manifest();
        manifest["version"] = json!("1.2.0");
        manifest
    }

    fn cache(&self) -> PathBuf {
        self.folder.path().join("cache")
    }

    fn file(&self, name: &str, value: &Value) -> PathBuf {
        let file = self.folder.path().join(name);
        fs::write(&file, value.to_string()).expect("file");
        file
    }

    fn command(&self, api: &FakeApi, args: &[&str]) -> Command {
        let mut command = Command::new(BIN);
        command
            .args(args)
            .env("OVERCROW_API_URL", &api.url)
            .env("OVERCROW_PUBLISH_KEY", format!("{KEY}\n"))
            .env("XDG_CACHE_HOME", self.cache())
            .env("LOCALAPPDATA", self.cache());
        for proxy in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env_remove(proxy);
        }
        command
    }

    /// Runs the CLI; checks that the key appears nowhere.
    fn run(&self, api: &FakeApi, args: &[&str]) -> Output {
        let output = self.command(api, args).output().expect("the CLI runs");
        self.assert_no_key(&output);
        output
    }

    fn submit(&self, api: &FakeApi, extra: &[&str]) -> Output {
        let mut args = vec!["submit", path(&self.root)];
        args.extend_from_slice(extra);
        self.run(api, &args)
    }

    fn submit_json(&self, api: &FakeApi, extra: &[&str]) -> (Output, Value) {
        let mut args = extra.to_vec();
        args.extend_from_slice(&["--format", "json"]);
        let output = self.submit(api, &args);
        (output.clone(), json_of(&output))
    }

    fn assert_no_key(&self, output: &Output) {
        for (name, bytes) in [("stdout", &output.stdout), ("stderr", &output.stderr)] {
            let shown = text(bytes);
            assert!(!shown.contains(SECRET), "the key in {name}: {shown}");
        }
        let mut stack = vec![self.cache()];
        while let Some(directory) = stack.pop() {
            for entry in fs::read_dir(&directory).into_iter().flatten().flatten() {
                if entry.file_type().expect("type").is_dir() {
                    stack.push(entry.path());
                } else {
                    let content = fs::read(entry.path()).expect("file");
                    assert!(
                        !text(&content).contains(SECRET),
                        "the key in {}",
                        entry.path().display()
                    );
                    assert!(!entry.file_name().to_string_lossy().contains(&SECRET[..8]));
                }
            }
        }
    }
}

fn json_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "one JSON object: {}{}",
            text(&output.stdout),
            text(&output.stderr)
        )
    })
}

fn code(output: &Output) -> Option<i32> {
    output.status.code()
}

fn sent(api: &FakeApi) -> bool {
    api.lines()
        .iter()
        .any(|line| line.starts_with("POST") || line.starts_with("PUT"))
}

fn admitted_package(archive: &Path, folder: &Path) -> (Value, Value) {
    let admit = |target: &Path| {
        let output = Command::new(BIN)
            .args([
                "admit",
                path(target),
                "--publisher",
                "nova",
                "--listing",
                "optional",
                "--format",
                "json",
            ])
            .output()
            .expect("admit");
        assert_eq!(code(&output), Some(0), "{}", text(&output.stdout));
        json_of(&output)["package"].clone()
    };
    (admit(archive), admit(folder))
}

#[test]
fn a_version_is_sent_checked_and_enters_review() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![version("checking"), version("in_review")]);
    let output = project.submit(&api, &[]);
    assert_eq!(
        code(&output),
        Some(0),
        "{}{}",
        text(&output.stdout),
        text(&output.stderr)
    );
    assert_eq!(api.violations(), Vec::<String>::new());
    let lines = api.lines();
    assert_eq!(
        lines[..6],
        [
            "GET /api/v1/publish/key",
            "GET /api/v1/publish/context",
            "POST /api/v1/publish/submissions",
            "PUT /upload/812",
            "POST /api/v1/publish/submissions/812/finalize",
            "GET /api/v1/publish/versions/77",
        ]
    );
    let shown = text(&output.stdout);
    for expected in [
        "Key        GitHub Actions (q9Xe…), nova.lol-timers, expires 2027-01-11",
        "Version    1.3.1 (last approved 1.2.0, at least 1.2.1)",
        "Review     quick: no new permission",
        "Quota      17 of 20 submissions left (24 hours)",
        "Sent       submission 812, uploaded, checks started",
        "  passed   Code analysis",
        "nova.lol-timers 1.3.1: in review (quick review).",
    ] {
        assert!(shown.contains(expected), "{expected:?} in:\n{shown}");
    }
    let stderr = text(&output.stderr);
    assert!(
        stderr.contains("(OVERCROW_API_URL), not https://api.playervox.com"),
        "{stderr}"
    );
    // The request the API received, in snake_case.
    let create = &api.requests()[2];
    let body = create.json();
    assert_eq!(body["version"], "1.3.1");
    assert_eq!(body["auto_submit"], true);
    assert_eq!(body["justifications"], json!([]));
    assert_eq!(create.header("content-type"), Some("application/json"));
    // What was uploaded is admitted like the folder, byte for byte.
    let uploaded = project.folder.path().join("uploaded.zip");
    fs::write(&uploaded, api.uploaded().expect("an upload")).expect("archive");
    let (from_archive, from_folder) = admitted_package(&uploaded, &project.root);
    assert_eq!(from_archive, from_folder);
    // The state of an ended submission is gone.
    let states = fs::read_dir(project.cache().join("overcrow-widget/submit"))
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(states, 0);
}

#[test]
fn the_json_output_is_one_object() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(0), "{report}");
    assert_eq!(report["formatVersion"], 1);
    assert_eq!(report["command"], "submit");
    assert_eq!(report["dryRun"], false);
    assert_eq!(report["outcome"], "in_review");
    assert_eq!(report["exitCode"], 0);
    assert_eq!(report["error"], Value::Null);
    assert_eq!(report["key"]["hint"], "q9Xe");
    assert_eq!(report["key"]["expiresSoon"], false);
    assert_eq!(report["widget"]["id"], fake_api::WIDGET);
    assert_eq!(report["archive"]["kind"], "folder");
    let ignored: Vec<&str> = report["archive"]["ignored"]
        .as_array()
        .expect("ignored")
        .iter()
        .map(|item| item["path"].as_str().expect("path"))
        .collect();
    assert_eq!(ignored, [".gitignore"], "what the folder leaves out");
    assert_eq!(report["local"]["version"], "1.3.1");
    assert_eq!(report["local"]["permissions"]["reviewType"], "quick");
    assert_eq!(report["requirements"]["submissions"]["remaining"], 17);
    assert_eq!(report["submission"]["id"], 812);
    assert_eq!(report["submission"]["resumed"], false);
    assert_eq!(report["version"]["state"], "in_review");
    assert_eq!(report["version"]["reviewType"], "quick", "camelCase");
    assert!(report["version"].get("review_type").is_none());
    let uploaded = api.uploaded().expect("an upload");
    let digest = report["archive"]["sha256"].as_str().expect("digest");
    assert_eq!(report["archive"]["bytes"], uploaded.len());
    assert_eq!(api.requests()[2].json()["archive"]["sha256"], digest);
    assert!(text(&output.stdout).lines().count() == 1);
}

#[test]
fn failed_checks_show_the_sent_lines() {
    let project = Project::new();
    let first_line = fs::read_to_string(project.root.join("logic.ts"))
        .expect("logic")
        .lines()
        .next()
        .expect("a line")
        .to_owned();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![fake_api::failed_version(1)]);
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(1));
    let shown = text(&output.stdout);
    assert!(shown.contains("  failed   Code analysis"), "{shown}");
    assert!(
        shown.contains("error[logic.eval]: eval() is not allowed in a widget"),
        "{shown}"
    );
    assert!(shown.contains("--> logic.ts:1:1"), "{shown}");
    assert!(shown.contains(&format!(" 1 | {first_line}")), "{shown}");
    assert!(shown.contains("Nothing reached the reviewers."), "{shown}");
    let (_, report) = project.submit_json(&FakeApi::start(Some(project.previous())), &[]);
    assert_eq!(report["outcome"], "in_review");
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![fake_api::failed_version(1)]);
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(1));
    assert_eq!(report["outcome"], "checks_failed");
    assert_eq!(
        report["version"]["checks"][2]["diagnostics"][0]["code"],
        "logic.eval"
    );
}

#[test]
fn a_version_held_back_points_to_the_creator_space() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![fake_api::blocked_version()]);
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(3));
    let shown = text(&output.stdout);
    assert!(shown.contains("privacy_policy_required"), "{shown}");
    assert!(
        shown.contains("add a privacy policy to its listing"),
        "{shown}"
    );
    assert!(
        shown.contains(
            "https://overcrow.playervox.com/creators/widgets/nova.lol-timers/versions/77"
        ),
        "{shown}"
    );
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![fake_api::blocked_version()]);
    let (_, report) = project.submit_json(&api, &[]);
    assert_eq!(report["outcome"], "complete_in_portal");
    assert_eq!(report["exitCode"], 3);
    assert_eq!(
        report["version"]["completeInPortal"]["message"],
        "Complete it in the creator space"
    );
}

#[test]
fn the_submission_limit_is_said_before_and_by_the_api() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.context(|context| {
        context["submissions"] =
            json!({"limit": 20, "remaining": 0, "next_submission_at": "2026-10-11T08:00:00+02:00"});
    });
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(1));
    assert_eq!(report["outcome"], "refused_locally");
    assert!(!sent(&api), "{:?}", api.lines());
    let codes: Vec<&str> = report["local"]["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .map(|diagnostic| diagnostic["code"].as_str().expect("code"))
        .collect();
    assert_eq!(codes, ["submit.limit_reached"]);
    assert_eq!(
        report["requirements"]["submissions"]["nextSubmissionAt"],
        "2026-10-11T08:00:00+02:00"
    );

    let api = FakeApi::start(Some(project.previous()));
    let mut limit = error(
        "submission_limit_reached",
        "The publisher sent 20 versions in 24 hours.",
    );
    limit["next_submission_at"] = json!("2026-10-11T08:00:00+02:00");
    api.on("create", vec![Reply::Json(429, limit)]);
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(1), "{report}");
    assert_eq!(report["outcome"], "refused");
    assert_eq!(report["error"]["code"], "submission_limit_reached");
    assert_eq!(
        report["error"]["nextSubmissionAt"],
        "2026-10-11T08:00:00+02:00"
    );
    assert_eq!(report["error"]["httpStatus"], 429);
    assert!(
        text(&output.stderr).contains("Next submission possible at 2026-10-11T08:00:00+02:00.")
    );
}

#[test]
fn key_problems_stop_everything() {
    let project = Project::new();
    // No key, or not a key: nothing is sent at all.
    let api = FakeApi::start(Some(project.previous()));
    let output = project
        .command(&api, &["submit", path(&project.root), "--format", "json"])
        .env_remove("OVERCROW_PUBLISH_KEY")
        .output()
        .expect("runs");
    assert_eq!(code(&output), Some(2));
    assert_eq!(json_of(&output)["error"]["code"], "publish_key_missing");
    let output = project
        .command(&api, &["status", "--format", "json"])
        .env("OVERCROW_PUBLISH_KEY", format!("{KEY}x"))
        .output()
        .expect("runs");
    project.assert_no_key(&output);
    assert_eq!(code(&output), Some(2));
    assert_eq!(json_of(&output)["error"]["code"], "invalid_publish_key");
    assert!(api.requests().is_empty());
    // The API's refusals.
    for (answer, said) in [
        (
            error("invalid_publish_key", "Invalid publish key."),
            "Invalid publish key. Check the secret in OVERCROW_PUBLISH_KEY",
        ),
        (
            json!({"code": "publish_key_expired", "error": "This publish key expired.", "expired_at": "2026-10-01T10:00:00+02:00"}),
            "This publish key expired. Create a new publish key in the creator space",
        ),
        (
            error("publish_key_revoked", "This publish key was revoked."),
            "This publish key was revoked. Create a new publish key",
        ),
    ] {
        let api = FakeApi::start(Some(project.previous()));
        api.on("key", vec![Reply::Json(401, answer.clone())]);
        let output = project.submit(&api, &[]);
        assert_eq!(code(&output), Some(2), "{answer}");
        assert!(
            text(&output.stderr).contains(said),
            "{}",
            text(&output.stderr)
        );
        assert_eq!(api.lines(), ["GET /api/v1/publish/key"]);
    }
    let api = FakeApi::start(Some(project.previous()));
    api.on("key", vec![Reply::Json(401, json!({"code": "publish_key_expired", "error": "Expired.", "expired_at": "2026-10-01T10:00:00+02:00"}))]);
    let (_, report) = project.submit_json(&api, &[]);
    assert_eq!(report["error"]["expiredAt"], "2026-10-01T10:00:00+02:00");
}

#[test]
fn a_version_must_be_newer() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let mut refusal = error("version_not_newer", "The version must be above 1.3.1.");
    refusal["minimum_version"] = json!("1.3.2");
    api.on("create", vec![Reply::Json(422, refusal)]);
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(1));
    assert!(
        text(&output.stderr).contains("Use version 1.3.2 or higher"),
        "{}",
        text(&output.stderr)
    );
    // Below the context's minimum: refused before anything is sent.
    let api = FakeApi::start(Some(project.previous()));
    api.context(|context| context["minimum_version"] = json!("1.4.0"));
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(1));
    assert!(!sent(&api));
    assert!(
        report["local"]["diagnostics"]
            .to_string()
            .contains("submit.version_too_low")
    );
}

#[test]
fn a_cut_submission_resumes_with_the_same_idempotency_key() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    // The API creates the submission, but the answer never arrives.
    api.on(
        "create",
        vec![Reply::Cut, Reply::Cut, Reply::Cut, Reply::Auto],
    );
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(2), "{}", text(&output.stderr));
    let output = project.submit(&api, &[]);
    assert_eq!(
        code(&output),
        Some(0),
        "{}{}",
        text(&output.stdout),
        text(&output.stderr)
    );
    let keys = api.idempotency_keys();
    assert_eq!(keys.len(), 4);
    assert!(keys.iter().all(|key| *key == keys[0]), "{keys:?}");
    assert_eq!(api.violations(), Vec::<String>::new());

    // Cut during the upload: the next run uploads to the same submission.
    let api = FakeApi::start(Some(project.previous()));
    api.on(
        "upload",
        vec![Reply::Cut, Reply::Cut, Reply::Cut, Reply::Auto],
    );
    assert_eq!(code(&project.submit(&api, &[])), Some(2));
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(0), "{report}");
    assert_eq!(report["submission"]["resumed"], true);
    assert_eq!(report["submission"]["id"], 812);
    let keys = api.idempotency_keys();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
}

#[test]
fn a_finalized_submission_is_followed_again() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![version("checking")]);
    let output = project.submit(&api, &["--no-wait"]);
    assert_eq!(code(&output), Some(4));
    assert!(text(&output.stdout).contains("overcrow-widget status --version 1.3.1 --wait"));
    api.polls(vec![version("in_review")]);
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(0), "{}", text(&output.stderr));
    let uploads = api
        .lines()
        .iter()
        .filter(|line| line.starts_with("PUT"))
        .count();
    assert_eq!(uploads, 1, "{:?}", api.lines());
    assert_eq!(api.idempotency_keys().len(), 2);
}

#[test]
fn the_same_archive_is_sent_again_after_its_submission_expired() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.on(
        "upload",
        vec![Reply::Cut, Reply::Cut, Reply::Cut, Reply::Auto],
    );
    assert_eq!(code(&project.submit(&api, &[])), Some(2));
    api.expire_pending();
    let output = project.submit(&api, &[]);
    assert_eq!(
        code(&output),
        Some(0),
        "{}{}",
        text(&output.stdout),
        text(&output.stderr)
    );
    assert!(
        text(&output.stdout).contains("The earlier submission 812 is expired: starting a new one.")
    );
    let keys = api.idempotency_keys();
    assert_eq!(keys.len(), 3, "{keys:?}");
    assert_eq!(keys[0], keys[1], "the first try of the second run resumes");
    assert_ne!(keys[1], keys[2], "the new submission has a new key");
    assert!(api.lines().contains(&"PUT /upload/813".to_owned()));
}

#[test]
fn a_refused_upload_asks_for_a_fresh_link_once() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.on(
        "upload",
        vec![Reply::Raw(
            403,
            b"<Error><Code>AccessDenied</Code></Error>".to_vec(),
        )],
    );
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(2), "{report}");
    assert_eq!(report["error"]["code"], "upload_refused");
    let lines = api.lines();
    assert_eq!(
        lines.iter().filter(|line| line.starts_with("PUT")).count(),
        2,
        "{lines:?}"
    );
    assert!(lines.contains(&"GET /api/v1/publish/submissions/812".to_owned()));
    assert!(!lines.iter().any(|line| line.contains("finalize")));
}

#[test]
fn a_dry_run_sends_nothing() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let (output, report) = project.submit_json(&api, &["--dry-run"]);
    assert_eq!(code(&output), Some(0), "{report}");
    assert_eq!(report["outcome"], "ready_to_send");
    assert_eq!(report["dryRun"], true);
    assert_eq!(
        api.lines(),
        ["GET /api/v1/publish/key", "GET /api/v1/publish/context"]
    );
    assert_eq!(report["requirements"]["reviewType"], "quick");
    assert_eq!(
        report["requirements"]["justifications"]["required"],
        json!([])
    );
    assert!(
        report["archive"]["sha256"]
            .as_str()
            .is_some_and(|digest| digest.len() == 64)
    );
    let shown = text(&project.submit(&api, &["--dry-run"]).stdout);
    assert!(shown.contains("Dry run: nothing was sent."), "{shown}");
}

#[test]
fn new_permissions_need_a_justification() {
    let project = Project::new();
    let previous = project.previous();
    project.edit_manifest(|manifest| manifest["permissions"] = json!({"storage": true}));
    let api = FakeApi::start(Some(previous.clone()));
    let (output, report) = project.submit_json(&api, &["--dry-run"]);
    assert_eq!(code(&output), Some(1), "{report}");
    assert_eq!(
        report["requirements"]["justifications"]["missing"],
        json!(["storage"])
    );
    assert_eq!(report["requirements"]["reviewType"], "full");
    // Not even sent for real.
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(1));
    assert!(!sent(&api));
    assert!(
        text(&output.stdout).contains("submit.justification_missing"),
        "{}",
        text(&output.stdout)
    );
    // With its justification, the texts reach the API in snake_case.
    let texts = project.file(
        "submission.json",
        &json!({
            "releaseNotes": {"en": "Keeps your timers.", "fr": "Garde vos minuteurs."},
            "justifications": [{"permission": "storage", "text": "Keeps the timers between games."}],
            "reviewMessage": "Thanks for the review."
        }),
    );
    let output = project.submit(
        &api,
        &[
            "--submission",
            path(&texts),
            "--release-notes-fr",
            "Garde les minuteurs.",
        ],
    );
    assert_eq!(
        code(&output),
        Some(0),
        "{}{}",
        text(&output.stdout),
        text(&output.stderr)
    );
    let body = api
        .requests()
        .iter()
        .find(|request| request.line() == "POST /api/v1/publish/submissions")
        .expect("a submission")
        .json();
    assert_eq!(
        body["release_notes"],
        json!({"en": "Keeps your timers.", "fr": "Garde les minuteurs."})
    );
    assert_eq!(
        body["justifications"],
        json!([{"permission": "storage", "text": "Keeps the timers between games."}])
    );
    assert_eq!(body["review_message"], "Thanks for the review.");
    // A first version: every permission needs one.
    let api = FakeApi::start(None);
    let (_, report) = project.submit_json(&api, &["--dry-run", "--submission", path(&texts)]);
    assert_eq!(
        report["requirements"]["justifications"]["required"],
        json!(["storage"])
    );
    assert_eq!(
        report["requirements"]["justifications"]["missing"],
        json!([])
    );
    assert_eq!(report["local"]["previousVersion"], Value::Null);
}

#[test]
fn a_network_widget_without_a_privacy_policy_would_wait() {
    let project = Project::new();
    let previous = project.previous();
    project.edit_manifest(|manifest| {
        manifest["permissions"] = json!({"network": [{
            "origin": "https://api.nova.gg", "method": "GET", "path": "/v1/status", "maxResponseBytes": 4096
        }]});
    });
    let texts = project.file(
        "submission.json",
        &json!({"justifications": [{"permission": "network:GET https://api.nova.gg/v1/status", "text": "Shows incidents."}]}),
    );
    let api = FakeApi::start(Some(previous));
    api.context(|context| context["listing"]["privacy_policy_url"] = json!(false));
    let (output, report) = project.submit_json(&api, &["--dry-run", "--submission", path(&texts)]);
    assert_eq!(code(&output), Some(3), "{report}");
    assert_eq!(report["outcome"], "complete_in_portal");
    assert_eq!(
        report["requirements"]["privacyPolicy"],
        json!({"required": true, "present": false})
    );
    assert_eq!(
        report["requirements"]["blockers"],
        json!([{"code": "privacy_policy_required"}])
    );
}

#[test]
fn the_archive_is_bound_to_what_was_confirmed() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let (_, dry) = project.submit_json(&api, &["--dry-run"]);
    let digest = dry["archive"]["sha256"]
        .as_str()
        .expect("digest")
        .to_owned();
    let other = "0".repeat(64);
    let output = project.submit(&api, &["--expect-sha256", &other]);
    assert_eq!(code(&output), Some(1));
    assert!(!sent(&api));
    let (output, report) = project.submit_json(&api, &["--expect-sha256", &digest.to_uppercase()]);
    assert_eq!(code(&output), Some(0), "{report}");
    let output = project.submit(&api, &["--expect-sha256", "abc"]);
    assert_eq!(code(&output), Some(2), "a usage error");
}

#[test]
fn a_zip_is_sent_byte_for_byte() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    assert_eq!(code(&project.submit(&api, &["--no-wait"])), Some(4));
    let first = api.uploaded().expect("an upload");
    let archive = project.folder.path().join("lol-timers.zip");
    fs::write(&archive, &first).expect("archive");
    let api = FakeApi::start(Some(project.previous()));
    let output = project.run(&api, &["submit", path(&archive), "--format", "json"]);
    let report = json_of(&output);
    assert_eq!(code(&output), Some(0), "{report}");
    assert_eq!(report["archive"]["kind"], "archive");
    assert_eq!(api.uploaded().expect("an upload"), first);
}

#[test]
fn a_build_problem_on_our_side_is_not_the_creators() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let mut retrying = version("checking");
    retrying["build_problem"] = json!("retrying");
    let mut failed = version("checking");
    failed["build_problem"] = json!("failed");
    api.polls(vec![retrying, failed]);
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(2), "{report}");
    assert_eq!(report["error"]["code"], "build_failed");
    let api = FakeApi::start(Some(project.previous()));
    let mut retrying = version("checking");
    retrying["build_problem"] = json!("retrying");
    api.polls(vec![retrying, version("in_review")]);
    let output = project.submit(&api, &[]);
    assert_eq!(code(&output), Some(0));
    assert!(text(&output.stdout).contains("Problem on our side: checking again."));
}

#[cfg(unix)]
#[test]
fn ctrl_c_leaves_the_checks_running() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![version("checking")]);
    let child = project
        .command(&api, &["submit", path(&project.root)])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn");
    let started = std::time::Instant::now();
    while !api
        .lines()
        .iter()
        .any(|line| line.starts_with("GET /api/v1/publish/versions/"))
    {
        assert!(
            started.elapsed().as_secs() < 30,
            "never polled: {:?}",
            api.lines()
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // SAFETY: a signal to our own child.
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) };
    let output = child.wait_with_output().expect("ends");
    project.assert_no_key(&output);
    assert_eq!(code(&output), Some(4), "{}", text(&output.stderr));
    let shown = text(&output.stdout);
    assert!(
        shown.contains("the checks go on in the creator space"),
        "{shown}"
    );
    assert!(
        shown.contains("overcrow-widget status --version 1.3.1 --wait"),
        "{shown}"
    );
}

#[test]
fn verbose_shows_requests_but_no_secret() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let output = project.submit(&api, &["--verbose"]);
    assert_eq!(code(&output), Some(0));
    let log = text(&output.stderr);
    assert!(log.contains("GET /api/v1/publish/key -> 200"), "{log}");
    assert!(log.contains("request fake-200"), "{log}");
    assert!(
        log.contains(&format!("PUT {}/upload/812 (signed link) -> 200", api.url)),
        "{log}"
    );
    assert!(!log.contains("fake-signature"), "{log}");
    assert!(
        !log.contains("Authorization") && !log.contains("Bearer"),
        "{log}"
    );
}

#[test]
fn a_panic_never_shows_the_key() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let output = project
        .command(&api, &["submit", path(&project.root)])
        .env("OVERCROW_WIDGET_TEST_PANIC", "1")
        .output()
        .expect("runs");
    project.assert_no_key(&output);
    let stderr = text(&output.stderr);
    assert!(stderr.contains("internal error"), "{stderr}");
    assert!(stderr.contains("ocw_pub_[hidden]"), "{stderr}");
    assert_ne!(code(&output), Some(0));
}

#[test]
fn unexpected_answers_are_errors() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.on("key", vec![Reply::Raw(302, Vec::new())]);
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(2));
    assert_eq!(report["error"]["code"], "redirect");
    let api = FakeApi::start(Some(project.previous()));
    api.on(
        "context",
        vec![Reply::Raw(200, b"<html>Maintenance</html>".to_vec())],
    );
    let (output, report) = project.submit_json(&api, &[]);
    assert_eq!(code(&output), Some(2));
    assert_eq!(report["error"]["code"], "response");
    // A busy server: tried again.
    let api = FakeApi::start(Some(project.previous()));
    api.on(
        "key",
        vec![Reply::Json(503, error("unavailable", "Busy.")), Reply::Auto],
    );
    let output = project.submit(&api, &["--dry-run"]);
    assert_eq!(code(&output), Some(0), "{}", text(&output.stderr));
    assert_eq!(
        api.lines()[..2],
        ["GET /api/v1/publish/key", "GET /api/v1/publish/key"]
    );
}

#[test]
fn a_bad_texts_file_is_a_usage_error() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let texts = project.file("submission.json", &json!({"release_notes": {"en": "x"}}));
    let (output, report) = project.submit_json(&api, &["--submission", path(&texts)]);
    assert_eq!(code(&output), Some(2));
    assert_eq!(report["error"]["code"], "submission_file");
    assert!(api.requests().is_empty());
    let texts = project.file(
        "long.json",
        &json!({"releaseNotes": {"en": "x".repeat(501)}}),
    );
    let (output, report) = project.submit_json(&api, &["--submission", path(&texts)]);
    assert_eq!(code(&output), Some(1), "{report}");
    assert!(
        report["local"]["diagnostics"]
            .to_string()
            .contains("submit.release_notes")
    );
}

#[test]
fn status_lists_versions_and_shows_one() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    let output = project.run(&api, &["status"]);
    assert_eq!(code(&output), Some(0), "{}", text(&output.stderr));
    let shown = text(&output.stdout);
    assert!(shown.contains("1.3.1        in review (quick)"), "{shown}");
    assert!(shown.contains("#70"), "{shown}");
    assert_eq!(
        api.lines(),
        ["GET /api/v1/publish/key", "GET /api/v1/publish/versions"]
    );

    let output = project.run(&api, &["status", "--format", "json"]);
    let report = json_of(&output);
    assert_eq!(report["command"], "status");
    assert_eq!(report["versions"][0]["state"], "in_review");
    assert_eq!(report["versions"][0]["reviewType"], "quick");
    assert!(report.get("outcome").is_none());

    // By number: the latest of that number; by ID: that one.
    let api = FakeApi::start(Some(project.previous()));
    let output = project.run(&api, &["status", "--version", "1.3.1", "--format", "json"]);
    assert_eq!(code(&output), Some(0));
    assert_eq!(json_of(&output)["version"]["id"], VERSION_ID);
    assert_eq!(
        api.lines().last().map(String::as_str),
        Some("GET /api/v1/publish/versions/77")
    );
    let api = FakeApi::start(Some(project.previous()));
    let output = project.run(&api, &["status", "--version", "70"]);
    assert_eq!(code(&output), Some(0));
    assert_eq!(
        api.lines(),
        ["GET /api/v1/publish/key", "GET /api/v1/publish/versions/70"]
    );
    let output = project.run(&api, &["status", "--version", "9.9.9", "--format", "json"]);
    assert_eq!(code(&output), Some(2));
    assert_eq!(json_of(&output)["error"]["code"], "not_found");
    // A ready version: what keeps it out of review.
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![fake_api::blocked_version()]);
    let output = project.run(&api, &["status", "--version", "77"]);
    assert_eq!(code(&output), Some(0));
    assert!(text(&output.stdout).contains("add a privacy policy to its listing"));
}

#[test]
fn status_waits_for_the_checks() {
    let project = Project::new();
    let api = FakeApi::start(Some(project.previous()));
    api.polls(vec![
        version("checking"),
        version("checking"),
        fake_api::blocked_version(),
    ]);
    let output = project.run(
        &api,
        &["status", "--version", "77", "--wait", "--format", "json"],
    );
    let report = json_of(&output);
    assert_eq!(code(&output), Some(3), "{report}");
    assert_eq!(report["outcome"], "complete_in_portal");
    let output = project.run(&api, &["status", "--wait"]);
    assert_eq!(code(&output), Some(2), "--wait needs --version");
}

/// The texts file of the documentation (`docs/content/examples/weather`)
/// is what `submit` takes: every permission of that first version has its
/// justification.
#[test]
fn the_documented_texts_file_is_accepted() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/content/examples/weather");
    let folder = tempfile::tempdir().expect("temporary directory");
    let root = folder.path().join("weather");
    let mut stack = vec![PathBuf::new()];
    while let Some(relative) = stack.pop() {
        for entry in fs::read_dir(example.join(&relative))
            .expect("example")
            .flatten()
        {
            let name = entry.file_name();
            if name == "node_modules" {
                continue;
            }
            let path = relative.join(&name);
            if entry.file_type().expect("type").is_dir() {
                fs::create_dir_all(root.join(&path)).expect("folder");
                stack.push(path);
            } else {
                fs::create_dir_all(root.join(&relative)).expect("folder");
                fs::copy(entry.path(), root.join(&path)).expect("copy");
            }
        }
    }
    // The key of the stand-in API is for nova.lol-timers.
    let manifest_path = root.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("manifest")).expect("JSON");
    manifest["id"] = json!(fake_api::WIDGET);
    manifest["version"] = json!("1.3.1");
    fs::write(&manifest_path, manifest.to_string()).expect("manifest");
    let project = Project {
        folder,
        root: root.clone(),
    };
    let api = FakeApi::start(None);
    let texts = root.join("submission.json");
    let (output, report) = project.submit_json(&api, &["--dry-run", "--submission", path(&texts)]);
    assert_eq!(code(&output), Some(0), "{report}");
    assert_eq!(
        report["requirements"]["justifications"]["missing"],
        json!([])
    );
    assert_eq!(
        report["requirements"]["justifications"]["required"],
        json!([
            "network:GET https://api.example.com/v1/forecast/{city}",
            "storage"
        ])
    );
    // The workflow of the documentation is left out of what is sent.
    let ignored = report["archive"]["ignored"].to_string();
    assert!(ignored.contains(".github/"), "{ignored}");
}
