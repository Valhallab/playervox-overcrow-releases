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
    for pilot in [
        "clock",
        "fps",
        "media",
        "performance",
        "playervox-journal",
        "playervox-rating",
        "playervox-score",
        "session",
        "stopwatch",
    ] {
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
            // Its fixture images are in the project, within the bounds.
            overcrow_widget_scenario::load_assets(&project, &scenario.assets)
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
        "telemetry.read",
        "stopwatch.read",
        "stopwatch.control",
        "media.read",
        "media.control",
        "playervox.score.read",
        "journal.read",
        "journal.delete",
        "playervox.rating.read",
        "playervox.rating.write",
    ] {
        assert!(exercised.contains(capability), "{capability}");
    }
}

/// The icon buttons of the reference widgets that have them: in every
/// reference image, each button (a 22 px square at 100 %, 33 px at 150 %)
/// has its icon's pixels centred on the button, within half a physical
/// pixel (P3.3: the icons were drawn 1–3 px right of centre, larger than
/// the button's content box).
#[test]
fn icon_buttons_centre_their_icons() {
    let mut checked = 0;
    for widget in ["media", "playervox-journal", "stopwatch"] {
        let reference = repository()
            .join("widgets")
            .join(widget)
            .join("tests/reference");
        for scenario in fs::read_dir(&reference).expect("reference/") {
            let scenario = scenario.expect("entry").path();
            for file in fs::read_dir(&scenario).expect("scenario images") {
                let file = file.expect("entry").path();
                let image = image::open(&file).expect("reference image").to_rgb8();
                for (dx, dy) in icon_offsets(&image) {
                    assert!(
                        dx.abs() <= 0.5 && dy.abs() <= 0.5,
                        "{}: icon off centre by ({dx}, {dy}) px",
                        file.display()
                    );
                    checked += 1;
                }
            }
        }
    }
    // The render scenarios alone hold 8 × 3 Media and 8 × 2 stopwatch
    // buttons: the detection is not vacuous.
    assert!(checked >= 40, "{checked} buttons checked");
}

/// For each icon button found in `image`, the offset in physical pixels of
/// its icon's pixel box centre from the button's centre. A button is a
/// 4-connected region that differs from the panel colour and is a square
/// of 22 or 33 px; its icon, the pixels far from the button's own fill
/// colour, away from its edge.
fn icon_offsets(image: &image::RgbImage) -> Vec<(f32, f32)> {
    let (width, height) = image.dimensions();
    let panel = image.get_pixel(1, 1).0;
    let distance = |a: [u8; 3], b: [u8; 3]| -> u32 {
        a.iter().zip(b).map(|(a, b)| u32::from(a.abs_diff(b))).sum()
    };
    let differs = |x: u32, y: u32| distance(image.get_pixel(x, y).0, panel) > 6;
    let mut seen = vec![false; (width * height) as usize];
    let mut offsets = Vec::new();
    for start_y in 0..height {
        for start_x in 0..width {
            let index = (start_y * width + start_x) as usize;
            if seen[index] || !differs(start_x, start_y) {
                continue;
            }
            seen[index] = true;
            let (mut x0, mut y0, mut x1, mut y1) = (start_x, start_y, start_x, start_y);
            let mut stack = vec![(start_x, start_y)];
            while let Some((x, y)) = stack.pop() {
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
                let neighbours = [
                    (x.wrapping_sub(1), y),
                    (x + 1, y),
                    (x, y.wrapping_sub(1)),
                    (x, y + 1),
                ];
                for (nx, ny) in neighbours {
                    if nx < width && ny < height {
                        let next = (ny * width + nx) as usize;
                        if !seen[next] && differs(nx, ny) {
                            seen[next] = true;
                            stack.push((nx, ny));
                        }
                    }
                }
            }
            let (side_x, side_y) = (x1 - x0 + 1, y1 - y0 + 1);
            let Some(scale) = [(22, 1.0_f32), (33, 1.5)]
                .into_iter()
                .find(|(side, _)| side_x == *side && side_y == *side)
                .map(|(_, scale)| scale)
            else {
                continue;
            };
            let edge = (2.0 * scale).round() as u32;
            let fill = image.get_pixel(x0 + edge, y0 + side_y / 2).0;
            let (mut ix0, mut iy0, mut ix1, mut iy1) = (u32::MAX, u32::MAX, 0, 0);
            for y in y0 + edge..=y1 - edge {
                for x in x0 + edge..=x1 - edge {
                    if distance(image.get_pixel(x, y).0, fill) > 90 {
                        (ix0, iy0, ix1, iy1) = (ix0.min(x), iy0.min(y), ix1.max(x), iy1.max(y));
                    }
                }
            }
            if ix0 == u32::MAX {
                continue;
            }
            let centre = |low: u32, high: u32| (low + high + 1) as f32 / 2.0;
            offsets.push((
                centre(ix0, ix1) - centre(x0, x1),
                centre(iy0, iy1) - centre(y0, y1),
            ));
        }
    }
    offsets
}
