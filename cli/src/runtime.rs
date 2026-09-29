//! The headless runtime `overcrow-widget test` runs: an
//! `overcrow-widget-headless` executable built by OverCrow's release
//! pipeline with the same code as the application (ADR 0004 §3). The CLI
//! never builds it. It comes either from `--runtime <path>`, or from the
//! version this CLI pins, found in the user's cache and checked against its
//! SHA-256 before every run. Downloading the pinned version arrives with the
//! release that publishes it.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use overcrow_widget_scenario::SUPPORTED_SCENARIO_VERSIONS;
use overcrow_widget_scenario::report::{INTERFACE_VERSION, RuntimeInfo};
use overcrow_widget_schema::package::hex;
use sha2::{Digest as _, Sha256};

/// A runtime version and the SHA-256 of its executable per platform.
pub struct Pin {
    pub version: &'static str,
    /// `(os-arch, lowercase hexadecimal SHA-256)`.
    pub artifacts: &'static [(&'static str, &'static str)],
}

/// The runtime this CLI pins. `None` until an OverCrow release publishes the
/// headless runtime; `--runtime` is required meanwhile.
pub const PIN: Option<Pin> = None;

/// The executable of a runtime is at most this large (a debug build of the
/// runtime is several hundred megabytes).
const MAX_RUNTIME_BYTES: u64 = 1024 * 1024 * 1024;
/// `--version --format json` answers within this delay.
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

/// `linux-x86_64`, `windows-x86_64`.
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// The file name of a runtime artefact.
pub fn artifact_name(version: &str, platform: &str) -> String {
    let suffix = if platform.starts_with("windows") {
        ".exe"
    } else {
        ""
    };
    format!("overcrow-widget-headless-{version}-{platform}{suffix}")
}

/// Where the pinned runtimes are kept: `$XDG_CACHE_HOME` or `~/.cache` on
/// Linux, `%LOCALAPPDATA%` on Windows.
pub fn cache_directory() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
    }?;
    Some(base.join("overcrow-widget").join("runtime"))
}

/// A runtime ready to run.
pub struct Runtime {
    pub path: PathBuf,
    pub sha256: String,
    /// Its digest is the one this CLI pins.
    pub pinned: bool,
    pub info: RuntimeInfo,
}

/// Why no runtime can run.
#[derive(Debug)]
pub enum RuntimeError {
    /// Neither `--runtime` nor a pinned version.
    NotPinned,
    /// The pinned version is not in the cache.
    Missing(PathBuf),
    /// The file's digest is not the pinned one.
    Digest {
        path: PathBuf,
        sha256: String,
    },
    Unreadable(PathBuf),
    /// It does not answer `--version --format json` as a runtime does.
    NotARuntime(PathBuf),
    /// It speaks another interface, scenario format or API version.
    Incompatible(String),
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotPinned => formatter.write_str(
                "this CLI pins no headless runtime yet: pass --runtime <path to overcrow-widget-headless>",
            ),
            Self::Missing(path) => write!(
                formatter,
                "the pinned headless runtime is not installed at {} (downloading it is not available yet): pass --runtime",
                path.display()
            ),
            Self::Digest { path, sha256 } => write!(
                formatter,
                "{} is not the pinned runtime (SHA-256 {sha256}); nothing ran",
                path.display()
            ),
            Self::Unreadable(path) => write!(formatter, "cannot read {}", path.display()),
            Self::NotARuntime(path) => write!(
                formatter,
                "{} does not answer as an overcrow-widget-headless runtime",
                path.display()
            ),
            Self::Incompatible(detail) => write!(formatter, "incompatible runtime: {detail}"),
        }
    }
}

/// The SHA-256 of a file, within the runtime size bound.
pub fn digest(path: &Path) -> Result<String, RuntimeError> {
    let unreadable = || RuntimeError::Unreadable(path.to_path_buf());
    let metadata = std::fs::metadata(path).map_err(|_| unreadable())?;
    if !metadata.is_file() || metadata.len() > MAX_RUNTIME_BYTES {
        return Err(unreadable());
    }
    let mut file = std::fs::File::open(path).map_err(|_| unreadable())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|_| unreadable())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest: [u8; 32] = hasher.finalize().into();
    Ok(hex(&digest))
}

/// The pinned digest of this platform, if any.
pub fn pinned_digest(pin: Option<&Pin>, platform: &str) -> Option<&'static str> {
    pin?.artifacts
        .iter()
        .find(|(name, _)| *name == platform)
        .map(|(_, digest)| *digest)
}

/// Resolves the runtime: `explicit` as given (its digest is shown, and
/// compared with the pin), or the pinned one from the cache, whose digest
/// must match.
pub fn resolve(explicit: Option<&Path>, pin: Option<&Pin>) -> Result<Runtime, RuntimeError> {
    let platform = platform();
    let expected = pinned_digest(pin, &platform);
    let (path, sha256) = match explicit {
        Some(path) => {
            let path =
                std::path::absolute(path).map_err(|_| RuntimeError::Unreadable(path.into()))?;
            let sha256 = digest(&path)?;
            (path, sha256)
        }
        None => {
            let (Some(pin), Some(expected)) = (pin, expected) else {
                return Err(RuntimeError::NotPinned);
            };
            let path = cache_directory()
                .ok_or(RuntimeError::NotPinned)?
                .join(pin.version)
                .join(artifact_name(pin.version, &platform));
            if !path.is_file() {
                return Err(RuntimeError::Missing(path));
            }
            let sha256 = digest(&path)?;
            if sha256 != expected {
                return Err(RuntimeError::Digest { path, sha256 });
            }
            (path, sha256)
        }
    };
    let pinned = expected == Some(sha256.as_str());
    let info = version(&path)?;
    check(&info)?;
    Ok(Runtime {
        path,
        sha256,
        pinned,
        info,
    })
}

/// What the runtime says it is.
fn version(path: &Path) -> Result<RuntimeInfo, RuntimeError> {
    let not_a_runtime = || RuntimeError::NotARuntime(path.to_path_buf());
    let mut child = Command::new(path)
        .args(["--version", "--format", "json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| not_a_runtime())?;
    let deadline = Instant::now() + VERSION_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return Err(not_a_runtime()),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(not_a_runtime());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let mut output = Vec::new();
    child
        .stdout
        .take()
        .ok_or_else(not_a_runtime)?
        .take(16 * 1024)
        .read_to_end(&mut output)
        .map_err(|_| not_a_runtime())?;
    serde_json::from_slice(&output).map_err(|_| not_a_runtime())
}

fn check(info: &RuntimeInfo) -> Result<(), RuntimeError> {
    if info.interface != INTERFACE_VERSION {
        return Err(RuntimeError::Incompatible(format!(
            "it speaks interface {}, this CLI {INTERFACE_VERSION}",
            info.interface
        )));
    }
    if info.api_version != overcrow_widget_schema::API_VERSION {
        return Err(RuntimeError::Incompatible(format!(
            "it runs widget API v{}, this CLI v{}",
            info.api_version,
            overcrow_widget_schema::API_VERSION
        )));
    }
    if !SUPPORTED_SCENARIO_VERSIONS
        .iter()
        .all(|version| info.scenario_versions.contains(version))
    {
        return Err(RuntimeError::Incompatible(
            "it does not read this CLI's scenario format".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED: Pin = Pin {
        version: "9.9.9",
        artifacts: &[("linux-x86_64", "aa"), ("windows-x86_64", "bb")],
    };

    #[test]
    fn artefact_names_follow_the_release_pipeline() {
        assert_eq!(
            artifact_name("0.6.0", "linux-x86_64"),
            "overcrow-widget-headless-0.6.0-linux-x86_64"
        );
        assert_eq!(
            artifact_name("0.6.0", "windows-x86_64"),
            "overcrow-widget-headless-0.6.0-windows-x86_64.exe"
        );
    }

    #[test]
    fn the_pin_is_per_platform() {
        assert_eq!(pinned_digest(Some(&PINNED), "linux-x86_64"), Some("aa"));
        assert_eq!(pinned_digest(Some(&PINNED), "windows-x86_64"), Some("bb"));
        assert_eq!(pinned_digest(Some(&PINNED), "linux-aarch64"), None);
        assert_eq!(pinned_digest(None, "linux-x86_64"), None);
    }

    #[test]
    fn without_a_pin_the_runtime_must_be_given() {
        assert!(matches!(resolve(None, None), Err(RuntimeError::NotPinned)));
    }

    #[test]
    fn a_runtime_must_speak_this_interface() {
        let mut info = RuntimeInfo {
            runtime: "0.6.0".to_owned(),
            interface: INTERFACE_VERSION,
            api_version: overcrow_widget_schema::API_VERSION,
            scenario_versions: SUPPORTED_SCENARIO_VERSIONS.to_vec(),
            os: "linux".to_owned(),
            arch: "x86_64".to_owned(),
        };
        assert!(check(&info).is_ok());
        info.interface += 1;
        assert!(check(&info).is_err());
        info.interface = INTERFACE_VERSION;
        info.scenario_versions.clear();
        assert!(check(&info).is_err());
    }
}
