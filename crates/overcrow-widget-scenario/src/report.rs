//! The interface between `overcrow-widget test` and the headless runtime
//! (`overcrow-widget-headless`), which OverCrow's release pipeline builds
//! for each application version.
//!
//! ```text
//! overcrow-widget-headless --version --format json      → RuntimeInfo
//! overcrow-widget-headless run --interface 1 --package <file.ocpkg>
//!     --scenario <file.scenario.json> --out <directory>
//!     [--project <directory>]                            → Report
//! ```
//!
//! `--project` is the widget project a scenario with `assets` reads its
//! images from ([`crate::load_assets`]); it is required then, and ignored
//! otherwise.
//!
//! `run` validates the package as the overlay does, plays the scenario in
//! the sandboxed VM, writes each captured image as `<out>/<image>.png` and
//! prints one [`Report`] on standard output. Its exit code is one of
//! [`exit`]. Every text of a report can come from the widget: the CLI shows
//! it neutralized.

use serde::{Deserialize, Serialize};

/// The interface this crate describes.
pub const INTERFACE_VERSION: u32 = 1;

/// A report, in bytes.
pub const MAX_REPORT_BYTES: usize = 8 * 1024 * 1024;
/// Entries of each list of a report; the runtime drops the rest and says so
/// in `truncated`.
pub const MAX_REPORT_ENTRIES: usize = 1024;

/// Exit codes of `run`.
pub mod exit {
    /// The scenario was played; `Report::passed` says whether every
    /// expectation held.
    pub const PLAYED: u8 = 0;
    /// Bad arguments, or a scenario that does not pass its checks.
    pub const USAGE: u8 = 2;
    /// The sandbox is not available on this machine: nothing ran.
    pub const SANDBOX: u8 = 3;
    /// The package does not pass the host's validation.
    pub const PACKAGE: u8 = 4;
    /// The runtime does not speak the requested interface.
    pub const INTERFACE: u8 = 5;
    /// The runtime failed for another reason (I/O, resources).
    pub const INTERNAL: u8 = 6;
}

/// `--version --format json`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeInfo {
    /// The OverCrow version the runtime was built with.
    pub runtime: String,
    pub interface: u32,
    pub api_version: u64,
    pub scenario_versions: Vec<u32>,
    /// `linux` or `windows`.
    pub os: String,
    /// `x86_64`.
    pub arch: String,
}

/// What the sandbox applied: `full`, or `without-cgroup` on a Linux
/// session without cgroup delegation (Bubblewrap, seccomp, rlimits and the
/// VM's heap ceiling still apply).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Containment {
    Full,
    WithoutCgroup,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub interface: u32,
    pub scenario: String,
    pub runtime: String,
    pub containment: Containment,
    /// Every expectation held and no error of the scenario happened. The
    /// images are compared by the CLI.
    pub passed: bool,
    pub captures: Vec<Capture>,
    pub expectations: Vec<Outcome>,
    /// Every service call of the widget, in order, timers included.
    pub calls: Vec<Call>,
    pub logs: Vec<Log>,
    /// Fault categories of the VM, in order.
    pub faults: Vec<String>,
    /// Errors of the scenario found while playing it: a call or request
    /// without a fixture, a target that matches nothing.
    pub errors: Vec<Outcome>,
    /// The widget's state at the end.
    pub state: String,
    /// Some list was cut at [`MAX_REPORT_ENTRIES`].
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    pub name: String,
    /// The file name in the output directory.
    pub file: String,
    /// Physical px.
    pub width: u32,
    pub height: u32,
    /// Index of the `expect` step.
    pub step: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outcome {
    pub step: usize,
    /// `text`, `noText`, `calls`, `state`, `fault`, `clipboard`, or for an
    /// error of the scenario `fixture`, `target`, `menu`, `settle`.
    pub kind: String,
    pub ok: bool,
    /// What was found instead; may quote the widget.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Call {
    pub service: String,
    pub params: serde_json::Value,
    /// `ok`, an error code, or `pending` when the scenario ended first.
    pub outcome: String,
    /// Virtual Unix milliseconds of the call.
    pub at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Log {
    pub level: String,
    pub text: String,
}

impl Report {
    /// The bounds a CLI checks before it uses a report.
    pub fn within_bounds(&self) -> bool {
        self.interface == INTERFACE_VERSION
            && [
                self.captures.len(),
                self.expectations.len(),
                self.calls.len(),
                self.logs.len(),
                self.faults.len(),
                self.errors.len(),
            ]
            .iter()
            .all(|count| *count <= MAX_REPORT_ENTRIES)
            && self.captures.iter().all(|capture| {
                capture.file == format!("{}.png", capture.name)
                    && crate::valid_name(&capture.name)
                    && (1..=crate::MAX_IMAGE_SIDE_PX).contains(&capture.width)
                    && (1..=crate::MAX_IMAGE_SIDE_PX).contains(&capture.height)
            })
    }
}

/// `text` for a one-line message: control, bidi and line-breaking
/// characters escaped as `\u{…}`, at most 64 characters. For names quoted
/// in [`crate::ScenarioError`] and for widget text in terminal output.
pub fn neutral(text: &str) -> String {
    const MAX_CHARS: usize = 64;
    let mut out = String::new();
    for (index, c) in text.chars().enumerate() {
        if index == MAX_CHARS {
            out.push('…');
            break;
        }
        let unsafe_char = c.is_control()
            || matches!(
                c,
                '\u{2028}' | '\u{2029}' | '\u{061c}' | '\u{200e}' | '\u{200f}'
            )
            || ('\u{202a}'..='\u{202e}').contains(&c)
            || ('\u{2066}'..='\u{2069}').contains(&c);
        if unsafe_char {
            out.push_str(&format!("\\u{{{:x}}}", c as u32));
        } else {
            out.push(c);
        }
    }
    out
}
