//! Diagnostics of every command: `<severity>[<domain>.<category>]: message`,
//! the file, line and column, the source line with a caret, and an optional
//! `help`. Categories are the stable `as_str()` names of the public
//! validators (or this CLI's own for the lint), so scripts and tests can
//! match them; messages and help are for people and may improve over time.
//! Lines and columns are one-based; columns count Unicode scalar values of
//! the UTF-8 source, as `overcrow_widget_format::Position` does.

use std::fmt::Write as _;

use overcrow_widget_format::Position;
use serde_json::json;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Severity {
    Error,
    Warning,
}

impl Severity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub severity: Severity,
    /// `<domain>.<category>`, for example `view.unknown_attribute`.
    pub code: String,
    /// Path relative to the project root, with `/` separators.
    pub file: Option<String>,
    /// Zero when only the file is known.
    pub position: Position,
    pub message: String,
    pub help: Option<String>,
}

impl Diagnostic {
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            code: code.into(),
            file: None,
            position: Position::default(),
            message: message.into(),
            help: None,
        }
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            ..Self::error(code, message)
        }
    }

    pub fn in_file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into());
        self
    }

    pub fn at(mut self, position: Position) -> Self {
        self.position = position;
        self
    }

    pub fn help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }

    /// Human form. `source` is the text of `file`, used to show the line.
    pub fn render(&self, source: Option<&str>) -> String {
        let mut out = format!(
            "{}[{}]: {}\n",
            self.severity.as_str(),
            self.code,
            self.message
        );
        if let Some(file) = &self.file {
            if self.position.line == 0 {
                let _ = writeln!(out, "  --> {file}");
            } else {
                let _ = writeln!(
                    out,
                    "  --> {file}:{}:{}",
                    self.position.line, self.position.column
                );
                if let Some(line) = source.and_then(|text| source_line(text, self.position.line)) {
                    let number = self.position.line.to_string();
                    let pad = " ".repeat(number.len());
                    let caret = " ".repeat(self.position.column.saturating_sub(1) as usize);
                    let _ = writeln!(out, " {pad} |");
                    let _ = writeln!(out, " {number} | {line}");
                    let _ = writeln!(out, " {pad} | {caret}^");
                }
            }
        }
        if let Some(help) = &self.help {
            let _ = writeln!(out, "   = help: {help}");
        }
        out
    }

    /// One JSON object, for `--format json` (one object per line).
    pub fn to_json(&self) -> String {
        let (line, column) = if self.position.line == 0 {
            (None, None)
        } else {
            (Some(self.position.line), Some(self.position.column))
        };
        json!({
            "severity": self.severity.as_str(),
            "code": self.code,
            "file": self.file,
            "line": line,
            "column": column,
            "message": self.message,
            "help": self.help,
        })
        .to_string()
    }
}

/// Line `number` (one-based) of `text`, tabs shown as one space so the caret
/// stays aligned, without its line break. Long lines are shown up to 160
/// characters.
fn source_line(text: &str, number: u32) -> Option<String> {
    let line = text.lines().nth(number.checked_sub(1)? as usize)?;
    Some(
        line.chars()
            .take(160)
            .map(|c| if c == '\t' || c.is_control() { ' ' } else { c })
            .collect(),
    )
}

/// The diagnostics of one command, in the order they were found.
#[derive(Debug, Default)]
pub struct Report {
    pub diagnostics: Vec<Diagnostic>,
}

impl Report {
    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }

    pub fn errors(&self) -> usize {
        self.count(Severity::Error)
    }

    pub fn warnings(&self) -> usize {
        self.count(Severity::Warning)
    }

    fn count(&self, severity: Severity) -> usize {
        self.diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == severity)
            .count()
    }
}

/// Edit distance counting an adjacent transposition as one edit (optimal
/// string alignment), for "did you mean" suggestions on short names.
pub fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut rows = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in rows.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in rows[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (rows[i - 1][j] + 1)
                .min(rows[i][j - 1] + 1)
                .min(rows[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = best;
        }
    }
    rows[a.len()][b.len()]
}

/// The closest candidate to `name`, if it is close enough to be a typo.
pub fn closest<'a>(name: &str, candidates: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let limit = (name.chars().count() / 3).max(1);
    candidates
        .into_iter()
        .map(|candidate| (distance(name, candidate), candidate))
        .filter(|(distance, _)| *distance <= limit)
        .min()
        .map(|(_, candidate)| candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_file_line_caret_and_help() {
        let diagnostic = Diagnostic::error(
            "view.unknown_attribute",
            "`colour` is not an attribute of <text>",
        )
        .in_file("view.ocml")
        .at(Position { line: 2, column: 9 })
        .help("did you mean `class`?");
        let source = "<box>\n  <text colour=\"red\"/>\n</box>\n";
        assert_eq!(
            diagnostic.render(Some(source)),
            "error[view.unknown_attribute]: `colour` is not an attribute of <text>\n  \
             --> view.ocml:2:9\n   |\n 2 |   <text colour=\"red\"/>\n   |         ^\n   \
             = help: did you mean `class`?\n"
        );
    }

    #[test]
    fn json_has_one_object_with_null_positions_when_unknown() {
        let diagnostic =
            Diagnostic::warning("typecheck.skipped", "not checked").in_file("logic.ts");
        assert_eq!(
            diagnostic.to_json(),
            r#"{"code":"typecheck.skipped","column":null,"file":"logic.ts","help":null,"line":null,"message":"not checked","severity":"warning"}"#
        );
    }

    #[test]
    fn suggests_only_close_names() {
        assert_eq!(closest("colr", ["color", "class"]), Some("color"));
        assert_eq!(closest("zzz", ["color", "class"]), None);
        assert_eq!(closest("nmae", ["name", "id"]), Some("name"));
        assert_eq!(closest("gpa", ["gap", "grid"]), Some("gap"));
    }
}
