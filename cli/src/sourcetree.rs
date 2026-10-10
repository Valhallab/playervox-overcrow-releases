//! The sources of a widget as a creator sends them: a folder, or a ZIP of
//! that folder. Both become the same [`Tree`], the files the creator space
//! receives, sorted by path. `admit` rebuilds from it and `diff` compares
//! two of them.
//!
//! An archive is read whole into memory (at most `MAX_ARCHIVE_BYTES`),
//! checked by the strict reader under [`Rules::SOURCES`] and inflated in
//! memory: a refused archive writes nothing. [`materialize`] then writes
//! the validated files, and only them, into a fresh private work folder.
//!
//! What the MCP server never puts into a sources ZIP is left out of both
//! forms (and never extracted from an archive, though it counts toward the
//! archive's bounds): hidden files and folders, `node_modules/`, `dist/`,
//! `tests/output/`, `__MACOSX/`, built packages, key stores and system
//! files. One folder wrapping the whole widget, as Finder and Explorer
//! write it, is removed.

use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use overcrow_widget_schema::package::{hex, sha256};
use serde_json::{Value, json};

use crate::diag::{Diagnostic, Report};
use crate::project::read_bounded;
use crate::sanitize;
use crate::zipread::{self, Limits, Refused, Rules, ZipError};

/// The largest source archive the creator space takes.
pub const MAX_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
/// Files of the sources (folder entries of an archive are bounded apart).
pub const MAX_FILES: usize = 2000;
/// Uncompressed bytes of the sources.
pub const MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Folder depth walked in a source folder.
const MAX_DEPTH: usize = 16;
const MAX_PATH_BYTES: usize = 255;

const LIMITS: Limits = Limits {
    max_entries: MAX_FILES,
    max_entry_bytes: MAX_BYTES,
    max_total_bytes: MAX_BYTES,
    // Every header at its largest name and extra field.
    max_directory_bytes: 2
        * MAX_FILES as u64
        * (46 + MAX_PATH_BYTES as u64 + zipread::MAX_EXTRA_BYTES as u64),
};

/// Where sources come from.
#[derive(Clone, Debug)]
pub enum Input {
    Folder(PathBuf),
    Archive(PathBuf),
}

impl Input {
    /// A folder, or a file whose name ends in `.zip` (any case).
    pub fn of(path: &Path) -> Option<Self> {
        if path.is_dir() {
            Some(Self::Folder(path.to_path_buf()))
        } else if is_zip(path) && path.is_file() {
            Some(Self::Archive(path.to_path_buf()))
        } else {
            None
        }
    }
}

/// Whether `path` names a ZIP of sources (and not a `.ocpkg` package).
pub fn is_zip(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

/// The archive a tree was read from.
#[derive(Clone, Debug)]
pub struct Archive {
    pub sha256: String,
    /// The wrapping folder removed from every path.
    pub prefix: Option<String>,
}

/// Selected files by relative path (`/` separators), and what was left
/// out with its reason (folders end with `/`).
#[derive(Clone, Debug, Default)]
pub struct Tree {
    pub files: BTreeMap<String, Vec<u8>>,
    pub ignored: BTreeMap<String, &'static str>,
    pub archive: Option<Archive>,
}

impl Tree {
    pub fn bytes(&self) -> u64 {
        self.files.values().map(|bytes| bytes.len() as u64).sum()
    }

    /// `{"kind", "files", "bytes", "sha256", "prefix", "ignored"}`.
    pub fn summary_json(&self) -> Value {
        json!({
            "kind": if self.archive.is_some() { "archive" } else { "folder" },
            "files": self.files.len(),
            "bytes": self.bytes(),
            "sha256": self.archive.as_ref().map(|archive| archive.sha256.clone()),
            "prefix": self.archive.as_ref().and_then(|archive| archive.prefix.clone()),
            "ignored": self
                .ignored
                .iter()
                .map(|(path, reason)| json!({"path": path, "reason": reason}))
                .collect::<Vec<_>>(),
        })
    }
}

/// Why a folder named `name`, at `path` from the root, is left out.
fn folder_reason(path: &str, name: &str) -> Option<&'static str> {
    if name.starts_with('.') {
        Some("a hidden folder")
    } else if name == "node_modules" {
        Some("installed packages: npm brings them back")
    } else if name == "dist" {
        Some("build output: the creator space builds its own package")
    } else if name == "__MACOSX" {
        Some("macOS archive metadata")
    } else if path == "tests/output" {
        Some("test output: test writes it again")
    } else {
        None
    }
}

const KEY_EXTENSIONS: [&str; 10] = [
    "pem", "key", "p12", "pfx", "pk8", "jks", "keystore", "kdbx", "gpg", "asc",
];
const KEY_NAMES: [&str; 4] = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
const SYSTEM_FILES: [&str; 3] = ["thumbs.db", "desktop.ini", "ehthumbs.db"];

/// Why a file named `name` is left out.
fn file_reason(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    let extension = lower.rsplit_once('.').map(|(_, extension)| extension);
    if name.starts_with('.') {
        Some("a hidden file (such as .env or .npmrc, which often hold secrets)")
    } else if extension == Some("ocpkg") {
        Some("a built package: the creator space builds its own")
    } else if extension.is_some_and(|extension| KEY_EXTENSIONS.contains(&extension))
        || KEY_NAMES.contains(&lower.strip_suffix(".pub").unwrap_or(&lower))
    {
        Some("a key or a key store: never sent")
    } else if SYSTEM_FILES.contains(&lower.as_str()) {
        Some("a system file")
    } else {
        None
    }
}

/// Why the file at `path` (from the root) is left out, and the path to
/// list: the left-out folder (ending in `/`) or the file itself.
pub fn ignored(path: &str) -> Option<(String, &'static str)> {
    let mut end = 0;
    let components: Vec<&str> = path.split('/').collect();
    for component in &components[..components.len() - 1] {
        end += component.len();
        if let Some(reason) = folder_reason(&path[..end], component) {
            return Some((format!("{}/", &path[..end]), reason));
        }
        end += 1;
    }
    file_reason(components[components.len() - 1]).map(|reason| (path.to_owned(), reason))
}

/// Whether reading failed on a file error (`sources.read`) rather than on a
/// refusal: the command then ends with status 2, not 1.
pub fn io_failed(report: &Report) -> bool {
    !report.diagnostics.is_empty()
        && report
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "sources.read")
}

/// Whether the folder at `path` (from the root) is left out of the sources:
/// `package` and `check` skip it in `assets/` too, so that they build what
/// the creator space builds.
pub fn left_out_folder(path: &str) -> bool {
    ignored(&format!("{path}/x")).is_some_and(|(listed, _)| listed.ends_with('/'))
}

/// Reads sources; every refusal is a diagnostic in `report`.
pub fn read(input: &Input, report: &mut Report) -> Option<Tree> {
    match input {
        Input::Folder(root) => read_folder(root, report),
        Input::Archive(path) => read_archive(path, report),
    }
}

fn read_archive(path: &Path, report: &mut Report) -> Option<Tree> {
    let shown = path.display().to_string();
    let bytes = match read_bounded(path, MAX_ARCHIVE_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            report.push(
                Diagnostic::error(
                    "sources.archive_size",
                    format!("the archive is larger than {} MiB", MAX_ARCHIVE_BYTES >> 20),
                )
                .in_file(shown)
                .help("leave out node_modules, dist and large files the widget does not use"),
            );
            return None;
        }
        Err(error) => {
            report.push(
                Diagnostic::error("sources.read", format!("cannot read the archive: {error}"))
                    .in_file(shown),
            );
            return None;
        }
    };
    let mut reader = Cursor::new(bytes.as_slice());
    let entries =
        match zipread::entries_with(&mut reader, bytes.len() as u64, LIMITS, Rules::SOURCES) {
            Ok(entries) => entries,
            Err(refused) => {
                report.push(refusal(&refused).in_file(shown));
                return None;
            }
        };
    let files: Vec<&zipread::Entry> = entries.iter().filter(|entry| !entry.directory).collect();
    let prefix = wrapping_folder(&files);
    let mut refuse = |error: ZipError, entry: &zipread::Entry| {
        report.push(
            refusal(&Refused {
                error,
                entry: Some(entry.name.clone()),
            })
            .in_file(shown.clone()),
        );
    };
    // Folders and left-out entries are inflated too, into nothing: an
    // archive hides no byte, even where nobody reads.
    for entry in entries.iter().filter(|entry| entry.directory) {
        if let Err(error) = zipread::extract(&mut reader, entry, &mut std::io::sink()) {
            refuse(error, entry);
            return None;
        }
    }
    let mut tree = Tree {
        archive: Some(Archive {
            sha256: hex(&sha256(&bytes)),
            prefix: prefix.clone(),
        }),
        ..Tree::default()
    };
    for entry in files {
        let path = match &prefix {
            Some(prefix) => match entry.name.strip_prefix(&format!("{prefix}/")) {
                Some(rest) => rest.to_owned(),
                // Outside the wrapping folder: only left-out entries are.
                None => entry.name.clone(),
            },
            None => entry.name.clone(),
        };
        if let Some((listed, reason)) = ignored(&path).or_else(|| ignored(&entry.name)) {
            if let Err(error) = zipread::extract(&mut reader, entry, &mut std::io::sink()) {
                refuse(error, entry);
                return None;
            }
            tree.ignored.insert(listed, reason);
            continue;
        }
        let mut output = Vec::with_capacity(entry.size as usize);
        if let Err(error) = zipread::extract(&mut reader, entry, &mut output) {
            refuse(error, entry);
            return None;
        }
        tree.files.insert(path, output);
    }
    Some(tree)
}

/// The one folder that holds every kept file and `manifest.json`, when the
/// archive has no `manifest.json` at its root.
fn wrapping_folder(files: &[&zipread::Entry]) -> Option<String> {
    let kept: Vec<&str> = files
        .iter()
        .map(|entry| entry.name.as_str())
        .filter(|name| ignored(name).is_none())
        .collect();
    if kept.contains(&"manifest.json") {
        return None;
    }
    let (folder, _) = kept.first()?.split_once('/')?;
    let inside = |name: &&str| {
        name.strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('/'))
    };
    (kept.iter().all(inside) && kept.contains(&format!("{folder}/manifest.json").as_str()))
        .then(|| folder.to_owned())
}

/// A refusal of the reader as a diagnostic, the entry named in the message.
fn refusal(refused: &Refused) -> Diagnostic {
    let entry = refused
        .entry
        .as_deref()
        .map(|entry| format!(": {}", sanitize::line(entry)))
        .unwrap_or_default();
    let (code, message, help) = match refused.error {
        ZipError::Io => (
            "sources.read",
            "the archive cannot be read".to_owned(),
            None,
        ),
        ZipError::UnsafeName => (
            "sources.unsafe_name",
            format!(
                "a file name could leave the widget folder or does not work on every system{entry}"
            ),
            Some(
                "use ASCII letters, digits, `-`, `_` and `.`, without `..`, a leading `/`, `\\` or `:`",
            ),
        ),
        ZipError::TooLarge => (
            "sources.too_large",
            format!(
                "the sources are larger than {} MiB once uncompressed{entry}",
                MAX_BYTES >> 20
            ),
            Some("leave out node_modules, dist and large files the widget does not use"),
        ),
        ZipError::TooManyEntries => (
            "sources.too_many_files",
            format!("the archive holds more than {MAX_FILES} files"),
            Some("leave out node_modules, dist and the files the widget does not use"),
        ),
        ZipError::Link => (
            "sources.link",
            format!("the archive holds a link{entry}"),
            Some("replace the link with the file it points to"),
        ),
        ZipError::SpecialFile => (
            "sources.special_file",
            format!("the archive holds a device, a FIFO or a socket{entry}"),
            None,
        ),
        ZipError::Bomb | ZipError::Invalid(zipread::LARGER_THAN_DECLARED) => (
            "sources.bomb",
            format!("an entry inflates far beyond its compressed size{entry}"),
            None,
        ),
        ZipError::Invalid(zipread::ENCRYPTED) => (
            "sources.encrypted",
            format!("the archive is encrypted{entry}"),
            Some("send the archive without a password"),
        ),
        ZipError::Invalid(zipread::ZIP64) => (
            "sources.zip64",
            format!("the archive uses ZIP64, which sources never need{entry}"),
            Some("make the archive with the overcrow-widget tools or a standard ZIP tool"),
        ),
        ZipError::Invalid(zipread::BACKSLASH) => (
            "sources.backslash",
            format!(
                "the archive separates folders with `\\`, as Windows PowerShell 5.1 Compress-Archive does{entry}"
            ),
            Some(
                "send the widget folder itself in the creator space, or run `overcrow-widget submit`, which makes a correct ZIP",
            ),
        ),
        ZipError::Invalid(zipread::DUPLICATE | zipread::FILE_IS_FOLDER) => (
            "sources.duplicate_name",
            format!("two entries have the same name once case is ignored{entry}"),
            Some("rename one of them: Windows and macOS would merge them"),
        ),
        ZipError::Invalid(rule) => (
            "sources.archive",
            format!("this archive is refused ({rule}){entry}"),
            Some("make the archive again with a standard ZIP tool, without a comment"),
        ),
    };
    let diagnostic = Diagnostic::error(code, message);
    match help {
        Some(help) => diagnostic.help(help),
        None => diagnostic,
    }
}

fn read_folder(root: &Path, report: &mut Report) -> Option<Tree> {
    let mut tree = Tree::default();
    let mut total = 0_u64;
    let before = report.errors();
    walk(root, "", 0, &mut tree, &mut total, (report, before));
    (report.errors() == before).then_some(tree)
}

fn walk(
    directory: &Path,
    prefix: &str,
    depth: usize,
    tree: &mut Tree,
    total: &mut u64,
    (report, before): (&mut Report, usize),
) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            report.push(
                Diagnostic::error("sources.read", format!("cannot read the folder: {error}"))
                    .in_file(directory.display().to_string()),
            );
            return;
        }
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        if report.errors() > before {
            return;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            let lossy = entry.file_name().to_string_lossy().into_owned();
            tree.ignored
                .insert(format!("{prefix}{lossy}"), "a name that is not UTF-8");
            continue;
        };
        let path = format!("{prefix}{name}");
        let Ok(kind) = fs::symlink_metadata(entry.path()).map(|metadata| metadata.file_type())
        else {
            continue;
        };
        if kind.is_symlink() {
            tree.ignored
                .insert(path, "a link: links are never followed");
        } else if kind.is_dir() {
            if let Some(reason) = folder_reason(&path, &name) {
                tree.ignored.insert(format!("{path}/"), reason);
            } else if !zipread::portable_component(&name) {
                tree.ignored
                    .insert(format!("{path}/"), "a name that is not portable ASCII");
            } else if depth >= MAX_DEPTH {
                report.push(
                    Diagnostic::error("sources.unsafe_name", "the folder is nested too deeply")
                        .in_file(path),
                );
            } else {
                walk(
                    &entry.path(),
                    &format!("{path}/"),
                    depth + 1,
                    tree,
                    total,
                    (&mut *report, before),
                );
            }
        } else if !kind.is_file() {
            tree.ignored.insert(path, "not a regular file");
        } else if let Some(reason) = file_reason(&name) {
            tree.ignored.insert(path, reason);
        } else if !zipread::portable_component(&name) {
            tree.ignored
                .insert(path, "a name that is not portable ASCII");
        } else if path.len() > MAX_PATH_BYTES {
            report.push(
                Diagnostic::error(
                    "sources.unsafe_name",
                    "a file path is longer than 255 bytes",
                )
                .in_file(path),
            );
        } else if tree.files.len() >= MAX_FILES {
            report.push(refusal(&Refused::from(ZipError::TooManyEntries)));
        } else {
            match read_regular(&entry.path(), MAX_BYTES - *total) {
                Ok(Some(bytes)) => {
                    *total += bytes.len() as u64;
                    tree.files.insert(path, bytes);
                }
                Ok(None) => report.push(refusal(&Refused {
                    error: ZipError::TooLarge,
                    entry: Some(path),
                })),
                Err(error) => report.push(
                    Diagnostic::error("sources.read", format!("cannot read the file: {error}"))
                        .in_file(path),
                ),
            }
        }
    }
}

/// The content of a regular file opened without following a link (a link
/// put in place after the walk is not read), or `None` above `limit`.
fn read_regular(path: &Path, limit: u64) -> std::io::Result<Option<Vec<u8>>> {
    use std::io::Read as _;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    // Neither a link nor a FIFO put in place after the walk: a FIFO would
    // block the open without O_NONBLOCK, which changes nothing for a file.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= limit).then_some(bytes))
}

/// Writes the files of `tree`, and only them, into a fresh folder only the
/// current user can open. The folder and its content go when the returned
/// handle is dropped.
pub fn materialize(tree: &Tree) -> std::io::Result<tempfile::TempDir> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("overcrow-sources-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        builder.permissions(fs::Permissions::from_mode(0o700));
    }
    let work = builder.tempdir()?;
    for (path, bytes) in &tree.files {
        let components: Vec<&str> = path.split('/').collect();
        if components
            .iter()
            .any(|component| component.is_empty() || *component == "." || *component == "..")
        {
            return Err(std::io::Error::other("unsafe path in a source tree"));
        }
        let target = components
            .iter()
            .fold(work.path().to_path_buf(), |target, component| {
                target.join(component)
            });
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        std::io::Write::write_all(&mut options.open(&target)?, bytes)?;
    }
    Ok(work)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::testzip::{self as zipwrite, Item};

    fn read_zip(bytes: &[u8]) -> (Option<Tree>, Report) {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("widget.zip");
        fs::write(&path, bytes).unwrap();
        let mut report = Report::default();
        let tree = read(&Input::Archive(path), &mut report);
        (tree, report)
    }

    fn codes(report: &Report) -> Vec<&str> {
        report
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect()
    }

    fn paths(tree: &Tree) -> Vec<&str> {
        tree.files.keys().map(String::as_str).collect()
    }

    #[test]
    fn a_wrapping_folder_is_removed() {
        let (tree, report) = read_zip(&zipwrite::archive(&[
            Item::folder("my-widget/"),
            Item::file("my-widget/manifest.json", b"{}"),
            Item::file("my-widget/logic.ts", b"export {};"),
            Item::stored("__MACOSX/my-widget/._logic.ts", b"apple"),
            Item::stored("my-widget/.DS_Store", b"finder"),
        ]));
        let tree = tree.unwrap_or_else(|| panic!("{:?}", codes(&report)));
        assert_eq!(paths(&tree), ["logic.ts", "manifest.json"]);
        assert_eq!(
            tree.archive.as_ref().unwrap().prefix.as_deref(),
            Some("my-widget")
        );
        assert_eq!(
            tree.ignored.keys().collect::<Vec<_>>(),
            [".DS_Store", "__MACOSX/"]
        );
        // Several top folders, or a manifest at the root: nothing removed.
        let (tree, _) = read_zip(&zipwrite::archive(&[
            Item::file("manifest.json", b"{}"),
            Item::file("assets/a.png", b"png"),
        ]));
        assert_eq!(paths(&tree.unwrap()), ["assets/a.png", "manifest.json"]);
    }

    #[test]
    fn left_out_entries_are_listed_and_checked_but_never_kept() {
        let (tree, report) = read_zip(&zipwrite::archive(&[
            Item::file("manifest.json", b"{}"),
            Item::file("node_modules/x/index.js", b"module.exports = 1;"),
            Item::stored(".env", b"SECRET=1"),
            Item::stored("dist/nova.lol-timers-1.0.0.ocpkg", b"pk"),
            Item::stored("tests/output/a.png", b"png"),
            Item::stored("keys/release.pk8", b"key"),
            Item::stored("docs/Thumbs.db", b"db"),
        ]));
        let tree = tree.unwrap_or_else(|| panic!("{:?}", codes(&report)));
        assert_eq!(paths(&tree), ["manifest.json"]);
        assert_eq!(
            tree.ignored.keys().collect::<Vec<_>>(),
            [
                ".env",
                "dist/",
                "docs/Thumbs.db",
                "keys/release.pk8",
                "node_modules/",
                "tests/output/"
            ]
        );
        // A left-out entry that lies about its size still refuses the
        // archive: nothing hides where nobody reads.
        let mut lying = Item::file("node_modules/x/index.js", &[b'a'; 4096]);
        lying.declared_size = Some(5);
        let (tree, report) = read_zip(&zipwrite::archive(&[
            Item::file("manifest.json", b"{}"),
            lying,
        ]));
        assert!(tree.is_none());
        assert_eq!(codes(&report), ["sources.bomb"]);
        // Only the wrapping folder itself is removed, with its slash.
        let (tree, report) = read_zip(&zipwrite::archive(&[
            Item::file("w/manifest.json", b"{}"),
            Item::stored("wx/.env", b"SECRET=1"),
        ]));
        let tree = tree.unwrap_or_else(|| panic!("{:?}", codes(&report)));
        assert_eq!(paths(&tree), ["manifest.json"]);
        assert_eq!(tree.ignored.keys().collect::<Vec<_>>(), ["wx/.env"]);
    }

    #[test]
    fn each_refusal_has_its_code() {
        let cases: Vec<(Vec<u8>, &str)> = vec![
            (
                zipwrite::archive(&[Item::stored("../x", b"x")]),
                "sources.unsafe_name",
            ),
            (
                zipwrite::archive(&[Item::stored("x", b"x").mode(0o120_777)]),
                "sources.link",
            ),
            (
                zipwrite::archive(&[Item::stored("x", b"x").mode(0o010_644)]),
                "sources.special_file",
            ),
            (
                zipwrite::archive(&[Item::stored("a", b"1"), Item::stored("A", b"2")]),
                "sources.duplicate_name",
            ),
            (
                zipwrite::archive_with(&[Item::stored("a", b"1")], b"", b"", &[b'c'; 1025]),
                "sources.archive",
            ),
            (
                zipwrite::archive(&[Item::stored("assets\\a.png", b"x")]),
                "sources.backslash",
            ),
            (
                b"not a zip at all, but long enough".to_vec(),
                "sources.archive",
            ),
        ];
        for (bytes, code) in cases {
            let (tree, report) = read_zip(&bytes);
            assert!(tree.is_none());
            assert_eq!(codes(&report), [code]);
        }
        let mut encrypted = Item::stored("a", b"x");
        encrypted.flags = 1;
        let (_, report) = read_zip(&zipwrite::archive(&[encrypted]));
        assert_eq!(codes(&report), ["sources.encrypted"]);
    }

    #[test]
    fn a_github_download_reads_like_its_folder() {
        // "Download ZIP": one wrapping folder, folder entries, the commit ID
        // as the archive comment.
        let (tree, report) = read_zip(&zipwrite::archive_with(
            &[
                Item::folder("lol-timers-main/"),
                Item::file("lol-timers-main/manifest.json", b"{}"),
                Item::folder("lol-timers-main/assets/"),
                Item::stored("lol-timers-main/assets/a.png", b"png"),
            ],
            b"",
            b"",
            b"0b7f2c4e5a6d7c8b9a0f1e2d3c4b5a6978695a4b",
        ));
        let tree = tree.unwrap_or_else(|| panic!("{:?}", codes(&report)));
        assert_eq!(paths(&tree), ["assets/a.png", "manifest.json"]);
    }

    #[test]
    fn backslashes_point_to_the_right_tools() {
        let (_, report) = read_zip(&zipwrite::archive(&[
            Item::file("manifest.json", b"{}"),
            Item::stored("assets\\icon.png", b"png"),
        ]));
        let diagnostic = &report.diagnostics[0];
        assert_eq!(diagnostic.code, "sources.backslash");
        assert!(
            diagnostic.message.contains("Compress-Archive"),
            "{}",
            diagnostic.message
        );
        assert!(
            diagnostic.message.contains("assets\\icon.png"),
            "{}",
            diagnostic.message
        );
        let help = diagnostic.help.as_deref().unwrap_or_default();
        assert!(help.contains("overcrow-widget submit"), "{help}");
    }

    #[test]
    fn an_archive_above_its_bound_is_never_parsed() {
        let mut bytes = zipwrite::archive(&[Item::stored("a", b"x")]);
        bytes.resize(MAX_ARCHIVE_BYTES as usize + 1, 0);
        let (tree, report) = read_zip(&bytes);
        assert!(tree.is_none());
        assert_eq!(codes(&report), ["sources.archive_size"]);
    }

    #[test]
    fn a_folder_reads_like_its_archive() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("node_modules/x")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("manifest.json"), b"{}").unwrap();
        fs::write(root.join("assets/a.png"), b"png").unwrap();
        fs::write(root.join("node_modules/x/index.js"), b"x").unwrap();
        fs::write(root.join(".git/HEAD"), b"ref").unwrap();
        fs::write(root.join(".env"), b"SECRET=1").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", root.join("passwd")).unwrap();
        let mut report = Report::default();
        let tree = read(&Input::Folder(root.to_path_buf()), &mut report).unwrap();
        assert_eq!(paths(&tree), ["assets/a.png", "manifest.json"]);
        assert!(tree.ignored.contains_key("node_modules/"));
        assert!(tree.ignored.contains_key(".git/"));
        #[cfg(unix)]
        assert_eq!(tree.ignored["passwd"], "a link: links are never followed");
    }

    #[test]
    fn materialize_writes_exactly_the_tree_in_a_private_folder() {
        let mut tree = Tree::default();
        tree.files.insert("manifest.json".into(), b"{}".to_vec());
        tree.files
            .insert("assets/icons/a.png".into(), b"png".to_vec());
        let work = materialize(&tree).unwrap();
        let mut found = Vec::new();
        let mut stack = vec![work.path().to_path_buf()];
        while let Some(directory) = stack.pop() {
            for entry in fs::read_dir(directory).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    stack.push(entry.path());
                } else {
                    found.push(
                        entry
                            .path()
                            .strip_prefix(work.path())
                            .unwrap()
                            .to_path_buf(),
                    );
                }
            }
        }
        found.sort();
        assert_eq!(
            found,
            [Path::new("assets/icons/a.png"), Path::new("manifest.json")]
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = fs::metadata(work.path()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let mut hostile = Tree::default();
        hostile.files.insert("../escape".into(), b"x".to_vec());
        assert!(materialize(&hostile).is_err());
    }

    #[test]
    fn left_out_folders_are_named_by_their_path() {
        assert!(left_out_folder("assets/dist"));
        assert!(left_out_folder("assets/.thumbnails"));
        assert!(left_out_folder("node_modules"));
        assert!(left_out_folder("tests/output"));
        assert!(!left_out_folder("assets/icons"));
        assert!(!left_out_folder("tests"));
    }
}
