//! A widget source project on disk: the files a creator writes, read with
//! the package bounds so that a huge or unexpected file fails early.
//!
//! ```text
//! manifest.json   view.ocml   style.ocss?   logic.ts | logic.js
//! locales/en.json + locales/fr.json?   LICENSE   assets/**?
//! package.json, tsconfig.json, node_modules/, dist/   (tooling, never packaged)
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use overcrow_widget_schema::limits::{
    MAX_IMAGE_ENCODED_BYTES, MAX_LICENSE_BYTES, MAX_LOCALE_FILE_BYTES, MAX_LOGIC_BYTES,
    MAX_MANIFEST_BYTES, MAX_PACKAGE_FILES, MAX_STYLE_SOURCE_BYTES, MAX_VIEW_SOURCE_BYTES,
};

use crate::diag::{Diagnostic, Report};

/// The logic source may be TypeScript (recommended) or JavaScript. Its bound
/// is generous: the bundle, not the source, must fit `MAX_LOGIC_BYTES`.
pub const LOGIC_SOURCES: [&str; 2] = ["logic.ts", "logic.js"];
const MAX_LOGIC_SOURCE_BYTES: u64 = 4 * MAX_LOGIC_BYTES.value;
/// Nesting of `assets/` directories read, above the schema's segment bound
/// so that the package validator, not the walk, reports a deep path.
const MAX_ASSET_DEPTH: usize = 8;

#[derive(Debug)]
pub struct Project {
    pub manifest: Vec<u8>,
    pub view: Vec<u8>,
    pub style: Option<Vec<u8>>,
    /// `logic.ts` or `logic.js`.
    pub logic_path: &'static str,
    pub logic: String,
    pub locales: Option<(Vec<u8>, Vec<u8>)>,
    pub license: Vec<u8>,
    /// `assets/...` paths with `/` separators, in byte order.
    pub assets: BTreeMap<String, Vec<u8>>,
}

impl Project {
    /// Reads the project at `root`. Every problem is reported; `None` when
    /// a required file is missing or unreadable.
    pub fn load(root: &Path, report: &mut Report) -> Option<Self> {
        let before = report.errors();
        let manifest = required(root, "manifest.json", MAX_MANIFEST_BYTES.value, report);
        let view = required(root, "view.ocml", MAX_VIEW_SOURCE_BYTES.value, report);
        let style = optional(root, "style.ocss", MAX_STYLE_SOURCE_BYTES.value, report);
        let license = required(root, "LICENSE", MAX_LICENSE_BYTES.value, report);

        let present: Vec<&'static str> = LOGIC_SOURCES
            .into_iter()
            .filter(|name| root.join(name).exists())
            .collect();
        let logic = match present.as_slice() {
            [name] => optional(root, name, MAX_LOGIC_SOURCE_BYTES, report).and_then(|bytes| {
                match String::from_utf8(bytes) {
                    Ok(text) => Some((*name, text)),
                    Err(_) => {
                        report.push(
                            Diagnostic::error("project.encoding", "the logic source is not UTF-8")
                                .in_file(*name),
                        );
                        None
                    }
                }
            }),
            [] => {
                report.push(
                    Diagnostic::error("project.missing_file", "the project has no logic module")
                        .in_file("logic.ts")
                        .help("create logic.ts (or logic.js) next to manifest.json"),
                );
                None
            }
            _ => {
                report.push(
                    Diagnostic::error(
                        "project.ambiguous_logic",
                        "both logic.ts and logic.js exist; the widget has one logic module",
                    )
                    .in_file("logic.js")
                    .help("delete logic.js, or logic.ts if you write JavaScript"),
                );
                None
            }
        };

        let en = optional(root, "locales/en.json", MAX_LOCALE_FILE_BYTES.value, report);
        let fr = optional(root, "locales/fr.json", MAX_LOCALE_FILE_BYTES.value, report);
        let locales = match (en, fr) {
            (Some(en), Some(fr)) => Some((en, fr)),
            (None, None) => None,
            (en, _) => {
                let missing = if en.is_some() {
                    "locales/fr.json"
                } else {
                    "locales/en.json"
                };
                report.push(
                    Diagnostic::error(
                        "locales.missing_file",
                        "a widget has both locales/en.json and locales/fr.json, or neither",
                    )
                    .in_file(missing),
                );
                None
            }
        };

        let mut assets = BTreeMap::new();
        let directory = root.join("assets");
        if directory.is_dir() {
            walk_assets(&directory, "assets", 0, &mut assets, report);
        }

        if report.errors() > before {
            return None;
        }
        let (logic_path, logic) = logic?;
        Some(Self {
            manifest: manifest?,
            view: view?,
            style,
            logic_path,
            logic,
            locales,
            license: license?,
            assets,
        })
    }

    /// Source text of a project file, for diagnostics.
    pub fn source(&self, file: &str) -> Option<String> {
        let bytes = match file {
            "manifest.json" => Some(self.manifest.as_slice()),
            "view.ocml" => Some(self.view.as_slice()),
            "style.ocss" => self.style.as_deref(),
            "locales/en.json" => self.locales.as_ref().map(|(en, _)| en.as_slice()),
            "locales/fr.json" => self.locales.as_ref().map(|(_, fr)| fr.as_slice()),
            _ if file == self.logic_path => Some(self.logic.as_bytes()),
            _ => None,
        }?;
        String::from_utf8(bytes.to_vec()).ok()
    }
}

fn required(root: &Path, name: &str, limit: u64, report: &mut Report) -> Option<Vec<u8>> {
    if !root.join(name).exists() {
        report.push(
            Diagnostic::error("project.missing_file", format!("{name} is missing"))
                .in_file(name)
                .help("`overcrow-widget init` writes a complete project to start from"),
        );
        return None;
    }
    optional(root, name, limit, report)
}

fn optional(root: &Path, name: &str, limit: u64, report: &mut Report) -> Option<Vec<u8>> {
    let path = root.join(name);
    if !path.exists() {
        return None;
    }
    match read_bounded(&path, limit) {
        Ok(Some(bytes)) => Some(bytes),
        Ok(None) => {
            report.push(
                Diagnostic::error(
                    "project.file_size",
                    format!("{name} is larger than {limit} bytes"),
                )
                .in_file(name),
            );
            None
        }
        Err(error) => {
            report.push(
                Diagnostic::error("project.read", format!("cannot read {name}: {error}"))
                    .in_file(name),
            );
            None
        }
    }
}

/// The content of a regular file, or `None` when it exceeds `limit`.
pub fn read_bounded(path: &Path, limit: u64) -> std::io::Result<Option<Vec<u8>>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= limit).then_some(bytes))
}

fn walk_assets(
    directory: &Path,
    prefix: &str,
    depth: usize,
    assets: &mut BTreeMap<String, Vec<u8>>,
    report: &mut Report,
) {
    if depth > MAX_ASSET_DEPTH {
        report.push(
            Diagnostic::error("project.asset_path", "assets/ is nested too deeply").in_file(prefix),
        );
        return;
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            report.push(
                Diagnostic::error("project.read", format!("cannot read {prefix}: {error}"))
                    .in_file(prefix),
            );
            return;
        }
    };
    let mut names: Vec<_> = entries.filter_map(Result::ok).collect();
    names.sort_by_key(|entry| entry.file_name());
    for entry in names {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            report.push(
                Diagnostic::error("project.asset_path", "an asset name is not UTF-8")
                    .in_file(prefix),
            );
            continue;
        };
        let path = format!("{prefix}/{name}");
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(_) => continue,
        };
        if kind.is_dir() {
            walk_assets(&entry.path(), &path, depth + 1, assets, report);
        } else if kind.is_file() {
            if assets.len() as u64 >= MAX_PACKAGE_FILES.value {
                report.push(
                    Diagnostic::error("project.entry_limit", "too many files under assets/")
                        .in_file("assets"),
                );
                return;
            }
            if let Some(bytes) = optional_path(&entry.path(), &path, report) {
                assets.insert(path, bytes);
            }
        } else {
            report.push(
                Diagnostic::error(
                    "project.asset_path",
                    "assets/ holds only regular files and directories",
                )
                .in_file(path),
            );
        }
    }
}

fn optional_path(path: &Path, name: &str, report: &mut Report) -> Option<Vec<u8>> {
    match read_bounded(path, MAX_IMAGE_ENCODED_BYTES.value) {
        Ok(Some(bytes)) => Some(bytes),
        Ok(None) => {
            report.push(
                Diagnostic::error(
                    "project.file_size",
                    format!(
                        "{name} is larger than {} bytes",
                        MAX_IMAGE_ENCODED_BYTES.value
                    ),
                )
                .in_file(name),
            );
            None
        }
        Err(error) => {
            report.push(
                Diagnostic::error("project.read", format!("cannot read {name}: {error}"))
                    .in_file(name),
            );
            None
        }
    }
}
