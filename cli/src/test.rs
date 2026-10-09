//! `overcrow-widget test [dir]`: packages the widget, then plays every
//! `tests/<name>.scenario.json` of the project in the headless runtime
//! (`runtime`), and compares the images it renders with
//! `tests/reference/<name>/<image>.png` within the schema's parity bounds.
//! A difference writes `tests/output/<name>/<image>.actual.png` and
//! `<image>.diff.png`; `--update` writes the references instead.
//!
//! Everything the runtime reports can come from the widget (texts, logs,
//! parameters): it is shown neutralized, as in `dev`.

use std::collections::BTreeSet;
use std::io::{Cursor, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

use image::codecs::png::PngDecoder;
use image::{ImageDecoder as _, Limits, Rgba, RgbaImage};
use overcrow_widget_scenario::report::{self, Report, exit};
use overcrow_widget_scenario::{MAX_IMAGE_SIDE_PX, MAX_SCENARIO_BYTES, SCENARIO_SUFFIX, Scenario};
use overcrow_widget_schema::limits::{PARITY_CHANNEL_TOLERANCE, PARITY_MAX_DIFFERENT_PIXELS};
use serde_json::json;

use crate::Format;
use crate::build::{self, Built};
use crate::diag::{Diagnostic, Report as Diagnostics};
use crate::download;
use crate::runtime::{self, Runtime};
use crate::sanitize;

/// Scenarios of one project, at most.
const MAX_SCENARIOS: usize = 256;
/// One scenario's run, at most.
const RUN_TIMEOUT: Duration = Duration::from_secs(300);
/// What the runtime writes to standard error, kept.
const MAX_STDERR_BYTES: u64 = 16 * 1024;
/// Widget log lines shown for a failed scenario.
const MAX_LOG_LINES: usize = 20;

pub struct Options<'a> {
    pub typecheck: bool,
    pub format: Format,
    pub runtime: Option<&'a Path>,
    /// Never download the pinned runtime.
    pub offline: bool,
    pub update: bool,
    /// Only this scenario.
    pub only: Option<&'a str>,
}

/// How one image compared.
#[derive(Clone, Debug, PartialEq)]
pub enum ImageStatus {
    Same,
    /// Within the parity bounds, not identical.
    Within {
        ppm: u64,
        largest: u8,
    },
    Different {
        ppm: u64,
        largest: u8,
    },
    SizeChanged,
    NoReference,
    Updated,
    Unreadable,
}

impl ImageStatus {
    fn passed(&self) -> bool {
        matches!(self, Self::Same | Self::Within { .. } | Self::Updated)
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Same => "same",
            Self::Within { .. } => "within",
            Self::Different { .. } => "different",
            Self::SizeChanged => "size",
            Self::NoReference => "missing",
            Self::Updated => "updated",
            Self::Unreadable => "unreadable",
        }
    }
}

/// The result of one scenario.
struct Outcome {
    name: String,
    /// The run itself went wrong (not an expectation).
    failure: Option<String>,
    report: Option<Report>,
    images: Vec<(String, ImageStatus)>,
    /// References no step captures any more.
    stale: Vec<String>,
}

impl Outcome {
    fn passed(&self) -> bool {
        self.failure.is_none()
            && self.report.as_ref().is_some_and(|report| report.passed)
            && self.images.iter().all(|(_, status)| status.passed())
    }
}

pub fn run(root: &Path, options: &Options<'_>) -> ExitCode {
    let mut diagnostics = Diagnostics::default();
    let built = build::build(
        root,
        &build::Options {
            typecheck: options.typecheck,
        },
        &mut diagnostics,
    );
    let scenarios = built
        .as_ref()
        .map(|built| scenarios(root, built, options.only, &mut diagnostics))
        .unwrap_or_default();
    if crate::emit(&diagnostics, Some(root), options.format, false, "test") {
        return ExitCode::from(1);
    }
    let Some(built) = built else {
        return ExitCode::from(1);
    };
    if scenarios.is_empty() {
        let message = match options.only {
            Some(_) => "no scenario of this name in tests/",
            None => "the project has no tests/*.scenario.json",
        };
        eprintln!("overcrow-widget: {message} (https://overcrow.playervox.com/docs/en/testing/)");
        return ExitCode::from(1);
    }
    let source = (!options.offline).then(download::Source::for_release);
    let runtime = match runtime::resolve(options.runtime, runtime::PIN.as_ref(), source.as_ref()) {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("overcrow-widget: {error}");
            return ExitCode::from(2);
        }
    };
    announce(&runtime, options.format);
    let work = match tempfile::tempdir() {
        Ok(work) => work,
        Err(error) => {
            eprintln!("overcrow-widget: no temporary directory: {error}");
            return ExitCode::from(2);
        }
    };
    let package = work.path().join("widget.ocpkg");
    if let Err(error) = std::fs::write(&package, &built.archive) {
        eprintln!("overcrow-widget: cannot write the package: {error}");
        return ExitCode::from(2);
    }
    let mut outcomes = Vec::new();
    for (index, (path, scenario)) in scenarios.iter().enumerate() {
        let out = work.path().join(format!("run-{index}"));
        let outcome = match std::fs::create_dir(&out) {
            Ok(()) => play(
                root,
                &runtime,
                &package,
                path,
                scenario,
                &out,
                options.update,
            ),
            Err(error) => Err(Fatal(format!("cannot create a work directory: {error}"))),
        };
        match outcome {
            Ok(outcome) => {
                show(&outcome, options.format);
                outcomes.push(outcome);
            }
            Err(Fatal(message)) => {
                eprintln!("overcrow-widget: {message}");
                return ExitCode::from(2);
            }
        }
    }
    let failed = outcomes.iter().filter(|outcome| !outcome.passed()).count();
    let passed = outcomes.len() - failed;
    match options.format {
        Format::Human => eprintln!("test: {passed} passed, {failed} failed"),
        Format::Json => println!(
            "{}",
            json!({"type": "summary", "passed": passed, "failed": failed})
        ),
    }
    ExitCode::from(u8::from(failed > 0))
}

fn announce(runtime: &Runtime, format: Format) {
    let note = if runtime.pinned {
        "pinned"
    } else {
        "not the pinned runtime"
    };
    match format {
        Format::Human => eprintln!(
            "runtime: overcrow-widget-headless {} ({}-{}), sha256 {} ({note})",
            sanitize::line(&runtime.info.runtime),
            sanitize::line(&runtime.info.os),
            sanitize::line(&runtime.info.arch),
            runtime.sha256
        ),
        Format::Json => println!(
            "{}",
            sanitize::json(
                &json!({
                    "type": "runtime",
                    "version": runtime.info.runtime,
                    "sha256": runtime.sha256,
                    "pinned": runtime.pinned,
                })
                .to_string()
            )
        ),
    }
}

/// The project's scenarios in name order, checked against the manifest;
/// every problem is a diagnostic in its file.
fn scenarios(
    root: &Path,
    built: &Built,
    only: Option<&str>,
    diagnostics: &mut Diagnostics,
) -> Vec<(PathBuf, Scenario)> {
    let directory = root.join("tests");
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stem = name.strip_suffix(SCENARIO_SUFFIX)?.to_owned();
            entry.file_type().ok().filter(std::fs::FileType::is_file)?;
            Some((stem, entry.path()))
        })
        .filter(|(stem, _)| only.is_none_or(|only| only == stem))
        .collect();
    files.sort();
    if files.len() > MAX_SCENARIOS {
        diagnostics.push(Diagnostic::error(
            "test.too_many_scenarios",
            format!("a project has at most {MAX_SCENARIOS} scenarios"),
        ));
        return Vec::new();
    }
    let mut scenarios = Vec::new();
    for (stem, path) in files {
        let file = format!("tests/{stem}{SCENARIO_SUFFIX}");
        let bytes = match crate::project::read_bounded(&path, MAX_SCENARIO_BYTES as u64) {
            Ok(Some(bytes)) => bytes,
            _ => {
                diagnostics.push(
                    Diagnostic::error("test.scenario", "unreadable or larger than its bound")
                        .in_file(file),
                );
                continue;
            }
        };
        let checked = overcrow_widget_scenario::parse(&bytes).and_then(|scenario| {
            scenario.check_against(&built.manifest)?;
            overcrow_widget_scenario::load_assets(root, &scenario.assets)?;
            Ok(scenario)
        });
        match checked {
            Ok(scenario) if scenario.name == stem => scenarios.push((path, scenario)),
            Ok(_) => diagnostics.push(
                Diagnostic::error(
                    "test.scenario_name",
                    "a scenario's `name` is its file name without .scenario.json",
                )
                .in_file(file),
            ),
            Err(error) => diagnostics.push(
                Diagnostic::error("test.scenario", sanitize::line(&error.to_string()))
                    .in_file(file),
            ),
        }
    }
    scenarios
}

/// A problem that stops the whole command.
struct Fatal(String);

fn play(
    root: &Path,
    runtime: &Runtime,
    package: &Path,
    path: &Path,
    scenario: &Scenario,
    out: &Path,
    update: bool,
) -> Result<Outcome, Fatal> {
    let mut outcome = Outcome {
        name: scenario.name.clone(),
        failure: None,
        report: None,
        images: Vec::new(),
        stale: Vec::new(),
    };
    // The runtime reads the scenario's images from the project itself.
    let project = (!scenario.assets.is_empty()).then_some(root);
    let (code, stdout, stderr) = execute(runtime, package, path, project, out)?;
    let reason = || sanitize::line(stderr.trim());
    match code {
        Some(code) if code == i32::from(exit::PLAYED) => {}
        Some(code) if code == i32::from(exit::USAGE) || code == i32::from(exit::PACKAGE) => {
            outcome.failure = Some(reason());
            return Ok(outcome);
        }
        Some(code) if code == i32::from(exit::SANDBOX) => return Err(Fatal(reason())),
        _ => {
            return Err(Fatal(format!(
                "the runtime failed ({})",
                code.map_or("killed or timed out".to_owned(), |code| format!(
                    "exit {code}"
                ))
            )));
        }
    }
    let report: Report = serde_json::from_slice(&stdout)
        .ok()
        .filter(|report: &Report| report.within_bounds() && report.scenario == scenario.name)
        .ok_or_else(|| Fatal("the runtime's report is invalid".to_owned()))?;
    let references = root.join("tests").join("reference").join(&scenario.name);
    let output = root.join("tests").join("output").join(&scenario.name);
    let mut captured = BTreeSet::new();
    for capture in &report.captures {
        captured.insert(format!("{}.png", capture.name));
        let status = compare(
            &out.join(&capture.file),
            &references,
            &output,
            &capture.name,
            update,
        );
        outcome.images.push((capture.name.clone(), status));
    }
    if let Ok(entries) = std::fs::read_dir(&references) {
        outcome.stale = entries
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.ends_with(".png") && !captured.contains(name))
            .collect();
        outcome.stale.sort();
    }
    outcome.report = Some(report);
    Ok(outcome)
}

/// Runs the runtime on one scenario within [`RUN_TIMEOUT`]; its exit code
/// (`None` when killed), standard output and standard error.
fn execute(
    runtime: &Runtime,
    package: &Path,
    scenario: &Path,
    project: Option<&Path>,
    out: &Path,
) -> Result<(Option<i32>, Vec<u8>, String), Fatal> {
    let mut command = Command::new(&runtime.path);
    command.arg("run");
    if let Some(project) = project {
        command.arg("--project").arg(project);
    }
    let mut child = command
        .args(["--interface", &report::INTERFACE_VERSION.to_string()])
        .arg("--package")
        .arg(package)
        .arg("--scenario")
        .arg(scenario)
        .arg("--out")
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| Fatal(format!("cannot start the runtime: {error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(stdout) = stdout {
            let _ = stdout
                .take(report::MAX_REPORT_BYTES as u64 + 1)
                .read_to_end(&mut bytes);
        }
        bytes
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(stderr) = stderr {
            let _ = stderr.take(MAX_STDERR_BYTES).read_to_end(&mut bytes);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let deadline = Instant::now() + RUN_TIMEOUT;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(Fatal(format!("cannot wait for the runtime: {error}"))),
        }
    };
    let stdout = reader.join().unwrap_or_default();
    let stderr = errors.join().unwrap_or_default();
    if stdout.len() > report::MAX_REPORT_BYTES {
        return Err(Fatal("the runtime's report exceeds its bound".to_owned()));
    }
    Ok((code, stdout, stderr))
}

/// Decodes a PNG within the scenario image bounds.
pub fn decode(path: &Path) -> Option<RgbaImage> {
    let side = u64::from(MAX_IMAGE_SIDE_PX);
    let bytes = crate::project::read_bounded(path, 4 * side * side + 1024 * 1024)
        .ok()
        .flatten()?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE_PX);
    limits.max_image_height = Some(MAX_IMAGE_SIDE_PX);
    limits.max_alloc = Some(4 * side * side * 2);
    let decoder = PngDecoder::with_limits(Cursor::new(bytes), limits).ok()?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    Some(image::DynamicImage::from_decoder(decoder).ok()?.to_rgba8())
}

/// Pixels beyond the channel tolerance (ppm) and the largest channel
/// difference of two images of the same size.
pub fn difference(a: &RgbaImage, b: &RgbaImage) -> (u64, u8) {
    let tolerance = PARITY_CHANNEL_TOLERANCE.value as u8;
    let mut different = 0_u64;
    let mut largest = 0_u8;
    for (x, y) in a.pixels().zip(b.pixels()) {
        let delta =
            x.0.iter()
                .zip(y.0.iter())
                .map(|(p, q)| p.abs_diff(*q))
                .max()
                .unwrap_or(0);
        largest = largest.max(delta);
        if delta > tolerance {
            different += 1;
        }
    }
    let pixels = u64::from(a.width()) * u64::from(a.height());
    (different * 1_000_000 / pixels.max(1), largest)
}

/// The reference dimmed, with every pixel beyond the tolerance in red.
pub fn diff_image(reference: &RgbaImage, actual: &RgbaImage) -> RgbaImage {
    let tolerance = PARITY_CHANNEL_TOLERANCE.value as u8;
    RgbaImage::from_fn(reference.width(), reference.height(), |x, y| {
        let (a, b) = (reference.get_pixel(x, y), actual.get_pixel(x, y));
        let delta =
            a.0.iter()
                .zip(b.0.iter())
                .map(|(p, q)| p.abs_diff(*q))
                .max();
        if delta.unwrap_or(0) > tolerance {
            Rgba([255, 0, 0, 255])
        } else {
            let grey = ((u16::from(a.0[0]) + u16::from(a.0[1]) + u16::from(a.0[2])) / 12) as u8;
            Rgba([grey, grey, grey, 255])
        }
    })
}

fn compare(
    actual_path: &Path,
    references: &Path,
    output: &Path,
    name: &str,
    update: bool,
) -> ImageStatus {
    let Some(actual) = decode(actual_path) else {
        return ImageStatus::Unreadable;
    };
    let reference_path = references.join(format!("{name}.png"));
    if update {
        let written = std::fs::create_dir_all(references).is_ok()
            && crate::write_atomically(
                &reference_path,
                &std::fs::read(actual_path).unwrap_or_default(),
            )
            .is_ok();
        return if written {
            ImageStatus::Updated
        } else {
            ImageStatus::Unreadable
        };
    }
    if !reference_path.exists() {
        save_actual(output, name, &actual, None);
        return ImageStatus::NoReference;
    }
    let Some(reference) = decode(&reference_path) else {
        return ImageStatus::Unreadable;
    };
    if reference.dimensions() != actual.dimensions() {
        save_actual(output, name, &actual, None);
        return ImageStatus::SizeChanged;
    }
    let (ppm, largest) = difference(&reference, &actual);
    if ppm > PARITY_MAX_DIFFERENT_PIXELS.value {
        save_actual(output, name, &actual, Some(&reference));
        return ImageStatus::Different { ppm, largest };
    }
    if largest == 0 {
        ImageStatus::Same
    } else {
        ImageStatus::Within { ppm, largest }
    }
}

fn save_actual(output: &Path, name: &str, actual: &RgbaImage, reference: Option<&RgbaImage>) {
    if std::fs::create_dir_all(output).is_err() {
        return;
    }
    let _ = actual.save(output.join(format!("{name}.actual.png")));
    if let Some(reference) = reference {
        let _ = diff_image(reference, actual).save(output.join(format!("{name}.diff.png")));
    }
}

fn show(outcome: &Outcome, format: Format) {
    match format {
        Format::Human => show_human(outcome),
        Format::Json => {
            let report = outcome.report.as_ref();
            let images: Vec<_> = outcome
                .images
                .iter()
                .map(|(name, status)| {
                    let (ppm, largest) = match status {
                        ImageStatus::Within { ppm, largest }
                        | ImageStatus::Different { ppm, largest } => (Some(*ppm), Some(*largest)),
                        _ => (None, None),
                    };
                    json!({"name": name, "status": status.name(), "ppm": ppm, "maxDelta": largest})
                })
                .collect();
            let line = json!({
                "type": "scenario",
                "name": outcome.name,
                "passed": outcome.passed(),
                "failure": outcome.failure,
                "containment": report.map(|report| report.containment),
                "images": images,
                "staleReferences": outcome.stale,
                "expectations": report.map(|report| &report.expectations),
                "errors": report.map(|report| &report.errors),
                "faults": report.map(|report| &report.faults),
                "logs": report.map(|report| &report.logs),
            });
            println!("{}", sanitize::json(&line.to_string()));
        }
    }
}

fn show_human(outcome: &Outcome) {
    let mut out = std::io::stderr().lock();
    let verdict = if outcome.passed() { "PASS" } else { "FAIL" };
    let _ = writeln!(out, "{verdict} {}", outcome.name);
    if let Some(failure) = &outcome.failure {
        let _ = writeln!(out, "  {failure}");
    }
    let Some(report) = &outcome.report else {
        return;
    };
    for expectation in report.expectations.iter().filter(|outcome| !outcome.ok) {
        let _ = writeln!(
            out,
            "  step {}: {} expectation failed{}",
            expectation.step,
            sanitize::line(&expectation.kind),
            expectation
                .detail
                .as_ref()
                .map(|detail| format!(": {}", sanitize::line(detail)))
                .unwrap_or_default()
        );
    }
    for error in &report.errors {
        let _ = writeln!(
            out,
            "  step {}: scenario error ({}){}",
            error.step,
            sanitize::line(&error.kind),
            error
                .detail
                .as_ref()
                .map(|detail| format!(": {}", sanitize::line(detail)))
                .unwrap_or_default()
        );
    }
    for (name, status) in &outcome.images {
        let detail = match status {
            ImageStatus::Same | ImageStatus::Within { .. } => continue,
            ImageStatus::Updated => "reference updated".to_owned(),
            ImageStatus::Different { ppm, largest } => format!(
                "{ppm} ppm beyond {} levels (bound {} ppm, largest {largest}): see tests/output/{}/{name}.diff.png",
                PARITY_CHANNEL_TOLERANCE.value, PARITY_MAX_DIFFERENT_PIXELS.value, outcome.name
            ),
            ImageStatus::SizeChanged => format!(
                "the size changed: see tests/output/{}/{name}.actual.png",
                outcome.name
            ),
            ImageStatus::NoReference => {
                "no reference image: run `overcrow-widget test --update`".to_owned()
            }
            ImageStatus::Unreadable => "unreadable image".to_owned(),
        };
        let _ = writeln!(out, "  image {name}: {detail}");
    }
    for name in &outcome.stale {
        let _ = writeln!(
            out,
            "  warning: tests/reference/{}/{} is captured by no step",
            outcome.name,
            sanitize::line(name)
        );
    }
    if report.containment == report::Containment::WithoutCgroup {
        let _ = writeln!(
            out,
            "  note: the VM ran without its cgroup (no cgroup delegation in this session); \
             Bubblewrap, seccomp and the VM's ceilings applied"
        );
    }
    if !outcome.passed() {
        for log in report.logs.iter().take(MAX_LOG_LINES) {
            for line in sanitize::terminal(&log.text, 4) {
                let _ = writeln!(out, "  log {}: {line}", sanitize::line(&log.level));
            }
        }
    }
}
