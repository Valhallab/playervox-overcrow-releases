//! Downloads the pinned headless runtime (`overcrow-widget test` without
//! `--runtime` and without a cached runtime). It comes from the creator
//! tools ZIP of this platform in the OverCrow release that published it:
//! `https://github.com/Valhallab/playervox-overcrow-releases/releases/download/v<version>/overcrow-creator-tools-<version>-<platform>.zip`.
//!
//! The ZIP cannot be pinned (this CLI is inside it): only the runtime's
//! SHA-256 is trusted. The ZIP goes to a temporary file in the cache, only
//! this platform's runtime is extracted, into another temporary file, and
//! that file takes its final name only once its digest is the pinned one.
//! Nothing else of the ZIP is kept. HTTPS only, through rustls and the
//! Mozilla roots; redirects are followed by hand, to GitHub's hosts only;
//! sizes, entry count and time are bounded.

use std::io::{IsTerminal as _, Read as _, Seek as _, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use overcrow_widget_schema::package::hex;
use sha2::{Digest as _, Sha256};
use ureq::http::Uri;

use crate::zipread::{self, Limits, ZipError};

/// The public releases of OverCrow.
const RELEASES: &str = "https://github.com/Valhallab/playervox-overcrow-releases/releases/download";
/// The release download answers from github.com, then redirects to
/// GitHub's asset storage.
const FIRST_HOST: &str = "github.com";
const REDIRECT_HOSTS: &[&str] = &[
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
];
const MAX_REDIRECTS: usize = 3;
/// A creator tools ZIP holds one runtime and one CLI (about 15 MB).
const MAX_ZIP_BYTES: u64 = 256 * 1024 * 1024;
const ZIP_LIMITS: Limits = Limits {
    max_entries: 64,
    max_entry_bytes: 256 * 1024 * 1024,
    max_total_bytes: 1024 * 1024 * 1024,
};
const TOTAL_TIME: Duration = Duration::from_secs(15 * 60);
const CONNECT_TIME: Duration = Duration::from_secs(30);

/// The file name of the creator tools ZIP of OverCrow `version` for
/// `platform` (`linux-x86_64`, `windows-x86_64`).
pub fn archive_name(version: &str, platform: &str) -> String {
    format!("overcrow-creator-tools-{version}-{platform}.zip")
}

/// Where a download may go.
pub struct Source {
    base: String,
    first_host: String,
    redirect_hosts: Vec<String>,
    https_only: bool,
}

impl Source {
    /// OverCrow's public releases on GitHub.
    pub fn github() -> Self {
        Self {
            base: RELEASES.to_owned(),
            first_host: FIRST_HOST.to_owned(),
            redirect_hosts: REDIRECT_HOSTS
                .iter()
                .map(|host| (*host).to_owned())
                .collect(),
            https_only: true,
        }
    }

    /// A local test server: plain HTTP, and only its own authority, also
    /// for redirects.
    #[cfg(any(test, debug_assertions))]
    pub fn local(base: &str) -> Option<Self> {
        let authority = base
            .parse::<Uri>()
            .ok()?
            .authority()
            .map(|authority| authority.as_str().to_owned())?;
        Some(Self {
            base: base.trim_end_matches('/').to_owned(),
            first_host: authority.clone(),
            redirect_hosts: vec![authority],
            https_only: false,
        })
    }

    /// The source `test` downloads from. Only a debug build reads
    /// `OVERCROW_WIDGET_TEST_RELEASES_URL` (the integration tests' local
    /// server); the distribution builds (`--profile dist`, without debug
    /// assertions) do not contain this code.
    pub fn for_release() -> Self {
        #[cfg(debug_assertions)]
        if let Some(source) = std::env::var("OVERCROW_WIDGET_TEST_RELEASES_URL")
            .ok()
            .and_then(|base| Self::local(&base))
        {
            return source;
        }
        Self::github()
    }

    fn url(&self, version: &str, platform: &str) -> String {
        format!(
            "{}/v{version}/{}",
            self.base,
            archive_name(version, platform)
        )
    }
}

/// Why the runtime could not be downloaded. Nothing is kept in any case.
#[derive(Debug)]
pub enum DownloadError {
    Network(String),
    Status(u16),
    Redirect,
    TooLarge,
    Archive(ZipError),
    MissingEntry(String),
    Digest,
    Write(PathBuf),
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(detail) => formatter.write_str(detail),
            Self::Status(status) => write!(formatter, "the server answered HTTP {status}"),
            Self::Redirect => formatter.write_str("the download was redirected outside GitHub"),
            Self::TooLarge => write!(
                formatter,
                "the archive is larger than {} MB",
                MAX_ZIP_BYTES / (1024 * 1024)
            ),
            Self::Archive(error) => error.fmt(formatter),
            Self::MissingEntry(name) => write!(formatter, "the archive has no {name}"),
            Self::Digest => formatter.write_str("its SHA-256 is not the pinned one"),
            Self::Write(directory) => write!(formatter, "cannot write in {}", directory.display()),
        }
    }
}

fn network(error: &ureq::Error) -> DownloadError {
    DownloadError::Network(match error {
        ureq::Error::Timeout(_) => "the download took too long".to_owned(),
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => {
            "no connection to the server".to_owned()
        }
        ureq::Error::Io(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::HostUnreachable
                    | std::io::ErrorKind::NetworkUnreachable
            ) =>
        {
            "no connection to the server".to_owned()
        }
        _ => "the connection failed".to_owned(),
    })
}

fn time_left(deadline: Instant) -> Result<Duration, DownloadError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
        .ok_or_else(|| DownloadError::Network("the download took too long".to_owned()))
}

/// The host (and port) of `uri` if it is an allowed absolute URL.
fn allowed(uri: &Uri, hosts: &[String], https_only: bool) -> bool {
    let scheme_ok = match uri.scheme_str() {
        Some("https") => true,
        Some("http") => !https_only,
        _ => false,
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    scheme_ok
        && !authority.as_str().contains('@')
        && hosts.iter().any(|host| host == authority.as_str())
}

/// Shows how far a download is.
pub struct Progress {
    terminal: bool,
    shown: u64,
}

impl Progress {
    pub fn new() -> Self {
        Self {
            terminal: std::io::stderr().is_terminal(),
            shown: 0,
        }
    }

    fn update(&mut self, received: u64, total: Option<u64>) {
        // On a terminal, one line rewritten every megabyte.
        if !self.terminal || received < self.shown + 1_000_000 && Some(received) != total {
            return;
        }
        self.shown = received;
        let megabytes = |bytes: u64| bytes as f64 / 1_000_000.0;
        match total {
            Some(total) => eprint!(
                "\r  {:.1} MB of {:.1} MB",
                megabytes(received),
                megabytes(total)
            ),
            None => eprint!("\r  {:.1} MB", megabytes(received)),
        }
    }

    fn finish(&self) {
        if self.terminal && self.shown > 0 {
            eprintln!();
        }
    }
}

/// Downloads the creator tools ZIP of `version` for `platform` into `file`, following at
/// most [`MAX_REDIRECTS`] redirects to allowed hosts.
fn fetch(
    source: &Source,
    version: &str,
    platform: &str,
    file: &mut std::fs::File,
    progress: &mut Progress,
) -> Result<u64, DownloadError> {
    let deadline = Instant::now() + TOTAL_TIME;
    let mut url = source.url(version, platform);
    let mut hosts = std::slice::from_ref(&source.first_host);
    for _ in 0..=MAX_REDIRECTS {
        let uri = url.parse::<Uri>().map_err(|_| DownloadError::Redirect)?;
        if !allowed(&uri, hosts, source.https_only) {
            return Err(DownloadError::Redirect);
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .https_only(source.https_only)
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_connect(Some(CONNECT_TIME))
            .timeout_global(Some(time_left(deadline)?))
            .user_agent(concat!("overcrow-widget/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let mut response = agent.get(uri).call().map_err(|error| network(&error))?;
        let status = response.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            url = response
                .headers()
                .get("location")
                .and_then(|location| location.to_str().ok())
                .ok_or(DownloadError::Redirect)?
                .to_owned();
            hosts = &source.redirect_hosts;
            continue;
        }
        if status != 200 {
            return Err(DownloadError::Status(status));
        }
        let total = response
            .headers()
            .get("content-length")
            .and_then(|length| length.to_str().ok()?.parse::<u64>().ok());
        if total.is_some_and(|total| total > MAX_ZIP_BYTES) {
            return Err(DownloadError::TooLarge);
        }
        let mut reader = response.body_mut().as_reader();
        let mut buffer = vec![0_u8; 64 * 1024];
        let mut received = 0_u64;
        loop {
            time_left(deadline)?;
            let read = match reader.read(&mut buffer) {
                Ok(read) => read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                    return Err(DownloadError::Network(
                        "the download took too long".to_owned(),
                    ));
                }
                Err(_) => {
                    return Err(DownloadError::Network("the connection was cut".to_owned()));
                }
            };
            if read == 0 {
                break;
            }
            received += read as u64;
            if received > MAX_ZIP_BYTES {
                return Err(DownloadError::TooLarge);
            }
            file.write_all(&buffer[..read])
                .map_err(|_| DownloadError::Network("cannot store the download".to_owned()))?;
            progress.update(received, total);
        }
        if total.is_some_and(|total| total != received) {
            return Err(DownloadError::Network("the connection was cut".to_owned()));
        }
        return Ok(received);
    }
    Err(DownloadError::Redirect)
}

/// A writer that hashes what it writes.
struct Hashing<W> {
    inner: W,
    hasher: Sha256,
}

impl<W: Write> Write for Hashing<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// Downloads the runtime `name` of OverCrow `version` for `platform` and
/// writes it to `destination` (executable), only if its SHA-256 is
/// `expected`.
pub fn runtime(
    source: &Source,
    version: &str,
    platform: &str,
    name: &str,
    expected: &str,
    destination: &Path,
    progress: &mut Progress,
) -> Result<(), DownloadError> {
    let directory = destination
        .parent()
        .ok_or_else(|| DownloadError::Write(destination.to_path_buf()))?;
    let unwritable = || DownloadError::Write(directory.to_path_buf());
    std::fs::create_dir_all(directory).map_err(|_| unwritable())?;
    // Both temporary files are removed when dropped, on every path.
    let mut archive = tempfile::Builder::new()
        .prefix(".download-")
        .tempfile_in(directory)
        .map_err(|_| unwritable())?;
    let fetched = fetch(source, version, platform, archive.as_file_mut(), progress);
    progress.finish();
    let length = fetched?;
    let file = archive.as_file_mut();
    file.seek(SeekFrom::Start(0))
        .map_err(|_| DownloadError::Archive(ZipError::Io))?;
    let mut reader = std::io::BufReader::new(file);
    let entries =
        zipread::entries(&mut reader, length, ZIP_LIMITS).map_err(DownloadError::Archive)?;
    let path = format!("overcrow-creator-tools-{version}-{platform}/{name}");
    let entry = entries
        .iter()
        .find(|entry| entry.name == path)
        .ok_or_else(|| DownloadError::MissingEntry(name.to_owned()))?;
    let mut runtime = tempfile::Builder::new()
        .prefix(".runtime-")
        .tempfile_in(directory)
        .map_err(|_| unwritable())?;
    let digest: [u8; 32] = {
        let mut output = Hashing {
            inner: std::io::BufWriter::new(runtime.as_file_mut()),
            hasher: Sha256::new(),
        };
        zipread::extract(&mut reader, entry, &mut output).map_err(DownloadError::Archive)?;
        output.flush().map_err(|_| unwritable())?;
        output.hasher.finalize().into()
    };
    if hex(&digest) != expected {
        return Err(DownloadError::Digest);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(runtime.path(), std::fs::Permissions::from_mode(0o755))
            .map_err(|_| unwritable())?;
    }
    runtime.as_file().sync_all().map_err(|_| unwritable())?;
    runtime.persist(destination).map_err(|_| unwritable())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead as _;
    use std::net::TcpListener;

    const VERSION: &str = "9.9.9";
    const NAME: &str = "overcrow-widget-headless-9.9.9-linux-x86_64";
    const RUNTIME: &[u8] = b"\x7fELF a headless runtime";

    fn sha(bytes: &[u8]) -> String {
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        hex(&digest)
    }

    /// A ZIP of `files` (name, bytes), stored, as the publisher lays it out.
    fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data) in files {
            let crc = crc32fast::hash(data);
            let offset = out.len() as u32;
            let size = (data.len() as u32).to_le_bytes();
            out.extend(0x0403_4b50_u32.to_le_bytes());
            out.extend([20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0]);
            out.extend(crc.to_le_bytes());
            out.extend(size);
            out.extend(size);
            out.extend((name.len() as u16).to_le_bytes());
            out.extend([0, 0]);
            out.extend(name.as_bytes());
            out.extend(*data);
            central.extend(0x0201_4b50_u32.to_le_bytes());
            central.extend([0x1e, 3, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0]);
            central.extend(crc.to_le_bytes());
            central.extend(size);
            central.extend(size);
            central.extend((name.len() as u16).to_le_bytes());
            central.extend([0; 8]);
            central.extend((0o100_755_u32 << 16).to_le_bytes());
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let offset = out.len() as u32;
        out.extend(&central);
        out.extend(0x0605_4b50_u32.to_le_bytes());
        out.extend([0; 4]);
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((files.len() as u16).to_le_bytes());
        out.extend((central.len() as u32).to_le_bytes());
        out.extend(offset.to_le_bytes());
        out.extend([0, 0]);
        out
    }

    fn good_zip() -> Vec<u8> {
        zip(&[
            (
                "overcrow-creator-tools-9.9.9-linux-x86_64/README.txt",
                b"read me",
            ),
            (
                &format!("overcrow-creator-tools-9.9.9-linux-x86_64/{NAME}"),
                RUNTIME,
            ),
        ])
    }

    /// What one request receives: raw HTTP bytes, written then the
    /// connection closes.
    type Answer = Box<dyn Fn(&str, &str) -> Vec<u8> + Send>;

    /// A local HTTP server answering each request with
    /// `answer(path, its own origin)`.
    fn serve(answer: Answer) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let path = line.split(' ').nth(1).unwrap_or("").to_owned();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                        break;
                    }
                }
                let _ = stream.write_all(&answer(&path, &origin));
            }
        });
        format!("http://{address}/download")
    }

    fn ok(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend(body);
        response
    }

    fn download(base: &str, expected: &str) -> (Result<(), DownloadError>, tempfile::TempDir) {
        let cache = tempfile::tempdir().unwrap();
        let destination = cache.path().join(VERSION).join(NAME);
        let result = runtime(
            &Source::local(base).unwrap(),
            VERSION,
            "linux-x86_64",
            NAME,
            expected,
            &destination,
            &mut Progress {
                terminal: false,
                shown: 0,
            },
        );
        (result, cache)
    }

    /// Only the runtime remains: no ZIP, no temporary file.
    fn kept(cache: &tempfile::TempDir) -> Vec<String> {
        let directory = cache.path().join(VERSION);
        let mut names: Vec<String> = std::fs::read_dir(directory)
            .map(|entries| {
                entries
                    .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn the_runtime_of_the_archive_is_kept_with_its_pinned_digest() {
        let base = serve(Box::new(|path, _| {
            assert_eq!(
                path, "/download/v9.9.9/overcrow-creator-tools-9.9.9-linux-x86_64.zip",
                "the URL of the release's archive"
            );
            ok(&good_zip())
        }));
        let (result, cache) = download(&base, &sha(RUNTIME));
        result.unwrap();
        assert_eq!(kept(&cache), [NAME]);
        let path = cache.path().join(VERSION).join(NAME);
        assert_eq!(std::fs::read(&path).unwrap(), RUNTIME);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755);
        }
    }

    #[test]
    fn a_wrong_digest_keeps_nothing() {
        let base = serve(Box::new(|_, _| ok(&good_zip())));
        let (result, cache) = download(&base, &sha(b"another runtime"));
        assert!(matches!(result, Err(DownloadError::Digest)), "{result:?}");
        assert!(kept(&cache).is_empty());
    }

    #[test]
    fn an_archive_too_large_is_refused_from_its_length() {
        let base = serve(Box::new(|_, _| {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\nPK",
                MAX_ZIP_BYTES + 1
            )
            .into_bytes()
        }));
        let (result, cache) = download(&base, &sha(RUNTIME));
        assert!(matches!(result, Err(DownloadError::TooLarge)), "{result:?}");
        assert!(kept(&cache).is_empty());
    }

    #[test]
    fn a_dangerous_entry_refuses_the_whole_archive() {
        let base = serve(Box::new(|_, _| {
            ok(&zip(&[
                ("../evil", b"x"),
                (
                    &format!("overcrow-creator-tools-9.9.9-linux-x86_64/{NAME}"),
                    RUNTIME,
                ),
            ]))
        }));
        let (result, cache) = download(&base, &sha(RUNTIME));
        assert!(
            matches!(result, Err(DownloadError::Archive(ZipError::UnsafeName))),
            "{result:?}"
        );
        assert!(kept(&cache).is_empty());
        assert!(!cache.path().join("evil").exists());
    }

    #[test]
    fn an_archive_without_this_platform_is_refused() {
        let base = serve(Box::new(|_, _| {
            ok(&zip(&[(
                "overcrow-creator-tools-9.9.9-linux-x86_64/README.txt",
                b"x",
            )]))
        }));
        let (result, _cache) = download(&base, &sha(RUNTIME));
        assert!(
            matches!(result, Err(DownloadError::MissingEntry(_))),
            "{result:?}"
        );
    }

    fn redirect(location: &str) -> Vec<u8> {
        format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\n\r\n")
            .into_bytes()
    }

    #[test]
    fn a_redirect_on_the_same_host_is_followed() {
        let base = serve(Box::new(|path, origin| match path {
            "/asset" => ok(&good_zip()),
            _ => redirect(&format!("{origin}/asset")),
        }));
        let (result, cache) = download(&base, &sha(RUNTIME));
        result.unwrap();
        assert_eq!(kept(&cache), [NAME]);
    }

    #[test]
    fn a_redirect_to_another_host_is_refused() {
        // Another server: another port, so another authority.
        let other = serve(Box::new(|_, _| ok(&good_zip())));
        let other = other.trim_end_matches("/download").to_owned();
        let base = serve(Box::new(move |_, _| redirect(&format!("{other}/asset"))));
        let (result, cache) = download(&base, &sha(RUNTIME));
        assert!(matches!(result, Err(DownloadError::Redirect)), "{result:?}");
        assert!(kept(&cache).is_empty());
    }

    #[test]
    fn redirects_are_bounded() {
        let base = serve(Box::new(|_, origin| redirect(&format!("{origin}/loop"))));
        let (result, cache) = download(&base, &sha(RUNTIME));
        assert!(matches!(result, Err(DownloadError::Redirect)), "{result:?}");
        assert!(kept(&cache).is_empty());
    }

    #[test]
    fn a_cut_connection_keeps_nothing() {
        let base = serve(Box::new(|_, _| {
            let zip = good_zip();
            let mut response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                zip.len()
            )
            .into_bytes();
            response.extend(&zip[..zip.len() / 2]);
            response
        }));
        let (result, cache) = download(&base, &sha(RUNTIME));
        assert!(
            matches!(result, Err(DownloadError::Network(_))),
            "{result:?}"
        );
        assert!(kept(&cache).is_empty());
    }

    #[test]
    fn a_missing_release_or_server_is_a_network_error() {
        let base = serve(Box::new(|_, _| {
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec()
        }));
        let (result, _cache) = download(&base, &sha(RUNTIME));
        assert!(
            matches!(result, Err(DownloadError::Status(404))),
            "{result:?}"
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let closed = format!("http://{}/download", listener.local_addr().unwrap());
        drop(listener);
        let (result, _cache) = download(&closed, &sha(RUNTIME));
        assert!(
            matches!(result, Err(DownloadError::Network(_))),
            "{result:?}"
        );
    }

    #[test]
    fn github_downloads_are_https_only_and_on_github_hosts() {
        let source = Source::github();
        let hosts = std::slice::from_ref(&source.first_host);
        let check = |url: &str, hosts: &[String]| allowed(&url.parse().unwrap(), hosts, true);
        assert!(check(&source.url("0.6.1-beta.1", "linux-x86_64"), hosts));
        assert_eq!(
            source.url("0.6.1-beta.1", "windows-x86_64"),
            "https://github.com/Valhallab/playervox-overcrow-releases/releases/download/v0.6.1-beta.1/overcrow-creator-tools-0.6.1-beta.1-windows-x86_64.zip"
        );
        assert!(!check("http://github.com/x", hosts));
        assert!(!check(
            "https://release-assets.githubusercontent.com/x",
            hosts
        ));
        assert!(check(
            "https://release-assets.githubusercontent.com/x",
            &source.redirect_hosts
        ));
        assert!(!check(
            "https://github.com.evil.example/x",
            &source.redirect_hosts
        ));
        assert!(!check("https://user@github.com/x", &source.redirect_hosts));
        assert!(!check("https://github.com:8443/x", &source.redirect_hosts));
        assert!(!check("/relative", &source.redirect_hosts));
    }
}
