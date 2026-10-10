//! `admit` end to end through the binary: the verdict, the JSON report, the
//! admission bundle, the reserved IDs, the listing and license rules, the
//! reproducible `view.json`, the permission review and the sanitized
//! output.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{Value, json};

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

fn listing(license: &str) -> Value {
    json!({
        "author": "Example",
        "spdxLicense": license,
        "sourceUrl": "https://github.com/example/counter",
        "defaultLocale": "en",
        "localizations": [{"locale": "en", "name": "Counter", "description": "Counts."}]
    })
}

/// A counter project with `id` and a listing under `license`.
fn project(id: &str, license: &str) -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = temporary.path().join("widget");
    let output = cli(&[
        "init",
        path(&root),
        "--template",
        "counter",
        "--id",
        "nova.counter",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    // `init` refuses the reserved IDs; a PlayerVox widget sets its own.
    edit_manifest(&root, |manifest| manifest["id"] = json!(id));
    write_listing(&root, &listing(license));
    (temporary, root)
}

fn write_listing(root: &Path, listing: &Value) {
    fs::write(root.join("listing.json"), listing.to_string()).expect("listing");
}

fn edit_manifest(root: &Path, edit: impl FnOnce(&mut Value)) {
    let file = root.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(&file).expect("manifest")).expect("JSON manifest");
    edit(&mut manifest);
    fs::write(file, manifest.to_string()).expect("manifest");
}

fn admit_json(args: &[&str]) -> (Output, Value) {
    let mut all = vec!["admit"];
    all.extend_from_slice(args);
    all.extend_from_slice(&["--format", "json"]);
    let output = cli(&all);
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("one JSON report: {}", text(&output.stdout)));
    (output, report)
}

fn codes(report: &Value) -> Vec<String> {
    report["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .map(|diagnostic| diagnostic["code"].as_str().expect("code").to_owned())
        .collect()
}

#[test]
fn a_third_party_submission_is_admitted_with_a_bundle_equal_to_package() {
    let (temporary, root) = project("nova.counter", "MIT");
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["admitted"], true);
    assert_eq!(report["formatVersion"], 1);
    assert_eq!(report["publisher"], "nova");
    assert_eq!(report["id"], "nova.counter");
    assert_eq!(report["reservedId"], false);
    assert_eq!(report["listing"]["spdxLicense"], "MIT");
    assert_eq!(report["review"], json!([]));

    let packaged = temporary.path().join("counter.ocpkg");
    let output = cli(&[
        "package",
        path(&root),
        "--out",
        path(&packaged),
        "--no-typecheck",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let bundle = temporary.path().join("bundle");
    let output = cli(&[
        "admit",
        path(&root),
        "--publisher",
        "nova",
        "--package",
        path(&packaged),
        "--out",
        path(&bundle),
    ]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    assert!(text(&output.stdout).contains("view.json reproduced from view.ocml"));
    assert_eq!(
        fs::read(bundle.join("package.ocpkg")).expect("bundle package"),
        fs::read(&packaged).expect("package")
    );
    assert_eq!(
        fs::read(bundle.join("listing.json")).expect("bundle listing"),
        fs::read(root.join("listing.json")).expect("listing")
    );
    let stored: Value =
        serde_json::from_slice(&fs::read(bundle.join("report.json")).expect("report"))
            .expect("JSON report");
    assert_eq!(stored["reproducible"]["viewJson"], true);
    assert_eq!(stored["reproducible"]["archive"], true);

    // A bundle never overwrites another one.
    let output = cli(&[
        "admit",
        path(&root),
        "--publisher",
        "nova",
        "--out",
        path(&bundle),
    ]);
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn reserved_ids_are_for_playervox_under_mit_only() {
    let (_temporary, root) = project("com.playervox.overcrow.counter", "MIT");
    let (output, report) = admit_json(&[path(&root)]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(report["admitted"], false);
    assert!(codes(&report).contains(&"admission.reserved_id".to_owned()));

    let (output, report) = admit_json(&[path(&root), "--publisher", "playervox"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["publisher"], "playervox");
    assert_eq!(report["reservedId"], true);

    write_listing(&root, &listing("Apache-2.0"));
    let (output, report) = admit_json(&[path(&root), "--publisher", "playervox"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(codes(&report), ["admission.license"]);

    // Another publisher does not own it; a handle outside the grammar is
    // a usage error.
    let (output, report) = admit_json(&[path(&root), "--publisher", "someone"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(codes(&report).contains(&"admission.reserved_id".to_owned()));
    let output = cli(&["admit", path(&root), "--publisher", "Some_One"]);
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn a_missing_or_invalid_listing_is_refused() {
    let (_temporary, root) = project("nova.counter", "MIT");
    let mut invalid = listing("MIT");
    invalid["sourceUrl"] = json!("http://example.com/counter");
    write_listing(&root, &invalid);
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(codes(&report), ["admission.listing"]);

    fs::write(root.join("listing.json"), "{\"author\":1,\"author\":2}").expect("listing");
    let (_, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(codes(&report), ["admission.listing"]);

    fs::remove_file(root.join("listing.json")).expect("remove listing");
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(codes(&report), ["admission.listing_missing"]);
}

/// The creator space keeps the listing itself: its builder admits the
/// sources with `--listing optional`, where `listing.json` is only an
/// import proposal.
#[test]
fn an_optional_listing_may_be_absent() {
    let (temporary, root) = project("nova.counter", "MIT");
    fs::remove_file(root.join("listing.json")).expect("remove listing");
    let bundle = temporary.path().join("bundle");
    let (output, report) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--listing",
        "optional",
        "--out",
        path(&bundle),
    ]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["admitted"], true);
    assert_eq!(report["listing"], Value::Null);
    assert_eq!(report["listingPolicy"], "optional");
    assert_eq!(codes(&report), Vec::<String>::new());
    assert!(bundle.join("package.ocpkg").is_file());
    assert!(!bundle.join("listing.json").exists(), "no empty listing");
}

#[test]
fn an_invalid_optional_listing_is_a_warning() {
    let (temporary, root) = project("nova.counter", "MIT");
    let mut invalid = listing("MIT");
    invalid["sourceUrl"] = json!("http://example.com/counter");
    invalid["preview"] = json!("assets/missing.png");
    write_listing(&root, &invalid);
    let bundle = temporary.path().join("bundle");
    let (output, report) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--listing",
        "optional",
        "--out",
        path(&bundle),
    ]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(codes(&report), ["admission.listing"]);
    assert_eq!(report["diagnostics"][0]["severity"], "warning");
    assert_eq!(report["listing"], Value::Null);
    assert!(!bundle.join("listing.json").exists());
    // A valid listing with a bad preview: the preview is a warning too,
    // and the listing is left out.
    let mut bad_preview = listing("MIT");
    bad_preview["preview"] = json!("assets/missing.png");
    write_listing(&root, &bad_preview);
    let (output, report) =
        admit_json(&[path(&root), "--publisher", "nova", "--listing", "optional"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(codes(&report), ["admission.preview"]);
    assert_eq!(report["diagnostics"][0]["severity"], "warning");
    assert_eq!(report["listing"], Value::Null);
    // Warnings refuse with --deny-warnings, as always.
    let (output, _) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--listing",
        "optional",
        "--deny-warnings",
    ]);
    assert_eq!(output.status.code(), Some(1));
    // A valid one is kept, in the report and the bundle.
    write_listing(&root, &listing("MIT"));
    let kept = temporary.path().join("kept");
    let (output, report) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--listing",
        "optional",
        "--out",
        path(&kept),
    ]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["listing"]["spdxLicense"], "MIT");
    assert!(kept.join("listing.json").is_file());
}

#[test]
fn a_required_listing_is_the_default() {
    let (_temporary, root) = project("nova.counter", "MIT");
    let (_, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(report["listingPolicy"], "required");
    fs::remove_file(root.join("listing.json")).expect("remove listing");
    for extra in [&[][..], &["--listing", "required"][..]] {
        let mut args = vec![path(&root), "--publisher", "nova"];
        args.extend_from_slice(extra);
        let (output, report) = admit_json(&args);
        assert_eq!(output.status.code(), Some(1), "{extra:?}");
        assert_eq!(codes(&report), ["admission.listing_missing"]);
        assert_eq!(report["diagnostics"][0]["severity"], "error");
    }
    // The policy words are for sources; a package takes a listing file.
    let output = cli(&["admit", path(&root), "--listing", "sometimes"]);
    assert_eq!(output.status.code(), Some(2));
    let package = root.join("missing.ocpkg");
    fs::write(&package, b"not a package").expect("file");
    let output = cli(&["admit", path(&package), "--listing", "optional"]);
    assert_eq!(output.status.code(), Some(2), "{}", text(&output.stderr));
}

#[test]
fn the_preview_must_be_a_packaged_png() {
    let (_temporary, root) = project("nova.counter", "MIT");
    let mut with_preview = listing("MIT");
    with_preview["preview"] = json!("assets/preview.png");
    write_listing(&root, &with_preview);
    let (_, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(codes(&report), ["admission.preview"]);

    fs::create_dir_all(root.join("assets")).expect("assets");
    let mut png = Vec::new();
    image::RgbaImage::new(2, 1)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("PNG");
    fs::write(root.join("assets/preview.png"), png).expect("preview");
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["listing"]["preview"], "assets/preview.png");
}

#[test]
fn a_submitted_view_must_be_what_view_ocml_compiles_to() {
    let (temporary, root) = project("nova.counter", "MIT");
    let submitted = temporary.path().join("submitted.ocpkg");
    let output = cli(&[
        "package",
        path(&root),
        "--out",
        path(&submitted),
        "--no-typecheck",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));

    // Only logic.ts changes: the view is reproduced, the archive is rebuilt.
    let logic = root.join("logic.ts");
    let source = fs::read_to_string(&logic).expect("logic");
    let changed = source.replacen("state.count += 1", "state.count += 2", 1);
    assert_ne!(changed, source, "the template increments by one");
    fs::write(&logic, changed).expect("logic");
    let (output, report) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--package",
        path(&submitted),
    ]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["reproducible"]["viewJson"], true);
    assert_eq!(codes(&report), ["admission.package_rebuilt"]);

    // The view source differs from the submitted view.json.
    let view = root.join("view.ocml");
    let source = fs::read_to_string(&view).expect("view");
    let changed = source.replacen("<icon name=\"minus\"/>", "<icon name=\"plus\"/>", 1);
    assert_ne!(changed, source, "the template view has a minus icon");
    fs::write(&view, changed).expect("view");
    let (output, report) = admit_json(&[
        path(&root),
        "--publisher",
        "nova",
        "--package",
        path(&submitted),
    ]);
    assert_eq!(output.status.code(), Some(1), "{report}");
    assert_eq!(report["reproducible"]["viewJson"], false);
    assert!(codes(&report).contains(&"admission.view_not_reproducible".to_owned()));
}

#[test]
fn the_review_lists_every_requested_authority() {
    let (_temporary, root) = project("nova.counter", "MIT");
    edit_manifest(&root, |manifest| {
        manifest["permissions"] = json!({
            "network": [{"origin": "https://api.example.com", "method": "GET", "path": "/v1/count"}],
            "storage": true,
            "clipboardWrite": true,
            "gameEvents": ["overcrow.game.match.started.v1"],
            "capabilities": ["fps.read"]
        });
    });
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    let kinds: Vec<&str> = report["review"]
        .as_array()
        .expect("review")
        .iter()
        .map(|item| item["kind"].as_str().expect("kind"))
        .collect();
    assert_eq!(
        kinds,
        [
            "capability",
            "network",
            "clipboardWrite",
            "storage",
            "gameEvent"
        ]
    );
    assert_eq!(report["review"][1]["origin"], "https://api.example.com");
    assert_eq!(report["review"][1]["maxResponseBytes"], 1_048_576);

    // A declared response bound is shown to the reviewer.
    edit_manifest(&root, |manifest| {
        manifest["permissions"] = json!({"network": [{
            "origin": "https://api.example.com", "method": "GET", "path": "/v1/count",
            "maxResponseBytes": 3_145_728
        }]});
    });
    let (output, report) = admit_json(&[path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["review"][0]["maxResponseBytes"], 3_145_728);
    let output = cli(&["admit", path(&root), "--publisher", "nova"]);
    let shown = text(&output.stdout);
    assert!(
        shown.contains("/v1/count, responses up to 3145728 bytes"),
        "{shown}"
    );

    // A sensitive capability keeps storage for the process lifetime only.
    edit_manifest(&root, |manifest| {
        manifest["permissions"] = json!({"storage": true, "capabilities": ["media.read"]});
    });
    let output = cli(&["admit", path(&root), "--publisher", "nova"]);
    assert_eq!(output.status.code(), Some(0), "{}", text(&output.stderr));
    let shown = text(&output.stdout);
    assert!(shown.contains("media.read [SENSITIVE"), "{shown}");
    assert!(shown.contains("process lifetime only"), "{shown}");
}

#[test]
fn package_text_never_reaches_the_terminal_raw() {
    let (_temporary, root) = project("nova.counter", "MIT");
    let mut hostile = listing("MIT");
    hostile["author"] = json!("Mallory \u{202e}gnp.exe");
    write_listing(&root, &hostile);
    for format in ["human", "json"] {
        let output = cli(&[
            "admit",
            path(&root),
            "--publisher",
            "nova",
            "--format",
            format,
        ]);
        let shown = text(&output.stdout) + &text(&output.stderr);
        assert!(!shown.contains('\u{202e}'), "{format}: {shown}");
    }
}

#[test]
fn a_bare_archive_is_checked_but_not_rebuilt() {
    let (temporary, root) = project("nova.counter", "MIT");
    let archive = temporary.path().join("counter.ocpkg");
    let output = cli(&[
        "package",
        path(&root),
        "--out",
        path(&archive),
        "--no-typecheck",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let listing = root.join("listing.json");
    let (output, report) = admit_json(&[
        path(&archive),
        "--publisher",
        "nova",
        "--listing",
        path(&listing),
    ]);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(codes(&report), ["admission.not_rebuilt"]);
    let (output, _) = admit_json(&[
        path(&archive),
        "--publisher",
        "nova",
        "--listing",
        path(&listing),
        "--deny-warnings",
    ]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(cli(&["admit", path(&archive)]).status.code(), Some(2));

    fs::write(&archive, b"PK not a package").expect("archive");
    let (output, report) = admit_json(&[
        path(&archive),
        "--publisher",
        "nova",
        "--listing",
        path(&listing),
    ]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(report["id"], Value::Null);
}
