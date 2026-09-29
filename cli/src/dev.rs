//! `overcrow-widget dev [dir]`: builds the widget, installs it in the
//! running overlay through the development channel, rebuilds and reloads
//! it when a source changes, shows the check diagnostics, the widget's
//! states and its logs, and removes it on Ctrl+C.
//!
//! The overlay validates every package as it would any sideload and shows
//! it unverified; nothing the CLI sends bypasses that. Everything the
//! overlay relays from the widget is neutralized before it is printed
//! (`sanitize`).
//!
//! Event replay and service fixtures (P2.3) will be further requests of the
//! channel, sent from this loop ([`Session`]).

use std::io::Write as _;
use std::path::Path;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use overcrow_widget_devchannel::{
    ClientMessage, EventKind, FrameError, LogLevel, ServerMessage, WidgetState, digest, failure,
};

use crate::channel::{Client, ConnectError};
use crate::diag::Report;
use crate::watch::Snapshot;
use crate::{Format, build, emit, interrupt, sanitize};

/// How often the loop looks at the channel and the files.
const TICK: Duration = Duration::from_millis(250);
/// Changes are rebuilt once the files stayed the same this long.
const DEBOUNCE: Duration = Duration::from_millis(200);
/// A `busy` install is retried after this delay.
const RETRY: Duration = Duration::from_millis(500);
/// Lines of one log message shown.
const MAX_LOG_LINES: usize = 20;

pub struct Options {
    pub typecheck: bool,
    pub format: Format,
}

/// A built package waiting to be sent.
struct Package {
    bytes: Vec<u8>,
    digest: String,
}

enum Pending {
    Install { request: u64, digest: String },
    Remove { request: u64 },
}

/// The loop's state; P2.3's replay and fixtures add their requests here.
struct Session {
    client: Client,
    format: Format,
    /// The widget this session installed.
    installed: Option<String>,
    pending: Option<Pending>,
    /// The latest build not sent yet, and when to send it.
    waiting: Option<(Package, Instant)>,
    /// The package in flight, sent again after `busy`.
    retry: Option<Package>,
    /// The digest last accepted, so an unchanged rebuild sends nothing.
    accepted: Option<String>,
    /// A file only `tsc` reads changed since the last build.
    types_pending: bool,
}

/// How a session ended.
enum End {
    Stopped,
    Closed(String),
}

pub fn run(root: &Path, options: &Options) -> ExitCode {
    interrupt::install();
    let client = match Client::connect() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("overcrow-widget dev: {error}");
            if matches!(error, ConnectError::Absent) {
                eprintln!(
                    "  = help: start OverCrow with development installs allowed; \
                     `overcrow-widget doctor` shows how"
                );
            }
            return ExitCode::from(2);
        }
    };
    let mut session = Session {
        format: options.format,
        client,
        installed: None,
        pending: None,
        waiting: None,
        retry: None,
        accepted: None,
        types_pending: false,
    };
    session.note(&format!(
        "connected to {} ({})",
        sanitize::line(&session.client.overlay.name),
        match session.client.overlay.platform {
            overcrow_widget_devchannel::Platform::Linux => "Linux",
            overcrow_widget_devchannel::Platform::Windows => "Windows",
        }
    ));
    let mut snapshot = Snapshot::take(root);
    session.rebuild(root, options.typecheck);
    let mut changed: Option<Instant> = None;
    let end = loop {
        if interrupt::requested() {
            break End::Stopped;
        }
        if let Err(end) = session.receive(TICK) {
            break end;
        }
        let now = Snapshot::take(root);
        if now != snapshot {
            let types = options.typecheck && now.types_changed(&snapshot);
            snapshot = now;
            changed = Some(Instant::now());
            if types {
                session.types_pending = true;
            }
        }
        if changed.is_some_and(|at| at.elapsed() >= DEBOUNCE) {
            changed = None;
            let typecheck = std::mem::take(&mut session.types_pending);
            session.rebuild(root, typecheck);
        }
        if let Err(end) = session.send_waiting() {
            break end;
        }
    };
    match end {
        End::Stopped => {
            session.stop();
            ExitCode::SUCCESS
        }
        End::Closed(why) => {
            session.note(&why);
            ExitCode::from(1)
        }
    }
}

impl Session {
    fn json(&self) -> bool {
        self.format == Format::Json
    }

    fn note(&self, text: &str) {
        if self.json() {
            println!("{}", serde_json::json!({"type": "dev", "message": text}));
        } else {
            println!("{} {text}", clock());
        }
        let _ = std::io::stdout().flush();
    }

    /// Builds the package; a clean build waits to be sent.
    fn rebuild(&mut self, root: &Path, typecheck: bool) {
        let mut report = Report::default();
        let built = build::build(root, &build::Options { typecheck }, &mut report);
        let failed = emit(&report, Some(root), self.format, false, "check");
        let Some(built) = built.filter(|_| !failed) else {
            self.note("the widget has errors: fix them, it rebuilds on save");
            return;
        };
        let digest = digest(&built.archive);
        if self.accepted.as_deref() == Some(digest.as_str()) {
            return;
        }
        if self.json() {
            println!(
                "{}",
                serde_json::json!({
                    "type": "built",
                    "id": built.manifest.id,
                    "version": built.manifest.version.to_string(),
                    "bytes": built.archive.len(),
                    "sha256": digest,
                })
            );
        } else {
            self.note(&format!(
                "built {} {} ({} bytes, logic.js {} bytes)",
                built.manifest.id,
                built.manifest.version,
                built.archive.len(),
                built.files["logic.js"].len()
            ));
        }
        self.waiting = Some((
            Package {
                bytes: built.archive,
                digest,
            },
            Instant::now(),
        ));
    }

    /// Sends the waiting build once nothing is in flight.
    fn send_waiting(&mut self) -> Result<(), End> {
        if self.pending.is_some() {
            return Ok(());
        }
        let Some((_, at)) = &self.waiting else {
            return Ok(());
        };
        if Instant::now() < *at {
            return Ok(());
        }
        let (package, _) = self.waiting.take().expect("checked above");
        let request = self.client.request();
        self.client
            .send(
                &ClientMessage::Install {
                    request,
                    package_bytes: package.bytes.len() as u64,
                    sha256: package.digest.clone(),
                },
                Some(&package.bytes),
            )
            .map_err(|error| End::Closed(format!("the overlay closed the channel: {error}")))?;
        self.pending = Some(Pending::Install {
            request,
            digest: package.digest.clone(),
        });
        // Kept for a retry after `busy`.
        self.retry = Some(package);
        Ok(())
    }

    fn receive(&mut self, timeout: Duration) -> Result<(), End> {
        match self.client.receive(timeout) {
            Ok(Some(message)) => self.handle(message),
            Ok(None) => Ok(()),
            Err(FrameError::Closed) => Err(End::Closed(
                "the overlay closed the development channel (it quit or restarted)".into(),
            )),
            Err(error) => Err(End::Closed(format!(
                "the development channel failed ({error:?})"
            ))),
        }
    }

    fn handle(&mut self, message: ServerMessage) -> Result<(), End> {
        if self.json() {
            // The protocol's own JSON; strings are escaped by the encoder.
            if let Ok(line) = serde_json::to_string(&message) {
                println!("{line}");
            }
        }
        match message {
            ServerMessage::Result {
                request,
                ok,
                id,
                sha256,
                code,
            } => return self.answer(request, ok, id, sha256, code),
            ServerMessage::Event { kind, id, code } if !self.json() => {
                let id = id.as_deref().map_or(String::new(), sanitize::line);
                match kind {
                    EventKind::Installed => {
                        self.note(&format!("{id}: running unverified in the overlay"));
                    }
                    EventKind::Removed => self.note(&format!("{id}: removed")),
                    EventKind::Failed => self.note(&format!(
                        "the overlay refused the package ({})",
                        code.as_deref().map_or(String::new(), sanitize::line)
                    )),
                }
            }
            ServerMessage::State { id, state, failure } if !self.json() => {
                let failure = failure
                    .as_deref()
                    .map(|failure| format!(" ({})", sanitize::line(failure)))
                    .unwrap_or_default();
                self.note(&format!(
                    "{}: {}{failure}",
                    sanitize::line(&id),
                    state_name(state)
                ));
            }
            ServerMessage::Log {
                id, level, text, ..
            } if !self.json() => {
                for line in sanitize::terminal(&text, MAX_LOG_LINES) {
                    println!(
                        "{} {} {}: {line}",
                        clock(),
                        level_name(level),
                        sanitize::line(&id)
                    );
                }
            }
            ServerMessage::Dropped { count } if !self.json() => {
                self.note(&format!(
                    "{count} message(s) of the overlay dropped (the terminal fell behind)"
                ));
            }
            ServerMessage::Refused { code, .. } => {
                return Err(End::Closed(format!(
                    "the overlay ended the session ({})",
                    sanitize::line(&code)
                )));
            }
            _ => {}
        }
        let _ = std::io::stdout().flush();
        Ok(())
    }

    fn answer(
        &mut self,
        request: u64,
        ok: bool,
        id: Option<String>,
        sha256: Option<String>,
        code: Option<String>,
    ) -> Result<(), End> {
        let (matches, install) = match &self.pending {
            Some(Pending::Install { request: sent, .. }) => (*sent == request, true),
            Some(Pending::Remove { request: sent }) => (*sent == request, false),
            None => (false, false),
        };
        if !matches {
            return Ok(());
        }
        let pending = self.pending.take();
        let retry = self.retry.take();
        if !install {
            if ok && !self.json() {
                self.note(&format!(
                    "removed {}",
                    id.as_deref().map_or(String::new(), sanitize::line)
                ));
            }
            return Ok(());
        }
        let Some(Pending::Install { digest, .. }) = pending else {
            return Ok(());
        };
        if ok {
            if sha256.as_deref() != Some(digest.as_str()) {
                return Err(End::Closed(
                    "the overlay accepted another package than the one sent".into(),
                ));
            }
            self.installed = id.clone();
            self.accepted = Some(digest.clone());
            if !self.json() {
                self.note(&format!(
                    "installed {} sha256 {digest}",
                    id.as_deref().map_or(String::new(), sanitize::line)
                ));
            }
            return Ok(());
        }
        let code = code.unwrap_or_default();
        if code == failure::BUSY {
            // Another session's operation: send this build again shortly,
            // unless a newer one is already waiting.
            if self.waiting.is_none()
                && let Some(package) = retry
            {
                self.waiting = Some((package, Instant::now() + RETRY));
            }
            return Ok(());
        }
        if !self.json() {
            self.note(&format!(
                "the overlay refused the package: {}{}",
                sanitize::line(&code),
                refusal_help(&code)
            ));
        }
        Ok(())
    }

    /// Ctrl+C: removes the widget this session installed, waiting briefly
    /// for the answer. Closing the channel removes it too, whatever
    /// happens here.
    fn stop(&mut self) {
        let Some(id) = self.installed.take() else {
            return;
        };
        let request = self.client.request();
        if self
            .client
            .send(&ClientMessage::Remove { request, id }, None)
            .is_err()
        {
            return;
        }
        self.pending = Some(Pending::Remove { request });
        let deadline = Instant::now() + overcrow_widget_devchannel::REMOVE_TIMEOUT;
        while self.pending.is_some() && Instant::now() < deadline {
            if self
                .receive(deadline.saturating_duration_since(Instant::now()))
                .is_err()
            {
                break;
            }
        }
    }
}

fn refusal_help(code: &str) -> &'static str {
    match code {
        failure::CONFLICT => " (another `dev` session runs this widget ID)",
        failure::DEVELOPMENT_DISABLED => " (the overlay does not allow development installs)",
        failure::DIGEST_MISMATCH => " (the package was damaged in transit)",
        "invalid_bundle" => {
            " (the package fails the overlay's validation: a reserved `com.playervox.*` ID, or a newer overlay than this CLI)"
        }
        _ => "",
    }
}

fn state_name(state: WidgetState) -> &'static str {
    match state {
        WidgetState::Starting => "starting",
        WidgetState::Running => "running",
        WidgetState::Restarting => "restarting",
        WidgetState::Failed => "failed (waits for a reload)",
        WidgetState::Refused => "refused",
        WidgetState::Stopped => "stopped",
    }
}

fn level_name(level: LogLevel) -> &'static str {
    match level {
        LogLevel::Debug => "debug",
        LogLevel::Info => "info ",
        LogLevel::Warn => "warn ",
        LogLevel::Error => "error",
    }
}

/// Seconds since `dev` started, `[   12.3s]`.
fn clock() -> String {
    static STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let elapsed = STARTED.get_or_init(Instant::now).elapsed();
    format!("[{:>7.1}s]", elapsed.as_secs_f64())
}
