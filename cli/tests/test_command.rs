//! `overcrow-widget test` against a scripted runtime: the runtime's command
//! line, the comparison of images within the parity bounds, the diff and
//! actual images, `--update`, the neutralized widget text and the exit
//! codes. The real headless runtime is OverCrow's; it is not built here.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use image::{Rgba, RgbaImage};
use serde_json::{Value, json};

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .arg("test")
        .arg(root)
        .arg("--no-typecheck")
        .args(args)
        .output()
        .expect("the CLI runs")
}

/// A counter project with one scenario capturing `images`.
fn project(images: &[&str]) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path().join("widget");
    let status = Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(["init", root.to_str().unwrap(), "--template", "counter"])
        .output()
        .expect("init runs");
    assert!(status.status.success());
    fs::remove_dir_all(root.join("tests")).expect("template tests removed");
    fs::create_dir_all(root.join("tests")).expect("tests directory");
    let steps: Vec<Value> = images
        .iter()
        .map(|image| json!({"expect": {"image": image}}))
        .collect();
    let scenario = json!({"scenarioVersion": 1, "name": "main", "steps": steps});
    fs::write(root.join("tests/main.scenario.json"), scenario.to_string()).expect("scenario");
    (directory, root)
}

fn image(value: u8) -> RgbaImage {
    RgbaImage::from_pixel(20, 10, Rgba([value, 40, 60, 255]))
}

/// A runtime script answering `--version` with `interface`, and `run` with
/// `exit` after copying `actual.png` as each captured image and printing
/// `report.json`, both from `fake`. Each run is recorded in `runs`.
fn runtime(fake: &Path, interface: u32, exit: u8) -> PathBuf {
    let version = json!({
        "runtime": "9.9.9", "interface": interface, "apiVersion": 1,
        "scenarioVersions": [1], "os": "linux", "arch": "x86_64"
    });
    let script = format!(
        r#"#!/bin/sh
set -eu
if [ "$1" = "--version" ]; then
    printf '%s\n' '{version}'
    exit 0
fi
printf '%s\n' "$*" >> '{fake}/args'
out=
while [ "$#" -gt 0 ]; do
    case $1 in
        --out) out=$2; shift 2 ;;
        *) shift ;;
    esac
done
printf 'run\n' >> '{fake}/runs'
for name in $(cat '{fake}/images'); do
    cp '{fake}/actual.png' "$out/$name.png"
done
cat '{fake}/report.json'
printf 'sandbox refused\n' >&2
exit {exit}
"#,
        fake = fake.display()
    );
    let path = fake.join("runtime");
    fs::write(&path, script).expect("runtime script");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
    path
}

/// The report of a run capturing `images`, with `logs`.
fn report(fake: &Path, images: &[&str], logs: &[&str]) {
    let captures: Vec<Value> = images
        .iter()
        .enumerate()
        .map(|(step, name)| {
            json!({"name": name, "file": format!("{name}.png"), "width": 20, "height": 10, "step": step})
        })
        .collect();
    let logs: Vec<Value> = logs
        .iter()
        .map(|text| json!({"level": "info", "text": text}))
        .collect();
    let report = json!({
        "interface": 1, "scenario": "main", "runtime": "9.9.9", "containment": "full",
        "passed": logs.is_empty(), "captures": captures,
        "expectations": if logs.is_empty() { json!([]) } else {
            json!([{"step": 0, "kind": "text", "ok": false, "detail": "shown: [\"\u{1b}[2Jcleared\"]"}])
        },
        "calls": [], "logs": logs, "faults": [], "errors": [], "state": "running", "truncated": false
    });
    fs::write(fake.join("report.json"), report.to_string()).expect("report");
    fs::write(fake.join("images"), images.join("\n")).expect("images");
}

fn fake(value: u8) -> tempfile::TempDir {
    let fake = tempfile::tempdir().expect("fake runtime directory");
    image(value)
        .save(fake.path().join("actual.png"))
        .expect("actual image");
    fake
}

fn runs(fake: &Path) -> usize {
    fs::read_to_string(fake.join("runs")).map_or(0, |runs| runs.lines().count())
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn without_a_pinned_runtime_it_asks_for_one() {
    let (_directory, root) = project(&["start"]);
    let output = cli(&root, &[]);
    assert_eq!(output.status.code(), Some(2), "{}", stderr(&output));
    assert!(stderr(&output).contains("--runtime"), "{}", stderr(&output));
}

#[test]
fn update_records_then_the_same_images_pass() {
    let (_directory, root) = project(&["start"]);
    let fake = fake(100);
    report(fake.path(), &["start"], &[]);
    let runtime = runtime(fake.path(), 1, 0);
    let runtime = runtime.to_str().unwrap();
    // No reference yet: it fails and saves the actual image.
    let output = cli(&root, &["--runtime", runtime]);
    assert_eq!(output.status.code(), Some(1), "{}", stderr(&output));
    assert!(stderr(&output).contains("--update"));
    assert!(root.join("tests/output/main/start.actual.png").is_file());
    let output = cli(&root, &["--runtime", runtime, "--update"]);
    assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
    assert_eq!(
        fs::read(root.join("tests/reference/main/start.png")).unwrap(),
        fs::read(fake.path().join("actual.png")).unwrap()
    );
    let output = cli(&root, &["--runtime", runtime, "--format", "json"]);
    assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
    let lines: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).expect("JSON line"))
        .collect();
    assert_eq!(lines[0]["type"], "runtime");
    assert_eq!(lines[0]["pinned"], false);
    assert_eq!(lines[1]["images"][0]["status"], "same");
    assert_eq!(
        lines[2],
        json!({"type": "summary", "passed": 1, "failed": 0})
    );
}

#[test]
fn images_compare_within_the_parity_bounds_and_write_a_diff_beyond() {
    let (_directory, root) = project(&["start"]);
    fs::create_dir_all(root.join("tests/reference/main")).unwrap();
    image(100)
        .save(root.join("tests/reference/main/start.png"))
        .unwrap();
    // Two levels: within the schema's channel tolerance.
    let near = fake(102);
    report(near.path(), &["start"], &[]);
    let output = cli(
        &root,
        &["--runtime", runtime(near.path(), 1, 0).to_str().unwrap()],
    );
    assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
    assert!(!root.join("tests/output").exists());
    // Three levels on every pixel: beyond.
    let far = fake(103);
    report(far.path(), &["start"], &[]);
    let output = cli(
        &root,
        &[
            "--runtime",
            runtime(far.path(), 1, 0).to_str().unwrap(),
            "--format",
            "json",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stdout).unwrap();
    let scenario: Value = serde_json::from_str(text.lines().nth(1).unwrap()).unwrap();
    assert_eq!(scenario["images"][0]["status"], "different");
    assert_eq!(scenario["images"][0]["ppm"], 1_000_000);
    assert_eq!(scenario["images"][0]["maxDelta"], 3);
    let diff = image::open(root.join("tests/output/main/start.diff.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(diff.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
    assert!(root.join("tests/output/main/start.actual.png").is_file());
}

#[test]
fn widget_text_is_neutralized() {
    let (_directory, root) = project(&["start"]);
    fs::create_dir_all(root.join("tests/reference/main")).unwrap();
    image(100)
        .save(root.join("tests/reference/main/start.png"))
        .unwrap();
    let fake = fake(100);
    report(
        fake.path(),
        &["start"],
        &["\u{1b}]52;c;aGk=\u{7}clipboard", "\u{202e}txt.exe"],
    );
    let runtime = runtime(fake.path(), 1, 0);
    let output = cli(&root, &["--runtime", runtime.to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(1));
    let text = stderr(&output);
    for raw in ['\u{1b}', '\u{7}', '\u{202e}'] {
        assert!(!text.contains(raw), "{text:?}");
    }
    assert!(text.contains("\\u{1b}]52"), "{text}");
    assert!(text.contains("\\u{202e}txt.exe"), "{text}");
    let output = cli(
        &root,
        &["--runtime", runtime.to_str().unwrap(), "--format", "json"],
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(!stdout.contains('\u{1b}') && !stdout.contains('\u{202e}'));
}

#[test]
fn an_incompatible_runtime_or_scenario_never_runs() {
    let (_directory, root) = project(&["start"]);
    let fake = fake(100);
    report(fake.path(), &["start"], &[]);
    let output = cli(
        &root,
        &["--runtime", runtime(fake.path(), 2, 0).to_str().unwrap()],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("interface"));
    assert_eq!(runs(fake.path()), 0);
    // A scenario that does not pass its checks is a diagnostic.
    fs::write(
        root.join("tests/main.scenario.json"),
        r#"{"scenarioVersion": 1, "name": "main", "host": {"scale": 150}, "steps": [{"expect": {"state": "running"}}]}"#,
    )
    .unwrap();
    let output = cli(
        &root,
        &["--runtime", runtime(fake.path(), 1, 0).to_str().unwrap()],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("host.scale"),
        "{}",
        stderr(&output)
    );
    assert_eq!(runs(fake.path()), 0);
}

#[test]
fn an_unavailable_sandbox_stops_the_command() {
    let (_directory, root) = project(&["start"]);
    let fake = fake(100);
    report(fake.path(), &["start"], &[]);
    let output = cli(
        &root,
        &["--runtime", runtime(fake.path(), 1, 3).to_str().unwrap()],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("sandbox refused"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn every_template_has_an_example_scenario_and_its_references() {
    for template in ["blank", "counter", "list", "chart"] {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = directory.path().join("widget");
        let output = Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
            .args(["init", root.to_str().unwrap(), "--template", template])
            .args(["--name", "Zoé \"quoted\""])
            .output()
            .expect("init runs");
        assert!(output.status.success(), "{template}");
        let bytes = fs::read(root.join("tests/example.scenario.json")).expect("scenario");
        let scenario = overcrow_widget_scenario::parse(&bytes)
            .unwrap_or_else(|error| panic!("{template}: {error}"));
        let manifest = overcrow_widget_schema::manifest::validate_manifest(
            &fs::read(root.join("manifest.json")).unwrap(),
        )
        .expect("manifest");
        scenario
            .check_against(&manifest)
            .unwrap_or_else(|error| panic!("{template}: {error}"));
        for image in scenario.images() {
            let path = root.join(format!("tests/reference/example/{image}.png"));
            let decoded = image::open(&path)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
                .to_rgba8();
            assert!(decoded.width() > 0, "{template} {image}");
        }
        if template == "blank" {
            assert!(
                scenario.images().is_empty(),
                "blank's greeting shows the name"
            );
        }
    }
}

/// A scenario's images (`assets`) are checked in the project before any run
/// (no link, PNG or JPEG within the bounds), and the runtime gets the project
/// to read them from.
#[test]
fn scenario_images_are_checked_and_the_runtime_gets_the_project() {
    let (_directory, root) = project(&["start"]);
    fs::create_dir_all(root.join("tests/assets")).expect("assets directory");
    image(200)
        .save(root.join("tests/assets/cover.png"))
        .expect("cover");
    let scenario = |path: &str| {
        json!({"scenarioVersion": 1, "name": "main", "assets": {"cover": path},
               "steps": [{"expect": {"image": "start"}}]})
    };
    fs::write(
        root.join("tests/main.scenario.json"),
        scenario("tests/assets/cover.png").to_string(),
    )
    .expect("scenario");
    let fake = fake(100);
    report(fake.path(), &["start"], &[]);
    let runtime = runtime(fake.path(), 1, 0);
    let output = cli(&root, &["--runtime", runtime.to_str().unwrap(), "--update"]);
    assert!(output.status.success(), "{}", stderr(&output));
    let args = fs::read_to_string(fake.path().join("args")).expect("recorded arguments");
    assert!(
        args.contains(&format!("--project {}", root.display())),
        "{args}"
    );

    // A link, even to an image of the project, is refused before any run.
    std::os::unix::fs::symlink(
        root.join("tests/assets/cover.png"),
        root.join("tests/assets/link.png"),
    )
    .expect("link");
    fs::write(
        root.join("tests/main.scenario.json"),
        scenario("tests/assets/link.png").to_string(),
    )
    .expect("scenario");
    let before = runs(fake.path());
    let output = cli(&root, &["--runtime", runtime.to_str().unwrap()]);
    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("assets.cover"),
        "{}",
        stderr(&output)
    );
    assert_eq!(runs(fake.path()), before, "nothing ran");
}
