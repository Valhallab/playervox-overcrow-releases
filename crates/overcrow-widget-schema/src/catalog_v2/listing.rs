//! Text, links, licence and games of a catalog v2 listing.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::RangeInclusive;

use serde_json::Value;

use super::{Game, LocalizedText};
use crate::catalog::valid_locale;
use crate::identifiers::dns_name;
use crate::limits::{
    MAX_CATALOG_URL_BYTES, MAX_GAME_NAME_CHARS, MAX_GAME_SLUG_BYTES, MAX_LISTING_GAMES,
    MAX_LISTING_LOCALIZATIONS, MAX_SPDX_LICENSE_BYTES, MAX_SUPPORT_EMAIL_BYTES,
};

/// The only `LicenseRef-` a listing may carry, alone: closed source, all
/// rights reserved.
pub const PROPRIETARY_LICENSE: &str = "LicenseRef-Proprietary";

/// Characters that change how text reads without being visible, or that
/// look blank: soft hyphen, combining grapheme joiner, bidirectional marks,
/// embeddings and isolates, zero-width and joiner characters, line and
/// paragraph separators (not control characters, yet line breaks), Hangul
/// and braille fillers, Khmer and Mongolian invisible signs, interlinear
/// annotations, shorthand format controls, musical format characters and the
/// whole tag and supplementary variation selector block. Display text never contains them, so a publisher
/// name cannot be reversed, blanked or carry hidden text.
pub const INVISIBLE_CHARACTERS: &[RangeInclusive<char>] = &[
    '\u{00AD}'..='\u{00AD}',
    '\u{034F}'..='\u{034F}',
    '\u{061C}'..='\u{061C}',
    '\u{115F}'..='\u{1160}',
    '\u{17B4}'..='\u{17B5}',
    '\u{180B}'..='\u{180F}',
    '\u{200B}'..='\u{200F}',
    '\u{2028}'..='\u{202E}',
    '\u{2060}'..='\u{206F}',
    '\u{2800}'..='\u{2800}',
    '\u{3164}'..='\u{3164}',
    '\u{FEFF}'..='\u{FEFF}',
    '\u{FFA0}'..='\u{FFA0}',
    '\u{FFF9}'..='\u{FFFB}',
    '\u{1BCA0}'..='\u{1BCA3}',
    '\u{1D173}'..='\u{1D17A}',
    '\u{E0000}'..='\u{E0FFF}',
];

/// Variation selectors: accepted only right after a character that is not
/// one (an emoji and its presentation selector), never in a run.
const VARIATION_SELECTORS: RangeInclusive<char> = '\u{FE00}'..='\u{FE0F}';

/// Display text: non-empty, at most `max_chars` Unicode scalar values,
/// without leading or trailing white space, control character (except line
/// feeds when `lines`), `<`, `>` or invisible character.
pub fn display_text(text: &str, max_chars: u64, lines: bool) -> bool {
    !text.is_empty()
        && text.len() as u64 <= max_chars.saturating_mul(4)
        && text.chars().count() as u64 <= max_chars
        && text.trim() == text
        && !text.contains(['<', '>'])
        && text.chars().all(|character| {
            (!character.is_control() || (lines && character == '\n'))
                && !INVISIBLE_CHARACTERS
                    .iter()
                    .any(|range| range.contains(&character))
        })
        && text
            .chars()
            .zip(std::iter::once(None).chain(text.chars().map(Some)))
            .all(|(character, previous)| {
                !VARIATION_SELECTORS.contains(&character)
                    || previous.is_some_and(|previous| !VARIATION_SELECTORS.contains(&previous))
            })
}

/// `{ locale: text }` with `en`, at most `MAX_LISTING_LOCALIZATIONS`
/// locales of the v1 grammar, each text valid display text.
pub(super) fn localized(value: &Value, max_chars: u64, lines: bool) -> Option<LocalizedText> {
    let object = value.as_object()?;
    if !object.contains_key("en") || object.len() as u64 > MAX_LISTING_LOCALIZATIONS.value {
        return None;
    }
    let mut texts = BTreeMap::new();
    for (locale, text) in object {
        let text = text.as_str()?;
        if !valid_locale(locale) || !display_text(text, max_chars, lines) {
            return None;
        }
        texts.insert(locale.clone(), text.to_owned());
    }
    Some(texts)
}

/// A listing link: `https://` with a lowercase DNS host, a path (`/` at
/// least, segments of `[A-Za-z0-9._~-]` and `%XX`, a final slash allowed),
/// an optional query of `[A-Za-z0-9._~=&+-]` and `%XX`; no port, user
/// information, fragment, empty or dot segment; at most
/// `MAX_CATALOG_URL_BYTES`.
pub fn link(url: &str) -> bool {
    if url.len() as u64 > MAX_CATALOG_URL_BYTES.value || !url.is_ascii() {
        return false;
    }
    let Some((host, target)) = url
        .strip_prefix("https://")
        .and_then(|rest| rest.find('/').map(|slash| rest.split_at(slash)))
    else {
        return false;
    };
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (target, None),
    };
    let segments: Vec<&str> = path[1..].split('/').collect();
    let last = segments.len() - 1;
    let path_valid = segments.iter().enumerate().all(|(index, segment)| {
        if segment.is_empty() {
            // `/` alone, or a final slash.
            return index == last;
        }
        !matches!(*segment, "." | "..")
            && encoded(segment, |byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-')
            })
    });
    dns_name(host)
        && path_valid
        && query.is_none_or(|query| {
            !query.is_empty()
                && encoded(query, |byte| {
                    byte.is_ascii_alphanumeric()
                        || matches!(byte, b'.' | b'_' | b'~' | b'=' | b'&' | b'+' | b'-')
                })
        })
}

/// Bytes accepted by `plain`, or `%` and two uppercase hexadecimal digits
/// that encode neither an unreserved character (written plain in the
/// canonical form, so `%2E%2E` is no hidden `..`), nor `/`, `\` or a control
/// character.
fn encoded(text: &str, plain: impl Fn(u8) -> bool) -> bool {
    let bytes = text.as_bytes();
    let digit = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let value = bytes
                .get(index + 1)
                .copied()
                .and_then(digit)
                .zip(bytes.get(index + 2).copied().and_then(digit))
                .map(|(high, low)| (high << 4) | low);
            let Some(value) = value else {
                return false;
            };
            if value < 0x20
                || value == 0x7f
                || matches!(value, b'/' | b'\\' | b'-' | b'.' | b'_' | b'~')
                || value.is_ascii_alphanumeric()
            {
                return false;
            }
            index += 3;
        } else if plain(bytes[index]) {
            index += 1;
        } else {
            return false;
        }
    }
    true
}

/// A public support address: `local@domain`, the local part of
/// `[A-Za-z0-9._+-]` without a dot at either end or two in a row, the
/// domain a lowercase DNS name, at most `MAX_SUPPORT_EMAIL_BYTES`.
pub fn email(address: &str) -> bool {
    let Some((local, domain)) = address.split_once('@') else {
        return false;
    };
    address.len() as u64 <= MAX_SUPPORT_EMAIL_BYTES.value
        && (1..=64).contains(&local.len())
        && local
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'+' | b'-'))
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && dns_name(domain)
}

/// A simple SPDX license expression, by grammar only, or exactly
/// [`PROPRIETARY_LICENSE`]: short identifiers `[A-Za-z0-9][A-Za-z0-9.-]*`
/// with an optional final `+`, the operators `AND`, `OR` and `WITH` (an
/// exception after one identifier), parentheses, single spaces between
/// words; no other `LicenseRef-`, `DocumentRef-` or `AdditionRef-`, in any
/// case. Applications never check
/// the SPDX list, which grows: the catalog producer does.
pub fn spdx_license(expression: &str) -> bool {
    if expression == PROPRIETARY_LICENSE {
        return true;
    }
    if expression.is_empty() || expression.len() as u64 > MAX_SPDX_LICENSE_BYTES.value {
        return false;
    }
    let Some(tokens) = license_tokens(expression) else {
        return false;
    };
    // One spelling per expression: single spaces, none inside parentheses.
    if render(&tokens) != expression {
        return false;
    }
    let mut parser = LicenseParser {
        tokens: &tokens,
        position: 0,
    };
    parser.expression() && parser.position == tokens.len()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Token<'a> {
    Open,
    Close,
    Word(&'a str),
}

fn license_tokens(text: &str) -> Option<Vec<Token<'_>>> {
    let bytes = text.as_bytes();
    let word = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-');
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'(' => tokens.push(Token::Open),
            b')' => tokens.push(Token::Close),
            b' ' => {}
            byte if word(byte) => {
                let start = index;
                while index + 1 < bytes.len() && word(bytes[index + 1]) {
                    index += 1;
                }
                tokens.push(Token::Word(&text[start..=index]));
            }
            _ => return None,
        }
        index += 1;
    }
    Some(tokens)
}

fn render(tokens: &[Token<'_>]) -> String {
    let mut text = String::new();
    for (index, token) in tokens.iter().enumerate() {
        if index > 0 && tokens[index - 1] != Token::Open && *token != Token::Close {
            text.push(' ');
        }
        text.push_str(match token {
            Token::Open => "(",
            Token::Close => ")",
            Token::Word(word) => word,
        });
    }
    text
}

/// `expression := and (OR and)*`, `and := term (AND term)*`,
/// `term := ( expression ) | license [WITH exception]`.
struct LicenseParser<'a> {
    tokens: &'a [Token<'a>],
    position: usize,
}

impl LicenseParser<'_> {
    fn expression(&mut self) -> bool {
        self.and() && self.repeat("OR", Self::and)
    }

    fn and(&mut self) -> bool {
        self.term() && self.repeat("AND", Self::term)
    }

    fn repeat(&mut self, operator: &str, operand: fn(&mut Self) -> bool) -> bool {
        while self.next_is(Token::Word(operator)) {
            self.position += 1;
            if !operand(self) {
                return false;
            }
        }
        true
    }

    fn term(&mut self) -> bool {
        match self.tokens.get(self.position).copied() {
            Some(Token::Open) => {
                self.position += 1;
                if !self.expression() || !self.next_is(Token::Close) {
                    return false;
                }
                self.position += 1;
                true
            }
            Some(Token::Word(license)) if license_id(license, true) => {
                self.position += 1;
                if self.next_is(Token::Word("WITH")) {
                    self.position += 1;
                    match self.tokens.get(self.position).copied() {
                        Some(Token::Word(exception)) if license_id(exception, false) => {
                            self.position += 1;
                        }
                        _ => return false,
                    }
                }
                true
            }
            _ => false,
        }
    }

    fn next_is(&self, token: Token<'_>) -> bool {
        self.tokens.get(self.position) == Some(&token)
    }
}

/// A short SPDX identifier `[A-Za-z0-9][A-Za-z0-9.-]*`, with a final `+`
/// when `plus`; neither an operator nor a license, document or addition
/// reference, in any case.
fn license_id(word: &str, plus: bool) -> bool {
    let id = if plus {
        word.strip_suffix('+').unwrap_or(word)
    } else {
        word
    };
    let lowercase = id.to_ascii_lowercase();
    !matches!(id, "AND" | "OR" | "WITH")
        && !["licenseref-", "documentref-", "additionref-"]
            .iter()
            .any(|reference| lowercase.starts_with(reference))
        && id
            .as_bytes()
            .first()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

/// The `games` list: at most `MAX_LISTING_GAMES` games distinct by ID.
pub(super) fn games(value: &Value) -> Option<Vec<Game>> {
    let list = value.as_array()?;
    if list.len() as u64 > MAX_LISTING_GAMES.value {
        return None;
    }
    let mut ids = BTreeSet::new();
    list.iter()
        .map(|game| {
            // Unknown keys of a game are ignored (forward compatibility).
            let game = game.as_object()?;
            let id = game
                .get("id")?
                .as_u64()
                .filter(|id| (1..(1 << 53)).contains(id))?;
            let slug = game.get("slug")?.as_str().filter(|slug| game_slug(slug))?;
            let name = game
                .get("name")?
                .as_str()
                .filter(|name| display_text(name, MAX_GAME_NAME_CHARS.value, false))?;
            ids.insert(id).then(|| Game {
                id,
                slug: slug.to_owned(),
                name: name.to_owned(),
            })
        })
        .collect()
}

/// `[a-z0-9-]` starting and ending with a letter or digit.
fn game_slug(slug: &str) -> bool {
    let edge = |byte: Option<&u8>| {
        byte.is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    };
    slug.len() as u64 <= MAX_GAME_SLUG_BYTES.value
        && edge(slug.as_bytes().first())
        && edge(slug.as_bytes().last())
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn display_text_is_plain_and_counted_in_characters() {
        assert!(display_text("Raid timers", 64, false));
        assert!(display_text("Line one.\nLine two.", 500, true));
        assert!(!display_text("Line one.\nLine two.", 500, false));
        for bad in [
            "",
            " x",
            "x ",
            "x\n",
            "a<b",
            "a>b",
            "a\rb",
            "a\tb",
            "a\u{7f}b",
            "a\u{202e}b",
            "a\u{200b}b",
            "a\u{2066}b",
            "a\u{feff}b",
            "a\u{ad}b",
        ] {
            assert!(!display_text(bad, 500, true), "{bad:?}");
        }
        // Line separators that are not control characters, blank-looking
        // fillers, hidden tag characters and other format characters.
        for bad in [
            "a\u{2028}b",
            "a\u{2029}b",
            "a\u{85}b",
            "\u{3164}",
            "a\u{3164}",
            "a\u{115f}b",
            "a\u{ffa0}b",
            "a\u{2800}b",
            "a\u{34f}b",
            "a\u{17b4}b",
            "a\u{180b}b",
            "a\u{206a}b",
            "a\u{fff9}b",
            "a\u{1d173}b",
            "a\u{e0041}b",
            "a\u{e0100}b",
        ] {
            assert!(!display_text(bad, 500, true), "{bad:?}");
        }
        // Shorthand format controls, the rest of the tag block, and
        // variation selectors that follow nothing or another selector.
        for bad in [
            "Raid\u{1bca0}forge",
            "a\u{e0080}b",
            "a\u{e01f0}b",
            "\u{fe0f}a",
            "a\u{fe0f}\u{fe0f}",
            "a\u{fe00}\u{fe0e}b",
        ] {
            assert!(!display_text(bad, 500, true), "{bad:?}");
        }
        // Emoji keep their presentation selector; non-breaking spaces stay.
        assert!(display_text("Night Owl \u{2764}\u{fe0f}", 64, false));
        assert!(display_text("12\u{a0}h", 64, false));
        let accented = "é".repeat(500);
        assert!(display_text(&accented, 500, true));
        assert!(!display_text(&format!("{accented}é"), 500, true));
        assert!(display_text(&"漢".repeat(500), 500, true));
    }

    #[test]
    fn localized_text_needs_english_and_at_most_sixteen_locales() {
        let english = localized(&json!({"en": "Timers", "fr": "Minuteurs"}), 32, false)
            .expect("valid labels");
        assert_eq!(english["fr"], "Minuteurs");
        let mut many = serde_json::Map::new();
        many.insert("en".into(), json!("Timers"));
        for locale in [
            "fr", "de", "es", "it", "pt", "nl", "pl", "sv", "da", "fi", "nb", "cs", "hu", "ro",
            "tr",
        ] {
            many.insert(locale.into(), json!("x"));
        }
        assert!(localized(&Value::Object(many.clone()), 32, false).is_some());
        many.insert("pt-BR".into(), json!("x"));
        assert!(localized(&Value::Object(many), 32, false).is_none());
        for bad in [
            json!({"fr": "Minuteurs"}),
            json!({}),
            json!({"en": "Timers", "EN": "Timers"}),
            json!({"en": "Timers", "en-us": "x"}),
            json!({"en": "Timers", "eng": "x"}),
            json!({"en": ""}),
            json!({"en": 3}),
            json!(["en", "Timers"]),
        ] {
            assert!(localized(&bad, 32, false).is_none(), "{bad}");
        }
    }

    #[test]
    fn links_are_canonical_https_urls() {
        for ok in [
            "https://raidforge.gg/",
            "https://raidforge.gg/privacy",
            "https://example.com/privacy-policy/",
            "https://docs.google.com/document/d/1AbC_x-9/edit?usp=sharing",
            "https://raidforge.notion.site/Politique-de-confidentialit%C3%A9",
            "https://github.com/raidforge/timers/issues",
            "https://raidforge.gg/a%20b?q=%C3%A9",
        ] {
            assert!(link(ok), "{ok}");
        }
        let long = format!("https://raidforge.gg/{}", "a".repeat(2028));
        for bad in [
            "http://raidforge.gg/privacy",
            "https://raidforge.gg",
            "https://RAIDFORGE.gg/",
            "https://raidforge.gg:8443/",
            "https://user@raidforge.gg/",
            "https://raidforge.gg/a#b",
            "https://raidforge.gg/a/../b",
            "https://raidforge.gg/./b",
            "https://raidforge.gg//a",
            "https://127.0.0.1/",
            "https://localhost/",
            "https://raidforge.gg/%zz",
            "https://raidforge.gg/%c3%a9",
            "https://raidforge.gg/a/%2E%2E/privacy",
            "https://raidforge.gg/%2E/privacy",
            "https://raidforge.gg/%41bc",
            "https://raidforge.gg/a%2Fb",
            "https://raidforge.gg/a%5Cb",
            "https://raidforge.gg/a%00b",
            "https://raidforge.gg/a%7Fb",
            "https://raidforge.gg/a?b=%2E",
            "https://raidforge.gg/a?",
            "https://raidforge.gg/a?b c",
            "https://raidforge.gg/a b",
            "https://raidforgé.gg/",
            "javascript:alert(1)",
            long.as_str(),
        ] {
            assert!(!link(bad), "{bad}");
        }
    }

    #[test]
    fn support_addresses_are_plain_ascii() {
        for ok in [
            "support@raidforge.gg",
            "first.last+ocw@example.co.uk",
            "A_b-1@x.io",
        ] {
            assert!(email(ok), "{ok}");
        }
        let long = format!("{}@{}.com", "a".repeat(64), "b".repeat(186));
        for bad in [
            "support@",
            "@raidforge.gg",
            ".a@x.gg",
            "a.@x.gg",
            "a..b@x.gg",
            "a@Raidforge.gg",
            "a b@x.gg",
            "a@x",
            "a@b@x.gg",
            "mailto:a@x.gg",
            "\"a\"@x.gg",
            long.as_str(),
        ] {
            assert!(!email(bad), "{bad}");
        }
    }

    #[test]
    fn licenses_are_simple_spdx_expressions_or_proprietary() {
        for ok in [
            "MIT",
            "Apache-2.0",
            "GPL-3.0+",
            "MIT OR Apache-2.0",
            "(MIT OR Apache-2.0) AND CC-BY-4.0",
            "GPL-3.0-or-later WITH Classpath-exception-2.0",
            "MIT AND (Apache-2.0 OR BSD-3-Clause)",
            "LicenseRef-Proprietary",
        ] {
            assert!(spdx_license(ok), "{ok}");
        }
        let long = format!("{} OR MIT", "A".repeat(58));
        for bad in [
            "",
            "LicenseRef-Custom",
            "LicenseRef-Other",
            "MIT OR LicenseRef-Proprietary",
            "(LicenseRef-Proprietary)",
            "DocumentRef-x:LicenseRef-y",
            "Proprietary License",
            "MIT or Apache-2.0",
            "MIT OR",
            "OR MIT",
            "(MIT",
            "MIT)",
            "()",
            "MIT  OR Apache-2.0",
            " MIT",
            "( MIT OR Apache-2.0 )",
            "MIT WITH GPL-3.0 WITH X",
            "(MIT OR Apache-2.0) WITH X",
            "MIT+ WITH X+",
            "-MIT",
            "GPL+2.0",
            "AND",
            "MIT/Apache-2.0",
            "licenseref-custom",
            "licenseref-proprietary",
            "MIT OR LICENSEREF-Proprietary",
            "MIT AND documentref-x",
            "MIT WITH AdditionRef-x",
            "MIT WITH additionref-x",
            long.as_str(),
        ] {
            assert!(!spdx_license(bad), "{bad}");
        }
    }

    #[test]
    fn games_are_distinct_playervox_games() {
        let game = |id: u64| json!({"id": id, "slug": format!("game-{id}"), "name": "A game"});
        let five: Vec<Value> = (1..=5).map(game).collect();
        let parsed = games(&json!(five)).expect("five games");
        assert_eq!(parsed[0].slug, "game-1");
        assert_eq!(games(&json!([])), Some(Vec::new()));
        let six: Vec<Value> = (1..=6).map(game).collect();
        assert!(games(&json!(six)).is_none());
        // Unknown keys of a game are ignored.
        assert!(games(&json!([{"id": 7, "slug": "x", "name": "X", "cover": "y"}])).is_some());
        let long_name = "n".repeat(101);
        for bad in [
            json!([game(1), game(1)]),
            json!([{"id": 0, "slug": "x", "name": "X"}]),
            json!([{"id": 9_007_199_254_740_992_u64, "slug": "x", "name": "X"}]),
            json!([{"id": "7", "slug": "x", "name": "X"}]),
            json!([{"id": 7, "slug": "The-Witcher", "name": "X"}]),
            json!([{"id": 7, "slug": "-witcher", "name": "X"}]),
            json!([{"id": 7, "slug": "witcher-", "name": "X"}]),
            json!([{"id": 7, "slug": "", "name": "X"}]),
            json!([{"id": 7, "slug": "x", "name": long_name}]),
            json!([{"id": 7, "slug": "x"}]),
            json!({"id": 7}),
        ] {
            assert!(games(&bad).is_none(), "{bad}");
        }
    }
}
