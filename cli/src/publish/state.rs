//! Resuming a submission cut short. Each new submission gets a new
//! `Idempotency-Key`; it is kept in a small state file until the
//! submission ends, so that the same command run again after a cut finds
//! the same submission instead of starting another one (the API keeps
//! every key it saw, forever). The file is named after a hash of the API,
//! the publish key and the request (version, archive, texts): changing a
//! text or a file is another submission. It never holds the publish key.
//! It lives in the CLI's cache (`<cache>/overcrow-widget/submit/`), private
//! to the user; without a cache, a submission still works, without resume.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use overcrow_widget_schema::package::hex;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::secret::PublishKey;

/// An upload not finalized within 60 minutes expires on the API's side:
/// a state that old without a version is not resumed.
const PENDING_LIFETIME: u64 = 55 * 60;
/// States older than this are removed whenever `submit` runs.
const STALE_AFTER: u64 = 24 * 3600;
const FORMAT: u64 = 1;

/// The submission a run works on: resumed from its state, or new.
#[derive(Debug)]
pub struct Resume {
    path: Option<PathBuf>,
    created_at: u64,
    pub idempotency_key: String,
    pub submission_id: Option<u64>,
    pub version_id: Option<u64>,
    /// Whether this run continues a submission an earlier run started.
    pub resumed: bool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

impl Resume {
    /// The submission of this request: `cache` is the CLI's cache root,
    /// `body` the request (without the `Idempotency-Key`).
    pub fn open(cache: Option<&Path>, origin: &str, key: &PublishKey, body: &Value) -> Self {
        Self::open_at(cache, origin, key, body, now())
    }

    fn open_at(
        cache: Option<&Path>,
        origin: &str,
        key: &PublishKey,
        body: &Value,
        now: u64,
    ) -> Self {
        let directory = cache.and_then(|cache| private_directory(&cache.join("submit")));
        if let Some(directory) = &directory {
            prune(directory, now);
        }
        let path =
            directory.map(|directory| directory.join(format!("{}.json", name(origin, key, body))));
        // A submission the API answered for is resumed whatever its age (the
        // API says whether it expired); one never answered for only within
        // its upload time.
        if let Some(saved) = path.as_deref().and_then(read)
            && (saved.submission_id.is_some()
                || saved.version_id.is_some()
                || now.saturating_sub(saved.created_at) < PENDING_LIFETIME)
        {
            return Self {
                path,
                resumed: true,
                ..saved
            };
        }
        Self {
            path,
            created_at: now,
            idempotency_key: fresh_key(body),
            submission_id: None,
            version_id: None,
            resumed: false,
        }
    }

    /// Keeps the state for the next run (best effort: without it, a run
    /// cut short starts another submission).
    pub fn save(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let value = json!({
            "formatVersion": FORMAT,
            "idempotencyKey": self.idempotency_key,
            "createdAt": self.created_at,
            "submissionId": self.submission_id,
            "versionId": self.version_id,
        });
        let _ = write_private(path, value.to_string().as_bytes());
    }

    /// Another submission of the same request (the earlier one expired or
    /// was refused): a new `Idempotency-Key`, kept in the same place.
    pub fn renew(&mut self) {
        self.created_at = now();
        self.idempotency_key = fresh_key(&Value::String(self.idempotency_key.clone()));
        self.submission_id = None;
        self.version_id = None;
        self.resumed = false;
    }

    /// The submission ended: the next run starts another one.
    pub fn forget(&self) {
        if let Some(path) = &self.path {
            let _ = fs::remove_file(path);
        }
    }
}

/// `SHA-256(domain, origin, key, request)`: the key never appears.
fn name(origin: &str, key: &PublishKey, body: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"overcrow-widget submit state v1\0");
    hasher.update(origin.as_bytes());
    hasher.update(b"\0");
    hasher.update(key.bytes());
    hasher.update(b"\0");
    hasher.update(body.to_string().as_bytes());
    hex(&hasher.finalize())
}

/// A key unique to this attempt (it needs no secrecy: its scope is the
/// publish key): the request, the time, the process and a counter.
fn fresh_key(body: &Value) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let mut hasher = Sha256::new();
    hasher.update(b"overcrow-widget idempotency v1\0");
    hasher.update(body.to_string().as_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hex(&hasher.finalize())[..32].to_owned()
}

fn read(path: &Path) -> Option<Resume> {
    let bytes = fs::read(path).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    if value["formatVersion"].as_u64() != Some(FORMAT) {
        return None;
    }
    let key = value["idempotencyKey"].as_str()?;
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return None;
    }
    Some(Resume {
        path: None,
        created_at: value["createdAt"].as_u64()?,
        idempotency_key: key.to_owned(),
        submission_id: value["submissionId"].as_u64(),
        version_id: value["versionId"].as_u64(),
        resumed: true,
    })
}

/// Removes the states older than a day, and those that cannot be read.
fn prune(directory: &Path, now: u64) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let stale =
            read(&path).is_none_or(|saved| now.saturating_sub(saved.created_at) > STALE_AFTER);
        if stale {
            let _ = fs::remove_file(&path);
        }
    }
}

/// `directory`, created if needed, only the user's (0700 on Unix), and
/// not a link; `None` when it cannot be.
fn private_directory(directory: &Path) -> Option<PathBuf> {
    if let Some(parent) = directory.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    if let Err(error) = builder.create(directory)
        && error.kind() != std::io::ErrorKind::AlreadyExists
    {
        return None;
    }
    let metadata = fs::symlink_metadata(directory).ok()?;
    if !metadata.is_dir() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if metadata.permissions().mode() & 0o077 != 0 {
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).ok()?;
        }
    }
    Some(directory.to_path_buf())
}

/// Writes `bytes` through a new private temporary file, then renames it.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(".{}.tmp", std::process::id()));
    let temporary = PathBuf::from(temporary);
    let _ = fs::remove_file(&temporary);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let written = options
        .open(&temporary)
        .and_then(|mut file| file.write_all(bytes))
        .and_then(|()| fs::rename(&temporary, path));
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publish::secret::PublishKey;
    use serde_json::json;

    const KEY: &str = "ocw_pub_q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";

    fn key() -> PublishKey {
        PublishKey::parse(KEY).expect("a key")
    }

    fn body(notes: &str) -> serde_json::Value {
        json!({"version": "1.3.1", "archive": {"bytes": 4, "sha256": "ab"}, "release_notes": {"en": notes}})
    }

    fn files(directory: &Path) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(directory)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .collect()
            })
            .unwrap_or_default();
        found.sort();
        found
    }

    #[test]
    fn the_same_request_resumes_the_same_submission() {
        let cache = tempfile::tempdir().expect("cache");
        let first = Resume::open(
            Some(cache.path()),
            "https://api.example.test",
            &key(),
            &body("A"),
        );
        assert!(!first.resumed);
        assert_eq!(first.idempotency_key.len(), 32);
        assert!(
            first
                .idempotency_key
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        );
        first.save();
        let again = Resume::open(
            Some(cache.path()),
            "https://api.example.test",
            &key(),
            &body("A"),
        );
        assert!(again.resumed);
        assert_eq!(again.idempotency_key, first.idempotency_key);
        // Another text, another API: another submission.
        let other = Resume::open(
            Some(cache.path()),
            "https://api.example.test",
            &key(),
            &body("B"),
        );
        assert!(!other.resumed);
        assert_ne!(other.idempotency_key, first.idempotency_key);
        let elsewhere = Resume::open(Some(cache.path()), "http://127.0.0.1:9", &key(), &body("A"));
        assert!(!elsewhere.resumed);
    }

    #[test]
    fn a_submission_that_ended_is_never_resumed() {
        let cache = tempfile::tempdir().expect("cache");
        let mut first = Resume::open(Some(cache.path()), "https://a.test", &key(), &body("A"));
        first.submission_id = Some(812);
        first.save();
        first.forget();
        let next = Resume::open(Some(cache.path()), "https://a.test", &key(), &body("A"));
        assert!(!next.resumed, "a new key after an ended submission");
        assert_ne!(next.idempotency_key, first.idempotency_key);
        assert!(files(&cache.path().join("submit")).is_empty());
    }

    #[test]
    fn an_upload_left_pending_too_long_is_not_resumed() {
        let cache = tempfile::tempdir().expect("cache");
        let now = 1_000_000;
        let pending = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("A"),
            now,
        );
        pending.save();
        // 56 minutes later the API has expired it (60): start another.
        let later = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("A"),
            now + 56 * 60,
        );
        assert!(!later.resumed);
        // A finalized one is followed whatever its age.
        let mut checking = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("B"),
            now,
        );
        checking.version_id = Some(77);
        checking.save();
        let later = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("B"),
            now + 5 * 3600,
        );
        assert!(later.resumed);
        assert_eq!(later.version_id, Some(77));
        // Files older than a day go.
        let stale = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("C"),
            now,
        );
        stale.save();
        Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("D"),
            now + 25 * 3600,
        );
        assert!(files(&cache.path().join("submit")).is_empty());
    }

    #[test]
    fn the_state_is_private_and_holds_no_key() {
        let cache = tempfile::tempdir().expect("cache");
        let mut state = Resume::open(Some(cache.path()), "https://a.test", &key(), &body("A"));
        state.submission_id = Some(812);
        state.save();
        let directory = cache.path().join("submit");
        let saved = files(&directory);
        assert_eq!(saved.len(), 1);
        let text = std::fs::read_to_string(&saved[0]).expect("state");
        assert!(!text.contains(&KEY[8..]), "{text}");
        let name = saved[0]
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        assert!(!name.contains(&KEY[8..16]));
        let value: serde_json::Value = serde_json::from_str(&text).expect("JSON");
        assert_eq!(value["submissionId"], 812);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = |path: &Path| {
                std::fs::metadata(path)
                    .expect("metadata")
                    .permissions()
                    .mode()
                    & 0o777
            };
            assert_eq!(mode(&directory), 0o700);
            assert_eq!(mode(&saved[0]), 0o600);
        }
    }

    #[test]
    fn without_a_cache_nothing_is_kept() {
        let state = Resume::open(None, "https://a.test", &key(), &body("A"));
        state.save();
        assert!(!state.resumed);
        let other = Resume::open(None, "https://a.test", &key(), &body("A"));
        assert_ne!(other.idempotency_key, state.idempotency_key);
    }

    #[test]
    fn a_submission_the_api_answered_for_is_resumed_at_any_age() {
        let cache = tempfile::tempdir().expect("cache");
        let now = 1_000_000;
        let mut state = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("A"),
            now,
        );
        state.submission_id = Some(812);
        state.save();
        let later = Resume::open_at(
            Some(cache.path()),
            "https://a.test",
            &key(),
            &body("A"),
            now + 3 * 3600,
        );
        assert!(later.resumed, "the API will say it expired");
        assert_eq!(later.submission_id, Some(812));
    }

    #[test]
    fn a_damaged_state_is_ignored() {
        let cache = tempfile::tempdir().expect("cache");
        let first = Resume::open(Some(cache.path()), "https://a.test", &key(), &body("A"));
        first.save();
        let saved = files(&cache.path().join("submit"));
        std::fs::write(&saved[0], b"{not json").expect("damage");
        let next = Resume::open(Some(cache.path()), "https://a.test", &key(), &body("A"));
        assert!(!next.resumed);
    }
}
