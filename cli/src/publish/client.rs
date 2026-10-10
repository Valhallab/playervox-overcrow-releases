//! The HTTP client of `submit` and `status`: `ureq` through rustls, to
//! `https://api.playervox.com` (or `OVERCROW_API_URL`, for tests only).
//! Redirects are never followed, so the `Authorization` header never goes
//! anywhere else; the signed upload goes without it. Times and sizes are
//! bounded; idempotent requests are tried again after a cut connection or
//! a busy server. With `--verbose`, one line per request on stderr:
//! method, host and path (never a query, a header or a body), status and
//! time.

use std::time::{Duration, Instant};

use serde_json::Value;
use ureq::http::{HeaderName, HeaderValue, Uri};

use super::api::{self, ApiError, Upload};
use super::secret::{PublishKey, redact};
use crate::sanitize;

/// The creator space's API.
pub const DEFAULT_ORIGIN: &str = "https://api.playervox.com";
/// Another API, for tests only (a local server, a staging API).
pub const URL_VARIABLE: &str = "OVERCROW_API_URL";
const CONNECT_TIME: Duration = Duration::from_secs(15);
const REQUEST_TIME: Duration = Duration::from_secs(60);
/// The signed link lives 15 minutes; 32 MiB at a slow upload speed.
const UPLOAD_TIME: Duration = Duration::from_secs(10 * 60);
/// The largest answer read (a version with its diagnostics is far less).
const MAX_ANSWER_BYTES: u64 = 8 * 1024 * 1024;
/// Tries of an idempotent request, with the waits between them.
const RETRY_WAITS: [Duration; 2] = [Duration::from_secs(1), Duration::from_secs(3)];
/// The longest `retry_after` waited for before trying again once.
const MAX_RATE_WAIT: u64 = 60;

/// `overcrow-widget/<version> (<system>)`: the API refuses requests
/// without a user agent.
pub fn user_agent() -> String {
    format!(
        "overcrow-widget/{} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    )
}

/// Where the API is: `scheme://host[:port]`, nothing else.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Origin {
    base: String,
    local_http: bool,
}

impl Origin {
    /// `https://host[:port]`, or `http://` to `127.0.0.1`, `localhost` or
    /// `[::1]`; a final `/` is accepted; no user, path, query or fragment.
    pub fn parse(text: &str) -> Result<Self, String> {
        let invalid = || {
            format!(
                "`{}` is not an API origin: https://host[:port], or http:// to 127.0.0.1, localhost or [::1] for tests",
                sanitize::line(text)
            )
        };
        if text.contains(['#', '@', '?']) {
            return Err(invalid());
        }
        let uri: Uri = text.parse().map_err(|_| invalid())?;
        let (Some(scheme), Some(authority)) = (uri.scheme_str(), uri.authority()) else {
            return Err(invalid());
        };
        if !matches!(uri.path(), "" | "/") {
            return Err(invalid());
        }
        let host = authority.host().to_ascii_lowercase();
        let local = matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]");
        let local_http = match scheme {
            "https" if !host.is_empty() => false,
            "http" if local => true,
            _ => return Err(invalid()),
        };
        let base = match authority.port_u16() {
            Some(port) => format!("{scheme}://{host}:{port}"),
            None => format!("{scheme}://{host}"),
        };
        Ok(Self { base, local_http })
    }

    /// The origin of `OVERCROW_API_URL`, or the creator space's API.
    /// `Some(warning)` when another API is used.
    pub fn from_environment() -> Result<(Self, Option<String>), String> {
        match std::env::var(URL_VARIABLE) {
            Err(std::env::VarError::NotPresent) => Ok((Self::default_api(), None)),
            Err(std::env::VarError::NotUnicode(_)) => {
                Err(format!("{URL_VARIABLE} is not an API origin"))
            }
            Ok(text) => {
                let origin = Self::parse(&text)?;
                let warning = format!(
                    "using the API at {} ({URL_VARIABLE}), not {DEFAULT_ORIGIN}: for tests only",
                    origin.base
                );
                Ok((origin, Some(warning)))
            }
        }
    }

    pub fn default_api() -> Self {
        Self {
            base: DEFAULT_ORIGIN.to_owned(),
            local_http: false,
        }
    }

    pub fn as_str(&self) -> &str {
        &self.base
    }

    pub fn is_local_http(&self) -> bool {
        self.local_http
    }

    /// Whether the signed upload may go to `url`: HTTPS (the API chose the
    /// storage), or, with a local test API, plain HTTP to that same API.
    pub fn upload_allowed(&self, url: &str) -> bool {
        let Ok(uri) = url.parse::<Uri>() else {
            return false;
        };
        let Some(authority) = uri.authority() else {
            return false;
        };
        if authority.as_str().contains('@') || authority.host().is_empty() {
            return false;
        }
        match uri.scheme_str() {
            Some("https") => true,
            Some("http") => {
                self.local_http
                    && format!("http://{}", authority.as_str().to_ascii_lowercase()) == self.base
            }
            _ => false,
        }
    }
}

/// The upload's headers, checked: valid names and values, none that would
/// carry a credential or another host, and a `Content-Length` (if any)
/// equal to the archive's size.
pub fn upload_headers(
    headers: &[(String, String)],
    length: usize,
) -> Result<Vec<(String, String)>, String> {
    for (name, value) in headers {
        let shown = sanitize::line(name);
        let header = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("the upload asks for an invalid header `{shown}`"))?;
        if HeaderValue::from_str(value).is_err() {
            return Err(format!("the upload asks for an invalid value of `{shown}`"));
        }
        if matches!(
            header.as_str(),
            "authorization" | "proxy-authorization" | "cookie" | "host"
        ) {
            return Err(format!("the upload asks for a `{shown}` header"));
        }
        if header == ureq::http::header::CONTENT_LENGTH && value.trim() != length.to_string() {
            return Err(format!(
                "the upload's Content-Length is {}, not the archive's {length} bytes",
                sanitize::line(value)
            ));
        }
    }
    Ok(headers.to_vec())
}

/// Why a request failed.
#[derive(Clone, Debug)]
pub enum Failure {
    /// No connection, or it was cut.
    Network(&'static str),
    Timeout,
    /// A 3xx: never followed.
    Redirect(u16),
    /// An answer the CLI cannot read (what was missing).
    Response(&'static str),
    /// An error answer of the API.
    Api {
        status: u16,
        error: ApiError,
    },
    /// An error status without an API error (a proxy's page).
    Status(u16),
    /// The CLI refused to send it (an upload to an unexpected place).
    Refused(String),
}

impl Failure {
    /// The stable code of `--format json`.
    pub fn code(&self) -> String {
        match self {
            Self::Network(_) => "network".into(),
            Self::Timeout => "timeout".into(),
            Self::Redirect(_) => "redirect".into(),
            Self::Response(_) => "response".into(),
            Self::Api { error, .. } => error.code.clone(),
            Self::Status(status) if *status >= 500 => "server".into(),
            Self::Status(_) => "response".into(),
            Self::Refused(_) => "upload_refused".into(),
        }
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Redirect(status) | Self::Status(status) => Some(*status),
            Self::Api { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// One sentence for a person (the API's text for its errors).
    pub fn message(&self) -> String {
        match self {
            Self::Network(detail) => format!("{detail}; check the connection and try again"),
            Self::Timeout => "the server did not answer in time; try again".into(),
            Self::Redirect(status) => {
                format!(
                    "the server answered with a redirect (HTTP {status}), which the CLI never follows"
                )
            }
            Self::Response(what) => format!("the server's answer cannot be read ({what})"),
            Self::Api { status, error } => error
                .message
                .as_deref()
                .map(sanitize::line)
                .unwrap_or_else(|| format!("the API refused the request (HTTP {status})")),
            Self::Status(status) if *status >= 500 => {
                format!("the server has a problem (HTTP {status}); try again later")
            }
            Self::Status(status) => format!("the server refused the request (HTTP {status})"),
            Self::Refused(why) => why.clone(),
        }
    }

    /// Worth another try of the same idempotent request.
    fn transient(&self) -> bool {
        match self {
            Self::Network(_) | Self::Timeout => true,
            Self::Status(status) | Self::Api { status, .. } => matches!(status, 502..=504),
            _ => false,
        }
    }
}

fn network(error: &ureq::Error) -> Failure {
    match error {
        ureq::Error::Timeout(_) => Failure::Timeout,
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => {
            Failure::Network("no connection to the server")
        }
        ureq::Error::BodyExceedsLimit(_) => Failure::Response("the answer is too large"),
        ureq::Error::Io(error) if error.kind() == std::io::ErrorKind::TimedOut => Failure::Timeout,
        ureq::Error::Io(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::HostUnreachable
                    | std::io::ErrorKind::NetworkUnreachable
            ) =>
        {
            Failure::Network("no connection to the server")
        }
        ureq::Error::Rustls(_) => Failure::Network("the secure connection failed"),
        _ => Failure::Network("the connection was cut"),
    }
}

/// An answer: status and body (2xx only reach the caller).
pub struct Answer {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Requests to one API with one key.
pub struct Client {
    origin: Origin,
    key: PublishKey,
    verbose: bool,
    agent: ureq::Agent,
    uploader: ureq::Agent,
}

impl Client {
    pub fn new(origin: Origin, key: PublishKey, verbose: bool) -> Self {
        let agent = |time: Duration| -> ureq::Agent {
            ureq::Agent::config_builder()
                .https_only(!origin.local_http)
                .max_redirects(0)
                .http_status_as_error(false)
                .timeout_connect(Some(CONNECT_TIME))
                .timeout_global(Some(time))
                .user_agent(user_agent())
                .build()
                .into()
        };
        Self {
            agent: agent(REQUEST_TIME),
            uploader: agent(UPLOAD_TIME),
            origin,
            key,
            verbose,
        }
    }

    pub fn origin(&self) -> &Origin {
        &self.origin
    }

    pub fn key(&self) -> &PublishKey {
        &self.key
    }

    fn log(&self, line: &str) {
        if self.verbose {
            eprintln!("{}", redact(line));
        }
    }

    /// `GET <origin><path>`, tried again on a transient failure.
    pub fn get(&self, path: &str) -> Result<Answer, Failure> {
        self.with_retries(|| self.request("GET", path, None, None))
    }

    /// `POST <origin><path>` with a JSON body, tried again on a transient
    /// failure: the routes `submit` posts to are idempotent (the
    /// submission thanks to its `Idempotency-Key`).
    pub fn post(
        &self,
        path: &str,
        body: &Value,
        idempotency: Option<&str>,
    ) -> Result<Answer, Failure> {
        let bytes = body.to_string().into_bytes();
        self.with_retries(|| self.request("POST", path, Some(&bytes), idempotency))
    }

    fn with_retries(
        &self,
        mut send: impl FnMut() -> Result<Answer, Failure>,
    ) -> Result<Answer, Failure> {
        let mut waits = RETRY_WAITS.iter();
        let mut rate_waited = false;
        loop {
            let failure = match send() {
                Ok(answer) => return Ok(answer),
                Err(failure) => failure,
            };
            if let Failure::Api { status: 429, error } = &failure
                && !rate_waited
                && error.code == "rate_limited"
                && let Some(seconds) = error
                    .retry_after
                    .filter(|seconds| *seconds <= MAX_RATE_WAIT)
            {
                rate_waited = true;
                self.log(&format!("  rate limited: waiting {seconds} s"));
                std::thread::sleep(Duration::from_secs(seconds.max(1)));
                continue;
            }
            match waits.next() {
                Some(wait) if failure.transient() => {
                    self.log(&format!("  {}: trying again", failure.code()));
                    std::thread::sleep(*wait);
                }
                _ => return Err(failure),
            }
        }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&[u8]>,
        idempotency: Option<&str>,
    ) -> Result<Answer, Failure> {
        let url = format!("{}{path}", self.origin.base);
        let mut authorization =
            HeaderValue::from_str(&self.key.bearer()).map_err(|_| Failure::Response("key"))?;
        authorization.set_sensitive(true);
        let started = Instant::now();
        let result = match body {
            None => self
                .agent
                .get(&url)
                .header("authorization", authorization)
                .header("accept", "application/json")
                .call(),
            Some(bytes) => {
                let mut request = self
                    .agent
                    .post(&url)
                    .header("authorization", authorization)
                    .header("accept", "application/json")
                    .header("content-type", "application/json");
                if let Some(key) = idempotency {
                    request = request.header("idempotency-key", key);
                }
                request.send(bytes)
            }
        };
        let mut response = match result {
            Ok(response) => response,
            Err(error) => {
                let failure = network(&error);
                self.log(&format!("  {method} {path} -> {}", failure.code()));
                return Err(failure);
            }
        };
        let status = response.status().as_u16();
        let request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(|id| format!(", request {}", sanitize::line(id)))
            .unwrap_or_default();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_ANSWER_BYTES)
            .read_to_vec();
        self.log(&format!(
            "  {method} {path} -> {status} ({} ms{request_id})",
            started.elapsed().as_millis()
        ));
        let body = body.map_err(|error| network(&error))?;
        answer(status, body)
    }

    /// The signed upload: exactly `upload.headers`, never the key.
    pub fn put_upload(&self, upload: &Upload, bytes: &[u8]) -> Result<(), Failure> {
        if upload.method != "PUT" {
            return Err(Failure::Refused(format!(
                "the upload asks for {}, not PUT",
                sanitize::line(&upload.method)
            )));
        }
        if !self.origin.upload_allowed(&upload.url) {
            return Err(Failure::Refused(
                "the upload link is not an https:// link".into(),
            ));
        }
        let headers = upload_headers(&upload.headers, bytes.len()).map_err(Failure::Refused)?;
        let shown = upload
            .url
            .parse::<Uri>()
            .map(|uri| {
                format!(
                    "{}://{}{}",
                    uri.scheme_str().unwrap_or_default(),
                    uri.authority()
                        .map(|authority| authority.as_str())
                        .unwrap_or_default(),
                    uri.path()
                )
            })
            .unwrap_or_default();
        let started = Instant::now();
        let mut request = self.uploader.put(&upload.url);
        for (name, value) in &headers {
            request = request.header(name.as_str(), value.as_str());
        }
        let result = request.send(bytes);
        let mut response = match result {
            Ok(response) => response,
            Err(error) => {
                let failure = network(&error);
                self.log(&format!(
                    "  PUT {} (signed link) -> {}",
                    sanitize::line(&shown),
                    failure.code()
                ));
                return Err(failure);
            }
        };
        let status = response.status().as_u16();
        let _ = response
            .body_mut()
            .with_config()
            .limit(64 * 1024)
            .read_to_vec();
        self.log(&format!(
            "  PUT {} (signed link) -> {status} ({} ms)",
            sanitize::line(&shown),
            started.elapsed().as_millis()
        ));
        match status {
            200..=299 => Ok(()),
            300..=399 => Err(Failure::Redirect(status)),
            _ => Err(Failure::Status(status)),
        }
    }
}

/// A 2xx answer, or the failure an answer means.
fn answer(status: u16, body: Vec<u8>) -> Result<Answer, Failure> {
    match status {
        200..=299 => Ok(Answer { status, body }),
        300..=399 => Err(Failure::Redirect(status)),
        _ => Err(match api::parse_error(&body) {
            Some(error) => Failure::Api { status, error },
            None => Failure::Status(status),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_origin_is_the_api() {
        let origin = Origin::parse(DEFAULT_ORIGIN).expect("origin");
        assert_eq!(origin.as_str(), "https://api.playervox.com");
        assert!(!origin.is_local_http());
    }

    #[test]
    fn test_origins_are_https_or_the_local_loop() {
        for (text, expected) in [
            ("https://api.example.test", "https://api.example.test"),
            (
                "https://API.Example.test:8443/",
                "https://api.example.test:8443",
            ),
            ("http://127.0.0.1:8080", "http://127.0.0.1:8080"),
            ("http://localhost:3000/", "http://localhost:3000"),
            ("http://[::1]:9", "http://[::1]:9"),
        ] {
            assert_eq!(Origin::parse(text).expect(text).as_str(), expected);
        }
        assert!(
            Origin::parse("http://127.0.0.1:8080")
                .unwrap()
                .is_local_http()
        );
        for text in [
            "http://api.playervox.com",
            "http://10.0.0.2:3000",
            "http://localhost.evil.test",
            "https://user@api.example.test",
            "https://api.example.test/api/v1",
            "https://api.example.test?x=1",
            "https://api.example.test#x",
            "ftp://api.example.test",
            "api.example.test",
            "https://",
            "https://bad host",
        ] {
            assert!(Origin::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn the_upload_goes_to_https_or_to_the_local_test_server() {
        let production = Origin::parse(DEFAULT_ORIGIN).unwrap();
        assert!(production.upload_allowed(
            "https://acc.r2.cloudflarestorage.com/b/incoming/a.zip?X-Amz-Signature=s"
        ));
        assert!(!production.upload_allowed("http://acc.r2.cloudflarestorage.com/b/a.zip"));
        assert!(!production.upload_allowed("https://user:pass@r2.example/a.zip"));
        assert!(!production.upload_allowed("ftp://r2.example/a.zip"));
        assert!(!production.upload_allowed("/relative.zip"));
        let local = Origin::parse("http://127.0.0.1:8080").unwrap();
        assert!(local.upload_allowed("http://127.0.0.1:8080/upload/1"));
        assert!(!local.upload_allowed("http://127.0.0.1:8081/upload/1"));
        assert!(!local.upload_allowed("http://localhost:8080/upload/1"));
        assert!(local.upload_allowed("https://r2.example/a.zip"));
    }

    #[test]
    fn the_signed_headers_are_sent_as_given() {
        let headers = vec![
            ("Content-Length".to_owned(), "4".to_owned()),
            ("Content-Type".to_owned(), "application/zip".to_owned()),
            ("x-amz-checksum-sha256".to_owned(), "C7c=".to_owned()),
        ];
        assert_eq!(upload_headers(&headers, 4).expect("headers"), headers);
        assert!(
            upload_headers(&headers, 5)
                .unwrap_err()
                .contains("Content-Length")
        );
        for (name, value) in [
            ("Authorization", "Bearer x"),
            ("Bad Name", "x"),
            ("x-amz-meta", "line\r\nbreak"),
            ("Host", "evil.test"),
        ] {
            let mut bad = headers.clone();
            bad.push((name.to_owned(), value.to_owned()));
            assert!(upload_headers(&bad, 4).is_err(), "{name}");
        }
    }

    #[test]
    fn the_user_agent_names_the_cli_and_the_system() {
        let agent = user_agent();
        assert!(agent.starts_with(concat!("overcrow-widget/", env!("CARGO_PKG_VERSION"), " (")));
        assert!(agent.ends_with(&format!("({})", std::env::consts::OS)));
    }
}
