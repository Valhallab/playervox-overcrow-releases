//! The development channel of widget API v1: how `overcrow-widget dev`
//! drives a running OverCrow overlay (`docs/dev-channel.md`).
//!
//! The channel only exists in an overlay that allows development installs,
//! and only between processes of the same user: a Unix socket in
//! `$XDG_RUNTIME_DIR` on Linux, a named pipe restricted to the user's SID on
//! Windows. Both ends check the other's identity. This crate holds what the
//! two ends share: the messages, their bounds and the framing. It has no
//! transport.
//!
//! Every message is one frame: a big-endian `u32` length, then that many
//! bytes of a UTF-8 JSON object whose `type` names the message. Unknown
//! types, unknown fields, missing fields and out-of-bound values are
//! refused. An `install` frame is followed by exactly `packageBytes` raw
//! bytes: the `.ocpkg` archive, whose SHA-256 the header states.

use std::io::{self, Read, Write};
use std::time::Duration;

use overcrow_widget_schema::limits;
use overcrow_widget_schema::manifest::valid_widget_id;
use overcrow_widget_schema::package::{hex, sha256};
use serde::{Deserialize, Serialize};

/// The protocol this crate speaks.
pub const PROTOCOL_VERSION: u32 = 1;
/// The versions an overlay built from this crate accepts.
pub const SUPPORTED_PROTOCOLS: &[u32] = &[PROTOCOL_VERSION];

/// A client header, in bytes (the JSON object, without the length).
pub const MAX_CLIENT_HEADER_BYTES: u32 = 16 * 1024;
/// A server message, in bytes: a log text of `MAX_LOG_TEXT_BYTES` fits even
/// when every character is escaped.
pub const MAX_SERVER_FRAME_BYTES: u32 = 64 * 1024;
/// The package of an `install`: the schema's archive bound.
pub const MAX_PACKAGE_BYTES: u64 = limits::MAX_PACKAGE_BYTES.value;
/// The text of one widget log line: the VM's own bound.
pub const MAX_LOG_TEXT_BYTES: u64 = limits::MAX_LOG_BYTES.value;
/// Client and overlay names (`overcrow-widget 0.1.0`).
pub const MAX_NAME_BYTES: usize = 64;
/// Refusal and failure codes (`[a-z0-9_]`).
pub const MAX_CODE_BYTES: usize = 64;
/// Widgets listed by one `status`.
pub const MAX_STATUS_WIDGETS: usize = 64;

/// Sessions an overlay serves at once; the next one is refused.
pub const MAX_SESSIONS: usize = 4;
/// Requests per second of one session, and the burst above it.
pub const REQUESTS_PER_SECOND: u32 = 10;
pub const REQUEST_BURST: u32 = 20;
/// Messages and bytes waiting for one client. Logs, states and events
/// beyond are dropped and counted (`dropped`); answers never are.
pub const MAX_OUTBOUND_MESSAGES: usize = 512;
pub const MAX_OUTBOUND_BYTES: usize = 2 * 1024 * 1024;

/// The client's `hello` must arrive within this delay of the connection.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(2);
/// A frame whose first byte arrived must be complete within this delay.
pub const FRAME_TIMEOUT: Duration = Duration::from_secs(10);
/// A message must be written to the client within this delay.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the CLI waits for the answer of a `remove` when it stops.
pub const REMOVE_TIMEOUT: Duration = Duration::from_secs(2);

/// Linux: the socket's file name in `$XDG_RUNTIME_DIR`.
pub const SOCKET_NAME: &str = "overcrow-widget-development.sock";
/// Windows: the pipe name's prefix; the user's SID string follows.
pub const PIPE_PREFIX: &str = r"\\.\pipe\overcrow-widget-development-";

/// Refusal codes: the overlay closes the connection after `refused`.
pub mod refusal {
    pub const UNSUPPORTED_PROTOCOL: &str = "unsupported_protocol";
    pub const TOO_MANY_SESSIONS: &str = "too_many_sessions";
    pub const RATE_LIMITED: &str = "rate_limited";
    /// A malformed, unknown or out-of-bound frame, or a message before
    /// `hello`.
    pub const PROTOCOL_ERROR: &str = "protocol_error";
    pub const TIMEOUT: &str = "timeout";
}

/// Failure codes of `result` that the channel itself gives; the overlay's
/// validation categories (`invalid_bundle`, `reserved_id`…) pass through.
pub mod failure {
    /// Another install or remove is in flight: retry after its answer.
    pub const BUSY: &str = "busy";
    /// Another session owns this widget.
    pub const CONFLICT: &str = "conflict";
    /// This session installed no development widget with this ID.
    pub const NOT_INSTALLED: &str = "not_installed";
    /// The package's bytes do not match the SHA-256 of the header.
    pub const DIGEST_MISMATCH: &str = "digest_mismatch";
    pub const DEVELOPMENT_DISABLED: &str = "development_disabled";
    /// The overlay could not start its widget runtime.
    pub const UNAVAILABLE: &str = "unavailable";
}

// ---------------------------------------------------------------------
// Messages.

/// What the CLI sends. `hello` comes first, once, and its shape is the
/// same in every protocol version, so that an overlay can always answer
/// `unsupported_protocol`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientMessage {
    Hello {
        protocol: u32,
        /// `overcrow-widget <version>`, for the overlay's diagnostics.
        client: String,
    },
    /// Installs or reloads a development package; its bytes follow.
    #[serde(rename_all = "camelCase")]
    Install {
        request: u64,
        package_bytes: u64,
        /// Lowercase hexadecimal SHA-256 of the package.
        sha256: String,
    },
    /// Removes a development package this session installed.
    Remove { request: u64, id: String },
    /// The development widgets and their states.
    Status { request: u64 },
}

/// What the overlay sends.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ServerMessage {
    /// The answer to `hello`.
    Welcome {
        protocol: u32,
        /// `overcrow <version>`.
        overlay: String,
        platform: Platform,
        limits: Limits,
    },
    /// The overlay closes the connection after this message.
    Refused {
        code: String,
        /// With `unsupported_protocol`: the versions it speaks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        supported: Option<Vec<u32>>,
    },
    /// The answer to `install` or `remove`: `ok` with the widget's ID (and
    /// the accepted package's SHA-256 for an install), or a failure `code`.
    Result {
        request: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sha256: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// The answer to `status`.
    Status {
        request: u64,
        widgets: Vec<WidgetStatus>,
    },
    /// A development package was installed, failed or removed (the
    /// overlay's `DevelopmentInstalled`, `DevelopmentFailed` and
    /// `DevelopmentRemoved`), sent to the session that owns it.
    Event {
        kind: EventKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// A development widget changed state.
    State {
        id: String,
        state: WidgetState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<String>,
    },
    /// A `log` of the widget's logic. The text is the widget's own:
    /// untrusted, to be neutralized before it reaches a terminal.
    Log {
        id: String,
        generation: u64,
        level: LogLevel,
        text: String,
    },
    /// Logs, states or events dropped since the last message, because the
    /// client did not read fast enough.
    Dropped { count: u64 },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Platform {
    Linux,
    Windows,
}

/// The bounds the overlay applies, for the client's information.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_header_bytes: u32,
    pub max_package_bytes: u64,
    pub max_sessions: u32,
    pub requests_per_second: u32,
    pub request_burst: u32,
}

impl Limits {
    /// The bounds of this protocol version.
    pub const V1: Self = Self {
        max_header_bytes: MAX_CLIENT_HEADER_BYTES,
        max_package_bytes: MAX_PACKAGE_BYTES,
        max_sessions: MAX_SESSIONS as u32,
        requests_per_second: REQUESTS_PER_SECOND,
        request_burst: REQUEST_BURST,
    };
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetStatus {
    pub id: String,
    pub state: WidgetState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Installed,
    Failed,
    Removed,
}

/// Where a development widget stands.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetState {
    /// Waiting for the registry, the sandbox or the VM.
    Starting,
    Running,
    /// The VM failed and restarts on its own.
    Restarting,
    /// The VM failed and waits for a reload.
    Failed,
    /// The widget did not start.
    Refused,
    Stopped,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

// ---------------------------------------------------------------------
// Validation beyond the shapes.

/// Why a frame was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameError {
    /// The peer closed the connection between two frames.
    Closed,
    /// The connection failed or was cut inside a frame.
    Io(io::ErrorKind),
    /// A length of zero or above the bound.
    FrameSize,
    /// Not a JSON object of a known message with exactly its fields.
    Malformed,
    /// A known message with a value out of its bounds.
    Invalid(&'static str),
    /// An install's bytes do not match its header's SHA-256. The stream is
    /// still in step: the session can answer and go on.
    Digest { request: u64 },
}

impl FrameError {
    /// Whether the connection can go on after this error.
    pub fn recoverable(self) -> bool {
        matches!(self, Self::Digest { .. })
    }
}

impl From<io::Error> for FrameError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.kind())
    }
}

/// A code of `refused`, `result`, `event` or `state`: `[a-z0-9_]`, bounded.
pub fn valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_CODE_BYTES
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// A client or overlay name: printable ASCII, bounded.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && name.bytes().all(|byte| (b' '..=b'~').contains(&byte))
}

/// A lowercase hexadecimal SHA-256.
pub fn valid_digest(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The lowercase hexadecimal SHA-256 of a package.
pub fn digest(bytes: &[u8]) -> String {
    hex(&sha256(bytes))
}

impl ClientMessage {
    /// The bounds of every value. A `hello` of another protocol version is
    /// valid here: the overlay answers it with `unsupported_protocol`.
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Hello { client, .. } => valid_name(client).then_some(()).ok_or("client"),
            Self::Install {
                request,
                package_bytes,
                sha256,
            } => {
                request_id(*request)?;
                if !(1..=MAX_PACKAGE_BYTES).contains(package_bytes) {
                    return Err("package_bytes");
                }
                valid_digest(sha256).then_some(()).ok_or("sha256")
            }
            Self::Remove { request, id } => {
                request_id(*request)?;
                valid_widget_id(id).then_some(()).ok_or("id")
            }
            Self::Status { request } => request_id(*request),
        }
    }

    /// The request number of a request (every message but `hello`).
    pub fn request(&self) -> Option<u64> {
        match self {
            Self::Hello { .. } => None,
            Self::Install { request, .. }
            | Self::Remove { request, .. }
            | Self::Status { request } => Some(*request),
        }
    }
}

fn request_id(request: u64) -> Result<(), &'static str> {
    (request != 0).then_some(()).ok_or("request")
}

fn optional(value: Option<&String>, valid: fn(&str) -> bool) -> bool {
    value.is_none_or(|value| valid(value))
}

impl ServerMessage {
    /// The bounds of every value; a client refuses an overlay that breaks
    /// them.
    pub fn validate(&self) -> Result<(), &'static str> {
        let ok = match self {
            Self::Welcome {
                overlay, limits, ..
            } => {
                valid_name(overlay)
                    && limits.max_header_bytes > 0
                    && limits.max_package_bytes > 0
                    && limits.max_sessions > 0
            }
            Self::Refused { code, supported } => {
                valid_code(code) && supported.as_ref().is_none_or(|list| list.len() <= 16)
            }
            Self::Result {
                request,
                ok,
                id,
                sha256,
                code,
            } => {
                *request != 0
                    && optional(id.as_ref(), valid_widget_id)
                    && optional(sha256.as_ref(), valid_digest)
                    && optional(code.as_ref(), valid_code)
                    && (*ok == code.is_none())
            }
            Self::Status { request, widgets } => {
                *request != 0
                    && widgets.len() <= MAX_STATUS_WIDGETS
                    && widgets.iter().all(|widget| {
                        valid_widget_id(&widget.id) && optional(widget.failure.as_ref(), valid_code)
                    })
            }
            Self::Event { kind, id, code } => {
                optional(id.as_ref(), valid_widget_id)
                    && optional(code.as_ref(), valid_code)
                    && (*kind == EventKind::Failed) == code.is_some()
                    && (*kind == EventKind::Failed || id.is_some())
            }
            Self::State { id, failure, .. } => {
                valid_widget_id(id) && optional(failure.as_ref(), valid_code)
            }
            Self::Log { id, text, .. } => {
                valid_widget_id(id) && text.len() as u64 <= MAX_LOG_TEXT_BYTES
            }
            Self::Dropped { count } => *count > 0,
        };
        ok.then_some(()).ok_or("value")
    }

    /// Whether this message answers a request. Answers are never dropped;
    /// the other messages are when the client falls behind.
    pub fn is_answer(&self) -> bool {
        matches!(
            self,
            Self::Welcome { .. } | Self::Refused { .. } | Self::Result { .. } | Self::Status { .. }
        )
    }
}

// ---------------------------------------------------------------------
// Framing.

/// A client frame: its message and, for an install, the package.
#[derive(Debug, Eq, PartialEq)]
pub struct ClientFrame {
    pub message: ClientMessage,
    pub package: Option<Vec<u8>>,
}

/// Writes a client frame. `package` must be given with an install, and only
/// then.
pub fn write_client_frame(
    output: &mut impl Write,
    message: &ClientMessage,
    package: Option<&[u8]>,
) -> io::Result<()> {
    let invalid = |what| io::Error::new(io::ErrorKind::InvalidInput, what);
    message.validate().map_err(invalid)?;
    match (message, package) {
        (ClientMessage::Install { package_bytes, .. }, Some(bytes))
            if *package_bytes == bytes.len() as u64 => {}
        (ClientMessage::Install { .. }, _) | (_, Some(_)) => {
            return Err(invalid("package"));
        }
        _ => {}
    }
    let header = encode(message, MAX_CLIENT_HEADER_BYTES).map_err(|_| invalid("header"))?;
    output.write_all(&header)?;
    if let Some(bytes) = package {
        output.write_all(bytes)?;
    }
    output.flush()
}

/// Reads one client frame. `started` runs once the first byte arrived, so
/// that the transport can arm [`FRAME_TIMEOUT`] for the rest of the frame
/// while an idle session waits without a deadline.
pub fn read_client_frame<R: Read>(
    input: &mut R,
    started: &mut dyn FnMut(&mut R),
) -> Result<ClientFrame, FrameError> {
    let header = read_header(input, MAX_CLIENT_HEADER_BYTES, started)?;
    let message: ClientMessage = parse(&header)?;
    message.validate().map_err(FrameError::Invalid)?;
    let ClientMessage::Install {
        request,
        package_bytes,
        sha256,
    } = &message
    else {
        return Ok(ClientFrame {
            message,
            package: None,
        });
    };
    // Read in bounded steps: the declared size is only allocated as it
    // arrives.
    let mut package = Vec::with_capacity((*package_bytes).min(64 * 1024) as usize);
    let read = input.take(*package_bytes).read_to_end(&mut package)?;
    if read as u64 != *package_bytes {
        return Err(FrameError::Io(io::ErrorKind::UnexpectedEof));
    }
    if digest(&package) != *sha256 {
        return Err(FrameError::Digest { request: *request });
    }
    Ok(ClientFrame {
        message,
        package: Some(package),
    })
}

/// A server message as a frame, for the overlay's outbound queue.
pub fn encode_server_message(message: &ServerMessage) -> Result<Vec<u8>, FrameError> {
    message.validate().map_err(FrameError::Invalid)?;
    encode(message, MAX_SERVER_FRAME_BYTES)
}

/// Reads and validates one server message.
pub fn read_server_message(input: &mut impl Read) -> Result<ServerMessage, FrameError> {
    let header = read_header(input, MAX_SERVER_FRAME_BYTES, &mut |_| {})?;
    let message: ServerMessage = parse(&header)?;
    message.validate().map_err(FrameError::Invalid)?;
    Ok(message)
}

/// A JSON object of one message. serde also reads an internally tagged
/// enum from an array; only the object form is the protocol.
fn parse<T: serde::de::DeserializeOwned>(header: &[u8]) -> Result<T, FrameError> {
    if header.first() != Some(&b'{') {
        return Err(FrameError::Malformed);
    }
    serde_json::from_slice(header).map_err(|_| FrameError::Malformed)
}

fn encode(message: &impl Serialize, bound: u32) -> Result<Vec<u8>, FrameError> {
    let json = serde_json::to_vec(message).map_err(|_| FrameError::Malformed)?;
    let length = u32::try_from(json.len())
        .ok()
        .filter(|length| (1..=bound).contains(length))
        .ok_or(FrameError::FrameSize)?;
    let mut frame = Vec::with_capacity(4 + json.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&json);
    Ok(frame)
}

fn read_header<R: Read>(
    input: &mut R,
    bound: u32,
    started: &mut dyn FnMut(&mut R),
) -> Result<Vec<u8>, FrameError> {
    let mut length = [0; 4];
    loop {
        match input.read(&mut length[..1]) {
            Ok(0) => return Err(FrameError::Closed),
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error.into()),
        }
    }
    started(input);
    input.read_exact(&mut length[1..])?;
    let length = u32::from_be_bytes(length);
    if !(1..=bound).contains(&length) {
        return Err(FrameError::FrameSize);
    }
    let mut header = vec![0; length as usize];
    input.read_exact(&mut header)?;
    Ok(header)
}

// ---------------------------------------------------------------------
// Rate.

/// The request budget of one session: [`REQUESTS_PER_SECOND`] with a burst
/// of [`REQUEST_BURST`] (a token bucket, in milliseconds of the caller's
/// clock).
#[derive(Clone, Debug)]
pub struct RequestBudget {
    /// Tokens, in thousandths.
    tokens: u64,
    last_ms: u64,
}

impl RequestBudget {
    pub fn new(now_ms: u64) -> Self {
        Self {
            tokens: u64::from(REQUEST_BURST) * 1000,
            last_ms: now_ms,
        }
    }

    /// Takes one request; `false` when the session went above its rate.
    pub fn take(&mut self, now_ms: u64) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_ms);
        self.last_ms = self.last_ms.max(now_ms);
        let refill = elapsed.saturating_mul(u64::from(REQUESTS_PER_SECOND));
        self.tokens = self
            .tokens
            .saturating_add(refill)
            .min(u64::from(REQUEST_BURST) * 1000);
        if self.tokens < 1000 {
            return false;
        }
        self.tokens -= 1000;
        true
    }
}
