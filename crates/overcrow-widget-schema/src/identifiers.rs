//! Publisher handles, publisher domains and widget ID ownership (creator
//! portal, catalog v2).
//!
//! A widget ID belongs to one publisher: `<handle>.<name>` (exactly two
//! segments) belongs to the publisher with that handle, and an ID of at
//! least three segments belongs to the publisher owning the domain whose
//! reverse is its prefix (`gg.valhallab.timers` → `valhallab.gg`). The two
//! forms never overlap, since a domain has at least two labels and an ID
//! keeps at least one name segment after it. `com.playervox` and
//! `com.playervox.*` belong only to the publisher `playervox` through
//! `playervox.com`.
//!
//! [`handle_syntax`] and [`domain_syntax`] are grammar only: catalog readers
//! use them, so that a registration policy that grows never makes an older
//! application refuse a catalog. [`validate_handle`] and [`validate_domain`]
//! add the registration policy the creator portal applies.

use crate::catalog_v2::display_text;
use crate::limits::{
    MAX_DNS_LABEL_BYTES, MAX_DNS_NAME_BYTES, MAX_HANDLE_BYTES, MAX_PUBLISHER_NAME_CHARS,
    MAX_WIDGET_ID_BYTES, MIN_HANDLE_BYTES,
};
use crate::manifest::{is_reserved_id, valid_widget_id};

pub const PLAYERVOX_HANDLE: &str = "playervox";
/// The verified domain of the publisher `playervox`: its reverse is the
/// reserved prefix `com.playervox`.
pub const PLAYERVOX_DOMAIN: &str = "playervox.com";

/// Domain extensions refused as handles: the generic top-level domains that
/// predate the 2012 round. Two-letter country extensions are shorter than
/// `MIN_HANDLE_BYTES`. Newer extensions (`games`, `live`, …) stay usable:
/// ownership never depends on this list, which only keeps handle IDs from
/// reading like a well-known reverse domain.
pub const DOMAIN_EXTENSIONS: &[&str] = &[
    "aero", "arpa", "asia", "biz", "cat", "com", "coop", "edu", "gov", "info", "int", "jobs",
    "mil", "mobi", "museum", "name", "net", "org", "post", "pro", "tel", "travel", "xxx",
];

/// A handle containing one of these words once its hyphens are removed is
/// reserved: PlayerVox, OverCrow and Valhallab look-alikes.
pub const RESERVED_HANDLE_WORDS: &[&str] = &["overcrow", "playervox", "valhallab"];

/// Handles reserved for PlayerVox services or likely to mislead players.
pub const RESERVED_HANDLES: &[&str] = &[
    "admin",
    "administrator",
    "api",
    "app",
    "assets",
    "billing",
    "blog",
    "catalog",
    "cdn",
    "creator",
    "creators",
    "dashboard",
    "docs",
    "download",
    "downloads",
    "help",
    "legal",
    "login",
    "mail",
    "marketplace",
    "moderator",
    "null",
    "official",
    "owner",
    "payments",
    "privacy",
    "publisher",
    "publishers",
    "root",
    "security",
    "settings",
    "signup",
    "staff",
    "static",
    "status",
    "support",
    "system",
    "team",
    "terms",
    "undefined",
    "verified",
    "widget",
    "widgets",
    "www",
];

/// Fixed reasons a handle is refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandleError {
    Length,
    Characters,
    Hyphen,
    DomainExtension,
    Reserved,
}

impl HandleError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Length => "length",
            Self::Characters => "characters",
            Self::Hyphen => "hyphen",
            Self::DomainExtension => "domain_extension",
            Self::Reserved => "reserved",
        }
    }
}

/// Fixed reasons a publisher domain is refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainError {
    Syntax,
    Reserved,
}

impl DomainError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Syntax => "syntax",
            Self::Reserved => "reserved",
        }
    }
}

/// Whom a widget ID belongs to, within one publisher.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Owner<'a> {
    /// `<handle>.<name>`.
    Handle,
    /// `<reversed domain>.<name…>`, under this domain of the publisher.
    Domain(&'a str),
}

/// Fixed reasons a widget ID does not belong to a publisher.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OwnershipError {
    /// Not a widget ID of the manifest grammar.
    InvalidId,
    /// `com.playervox` or `com.playervox.*` for another publisher.
    Reserved,
    NotOwned,
}

impl OwnershipError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidId => "invalid_id",
            Self::Reserved => "reserved",
            Self::NotOwned => "not_owned",
        }
    }
}

/// Fixed reasons a displayed publisher name is refused at registration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NameError {
    /// Not display text of at most `MAX_PUBLISHER_NAME_CHARS` on one line.
    Text,
    /// Reads as PlayerVox, OverCrow or Valhallab for another publisher.
    Reserved,
}

impl NameError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Reserved => "reserved",
        }
    }
}

/// Letters outside ASCII that read as the letters of the reserved words:
/// Latin letters with diacritics and Cyrillic and Greek look-alikes, with
/// the ASCII letter they fold to. Fullwidth ASCII folds too.
pub const CONFUSABLE_LETTERS: &[(&str, char)] = &[
    ("àáâãäåāăąǎÀÁÂÃÄÅĀĂĄǍаАαΑ", 'a'),
    ("ƀВЬьβΒ", 'b'),
    ("çćĉċčÇĆĈĊČсСϲ", 'c'),
    ("èéêëēĕėęěÈÉÊËĒĔĖĘĚеЕёЁεΕ", 'e'),
    ("ĥħĤĦһНΗ", 'h'),
    ("ìíîïĩīĭįıÌÍÎÏĨĪĬĮİіІιΙ", 'i'),
    ("ĺļľŀłĹĻĽĿŁӏ", 'l'),
    ("òóôõöøōŏőÒÓÔÕÖØŌŎŐоОοΟσ", 'o'),
    ("рРρΡ", 'p'),
    ("ŕŗřŔŖŘ", 'r'),
    ("ѵѴν", 'v'),
    ("ŵŴԝԜѡ", 'w'),
    ("хХχΧ", 'x'),
    ("ýÿŷÝŸŶуУγΥ", 'y'),
];

/// The lowercase ASCII letter or digit `character` reads as, if any.
fn ascii_letter(character: char) -> Option<char> {
    match character {
        _ if character.is_ascii_alphanumeric() => Some(character.to_ascii_lowercase()),
        '\u{FF10}'..='\u{FF19}' | '\u{FF21}'..='\u{FF3A}' | '\u{FF41}'..='\u{FF5A}' => {
            char::from_u32(u32::from(character) - 0xFEE0).map(|ascii| ascii.to_ascii_lowercase())
        }
        _ => CONFUSABLE_LETTERS
            .iter()
            .find(|(letters, _)| letters.contains(character))
            .map(|(_, ascii)| *ascii),
    }
}

/// A displayed publisher name the creator portal accepts: display text on
/// one line, and, for any publisher but `playervox`, no reserved word in the
/// confusable skeleton of the letters and digits it reads as, once fullwidth
/// forms and [`CONFUSABLE_LETTERS`] are folded to ASCII (`Player Vox`,
/// `0verCrow`, `PlayerVох` in Cyrillic). Other characters are dropped.
/// Catalog readers check display text only.
pub fn validate_publisher_name(name: &str, handle: &str) -> Result<(), NameError> {
    if !display_text(name, MAX_PUBLISHER_NAME_CHARS.value, false) {
        return Err(NameError::Text);
    }
    let letters: String = name.chars().filter_map(ascii_letter).collect();
    let folded = confusable_skeleton(&letters);
    if handle != PLAYERVOX_HANDLE
        && RESERVED_HANDLE_WORDS
            .iter()
            .any(|word| folded.contains(&confusable_skeleton(word)))
    {
        return Err(NameError::Reserved);
    }
    Ok(())
}

/// The handle grammar: `MIN_HANDLE_BYTES`..=`MAX_HANDLE_BYTES` of
/// `[a-z0-9-]`, without a hyphen at either end or two in a row (no
/// look-alike of a punycode `xn--` label).
pub fn handle_syntax(handle: &str) -> Result<(), HandleError> {
    if !(MIN_HANDLE_BYTES.value..=MAX_HANDLE_BYTES.value).contains(&(handle.len() as u64)) {
        return Err(HandleError::Length);
    }
    if !handle
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(HandleError::Characters);
    }
    if handle.starts_with('-') || handle.ends_with('-') || handle.contains("--") {
        return Err(HandleError::Hyphen);
    }
    Ok(())
}

/// A handle a new publisher may register: the grammar, then neither a
/// domain extension nor a reserved handle.
pub fn validate_handle(handle: &str) -> Result<(), HandleError> {
    handle_syntax(handle)?;
    if DOMAIN_EXTENSIONS.contains(&handle) {
        return Err(HandleError::DomainExtension);
    }
    let folded = confusable_skeleton(handle);
    if RESERVED_HANDLES
        .iter()
        .any(|reserved| confusable_skeleton(reserved) == folded)
        || RESERVED_HANDLE_WORDS
            .iter()
            .any(|word| folded.contains(&confusable_skeleton(word)))
    {
        return Err(HandleError::Reserved);
    }
    Ok(())
}

/// The handle without hyphens, with the characters that read alike folded
/// together (`0`/`o`, `1`/`i`/`l`, `3`/`e`, `4`/`a`, `5`/`s`, `7`/`t`,
/// `8`/`b`, `vv`/`w`), so that `p1ayer-v0x` still contains `playervox`.
fn confusable_skeleton(handle: &str) -> String {
    handle
        .replace('-', "")
        .replace("vv", "w")
        .chars()
        .map(|character| match character {
            '0' => 'o',
            '1' | 'i' => 'l',
            '3' => 'e',
            '4' => 'a',
            '5' => 's',
            '7' => 't',
            '8' => 'b',
            other => other,
        })
        .collect()
}

/// A lowercase DNS name of at least two labels of `[a-z0-9-]`, each at most
/// `MAX_DNS_LABEL_BYTES` without a hyphen at either end, whose last label is
/// not numeric (no IPv4 address), short enough for its reverse plus a
/// one-letter name to fit a widget ID.
pub fn domain_syntax(domain: &str) -> Result<(), DomainError> {
    if domain.len() as u64 + 2 <= MAX_WIDGET_ID_BYTES.value && dns_name(domain) {
        Ok(())
    } else {
        Err(DomainError::Syntax)
    }
}

/// A lowercase DNS name of at least two labels, at most
/// `MAX_DNS_NAME_BYTES`, whose last label is not numeric: also the host of a
/// listing link and the domain of a support address.
pub(crate) fn dns_name(name: &str) -> bool {
    let labels: Vec<&str> = name.split('.').collect();
    name.len() as u64 <= MAX_DNS_NAME_BYTES.value
        && labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() as u64 <= MAX_DNS_LABEL_BYTES.value
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && !labels
            .last()
            .is_some_and(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
}

/// A domain the publisher `handle` may verify: the grammar, and
/// `playervox.com` or one of its subdomains only for `playervox`.
pub fn validate_domain(domain: &str, handle: &str) -> Result<(), DomainError> {
    domain_syntax(domain)?;
    if domains_overlap(domain, PLAYERVOX_DOMAIN) && handle != PLAYERVOX_HANDLE {
        return Err(DomainError::Reserved);
    }
    Ok(())
}

/// `eu.valhallab.gg` → `gg.valhallab.eu`.
pub fn reverse_domain(domain: &str) -> String {
    domain.rsplit('.').collect::<Vec<_>>().join(".")
}

/// Whether two domains are equal or one is a subdomain of the other: their
/// widget ID prefixes would then overlap.
pub fn domains_overlap(a: &str, b: &str) -> bool {
    let within = |inner: &str, outer: &str| {
        inner
            .strip_suffix(outer)
            .is_some_and(|rest| rest.ends_with('.'))
    };
    a == b || within(a, b) || within(b, a)
}

/// Whether `id` belongs to the publisher `handle` owning `domains`. Several
/// matching domains of the same publisher name the longest one; a domain
/// outside the grammar owns nothing.
pub fn id_owner<'a>(
    id: &str,
    handle: &str,
    domains: &'a [String],
) -> Result<Owner<'a>, OwnershipError> {
    if !valid_widget_id(id) {
        return Err(OwnershipError::InvalidId);
    }
    if is_reserved_id(id) && handle != PLAYERVOX_HANDLE {
        return Err(OwnershipError::Reserved);
    }
    let segments = id.split('.').count();
    if segments == 2 {
        return match id.split_once('.') {
            Some((prefix, _)) if prefix == handle => Ok(Owner::Handle),
            _ => Err(OwnershipError::NotOwned),
        };
    }
    domains
        .iter()
        .filter(|domain| {
            domain_syntax(domain).is_ok()
                && id
                    .strip_prefix(&reverse_domain(domain))
                    .is_some_and(|rest| rest.starts_with('.'))
        })
        .max_by_key(|domain| domain.len())
        .map(|domain| Owner::Domain(domain.as_str()))
        .ok_or(OwnershipError::NotOwned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_follow_the_grammar_and_the_policy() {
        let longest = "a".repeat(32);
        for ok in [
            "abc",
            "raidforge",
            "night-owl",
            "a1b",
            "123",
            "games",
            "studio-42",
            longest.as_str(),
        ] {
            assert_eq!(validate_handle(ok), Ok(()), "{ok}");
        }
        let too_long = "a".repeat(33);
        for (bad, error) in [
            ("ab", HandleError::Length),
            ("", HandleError::Length),
            (too_long.as_str(), HandleError::Length),
            ("Raidforge", HandleError::Characters),
            ("night_owl", HandleError::Characters),
            ("night.owl", HandleError::Characters),
            ("nuit-étoilée", HandleError::Characters),
            ("-abc", HandleError::Hyphen),
            ("abc-", HandleError::Hyphen),
            ("xn--abc", HandleError::Hyphen),
            ("com", HandleError::DomainExtension),
            ("museum", HandleError::DomainExtension),
            ("playervox", HandleError::Reserved),
            ("player-vox", HandleError::Reserved),
            ("the-playervox-team", HandleError::Reserved),
            ("overcrow-team", HandleError::Reserved),
            ("valhallab-official", HandleError::Reserved),
            ("p1ayervox", HandleError::Reserved),
            ("playerv0x-fan", HandleError::Reserved),
            ("pl4yer-v0x", HandleError::Reserved),
            ("overcr0w", HandleError::Reserved),
            ("0verc-r0w", HandleError::Reserved),
            ("overcrovv", HandleError::Reserved),
            ("va1ha11ab", HandleError::Reserved),
            ("vaihaiiab", HandleError::Reserved),
            ("adm1n", HandleError::Reserved),
            ("ad-min", HandleError::Reserved),
            ("supp0rt", HandleError::Reserved),
            ("w-w-w", HandleError::Reserved),
            ("admin", HandleError::Reserved),
            ("www", HandleError::Reserved),
        ] {
            assert_eq!(validate_handle(bad), Err(error), "{bad}");
        }
        // Catalog readers check the grammar only.
        assert_eq!(handle_syntax("playervox"), Ok(()));
        assert_eq!(handle_syntax("com"), Ok(()));
        assert_eq!(handle_syntax("xn--abc"), Err(HandleError::Hyphen));
    }

    #[test]
    fn publisher_names_cannot_impersonate_playervox() {
        for (name, handle) in [
            ("Raidforge", "raidforge"),
            ("Night Owl Studio", "nightowl"),
            ("Crow Over Studio", "crow-over"),
            ("PlayerVox", PLAYERVOX_HANDLE),
            ("PlayerVox OverCrow", PLAYERVOX_HANDLE),
            ("Studio d\u{e9}tente", "raidforge"),
            (
                "\u{41d}\u{43e}\u{447}\u{43d}\u{430}\u{44f} \u{441}\u{43e}\u{432}\u{430}",
                "nightowl",
            ),
            ("\u{6f22}\u{5b57} Studio", "raidforge"),
        ] {
            assert_eq!(validate_publisher_name(name, handle), Ok(()), "{name}");
        }
        for name in [
            "PlayerVox Official",
            "Player Vox",
            "P1ayer-Vox",
            "0verCrow",
            "OVERCROW Team",
            "Valhallab",
            "Team over.crow",
            // Cyrillic, Greek, fullwidth and accented look-alikes.
            "PlayerV\u{43e}\u{445}",
            "\u{420}l\u{430}y\u{435}rVox",
            "\u{3a1}layerVox",
            "\u{ff30}\u{ff4c}\u{ff41}\u{ff59}\u{ff45}\u{ff52}\u{ff36}\u{ff4f}\u{ff58}",
            "Pl\u{e2}y\u{e8}rv\u{f8}x",
            "Ov\u{435}rcrow",
            "Val\u{4bb}allab",
            "P\u{406}ayerVox",
            "Overcro\u{51d}",
        ] {
            assert_eq!(
                validate_publisher_name(name, "raidforge"),
                Err(NameError::Reserved),
                "{name}"
            );
        }
        for name in [" Raidforge", "Raid\u{202e}forge", "", "Raid<forge>"] {
            assert_eq!(
                validate_publisher_name(name, "raidforge"),
                Err(NameError::Text),
                "{name:?}"
            );
        }
    }

    #[test]
    fn confusable_letters_fold_to_ascii() {
        let mut seen = std::collections::BTreeSet::new();
        for (letters, ascii) in CONFUSABLE_LETTERS {
            assert!(ascii.is_ascii_lowercase());
            for letter in letters.chars() {
                assert!(!letter.is_ascii(), "{letter}");
                assert!(seen.insert(letter), "{letter} is listed twice");
                assert_eq!(ascii_letter(letter), Some(*ascii));
            }
        }
        assert_eq!(ascii_letter('\u{ff21}'), Some('a'));
        assert_eq!(ascii_letter('\u{ff19}'), Some('9'));
        assert_eq!(ascii_letter('\u{6f22}'), None);
        assert_eq!(ascii_letter(' '), None);
    }

    #[test]
    fn policy_lists_are_sorted_and_within_the_grammar() {
        for list in [DOMAIN_EXTENSIONS, RESERVED_HANDLE_WORDS, RESERVED_HANDLES] {
            assert!(!list.is_empty());
            assert!(list.windows(2).all(|pair| pair[0] < pair[1]), "{list:?}");
            for entry in list {
                assert_eq!(handle_syntax(entry), Ok(()), "{entry}");
            }
        }
        for extension in DOMAIN_EXTENSIONS {
            assert!(!RESERVED_HANDLES.contains(extension), "{extension}");
        }
    }

    #[test]
    fn publisher_domains_are_lowercase_dns_names() {
        for ok in [
            "raidforge.gg",
            "eu.raidforge.gg",
            "xn--nuit-toile-b7a.fr",
            "a.co",
        ] {
            assert_eq!(domain_syntax(ok), Ok(()), "{ok}");
        }
        let long = format!("{}.com", "a.".repeat(62));
        for bad in [
            "gg",
            "Raidforge.gg",
            "raidforge.gg.",
            ".raidforge.gg",
            "raidforge..gg",
            "-raidforge.gg",
            "raidforge-.gg",
            "raidforge.123",
            "127.0.0.1",
            "val_hallab.gg",
            "raidforge.gg:443",
            long.as_str(),
        ] {
            assert_eq!(domain_syntax(bad), Err(DomainError::Syntax), "{bad}");
        }
        assert_eq!(validate_domain("playervox.com", "playervox"), Ok(()));
        assert_eq!(
            validate_domain("overcrow.playervox.com", "playervox"),
            Ok(())
        );
        assert_eq!(
            validate_domain("playervox.com", "raidforge"),
            Err(DomainError::Reserved)
        );
        assert_eq!(
            validate_domain("eu.playervox.com", "raidforge"),
            Err(DomainError::Reserved)
        );
        assert_eq!(validate_domain("myplayervox.com", "raidforge"), Ok(()));
        assert_eq!(reverse_domain("eu.raidforge.gg"), "gg.raidforge.eu");
        assert!(domains_overlap("raidforge.gg", "raidforge.gg"));
        assert!(domains_overlap("eu.raidforge.gg", "raidforge.gg"));
        assert!(domains_overlap("raidforge.gg", "eu.raidforge.gg"));
        assert!(!domains_overlap("myraidforge.gg", "raidforge.gg"));
        assert!(!domains_overlap("raidforge.gg", "raidforge.com"));
    }

    #[test]
    fn ids_belong_to_a_handle_or_a_domain() {
        let raidforge = vec!["raidforge.gg".to_owned()];
        let owner = |id: &str| id_owner(id, "raidforge", &raidforge);
        assert_eq!(owner("raidforge.timers"), Ok(Owner::Handle));
        assert_eq!(
            owner("gg.raidforge.timers"),
            Ok(Owner::Domain("raidforge.gg"))
        );
        assert_eq!(
            owner("gg.raidforge.raid.timers"),
            Ok(Owner::Domain("raidforge.gg"))
        );
        assert_eq!(owner("other.timers"), Err(OwnershipError::NotOwned));
        assert_eq!(
            owner("raidforge.raid.timers"),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(owner("gg.raidforge"), Err(OwnershipError::NotOwned));
        assert_eq!(owner("gg.raidforgex.timers"), Err(OwnershipError::NotOwned));
        assert_eq!(owner("Bad..id"), Err(OwnershipError::InvalidId));
        assert_eq!(owner("timers"), Err(OwnershipError::InvalidId));

        // The longest of a publisher's own nested domains names the owner.
        let nested = vec!["raidforge.gg".to_owned(), "eu.raidforge.gg".to_owned()];
        assert_eq!(
            id_owner("gg.raidforge.eu.timers", "raidforge", &nested),
            Ok(Owner::Domain("eu.raidforge.gg"))
        );

        let playervox = vec![PLAYERVOX_DOMAIN.to_owned()];
        assert_eq!(
            id_owner("com.playervox.overcrow.clock", "playervox", &playervox),
            Ok(Owner::Domain("playervox.com"))
        );
        assert_eq!(
            id_owner("com.playervox.clock", "raidforge", &playervox),
            Err(OwnershipError::Reserved)
        );
        assert_eq!(
            id_owner("com.playervox.clock", "playervox", &[]),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(
            id_owner("com.playervox", "playervox", &playervox),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(
            id_owner("playervox.clock", "playervox", &playervox),
            Ok(Owner::Handle)
        );
        // Only domains of the grammar own anything.
        for bogus in ["com", "", "gg.", "Raidforge.gg", "raidforge..gg"] {
            let domains = vec![bogus.to_owned()];
            assert_eq!(
                id_owner("com.example.timers", "raidforge", &domains),
                Err(OwnershipError::NotOwned),
                "{bogus:?}"
            );
            assert_eq!(
                id_owner("gg.raidforge.timers", "raidforge", &domains),
                Err(OwnershipError::NotOwned),
                "{bogus:?}"
            );
        }
        let lookalike = vec!["playervoxx.com".to_owned()];
        assert_eq!(
            id_owner("com.playervoxx.clock", "raidforge", &lookalike),
            Ok(Owner::Domain("playervoxx.com"))
        );
    }
}
