//! `overcrow-widget submit [dir | sources.zip]`: the key and its context,
//! local checks on exactly the archive that will be sent (the folder is
//! zipped, then read back and admitted as the creator space admits it),
//! then the submission, the signed upload, the finalization and the
//! checks, until the version enters review or stops.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use overcrow_widget_schema::package::{hex, sha256};
use overcrow_widget_schema::version::Version as SemVer;
use serde_json::{Map, Value, json};

use super::api::{self, Context, KeyInfo, SubmissionReply};
use super::client::{Client, Failure};
use super::follow::{self, End, Progress};
use super::render::Files;
use super::state::Resume;
use super::texts::{self, Limits, Overrides, Texts};
use super::{Out, Outcome};
use crate::admit;
use crate::diag::{Diagnostic, Report};
use crate::sanitize;
use crate::sourcetree::{self, Tree};
use crate::zipwrite;

pub struct SubmitOptions<'a> {
    pub target: PathBuf,
    pub submission: Option<&'a Path>,
    pub overrides: Overrides<'a>,
    pub dry_run: bool,
    pub no_wait: bool,
    pub expect_sha256: Option<&'a str>,
    pub json: bool,
    pub verbose: bool,
}

/// Waits between two finalizations while the upload is not seen yet.
const UPLOAD_MISSING_WAITS: [u64; 4] = [1, 2, 4, 8];

pub fn submit(raw_key: Option<String>, options: &SubmitOptions<'_>) -> ExitCode {
    super::install_panic_hook();
    let mut out = Out::new("submit", options.json);
    out.set("dryRun", json!(options.dry_run));
    for field in [
        "key",
        "widget",
        "archive",
        "local",
        "requirements",
        "submission",
        "version",
    ] {
        out.set(field, Value::Null);
    }
    let texts = match texts::load(options.submission, &options.overrides) {
        Ok(texts) => texts,
        Err(message) => return out.fail("submission_file", &message, Map::new()),
    };
    let client = match super::connect(raw_key, options.verbose, &out) {
        Ok(client) => client,
        Err((code, message)) => return out.fail(&code, &message, Map::new()),
    };
    let key = match super::read_key(&client, &mut out) {
        Ok(key) => key,
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    let context = match client
        .get("/api/v1/publish/context")
        .and_then(|answer| api::parse_context(&answer.body).map_err(Failure::Response))
    {
        Ok(context) => context,
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    out.set(
        "widget",
        json!({"id": key.widget_id, "publisher": key.publisher, "status": context.widget_status}),
    );
    let checked = match check_locally(&key, &context, &texts, options, &mut out) {
        Ok(checked) => checked,
        Err(Stop::Error { code, message }) => return out.fail(&code, &message, Map::new()),
        Err(Stop::Refused) => {
            out.say("Nothing was sent.");
            return out.finish(Outcome::RefusedLocally);
        }
    };
    if checked.refused {
        out.say("Nothing was sent.");
        return out.finish(Outcome::RefusedLocally);
    }
    if options.dry_run {
        out.say("Dry run: nothing was sent.");
        return out.finish(if checked.blockers.is_empty() {
            Outcome::ReadyToSend
        } else {
            Outcome::CompleteInPortal
        });
    }
    let mut body = Map::new();
    body.insert("version".into(), json!(checked.version));
    body.insert(
        "archive".into(),
        json!({"bytes": checked.archive.len(), "sha256": checked.sha256}),
    );
    body.extend(texts.api_fields());
    body.insert("auto_submit".into(), json!(true));
    let body = Value::Object(body);
    send(&client, &body, &checked, options, out)
}

/// Why the local checks stopped early.
enum Stop {
    /// Not the creator's doing (a file that cannot be read, a bug).
    Error { code: String, message: String },
    /// The sources are refused; their diagnostics are recorded.
    Refused,
}

impl Stop {
    fn error(code: &str, message: impl Into<String>) -> Self {
        Self::Error {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

/// What the local checks found.
struct Checked {
    version: String,
    archive: Vec<u8>,
    sha256: String,
    /// The files sent, to show the lines the creator space points at.
    files: Files,
    /// An error was found: nothing is sent.
    refused: bool,
    /// What would keep the version out of review (the creator space says
    /// it again with `review_blockers`).
    blockers: Vec<&'static str>,
}

/// Steps 3 of the design: everything is checked on the archive that would
/// be sent; the refusals are printed and recorded.
fn check_locally(
    key: &KeyInfo,
    context: &Context,
    texts: &Texts,
    options: &SubmitOptions<'_>,
    out: &mut Out,
) -> Result<Checked, Stop> {
    let mut report = Report::default();
    let limits = &context.limits;
    match context.widget_status.as_str() {
        "suspended" | "removed" => report.push(
            Diagnostic::error(
                "submit.widget_not_submittable",
                format!(
                    "this widget is {}: it cannot receive versions",
                    sanitize::line(&context.widget_status)
                ),
            )
            .help("see the widget in the creator space"),
        ),
        _ => {}
    }
    if !context.agreement_accepted {
        report.push(Diagnostic::error(
            "submit.agreement_required",
            format!(
                "the creator agreement changed (version {}): accept it in the creator space first",
                context.agreement_version
            ),
        ));
    }
    if context.quota.remaining == 0 {
        let when = context
            .quota
            .next_submission_at
            .as_deref()
            .map(|at| format!(": next one at {}", sanitize::line(at)))
            .unwrap_or_default();
        report.push(Diagnostic::error(
            "submit.limit_reached",
            format!(
                "the publisher sent its {} versions of the last 24 hours{when}",
                context.quota.limit
            ),
        ));
    }
    for diagnostic in texts::check(texts, &Limits::from_context(limits)) {
        report.push(diagnostic);
    }

    let (tree, archive, kind) = read_sources(&options.target, out)?;
    let sha256 = hex(&sha256(&archive));
    let bound = |field: &str, default: u64| limits[field].as_u64().unwrap_or(default);
    if archive.len() as u64 > bound("archive_bytes", sourcetree::MAX_ARCHIVE_BYTES) {
        report.push(Diagnostic::error(
            "submit.archive_too_large",
            format!(
                "the archive is {} bytes, more than the creator space takes",
                archive.len()
            ),
        ));
    }
    if tree.files.len() as u64 > bound("unpacked_files", sourcetree::MAX_FILES as u64)
        || tree.bytes() > bound("unpacked_bytes", sourcetree::MAX_BYTES)
    {
        report.push(Diagnostic::error(
            "submit.archive_too_large",
            "the sources hold more files or bytes than the creator space takes",
        ));
    }
    if let Some(expected) = options.expect_sha256
        && !expected.eq_ignore_ascii_case(&sha256)
    {
        report.push(
            Diagnostic::error(
                "submit.archive_mismatch",
                format!("the archive's SHA-256 is {sha256}, not the expected one"),
            )
            .help("the sources changed since the check: run --dry-run again"),
        );
    }
    let mut summary = tree.summary_json();
    out.set(
        "archive",
        json!({
            "kind": kind,
            "bytes": archive.len(),
            "sha256": sha256,
            "files": tree.files.len(),
            "uncompressedBytes": tree.bytes(),
            "ignored": summary["ignored"].take(),
        }),
    );
    out.say(&format!(
        "Sources    {} files, {} bytes{}, sha256 {sha256}{}",
        tree.files.len(),
        archive.len(),
        if kind == "folder" { " zipped" } else { "" },
        left_out(&tree)
    ));

    // Admission, as the creator space runs it on the archive.
    let admitted = admit_archive(key, context, &tree, &mut report)
        .map_err(|message| Stop::error("sources.read", message))?;
    let permissions = &admitted["permissions"];
    let version = admitted["version"].as_str().unwrap_or_default().to_owned();
    if let (Some(current), Some(minimum)) = (
        SemVer::parse(&version),
        SemVer::parse(&context.minimum_version),
    ) && current < minimum
    {
        report.push(
            Diagnostic::error(
                "submit.version_too_low",
                format!(
                    "version {current} is below {minimum}, the lowest the creator space takes now"
                ),
            )
            .in_file("manifest.json")
            .help(format!("use {minimum} or higher in manifest.json")),
        );
    }
    let keys = strings(&permissions["keys"]);
    let required: BTreeSet<String> = if context.last_approved.is_some() {
        strings(&permissions["added"])
            .into_iter()
            .chain(strings(&permissions["changed"]))
            .collect()
    } else {
        keys.clone()
    };
    let given: BTreeSet<String> = texts.justified().map(str::to_owned).collect();
    let missing: Vec<&String> = required.difference(&given).collect();
    let unused: Vec<&String> = given.difference(&keys).collect();
    if !missing.is_empty() {
        report.push(
            Diagnostic::error(
                "submit.justification_missing",
                format!(
                    "a justification is needed for each new permission: {}",
                    missing
                        .iter()
                        .map(|key| sanitize::line(key))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
            .help("add {\"permission\", \"text\"} to justifications in the --submission file"),
        );
    }
    for key in &unused {
        out.warn(&format!(
            "this version does not ask for {}: its justification is ignored",
            sanitize::line(key)
        ));
    }
    let network = keys.iter().any(|key| key.starts_with("network:"));
    let mut blockers = Vec::new();
    if network && !context.privacy_policy {
        blockers.push("privacy_policy_required");
    }
    if !context.review_available {
        blockers.push("review_limit_new_publisher");
    }
    if context.last_approved.is_none() && !context.support {
        blockers.push("listing_incomplete");
    }
    let review_type = if context.last_approved.is_none() {
        "full"
    } else {
        permissions["reviewType"].as_str().unwrap_or("full")
    };
    out.set(
        "local",
        json!({
            "admitted": admitted["admitted"],
            "version": admitted["version"],
            "minimumVersion": context.minimum_version,
            "previousVersion": context.last_approved.as_ref().map(|approved| approved.version.clone()),
            "permissions": {
                "keys": keys,
                "added": permissions["added"],
                "changed": permissions["changed"],
                "removed": permissions["removed"],
                "reviewType": review_type,
            },
            "diagnostics": diagnostics_json(&report),
        }),
    );
    out.set(
        "requirements",
        json!({
            "justifications": {
                "required": required,
                "given": given,
                "missing": missing,
                "unused": unused,
            },
            "privacyPolicy": {"required": network, "present": context.privacy_policy},
            "reviewType": review_type,
            "submissions": {
                "limit": context.quota.limit,
                "remaining": context.quota.remaining,
                "nextSubmissionAt": context.quota.next_submission_at,
            },
            "review": {"available": context.review_available, "blockedBy": context.review_blocked_by},
            "agreement": {"version": context.agreement_version, "accepted": context.agreement_accepted},
            "blockers": blockers.iter().map(|code| json!({"code": code})).collect::<Vec<_>>(),
        }),
    );
    show_summary(
        out,
        &version,
        context,
        &required,
        &given,
        review_type,
        permissions,
        &blockers,
    );
    emit_local(out, &report, &tree.files);
    Ok(Checked {
        version,
        archive,
        sha256,
        files: tree.files,
        refused: report.errors() > 0,
        blockers,
    })
}

/// The sources as the archive that will be sent: a folder is zipped, then
/// read back; a ZIP is read from its own bytes, which are sent as they are.
fn read_sources(target: &Path, out: &mut Out) -> Result<(Tree, Vec<u8>, &'static str), Stop> {
    let Some(input) = sourcetree::Input::of(target) else {
        return Err(Stop::error(
            "sources",
            format!(
                "{} is not a widget folder or a source .zip",
                sanitize::line(&target.display().to_string())
            ),
        ));
    };
    let mut report = Report::default();
    let (bytes, kind) = match &input {
        sourcetree::Input::Folder(_) => {
            let Some(folder) = sourcetree::read(&input, &mut report) else {
                return Err(refused_sources(&report, out));
            };
            (zipwrite::write(&folder.files), "folder")
        }
        sourcetree::Input::Archive(path) => {
            match crate::project::read_bounded(path, sourcetree::MAX_ARCHIVE_BYTES) {
                Ok(Some(bytes)) => (bytes, "archive"),
                Ok(None) => {
                    report.push(
                        Diagnostic::error(
                            "sources.archive_size",
                            format!(
                                "the archive is larger than {} MiB",
                                sourcetree::MAX_ARCHIVE_BYTES >> 20
                            ),
                        )
                        .in_file(path.display().to_string()),
                    );
                    return Err(refused_sources(&report, out));
                }
                Err(error) => {
                    return Err(Stop::error(
                        "sources.read",
                        format!("cannot read {}: {error}", path.display()),
                    ));
                }
            }
        }
    };
    let shown = target.display().to_string();
    let Some(mut tree) = sourcetree::read_archive_bytes(&bytes, &shown, &mut report) else {
        if kind == "folder" {
            // Our own ZIP must read back: a bug, never the creator's.
            return Err(Stop::error(
                "internal",
                "the ZIP of the sources does not read back",
            ));
        }
        return Err(refused_sources(&report, out));
    };
    if kind == "folder" {
        let mut again = Report::default();
        match sourcetree::read(&input, &mut again) {
            // What the folder left out is what the creator wants to see.
            Some(folder) if folder.files == tree.files => tree.ignored = folder.ignored,
            _ => {
                return Err(Stop::error(
                    "internal",
                    "the sources changed while they were zipped: try again",
                ));
            }
        }
    }
    Ok((tree, bytes, kind))
}

/// Records and shows why the sources are refused.
fn refused_sources(report: &Report, out: &mut Out) -> Stop {
    if sourcetree::io_failed(report) {
        let message = report
            .diagnostics
            .first()
            .map(|diagnostic| diagnostic.message.clone())
            .unwrap_or_default();
        return Stop::error("sources.read", message);
    }
    for diagnostic in &report.diagnostics {
        out.say(diagnostic.render(None).trim_end());
    }
    out.set(
        "local",
        json!({"admitted": false, "diagnostics": diagnostics_json(report)}),
    );
    Stop::Refused
}

/// Admits the archive's files as the creator space does: the key's widget,
/// the listing optional, compared with the last approved manifest.
fn admit_archive(
    key: &KeyInfo,
    context: &Context,
    tree: &Tree,
    report: &mut Report,
) -> Result<Value, String> {
    let work = sourcetree::materialize(tree)
        .map_err(|error| format!("cannot write the sources into a work folder: {error}"))?;
    let previous = match &context.last_approved {
        Some(approved) => {
            let folder = private_folder()
                .map_err(|error| format!("cannot write the previous manifest: {error}"))?;
            let path = folder.path().join("manifest.json");
            std::fs::write(&path, approved.manifest.to_string())
                .map_err(|error| format!("cannot write the previous manifest: {error}"))?;
            Some((folder, path))
        }
        None => None,
    };
    let options = admit::Options {
        publisher: admit::Publisher::Key {
            handle: key.publisher.clone(),
            widget_id: key.widget_id.clone(),
        },
        listing: admit::ListingPolicy::Optional,
        package: None,
        previous: previous.as_ref().map(|(_, path)| path.as_path()),
        source_map: false,
        sources: Some(tree.summary_json()),
    };
    let outcome = admit::admit(&admit::Input::Source(work.path()), &options, report);
    Ok(outcome.report)
}

fn private_folder() -> std::io::Result<tempfile::TempDir> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("overcrow-previous-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    builder.tempdir()
}

fn strings(value: &Value) -> BTreeSet<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn diagnostics_json(report: &Report) -> Vec<Value> {
    report
        .diagnostics
        .iter()
        .map(|diagnostic| serde_json::from_str(&diagnostic.to_json()).unwrap_or(Value::Null))
        .collect()
}

fn left_out(tree: &Tree) -> String {
    if tree.ignored.is_empty() {
        return String::new();
    }
    let paths: Vec<String> = tree
        .ignored
        .keys()
        .map(|path| sanitize::line(path))
        .collect();
    format!("  (left out: {})", paths.join(", "))
}

#[allow(clippy::too_many_arguments)]
fn show_summary(
    out: &Out,
    version: &str,
    context: &Context,
    required: &BTreeSet<String>,
    given: &BTreeSet<String>,
    review_type: &str,
    permissions: &Value,
    blockers: &[&str],
) {
    let previous = match &context.last_approved {
        Some(approved) => format!(
            " (last approved {}, at least {})",
            sanitize::line(&approved.version),
            sanitize::line(&context.minimum_version)
        ),
        None => " (first version)".into(),
    };
    out.say(&format!("Version    {}{previous}", sanitize::line(version)));
    let added = strings(&permissions["added"]);
    let changed = strings(&permissions["changed"]);
    let count = |number: usize, what: &str| match number {
        0 => None,
        1 => Some(format!("1 {what} permission")),
        _ => Some(format!("{number} {what} permissions")),
    };
    let changes: Vec<String> = [count(added.len(), "new"), count(changed.len(), "widened")]
        .into_iter()
        .flatten()
        .collect();
    let reason = if context.last_approved.is_none() {
        "first version".to_owned()
    } else if changes.is_empty() {
        "no new permission".to_owned()
    } else {
        changes.join(", ")
    };
    out.say(&format!("Review     {review_type}: {reason}"));
    for key in required {
        let label = if changed.contains(key) {
            "widened"
        } else {
            "new"
        };
        let state = if given.contains(key) {
            "justified"
        } else {
            "NO JUSTIFICATION"
        };
        out.say(&format!("  {label:<8} {}  ({state})", sanitize::line(key)));
    }
    out.say(&format!(
        "Quota      {} of {} submissions left (24 hours)",
        context.quota.remaining, context.quota.limit
    ));
    for blocker in blockers {
        out.say(&format!(
            "Waiting    {}",
            match *blocker {
                "privacy_policy_required" =>
                    "the widget uses the network: the listing needs a privacy policy, add it in the creator space",
                "review_limit_new_publisher" =>
                    "another of your widgets is in review: this one will wait in the creator space",
                _ => "the listing needs a description, a licence and support: complete it in the creator space",
            }
        ));
    }
}

/// The local problems, with the lines of the sent files they point at.
fn emit_local(out: &Out, report: &Report, files: &Files) {
    for diagnostic in &report.diagnostics {
        let source = diagnostic
            .file
            .as_ref()
            .and_then(|file| files.get(file))
            .and_then(|bytes| std::str::from_utf8(bytes).ok());
        out.say(diagnostic.render(source).trim_end());
    }
}

/// Steps 4 to 9: the submission, its upload, its finalization, the checks.
fn send(
    client: &Client,
    body: &Value,
    checked: &Checked,
    options: &SubmitOptions<'_>,
    mut out: Out,
) -> ExitCode {
    let cache = crate::runtime::cache_root();
    let mut resume = Resume::open(
        cache.as_deref(),
        client.origin().as_str(),
        client.key(),
        body,
    );
    let mut restarted = false;
    let version = loop {
        resume.save();
        let reply = match create(client, body, &resume) {
            Ok(reply) => reply,
            Err(failure) => {
                if super::refused_by_api(&failure) {
                    resume.forget();
                    out.say("Nothing was sent.");
                    return out.fail_request(&failure, Outcome::Refused);
                }
                return out.fail_request(&failure, Outcome::Error);
            }
        };
        let submission = &reply.submission;
        resume.submission_id = Some(submission.id);
        out.set(
            "submission",
            json!({
                "id": submission.id,
                "state": submission.state,
                "resumed": resume.resumed,
                "quota": reply.quota.as_ref().map(|quota| json!({
                    "limit": quota.limit,
                    "remaining": quota.remaining,
                    "nextSubmissionAt": quota.next_submission_at,
                })),
            }),
        );
        match submission.state.as_str() {
            "finalized" => {
                let Some(id) = submission.version_id else {
                    return out.fail(
                        "response",
                        "the finalized submission has no version",
                        Map::new(),
                    );
                };
                out.say(&format!(
                    "Sent       submission {} (resumed)",
                    submission.id
                ));
                match client
                    .get(&format!("/api/v1/publish/versions/{id}"))
                    .and_then(|answer| api::parse_version(&answer.body).map_err(Failure::Response))
                {
                    Ok(version) => break version,
                    Err(failure) => return out.fail_request(&failure, Outcome::Error),
                }
            }
            "pending_upload" => {}
            other if !restarted => {
                // Expired or refused since the last run: a new submission.
                let reason = submission
                    .refused_reason
                    .as_deref()
                    .map(|reason| format!(" ({})", sanitize::line(reason)))
                    .unwrap_or_default();
                out.say(&format!(
                    "The earlier submission {} is {}{reason}: starting a new one.",
                    submission.id,
                    sanitize::line(other)
                ));
                resume.forget();
                resume.renew();
                restarted = true;
                continue;
            }
            other => {
                resume.forget();
                return out.fail(
                    "submission_state",
                    &format!("the submission is {}", sanitize::line(other)),
                    Map::new(),
                );
            }
        }
        resume.save();
        if let Err(failure) = upload(client, &reply, &checked.archive, &out) {
            return out.fail_request(&failure, Outcome::Error);
        }
        match finalize(client, submission.id) {
            Ok(finalized) => {
                resume.version_id = Some(finalized.version.id);
                resume.save();
                out.say(&format!(
                    "Sent       submission {}, uploaded, checks started",
                    submission.id
                ));
                break finalized.version;
            }
            Err(failure) => {
                let code = failure.code();
                if code == "submission_expired" && !restarted {
                    resume.forget();
                    resume.renew();
                    restarted = true;
                    continue;
                }
                if matches!(
                    code.as_str(),
                    "upload_size_mismatch" | "upload_checksum_mismatch" | "submission_expired"
                ) {
                    resume.forget();
                }
                return out.fail_request(&failure, Outcome::Error);
            }
        }
    };
    let mut progress = Progress::default();
    match follow::follow(client, &out, version, !options.no_wait, &mut progress) {
        End::Done(version) => {
            resume.forget();
            let outcome = follow::conclude(&mut out, &version, Some(&checked.files), &mut progress);
            out.finish(outcome)
        }
        End::StillChecking {
            version,
            interrupted,
        } => {
            out.set("version", api::camelize(&version.value));
            if interrupted {
                out.say("Stopped following: the checks go on in the creator space.");
            }
            out.say(&format!(
                "Follow them with: overcrow-widget status --version {} --wait",
                sanitize::line(&version.version)
            ));
            out.finish(Outcome::State("checking"))
        }
        End::BuildFailed(version) => {
            resume.forget();
            out.set("version", api::camelize(&version.value));
            out.fail(
                "build_failed",
                "the creator space could not check this version (a problem on PlayerVox's side, which is told); submit it again later",
                Map::new(),
            )
        }
        End::Failed(failure) => out.fail_request(&failure, Outcome::Error),
    }
}

/// `POST /publish/submissions` with the run's `Idempotency-Key`.
fn create(client: &Client, body: &Value, resume: &Resume) -> Result<SubmissionReply, Failure> {
    let answer = client.post(
        "/api/v1/publish/submissions",
        body,
        Some(&resume.idempotency_key),
    )?;
    api::parse_submission(&answer.body).map_err(Failure::Response)
}

/// The signed PUT: tried again after a cut connection, and once with a
/// fresh link when the storage refuses the first.
fn upload(
    client: &Client,
    reply: &SubmissionReply,
    archive: &[u8],
    out: &Out,
) -> Result<(), Failure> {
    let Some(mut link) = reply.upload.clone() else {
        return Err(Failure::Response("upload"));
    };
    let mut refreshed = false;
    let mut cuts = 0;
    loop {
        match client.put_upload(&link, archive) {
            Ok(()) => return Ok(()),
            Err(Failure::Network(_) | Failure::Timeout) if cuts < 2 => {
                cuts += 1;
                std::thread::sleep(Duration::from_secs(1 << cuts));
            }
            Err(Failure::Status(status)) if !refreshed && (400..500).contains(&status) => {
                refreshed = true;
                out.say("  the upload link was refused: asking for a fresh one");
                let answer = client.get(&format!(
                    "/api/v1/publish/submissions/{}",
                    reply.submission.id
                ))?;
                let fresh = api::parse_submission(&answer.body).map_err(Failure::Response)?;
                link = fresh.upload.ok_or(Failure::Response("upload"))?;
            }
            Err(Failure::Status(status)) => {
                return Err(Failure::Refused(format!(
                    "the storage refused the upload (HTTP {status})"
                )));
            }
            Err(failure) => return Err(failure),
        }
    }
}

/// `POST /publish/submissions/:id/finalize`, waiting a little while the
/// storage has not seen the upload yet.
fn finalize(client: &Client, id: u64) -> Result<api::Finalized, Failure> {
    let path = format!("/api/v1/publish/submissions/{id}/finalize");
    let mut waits = UPLOAD_MISSING_WAITS.iter();
    loop {
        match client.post(&path, &json!({}), None) {
            Ok(answer) => return api::parse_finalized(&answer.body).map_err(Failure::Response),
            Err(Failure::Api { error, .. })
                if error.code == "upload_missing" && waits.len() > 0 =>
            {
                std::thread::sleep(Duration::from_secs(*waits.next().unwrap_or(&1)));
            }
            Err(failure) => return Err(failure),
        }
    }
}
