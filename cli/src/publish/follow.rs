//! Following a version while the creator space checks it: one `GET` every
//! `poll_after_seconds` (1 to 30 s, at least 10 s after three minutes, at
//! most 15 minutes in all: the API allows 300 requests an hour per key),
//! each check printed when it changes. Ctrl+C stops following; the checks
//! go on in the creator space.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::api::{self, Version};
use super::client::{Client, Failure};
use super::render::{self, Files};
use super::{Out, Outcome};
use crate::interrupt;

const MIN_INTERVAL: u64 = 1;
const MAX_INTERVAL: u64 = 30;
/// After this long, at least [`SLOW_INTERVAL`] between two requests.
const SLOW_AFTER: Duration = Duration::from_secs(3 * 60);
const SLOW_INTERVAL: u64 = 10;
const MAX_FOLLOW: Duration = Duration::from_secs(15 * 60);
/// How long failed requests are tried again before giving up following.
const MAX_FAILING: Duration = Duration::from_secs(2 * 60);

/// How following ended.
pub enum End {
    /// The version left `checking`.
    Done(Version),
    /// Still being checked: Ctrl+C, `--no-wait` or the time bound.
    StillChecking { version: Version, interrupted: bool },
    /// The creator space gave up building it ("problem on our side").
    BuildFailed(Version),
    /// A request failed for good; the version is the last one read.
    Failed { failure: Failure, version: Version },
}

/// The checks already printed, by key.
#[derive(Default)]
pub struct Progress {
    shown: BTreeMap<String, String>,
    header: bool,
    retrying: bool,
}

impl Progress {
    /// Prints the checks that changed since the last call.
    pub fn show(&mut self, out: &Out, version: &Value, all: bool) {
        for check in version["checks"].as_array().into_iter().flatten() {
            let (Some(key), Some(status)) = (check["key"].as_str(), check["status"].as_str())
            else {
                continue;
            };
            if (status == "pending" && !all)
                || self.shown.get(key).is_some_and(|seen| seen == status)
            {
                continue;
            }
            if !self.header {
                out.say("Checks");
                self.header = true;
            }
            out.say(&render::check_line(status, key));
            self.shown.insert(key.to_owned(), status.to_owned());
        }
    }
}

/// Follows `version` while it is checked (or not at all without `wait`).
pub fn follow(
    client: &Client,
    out: &Out,
    version: Version,
    wait: bool,
    progress: &mut Progress,
) -> End {
    progress.show(out, &version.value, false);
    if version.state != "checking" {
        return End::Done(version);
    }
    if !wait {
        return End::StillChecking {
            version,
            interrupted: false,
        };
    }
    interrupt::install();
    let started = Instant::now();
    let mut current = version;
    let mut failing_since: Option<Instant> = None;
    loop {
        if current.build_problem.as_deref() == Some("failed") {
            return End::BuildFailed(current);
        }
        if current.build_problem.as_deref() == Some("retrying") && !progress.retrying {
            out.say("  Problem on our side: checking again.");
            progress.retrying = true;
        }
        let mut interval = current
            .poll_after_seconds
            .unwrap_or(3)
            .clamp(MIN_INTERVAL, MAX_INTERVAL);
        if started.elapsed() > SLOW_AFTER {
            interval = interval.max(SLOW_INTERVAL);
        }
        if started.elapsed() + Duration::from_secs(interval) > MAX_FOLLOW || !sleep(interval) {
            return End::StillChecking {
                interrupted: interrupt::requested(),
                version: current,
            };
        }
        let path = format!("/api/v1/publish/versions/{}", current.id);
        let next = client
            .get(&path)
            .and_then(|answer| api::parse_version(&answer.body).map_err(Failure::Response));
        match next {
            Ok(version) => {
                failing_since = None;
                progress.show(out, &version.value, false);
                if version.state != "checking" {
                    return End::Done(version);
                }
                current = version;
            }
            // Limited: wait as asked, or stop following when that would be
            // longer than following may last.
            Err(Failure::Api { error, .. }) if error.code == "rate_limited" => {
                let wait = error.retry_after.unwrap_or(SLOW_INTERVAL).max(1);
                if started.elapsed() + Duration::from_secs(wait) > MAX_FOLLOW || !sleep(wait) {
                    return End::StillChecking {
                        interrupted: interrupt::requested(),
                        version: current,
                    };
                }
            }
            Err(failure) if worth_waiting(&failure) => {
                let since = *failing_since.get_or_insert_with(Instant::now);
                if since.elapsed() > MAX_FAILING {
                    out.warn(&failure.message());
                    return End::StillChecking {
                        version: current,
                        interrupted: false,
                    };
                }
            }
            Err(failure) => {
                return End::Failed {
                    failure,
                    version: current,
                };
            }
        }
    }
}

/// A failure that may pass while the checks go on: the network, the
/// server (the API's JSON errors included).
fn worth_waiting(failure: &Failure) -> bool {
    match failure {
        Failure::Network(_) | Failure::Timeout | Failure::Status(500..=599) => true,
        Failure::Api { status, .. } => matches!(status, 500..=599),
        _ => false,
    }
}

/// Sleeps `seconds`, or less when Ctrl+C is pressed; `false` then.
fn sleep(seconds: u64) -> bool {
    let until = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < until {
        if interrupt::requested() {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !interrupt::requested()
}

/// Prints what a version came to and records it; its outcome.
pub fn conclude(
    out: &mut Out,
    version: &Version,
    files: Option<&Files>,
    progress: &mut Progress,
) -> Outcome {
    out.set("version", api::camelize(&version.value));
    progress.show(out, &version.value, true);
    let value = &version.value;
    let review = version
        .review_type
        .as_deref()
        .map(|kind| format!(" ({} review)", crate::sanitize::line(kind)))
        .unwrap_or_default();
    match version.state.as_str() {
        "checks_failed" => {
            for check in value["checks"].as_array().into_iter().flatten() {
                for diagnostic in check["diagnostics"].as_array().into_iter().flatten() {
                    out.say(render::diagnostic(diagnostic, files).trim_end());
                }
            }
            if value["checks"].as_array().is_none_or(Vec::is_empty) {
                for diagnostic in value["diagnostics"].as_array().into_iter().flatten() {
                    out.say(render::diagnostic(diagnostic, files).trim_end());
                }
            }
            out.say("Nothing reached the reviewers. Fix the problems and submit again.");
        }
        "ready" => {
            out.say("The checks passed, but the version cannot enter review yet:");
            for blocker in value["review_blockers"].as_array().into_iter().flatten() {
                out.say(&render::blocker(blocker));
            }
            if let Some(url) = value["complete_in_portal"]["url"].as_str() {
                let message = value["complete_in_portal"]["message"]
                    .as_str()
                    .map(crate::sanitize::line)
                    .unwrap_or_else(|| "Complete it in the creator space".into());
                out.say(&format!("{message}: {}", crate::sanitize::line(url)));
            } else {
                out.say("Complete it in the creator space (overcrow.playervox.com).");
            }
        }
        state => {
            out.say(&format!(
                "{} {}: {}{review}.",
                crate::sanitize::line(value["widget_id"].as_str().unwrap_or_default()),
                crate::sanitize::line(&version.version),
                render::state_words(state)
            ));
        }
    }
    let remarks = value["remarks"].as_array().cloned().unwrap_or_default();
    if !remarks.is_empty() {
        out.say("Remarks");
        for remark in &remarks {
            out.say(&render::remark(remark));
        }
    }
    if let Some(deadline) = value["deadline"].as_object() {
        let mut parts: Vec<String> = deadline
            .iter()
            .map(|(name, value)| {
                format!(
                    "{}: {}",
                    crate::sanitize::line(name),
                    crate::sanitize::line(&value.to_string())
                )
            })
            .collect();
        parts.sort();
        out.say(&format!("Review delay  {}", parts.join(", ")));
    }
    Outcome::of_state(&version.state)
}
