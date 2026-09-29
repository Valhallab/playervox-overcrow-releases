//! What `dev` watches: the project's source files, by size and modification
//! time, polled a few times a second. No dependency and no background
//! thread: a project is at most a few hundred files, read with the same
//! bounds as the package (`assets/` depth and file count), and `node_modules`
//! or `dist` are never walked.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::SystemTime;

use overcrow_widget_schema::limits::MAX_PACKAGE_FILES;

/// Top-level files of a project (`docs/cli.md`, Project layout).
const SOURCES: &[&str] = &[
    "manifest.json",
    "view.ocml",
    "style.ocss",
    "logic.ts",
    "logic.js",
    "locales/en.json",
    "locales/fr.json",
    "LICENSE",
];
/// Files that only change what `tsc` says.
const TYPES: &[&str] = &["logic.ts", "tsconfig.json", "package.json"];
const MAX_DEPTH: usize = 8;

/// A file's size and modification time; `None` when it is absent.
type Stamp = Option<(u64, Option<SystemTime>)>;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Snapshot {
    files: BTreeMap<String, Stamp>,
}

impl Snapshot {
    pub fn take(root: &Path) -> Self {
        let mut files = BTreeMap::new();
        for name in SOURCES.iter().chain(TYPES) {
            files.insert((*name).to_owned(), stamp(&root.join(name)));
        }
        walk(&root.join("assets"), "assets", 0, &mut files);
        Self { files }
    }

    /// Whether a file that only `tsc` reads changed.
    pub fn types_changed(&self, other: &Self) -> bool {
        TYPES
            .iter()
            .any(|name| self.files.get(*name) != other.files.get(*name))
    }
}

fn stamp(path: &Path) -> Stamp {
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.len(), metadata.modified().ok()))
}

fn walk(directory: &Path, prefix: &str, depth: usize, files: &mut BTreeMap<String, Stamp>) {
    if depth > MAX_DEPTH || files.len() as u64 > MAX_PACKAGE_FILES.value + SOURCES.len() as u64 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        let path = entry.path();
        if path.is_dir() {
            walk(&path, &name, depth + 1, files);
        } else {
            files.insert(name, stamp(&path));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_change_is_seen_and_tooling_is_not_walked() {
        let dir = tempfile::tempdir().expect("project");
        let root = dir.path();
        std::fs::write(root.join("view.ocml"), "<text>a</text>").expect("view");
        std::fs::create_dir_all(root.join("node_modules/x")).expect("modules");
        let first = Snapshot::take(root);
        std::fs::write(root.join("node_modules/x/index.js"), "x").expect("module");
        std::fs::create_dir_all(root.join("dist")).expect("dist");
        std::fs::write(root.join("dist/a.ocpkg"), "x").expect("package");
        assert_eq!(Snapshot::take(root), first);
        std::fs::write(root.join("view.ocml"), "<text>ab</text>").expect("view");
        let second = Snapshot::take(root);
        assert_ne!(second, first);
        assert!(!second.types_changed(&first));
        std::fs::create_dir_all(root.join("assets/icons")).expect("assets");
        std::fs::write(root.join("assets/icons/a.png"), "x").expect("asset");
        let third = Snapshot::take(root);
        assert_ne!(third, second);
        std::fs::write(root.join("tsconfig.json"), "{}").expect("tsconfig");
        assert!(Snapshot::take(root).types_changed(&third));
    }
}
