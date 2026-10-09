//! `diff`: what changed between two versions of a widget's sources, as the
//! review of the creator space shows it. Each side is a folder or a source
//! ZIP, read as [`crate::sourcetree`] reads it (the same files the creator
//! space receives); the output is stable: files sorted by path, unified
//! hunks with three lines of context, and, when both sides have a valid
//! manifest, the permission keys the new version adds.
//!
//! Lines are compared exactly (a changed line ending is a change). A file
//! that is not UTF-8 or holds a NUL byte is binary: its digests are shown,
//! not its lines.

use std::collections::{BTreeSet, HashMap};
use std::io::Write as _;
use std::process::ExitCode;

use overcrow_widget_schema::manifest::{Manifest, validate_manifest};
use overcrow_widget_schema::package::{hex, sha256};
use serde_json::{Value, json};

use crate::diag::Report;
use crate::permissions;
use crate::sanitize;
use crate::sourcetree::{self, Input, Tree};
use crate::{Format, emit};

/// Version of the JSON output.
pub const FORMAT_VERSION: u64 = 1;
/// Lines of context around a change.
const CONTEXT: usize = 3;
/// Beyond this many edits, a file is shown as rewritten whole: the search
/// stays within a bounded time and memory.
const MAX_EDITS: usize = 2048;
const NO_NEWLINE: &str = "\\ No newline at end of file";

/// One step of an edit script, by index into the old and new lines.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Edit {
    Equal(usize, usize),
    Delete(usize),
    Insert(usize),
}

/// The shortest edit script from `old` to `new` (Myers), or `None` past
/// `MAX_EDITS` edits.
fn myers(old: &[u32], new: &[u32]) -> Option<Vec<Edit>> {
    let (n, m) = (old.len() as isize, new.len() as isize);
    let limit = (old.len() + new.len()).min(MAX_EDITS) as isize;
    let offset = limit + 1;
    let mut v = vec![0_isize; 2 * offset as usize + 1];
    // trace[d] holds v over k in [-d, d] before step d.
    let mut trace: Vec<Vec<isize>> = Vec::new();
    let mut found = false;
    'search: for d in 0..=limit {
        trace.push(v[(offset - d) as usize..=(offset + d) as usize].to_vec());
        for k in (-d..=d).step_by(2) {
            let at = |k: isize| (offset + k) as usize;
            let mut x = if k == -d || (k != d && v[at(k - 1)] < v[at(k + 1)]) {
                v[at(k + 1)]
            } else {
                v[at(k - 1)] + 1
            };
            let mut y = x - k;
            while x < n && y < m && old[x as usize] == new[y as usize] {
                x += 1;
                y += 1;
            }
            v[at(k)] = x;
            if x >= n && y >= m {
                found = true;
                break 'search;
            }
        }
    }
    if !found {
        return None;
    }
    let (mut x, mut y) = (n, m);
    let mut edits = Vec::new();
    for (d, before) in trace.iter().enumerate().rev() {
        let d = d as isize;
        let get = |k: isize| before[(k + d) as usize];
        let k = x - y;
        let previous_k = if k == -d || (k != d && get(k - 1) < get(k + 1)) {
            k + 1
        } else {
            k - 1
        };
        let previous_x = if d == 0 { 0 } else { get(previous_k) };
        let previous_y = previous_x - previous_k;
        while x > previous_x && y > previous_y {
            edits.push(Edit::Equal(x as usize - 1, y as usize - 1));
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            if x == previous_x {
                edits.push(Edit::Insert(y as usize - 1));
            } else {
                edits.push(Edit::Delete(x as usize - 1));
            }
        }
        x = previous_x;
        y = previous_y;
    }
    edits.reverse();
    Some(edits)
}

/// The edit script of two texts' lines: common ends first, Myers in
/// between, a whole rewrite past `MAX_EDITS`.
fn edits<'t>(old: &[&'t str], new: &[&'t str]) -> Vec<Edit> {
    let mut ids: HashMap<&'t str, u32> = HashMap::new();
    let mut intern = |line: &'t str| {
        let next = ids.len() as u32;
        *ids.entry(line).or_insert(next)
    };
    let old_ids: Vec<u32> = old.iter().map(|line| intern(line)).collect();
    let new_ids: Vec<u32> = new.iter().map(|line| intern(line)).collect();
    let prefix = old_ids
        .iter()
        .zip(&new_ids)
        .take_while(|(a, b)| a == b)
        .count();
    let suffix = old_ids[prefix..]
        .iter()
        .rev()
        .zip(new_ids[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let (old_middle, new_middle) = (
        &old_ids[prefix..old_ids.len() - suffix],
        &new_ids[prefix..new_ids.len() - suffix],
    );
    let mut script: Vec<Edit> = (0..prefix).map(|index| Edit::Equal(index, index)).collect();
    match myers(old_middle, new_middle) {
        Some(middle) => script.extend(middle.into_iter().map(|edit| match edit {
            Edit::Equal(a, b) => Edit::Equal(a + prefix, b + prefix),
            Edit::Delete(a) => Edit::Delete(a + prefix),
            Edit::Insert(b) => Edit::Insert(b + prefix),
        })),
        None => {
            script.extend((0..old_middle.len()).map(|a| Edit::Delete(a + prefix)));
            script.extend((0..new_middle.len()).map(|b| Edit::Insert(b + prefix)));
        }
    }
    let (old_end, new_end) = (old.len() - suffix, new.len() - suffix);
    script.extend((0..suffix).map(|index| Edit::Equal(old_end + index, new_end + index)));
    script
}

/// One unified hunk.
#[derive(Debug, Eq, PartialEq)]
struct Hunk {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    lines: Vec<String>,
}

impl Hunk {
    #[cfg(test)]
    fn header(&self) -> String {
        format!(
            "@@ -{},{} +{},{} @@",
            self.old_start, self.old_lines, self.new_start, self.new_lines
        )
    }

    fn to_json(&self) -> Value {
        json!({
            "oldStart": self.old_start,
            "oldLines": self.old_lines,
            "newStart": self.new_start,
            "newLines": self.new_lines,
            "lines": self.lines,
        })
    }
}

/// The lines of a text, each with its line break.
fn lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

/// A line of a hunk: its sign, its text without the line break, and the
/// marker of a missing final line break.
fn push_line(out: &mut Vec<String>, sign: char, line: &str) {
    match line.strip_suffix('\n') {
        Some(text) => out.push(format!("{sign}{text}")),
        None => {
            out.push(format!("{sign}{line}"));
            out.push(NO_NEWLINE.to_owned());
        }
    }
}

/// Unified hunks of two texts, and the lines added and removed.
fn hunks(old: &str, new: &str) -> (Vec<Hunk>, usize, usize) {
    let (old_lines, new_lines) = (lines(old), lines(new));
    let script = edits(&old_lines, &new_lines);
    let changes: Vec<usize> = script
        .iter()
        .enumerate()
        .filter(|(_, edit)| !matches!(edit, Edit::Equal(..)))
        .map(|(index, _)| index)
        .collect();
    let (mut additions, mut deletions) = (0, 0);
    let mut out = Vec::new();
    let mut index = 0;
    while index < changes.len() {
        // A hunk spans changes closer than twice the context.
        let first = changes[index];
        let mut last = first;
        while index + 1 < changes.len() && changes[index + 1] - last <= 2 * CONTEXT + 1 {
            index += 1;
            last = changes[index];
        }
        index += 1;
        let start = first.saturating_sub(CONTEXT);
        let end = (last + CONTEXT + 1).min(script.len());
        let (mut old_count, mut new_count) = (0, 0);
        let mut text = Vec::new();
        for edit in &script[start..end] {
            match *edit {
                Edit::Equal(a, _) => {
                    push_line(&mut text, ' ', old_lines[a]);
                    old_count += 1;
                    new_count += 1;
                }
                Edit::Delete(a) => {
                    push_line(&mut text, '-', old_lines[a]);
                    old_count += 1;
                    deletions += 1;
                }
                Edit::Insert(b) => {
                    push_line(&mut text, '+', new_lines[b]);
                    new_count += 1;
                    additions += 1;
                }
            }
        }
        // Where the hunk starts in each file: the first line it shows, or
        // the line before it when it shows none.
        let position =
            |pick: fn(&Edit) -> Option<usize>| script[..start].iter().filter_map(pick).count();
        let old_before = position(|edit| match edit {
            Edit::Equal(a, _) | Edit::Delete(a) => Some(*a),
            Edit::Insert(_) => None,
        });
        let new_before = position(|edit| match edit {
            Edit::Equal(_, b) | Edit::Insert(b) => Some(*b),
            Edit::Delete(_) => None,
        });
        out.push(Hunk {
            old_start: if old_count == 0 {
                old_before
            } else {
                old_before + 1
            },
            old_lines: old_count,
            new_start: if new_count == 0 {
                new_before
            } else {
                new_before + 1
            },
            new_lines: new_count,
            lines: text,
        });
    }
    (out, additions, deletions)
}

fn text_of(bytes: &[u8]) -> Option<&str> {
    std::str::from_utf8(bytes)
        .ok()
        .filter(|text| !text.contains('\0'))
}

/// One changed file.
fn file_json(path: &str, old: Option<&[u8]>, new: Option<&[u8]>) -> Value {
    let status = match (old, new) {
        (None, _) => "added",
        (_, None) => "removed",
        _ => "modified",
    };
    let digest = |bytes: Option<&[u8]>| bytes.map(|bytes| hex(&sha256(bytes)));
    let texts = (old.map_or(Some(""), text_of), new.map_or(Some(""), text_of));
    let (binary, hunks, additions, deletions) = match texts {
        (Some(old), Some(new)) => {
            let (hunks, additions, deletions) = hunks(old, new);
            (false, hunks, additions, deletions)
        }
        _ => (true, Vec::new(), 0, 0),
    };
    json!({
        "path": path,
        "status": status,
        "binary": binary,
        "oldSha256": digest(old),
        "newSha256": digest(new),
        "additions": additions,
        "deletions": deletions,
        "hunks": hunks.iter().map(Hunk::to_json).collect::<Vec<_>>(),
    })
}

fn manifest(tree: &Tree) -> Option<Manifest> {
    validate_manifest(tree.files.get("manifest.json")?).ok()
}

fn side_json(tree: &Tree, manifest: Option<&Manifest>) -> Value {
    let mut value = tree.summary_json();
    value["id"] = json!(manifest.map(|manifest| manifest.id.clone()));
    value["version"] = json!(manifest.map(|manifest| manifest.version.to_string()));
    value
}

/// The comparison of two trees, as JSON.
pub fn compare(old: &Tree, new: &Tree) -> Value {
    let paths: BTreeSet<&String> = old.files.keys().chain(new.files.keys()).collect();
    let files: Vec<Value> = paths
        .into_iter()
        .filter_map(|path| {
            let (before, after) = (
                old.files.get(path).map(Vec::as_slice),
                new.files.get(path).map(Vec::as_slice),
            );
            (before != after).then(|| file_json(path, before, after))
        })
        .collect();
    let count = |status: &str| files.iter().filter(|file| file["status"] == status).count();
    let sum = |field: &str| {
        files
            .iter()
            .map(|file| file[field].as_u64().unwrap_or_default())
            .sum::<u64>()
    };
    let (old_manifest, new_manifest) = (manifest(old), manifest(new));
    let permissions = match (&old_manifest, &new_manifest) {
        (Some(before), Some(after)) => permissions::compare(before, after).to_json(),
        _ => Value::Null,
    };
    json!({
        "formatVersion": FORMAT_VERSION,
        "compared": true,
        "old": side_json(old, old_manifest.as_ref()),
        "new": side_json(new, new_manifest.as_ref()),
        "files": files,
        "totals": {
            "added": count("added"),
            "modified": count("modified"),
            "removed": count("removed"),
            "additions": sum("additions"),
            "deletions": sum("deletions"),
        },
        "permissions": permissions,
        "diagnostics": [],
    })
}

/// The human form of [`compare`]'s output; every line from the sources
/// goes through `sanitize::line`.
pub fn render_human(value: &Value) -> String {
    let mut out = String::new();
    let text = |value: &Value| sanitize::line(value.as_str().unwrap_or_default());
    for file in value["files"].as_array().into_iter().flatten() {
        let path = text(&file["path"]);
        let status = file["status"].as_str().unwrap_or_default();
        if file["binary"] == true {
            out.push_str(&format!("Binary file {path} {status}\n"));
            continue;
        }
        let (before, after) = match status {
            "added" => ("/dev/null".to_owned(), format!("b/{path}")),
            "removed" => (format!("a/{path}"), "/dev/null".to_owned()),
            _ => (format!("a/{path}"), format!("b/{path}")),
        };
        out.push_str(&format!("--- {before}\n+++ {after}\n"));
        for hunk in file["hunks"].as_array().into_iter().flatten() {
            out.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                hunk["oldStart"], hunk["oldLines"], hunk["newStart"], hunk["newLines"]
            ));
            for line in hunk["lines"].as_array().into_iter().flatten() {
                out.push_str(&text(line));
                out.push('\n');
            }
        }
    }
    let totals = &value["totals"];
    out.push_str(&format!(
        "{} added, {} modified, {} removed; +{} -{} lines\n",
        totals["added"],
        totals["modified"],
        totals["removed"],
        totals["additions"],
        totals["deletions"]
    ));
    let permissions = &value["permissions"];
    if permissions.is_null() {
        out.push_str("permissions: not compared (a manifest is missing or invalid)\n");
    } else {
        let keys = |field: &str| {
            permissions[field]
                .as_array()
                .into_iter()
                .flatten()
                .map(|key| text(key))
                .collect::<Vec<_>>()
        };
        for (field, label) in [
            ("added", "new"),
            ("changed", "widened"),
            ("removed", "removed"),
        ] {
            for key in keys(field) {
                out.push_str(&format!("permission {label}: {key}\n"));
            }
        }
        out.push_str(&format!("review: {}\n", text(&permissions["reviewType"])));
    }
    out
}

/// Runs `diff`: 0 when both sides were read (whether or not they differ),
/// 1 when a side is refused.
pub fn run(old: &Input, new: &Input, format: Format) -> ExitCode {
    let mut report = Report::default();
    let old_tree = sourcetree::read(old, &mut report);
    let new_tree = sourcetree::read(new, &mut report);
    let (Some(old_tree), Some(new_tree)) = (old_tree, new_tree) else {
        match format {
            Format::Json => {
                let diagnostics: Vec<Value> = report
                    .diagnostics
                    .iter()
                    .map(|diagnostic| {
                        serde_json::from_str(&diagnostic.to_json()).unwrap_or(Value::Null)
                    })
                    .collect();
                let value = json!({
                    "formatVersion": FORMAT_VERSION,
                    "compared": false,
                    "diagnostics": diagnostics,
                });
                println!("{}", sanitize::json(&value.to_string()));
            }
            Format::Human => {
                emit(&report, None, format, false, "diff");
            }
        }
        return ExitCode::from(1);
    };
    let value = compare(&old_tree, &new_tree);
    let mut stdout = std::io::stdout().lock();
    let _ = match format {
        Format::Json => writeln!(stdout, "{}", sanitize::json(&value.to_string())),
        Format::Human => write!(stdout, "{}", render_human(&value)),
    };
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(text: &str) -> Vec<u32> {
        text.bytes().map(u32::from).collect()
    }

    fn apply(old: &[u32], new: &[u32], script: &[Edit]) -> Vec<u32> {
        let mut out = Vec::new();
        for edit in script {
            match *edit {
                Edit::Equal(a, b) => {
                    assert_eq!(old[a], new[b]);
                    out.push(old[a]);
                }
                Edit::Insert(b) => out.push(new[b]),
                Edit::Delete(_) => {}
            }
        }
        out
    }

    #[test]
    fn myers_finds_the_shortest_script() {
        for (old, new, cost) in [
            ("abcabba", "cbabac", 5),
            ("", "abc", 3),
            ("abc", "", 3),
            ("abc", "abc", 0),
            ("abcd", "abxd", 2),
        ] {
            let (old, new) = (ids(old), ids(new));
            let script = myers(&old, &new).unwrap();
            assert_eq!(apply(&old, &new, &script), new);
            let edits = script
                .iter()
                .filter(|edit| !matches!(edit, Edit::Equal(..)))
                .count();
            assert_eq!(edits, cost);
        }
    }

    #[test]
    fn hunks_are_unified_with_three_lines_of_context() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n";
        let new = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n";
        let (found, additions, deletions) = hunks(old, new);
        assert_eq!((additions, deletions), (2, 1));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].header(), "@@ -2,7 +2,7 @@");
        assert_eq!(
            found[0].lines,
            [" 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"]
        );
        assert_eq!(found[1].header(), "@@ -13,3 +13,4 @@");
        assert_eq!(found[1].lines.last().unwrap(), "+16");
    }

    #[test]
    fn missing_final_newlines_and_line_endings_are_changes() {
        let (found, ..) = hunks("a\nb", "a\nb\n");
        assert_eq!(found[0].lines, [" a", "-b", NO_NEWLINE, "+b"]);
        let (found, additions, deletions) = hunks("a\r\nb\n", "a\nb\n");
        assert_eq!((additions, deletions), (1, 1));
        assert_eq!(found[0].lines[0], "-a\r");
    }

    #[test]
    fn added_and_removed_files_start_at_zero() {
        let (found, additions, _) = hunks("", "x\ny\n");
        assert_eq!(additions, 2);
        assert_eq!(found[0].header(), "@@ -0,0 +1,2 @@");
        let (found, _, deletions) = hunks("x\n", "");
        assert_eq!(deletions, 1);
        assert_eq!(found[0].header(), "@@ -1,1 +0,0 @@");
    }

    #[test]
    fn large_rewrites_stay_bounded() {
        let old: String = (0..5000).map(|index| format!("{index}\n")).collect();
        let new: String = (0..5000)
            .map(|index| format!("{}\n", index * 7 + 1))
            .collect();
        let (_, additions, deletions) = hunks(&old, &new);
        assert!(additions <= 5000 && deletions <= 5000);
        assert!(additions + deletions >= 2 * 4000);
    }

    #[test]
    fn binary_files_show_digests_only() {
        let value = file_json("assets/a.png", Some(b"\x89PNG\0a"), Some(b"\x89PNG\0b"));
        assert_eq!(value["binary"], true);
        assert_eq!(value["hunks"], json!([]));
        assert_eq!(value["status"], "modified");
        assert!(value["oldSha256"].is_string() && value["newSha256"].is_string());
    }

    #[test]
    fn the_comparison_is_stable_and_lists_files_by_path() {
        let mut old = Tree::default();
        let mut new = Tree::default();
        old.files.insert("b.ts".into(), b"1\n".to_vec());
        old.files.insert("a.ts".into(), b"same\n".to_vec());
        old.files.insert("gone.ts".into(), b"x\n".to_vec());
        new.files.insert("b.ts".into(), b"2\n".to_vec());
        new.files.insert("a.ts".into(), b"same\n".to_vec());
        new.files.insert("c.ts".into(), b"new\n".to_vec());
        let first = compare(&old, &new);
        assert_eq!(first, compare(&old, &new));
        let paths: Vec<&str> = first["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, ["b.ts", "c.ts", "gone.ts"]);
        assert_eq!(first["totals"]["added"], 1);
        assert_eq!(first["totals"]["removed"], 1);
        assert_eq!(first["totals"]["modified"], 1);
        assert_eq!(first["permissions"], Value::Null);
        let human = render_human(&first);
        assert!(
            human.contains("--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,1 @@\n-1\n+2\n"),
            "{human}"
        );
        assert!(human.contains("--- /dev/null\n+++ b/c.ts\n"), "{human}");
    }

    #[test]
    fn hostile_lines_reach_the_terminal_escaped() {
        let mut old = Tree::default();
        let mut new = Tree::default();
        old.files.insert("logic.ts".into(), b"a\n".to_vec());
        new.files.insert(
            "logic.ts".into(),
            "a\n\u{1b}]52;c;x\u{7}\u{202e}\n".as_bytes().to_vec(),
        );
        let human = render_human(&compare(&old, &new));
        assert!(
            !human.contains('\u{1b}') && !human.contains('\u{202e}'),
            "{human}"
        );
    }
}
