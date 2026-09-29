//! The pipeline shared by `check` and `package`: load the project, check the
//! sources and the logic, bundle, then write the package in memory and read
//! it back with the host's own validators (`read_package`, then the style
//! grammar), exactly as admission and activation will.

use std::collections::BTreeMap;
use std::path::Path;

use overcrow_widget_format::validate_package_style;
use overcrow_widget_schema::limits::MAX_LOGIC_BYTES;
use overcrow_widget_schema::manifest::Manifest;
use overcrow_widget_schema::package::{PackageError, read_package, write_package};

use crate::bundle;
use crate::diag::{Diagnostic, Report};
use crate::lint;
use crate::project::Project;
use crate::sources::{self, manifest_diagnostic, style_diagnostic};
use crate::typecheck;

pub struct Options {
    /// Run the project's `tsc`.
    pub typecheck: bool,
}

pub struct Built {
    pub manifest: Manifest,
    /// Every entry except `ledger.json`.
    pub files: BTreeMap<String, Vec<u8>>,
    /// The `.ocpkg` bytes.
    pub archive: Vec<u8>,
    pub modules: usize,
}

/// Runs every check; returns the package when no error was found.
pub fn build(root: &Path, options: &Options, report: &mut Report) -> Option<Built> {
    let project = Project::load(root, report)?;
    let sources = sources::check(&project, report);
    let logic = lint::lint(
        project.logic_path,
        &project.logic,
        sources
            .as_ref()
            .map(|sources| (&sources.view, project.view.as_slice())),
        report,
    );
    if options.typecheck {
        typecheck::run(root, project.logic_path, report);
    }
    let (sources, logic) = (sources?, logic?);
    if report.errors() > 0 {
        return None;
    }

    let bundle = match bundle::build(
        project.logic_path,
        &project.logic,
        &sources.view,
        &logic.exports,
    ) {
        Ok(bundle) => bundle,
        Err(diagnostic) => {
            report.push(diagnostic);
            return None;
        }
    };
    if bundle.code.len() as u64 > MAX_LOGIC_BYTES.value {
        report.push(
            Diagnostic::error(
                "package.file_size",
                format!(
                    "logic.js is {} bytes, above the {} bytes the host accepts",
                    bundle.code.len(),
                    MAX_LOGIC_BYTES.value
                ),
            )
            .in_file(project.logic_path),
        );
        return None;
    }

    let mut files = BTreeMap::new();
    files.insert("manifest.json".to_owned(), project.manifest.clone());
    files.insert("view.json".to_owned(), sources.view.json.clone());
    files.insert("logic.js".to_owned(), bundle.code.into_bytes());
    files.insert("LICENSE".to_owned(), project.license.clone());
    if let Some(style) = &project.style {
        files.insert("style.ocss".to_owned(), style.clone());
    }
    if let Some((en, fr)) = &project.locales {
        files.insert("locales/en.json".to_owned(), en.clone());
        files.insert("locales/fr.json".to_owned(), fr.clone());
    }
    for (path, bytes) in &project.assets {
        files.insert(path.clone(), bytes.clone());
    }

    let archive = match write_package(&files) {
        Ok(archive) => archive,
        Err(error) => {
            report.push(package_diagnostic(error, &project));
            return None;
        }
    };
    // `write_package` already read the archive back; this is the host's
    // activation sequence, repeated on the exact bytes that will ship.
    let package = match read_package(&archive) {
        Ok(package) => package,
        Err(error) => {
            report.push(package_diagnostic(error, &project));
            return None;
        }
    };
    if let Err(error) = validate_package_style(&package) {
        let source = project.source("style.ocss").unwrap_or_default();
        report.push(style_diagnostic(error.kind, error.position, &source));
        return None;
    }
    Some(Built {
        manifest: sources.manifest,
        files,
        archive,
        modules: bundle.modules,
    })
}

/// A package validator's category as a diagnostic. The source checks run
/// first, so these are mostly what only the package can tell (assets, the
/// whole-file bounds, the license).
pub fn package_diagnostic(error: PackageError, project: &Project) -> Diagnostic {
    let code = format!("package.{}", error.as_str());
    match error {
        PackageError::Manifest(inner) => {
            manifest_diagnostic(inner, &project.source("manifest.json").unwrap_or_default())
        }
        PackageError::View(inner) => Diagnostic::error(
            format!("view.{}", inner.as_str()),
            "the compiled view is refused by the package validator",
        )
        .in_file("view.ocml"),
        PackageError::Asset => Diagnostic::error(code, "an image under assets/ is not a PNG, JPEG or WebP matching its extension")
            .in_file("assets")
            .help("asset paths are lowercase `[a-z0-9_-]` segments ending in .png, .jpg, .jpeg or .webp"),
        PackageError::UnsafePath | PackageError::UnexpectedFile => {
            Diagnostic::error(code, "a file name under assets/ is not allowed in a package")
                .in_file("assets")
                .help("lowercase `[a-z0-9_-]` segments, a .png, .jpg, .jpeg or .webp extension, a limited depth")
        }
        PackageError::License => Diagnostic::error(code, "LICENSE must be non-empty UTF-8 text").in_file("LICENSE"),
        PackageError::Locales => Diagnostic::error(code, "the locale files are refused by the package validator")
            .in_file("locales/en.json"),
        PackageError::Style => Diagnostic::error(code, "style.ocss must be UTF-8 text").in_file("style.ocss"),
        PackageError::Logic => Diagnostic::error(code, "logic.js must be non-empty UTF-8 text")
            .in_file(project.logic_path),
        PackageError::ArchiveSize | PackageError::EntryLimit | PackageError::FileSize => {
            Diagnostic::error(code, "the package exceeds a size bound of the schema")
                .help("see the Package section of docs/widget-schema-v1.md")
        }
        _ => Diagnostic::error(code, "the package writer produced an archive the reader refuses")
            .help("this is a bug of overcrow-widget; please report it"),
    }
}
