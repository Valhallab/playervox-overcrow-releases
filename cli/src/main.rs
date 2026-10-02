//! `overcrow-widget`: the creator CLI of OverCrow widget API v1. See
//! `docs/content/en/cli.md` (the website's page) and `docs/cli.md`.

mod admit;
mod build;
mod bundle;
mod channel;
mod dev;
mod diag;
mod doctor;
mod init;
mod inspect;
mod interrupt;
mod jsonpos;
mod lint;
mod project;
mod runtime;
mod sanitize;
mod sdk;
mod snapshot;
mod sources;
mod test;
mod typecheck;
mod watch;

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use overcrow_widget_schema::limits::MAX_PACKAGE_BYTES;
use overcrow_widget_schema::package::{hex, read_package, sha256};

use crate::diag::{Diagnostic, Report};

const USAGE: &str = "\
overcrow-widget: create, check and package OverCrow widgets (widget API v1)

Usage:
  overcrow-widget init <dir> [--template blank|counter|list|chart] [--id ID] [--name NAME]
  overcrow-widget check [dir] [--format human|json] [--deny-warnings] [--no-typecheck]
  overcrow-widget package [dir] [--out FILE] [--format human|json] [--deny-warnings] [--no-typecheck]
  overcrow-widget inspect <file.ocpkg> [--format human|json]
  overcrow-widget dev [dir] [--format human|json] [--no-typecheck]
  overcrow-widget doctor [dir] [--format human|json] [--deny-warnings]
  overcrow-widget admit [dir] [--package FILE] [--publisher playervox] [--out DIR] [--format human|json] [--deny-warnings]
  overcrow-widget admit <file.ocpkg> --listing FILE [--publisher playervox] [--format human|json]
  overcrow-widget test [dir] [--runtime PATH] [--scenario NAME] [--update] [--format human|json] [--no-typecheck]
  overcrow-widget --version | --help

Exit status: 0 success (warnings allowed), 1 errors found, 2 usage or I/O error.
`admit` ends with 1 when the submission would be refused.
`test` ends with 1 when a scenario fails, 2 when no runtime can run.
`dev` runs until Ctrl+C (0), or ends with 1 when the overlay ends the session.
Guide: https://overcrow.playervox.com/docs/en/cli/";

/// Where the guide says how to install the SDK types into a project while
/// `@overcrow/sdk` is not on npm.
pub(crate) const SDK_TYPES_GUIDE: &str =
    "https://overcrow.playervox.com/docs/en/cli/#the-sdk-types";

#[derive(Clone, Copy, PartialEq)]
enum Format {
    Human,
    Json,
}

/// Parsed command line: the command, positional arguments and options.
struct Arguments {
    command: String,
    positional: Vec<String>,
    options: Vec<(String, Option<String>)>,
}

/// Options that take a value.
const VALUED: &[&str] = &[
    "--template",
    "--id",
    "--name",
    "--out",
    "--format",
    "--runtime",
    "--scenario",
    "--package",
    "--listing",
    "--publisher",
    "--repository",
    "--revision",
];

fn parse(mut args: impl Iterator<Item = String>) -> Result<Arguments, String> {
    let command = args.next().ok_or("missing command")?;
    let mut positional = Vec::new();
    let mut options = Vec::new();
    while let Some(arg) = args.next() {
        if let Some((name, value)) = arg
            .split_once('=')
            .filter(|(name, _)| name.starts_with("--"))
        {
            options.push((name.to_owned(), Some(value.to_owned())));
        } else if VALUED.contains(&arg.as_str()) {
            let value = args.next().ok_or(format!("{arg} needs a value"))?;
            options.push((arg, Some(value)));
        } else if arg.starts_with("--") {
            options.push((arg, None));
        } else {
            positional.push(arg);
        }
    }
    Ok(Arguments {
        command,
        positional,
        options,
    })
}

impl Arguments {
    fn value(&self, name: &str) -> Option<&str> {
        self.options
            .iter()
            .rev()
            .find(|(option, _)| option == name)
            .and_then(|(_, value)| value.as_deref())
    }

    fn flag(&self, name: &str) -> bool {
        self.options.iter().any(|(option, _)| option == name)
    }

    /// Rejects options outside `allowed` and more than `max` positionals.
    fn expect(&self, allowed: &[&str], max: usize) -> Result<(), String> {
        if let Some((option, _)) = self
            .options
            .iter()
            .find(|(option, _)| !allowed.contains(&option.as_str()))
        {
            return Err(format!("unknown option {option} for `{}`", self.command));
        }
        if self.positional.len() > max {
            return Err(format!("too many arguments for `{}`", self.command));
        }
        Ok(())
    }

    fn format(&self) -> Result<Format, String> {
        match self.value("--format") {
            None | Some("human") => Ok(Format::Human),
            Some("json") => Ok(Format::Json),
            Some(other) => Err(format!("unknown format `{other}`: human or json")),
        }
    }

    fn directory(&self) -> PathBuf {
        PathBuf::from(self.positional.first().map_or(".", String::as_str))
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("--help" | "-h" | "help") => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some("--version" | "-V") => {
            println!(
                "overcrow-widget {} (widget API v{}, @overcrow/sdk {})",
                env!("CARGO_PKG_VERSION"),
                overcrow_widget_schema::API_VERSION,
                sdk::VERSION
            );
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let arguments = match parse(args.into_iter()) {
        Ok(arguments) => arguments,
        Err(message) => return usage(&message),
    };
    let result = match arguments.command.as_str() {
        "init" => run_init(&arguments),
        "check" => run_build(&arguments, false),
        "package" => run_build(&arguments, true),
        "inspect" => run_inspect(&arguments),
        "dev" => run_dev(&arguments),
        "doctor" => run_doctor(&arguments),
        "test" => run_test(&arguments),
        "admit" => run_admit(&arguments),
        "snapshot-plan" => run_snapshot_plan(&arguments),
        other => Err(format!("unknown command `{other}`")),
    };
    result.unwrap_or_else(|message| usage(&message))
}

fn run_dev(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--format", "--no-typecheck"], 1)?;
    let format = arguments.format()?;
    let root = arguments.directory();
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    Ok(dev::run(
        &root,
        &dev::Options {
            typecheck: !arguments.flag("--no-typecheck"),
            format,
        },
    ))
}

fn run_doctor(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--format", "--deny-warnings"], 1)?;
    let format = arguments.format()?;
    Ok(doctor::run(
        &arguments.directory(),
        format,
        arguments.flag("--deny-warnings"),
    ))
}

fn run_test(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(
        &[
            "--format",
            "--no-typecheck",
            "--runtime",
            "--scenario",
            "--update",
        ],
        1,
    )?;
    let format = arguments.format()?;
    let root = arguments.directory();
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    Ok(test::run(
        &root,
        &test::Options {
            typecheck: !arguments.flag("--no-typecheck"),
            format,
            runtime: arguments.value("--runtime").map(Path::new),
            update: arguments.flag("--update"),
            only: arguments.value("--scenario"),
        },
    ))
}

fn run_admit(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(
        &[
            "--package",
            "--listing",
            "--publisher",
            "--out",
            "--format",
            "--deny-warnings",
        ],
        1,
    )?;
    let format = arguments.format()?;
    let publisher = match arguments.value("--publisher") {
        None => admit::Publisher::ThirdParty,
        Some("playervox") => admit::Publisher::PlayerVox,
        Some(other) => return Err(format!("unknown publisher `{other}`: playervox or none")),
    };
    let target = arguments.directory();
    let listing = arguments.value("--listing").map(Path::new);
    let input = if target.is_dir() {
        if listing.is_some() {
            return Err("--listing is for an archive; a source directory has listing.json".into());
        }
        admit::Input::Source(&target)
    } else if target.is_file() {
        if arguments.value("--package").is_some() || arguments.value("--out").is_some() {
            return Err("--package and --out need the source directory".into());
        }
        admit::Input::Archive {
            package: &target,
            listing: listing.ok_or("admitting an archive needs --listing FILE")?,
        }
    } else {
        return Err(format!("{} is not a directory or a file", target.display()));
    };
    let mut report = Report::default();
    let options = admit::Options {
        publisher,
        package: arguments.value("--package").map(Path::new),
    };
    let outcome = admit::admit(&input, &options, &mut report);
    let deny_warnings = arguments.flag("--deny-warnings");
    let refused = outcome.admitted.is_none() || (deny_warnings && report.warnings() > 0);
    match format {
        Format::Json => println!("{}", sanitize::json(&outcome.report.to_string())),
        Format::Human => {
            let root = matches!(input, admit::Input::Source(_)).then_some(target.as_path());
            emit(&report, root, format, deny_warnings, "admit");
            print!("{}", admit::render_human(&outcome.report));
        }
    }
    if refused {
        return Ok(ExitCode::from(1));
    }
    if let (Some(out), Some(admitted)) = (arguments.value("--out"), &outcome.admitted)
        && let Err(error) = admit::write_bundle(Path::new(out), admitted)
    {
        eprintln!("overcrow-widget: cannot write the admission bundle {out}: {error}");
        return Ok(ExitCode::from(2));
    }
    Ok(ExitCode::SUCCESS)
}

/// Maintenance command of the marketplace CI (`scripts/ci-verify.sh`): the
/// validated file list of a Git revision, before it is materialized.
fn run_snapshot_plan(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--repository", "--revision"], 0)?;
    let (Some(repository), Some(revision)) = (
        arguments.value("--repository"),
        arguments.value("--revision"),
    ) else {
        return Err("snapshot-plan needs --repository PATH --revision SHA".into());
    };
    Ok(
        match snapshot::write_plan(Path::new(repository), revision) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("overcrow-widget: {error}");
                ExitCode::from(1)
            }
        },
    )
}

fn usage(message: &str) -> ExitCode {
    eprintln!("overcrow-widget: {message}\n\n{USAGE}");
    ExitCode::from(2)
}

/// Prints the diagnostics and a summary; returns whether the command failed.
fn emit(
    report: &Report,
    root: Option<&Path>,
    format: Format,
    deny_warnings: bool,
    what: &str,
) -> bool {
    let mut stderr = std::io::stderr().lock();
    let mut stdout = std::io::stdout().lock();
    for diagnostic in &report.diagnostics {
        match format {
            Format::Json => {
                let _ = writeln!(stdout, "{}", diagnostic.to_json());
            }
            Format::Human => {
                let source = diagnostic
                    .file
                    .as_ref()
                    .zip(root)
                    .and_then(|(file, root)| fs::read_to_string(root.join(file)).ok());
                let _ = write!(stderr, "{}", diagnostic.render(source.as_deref()));
            }
        }
    }
    let failed = report.errors() > 0 || (deny_warnings && report.warnings() > 0);
    if format == Format::Human && !report.diagnostics.is_empty() {
        let _ = writeln!(
            stderr,
            "{what}: {} error(s), {} warning(s)",
            report.errors(),
            report.warnings()
        );
    }
    failed
}

fn run_init(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--template", "--id", "--name"], 1)?;
    let directory = arguments
        .positional
        .first()
        .ok_or("init needs a directory")?;
    let options = init::Options {
        template: arguments.value("--template").unwrap_or("blank"),
        id: arguments.value("--id"),
        name: arguments.value("--name"),
    };
    match init::init(Path::new(directory), &options) {
        Ok(files) => {
            println!(
                "Created {directory} from the {} template:",
                options.template
            );
            for file in files {
                println!("  {file}");
            }
            println!(
                "\nNext: cd {directory} && overcrow-widget check\n\
                 check validates everything but the types until TypeScript and the SDK are in\n\
                 node_modules. @overcrow/sdk is not on npm yet, so a plain `npm install` fails:\n\
                 build the SDK from the repository of this tool and install it from that\n\
                 directory ({SDK_TYPES_GUIDE})"
            );
            Ok(ExitCode::SUCCESS)
        }
        Err(diagnostic) => {
            eprint!("{}", diagnostic.render(None));
            Ok(ExitCode::from(if diagnostic.code == "init.write" {
                2
            } else {
                1
            }))
        }
    }
}

fn run_build(arguments: &Arguments, write: bool) -> Result<ExitCode, String> {
    let allowed: &[&str] = if write {
        &["--out", "--format", "--deny-warnings", "--no-typecheck"]
    } else {
        &["--format", "--deny-warnings", "--no-typecheck"]
    };
    arguments.expect(allowed, 1)?;
    let format = arguments.format()?;
    let root = arguments.directory();
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    let mut report = Report::default();
    let options = build::Options {
        typecheck: !arguments.flag("--no-typecheck"),
    };
    let built = build::build(&root, &options, &mut report);
    let what = if write { "package" } else { "check" };
    let failed = emit(
        &report,
        Some(&root),
        format,
        arguments.flag("--deny-warnings"),
        what,
    );
    let Some(built) = built.filter(|_| !failed) else {
        return Ok(ExitCode::from(1));
    };
    if !write {
        if format == Format::Human {
            println!(
                "{} {}: ok ({} files, logic.js {} bytes)",
                built.manifest.id,
                built.manifest.version,
                built.files.len() + 1,
                built.files["logic.js"].len()
            );
        }
        return Ok(ExitCode::SUCCESS);
    }
    let out = match arguments.value("--out") {
        Some(out) => PathBuf::from(out),
        None => root.join("dist").join(format!(
            "{}-{}.ocpkg",
            built.manifest.id, built.manifest.version
        )),
    };
    if let Err(error) = write_atomically(&out, &built.archive) {
        eprintln!("overcrow-widget: cannot write {}: {error}", out.display());
        return Ok(ExitCode::from(2));
    }
    let digest = hex(&sha256(&built.archive));
    match format {
        Format::Human => println!(
            "{}  {} bytes  sha256 {digest}\n  logic.js {} bytes ({} modules linked)",
            out.display(),
            built.archive.len(),
            built.files["logic.js"].len(),
            built.modules
        ),
        Format::Json => println!(
            "{}",
            serde_json::json!({
                "package": out.display().to_string(),
                "bytes": built.archive.len(),
                "sha256": digest,
                "logicBytes": built.files["logic.js"].len(),
            })
        ),
    }
    Ok(ExitCode::SUCCESS)
}

/// Writes through a temporary file in the same directory, then renames, so
/// a failed run never leaves a truncated package.
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

fn run_inspect(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--format"], 1)?;
    let format = arguments.format()?;
    let path = arguments
        .positional
        .first()
        .ok_or("inspect needs a .ocpkg file")?;
    let bytes = match project::read_bounded(Path::new(path), MAX_PACKAGE_BYTES.value) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            let mut report = Report::default();
            report.push(
                Diagnostic::error(
                    "package.archive_size",
                    "the file is larger than a package can be",
                )
                .in_file(path.clone()),
            );
            emit(&report, None, format, false, "inspect");
            return Ok(ExitCode::from(1));
        }
        Err(error) => return Err(format!("cannot read {path}: {error}")),
    };
    let package = match read_package(&bytes) {
        Ok(package) => package,
        Err(error) => {
            let inner = match error {
                overcrow_widget_schema::package::PackageError::Manifest(inner) => {
                    format!(" ({})", inner.as_str())
                }
                overcrow_widget_schema::package::PackageError::View(inner) => {
                    format!(" ({})", inner.as_str())
                }
                _ => String::new(),
            };
            let mut report = Report::default();
            report.push(
                Diagnostic::error(
                    format!("package.{}", error.as_str()),
                    format!("the host would refuse this package{inner}"),
                )
                .in_file(path.clone()),
            );
            emit(&report, None, format, false, "inspect");
            return Ok(ExitCode::from(1));
        }
    };
    if let Err(error) = overcrow_widget_format::validate_package_style(&package) {
        let mut report = Report::default();
        report.push(
            Diagnostic::error(
                format!("style.{}", error.kind.as_str()),
                "the host would refuse this package's style sheet",
            )
            .in_file(path.clone()),
        );
        emit(&report, None, format, false, "inspect");
        return Ok(ExitCode::from(1));
    }
    match format {
        Format::Human => print!("{}", inspect::render(&package, bytes.len())),
        Format::Json => println!("{}", inspect::render_json(&package, bytes.len())),
    }
    Ok(ExitCode::SUCCESS)
}
