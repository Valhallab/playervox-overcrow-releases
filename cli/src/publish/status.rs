//! `overcrow-widget status [--version VERSION|ID] [--wait]`: the versions
//! of the key's widget, or one version with its checks, what keeps it out
//! of review, its remarks and its review delay.

use std::process::ExitCode;

use overcrow_widget_schema::version::Version as SemVer;
use serde_json::{Map, Value, json};

use super::api;
use super::client::{Client, Failure};
use super::follow::{self, End, Progress};
use super::render;
use super::{Out, Outcome};
use crate::sanitize;

pub struct StatusOptions<'a> {
    pub version: Option<&'a str>,
    pub wait: bool,
    pub json: bool,
    pub verbose: bool,
}

pub fn status(raw_key: Option<String>, options: &StatusOptions<'_>) -> ExitCode {
    super::install_panic_hook();
    let mut out = Out::new("status", options.json);
    out.set("key", Value::Null);
    let client = match super::connect(raw_key, options.verbose, &out) {
        Ok(client) => client,
        Err((code, message)) => return out.fail(&code, &message, Map::new()),
    };
    let key = match super::read_key(&client, &mut out) {
        Ok(key) => key,
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    out.set(
        "widget",
        json!({"id": key.widget_id, "name": key.widget_name}),
    );
    let Some(wanted) = options.version else {
        return list(&client, out);
    };
    let id = match find(&client, wanted) {
        Ok(Some(id)) => id,
        Ok(None) => {
            return out.fail(
                "not_found",
                &format!(
                    "{} has no version {}",
                    sanitize::line(&key.widget_id),
                    sanitize::line(wanted)
                ),
                Map::new(),
            );
        }
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    let version = match client
        .get(&format!("/api/v1/publish/versions/{id}"))
        .and_then(|answer| api::parse_version(&answer.body).map_err(Failure::Response))
    {
        Ok(version) => version,
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    out.say(&format!(
        "Version    {} (#{})",
        sanitize::line(&version.version),
        version.id
    ));
    let mut progress = Progress::default();
    match follow::follow(&client, &out, version, options.wait, &mut progress) {
        End::Done(version) => {
            let outcome = follow::conclude(&mut out, &version, None, &mut progress);
            out.finish(if options.wait { outcome } else { Outcome::Read })
        }
        End::StillChecking {
            version,
            interrupted,
        } => {
            let outcome = follow::conclude(&mut out, &version, None, &mut progress);
            if interrupted {
                out.say("Stopped following: the checks go on in the creator space.");
            }
            out.finish(if options.wait { outcome } else { Outcome::Read })
        }
        End::BuildFailed(version) => {
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

/// The ID of `wanted`: an ID as such, or the latest version of that number
/// (a version refused by its checks may be sent again under its number).
fn find(client: &Client, wanted: &str) -> Result<Option<u64>, Failure> {
    if !wanted.is_empty() && wanted.bytes().all(|byte| byte.is_ascii_digit()) {
        return Ok(wanted.parse().ok());
    }
    let Some(number) = SemVer::parse(wanted) else {
        return Ok(None);
    };
    let versions = versions(client)?;
    Ok(versions
        .iter()
        .filter(|version| SemVer::parse(&version.version).is_some_and(|other| other == number))
        .map(|version| version.id)
        .max())
}

fn versions(client: &Client) -> Result<Vec<api::Version>, Failure> {
    let answer = client.get("/api/v1/publish/versions")?;
    api::parse_versions(&answer.body).map_err(Failure::Response)
}

fn list(client: &Client, mut out: Out) -> ExitCode {
    let versions = match versions(client) {
        Ok(versions) => versions,
        Err(failure) => return out.fail_request(&failure, Outcome::Error),
    };
    out.set(
        "versions",
        Value::Array(
            versions
                .iter()
                .map(|version| api::camelize(&version.value))
                .collect(),
        ),
    );
    if versions.is_empty() {
        out.say("No version yet: send one with `overcrow-widget submit`.");
    } else {
        out.say("Versions");
    }
    for version in &versions {
        let review = version
            .review_type
            .as_deref()
            .map(|kind| format!(" ({})", sanitize::line(kind)))
            .unwrap_or_default();
        let state = format!("{}{review}", render::state_words(&version.state));
        out.say(&format!(
            "  {:<12} {state:<36} {}  #{}",
            sanitize::line(&version.version),
            render::date(version.value["created_at"].as_str().unwrap_or_default()),
            version.id
        ));
    }
    out.finish(Outcome::Read)
}
