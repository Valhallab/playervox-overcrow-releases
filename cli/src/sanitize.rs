//! Text a widget controls (its log lines, IDs and codes the overlay relays)
//! reaches the creator's terminal only through [`terminal`]: a widget must
//! not move the cursor, change the window title, write the clipboard
//! (OSC 52), print hyperlinks or reorder text with bidirectional controls.

/// Characters kept on one line of a relayed text; the rest is cut.
pub const MAX_LINE_CHARS: usize = 512;

/// Whether `c` could steer a terminal or reorder what it shows: C0 controls
/// (ESC included) but tab, DEL, C1 controls, the line and paragraph
/// separators, and the bidirectional embeddings, overrides, isolates and
/// marks.
fn is_unsafe(c: char) -> bool {
    matches!(c,
        '\u{0}'..='\u{8}' | '\u{a}'..='\u{1f}' | '\u{7f}'..='\u{9f}'
        | '\u{200e}' | '\u{200f}' | '\u{2028}' | '\u{2029}'
        | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{61c}')
}

/// A line of JSON for a terminal: `serde_json` escapes C0 controls only;
/// every other unsafe character becomes a `\uXXXX` escape, which JSON
/// readers decode to the same text.
pub fn json(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for c in line.chars() {
        if is_unsafe(c) {
            out.push_str(&format!("\\u{:04x}", u32::from(c)));
        } else {
            out.push(c);
        }
    }
    out
}

/// One line of untrusted text for a terminal: every unsafe character shown
/// as `\u{…}` (so a creator still sees it), newlines included, and at most
/// [`MAX_LINE_CHARS`] characters, the cut marked with `…`.
pub fn line(text: &str) -> String {
    let mut out = String::new();
    for (count, c) in text.chars().enumerate() {
        if count == MAX_LINE_CHARS {
            out.push('…');
            break;
        }
        if is_unsafe(c) {
            out.push_str(&format!("\\u{{{:x}}}", u32::from(c)));
        } else {
            out.push(c);
        }
    }
    out
}

/// Untrusted text of several lines: each line through [`line`], at most
/// `max_lines`, the rest counted.
pub fn terminal(text: &str, max_lines: usize) -> Vec<String> {
    let mut lines: Vec<String> = text.split('\n').take(max_lines).map(line).collect();
    let total = text.split('\n').count();
    if total > max_lines {
        lines.push(format!("… {} more line(s)", total - max_lines));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_cannot_reach_the_terminal() {
        for hostile in [
            "\u{1b}]52;c;aGVsbG8=\u{7}",              // OSC 52 clipboard
            "\u{1b}]0;title\u{1b}\\",                 // window title
            "\u{1b}]8;;https://example.com\u{7}link", // hyperlink
            "\u{1b}[2J\u{1b}[H",                      // clear, home
            "\u{9b}31m",                              // C1 CSI
            "\u{9d}0;title\u{9c}",                    // C1 OSC and ST
            "a\rb\u{8}c\u{7f}",                       // CR, backspace, DEL
            "\u{202e}txt.exe",                        // right-to-left override
            "\u{2066}isolate\u{2069}\u{200f}\u{61c}", // isolates and marks
        ] {
            let shown = line(hostile);
            assert!(
                shown.chars().all(|c| !is_unsafe(c)),
                "{hostile:?} became {shown:?}"
            );
        }
        assert_eq!(line("\u{1b}[31mred"), "\\u{1b}[31mred");
        assert_eq!(line("tab\tkept"), "tab\tkept");
        assert_eq!(line("é ✓ 日本"), "é ✓ 日本");
    }

    #[test]
    fn json_lines_decode_to_the_same_text() {
        let text = "\u{1b}]0;x\u{7}\u{9b}\u{202e}\u{2028}ok";
        let encoded = serde_json::to_string(&serde_json::json!({ "text": text })).expect("JSON");
        let shown = json(&encoded);
        assert!(shown.chars().all(|c| !is_unsafe(c)), "{shown:?}");
        let decoded: serde_json::Value = serde_json::from_str(&shown).expect("still JSON");
        assert_eq!(decoded["text"], text);
    }

    #[test]
    fn lines_are_bounded() {
        let long = "x".repeat(MAX_LINE_CHARS + 10);
        let shown = line(&long);
        assert_eq!(shown.chars().count(), MAX_LINE_CHARS + 1);
        assert!(shown.ends_with('…'));
        assert_eq!(
            terminal("a\nb\u{1b}\nc\nd", 2),
            ["a", "b\\u{1b}", "… 2 more line(s)"]
        );
        // A newline inside one line of output is escaped.
        assert_eq!(line("a\nb"), "a\\u{a}b");
    }
}
