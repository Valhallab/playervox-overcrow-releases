//! `overcrow-widget`: the creator CLI of OverCrow widget API v1. See
//! `docs/content/en/cli.md` (the website's page) and `docs/cli.md`.

mod admit;
mod build;
mod bundle;
mod channel;
mod dev;
mod diag;
mod diff;
mod doctor;
mod download;
mod init;
mod inspect;
mod interrupt;
mod jsonpos;
mod lint;
mod permissions;
mod project;
mod runtime;
mod sanitize;
mod sdk;
mod snapshot;
mod sourcemap;
mod sources;
mod sourcetree;
mod test;
#[cfg(test)]
mod testzip;
mod typecheck;
mod watch;
mod zipread;

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
  overcrow-widget package [dir] [--out FILE] [--source-map FILE] [--format human|json] [--deny-warnings] [--no-typecheck]
  overcrow-widget inspect <file.ocpkg> [--format human|json]
  overcrow-widget dev [dir] [--format human|json] [--no-typecheck]
  overcrow-widget doctor [dir] [--format human|json] [--deny-warnings]
  overcrow-widget admit [dir | sources.zip] [--publisher HANDLE [--domain DOMAIN]...] [--previous FILE]
                        [--package FILE] [--source-map FILE] [--out DIR] [--format human|json] [--deny-warnings]
  overcrow-widget admit <file.ocpkg> --listing FILE [--publisher HANDLE] [--format human|json]
  overcrow-widget diff <old> <new> [--format human|json]   (folders or source .zip files)
  overcrow-widget test [dir] [--runtime PATH] [--offline] [--scenario NAME] [--update] [--format human|json] [--no-typecheck]
  overcrow-widget --version [--format json] | --help

Exit status: 0 success (warnings allowed), 1 errors found, 2 usage or I/O error.
`admit` ends with 1 when the submission would be refused.
`diff` ends with 0 whether or not the sources differ, 1 when a side is refused.
`test` ends with 1 when a scenario fails, 2 when no runtime can run.
`dev` runs until Ctrl+C (0), or ends with 1 when the overlay ends the session.
Guide: https://overcrow.playervox.com/docs/en/cli/";

/// Where the guide says how to choose a widget ID.
const ID_GUIDE: &str = "https://overcrow.playervox.com/docs/en/manifest/#identity-and-version";

/// Where the guide says how to install TypeScript and the SDK types into a
/// project.
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
    "--domain",
    "--previous",
    "--source-map",
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

    /// Every value of a repeatable option, in order.
    fn values<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.options
            .iter()
            .filter(move |(option, _)| option == name)
            .filter_map(|(_, value)| value.as_deref())
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
        Some("--version" | "-V")
            if args[1..] == ["--format", "json"] || args[1..] == ["--format=json"] =>
        {
            println!(
                "{}",
                serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "apiVersion": overcrow_widget_schema::API_VERSION,
                    "sdk": sdk::VERSION,
                    "runtime": runtime::pin_json(runtime::PIN.as_ref()),
                })
            );
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
        "diff" => run_diff(&arguments),
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
            "--offline",
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
            offline: arguments.flag("--offline"),
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
            "--domain",
            "--previous",
            "--source-map",
            "--out",
            "--format",
            "--deny-warnings",
        ],
        1,
    )?;
    let format = arguments.format()?;
    let publisher = publisher(arguments)?;
    let target = arguments.directory();
    let listing = arguments.value("--listing").map(Path::new);
    let source_map = arguments.value("--source-map");
    let mut report = Report::default();
    // A source ZIP is admitted from the private folder it is written to,
    // which lives until the end of the command.
    let mut work = None;
    let mut sources = None;
    let input = if target.is_dir() {
        if listing.is_some() {
            return Err("--listing is for an archive; a source directory has listing.json".into());
        }
        admit::Input::Source(&target)
    } else if sourcetree::is_zip(&target) && target.is_file() {
        if listing.is_some() {
            return Err("--listing is for a package; a source ZIP holds listing.json".into());
        }
        let Some(tree) = sourcetree::read(&sourcetree::Input::Archive(target.clone()), &mut report)
        else {
            let value = admit::refused_before_identity(&report, &publisher, None);
            match format {
                Format::Json => println!("{}", sanitize::json(&value.to_string())),
                Format::Human => {
                    emit(&report, None, format, false, "admit");
                    print!("{}", admit::render_human(&value));
                }
            }
            return Ok(ExitCode::from(1));
        };
        sources = Some(tree.summary_json());
        let folder = match sourcetree::materialize(&tree) {
            Ok(folder) => folder,
            Err(error) => {
                eprintln!("overcrow-widget: cannot write the sources into a work folder: {error}");
                return Ok(ExitCode::from(2));
            }
        };
        admit::Input::Source(work.insert(folder).path())
    } else if target.is_file() {
        if arguments.value("--package").is_some()
            || arguments.value("--out").is_some()
            || source_map.is_some()
        {
            return Err("--package, --out and --source-map need the sources".into());
        }
        admit::Input::Archive {
            package: &target,
            listing: listing.ok_or("admitting an archive needs --listing FILE")?,
        }
    } else {
        return Err(format!(
            "{} is not a directory, a source .zip or a package",
            target.display()
        ));
    };
    let options = admit::Options {
        publisher,
        package: arguments.value("--package").map(Path::new),
        previous: arguments.value("--previous").map(Path::new),
        source_map: source_map.is_some(),
        sources,
    };
    let outcome = admit::admit(&input, &options, &mut report);
    let deny_warnings = arguments.flag("--deny-warnings");
    let refused = outcome.admitted.is_none() || (deny_warnings && report.warnings() > 0);
    match format {
        Format::Json => println!("{}", sanitize::json(&outcome.report.to_string())),
        Format::Human => {
            let root = match input {
                admit::Input::Source(root) => Some(root),
                admit::Input::Archive { .. } => None,
            };
            emit(&report, root, format, deny_warnings, "admit");
            print!("{}", admit::render_human(&outcome.report));
        }
    }
    if refused {
        return Ok(ExitCode::from(1));
    }
    let Some(admitted) = &outcome.admitted else {
        return Ok(ExitCode::from(1));
    };
    if let Some(out) = arguments.value("--out")
        && let Err(error) = admit::write_bundle(Path::new(out), admitted)
    {
        eprintln!("overcrow-widget: cannot write the admission bundle {out}: {error}");
        return Ok(ExitCode::from(2));
    }
    if let (Some(path), Some(map)) = (source_map, &admitted.source_map)
        && let Err(error) = write_atomically(Path::new(path), map.as_bytes())
    {
        eprintln!("overcrow-widget: cannot write the code map {path}: {error}");
        return Ok(ExitCode::from(2));
    }
    Ok(ExitCode::SUCCESS)
}

/// `--publisher HANDLE` and its `--domain DOMAIN` options: the grammar of
/// the catalog (the creator space applies its registration policy).
/// `playervox` always owns `playervox.com`.
fn publisher(arguments: &Arguments) -> Result<admit::Publisher, String> {
    use overcrow_widget_schema::identifiers::{
        PLAYERVOX_DOMAIN, PLAYERVOX_HANDLE, domain_syntax, handle_syntax,
    };
    let mut domains: Vec<String> = arguments.values("--domain").map(str::to_owned).collect();
    let Some(handle) = arguments.value("--publisher") else {
        if domains.is_empty() {
            return Ok(admit::Publisher::Unknown);
        }
        return Err("--domain needs --publisher".into());
    };
    if handle_syntax(handle).is_err() {
        return Err(format!(
            "`{handle}` is not a publisher handle: 3 to 32 of a-z, 0-9 and -"
        ));
    }
    if let Some(domain) = domains.iter().find(|domain| domain_syntax(domain).is_err()) {
        return Err(format!("`{domain}` is not a publisher domain"));
    }
    if handle == PLAYERVOX_HANDLE && !domains.iter().any(|domain| domain == PLAYERVOX_DOMAIN) {
        domains.push(PLAYERVOX_DOMAIN.to_owned());
    }
    Ok(admit::Publisher::Handle {
        handle: handle.to_owned(),
        domains,
    })
}

fn run_diff(arguments: &Arguments) -> Result<ExitCode, String> {
    arguments.expect(&["--format"], 2)?;
    let format = arguments.format()?;
    let [old, new] = arguments.positional.as_slice() else {
        return Err("diff needs two sides: <old> <new>".into());
    };
    let side = |path: &String| {
        sourcetree::Input::of(Path::new(path))
            .ok_or_else(|| format!("{path} is not a folder or a source .zip"))
    };
    Ok(diff::run(&side(old)?, &side(new)?, format))
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
            if options.id.is_none() {
                println!(
                    "\nThe ID is {}.<name>: replace {} in manifest.json with your\n\
                     publisher handle before you submit ({ID_GUIDE})",
                    init::PLACEHOLDER_HANDLE,
                    init::PLACEHOLDER_HANDLE
                );
            }
            println!(
                "\nNext: cd {directory} && npm install && overcrow-widget check\n\
                 npm install brings TypeScript and @overcrow/sdk {}, which check uses to\n\
                 type-check the logic ({SDK_TYPES_GUIDE})",
                sdk::VERSION
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
        &[
            "--out",
            "--source-map",
            "--format",
            "--deny-warnings",
            "--no-typecheck",
        ]
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
    let source_map = arguments.value("--source-map").map(PathBuf::from);
    let options = build::Options {
        typecheck: !arguments.flag("--no-typecheck"),
        source_map: source_map.is_some(),
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
    if let (Some(path), Some(map)) = (&source_map, &built.source_map)
        && let Err(error) = write_atomically(path, map.as_bytes())
    {
        eprintln!("overcrow-widget: cannot write {}: {error}", path.display());
        return Ok(ExitCode::from(2));
    }
    let digest = hex(&sha256(&built.archive));
    match format {
        Format::Human => {
            println!(
                "{}  {} bytes  sha256 {digest}\n  logic.js {} bytes ({} modules linked)",
                out.display(),
                built.archive.len(),
                built.files["logic.js"].len(),
                built.modules
            );
            if let Some(path) = &source_map {
                println!(
                    "  code map {} (keep it private, never ship it)",
                    path.display()
                );
            }
        }
        Format::Json => println!(
            "{}",
            serde_json::json!({
                "package": out.display().to_string(),
                "bytes": built.archive.len(),
                "sha256": digest,
                "logicBytes": built.files["logic.js"].len(),
                "sourceMap": source_map.as_ref().map(|path| path.display().to_string()),
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
