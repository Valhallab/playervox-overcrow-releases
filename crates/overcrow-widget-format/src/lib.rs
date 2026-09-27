//! Parsers of the widget source formats (ADR 0001, D3 and D4; ADR 0004,
//! section 2).
//!
//! - [`ocml`] parses `view.ocml` into a typed tree and compiles it, ahead of
//!   time, into `view.json` (ADR 0005) and its table of template expressions.
//! - [`ocss`] parses `style.ocss` into a typed, closed style sheet.
//! - [`expr`] is the template expression subset shared by both steps of the
//!   view compiler.
//! - [`validate_package_style`] completes `read_package` with the style
//!   grammar.
//!
//! Every element, attribute, event, property, selector, token and bound
//! comes from `overcrow-widget-schema`; anything absent from its tables is
//! rejected. Errors carry a fixed category and a source position, never
//! source text. No input can make these parsers panic, overflow or recurse
//! without bound; the fuzz targets under `fuzz/` hold them to that.

pub mod expr;
pub mod ocml;
pub mod ocss;

use overcrow_widget_schema::package::Package;

/// The source-format checks of package admission that the schema crate
/// cannot run itself (step 4 of `docs/widget-package-v1.md`): the
/// `style.ocss` grammar. Callers run it after `read_package`, at admission
/// and at every activation.
pub fn validate_package_style(package: &Package) -> Result<(), ocss::OcssError> {
    match package.file("style.ocss") {
        Some(style) => ocss::parse(style).map(|_| ()),
        None => Ok(()),
    }
}

/// One-based line and column (in Unicode scalar values) of a source offset.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

impl Position {
    /// Position of byte `offset` of `source`. Offsets past the end, or inside
    /// a character, resolve to the nearest preceding character boundary.
    pub fn of(source: &str, offset: usize) -> Self {
        let mut offset = offset.min(source.len());
        while !source.is_char_boundary(offset) {
            offset -= 1;
        }
        let before = source.get(..offset).unwrap_or_default();
        let line = before.bytes().filter(|byte| *byte == b'\n').count();
        let line_start = before.rfind('\n').map_or(0, |index| index + 1);
        let column = before.get(line_start..).unwrap_or_default().chars().count();
        Self {
            line: u32::try_from(line.saturating_add(1)).unwrap_or(u32::MAX),
            column: u32::try_from(column.saturating_add(1)).unwrap_or(u32::MAX),
        }
    }
}
