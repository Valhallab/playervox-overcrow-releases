//! The reference widgets of `widgets/` that are widget API v1 projects (the
//! built-in pilots of P2.4 onwards): each checks without a warning,
//! packages reproducibly, and its scenarios are valid against its manifest,
//! with every reference image they capture and no other. Service contract:
//! every fixture and published value has the shape of its service's result
//! (`Service.returns`), and a value that loses a member is refused. The
//! scenarios themselves play in OverCrow's headless runtime
//! (`overcrow-widget test`), which hosted CI cannot run until the runtime
//! is pinned (docs/widget-testing.md).

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn repository() -> PathBuf {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo");
    PathBuf::from(manifest)
        .parent()
        .expect("cli/ is in the repository")
        .to_owned()
}

/// `widgets/<dir>` holding a `view.ocml`, sorted.
fn projects() -> Vec<PathBuf> {
    let mut projects: Vec<PathBuf> = fs::read_dir(repository().join("widgets"))
        .expect("widgets/")
        .map(|entry| entry.expect("entry").path())
        .filter(|path| path.join("view.ocml").is_file())
        .collect();
    projects.sort();
    projects
}

fn cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(args)
        .output()
        .expect("the CLI runs")
}

fn scenarios(project: &Path) -> Vec<(String, PathBuf)> {
    let mut found: Vec<(String, PathBuf)> = fs::read_dir(project.join("tests"))
        .expect("tests/")
        .map(|entry| entry.expect("entry").path())
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?.strip_suffix(".scenario.json")?;
            Some((name.to_owned(), path.clone()))
        })
        .collect();
    found.sort();
    found
}

#[test]
fn the_pilots_are_here() {
    let names: Vec<String> = projects()
        .iter()
        .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    for pilot in ["clock", "fps", "session", "stopwatch"] {
        assert!(names.iter().any(|name| name == pilot), "widgets/{pilot}");
    }
}

#[test]
fn each_reference_widget_checks_and_packages_reproducibly() {
    let work = tempfile::tempdir().expect("temporary directory");
    for project in projects() {
        let root = project.to_str().expect("UTF-8 path");
        let checked = cli(&["check", root, "--no-typecheck", "--deny-warnings"]);
        assert!(
            checked.status.success(),
            "{root}: {}",
            String::from_utf8_lossy(&checked.stderr)
        );
        let mut archives = Vec::new();
        for run in ["a", "b"] {
            let out = work.path().join(format!("{run}.ocpkg"));
            let packaged = cli(&[
                "package",
                root,
                "--no-typecheck",
                "--out",
                out.to_str().unwrap(),
            ]);
            assert!(packaged.status.success(), "{root}");
            archives.push(fs::read(&out).expect("package"));
        }
        assert_eq!(archives[0], archives[1], "{root}: reproducible");
        let package = overcrow_widget_schema::package::read_package(&archives[0])
            .unwrap_or_else(|error| panic!("{root}: {}", error.as_str()));
        assert!(package.manifest.has_reserved_id(), "{root}: a PlayerVox ID");
    }
}

#[test]
fn every_scenario_is_valid_with_exactly_its_reference_images() {
    for project in projects() {
        let manifest = overcrow_widget_schema::manifest::validate_manifest(
            &fs::read(project.join("manifest.json")).expect("manifest"),
        )
        .expect("valid manifest");
        let scenarios = scenarios(&project);
        assert!(!scenarios.is_empty(), "{}", project.display());
        let mut captured = BTreeSet::new();
        for (name, path) in &scenarios {
            let scenario = overcrow_widget_scenario::parse(&fs::read(path).expect("scenario"))
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            assert_eq!(
                &scenario.name,
                name,
                "{}: `name` is the file's",
                path.display()
            );
            scenario
                .check_against(&manifest)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            for image in scenario.images() {
                let file = project.join(format!("tests/reference/{name}/{image}.png"));
                let decoded = image::open(&file)
                    .unwrap_or_else(|error| panic!("{}: {error}", file.display()))
                    .to_rgba8();
                assert!(
                    decoded.width() > 0 && decoded.height() > 0,
                    "{}",
                    file.display()
                );
                captured.insert(format!("{name}/{image}.png"));
            }
        }
        let mut committed = BTreeSet::new();
        let reference = project.join("tests/reference");
        if reference.is_dir() {
            for directory in fs::read_dir(&reference).expect("reference/") {
                let directory = directory.expect("entry").path();
                let scenario = directory
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                for image in fs::read_dir(&directory).expect("scenario images") {
                    let image = image.expect("entry").path();
                    committed.insert(format!(
                        "{scenario}/{}",
                        image.file_name().unwrap().to_string_lossy()
                    ));
                }
            }
        }
        assert_eq!(
            committed,
            captured,
            "{}: no stale reference image",
            project.display()
        );
    }
}

/// Each object of `value` that loses one member, one variant per member.
fn without_one_member(value: &Value) -> Vec<Value> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    object
        .keys()
        .map(|key| {
            let mut smaller = object.clone();
            smaller.remove(key);
            Value::Object(smaller)
        })
        .collect()
}

#[test]
fn service_fixtures_follow_the_result_shapes() {
    let mut exercised = BTreeSet::new();
    for project in projects() {
        let manifest: Value =
            serde_json::from_slice(&fs::read(project.join("manifest.json")).expect("manifest"))
                .expect("JSON manifest");
        let capabilities: BTreeSet<String> = manifest["permissions"]["capabilities"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|name| name.as_str().map(str::to_owned))
            .collect();
        let mut answered = BTreeSet::new();
        for (_, path) in scenarios(&project) {
            let original: Value =
                serde_json::from_slice(&fs::read(&path).expect("scenario")).expect("JSON");
            // Initial subscription values.
            let subscriptions = original["fixtures"]["subscriptions"]
                .as_object()
                .cloned()
                .unwrap_or_default();
            for (service, value) in &subscriptions {
                answered.insert(service.clone());
                for broken in without_one_member(value) {
                    let mut scenario = original.clone();
                    scenario["fixtures"]["subscriptions"][service] = broken;
                    let error = overcrow_widget_scenario::parse(scenario.to_string().as_bytes())
                        .expect_err("a value without a member is refused");
                    assert!(
                        error.to_string().contains("shape"),
                        "{}: {error}",
                        path.display()
                    );
                }
            }
            // Published values.
            for (index, step) in original["steps"]
                .as_array()
                .expect("steps")
                .iter()
                .enumerate()
            {
                let Some(publish) = step.get("publish") else {
                    continue;
                };
                answered.insert(publish["service"].as_str().expect("service").to_owned());
                for broken in without_one_member(&publish["value"]) {
                    let mut scenario = original.clone();
                    scenario["steps"][index]["publish"]["value"] = broken;
                    let error = overcrow_widget_scenario::parse(scenario.to_string().as_bytes())
                        .expect_err("a value without a member is refused");
                    assert!(
                        error.to_string().contains("shape"),
                        "{} step {index}: {error}",
                        path.display()
                    );
                }
            }
        }
        // Each declared capability's subscription is answered somewhere.
        for capability in &capabilities {
            let family = capability.split('.').next().expect("family");
            assert!(
                answered
                    .iter()
                    .any(|service| service.starts_with(&format!("{family}."))),
                "{}: no scenario answers `{capability}`",
                project.display()
            );
            exercised.insert(capability.clone());
        }
    }
    for capability in [
        "session.read",
        "fps.read",
        "stopwatch.read",
        "stopwatch.control",
    ] {
        assert!(exercised.contains(capability), "{capability}");
    }
}
