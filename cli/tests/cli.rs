//! End to end through the binary: `init` → `check` → `package` → the host's
//! `read_package`, determinism, `inspect`, and one golden rendering per
//! diagnostic domain. Regenerate the goldens with
//! `OVERCROW_UPDATE_GOLDEN=1 cargo test -p overcrow-widget-cli --test cli`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use overcrow_widget_format::validate_package_style;
use overcrow_widget_schema::package::read_package;

const TEMPLATES: [&str; 4] = ["blank", "counter", "list", "chart"];

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(args)
        .output()
        .expect("the CLI runs")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

/// A new project from `template` in a fresh temporary directory.
fn project(template: &str) -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = temporary.path().join(template);
    let output = cli(&[
        "init",
        root.to_str().expect("UTF-8 path"),
        "--template",
        template,
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    (temporary, root)
}

fn replace(root: &Path, file: &str, from: &str, to: &str) {
    let path = root.join(file);
    let content = fs::read_to_string(&path).expect("project file");
    assert!(content.contains(from), "{file} contains {from:?}");
    fs::write(&path, content.replacen(from, to, 1)).expect("write project file");
}

fn check(root: &Path, extra: &[&str]) -> Output {
    let mut args = vec![
        "check",
        root.to_str().expect("UTF-8 path"),
        "--no-typecheck",
    ];
    args.extend_from_slice(extra);
    cli(&args)
}

fn golden(name: &str, actual: &str) {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo");
    let path = PathBuf::from(manifest)
        .join("tests/golden")
        .join(format!("{name}.txt"));
    if std::env::var_os("OVERCROW_UPDATE_GOLDEN").is_some() {
        fs::create_dir_all(path.parent().expect("parent")).expect("golden directory");
        fs::write(&path, actual).expect("write golden");
        return;
    }
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
        .replace("\r\n", "\n");
    assert_eq!(
        actual, expected,
        "golden {name} differs; set OVERCROW_UPDATE_GOLDEN=1 to accept"
    );
}

/// Runs `check` on a broken project and compares its report.
fn golden_check(name: &str, root: &Path, extra: &[&str]) {
    let output = check(root, extra);
    assert_eq!(
        output.status.code(),
        Some(1),
        "{name} must fail: {}",
        text(&output.stderr)
    );
    golden(name, &(text(&output.stderr) + &text(&output.stdout)));
}

#[test]
fn every_template_checks_packages_and_reads_back() {
    for template in TEMPLATES {
        let (_temporary, root) = project(template);
        let checked = check(&root, &["--deny-warnings"]);
        assert!(
            checked.status.success(),
            "{template}: {}",
            text(&checked.stderr)
        );

        let first = root.join("first.ocpkg");
        let second = root.join("second.ocpkg");
        for out in [&first, &second] {
            let output = cli(&[
                "package",
                root.to_str().expect("UTF-8"),
                "--no-typecheck",
                "--out",
                out.to_str().expect("UTF-8"),
            ]);
            assert!(
                output.status.success(),
                "{template}: {}",
                text(&output.stderr)
            );
        }
        let bytes = fs::read(&first).expect("package written");
        assert_eq!(
            bytes,
            fs::read(&second).expect("second package"),
            "{template}: deterministic"
        );

        // The host's activation sequence.
        let package =
            read_package(&bytes).unwrap_or_else(|error| panic!("{template}: {}", error.as_str()));
        validate_package_style(&package).expect("style accepted");
        assert_eq!(package.manifest.id, format!("yourhandle.{template}"));
        let logic = package.file("logic.js").expect("logic.js");
        assert!(logic.starts_with(b"/*! @overcrow/sdk 1.0.0 | MIT-0 |"));
        assert!(
            package.file("view.ocml").is_none(),
            "the view source is not shipped"
        );

        let inspected = cli(&["inspect", first.to_str().expect("UTF-8")]);
        assert!(inspected.status.success());
        let report = text(&inspected.stdout);
        assert!(
            report.contains(&format!("yourhandle.{template} 0.1.0")),
            "{report}"
        );
        assert!(report.contains("@overcrow/sdk 1.0.0"));
        assert!(report.contains("ledger.json"));
    }
}

#[test]
fn the_default_output_is_under_dist() {
    let (_temporary, root) = project("counter");
    let output = cli(&[
        "package",
        root.to_str().expect("UTF-8"),
        "--no-typecheck",
        "--format",
        "json",
    ]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let summary: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("one JSON object");
    let path = PathBuf::from(summary["package"].as_str().expect("path"));
    assert!(path.ends_with(Path::new("dist").join("yourhandle.counter-0.1.0.ocpkg")));
    assert_eq!(
        summary["bytes"].as_u64(),
        Some(fs::metadata(&path).expect("package").len())
    );
}

/// `init` gives the next commands: `npm install` brings TypeScript and the
/// SDK of `package.json`, then `check`.
#[test]
fn init_advises_npm_install_then_check() {
    let temporary = tempfile::tempdir().expect("temporary directory");
    let root = temporary.path().join("blank");
    let output = cli(&["init", root.to_str().expect("UTF-8 path")]);
    assert!(output.status.success(), "{}", text(&output.stderr));
    let advice = text(&output.stdout);
    assert!(
        advice.contains("cd ") && advice.contains(" && npm install && overcrow-widget check"),
        "{advice}"
    );
    assert!(
        advice.contains("https://overcrow.playervox.com/docs/en/cli/#the-sdk-types"),
        "{advice}"
    );
}

#[test]
fn init_refuses_existing_content_and_unknown_templates() {
    let (_temporary, root) = project("blank");
    let again = cli(&["init", root.to_str().expect("UTF-8")]);
    assert_eq!(again.status.code(), Some(1));
    assert!(text(&again.stderr).contains("init.not_empty"));
    let temporary = tempfile::tempdir().expect("temporary directory");
    let unknown = cli(&[
        "init",
        temporary.path().join("x").to_str().expect("UTF-8"),
        "--template",
        "web",
    ]);
    assert_eq!(unknown.status.code(), Some(1));
    assert!(text(&unknown.stderr).contains("templates: blank, counter, list, chart"));
    let reserved = cli(&[
        "init",
        temporary.path().join("y").to_str().expect("UTF-8"),
        "--id",
        "com.playervox.clock",
    ]);
    assert_eq!(reserved.status.code(), Some(1));
}

#[test]
fn bad_usage_exits_2() {
    // Never a bare `dev` or `doctor` here: they would reach this user's
    // real overlay (tests/dev.rs gives them a private runtime directory).
    for args in [
        &["dev", "--bogus"][..],
        &["dev", "no-such-directory"],
        &["doctor", "--bogus"],
        &["frobnicate"],
        &["check", "--bogus"],
        &["inspect"],
    ] {
        let output = cli(args);
        assert_eq!(output.status.code(), Some(2), "{args:?}");
    }
}

#[test]
fn warnings_fail_only_with_deny_warnings() {
    let (_temporary, root) = project("counter");
    let path = root.to_str().expect("UTF-8");
    let plain = cli(&["check", path]);
    assert!(plain.status.success(), "{}", text(&plain.stderr));
    golden("typecheck_skipped", &text(&plain.stderr));
    let denied = cli(&["check", path, "--deny-warnings"]);
    assert_eq!(denied.status.code(), Some(1));
}

#[test]
fn inspect_refuses_what_the_host_refuses() {
    let (_temporary, root) = project("blank");
    let out = root.join("blank.ocpkg");
    let output = cli(&[
        "package",
        root.to_str().expect("UTF-8"),
        "--no-typecheck",
        "--out",
        out.to_str().expect("UTF-8"),
    ]);
    assert!(output.status.success());
    let mut bytes = fs::read(&out).expect("package");
    let last = bytes.len() - 30;
    bytes[last] ^= 0xff;
    fs::write(&out, bytes).expect("corrupt");
    let inspected = cli(&["inspect", out.to_str().expect("UTF-8"), "--format", "json"]);
    assert_eq!(inspected.status.code(), Some(1));
    let diagnostic: serde_json::Value =
        serde_json::from_slice(&inspected.stdout).expect("JSON line");
    assert!(
        diagnostic["code"]
            .as_str()
            .expect("code")
            .starts_with("package.")
    );
}

// ------------------------------------------------------------------ goldens

#[test]
fn golden_manifest() {
    let (_temporary, root) = project("counter");
    replace(&root, "manifest.json", "\"name\":", "\"nmae\":");
    golden_check("manifest_unknown_field", &root, &[]);
    replace(&root, "manifest.json", "\"nmae\":", "\"name\":");
    replace(
        &root,
        "manifest.json",
        "\"yourhandle.counter\"",
        "\"Counter\"",
    );
    golden_check("manifest_id", &root, &[]);
}

#[test]
fn golden_view() {
    let (_temporary, root) = project("counter");
    replace(
        &root,
        "view.ocml",
        "<text class=\"value\">",
        "<text clas=\"value\">",
    );
    golden_check("view_unknown_attribute", &root, &[]);
    golden_check("view_unknown_attribute_json", &root, &["--format", "json"]);
}

#[test]
fn golden_style() {
    let (_temporary, root) = project("counter");
    replace(
        &root,
        "style.ocss",
        "  gap: var(--space-2);\n  padding",
        "  gpa: var(--space-2);\n  padding",
    );
    golden_check("style_unknown_property", &root, &[]);
}

#[test]
fn golden_locales() {
    let (_temporary, root) = project("counter");
    replace(
        &root,
        "locales/fr.json",
        "  \"decrement\": \"Diminuer\",\n",
        "",
    );
    golden_check("locales_missing_key", &root, &[]);
}

#[test]
fn golden_logic() {
    let (_temporary, root) = project("counter");
    fs::write(
        root.join("logic.ts"),
        "import { initState } from \"@overcrow/sdk\";\n\
         import { debounce } from \"lodash\";\n\
         \n\
         const state = initState({ count: 0 });\n\
         \n\
         export function increment(): void {\n\
         \x20 state.count += 1;\n\
         \x20 console.log(new Intl.NumberFormat().format(state.count));\n\
         \x20 setTimeout(() => eval(\"1\"), 10);\n\
         }\n\
         \n\
         export const slow = debounce(increment);\n\
         await Promise.resolve();\n",
    )
    .expect("write logic.ts");
    golden_check("logic_rules", &root, &[]);
}

#[test]
fn golden_package() {
    let (_temporary, root) = project("counter");
    fs::create_dir_all(root.join("assets")).expect("assets");
    fs::write(root.join("assets/logo.png"), b"not a PNG").expect("asset");
    golden_check("package_asset", &root, &[]);
}

/// `check <dir>` with a relative `dir` runs the project's TypeScript: tsc
/// runs in the project directory, so its path must not repeat `dir`.
#[test]
fn a_relative_project_directory_runs_its_typescript() {
    if Command::new("node").arg("--version").output().is_err() {
        return;
    }
    let (temporary, root) = project("counter");
    // A stand-in tsc that records it ran, in the project directory.
    let tsc = root.join("node_modules/typescript/lib/tsc.js");
    fs::create_dir_all(tsc.parent().expect("lib")).expect("node_modules");
    fs::write(
        &tsc,
        "require('fs').writeFileSync('tsc-ran', process.argv.slice(2).join(' '));\n",
    )
    .expect("tsc stand-in");
    let output = Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(["check", "counter"])
        .current_dir(temporary.path())
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{}", text(&output.stderr));
    assert_eq!(
        fs::read_to_string(root.join("tsc-ran")).expect("tsc ran in the project"),
        "--noEmit --pretty false -p tsconfig.json"
    );
}

/// A CI sets `OVERCROW_PUBLISH_KEY` for a whole job: the CLI takes it out of
/// its environment before anything else, so `check` (tsc through Node.js),
/// `test` (the runtime) and the rest never pass it to a child process.
#[cfg(unix)]
#[test]
fn no_child_process_sees_the_publish_key() {
    use std::os::unix::fs::PermissionsExt as _;

    const KEY: &str = "ocw_pub_q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";
    let (temporary, root) = project("counter");
    let tsc = root.join("node_modules/typescript/lib/tsc.js");
    fs::create_dir_all(tsc.parent().expect("parent")).expect("typescript folder");
    fs::write(&tsc, "").expect("tsc");
    // A `node` that records the environment it was given.
    let bin = temporary.path().join("bin");
    fs::create_dir_all(&bin).expect("bin");
    let node = bin.join("node");
    fs::write(
        &node,
        "#!/bin/sh\n/usr/bin/env > \"$OVERCROW_TEST_ENV_DUMP\"\n",
    )
    .expect("node");
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).expect("executable");
    let dump = temporary.path().join("env.txt");
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let output = Command::new(env!("CARGO_BIN_EXE_overcrow-widget"))
        .args(["check", root.to_str().expect("UTF-8 path")])
        .env("PATH", path)
        .env("OVERCROW_TEST_ENV_DUMP", &dump)
        .env("OVERCROW_PUBLISH_KEY", KEY)
        .output()
        .expect("the CLI runs");
    let seen = fs::read_to_string(&dump)
        .unwrap_or_else(|_| panic!("the fake node did not run: {}", text(&output.stderr)));
    assert!(seen.contains("OVERCROW_TEST_ENV_DUMP="), "{seen}");
    assert!(!seen.contains("OVERCROW_PUBLISH_KEY"), "{seen}");
    assert!(!seen.contains(&KEY[8..]), "{seen}");
}
