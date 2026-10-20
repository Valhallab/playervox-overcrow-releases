//! `snapshot-plan`: the validated `git ls-tree` of a revision that the
//! marketplace CI materializes (`scripts/materialize-git-snapshot.sh`): only
//! bounded regular files with portable paths. Widget tests
//! (`widgets/<dir>/tests/`, reference images and fixtures) are read by no
//! admission step: they are validated like every file of the tree but stay
//! out of the plan and of the snapshot's bounds. Maintenance command, not for
//! creators; Git runs with a fixed, isolated environment.

use std::{
    collections::BTreeSet,
    fmt, fs,
    io::{Read as _, Write as _},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

// `git ls-tree` of the whole tree: 20,000 records of at most 300 bytes (a
// 240-byte path and its header).
const MAX_PLAN_BYTES: usize = 6 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 20_000;
// The materialized snapshot.
const MAX_ENTRIES: usize = 4_000;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_AGGREGATE_BYTES: u64 = 32 * 1024 * 1024;
const GIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct SnapshotError;

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("snapshot plan rejected")
    }
}

struct Entry<'a> {
    mode: &'a str,
    size: u64,
    object: &'a str,
    path: &'a str,
}

pub fn write_plan(repository: &Path, revision: &str) -> Result<(), SnapshotError> {
    if !safe_repository(repository) || !valid_object_id(revision) {
        return Err(SnapshotError);
    }
    let repository = repository.to_str().ok_or(SnapshotError)?;
    let mut child = Command::new("/usr/bin/git")
        .env_remove(crate::publish::secret::KEY_VARIABLE)
        .args([
            "--no-replace-objects",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.attributesFile=/dev/null",
            "-c",
            "core.excludesFile=/dev/null",
            "-c",
            "credential.helper=",
            "-c",
            "protocol.file.allow=never",
            "-c",
            "protocol.ext.allow=never",
            "-C",
            repository,
            "ls-tree",
            "-r",
            "-z",
            "-l",
            "--full-tree",
            revision,
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| SnapshotError)?;
    let stdout = child.stdout.take().ok_or(SnapshotError)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take((MAX_PLAN_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + GIT_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| SnapshotError)? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SnapshotError);
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let bytes = reader
        .join()
        .map_err(|_| SnapshotError)?
        .map_err(|_| SnapshotError)?;
    if !status.success() || bytes.len() > MAX_PLAN_BYTES {
        return Err(SnapshotError);
    }
    let entries = validate_plan(&bytes)?;
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    for entry in entries {
        writeln!(
            output,
            "{}\t{}\t{}\t{}",
            entry.mode, entry.size, entry.object, entry.path
        )
        .map_err(|_| SnapshotError)?;
    }
    Ok(())
}

fn safe_repository(repository: &Path) -> bool {
    repository.is_absolute()
        && fs::canonicalize(repository).is_ok_and(|canonical| canonical == repository)
        && fs::metadata(repository).is_ok_and(|metadata| metadata.is_dir())
}

fn validate_plan(bytes: &[u8]) -> Result<Vec<Entry<'_>>, SnapshotError> {
    let mut paths = BTreeSet::new();
    // Widget directories with tests, and with materialized files.
    let mut tested = BTreeSet::new();
    let mut materialized = BTreeSet::new();
    let mut aggregate = 0_u64;
    let mut entries = Vec::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let tab = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or(SnapshotError)?;
        let header = std::str::from_utf8(&record[..tab]).map_err(|_| SnapshotError)?;
        let mut fields = header.split_ascii_whitespace();
        let mode = fields.next().ok_or(SnapshotError)?;
        let kind = fields.next().ok_or(SnapshotError)?;
        let object = fields.next().ok_or(SnapshotError)?;
        let size = fields
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(SnapshotError)?;
        if fields.next().is_some()
            || !matches!(mode, "100644" | "100755")
            || kind != "blob"
            || !valid_object_id(object)
            || size > MAX_FILE_BYTES
        {
            return Err(SnapshotError);
        }
        let path = std::str::from_utf8(&record[tab + 1..]).map_err(|_| SnapshotError)?;
        if !valid_path(path) || !paths.insert(path) || paths.len() > MAX_TREE_ENTRIES {
            return Err(SnapshotError);
        }
        if let Some(directory) = widget_test(path) {
            tested.insert(directory);
            continue;
        }
        if let Some(directory) = widget_directory(path) {
            materialized.insert(directory);
        }
        if entries.len() == MAX_ENTRIES {
            return Err(SnapshotError);
        }
        aggregate = aggregate.checked_add(size).ok_or(SnapshotError)?;
        if aggregate > MAX_AGGREGATE_BYTES {
            return Err(SnapshotError);
        }
        entries.push(Entry {
            mode,
            size,
            object,
            path,
        });
    }
    if entries.is_empty() || !tested.is_subset(&materialized) {
        return Err(SnapshotError);
    }
    Ok(entries)
}

/// `<dir>` of `widgets/<dir>/...` (a valid path has no empty component).
fn widget_directory(path: &str) -> Option<&str> {
    Some(path.strip_prefix("widgets/")?.split_once('/')?.0)
}

/// `<dir>` of `widgets/<dir>/tests/...`, as the script's Git pathspec
/// `:(exclude,glob)widgets/*/tests/**`.
fn widget_test(path: &str) -> Option<&str> {
    let (directory, rest) = path.strip_prefix("widgets/")?.split_once('/')?;
    rest.starts_with("tests/").then_some(directory)
}

fn valid_object_id(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && !value.starts_with('/')
        && !value.ends_with('/')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/'))
        && value
            .split('/')
            .all(|component| !component.is_empty() && !matches!(component, "." | ".."))
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_AGGREGATE_BYTES, MAX_ENTRIES, MAX_PLAN_BYTES, MAX_TREE_ENTRIES, SnapshotError,
        validate_plan,
    };

    const OBJECT: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn plan_accepts_only_bounded_regular_files_with_portable_paths() {
        let valid = format!("100644 blob {OBJECT} 12\twidgets/example/index.html\0");
        let entries = validate_plan(valid.as_bytes()).expect("valid snapshot plan");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "widgets/example/index.html");

        for invalid in [
            format!("120000 blob {OBJECT} 12\twidgets/example/link\0"),
            format!("100644 blob {OBJECT} 12\twidgets/example/bad name\0"),
            format!("100644 blob {OBJECT} 8388609\twidgets/example/large\0"),
        ] {
            assert!(matches!(
                validate_plan(invalid.as_bytes()),
                Err(SnapshotError)
            ));
        }
    }

    /// The repository outgrew 1,000 files with the built-in pilots' sources
    /// and reference images (P2.4): the plan takes up to `MAX_ENTRIES`
    /// files and `MAX_AGGREGATE_BYTES`, and refuses one more.
    #[test]
    fn plan_bounds_entries_and_aggregate_size() {
        let plan = |count: usize, size: u64| -> String {
            (0..count)
                .map(|index| {
                    format!("100644 blob {OBJECT} {size}\twidgets/w/assets/{index:05}.png\0")
                })
                .collect()
        };
        let full = plan(MAX_ENTRIES, 1);
        assert!(full.len() <= MAX_PLAN_BYTES);
        assert_eq!(
            validate_plan(full.as_bytes()).expect("at the bound").len(),
            MAX_ENTRIES
        );
        assert!(validate_plan(plan(MAX_ENTRIES + 1, 1).as_bytes()).is_err());
        let per_file = 8 * 1024 * 1024;
        let count = (MAX_AGGREGATE_BYTES / per_file) as usize;
        assert!(validate_plan(plan(count, per_file).as_bytes()).is_ok());
        assert!(validate_plan(plan(count + 1, per_file).as_bytes()).is_err());
    }

    /// Reference images and fixtures (`widgets/<dir>/tests/`) are read by
    /// no admission step: they stay out of the snapshot and its bounds, but
    /// every one of them is still a bounded regular file with a portable path.
    #[test]
    fn plan_leaves_widget_tests_out_of_the_snapshot() {
        let mut tree = format!("100644 blob {OBJECT} 12\twidgets/w/manifest.json\0");
        for index in 0..10 {
            tree.push_str(&format!(
                "100644 blob {OBJECT} 8388608\twidgets/w/tests/reference/{index}.png\0"
            ));
        }
        let entries = validate_plan(tree.as_bytes()).expect("tests beyond the aggregate bound");
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path).collect();
        assert_eq!(paths, ["widgets/w/manifest.json"]);

        for invalid in [
            format!("120000 blob {OBJECT} 12\twidgets/w/tests/link\0"),
            format!("160000 commit {OBJECT} 0\twidgets/w/tests/module\0"),
            format!("100644 blob {OBJECT} 12\twidgets/w/tests/bad name\0"),
            format!("100644 blob {OBJECT} 8388609\twidgets/w/tests/large.png\0"),
            format!(
                "100644 blob {OBJECT} 12\twidgets/w/tests/a\0100644 blob {OBJECT} 12\twidgets/w/tests/a\0"
            ),
        ] {
            let plan = format!("100644 blob {OBJECT} 12\twidgets/w/manifest.json\0{invalid}");
            assert!(validate_plan(plan.as_bytes()).is_err(), "{invalid}");
        }
    }

    /// Only the third component `tests` of `widgets/<dir>/...` is left out.
    #[test]
    fn plan_keeps_every_other_tests_directory() {
        for path in [
            "widgets/w/tests",
            "widgets/tests/x",
            "widgets/w/sub/tests/x",
            "widgets/w/tests-old/x",
            "cli/tests/x",
            "templates/blank/tests/x",
            "sdk/test/e2e/clock/tests/x",
        ] {
            let plan = format!("100644 blob {OBJECT} 12\t{path}\0");
            let entries = validate_plan(plan.as_bytes()).expect("valid snapshot plan");
            assert_eq!(entries.len(), 1, "{path}");
        }
        let only_tests = format!("100644 blob {OBJECT} 12\twidgets/w/tests/a.png\0");
        assert!(validate_plan(only_tests.as_bytes()).is_err());
    }

    /// A widget directory holding only tests would vanish from the snapshot
    /// and skip admission: it is refused, as a directory that is no widget.
    #[test]
    fn plan_refuses_a_widget_directory_of_tests_only() {
        let widget = format!("100644 blob {OBJECT} 12\twidgets/w/manifest.json\0");
        let hidden = format!("{widget}100644 blob {OBJECT} 12\twidgets/x/tests/a.png\0");
        assert!(validate_plan(hidden.as_bytes()).is_err());
        let before = format!("100644 blob {OBJECT} 12\twidgets/w/tests/a.png\0{widget}");
        assert_eq!(
            validate_plan(before.as_bytes())
                .expect("tested widget")
                .len(),
            1
        );
    }

    /// The tree may hold up to `MAX_TREE_ENTRIES` files, the snapshot
    /// `MAX_ENTRIES` of them.
    #[test]
    fn plan_bounds_the_whole_tree() {
        let tree = |count: usize| -> String {
            let mut tree = format!("100644 blob {OBJECT} 12\twidgets/w/manifest.json\0");
            for index in 1..count {
                tree.push_str(&format!(
                    "100644 blob {OBJECT} 1\twidgets/w/tests/reference/{index:05}.png\0"
                ));
            }
            tree
        };
        let full = tree(MAX_TREE_ENTRIES);
        assert!(full.len() <= MAX_PLAN_BYTES);
        assert_eq!(
            validate_plan(full.as_bytes()).expect("at the bound").len(),
            1
        );
        assert!(validate_plan(tree(MAX_TREE_ENTRIES + 1).as_bytes()).is_err());
        let longest = format!("100644 blob {OBJECT} 8388608\t{}\0", "a".repeat(240));
        assert!(longest.len() * MAX_TREE_ENTRIES <= MAX_PLAN_BYTES);
    }
}
