//! `dev` and `doctor` end to end against a scripted overlay: a socket in a
//! private temporary `XDG_RUNTIME_DIR` that speaks the development channel
//! (`docs/dev-channel.md`) as the overlay does. The real overlay's side is
//! tested in the OverCrow host.

#![cfg(target_os = "linux")]

use std::io::{BufRead as _, BufReader};
use std::os::unix::fs::PermissionsExt as _;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use overcrow_widget_devchannel::{
    ClientMessage, EventKind, LogLevel, Platform, SOCKET_NAME, ServerMessage, WidgetState, digest,
    encode_server_message, read_client_frame,
};
use overcrow_widget_schema::package::read_package;

const BIN: &str = env!("CARGO_BIN_EXE_overcrow-widget");

fn runtime_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("runtime directory");
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).expect("private");
    dir
}

fn project(parent: &Path) -> PathBuf {
    let root = parent.join("widget");
    let output = Command::new(BIN)
        .args([
            "init",
            root.to_str().expect("UTF-8"),
            "--template",
            "counter",
        ])
        .output()
        .expect("init");
    assert!(output.status.success());
    root
}

fn send(stream: &mut UnixStream, message: &ServerMessage) {
    use std::io::Write as _;
    stream
        .write_all(&encode_server_message(message).expect("valid message"))
        .expect("send");
}

fn welcome() -> ServerMessage {
    ServerMessage::Welcome {
        protocol: 1,
        overlay: "overcrow 9.9.9-test".into(),
        platform: Platform::Linux,
        limits: overcrow_widget_devchannel::Limits::V1,
    }
}

/// What the scripted overlay saw.
#[derive(Debug, Default)]
struct Seen {
    installs: Vec<String>,
    removed: Vec<String>,
}

/// Accepts one client: welcome, then answers installs (with a hostile log)
/// and removes until the client leaves.
fn overlay(listener: UnixListener) -> std::thread::JoinHandle<Seen> {
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("the CLI connects");
        stream
            .set_read_timeout(Some(Duration::from_secs(30)))
            .expect("timeout");
        let mut seen = Seen::default();
        let hello = read_client_frame(&mut stream, &mut |_| {}).expect("hello");
        assert!(matches!(
            hello.message,
            ClientMessage::Hello { protocol: 1, .. }
        ));
        send(&mut stream, &welcome());
        while let Ok(frame) = read_client_frame(&mut stream, &mut |_| {}) {
            match frame.message {
                ClientMessage::Install {
                    request, sha256, ..
                } => {
                    let bytes = frame.package.expect("package bytes");
                    assert_eq!(digest(&bytes), sha256);
                    let id = read_package(&bytes).expect("a valid package").manifest.id;
                    seen.installs.push(sha256.clone());
                    send(
                        &mut stream,
                        &ServerMessage::Result {
                            request,
                            ok: true,
                            id: Some(id.clone()),
                            sha256: Some(sha256),
                            code: None,
                        },
                    );
                    send(
                        &mut stream,
                        &ServerMessage::Event {
                            kind: EventKind::Installed,
                            id: Some(id.clone()),
                            code: None,
                        },
                    );
                    send(
                        &mut stream,
                        &ServerMessage::State {
                            id: id.clone(),
                            state: WidgetState::Running,
                            failure: None,
                        },
                    );
                    send(
                        &mut stream,
                        &ServerMessage::Log {
                            id,
                            generation: 1,
                            level: LogLevel::Warn,
                            text: "\u{1b}]52;c;aGk=\u{7}evil\u{202e}txt\n\u{1b}[2Jsecond".into(),
                        },
                    );
                }
                ClientMessage::Remove { request, id } => {
                    seen.removed.push(id.clone());
                    send(
                        &mut stream,
                        &ServerMessage::Result {
                            request,
                            ok: true,
                            id: Some(id),
                            sha256: None,
                            code: None,
                        },
                    );
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        seen
    })
}

/// Lines of the child's standard output, as they come.
fn lines(child: &mut Child) -> mpsc::Receiver<String> {
    let stdout = child.stdout.take().expect("stdout");
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

fn wait_line(lines: &mpsc::Receiver<String>, all: &mut Vec<String>, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if let Ok(line) = lines.recv_timeout(Duration::from_millis(100)) {
            let found = line.contains(what);
            all.push(line);
            if found {
                return;
            }
        }
    }
    panic!("no line with {what:?} in {all:#?}");
}

#[test]
fn dev_installs_reloads_on_save_shows_safe_logs_and_removes_on_ctrl_c() {
    let runtime = runtime_dir();
    let listener = UnixListener::bind(runtime.path().join(SOCKET_NAME)).expect("socket");
    let server = overlay(listener);
    let root = project(runtime.path());
    let mut child = Command::new(BIN)
        .args(["dev", root.to_str().expect("UTF-8"), "--no-typecheck"])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("dev");
    let output = lines(&mut child);
    let mut all = Vec::new();
    wait_line(&output, &mut all, "connected to overcrow 9.9.9-test");
    wait_line(&output, &mut all, "installed com.example.widget sha256");
    wait_line(&output, &mut all, "second");
    // A save rebuilds and reloads (the license ships as written).
    let license = root.join("LICENSE");
    let text = std::fs::read_to_string(&license).expect("license");
    std::fs::write(&license, format!("{text}\nEdited.\n")).expect("edit");
    let before = all
        .iter()
        .filter(|line| line.contains("installed com.example.widget"))
        .count();
    loop {
        wait_line(&output, &mut all, "installed com.example.widget");
        let now = all
            .iter()
            .filter(|line| line.contains("installed com.example.widget"))
            .count();
        if now > before {
            break;
        }
    }
    // Ctrl+C removes the package, then the CLI leaves cleanly.
    // SAFETY: a signal to our own child.
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) };
    let status = child.wait().expect("dev ends");
    assert!(status.success(), "{status:?} {all:#?}");
    let seen = server.join().expect("overlay");
    assert_eq!(seen.installs.len(), 2, "{seen:?}");
    assert_ne!(seen.installs[0], seen.installs[1]);
    assert_eq!(seen.removed, ["com.example.widget"]);
    // The widget's text never reaches the terminal raw.
    while let Ok(line) = output.recv_timeout(Duration::from_millis(100)) {
        all.push(line);
    }
    let printed = all.join("\n");
    for forbidden in ['\u{1b}', '\u{7}', '\u{202e}'] {
        assert!(!printed.contains(forbidden), "{forbidden:?} in {printed}");
    }
    assert!(
        printed.contains("\\u{1b}]52;c;aGk=\\u{7}evil\\u{202e}txt"),
        "{printed}"
    );
    assert!(printed.contains("removed com.example.widget"), "{printed}");
}

#[test]
fn dev_without_an_overlay_says_how_to_start_one() {
    let runtime = runtime_dir();
    let root = project(runtime.path());
    let output = Command::new(BIN)
        .args(["dev", root.to_str().expect("UTF-8"), "--no-typecheck"])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .output()
        .expect("dev");
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("no OverCrow overlay"), "{stderr}");
    assert!(stderr.contains("overcrow-widget doctor"), "{stderr}");
}

#[test]
fn dev_refuses_a_socket_of_another_kind() {
    let runtime = runtime_dir();
    let root = project(runtime.path());
    // A regular file where the socket should be: not an overlay.
    std::fs::write(runtime.path().join(SOCKET_NAME), b"").expect("file");
    let output = Command::new(BIN)
        .args(["dev", root.to_str().expect("UTF-8"), "--no-typecheck"])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .output()
        .expect("dev");
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("not this user's overlay"));
}

#[test]
fn doctor_reports_the_overlay_and_the_project() {
    let runtime = runtime_dir();
    let root = project(runtime.path());
    // Without an overlay: a warning with the way to start one, exit 0
    // (warnings allowed), 1 with --deny-warnings.
    let doctor = |extra: &[&str]| {
        Command::new(BIN)
            .arg("doctor")
            .arg(&root)
            .args(extra)
            .env("XDG_RUNTIME_DIR", runtime.path())
            .output()
            .expect("doctor")
    };
    let output = doctor(&["--format", "json"]);
    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let objects: Vec<serde_json::Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).expect("JSON lines"))
        .collect();
    assert!(
        objects
            .iter()
            .any(|object| object["code"] == "doctor.development_off"),
        "{stdout}"
    );
    let facts = objects.last().expect("facts");
    assert_eq!(facts["type"], "doctor");
    assert_eq!(facts["development"]["active"], false);
    assert_eq!(facts["project"], true);
    assert_eq!(facts["sdk"], "1.0.0");
    assert_eq!(doctor(&["--deny-warnings"]).status.code(), Some(1));

    // With an overlay listening: its version.
    let listener = UnixListener::bind(runtime.path().join(SOCKET_NAME)).expect("socket");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("doctor connects");
        let _ = read_client_frame(&mut stream, &mut |_| {}).expect("hello");
        send(&mut stream, &welcome());
    });
    let output = doctor(&["--format", "json"]);
    server.join().expect("overlay");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let facts: serde_json::Value =
        serde_json::from_str(stdout.lines().last().expect("facts")).expect("JSON");
    assert_eq!(facts["development"]["active"], true, "{stdout}");
    assert_eq!(facts["development"]["overlay"], "overcrow 9.9.9-test");
}

#[test]
fn dev_json_output_is_safe_for_a_terminal_too() {
    let runtime = runtime_dir();
    let listener = UnixListener::bind(runtime.path().join(SOCKET_NAME)).expect("socket");
    let server = overlay(listener);
    let root = project(runtime.path());
    let mut child = Command::new(BIN)
        .args([
            "dev",
            root.to_str().expect("UTF-8"),
            "--no-typecheck",
            "--format",
            "json",
        ])
        .env("XDG_RUNTIME_DIR", runtime.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("dev");
    let output = lines(&mut child);
    let mut all = Vec::new();
    wait_line(&output, &mut all, r#""type":"log""#);
    // SAFETY: a signal to our own child.
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) };
    assert!(child.wait().expect("dev ends").success());
    server.join().expect("overlay");
    let log = all
        .iter()
        .find(|line| line.contains(r#""type":"log""#))
        .expect("the log line");
    assert!(!log.contains(['\u{1b}', '\u{7}', '\u{202e}']), "{log:?}");
    let value: serde_json::Value = serde_json::from_str(log).expect("JSON");
    assert_eq!(
        value["text"],
        "\u{1b}]52;c;aGk=\u{7}evil\u{202e}txt\n\u{1b}[2Jsecond"
    );
}
