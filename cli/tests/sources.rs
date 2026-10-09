//! Source archives, code maps, permission comparisons and `diff`, end to
//! end through the binary: a ZIP admits to the same package as its folder,
//! hostile archives are refused without writing anything, the code map
//! stays out of the package, and two versions compare stably.
//!
//! `OVERCROW_UPDATE_GOLDEN=1 cargo test -p overcrow-widget-cli --test sources`
//! rewrites the golden outputs.

#[path = "../src/testzip.rs"]
mod zipwrite;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Value, json};
use zipwrite::Item;

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(args)
        .output()
        .expect("the CLI runs")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

fn path(path: &Path) -> &str {
    path.to_str().expect("UTF-8 path")
}

fn json_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("one JSON object: {}", text(&output.stdout)))
}

fn codes(report: &Value) -> Vec<String> {
    report["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .map(|diagnostic| diagnostic["code"].as_str().expect("code").to_owned())
        .collect()
}

fn golden(name: &str, actual: &str) {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo");
    let path = PathBuf::from(manifest).join("tests/golden").join(name);
    if std::env::var_os("OVERCROW_UPDATE_GOLDEN").is_some() {
        fs::write(&path, actual).expect("write golden");
        return;
    }
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
        .replace("\r\n", "\n");
    assert_eq!(
        actual, expected,
        "golden {name} differs; set OVERCROW_UPDATE_GOLDEN=1 to accept"
    );
}

/// A counter project of the publisher `nova`, with its listing.
fn project(parent: &Path) -> PathBuf {
    let root = parent.join("lol-timers");
    let output = cli(&[
        "init",
        path(&root),
        "--template",
        "counter",
        "--id",
        "nova.lol-timers",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let listing = json!({
        "author": "Nova",
        "spdxLicense": "MIT",
        "sourceUrl": "https://github.com/nova/lol-timers",
        "defaultLocale": "en",
        "localizations": [{"locale": "en", "name": "Timers", "description": "Counts."}]
    });
    fs::write(root.join("listing.json"), listing.to_string()).expect("listing");
    root
}

/// Every file under `root`, relative, `/`-separated, sorted.
fn files(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).expect("readable") {
            let entry = entry.expect("entry");
            let kind = entry.file_type().expect("type");
            if kind.is_dir() {
                stack.push(entry.path());
            } else {
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .expect("inside")
                    .to_path_buf();
                found.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    found
}

/// A ZIP of `root`'s files, under `prefix/` when given.
fn zip_of(root: &Path, prefix: Option<&str>, stored: bool) -> Vec<u8> {
    let mut items = Vec::new();
    if let Some(prefix) = prefix {
        items.push(Item::folder(&format!("{prefix}/")));
    }
    for file in files(root) {
        let name = match prefix {
            Some(prefix) => format!("{prefix}/{file}"),
            None => file.clone(),
        };
        let data = fs::read(root.join(&file)).expect("file");
        items.push(if stored {
            Item::stored(&name, &data)
        } else {
            Item::file(&name, &data).descriptor(true)
        });
    }
    zipwrite::archive(&items)
}

fn admit(target: &Path, extra: &[&str]) -> (Output, Value) {
    let mut args = vec!["admit", path(target), "--publisher", "nova"];
    args.extend_from_slice(extra);
    args.extend_from_slice(&["--format", "json"]);
    let output = cli(&args);
    let report = json_of(&output);
    (output, report)
}

#[test]
fn an_archive_admits_to_the_same_package_as_its_folder() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = project(temporary.path());
    // What a creator's folder also holds, never sent.
    fs::create_dir_all(root.join("node_modules/typescript")).expect("node_modules");
    fs::write(root.join("node_modules/typescript/package.json"), b"{}").expect("file");
    fs::write(root.join(".env"), b"TOKEN=secret").expect("file");

    let bundle = temporary.path().join("from-folder");
    let (output, report) = admit(&root, &["--out", path(&bundle)]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["sources"], Value::Null);
    let expected = fs::read(bundle.join("package.ocpkg")).expect("package");

    for (name, prefix, stored) in [
        ("plain.zip", None, true),
        ("deflated.zip", None, false),
        ("Finder.ZIP", Some("lol-timers"), false),
    ] {
        let archive = temporary.path().join(name);
        fs::write(&archive, zip_of(&root, prefix, stored)).expect("archive");
        let out = temporary.path().join(format!("bundle-{name}"));
        let (output, report) = admit(&archive, &["--out", path(&out)]);
        assert_eq!(output.status.code(), Some(0), "{name}: {report}");
        assert_eq!(
            fs::read(out.join("package.ocpkg")).expect("package"),
            expected,
            "{name}: byte for byte"
        );
        let sources = &report["sources"];
        assert_eq!(sources["kind"], "archive");
        assert_eq!(sources["prefix"], json!(prefix));
        let ignored: Vec<&str> = sources["ignored"]
            .as_array()
            .expect("ignored")
            .iter()
            .map(|item| item["path"].as_str().expect("path"))
            .collect();
        assert_eq!(ignored, [".env", ".gitignore", "node_modules/"], "{name}");
    }

    // The human report names the archive and what it left out.
    let archive = temporary.path().join("plain.zip");
    let output = cli(&["admit", path(&archive), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    let shown = text(&output.stdout);
    assert!(shown.contains("sources   archive,"), "{shown}");
    assert!(
        shown.contains("left out  .env, .gitignore, node_modules/"),
        "{shown}"
    );
    // A listing file is part of the archive, never given beside it.
    let output = cli(&["admit", path(&archive), "--listing", path(&archive)]);
    assert_eq!(output.status.code(), Some(2));
}

/// Runs `admit` on `archive` from an empty current folder, with an empty
/// temporary folder of its own; returns the report.
fn admit_hostile(sandbox: &Path, archive: &[u8]) -> (Option<i32>, Value) {
    let input = sandbox.join("in");
    let (temporary, current) = (sandbox.join("tmp"), sandbox.join("cwd"));
    for folder in [&input, &temporary, &current] {
        fs::create_dir_all(folder).expect("folder");
    }
    let zip = input.join("hostile.zip");
    fs::write(&zip, archive).expect("archive");
    let before = files(sandbox);
    let output = Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args([
            "admit",
            path(&zip),
            "--publisher",
            "nova",
            "--format",
            "json",
        ])
        .current_dir(&current)
        .env("TMPDIR", &temporary)
        .env("TMP", &temporary)
        .env("TEMP", &temporary)
        .output()
        .expect("the CLI runs");
    assert_eq!(files(sandbox), before, "nothing written anywhere");
    assert!(!sandbox.join("x").exists() && !sandbox.join("in/x").exists());
    (output.status.code(), json_of(&output))
}

#[test]
fn hostile_archives_are_refused_and_write_nothing() {
    let manifest = || Item::file("manifest.json", b"{}");
    let mut zip64 = zipwrite::archive(&[manifest()]);
    let end = zip64.len() - 22;
    zip64[end + 8..end + 12].copy_from_slice(&[0xff; 4]);
    let mut trailing = zipwrite::archive(&[manifest()]);
    trailing.extend(b"payload");
    let mut encrypted = Item::stored("logic.ts", b"x");
    encrypted.flags = 1;
    let mut lying = Item::file("logic.ts", &vec![b'a'; 64 << 10]);
    lying.declared_size = Some(1024);
    let many: Vec<Item> = (0..2001)
        .map(|index| Item::stored(&format!("f/{index}.txt"), b""))
        .collect();
    let mut huge = Item::file("big.bin", b"");
    huge.declared_size = Some(65 << 20);
    // 65 MiB that do compress like real files: 65 entries of 1 MiB.
    let block: Vec<u8> = (0..1 << 20).map(|index: u32| (index % 251) as u8).collect();
    let spread: Vec<Item> = (0..65)
        .map(|index| Item::file(&format!("data/{index}.bin"), &block))
        .collect();
    let corpus: Vec<(&str, Vec<u8>, &str)> = vec![
        (
            "parent",
            zipwrite::archive(&[manifest(), Item::stored("../x", b"x")]),
            "sources.unsafe_name",
        ),
        (
            "absolute",
            zipwrite::archive(&[Item::stored("/tmp/x", b"x")]),
            "sources.unsafe_name",
        ),
        (
            "backslash",
            zipwrite::archive(&[Item::stored("..\\x", b"x")]),
            "sources.unsafe_name",
        ),
        (
            "link",
            zipwrite::archive(&[
                manifest(),
                Item::stored("x", b"/etc/passwd").mode(0o120_777),
            ]),
            "sources.link",
        ),
        (
            "fifo",
            zipwrite::archive(&[Item::stored("x", b"").mode(0o010_644)]),
            "sources.special_file",
        ),
        (
            "2001 files",
            zipwrite::archive(&many),
            "sources.too_many_files",
        ),
        (
            "65 MiB declared",
            zipwrite::archive(&[huge]),
            "sources.too_large",
        ),
        (
            "65 MiB of files",
            zipwrite::archive(&spread),
            "sources.too_large",
        ),
        (
            "bomb",
            zipwrite::archive(&[Item::file("x.json", &vec![0; 4 << 20])]),
            "sources.bomb",
        ),
        (
            "lying size",
            zipwrite::archive(&[manifest(), lying]),
            "sources.bomb",
        ),
        (
            "duplicate",
            zipwrite::archive(&[manifest(), Item::stored("MANIFEST.JSON", b"{}")]),
            "sources.duplicate_name",
        ),
        (
            "encrypted",
            zipwrite::archive(&[encrypted]),
            "sources.encrypted",
        ),
        ("zip64", zip64, "sources.zip64"),
        (
            "comment",
            zipwrite::archive_with(&[manifest()], b"", b"", b"hello"),
            "sources.archive",
        ),
        ("trailing", trailing, "sources.archive"),
        (
            "hidden data",
            zipwrite::archive_with(&[manifest()], b"MZ", b"", b""),
            "sources.archive",
        ),
        ("too large", vec![0; (32 << 20) + 1], "sources.archive_size"),
    ];
    for (name, archive, code) in corpus {
        let sandbox = tempfile::tempdir().expect("sandbox");
        let (status, report) = admit_hostile(sandbox.path(), &archive);
        assert_eq!(status, Some(1), "{name}: {report}");
        assert_eq!(report["admitted"], false, "{name}");
        assert_eq!(codes(&report), [code], "{name}");
    }
}

#[test]
fn hostile_names_are_shown_escaped_and_never_read() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    fs::write(temporary.path().join("secret"), "TOPSECRET").expect("secret");
    let archive = temporary.path().join("in").join("hostile.zip");
    fs::create_dir_all(archive.parent().expect("parent")).expect("folder");
    for name in [
        "../secret",
        "logic\u{1b}]52;c;eA==\u{7}.ts",
        "x\u{202e}gnp.ts",
    ] {
        fs::write(&archive, zipwrite::archive(&[Item::stored(name, b"x")])).expect("archive");
        for format in ["human", "json"] {
            let output = cli(&["admit", path(&archive), "--format", format]);
            assert_eq!(output.status.code(), Some(1));
            let shown = text(&output.stdout) + &text(&output.stderr);
            assert!(shown.contains("sources.unsafe_name"), "{shown}");
            assert!(!shown.contains("TOPSECRET"), "{shown}");
            assert!(
                !shown.contains('\u{1b}') && !shown.contains('\u{202e}'),
                "{shown}"
            );
        }
    }
}

#[test]
fn the_code_map_is_written_beside_never_inside() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = project(temporary.path());
    let (plain, mapped, map) = (
        temporary.path().join("plain.ocpkg"),
        temporary.path().join("mapped.ocpkg"),
        temporary.path().join("logic.js.map"),
    );
    let output = cli(&[
        "package",
        path(&root),
        "--no-typecheck",
        "--out",
        path(&plain),
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let output = cli(&[
        "package",
        path(&root),
        "--no-typecheck",
        "--out",
        path(&mapped),
        "--source-map",
        path(&map),
        "--format",
        "json",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    assert_eq!(json_of(&output)["sourceMap"], path(&map));
    assert_eq!(
        fs::read(&plain).expect("plain"),
        fs::read(&mapped).expect("mapped")
    );
    let package = overcrow_widget_schema::package::read_package(&fs::read(&mapped).unwrap())
        .expect("a package");
    assert!(package.paths().all(|entry| !entry.ends_with(".map")));
    let logic = String::from_utf8(package.file("logic.js").unwrap().to_vec()).unwrap();
    assert!(!logic.contains("sourceMappingURL"));
    let value: Value = serde_json::from_slice(&fs::read(&map).expect("map")).expect("JSON map");
    assert_eq!(value["version"], 3);
    assert_eq!(value["file"], "logic.js");
    assert!(
        value["sources"]
            .as_array()
            .unwrap()
            .contains(&json!("logic.ts"))
    );

    // The archive of the same sources maps to the same bytes.
    let archive = temporary.path().join("lol-timers.zip");
    fs::write(&archive, zip_of(&root, None, false)).expect("archive");
    let from_zip = temporary.path().join("from-zip.map");
    let (output, report) = admit(&archive, &["--source-map", path(&from_zip)]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(
        fs::read(&from_zip).expect("map"),
        fs::read(&map).expect("map")
    );
    // A package alone has no sources to map.
    let output = cli(&[
        "admit",
        path(&plain),
        "--listing",
        path(&root.join("listing.json")),
        "--source-map",
        path(&from_zip),
    ]);
    assert_eq!(output.status.code(), Some(2));
}

fn edit_manifest(root: &Path, edit: impl FnOnce(&mut Value)) {
    let file = root.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&file).expect("manifest")).unwrap();
    edit(&mut manifest);
    fs::write(file, manifest.to_string()).expect("manifest");
}

#[test]
fn admit_lists_the_permissions_new_since_the_previous_version() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = project(temporary.path());
    let first = temporary.path().join("first");
    fs::create_dir_all(&first).expect("folder");
    let previous_package = first.join("lol-timers-0.1.0.ocpkg");
    let output = cli(&[
        "package",
        path(&root),
        "--no-typecheck",
        "--out",
        path(&previous_package),
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let previous_manifest = first.join("manifest.json");
    fs::copy(root.join("manifest.json"), &previous_manifest).expect("copy");
    let previous_zip = first.join("lol-timers-0.1.0.zip");
    fs::write(&previous_zip, zip_of(&root, None, true)).expect("archive");

    edit_manifest(&root, |manifest| {
        manifest["version"] = json!("0.2.0");
        manifest["permissions"] = json!({
            "network": [{"origin": "https://api.nova.gg", "method": "GET", "path": "/v1/timers"}],
            "storage": true
        });
    });
    for previous in [&previous_package, &previous_manifest, &previous_zip] {
        let (output, report) = admit(&root, &["--previous", path(previous)]);
        assert_eq!(output.status.code(), Some(0), "{report}");
        let permissions = &report["permissions"];
        assert_eq!(
            permissions["added"],
            json!(["network:GET https://api.nova.gg/v1/timers", "storage"])
        );
        assert_eq!(permissions["reviewType"], "full");
        assert_eq!(
            permissions["previous"],
            json!({"id": "nova.lol-timers", "version": "0.1.0"})
        );
    }
    let output = cli(&[
        "admit",
        path(&root),
        "--publisher",
        "nova",
        "--previous",
        path(&previous_zip),
    ]);
    let shown = text(&output.stdout);
    assert!(shown.contains("Permissions compared with 0.1.0"), "{shown}");
    assert!(
        shown.contains("new       network:GET https://api.nova.gg/v1/timers"),
        "{shown}"
    );
    assert!(shown.contains("review    full"), "{shown}");

    // Without a previous version, only the keys.
    let (_, report) = admit(&root, &[]);
    assert_eq!(report["permissions"]["reviewType"], Value::Null);
    assert_eq!(
        report["permissions"]["keys"],
        json!(["network:GET https://api.nova.gg/v1/timers", "storage"])
    );

    // Nothing new: a quick review.
    let second = root.join("manifest.json");
    let saved = temporary.path().join("v2.json");
    fs::copy(&second, &saved).expect("copy");
    edit_manifest(&root, |manifest| manifest["version"] = json!("0.3.0"));
    let (_, report) = admit(&root, &["--previous", path(&saved)]);
    assert_eq!(report["permissions"]["reviewType"], "quick");
    assert_eq!(report["permissions"]["added"], json!([]));

    // The same version again, or another widget.
    let (output, report) = admit(&root, &["--previous", path(&second)]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(codes(&report), ["admission.version_not_newer"]);
    edit_manifest(&root, |manifest| manifest["id"] = json!("nova.other"));
    let (output, report) = admit(&root, &["--previous", path(&saved)]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(codes(&report), ["admission.previous_mismatch"]);
}

#[test]
fn ids_follow_the_publisher_and_its_domains() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = project(temporary.path());
    let id_codes = |args: &[&str]| {
        let mut all = vec!["admit", path(&root), "--format", "json"];
        all.extend_from_slice(args);
        let output = cli(&all);
        (output.status.code(), codes(&json_of(&output)))
    };
    assert_eq!(id_codes(&["--publisher", "nova"]), (Some(0), vec![]));
    assert_eq!(
        id_codes(&["--publisher", "someone-else"]),
        (Some(1), vec!["admission.id_not_owned".to_owned()])
    );
    // Without a publisher, an example ID is refused.
    assert_eq!(
        id_codes(&[]),
        (Some(1), vec!["admission.placeholder_id".to_owned()])
    );
    edit_manifest(&root, |manifest| {
        manifest["id"] = json!("gg.nova.lol-timers")
    });
    assert_eq!(
        id_codes(&["--publisher", "nova", "--domain", "nova.gg"]),
        (Some(0), vec![])
    );
    assert_eq!(
        id_codes(&["--publisher", "nova"]),
        (Some(1), vec!["admission.id_not_owned".to_owned()])
    );
    edit_manifest(&root, |manifest| {
        manifest["id"] = json!("yourhandle.lol-timers")
    });
    assert_eq!(
        id_codes(&[]),
        (Some(1), vec!["admission.placeholder_id".to_owned()])
    );
    for usage in [
        &["--domain", "nova.gg"][..],
        &["--publisher", "Nova"],
        &["--publisher", "nova", "--domain", "localhost"],
    ] {
        let mut all = vec!["admit", path(&root)];
        all.extend_from_slice(usage);
        assert_eq!(cli(&all).status.code(), Some(2), "{usage:?}");
    }
}

/// Two versions of a small widget, written from fixed text.
fn versions(parent: &Path) -> (PathBuf, PathBuf) {
    let manifest = |version: &str, permissions: Value| {
        json!({
            "schemaVersion": 1,
            "apiVersion": 1,
            "id": "nova.lol-timers",
            "version": version,
            "name": {"en": "Timers", "fr": "Minuteurs"},
            "sizing": {
                "fit": "none",
                "preferred": {"width": 200, "height": 100},
                "min": {"width": 200, "height": 100},
                "max": {"width": 200, "height": 100}
            },
            "permissions": permissions
        })
        .to_string()
            + "\n"
    };
    let old = parent.join("v1");
    let new = parent.join("v2");
    for folder in [&old, &new] {
        fs::create_dir_all(folder.join("assets")).expect("folder");
    }
    fs::write(
        old.join("manifest.json"),
        manifest("1.0.0", json!({"storage": true})),
    )
    .unwrap();
    fs::write(
        new.join("manifest.json"),
        manifest(
            "1.1.0",
            json!({"storage": true, "network": [{"origin": "https://api.nova.gg", "method": "GET", "path": "/v1/timers"}]}),
        ),
    )
    .unwrap();
    fs::write(
        old.join("logic.ts"),
        "export function start() {\n  return 1;\n}\n\nexport function stop() {\n  return 0;\n}\n",
    )
    .unwrap();
    fs::write(
        new.join("logic.ts"),
        "export function start() {\n  return 2;\n}\n\nexport function stop() {\n  return 0;\n}\n\nexport function reset() {}",
    )
    .unwrap();
    fs::write(old.join("LICENSE"), "MIT\n").unwrap();
    fs::write(new.join("LICENSE"), "MIT\n").unwrap();
    fs::write(old.join("assets/old.png"), b"\x89PNG\0old").unwrap();
    fs::write(new.join("assets/new.png"), b"\x89PNG\0new").unwrap();
    fs::write(old.join("notes.md"), "Draft\n").unwrap();
    (old, new)
}

#[test]
fn diff_compares_two_versions_stably() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let (old, new) = versions(temporary.path());
    let output = cli(&["diff", path(&old), path(&new), "--format", "json"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    let value = json_of(&output);
    let again = cli(&["diff", path(&old), path(&new), "--format", "json"]);
    assert_eq!(output.stdout, again.stdout, "deterministic");
    let files: Vec<(&str, &str)> = value["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap(),
                file["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        files,
        [
            ("assets/new.png", "added"),
            ("assets/old.png", "removed"),
            ("logic.ts", "modified"),
            ("manifest.json", "modified"),
            ("notes.md", "removed"),
        ]
    );
    assert_eq!(
        value["permissions"],
        json!({"added": ["network:GET https://api.nova.gg/v1/timers"], "removed": [], "changed": [], "reviewType": "full"})
    );
    golden(
        "diff.json",
        &(serde_json::to_string_pretty(&value).unwrap() + "\n"),
    );
    let human = cli(&["diff", path(&old), path(&new)]);
    assert_eq!(human.status.code(), Some(0));
    golden("diff.txt", &text(&human.stdout));
}

#[test]
fn archive_and_folder_of_the_same_sources_do_not_differ() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let (old, _) = versions(temporary.path());
    let stored = temporary.path().join("stored.zip");
    let deflated = temporary.path().join("deflated.zip");
    fs::write(&stored, zip_of(&old, Some("v1"), true)).expect("archive");
    fs::write(&deflated, zip_of(&old, None, false)).expect("archive");
    for (left, right) in [(&old, &stored), (&stored, &deflated)] {
        let output = cli(&["diff", path(left), path(right), "--format", "json"]);
        assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
        let value = json_of(&output);
        assert_eq!(value["files"], json!([]), "{value}");
        assert_eq!(value["permissions"]["reviewType"], "quick");
    }
}

#[test]
fn diff_refuses_a_hostile_side_and_bad_usage() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let (old, _) = versions(temporary.path());
    let hostile = temporary.path().join("hostile.zip");
    fs::write(&hostile, zipwrite::archive(&[Item::stored("../x", b"x")])).expect("archive");
    let output = cli(&["diff", path(&old), path(&hostile), "--format", "json"]);
    assert_eq!(output.status.code(), Some(1));
    let value = json_of(&output);
    assert_eq!(value["compared"], false);
    assert_eq!(codes(&value), ["sources.unsafe_name"]);
    for args in [
        &["diff", path(&old)][..],
        &["diff", path(&old), path(&old), path(&old)],
        &["diff", path(&old), "no-such-folder"],
        &["diff", path(&old), path(&old), "--bogus"],
    ] {
        assert_eq!(cli(args).status.code(), Some(2), "{args:?}");
    }
    let names: BTreeSet<String> = files(temporary.path()).into_iter().collect();
    assert!(!names.contains("x"));
}
