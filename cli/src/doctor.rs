//! `overcrow-widget doctor [dir]`: what a creator's setup has and lacks.
//! The CLI and its embedded SDK, the platform, an installed OverCrow, a
//! running overlay that allows development installs (and how to start one),
//! and, in a widget project, Node.js, TypeScript and the SDK version of
//! `node_modules`. Problems are diagnostics with the same codes, output and
//! exit status as `check`.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::channel::{Client, ConnectError};
use crate::diag::{Diagnostic, Report};
use crate::{Format, emit, sanitize, sdk};

/// The Node.js release `check` needs for `tsc`.
const NODE_MAJOR: u32 = 22;
const NODE_TIMEOUT: Duration = Duration::from_secs(10);

/// How to start an overlay that allows development installs.
#[cfg(windows)]
pub const DEVELOPMENT_HELP: &str = "quit OverCrow (tray icon > Quit), then start it from PowerShell with development installs allowed: \
    $env:OVERCROW_WIDGET_DEVELOPMENT='1'; & \"$env:LOCALAPPDATA\\Programs\\OverCrow\\OverCrow.exe\"";
#[cfg(not(windows))]
pub const DEVELOPMENT_HELP: &str = "restart the overlay with development installs allowed: \
    systemctl --user set-environment OVERCROW_WIDGET_DEVELOPMENT=1 && systemctl --user restart overcrow-overlay.service \
    (afterwards: systemctl --user unset-environment OVERCROW_WIDGET_DEVELOPMENT && systemctl --user restart overcrow-overlay.service)";

pub fn run(root: &Path, format: Format, deny_warnings: bool) -> ExitCode {
    let mut report = Report::default();
    let mut lines: Vec<(&str, String)> = Vec::new();
    let mut facts = serde_json::Map::new();

    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    lines.push((
        "cli",
        format!(
            "overcrow-widget {} (widget API v{})",
            env!("CARGO_PKG_VERSION"),
            overcrow_widget_schema::API_VERSION
        ),
    ));
    lines.push(("sdk", format!("@overcrow/sdk {} (embedded)", sdk::VERSION)));
    lines.push(("platform", platform.clone()));
    facts.insert("cli".into(), json!(env!("CARGO_PKG_VERSION")));
    facts.insert(
        "apiVersion".into(),
        json!(overcrow_widget_schema::API_VERSION),
    );
    facts.insert("sdk".into(), json!(sdk::VERSION));
    facts.insert("platform".into(), json!(platform));

    let installed = installed_overlay();
    match &installed {
        Some(path) => lines.push(("overcrow", format!("installed: {}", path.display()))),
        None => {
            lines.push(("overcrow", "not found".into()));
            report.push(
                Diagnostic::warning(
                    "doctor.overcrow_missing",
                    "OverCrow is not installed where it installs itself",
                )
                .help("install OverCrow to run widgets in its overlay; check and package work without it"),
            );
        }
    }
    facts.insert(
        "overcrow".into(),
        json!({"installed": installed.is_some(), "path": installed.map(|path| path.display().to_string())}),
    );

    let development = match Client::connect() {
        Ok(client) => {
            let name = sanitize::line(&client.overlay.name);
            lines.push((
                "development",
                format!(
                    "on: {name}, development channel v{}",
                    overcrow_widget_devchannel::PROTOCOL_VERSION
                ),
            ));
            json!({"active": true, "overlay": name, "protocol": overcrow_widget_devchannel::PROTOCOL_VERSION})
        }
        Err(error) => {
            lines.push(("development", "off".into()));
            report.push(match &error {
                ConnectError::Absent => Diagnostic::warning(
                    "doctor.development_off",
                    "no running overlay allows development installs: `dev` cannot install widgets",
                )
                .help(DEVELOPMENT_HELP),
                ConnectError::Incompatible(_) => {
                    Diagnostic::error("doctor.protocol_version", error.to_string())
                        .help("use the overcrow-widget release that matches this OverCrow")
                }
                ConnectError::Untrusted(_) => Diagnostic::error("doctor.channel_untrusted", error.to_string())
                    .help("another program holds OverCrow's development channel; stop it and restart OverCrow"),
                ConnectError::Refused(_) => Diagnostic::warning("doctor.channel_busy", error.to_string())
                    .help("other `dev` sessions use the overlay; stop one of them"),
                ConnectError::Io(_) => Diagnostic::warning("doctor.channel_io", error.to_string()),
            });
            json!({"active": false})
        }
    };
    facts.insert("development".into(), development);

    let project = root.join("manifest.json").is_file();
    facts.insert("project".into(), json!(project));
    if project {
        project_checks(root, &mut report, &mut lines, &mut facts);
    } else {
        lines.push((
            "project",
            format!("no widget project in {}", root.display()),
        ));
    }

    if format == Format::Human {
        for (label, value) in &lines {
            println!("{label:<12} {value}");
        }
    }
    let failed = emit(&report, None, format, deny_warnings, "doctor");
    if format == Format::Json {
        facts.insert("type".into(), json!("doctor"));
        println!("{}", Value::Object(facts));
    }
    ExitCode::from(u8::from(failed))
}

fn project_checks(
    root: &Path,
    report: &mut Report,
    lines: &mut Vec<(&str, String)>,
    facts: &mut serde_json::Map<String, Value>,
) {
    let node = node_version();
    match &node {
        Some(version) => {
            lines.push(("node", version.clone()));
            let major = version
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|major| major.parse::<u32>().ok());
            if major.is_none_or(|major| major < NODE_MAJOR) {
                report.push(
                    Diagnostic::warning(
                        "doctor.node_version",
                        format!("Node.js {version} is older than {NODE_MAJOR}: `check` may not type-check"),
                    )
                    .help(format!("install Node.js {NODE_MAJOR} or later")),
                );
            }
        }
        None => {
            lines.push(("node", "not found".into()));
            report.push(
                Diagnostic::warning(
                    "doctor.node_missing",
                    "Node.js was not found on PATH: `check` cannot type-check logic.ts",
                )
                .help(format!("install Node.js {NODE_MAJOR} or later")),
            );
        }
    }
    let typescript = package_version(&root.join("node_modules/typescript/package.json"));
    match &typescript {
        Some(version) => lines.push(("typescript", version.clone())),
        None => {
            lines.push(("typescript", "not installed".into()));
            report.push(
                Diagnostic::warning(
                    "doctor.typescript_missing",
                    "TypeScript is not installed in this project (node_modules/typescript)",
                )
                .help("run `npm install` in the project"),
            );
        }
    }
    let installed_sdk = package_version(&root.join("node_modules/@overcrow/sdk/package.json"));
    match &installed_sdk {
        Some(version) if version == sdk::VERSION => {
            lines.push(("project sdk", format!("{version} (same as the CLI)")));
        }
        Some(version) => {
            lines.push(("project sdk", version.clone()));
            report.push(
                Diagnostic::warning(
                    "doctor.sdk_version",
                    format!(
                        "node_modules/@overcrow/sdk is {version}; this CLI links @overcrow/sdk {}",
                        sdk::VERSION
                    ),
                )
                .help(format!(
                    "types may disagree with the bundle: `npm install @overcrow/sdk@{}`",
                    sdk::VERSION
                )),
            );
        }
        None => {
            lines.push(("project sdk", "not installed".into()));
            report.push(
                Diagnostic::warning(
                    "doctor.sdk_missing",
                    "@overcrow/sdk is not installed in this project: types are not checked",
                )
                .help("run `npm install` in the project"),
            );
        }
    }
    facts.insert("node".into(), json!(node));
    facts.insert("typescript".into(), json!(typescript));
    facts.insert("projectSdk".into(), json!(installed_sdk));
}

/// The `version` of a `package.json`, bounded and printable.
fn package_version(path: &Path) -> Option<String> {
    let bytes = crate::project::read_bounded(path, 1 << 20).ok()??;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let version = value.get("version")?.as_str()?;
    (version.len() <= 64 && version.bytes().all(|byte| byte.is_ascii_graphic()))
        .then(|| version.to_owned())
}

/// `node --version`, bounded in time and size.
fn node_version() -> Option<String> {
    let mut child = Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + NODE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut text = String::new();
    use std::io::Read as _;
    child
        .stdout
        .take()?
        .take(256)
        .read_to_string(&mut text)
        .ok()?;
    let version = text.trim();
    (!version.is_empty() && version.bytes().all(|byte| byte.is_ascii_graphic()))
        .then(|| version.to_owned())
}

/// Where OverCrow's packages install the overlay.
fn installed_overlay() -> Option<PathBuf> {
    #[cfg(windows)]
    let candidates: Vec<PathBuf> = std::env::var_os("LOCALAPPDATA")
        .map(|local| PathBuf::from(local).join(r"Programs\OverCrow\OverCrow.exe"))
        .into_iter()
        .collect();
    #[cfg(not(windows))]
    let candidates: Vec<PathBuf> = ["/usr/bin", "/usr/local/bin"]
        .iter()
        .map(PathBuf::from)
        .chain(
            std::env::var_os("PATH")
                .map_or_else(Vec::new, |path| std::env::split_paths(&path).collect()),
        )
        .map(|directory| directory.join("overcrow-overlay"))
        .collect();
    candidates.into_iter().find(|path| path.is_file())
}
