//! Characters that text shown to players never holds: one rule for the
//! catalog's display text (publisher names, listings, release notes) and
//! for the manifest's labels (widget names, menu labels), so that no name
//! reads otherwise than it is written ("Trojan Source").

use std::ops::RangeInclusive;

/// Characters that change how text reads without being visible, or that
/// look blank: soft hyphen, combining grapheme joiner, bidirectional marks,
/// embeddings and isolates, zero-width and joiner characters, line and
/// paragraph separators (not control characters, yet line breaks), Hangul
/// and braille fillers, Khmer and Mongolian invisible signs, interlinear
/// annotations, shorthand format controls, musical format characters and the
/// whole tag and supplementary variation selector block. Display text and
/// labels never contain them, so a publisher or widget name cannot be
/// reversed, blanked or carry hidden text.
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

/// The first hidden character of `text` and its index in Unicode scalar
/// values, from 0: an [`INVISIBLE_CHARACTERS`] one, or a variation selector
/// that starts the text or follows another selector.
pub fn hidden_character(text: &str) -> Option<(usize, char)> {
    let mut previous: Option<char> = None;
    for (index, character) in text.chars().enumerate() {
        let misplaced_selector = VARIATION_SELECTORS.contains(&character)
            && previous.is_none_or(|previous| VARIATION_SELECTORS.contains(&previous));
        if misplaced_selector
            || INVISIBLE_CHARACTERS
                .iter()
                .any(|range| range.contains(&character))
        {
            return Some((index, character));
        }
        previous = Some(character);
    }
    None
}

/// `text` without its hidden characters: every [`INVISIBLE_CHARACTERS`]
/// one and every misplaced variation selector (at the start, or after
/// another selector), the characters [`hidden_character`] finds. Text a
/// host projects from a third party (Twitch event fields) goes through it,
/// so that it reads as the catalog's display text does.
pub fn strip_hidden(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut previous: Option<char> = None;
    for character in text.chars() {
        if INVISIBLE_CHARACTERS
            .iter()
            .any(|range| range.contains(&character))
        {
            continue;
        }
        if VARIATION_SELECTORS.contains(&character)
            && previous.is_none_or(|previous| VARIATION_SELECTORS.contains(&previous))
        {
            continue;
        }
        kept.push(character);
        previous = Some(character);
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_character_gives_the_first_one_and_its_character_index() {
        assert_eq!(hidden_character(""), None);
        assert_eq!(hidden_character("Clock"), None);
        assert_eq!(hidden_character("\u{e9}\u{202e}x"), Some((1, '\u{202e}')));
        assert_eq!(
            hidden_character("a\u{200b}b\u{202e}"),
            Some((1, '\u{200b}'))
        );
        assert_eq!(hidden_character("a\u{e0041}"), Some((1, '\u{e0041}')));
        assert_eq!(hidden_character("\u{fe0f}"), Some((0, '\u{fe0f}')));
        assert_eq!(
            hidden_character("\u{23f1}\u{fe0f}\u{fe0f}"),
            Some((2, '\u{fe0f}'))
        );
        assert_eq!(hidden_character("\u{23f1}\u{fe0f} Timer"), None);
    }

    #[test]
    fn strip_hidden_leaves_what_hidden_character_accepts() {
        assert_eq!(strip_hidden("Clock"), "Clock");
        assert_eq!(strip_hidden("\u{202e}a\u{200b}b\u{e0041}"), "ab");
        assert_eq!(
            strip_hidden("\u{fe0f}\u{23f1}\u{fe0f}\u{fe0f} Timer"),
            "\u{23f1}\u{fe0f} Timer"
        );
        for text in ["a\u{2028}b", "\u{fe0f}x", "x\u{fe0e}\u{fe0f}", "\u{180e}"] {
            assert_eq!(hidden_character(&strip_hidden(text)), None, "{text:?}");
        }
    }
}
