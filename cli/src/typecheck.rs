//! Type checking with the project's own TypeScript. The CLI does not embed
//! TypeScript: it runs `node_modules/typescript/lib/tsc.js` of the project
//! with Node.js, and says clearly when either is missing.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use overcrow_widget_format::Position;

use crate::diag::{Diagnostic, Report};
use crate::sdk;

/// Wall-clock bound of one `tsc` run.
const TIMEOUT: Duration = Duration::from_secs(300);
/// Bytes of `tsc` output read; the rest is dropped.
const MAX_OUTPUT_BYTES: u64 = 1 << 20;

pub fn run(root: &Path, logic_path: &str, report: &mut Report) {
    check_sdk_version(root, report);
    if logic_path != "logic.ts" {
        return;
    }
    // tsc runs in the project directory: relative to it, whatever `root` is.
    let tsc = Path::new("node_modules/typescript/lib/tsc.js");
    if !root.join(tsc).is_file() {
        report.push(
            Diagnostic::warning(
                "typecheck.skipped",
                "TypeScript is not installed in this project (node_modules/typescript): types were not checked",
            )
            .help("run `npm install` in the project, then check again"),
        );
        return;
    }
    let mut command = Command::new("node");
    command
        .arg(tsc)
        .args(["--noEmit", "--pretty", "false", "-p", "tsconfig.json"])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            report.push(
                Diagnostic::warning(
                    "typecheck.skipped",
                    "Node.js was not found on PATH: types were not checked",
                )
                .help("install Node.js 22 or later to type-check logic.ts"),
            );
            return;
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return;
    };
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.take(MAX_OUTPUT_BYTES).read_to_string(&mut text);
        let _ = sender.send(text);
    });
    let output = match receiver.recv_timeout(TIMEOUT) {
        Ok(output) => output,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            report.push(Diagnostic::error(
                "typecheck.timeout",
                format!("tsc did not finish within {} s", TIMEOUT.as_secs()),
            ));
            return;
        }
    };
    let status = child.wait();
    let before = report.diagnostics.len();
    parse_tsc_output(&output, report);
    let failed = status.map(|status| !status.success()).unwrap_or(true);
    if failed && report.diagnostics.len() == before {
        report.push(Diagnostic::error(
            "typecheck.tsc",
            "tsc failed without reporting a diagnostic",
        ));
    }
}

/// `tsc --pretty false` lines: `file(line,col): error TS1234: message`,
/// continuation lines indented.
pub fn parse_tsc_output(output: &str, report: &mut Report) {
    for line in output.lines() {
        if let Some(diagnostic) = parse_tsc_line(line) {
            report.push(diagnostic);
        } else if line.starts_with(' ')
            && let Some(last) = report.diagnostics.last_mut()
            && last.code == "typecheck.tsc"
        {
            last.message.push('\n');
            last.message.push_str(line.trim_end());
        } else if !line.trim().is_empty() {
            report.push(Diagnostic::error("typecheck.tsc", line.trim().to_owned()));
        }
    }
}

fn parse_tsc_line(line: &str) -> Option<Diagnostic> {
    let open = line.find('(')?;
    let close = open + line[open..].find("): ")?;
    let (file, place) = (&line[..open], &line[open + 1..close]);
    let (row, column) = place.split_once(',')?;
    let rest = &line[close + 3..];
    let (severity, rest) = rest
        .strip_prefix("error ")
        .map(|rest| (true, rest))
        .or_else(|| rest.strip_prefix("warning ").map(|rest| (false, rest)))?;
    let make = if severity {
        Diagnostic::error
    } else {
        Diagnostic::warning
    };
    Some(
        make("typecheck.tsc", rest.to_owned())
            .in_file(file.replace('\\', "/"))
            .at(Position {
                line: row.parse().ok()?,
                column: column.parse().ok()?,
            }),
    )
}

/// Warns when the SDK installed for the types is not the one linked.
fn check_sdk_version(root: &Path, report: &mut Report) {
    let path = root.join("node_modules/@overcrow/sdk/package.json");
    let Ok(Some(bytes)) = crate::project::read_bounded(&path, 1 << 20) else {
        return;
    };
    let version = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value.get("version")?.as_str().map(str::to_owned));
    if version.as_deref() != Some(sdk::VERSION) {
        report.push(
            Diagnostic::warning(
                "typecheck.sdk_version",
                format!(
                    "node_modules has @overcrow/sdk {}, but this CLI links @overcrow/sdk {}",
                    version.as_deref().unwrap_or("of an unknown version"),
                    sdk::VERSION
                ),
            )
            .in_file("package.json")
            .help(format!(
                "pin \"@overcrow/sdk\": \"{}\" in package.json so types match the linked code",
                sdk::VERSION
            )),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tsc_diagnostics_with_continuations() {
        let mut report = Report::default();
        parse_tsc_output(
            "logic.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n  \
             The expected type comes from property 'now'.\nnot a diagnostic\n",
            &mut report,
        );
        let [first, second] = report.diagnostics.as_slice() else {
            panic!("two diagnostics: {:?}", report.diagnostics);
        };
        assert_eq!(first.code, "typecheck.tsc");
        assert_eq!(first.file.as_deref(), Some("logic.ts"));
        assert_eq!(
            first.position,
            Position {
                line: 12,
                column: 5
            }
        );
        assert!(first.message.starts_with("TS2322: Type 'string'"));
        assert!(first.message.ends_with("from property 'now'."));
        assert_eq!(second.message, "not a diagnostic");
    }
}
