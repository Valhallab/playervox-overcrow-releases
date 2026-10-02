//! `admit`: the static admission a marketplace submission goes through,
//! exactly as the marketplace CI runs it (`docs/review-policy.md`).
//!
//! It never runs the widget's code, `tsc` or any other tool of the project:
//!
//! 1. the source directory is built with the `package` pipeline (every
//!    source, style, logic and package check, then the host's reader);
//! 2. a submitted archive (`--package`), if any, must carry the same
//!    `view.json` bytes as the one compiled from `view.ocml` (ADR 0005);
//! 3. the admission policy: the reserved `com.playervox.*` IDs, the
//!    `listing.json` next to the manifest, the license and the preview;
//! 4. a permission review for the maintainer: sensitive capabilities, the
//!    declared network routes, clipboard writes and storage.
//!
//! The report is readable or JSON. Text from the package or the listing is
//! shown only through [`crate::sanitize`].

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use overcrow_widget_schema::catalog::validate_listing;
use overcrow_widget_schema::json::parse_strict;
use overcrow_widget_schema::limits::{
    MAX_HTTP_RESPONSE_BYTES, MAX_PACKAGE_BYTES, MAX_PREVIEW_BYTES,
};
use overcrow_widget_schema::manifest::Manifest;
use overcrow_widget_schema::package::{Package, hex, read_package, sha256};
use overcrow_widget_schema::permissions::capability_named;
use serde_json::{Value, json};

use crate::build;
use crate::diag::{Diagnostic, Report};
use crate::project::read_bounded;
use crate::sanitize;

/// The marketplace text of a submission, next to `manifest.json`; never
/// packaged.
pub const LISTING_FILE: &str = "listing.json";
/// Bound of `listing.json`: well above what the Listing bounds allow.
const MAX_LISTING_SOURCE_BYTES: u64 = 64 * 1024;
/// The only license PlayerVox widgets use (ADR 0001, D11).
const PLAYERVOX_LICENSE: &str = "MIT";
/// Version of the JSON report (`report.json` of an admission bundle).
pub const REPORT_FORMAT: u64 = 1;

/// Who submits: only PlayerVox may use the reserved IDs. The marketplace CI
/// passes `--publisher playervox` for reviewed pushes and pull requests of
/// the releases repository itself, never for a fork.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Publisher {
    ThirdParty,
    PlayerVox,
}

impl Publisher {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ThirdParty => "third-party",
            Self::PlayerVox => "playervox",
        }
    }
}

pub struct Options<'a> {
    pub publisher: Publisher,
    /// The archive a creator submitted, compared with the rebuild.
    pub package: Option<&'a Path>,
}

/// An admitted submission: the rebuilt archive, the exact listing bytes and
/// the report. Written by `--out` as an admission bundle.
pub struct Admitted {
    pub archive: Vec<u8>,
    pub listing: Vec<u8>,
    pub report: Value,
}

/// What admission found, before the verdict.
struct Findings {
    package: Package,
    archive: Vec<u8>,
    listing_bytes: Option<Vec<u8>>,
    listing: Option<Value>,
    preview: Option<String>,
    reproducible: Option<bool>,
    same_archive: Option<bool>,
}

/// Where the submission comes from.
pub enum Input<'a> {
    /// A source directory: rebuilt, then admitted.
    Source(&'a Path),
    /// A bare archive and its listing: every check but the rebuild, which
    /// the marketplace always performs from the reviewed sources.
    Archive {
        package: &'a Path,
        listing: &'a Path,
    },
}

/// The verdict and its report; `admitted` is `None` when an error was found.
pub struct Outcome {
    pub admitted: Option<Admitted>,
    pub report: Value,
}

/// Runs admission. Diagnostics go to `report`, and into the JSON report.
pub fn admit(input: &Input<'_>, options: &Options<'_>, report: &mut Report) -> Outcome {
    let findings = match input {
        Input::Source(root) => rebuild(root, options, report),
        Input::Archive { package, listing } => archive(package, listing, report),
    };
    let Some(mut findings) = findings else {
        return Outcome {
            admitted: None,
            report: refused_before_identity(report, options.publisher),
        };
    };
    check_identity(&findings.package.manifest, options.publisher, report);
    let listing = match input {
        Input::Source(root) => root.join(LISTING_FILE),
        Input::Archive { listing, .. } => listing.to_path_buf(),
    };
    check_listing(&listing, &mut findings, options.publisher, report);
    let value = render_json(&findings, options.publisher, report);
    Outcome {
        admitted: (report.errors() == 0).then(|| Admitted {
            archive: findings.archive,
            listing: findings.listing_bytes.unwrap_or_default(),
            report: value.clone(),
        }),
        report: value,
    }
}

fn rebuild(root: &Path, options: &Options<'_>, report: &mut Report) -> Option<Findings> {
    let built = build::build(root, &build::Options { typecheck: false }, report)?;
    let package = match read_package(&built.archive) {
        Ok(package) => package,
        Err(error) => {
            report.push(Diagnostic::error(
                format!("package.{}", error.as_str()),
                "the rebuilt package is refused by the host's reader",
            ));
            return None;
        }
    };
    let mut findings = Findings {
        package,
        archive: built.archive,
        listing_bytes: None,
        listing: None,
        preview: None,
        reproducible: None,
        same_archive: None,
    };
    if let Some(submitted) = options.package {
        compare_submitted(submitted, &mut findings, report);
    }
    Some(findings)
}

fn archive(path: &Path, _listing: &Path, report: &mut Report) -> Option<Findings> {
    let package = read_submitted(path, report)?;
    report.push(
        Diagnostic::warning(
            "admission.not_rebuilt",
            "without the sources, view.json cannot be recompiled; the marketplace rebuilds every submission from its sources",
        )
        .in_file(path.display().to_string())
        .help("run `overcrow-widget admit <dir>` on the widget's source directory"),
    );
    Some(Findings {
        archive: package.bytes().to_vec(),
        package,
        listing_bytes: None,
        listing: None,
        preview: None,
        reproducible: None,
        same_archive: None,
    })
}

/// A report for a submission refused before its identity was known.
fn refused_before_identity(report: &Report, publisher: Publisher) -> Value {
    json!({
        "formatVersion": REPORT_FORMAT,
        "admitted": false,
        "publisher": publisher.as_str(),
        "id": null,
        "version": null,
        "diagnostics": diagnostics_json(report),
    })
}

fn diagnostics_json(report: &Report) -> Vec<Value> {
    report
        .diagnostics
        .iter()
        .map(|diagnostic| serde_json::from_str(&diagnostic.to_json()).unwrap_or(Value::Null))
        .collect()
}

/// Reads and validates a submitted archive with the host's reader.
fn read_submitted(path: &Path, report: &mut Report) -> Option<Package> {
    let shown = path.display().to_string();
    let bytes = match read_bounded(path, MAX_PACKAGE_BYTES.value) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            report.push(
                Diagnostic::error(
                    "package.archive_size",
                    "the submitted file is larger than a package can be",
                )
                .in_file(shown),
            );
            return None;
        }
        Err(_) => {
            report.push(
                Diagnostic::error(
                    "admission.submitted_package",
                    "cannot read the submitted package",
                )
                .in_file(shown),
            );
            return None;
        }
    };
    match read_package(&bytes) {
        Ok(package) => Some(package),
        Err(error) => {
            report.push(
                Diagnostic::error(
                    format!("package.{}", error.as_str()),
                    "the host would refuse the submitted package",
                )
                .in_file(shown),
            );
            None
        }
    }
}

/// Requires the submitted archive's `view.json` to be the compiled one.
/// Other differences (another CLI version bundled `logic.js`) are shown;
/// the catalog always ships the rebuild from the reviewed sources.
fn compare_submitted(path: &Path, findings: &mut Findings, report: &mut Report) {
    let shown = path.display().to_string();
    let Some(submitted) = read_submitted(path, report) else {
        return;
    };
    let reproducible = submitted.file("view.json") == findings.package.file("view.json");
    findings.reproducible = Some(reproducible);
    findings.same_archive = Some(submitted.digest == findings.package.digest);
    if !reproducible {
        report.push(
            Diagnostic::error(
                "admission.view_not_reproducible",
                "the submitted view.json is not what view.ocml compiles to",
            )
            .in_file("view.ocml")
            .help("rebuild the package from these sources with `overcrow-widget package`"),
        );
    } else if submitted.digest != findings.package.digest {
        report.push(
            Diagnostic::warning(
                "admission.package_rebuilt",
                "the submitted archive differs from the rebuild; the catalog ships the rebuild",
            )
            .in_file(shown)
            .help("package with the same overcrow-widget version to get identical bytes"),
        );
    }
}

fn check_identity(manifest: &Manifest, publisher: Publisher, report: &mut Report) {
    if manifest.has_reserved_id() && publisher != Publisher::PlayerVox {
        report.push(
            Diagnostic::error(
                "admission.reserved_id",
                "com.playervox.* IDs are reserved for widgets published by PlayerVox",
            )
            .in_file("manifest.json")
            .help("choose an ID under a reverse domain you control, for example com.example.clock"),
        );
    }
}

/// `listing.json`: the Listing fields of the catalog, plus an optional
/// `preview` naming a packaged PNG under `assets/`.
fn check_listing(path: &Path, findings: &mut Findings, publisher: Publisher, report: &mut Report) {
    let bytes = match read_bounded(path, MAX_LISTING_SOURCE_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            report.push(
                Diagnostic::error("admission.listing", "listing.json is too large")
                    .in_file(LISTING_FILE),
            );
            return;
        }
        Err(_) => {
            report.push(
                Diagnostic::error(
                    "admission.listing_missing",
                    "a submission needs listing.json next to manifest.json",
                )
                .in_file(LISTING_FILE)
                .help("see https://overcrow.playervox.com/docs/en/publishing/#the-listing"),
            );
            return;
        }
    };
    let Some(Value::Object(mut object)) = parse_strict(&bytes, MAX_LISTING_SOURCE_BYTES) else {
        report.push(
            Diagnostic::error(
                "admission.listing",
                "listing.json is not one strict JSON object",
            )
            .in_file(LISTING_FILE),
        );
        return;
    };
    let preview = object.remove("preview");
    let listing = Value::Object(object);
    if validate_listing(&listing).is_err() {
        report.push(
            Diagnostic::error("admission.listing", "listing.json is refused by the catalog's Listing rules")
                .in_file(LISTING_FILE)
                .help("author, spdxLicense, an https sourceUrl, defaultLocale and plain-text localizations; see https://overcrow.playervox.com/docs/en/publishing/#the-listing"),
        );
        return;
    }
    match preview {
        None => {}
        Some(Value::String(path)) => check_preview(&path, findings, report),
        Some(_) => report.push(
            Diagnostic::error(
                "admission.preview",
                "`preview` must name a PNG under assets/",
            )
            .in_file(LISTING_FILE),
        ),
    }
    let license = listing["spdxLicense"].as_str().unwrap_or_default();
    if publisher == Publisher::PlayerVox && license != PLAYERVOX_LICENSE {
        report.push(
            Diagnostic::error(
                "admission.license",
                "PlayerVox widgets are published under MIT",
            )
            .in_file(LISTING_FILE),
        );
    }
    findings.listing_bytes = Some(bytes);
    findings.listing = Some(listing);
}

fn check_preview(path: &str, findings: &mut Findings, report: &mut Report) {
    let valid = path.starts_with("assets/")
        && path.ends_with(".png")
        && findings
            .package
            .file(path)
            .is_some_and(|bytes| bytes.len() as u64 <= MAX_PREVIEW_BYTES.value);
    if valid {
        findings.preview = Some(path.to_owned());
    } else {
        report.push(
            Diagnostic::error(
                "admission.preview",
                format!(
                    "`preview` must name a packaged PNG under assets/ of at most {} bytes",
                    MAX_PREVIEW_BYTES.value
                ),
            )
            .in_file(LISTING_FILE),
        );
    }
}

/// What a maintainer reviews, in order: each item is a fact about the
/// requested authority, not a verdict.
fn review(manifest: &Manifest) -> Vec<Value> {
    let permissions = &manifest.permissions;
    let mut items = Vec::new();
    for name in &permissions.capabilities {
        let capability = capability_named(name);
        items.push(json!({
            "kind": "capability",
            "name": name,
            "sensitive": capability.is_some_and(|capability| capability.sensitive),
            "account": capability.and_then(|capability| capability.account),
        }));
    }
    if let Some(rules) = manifest.value["permissions"]["network"].as_array() {
        for rule in rules {
            items.push(json!({
                "kind": "network",
                "method": rule["method"],
                "origin": rule["origin"],
                "path": rule["path"],
                "pathParams": rule.get("pathParams"),
                "queryParams": rule.get("queryParams"),
                "maxResponseBytes": rule
                    .get("maxResponseBytes")
                    .cloned()
                    .unwrap_or(json!(MAX_HTTP_RESPONSE_BYTES.value)),
            }));
        }
    }
    if permissions.clipboard_write {
        items.push(json!({"kind": "clipboardWrite"}));
    }
    if permissions.storage {
        items.push(json!({
            "kind": "storage",
            "processLifetime": permissions.has_sensitive_capability(),
        }));
    }
    for event in &permissions.game_events {
        items.push(json!({"kind": "gameEvent", "name": event}));
    }
    items
}

fn render_json(findings: &Findings, publisher: Publisher, report: &Report) -> Value {
    let manifest = &findings.package.manifest;
    let files: BTreeMap<&str, Value> = findings
        .package
        .paths()
        .map(|path| {
            let bytes = findings.package.file(path).unwrap_or_default();
            (
                path,
                json!({"bytes": bytes.len(), "sha256": hex(&sha256(bytes))}),
            )
        })
        .collect();
    let listing = findings.listing_bytes.as_ref().map(|bytes| {
        json!({
            "bytes": bytes.len(),
            "sha256": hex(&sha256(bytes)),
            "spdxLicense": findings.listing.as_ref().map(|listing| listing["spdxLicense"].clone()),
            "preview": findings.preview,
        })
    });
    let diagnostics = diagnostics_json(report);
    json!({
        "formatVersion": REPORT_FORMAT,
        "admitted": report.errors() == 0,
        "publisher": publisher.as_str(),
        "id": manifest.id,
        "version": manifest.version.to_string(),
        "reservedId": manifest.has_reserved_id(),
        "package": {
            "bytes": findings.archive.len(),
            "sha256": hex(&findings.package.digest),
            "files": files,
        },
        "reproducible": {
            "viewJson": findings.reproducible,
            "archive": findings.same_archive,
        },
        "listing": listing,
        "review": review(manifest),
        "diagnostics": diagnostics,
    })
}

/// The human report: identity, reproducibility, then the review list. Every
/// text that comes from the package or the listing is sanitized.
pub fn render_human(report: &Value) -> String {
    let text = |value: &Value| match value {
        Value::String(text) => sanitize::line(text),
        Value::Null => "-".to_owned(),
        other => sanitize::line(&other.to_string()),
    };
    if report["id"].is_null() {
        return "\nadmission: refused before the package could be built\n".to_owned();
    }
    let mut out = format!(
        "{} {} ({})\n",
        text(&report["id"]),
        text(&report["version"]),
        text(&report["publisher"])
    );
    out.push_str(&format!(
        "package   {} bytes, sha256 {}\n",
        report["package"]["bytes"],
        text(&report["package"]["sha256"])
    ));
    let reproducible = match report["reproducible"]["viewJson"].as_bool() {
        Some(true) => "view.json reproduced from view.ocml",
        Some(false) => "view.json NOT reproduced from view.ocml",
        None => "rebuilt from view.ocml (no submitted archive to compare)",
    };
    out.push_str(&format!("view      {reproducible}\n"));
    if !report["listing"].is_null() {
        out.push_str(&format!(
            "license   {}\n",
            text(&report["listing"]["spdxLicense"])
        ));
        if let Some(preview) = report["listing"]["preview"].as_str() {
            out.push_str(&format!("preview   {}\n", sanitize::line(preview)));
        }
    }
    out.push_str("\nReview (authority the widget requests)\n");
    let items = report["review"].as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        out.push_str("  nothing: no capability, network, clipboard, storage or game event\n");
    }
    for item in items {
        let line = match item["kind"].as_str() {
            Some("capability") => {
                let mut notes = Vec::new();
                if item["sensitive"] == true {
                    notes.push("SENSITIVE: no network or clipboard allowed".to_owned());
                }
                if let Some(account) = item["account"].as_str() {
                    notes.push(format!("needs a {account} account"));
                }
                format!(
                    "capability      {}{}",
                    text(&item["name"]),
                    if notes.is_empty() {
                        String::new()
                    } else {
                        format!(" [{}]", notes.join(", "))
                    }
                )
            }
            Some("network") => format!(
                "network         {} {}{}, responses up to {} bytes",
                text(&item["method"]),
                text(&item["origin"]),
                text(&item["path"]),
                text(&item["maxResponseBytes"])
            ),
            Some("clipboardWrite") => "clipboardWrite  text on a user gesture".to_owned(),
            Some("storage") => {
                if item["processLifetime"] == true {
                    "storage         process lifetime only (sensitive capability)".to_owned()
                } else {
                    "storage         host-managed, partitioned by widget".to_owned()
                }
            }
            Some("gameEvent") => format!("gameEvent       {}", text(&item["name"])),
            _ => continue,
        };
        out.push_str(&format!("  {line}\n"));
    }
    out.push_str(&format!(
        "\n{}\n",
        if report["admitted"] == true {
            "admission: passed (publication still needs a maintainer's review)"
        } else {
            "admission: refused"
        }
    ));
    out
}

/// Writes an admission bundle into `out`, which must not exist or be empty:
/// `package.ocpkg`, `listing.json` and `report.json`.
pub fn write_bundle(out: &Path, admitted: &Admitted) -> std::io::Result<PathBuf> {
    if out.exists() && fs::read_dir(out)?.next().is_some() {
        return Err(std::io::Error::other("the output directory is not empty"));
    }
    fs::create_dir_all(out)?;
    fs::write(out.join("package.ocpkg"), &admitted.archive)?;
    fs::write(out.join(LISTING_FILE), &admitted.listing)?;
    let mut report = serde_json::to_vec_pretty(&admitted.report).map_err(std::io::Error::other)?;
    report.push(b'\n');
    fs::write(out.join("report.json"), report)?;
    Ok(out.to_path_buf())
}
