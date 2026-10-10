//! The publish key (`ocw_pub_…`). It comes only from `OVERCROW_PUBLISH_KEY`,
//! which `main` takes out of the process environment before anything else:
//! no child process of any command inherits it. It is sent only in the
//! `Authorization` header of the API's requests, and every text `submit`
//! and `status` write goes through [`redact`].

use std::sync::Mutex;

/// The only place the key is read from.
pub const KEY_VARIABLE: &str = "OVERCROW_PUBLISH_KEY";
const PREFIX: &str = "ocw_pub_";
/// 32 random bytes in unpadded base64url.
const SECRET_CHARS: usize = 43;
const HIDDEN: &str = "[hidden]";
/// The shortest value of the variable masked as it is.
const MIN_REMEMBERED_BYTES: usize = 16;

/// The value of `OVERCROW_PUBLISH_KEY`, kept to mask it even when it is
/// not a well-formed key.
static REMEMBERED: Mutex<Option<String>> = Mutex::new(None);

/// Reads `OVERCROW_PUBLISH_KEY` and removes it from this process's
/// environment, so that no child process of any command inherits it.
/// `main` calls it before anything else.
pub fn take_from_environment() -> Option<String> {
    let value = std::env::var_os(KEY_VARIABLE)?;
    // SAFETY: called at the start of `main`, while the process has a
    // single thread: nothing reads the environment concurrently.
    unsafe { std::env::remove_var(KEY_VARIABLE) };
    let value = value.into_string().unwrap_or_default();
    remember(&value);
    Some(value)
}

/// Masks `raw` (trimmed) in everything [`redact`] sees from now on.
pub fn remember(raw: &str) {
    let raw = raw.trim();
    // A short value (`null`, `1`) would mask ordinary text: only a value
    // long enough to be a secret is masked as such.
    if raw.len() >= MIN_REMEMBERED_BYTES
        && let Ok(mut remembered) = REMEMBERED.lock()
    {
        *remembered = Some(raw.to_owned());
    }
}

/// A publish key of the expected form. It is never displayed: `Debug` says
/// `PublishKey(hidden)`, and only [`PublishKey::bearer`] gives its value,
/// for the `Authorization` header.
pub struct PublishKey(String);

impl PublishKey {
    /// `ocw_pub_` and 43 base64url characters, white space around ignored
    /// (a secret pasted with its line feed).
    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim();
        let secret = raw.strip_prefix(PREFIX)?;
        let valid = secret.len() == SECRET_CHARS
            && secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
        valid.then(|| Self(raw.to_owned()))
    }

    /// The four characters after `ocw_pub_`, which the creator space shows
    /// next to the key's name.
    pub fn hint(&self) -> &str {
        &self.0[PREFIX.len()..PREFIX.len() + 4]
    }

    /// The `Authorization` header value.
    pub fn bearer(&self) -> String {
        format!("Bearer {}", self.0)
    }

    /// The key's bytes, for the name of a resume state only (hashed).
    pub fn bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl std::fmt::Debug for PublishKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PublishKey(hidden)")
    }
}

/// `text` with every `ocw_pub_[A-Za-z0-9_-]+` replaced by
/// `ocw_pub_[hidden]`, and the remembered value of `OVERCROW_PUBLISH_KEY`
/// by `[hidden]`.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(PREFIX) {
        let after = &rest[at + PREFIX.len()..];
        let secret = after
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
            .count();
        out.push_str(&rest[..at + PREFIX.len()]);
        if secret > 0 {
            out.push_str(HIDDEN);
        }
        rest = &after[secret..];
    }
    out.push_str(rest);
    match REMEMBERED
        .lock()
        .ok()
        .and_then(|remembered| remembered.clone())
    {
        Some(raw) if out.contains(&raw) => out.replace(&raw, HIDDEN),
        _ => out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "ocw_pub_q9XeT4mVb2LzR8nKc1HwY6sJ0pAfD3gUa7Bc-_dWxyz";

    #[test]
    fn a_key_parses_with_surrounding_white_space() {
        let key = PublishKey::parse(&format!("  {KEY}\n")).expect("a key");
        assert_eq!(key.hint(), "q9Xe");
        assert_eq!(key.bearer(), format!("Bearer {KEY}"));
    }

    #[test]
    fn malformed_keys_are_refused() {
        for raw in [
            "",
            "ocw_pub_",
            "ocw_pub_short",
            &KEY[..KEY.len() - 1],
            &format!("{KEY}x"),
            &KEY.replace("ocw_pub_", "ocw_cat_"),
            &KEY.replace('q', "é"),
            &KEY.replace('q', " "),
        ] {
            assert!(PublishKey::parse(raw).is_none(), "{raw:?}");
        }
    }

    #[test]
    fn debug_never_shows_the_key() {
        let key = PublishKey::parse(KEY).expect("a key");
        let shown = format!("{key:?} {:?}", Some(&key));
        assert!(!shown.contains(&KEY[8..]), "{shown}");
        assert!(shown.contains("PublishKey(hidden)"));
    }

    #[test]
    fn keys_are_masked_wherever_they_appear() {
        let hidden = "ocw_pub_[hidden]";
        assert_eq!(redact(&format!("key {KEY}.")), format!("key {hidden}."));
        assert_eq!(
            redact(&format!("{{\"k\":\"{KEY}\",\"again\":\"{KEY}\"}}")),
            format!("{{\"k\":\"{hidden}\",\"again\":\"{hidden}\"}}")
        );
        assert_eq!(redact("xocw_pub_q9Xe…"), format!("x{hidden}…"));
        assert_eq!(redact("ocw_pub_ alone"), "ocw_pub_ alone");
        assert_eq!(redact(hidden), hidden, "masking twice changes nothing");
        assert_eq!(redact("no key here: é ✓"), "no key here: é ✓");
    }

    #[test]
    fn a_short_value_is_not_masked_as_a_key() {
        // `OVERCROW_PUBLISH_KEY=null` must not turn JSON's null into
        // something else.
        remember("null");
        assert_eq!(redact("{\"key\":null}"), "{\"key\":null}");
    }

    #[test]
    fn the_exact_key_is_masked_even_out_of_its_format() {
        remember("not-a-key-but-secret");
        assert_eq!(redact("a not-a-key-but-secret b"), "a [hidden] b");
    }
}
