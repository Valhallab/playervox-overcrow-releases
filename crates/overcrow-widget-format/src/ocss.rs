//! `style.ocss`: the closed CSS subset of ADR 0001, D4, parsed into a typed
//! [`StyleSheet`].
//!
//! Selectors, properties, value grammars, tokens and pseudo-classes come
//! from the schema's `style` and `tokens` tables, every bound from `limits`.
//! Anything else rejects the whole sheet: `!important`, at-rules other than
//! `@keyframes`, `url()`, `calc()`, strings, escapes, custom property
//! declarations, ID, attribute and universal selectors, sibling combinators,
//! unknown properties, values, tokens or units, and any non-ASCII character
//! outside comments.
//!
//! The cascade itself (specificity, then source order) is applied by the
//! host (P1.2); this module records specificity and keeps source order.

use overcrow_widget_schema::compiled_view::valid_identifier;
use overcrow_widget_schema::limits::{
    MAX_ANGLE_DEG, MAX_ANIMATION_ITERATIONS, MAX_ANIMATION_MS, MAX_COMPOUNDS_PER_SELECTOR,
    MAX_DECLARATIONS_PER_RULE, MAX_EASING_STEPS, MAX_FONT_SIZE_PX, MAX_GRID_FRACTION,
    MAX_IDENTIFIER_BYTES, MAX_KEYFRAME_STOPS, MAX_KEYFRAMES, MAX_LENGTH_PX, MAX_PERCENT,
    MAX_SELECTORS_PER_RULE, MAX_SHADOW_BLUR_PX, MAX_SIMPLE_SELECTORS_PER_COMPOUND, MAX_STYLE_RULES,
    MAX_STYLE_SOURCE_BYTES, MAX_TRANSFORM_SCALE, MIN_FONT_SIZE_PX,
};
use overcrow_widget_schema::style::{
    ANIMATION_DIRECTIONS, CHECKABLE_ELEMENTS, EASINGS, FILL_MODES, FONT_FAMILIES, ORIGIN_KEYWORDS,
    PSEUDO_CLASSES, Property, StyleValue, TRACK_KEYWORDS, property,
};
use overcrow_widget_schema::tokens::{Token, TokenType, token};
use overcrow_widget_schema::view::element;

use crate::Position;

/// Deepest function nesting of the value grammar: `repeat(minmax(var()))`.
/// A structural property of the grammar, not a tunable bound.
const GRAMMAR_NESTING: usize = 3;

/// CSS functions named in the error rather than reported as unknown values.
const UNSUPPORTED_FUNCTIONS: &[&str] = &[
    "url",
    "calc",
    "min",
    "max",
    "clamp",
    "attr",
    "env",
    "image",
    "image-set",
    "element",
];

/// Fixed reasons a style sheet is rejected. They carry no source text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcssErrorKind {
    /// Larger than `MAX_STYLE_SOURCE_BYTES`.
    Size,
    /// Not UTF-8, a byte-order mark, or a non-ASCII or control character
    /// outside a comment.
    Encoding,
    Syntax,
    /// A CSS feature outside the subset (see the module documentation).
    Unsupported,
    UnknownElement,
    UnknownPseudoClass,
    InvalidSelector,
    UnknownProperty,
    DuplicateProperty,
    InvalidValue,
    /// `var()` of an unknown token, or of a token of another type.
    UnknownToken,
    /// A property that cannot be animated, in `@keyframes` or `transition`.
    NotAnimatable,
    UnknownKeyframes,
    DuplicateKeyframes,
    InvalidKeyframes,
    TooManyRules,
    TooManySelectors,
    TooManyCompounds,
    TooManySimpleSelectors,
    TooManyDeclarations,
    TooManyKeyframes,
    TooManyStops,
}

impl OcssErrorKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Encoding => "encoding",
            Self::Syntax => "syntax",
            Self::Unsupported => "unsupported",
            Self::UnknownElement => "unknown_element",
            Self::UnknownPseudoClass => "unknown_pseudo_class",
            Self::InvalidSelector => "invalid_selector",
            Self::UnknownProperty => "unknown_property",
            Self::DuplicateProperty => "duplicate_property",
            Self::InvalidValue => "invalid_value",
            Self::UnknownToken => "unknown_token",
            Self::NotAnimatable => "not_animatable",
            Self::UnknownKeyframes => "unknown_keyframes",
            Self::DuplicateKeyframes => "duplicate_keyframes",
            Self::InvalidKeyframes => "invalid_keyframes",
            Self::TooManyRules => "too_many_rules",
            Self::TooManySelectors => "too_many_selectors",
            Self::TooManyCompounds => "too_many_compounds",
            Self::TooManySimpleSelectors => "too_many_simple_selectors",
            Self::TooManyDeclarations => "too_many_declarations",
            Self::TooManyKeyframes => "too_many_keyframes",
            Self::TooManyStops => "too_many_stops",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OcssError {
    pub kind: OcssErrorKind,
    pub position: Position,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StyleSheet {
    /// Rules in source order, which breaks specificity ties.
    pub rules: Vec<Rule>,
    pub keyframes: Vec<Keyframes>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub selectors: Vec<Selector>,
    pub declarations: Vec<Declaration>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Selector {
    /// Compounds from left to right; the first has no combinator.
    pub compounds: Vec<(Option<Combinator>, Compound)>,
    /// (classes and states, element types), compared lexicographically.
    pub specificity: (u32, u32),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Combinator {
    Descendant,
    Child,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Compound {
    pub element: Option<&'static str>,
    pub classes: Vec<String>,
    pub states: Vec<&'static str>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Declaration {
    pub property: &'static Property,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Keyframes {
    pub name: String,
    /// Stops sorted by offset.
    pub stops: Vec<KeyframeStop>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KeyframeStop {
    /// 0 to 100.
    pub percent: f64,
    pub declarations: Vec<Declaration>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Length {
    Px(f64),
    Percent(f64),
    /// `auto`, `none`, or a `transform-origin` keyword.
    Keyword(&'static str),
    Token(&'static Token),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Color {
    Rgba([u8; 4]),
    CurrentColor,
    Token(&'static Token),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Time {
    Ms(f64),
    Token(&'static Token),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Easing {
    Keyword(&'static str),
    Steps(u32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FontFamily {
    Keyword(&'static str),
    Token(&'static Token),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineHeight {
    Multiple(f64),
    Length(Length),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Background {
    Color(Color),
    LinearGradient {
        /// CSS angle: 180 (`to bottom`) when omitted.
        angle_deg: f64,
        stops: Vec<(Color, Option<f64>)>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Border {
    pub width: Length,
    pub style: Option<&'static str>,
    pub color: Option<Color>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub inset: bool,
    pub x: Length,
    pub y: Length,
    pub blur: Length,
    pub spread: Length,
    pub color: Color,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TransformFn {
    Translate(Length, Length),
    Scale(f64, f64),
    RotateDeg(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Track {
    Length(Length),
    Fraction(f64),
    Keyword(&'static str),
    MinMax(Box<Track>, Box<Track>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GridLine {
    Auto,
    Line(u32),
    Span(u32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transition {
    pub property: &'static Property,
    pub duration: Time,
    pub easing: Easing,
    pub delay: Time,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Animation {
    pub name: String,
    pub duration: Time,
    pub easing: Easing,
    pub delay: Time,
    /// `None` is `infinite`.
    pub iterations: Option<u32>,
    pub direction: &'static str,
    pub fill_mode: &'static str,
}

/// A typed property value, shaped by the property's [`StyleValue`].
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Keyword(&'static str),
    Length(Length),
    /// Top, right, bottom, left.
    Sides([Length; 4]),
    /// Top-left, top-right, bottom-right, bottom-left.
    Corners([Length; 4]),
    /// Row gap, column gap.
    Gap([Length; 2]),
    Number(f64),
    Integer(i64),
    Color(Color),
    FontFamily(FontFamily),
    FontSize(Length),
    LineHeight(LineHeight),
    Background(Background),
    Border(Border),
    /// Empty for `none`.
    Shadows(Vec<Shadow>),
    /// `var(--shadow-…)`: a shadow token, resolved for the host theme.
    ShadowToken(&'static Token),
    /// Empty for `none`.
    Transform(Vec<TransformFn>),
    TransformOrigin([Length; 2]),
    /// Empty for `none`; `repeat()` is expanded.
    GridTracks(Vec<Track>),
    GridTrack(Track),
    GridPlacement(GridLine, GridLine),
    /// Empty for `none`.
    Transitions(Vec<Transition>),
    /// Empty for `none`.
    Animations(Vec<Animation>),
}

/// Parses `style.ocss`.
pub fn parse(source: &[u8]) -> Result<StyleSheet, OcssError> {
    if source.len() as u64 > MAX_STYLE_SOURCE_BYTES.value {
        return Err(OcssError {
            kind: OcssErrorKind::Size,
            position: Position::default(),
        });
    }
    if source.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(OcssError {
            kind: OcssErrorKind::Encoding,
            position: Position::default(),
        });
    }
    let text = std::str::from_utf8(source).map_err(|_| OcssError {
        kind: OcssErrorKind::Encoding,
        position: Position::default(),
    })?;
    let tokens = tokenize(text)?;
    let mut parser = Parser {
        text,
        tokens,
        position: 0,
        animations: Vec::new(),
    };
    let sheet = parser.sheet()?;
    Ok(sheet)
}

// ---------------------------------------------------------------------------
// Tokens.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Unit {
    None,
    Px,
    Percent,
    Fr,
    Ms,
    S,
    Deg,
    Turn,
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Ident(String),
    AtKeyword(String),
    Hash(String),
    Number {
        value: f64,
        unit: Unit,
        integer: bool,
    },
    Function(String),
    Colon,
    Semicolon,
    Comma,
    LBrace,
    RBrace,
    RParen,
    Dot,
    Greater,
    Slash,
    Space,
}

fn tokenize(text: &str) -> Result<Vec<(Tok, usize)>, OcssError> {
    let bytes = text.as_bytes();
    let error = |kind, offset| OcssError {
        kind,
        position: Position::of(text, offset),
    };
    let mut tokens: Vec<(Tok, usize)> = Vec::new();
    let mut position = 0;
    let ident_start = |at: usize| {
        let first = bytes.get(at).copied();
        match first {
            Some(byte) if byte.is_ascii_alphabetic() || byte == b'_' => true,
            Some(b'-') => bytes
                .get(at + 1)
                .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'-' || *byte == b'_'),
            _ => false,
        }
    };
    let ident_end = |mut at: usize| {
        while bytes
            .get(at)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-' || *byte == b'_')
        {
            at += 1;
        }
        at
    };
    while let Some(&byte) = bytes.get(position) {
        let start = position;
        let token = match byte {
            b' ' | b'\t' | b'\n' | b'\r' => {
                while matches!(bytes.get(position), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                    position += 1;
                }
                if tokens.last().is_none_or(|(last, _)| *last != Tok::Space) {
                    tokens.push((Tok::Space, start));
                }
                continue;
            }
            b'/' if bytes.get(position + 1) == Some(&b'*') => {
                let end = text
                    .get(position + 2..)
                    .and_then(|rest| rest.find("*/"))
                    .ok_or_else(|| error(OcssErrorKind::Syntax, start))?;
                position += end + 4;
                continue;
            }
            b':' => Tok::Colon,
            b';' => Tok::Semicolon,
            b',' => Tok::Comma,
            b'{' => Tok::LBrace,
            b'}' => Tok::RBrace,
            b')' => Tok::RParen,
            b'>' => Tok::Greater,
            b'/' => Tok::Slash,
            b'.' if !bytes.get(position + 1).is_some_and(u8::is_ascii_digit) => Tok::Dot,
            b'#' => {
                let end = ident_end(position + 1);
                if end == position + 1 {
                    return Err(error(OcssErrorKind::Syntax, start));
                }
                let name = text.get(position + 1..end).unwrap_or_default().to_owned();
                position = end;
                tokens.push((Tok::Hash(name), start));
                continue;
            }
            b'@' => {
                if !ident_start(position + 1) {
                    return Err(error(OcssErrorKind::Syntax, start));
                }
                let end = ident_end(position + 1);
                let name = text.get(position + 1..end).unwrap_or_default().to_owned();
                position = end;
                tokens.push((Tok::AtKeyword(name), start));
                continue;
            }
            b'0'..=b'9' | b'.' | b'-' | b'+'
                if !(byte == b'-' && ident_start(position)) && byte != b'+' =>
            {
                let (token, end) = number(text, position)
                    .ok_or_else(|| error(OcssErrorKind::InvalidValue, start))?;
                position = end;
                tokens.push((token, start));
                continue;
            }
            _ if ident_start(position) => {
                let end = ident_end(position);
                let name = text.get(position..end).unwrap_or_default().to_owned();
                position = end;
                if bytes.get(position) == Some(&b'(') {
                    if UNSUPPORTED_FUNCTIONS.contains(&name.as_str()) {
                        return Err(error(OcssErrorKind::Unsupported, start));
                    }
                    position += 1;
                    tokens.push((Tok::Function(name), start));
                } else {
                    tokens.push((Tok::Ident(name), start));
                }
                continue;
            }
            b'!' | b'*' | b'[' | b']' | b'+' | b'~' | b'"' | b'\'' | b'\\' | b'(' | b'|' | b'=' => {
                return Err(error(OcssErrorKind::Unsupported, start));
            }
            _ if !byte.is_ascii() || byte.is_ascii_control() => {
                return Err(error(OcssErrorKind::Encoding, start));
            }
            _ => return Err(error(OcssErrorKind::Syntax, start)),
        };
        position += 1;
        tokens.push((token, start));
    }
    Ok(tokens)
}

/// `-?(digits(.digits)?|.digits)` and an optional unit; no exponent.
fn number(text: &str, start: usize) -> Option<(Tok, usize)> {
    let bytes = text.as_bytes();
    let mut position = start;
    if bytes.get(position) == Some(&b'-') {
        position += 1;
    }
    let digits_start = position;
    while bytes.get(position).is_some_and(u8::is_ascii_digit) {
        position += 1;
    }
    let mut integer = true;
    if bytes.get(position) == Some(&b'.') {
        integer = false;
        position += 1;
        let fraction = position;
        while bytes.get(position).is_some_and(u8::is_ascii_digit) {
            position += 1;
        }
        if position == fraction {
            return None;
        }
    }
    if position == digits_start {
        return None;
    }
    let value: f64 = text.get(start..position)?.parse().ok()?;
    if !value.is_finite() {
        return None;
    }
    let unit_start = position;
    if bytes.get(position) == Some(&b'%') {
        position += 1;
    } else {
        while bytes.get(position).is_some_and(u8::is_ascii_alphabetic) {
            position += 1;
        }
    }
    let unit = match text.get(unit_start..position)? {
        "" => Unit::None,
        "px" => Unit::Px,
        "%" => Unit::Percent,
        "fr" => Unit::Fr,
        "ms" => Unit::Ms,
        "s" => Unit::S,
        "deg" => Unit::Deg,
        "turn" => Unit::Turn,
        _ => return None,
    };
    // A unit glued to more name characters (`1px2`, `1e3`) is malformed.
    if bytes
        .get(position)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return None;
    }
    Some((
        Tok::Number {
            value,
            unit,
            integer,
        },
        position,
    ))
}

// ---------------------------------------------------------------------------
// Sheet structure.

struct Parser<'a> {
    text: &'a str,
    tokens: Vec<(Tok, usize)>,
    position: usize,
    /// Keyframes names used by `animation`, checked once the sheet is read.
    animations: Vec<(String, usize)>,
}

type Parsed<T> = Result<T, OcssError>;

impl Parser<'_> {
    fn offset(&self) -> usize {
        self.tokens
            .get(self.position)
            .map_or(self.text.len(), |(_, offset)| *offset)
    }

    fn error(&self, kind: OcssErrorKind) -> OcssError {
        self.error_at(kind, self.offset())
    }

    fn error_at(&self, kind: OcssErrorKind, offset: usize) -> OcssError {
        OcssError {
            kind,
            position: Position::of(self.text, offset),
        }
    }

    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.position).map(|(token, _)| token)
    }

    fn skip_space(&mut self) {
        while self.peek() == Some(&Tok::Space) {
            self.position += 1;
        }
    }

    fn sheet(&mut self) -> Parsed<StyleSheet> {
        let mut rules = Vec::new();
        let mut keyframes: Vec<Keyframes> = Vec::new();
        loop {
            self.skip_space();
            match self.peek() {
                None => break,
                Some(Tok::AtKeyword(name)) if name == "keyframes" => {
                    let offset = self.offset();
                    self.position += 1;
                    let block = self.keyframes()?;
                    if keyframes.iter().any(|existing| existing.name == block.name) {
                        return Err(self.error_at(OcssErrorKind::DuplicateKeyframes, offset));
                    }
                    if keyframes.len() as u64 >= MAX_KEYFRAMES.value {
                        return Err(self.error_at(OcssErrorKind::TooManyKeyframes, offset));
                    }
                    keyframes.push(block);
                }
                Some(Tok::AtKeyword(_)) => return Err(self.error(OcssErrorKind::Unsupported)),
                Some(_) => {
                    if rules.len() as u64 >= MAX_STYLE_RULES.value {
                        return Err(self.error(OcssErrorKind::TooManyRules));
                    }
                    let rule = self.rule()?;
                    rules.push(rule);
                }
            }
        }
        // Every animation names a block of this sheet.
        for (name, offset) in &self.animations {
            if !keyframes.iter().any(|block| block.name == *name) {
                return Err(self.error_at(OcssErrorKind::UnknownKeyframes, *offset));
            }
        }
        Ok(StyleSheet { rules, keyframes })
    }

    /// Tokens up to the next top-level `{`, exclusive; the cursor lands on it.
    fn prelude(&mut self) -> Parsed<Vec<(Tok, usize)>> {
        let start = self.position;
        loop {
            match self.peek() {
                Some(Tok::LBrace) => break,
                None | Some(Tok::RBrace | Tok::Semicolon) => {
                    return Err(self.error(OcssErrorKind::Syntax));
                }
                Some(_) => self.position += 1,
            }
        }
        Ok(self
            .tokens
            .get(start..self.position)
            .unwrap_or_default()
            .to_vec())
    }

    fn rule(&mut self) -> Parsed<Rule> {
        let prelude = self.prelude()?;
        let selectors = self.selectors(&prelude)?;
        self.position += 1;
        let declarations = self.declarations(false)?;
        Ok(Rule {
            selectors,
            declarations,
        })
    }

    fn keyframes(&mut self) -> Parsed<Keyframes> {
        let offset = self.offset();
        self.skip_space();
        let name = match self.peek() {
            Some(Tok::Ident(name)) if valid_keyframes_name(name) => name.clone(),
            _ => return Err(self.error(OcssErrorKind::InvalidKeyframes)),
        };
        self.position += 1;
        self.skip_space();
        if self.peek() != Some(&Tok::LBrace) {
            return Err(self.error(OcssErrorKind::Syntax));
        }
        self.position += 1;
        let mut stops: Vec<KeyframeStop> = Vec::new();
        loop {
            self.skip_space();
            if self.peek() == Some(&Tok::RBrace) {
                self.position += 1;
                break;
            }
            let prelude = self.prelude()?;
            let offsets = self.stop_offsets(&prelude)?;
            self.position += 1;
            let declarations = self.declarations(true)?;
            for percent in offsets {
                if stops.iter().any(|stop| stop.percent == percent) {
                    return Err(self.error(OcssErrorKind::InvalidKeyframes));
                }
                if stops.len() as u64 >= MAX_KEYFRAME_STOPS.value {
                    return Err(self.error(OcssErrorKind::TooManyStops));
                }
                stops.push(KeyframeStop {
                    percent,
                    declarations: declarations.clone(),
                });
            }
        }
        if stops.is_empty() {
            return Err(self.error_at(OcssErrorKind::InvalidKeyframes, offset));
        }
        stops.sort_by(|left, right| left.percent.total_cmp(&right.percent));
        Ok(Keyframes { name, stops })
    }

    fn stop_offsets(&self, prelude: &[(Tok, usize)]) -> Parsed<Vec<f64>> {
        let mut offsets = Vec::new();
        for group in split(prelude, |token| *token == Tok::Comma) {
            let group = trim(group);
            let percent = match group {
                [(Tok::Ident(word), _)] if word == "from" => 0.0,
                [(Tok::Ident(word), _)] if word == "to" => 100.0,
                [
                    (
                        Tok::Number {
                            value,
                            unit: Unit::Percent,
                            ..
                        },
                        _,
                    ),
                ] if (0.0..=100.0).contains(value) => *value,
                _ => {
                    let offset = group.first().map_or(self.offset(), |(_, offset)| *offset);
                    return Err(self.error_at(OcssErrorKind::InvalidKeyframes, offset));
                }
            };
            offsets.push(percent);
        }
        Ok(offsets)
    }

    /// Declarations up to the closing `}`, which is consumed.
    fn declarations(&mut self, keyframe: bool) -> Parsed<Vec<Declaration>> {
        let mut declarations: Vec<Declaration> = Vec::new();
        loop {
            self.skip_space();
            let offset = self.offset();
            let name = match self.peek() {
                Some(Tok::RBrace) => {
                    self.position += 1;
                    return Ok(declarations);
                }
                Some(Tok::Semicolon) => {
                    self.position += 1;
                    continue;
                }
                Some(Tok::Ident(name)) => name.clone(),
                None => return Err(self.error(OcssErrorKind::Syntax)),
                Some(_) => return Err(self.error(OcssErrorKind::Syntax)),
            };
            self.position += 1;
            self.skip_space();
            if self.peek() != Some(&Tok::Colon) {
                return Err(self.error(OcssErrorKind::Syntax));
            }
            self.position += 1;
            let start = self.position;
            let mut depth = 0usize;
            loop {
                match self.peek() {
                    None | Some(Tok::LBrace) => return Err(self.error(OcssErrorKind::Syntax)),
                    Some(Tok::Semicolon | Tok::RBrace) if depth == 0 => break,
                    Some(Tok::Function(_)) => depth += 1,
                    Some(Tok::RParen) => {
                        depth = depth
                            .checked_sub(1)
                            .ok_or_else(|| self.error(OcssErrorKind::Syntax))?;
                    }
                    Some(_) => {}
                }
                self.position += 1;
            }
            let tokens = self
                .tokens
                .get(start..self.position)
                .unwrap_or_default()
                .to_vec();
            if name.starts_with("--") {
                return Err(self.error_at(OcssErrorKind::Unsupported, offset));
            }
            let property = property(&name)
                .ok_or_else(|| self.error_at(OcssErrorKind::UnknownProperty, offset))?;
            if keyframe && !property.animatable {
                return Err(self.error_at(OcssErrorKind::NotAnimatable, offset));
            }
            if declarations
                .iter()
                .any(|existing| existing.property.name == property.name)
            {
                return Err(self.error_at(OcssErrorKind::DuplicateProperty, offset));
            }
            if declarations.len() as u64 >= MAX_DECLARATIONS_PER_RULE.value {
                return Err(self.error_at(OcssErrorKind::TooManyDeclarations, offset));
            }
            let components = components(&tokens, 0)
                .map_err(|(kind, at)| self.error_at(kind, at.unwrap_or(offset)))?;
            let value = typed_value(property.value, &components)
                .map_err(|kind| self.error_at(kind, offset))?;
            if let Value::Animations(animations) = &value {
                self.animations.extend(
                    animations
                        .iter()
                        .map(|animation| (animation.name.clone(), offset)),
                );
            }
            declarations.push(Declaration { property, value });
        }
    }

    fn selectors(&self, prelude: &[(Tok, usize)]) -> Parsed<Vec<Selector>> {
        let mut selectors = Vec::new();
        for group in split(prelude, |token| *token == Tok::Comma) {
            if selectors.len() as u64 >= MAX_SELECTORS_PER_RULE.value {
                let offset = group.first().map_or(self.offset(), |(_, offset)| *offset);
                return Err(self.error_at(OcssErrorKind::TooManySelectors, offset));
            }
            selectors.push(self.selector(trim(group))?);
        }
        Ok(selectors)
    }

    fn selector(&self, tokens: &[(Tok, usize)]) -> Parsed<Selector> {
        let invalid = |offset: Option<&(Tok, usize)>| {
            self.error_at(
                OcssErrorKind::InvalidSelector,
                offset.map_or(self.offset(), |(_, offset)| *offset),
            )
        };
        if tokens.is_empty() {
            return Err(invalid(None));
        }
        let mut compounds: Vec<(Option<Combinator>, Compound)> = Vec::new();
        let mut combinator = None;
        let mut index = 0;
        let mut specificity = (0u32, 0u32);
        while index < tokens.len() {
            // Combinator between two compounds.
            if !compounds.is_empty() {
                let mut spaced = false;
                while matches!(tokens.get(index), Some((Tok::Space, _))) {
                    spaced = true;
                    index += 1;
                }
                if matches!(tokens.get(index), Some((Tok::Greater, _))) {
                    combinator = Some(Combinator::Child);
                    index += 1;
                    while matches!(tokens.get(index), Some((Tok::Space, _))) {
                        index += 1;
                    }
                } else if spaced {
                    combinator = Some(Combinator::Descendant);
                } else {
                    return Err(invalid(tokens.get(index)));
                }
            } else if matches!(tokens.get(index), Some((Tok::Greater, _))) {
                return Err(invalid(tokens.get(index)));
            }
            let start = index;
            let mut compound = Compound::default();
            let mut simple = 0u64;
            if let Some((Tok::Ident(name), offset)) = tokens.get(index) {
                let element = element(name)
                    .ok_or_else(|| self.error_at(OcssErrorKind::UnknownElement, *offset))?;
                compound.element = Some(element.name);
                simple += 1;
                specificity.1 = specificity.1.saturating_add(1);
                index += 1;
            }
            loop {
                match (tokens.get(index), tokens.get(index + 1)) {
                    (Some((Tok::Dot, _)), Some((Tok::Ident(class), offset))) => {
                        if !(class.len() as u64 <= MAX_IDENTIFIER_BYTES.value
                            && valid_identifier(class))
                        {
                            return Err(self.error_at(OcssErrorKind::InvalidSelector, *offset));
                        }
                        compound.classes.push(class.clone());
                    }
                    (Some((Tok::Colon, _)), Some((Tok::Ident(state), offset))) => {
                        let state = PSEUDO_CLASSES
                            .iter()
                            .find(|known| **known == state)
                            .copied()
                            .ok_or_else(|| {
                                self.error_at(OcssErrorKind::UnknownPseudoClass, *offset)
                            })?;
                        if state == "checked"
                            && compound
                                .element
                                .is_some_and(|name| !CHECKABLE_ELEMENTS.contains(&name))
                        {
                            return Err(self.error_at(OcssErrorKind::InvalidSelector, *offset));
                        }
                        compound.states.push(state);
                    }
                    (Some((Tok::Hash(_), offset)), _) => {
                        return Err(self.error_at(OcssErrorKind::Unsupported, *offset));
                    }
                    (Some((Tok::Colon, offset)), Some((Tok::Colon | Tok::Function(_), _))) => {
                        return Err(self.error_at(OcssErrorKind::Unsupported, *offset));
                    }
                    _ => break,
                }
                simple += 1;
                specificity.0 = specificity.0.saturating_add(1);
                index += 2;
            }
            if index == start {
                return Err(invalid(tokens.get(index)));
            }
            if simple > MAX_SIMPLE_SELECTORS_PER_COMPOUND.value {
                return Err(self.error_at(
                    OcssErrorKind::TooManySimpleSelectors,
                    tokens.get(start).map_or(0, |(_, offset)| *offset),
                ));
            }
            compounds.push((combinator.take(), compound));
            if compounds.len() as u64 > MAX_COMPOUNDS_PER_SELECTOR.value {
                return Err(self.error_at(
                    OcssErrorKind::TooManyCompounds,
                    tokens.get(start).map_or(0, |(_, offset)| *offset),
                ));
            }
        }
        Ok(Selector {
            compounds,
            specificity,
        })
    }
}

fn valid_keyframes_name(name: &str) -> bool {
    name.len() as u64 <= MAX_IDENTIFIER_BYTES.value
        && valid_identifier(name)
        && !EASINGS.contains(&name)
        && !ANIMATION_DIRECTIONS.contains(&name)
        && !FILL_MODES.contains(&name)
        && !matches!(name, "none" | "infinite" | "from" | "to")
}

fn split(tokens: &[(Tok, usize)], separator: impl Fn(&Tok) -> bool) -> Vec<&[(Tok, usize)]> {
    tokens.split(|(token, _)| separator(token)).collect()
}

fn trim(tokens: &[(Tok, usize)]) -> &[(Tok, usize)] {
    let start = tokens
        .iter()
        .position(|(token, _)| *token != Tok::Space)
        .unwrap_or(tokens.len());
    let end = tokens
        .iter()
        .rposition(|(token, _)| *token != Tok::Space)
        .map_or(start, |index| index + 1);
    tokens.get(start..end).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Component values: tokens grouped by commas, spaces and functions.

#[derive(Clone, Debug, PartialEq)]
enum Cv {
    Ident(String),
    Number {
        value: f64,
        unit: Unit,
        integer: bool,
    },
    Hash(String),
    Slash,
    /// Arguments split on commas, each a space-separated list.
    Function(String, Vec<Vec<Cv>>),
}

type Groups = Vec<Vec<Cv>>;
type CvResult<T> = Result<T, (OcssErrorKind, Option<usize>)>;

/// Comma groups of space-separated component values.
fn components(tokens: &[(Tok, usize)], nesting: usize) -> CvResult<Groups> {
    let mut groups: Groups = vec![Vec::new()];
    let mut index = 0;
    while let Some((token, offset)) = tokens.get(index) {
        index += 1;
        let current = groups
            .last_mut()
            .ok_or((OcssErrorKind::Syntax, Some(*offset)))?;
        match token {
            Tok::Space => {}
            Tok::Comma => groups.push(Vec::new()),
            Tok::Ident(name) => current.push(Cv::Ident(name.clone())),
            Tok::Hash(name) => current.push(Cv::Hash(name.clone())),
            Tok::Slash => current.push(Cv::Slash),
            Tok::Number {
                value,
                unit,
                integer,
            } => current.push(Cv::Number {
                value: *value,
                unit: *unit,
                integer: *integer,
            }),
            Tok::Function(name) => {
                if nesting >= GRAMMAR_NESTING {
                    return Err((OcssErrorKind::InvalidValue, Some(*offset)));
                }
                // Find the matching parenthesis.
                let start = index;
                let mut depth = 1usize;
                while depth > 0 {
                    match tokens.get(index) {
                        None => return Err((OcssErrorKind::Syntax, Some(*offset))),
                        Some((Tok::Function(_), _)) => depth += 1,
                        Some((Tok::RParen, _)) => depth -= 1,
                        Some(_) => {}
                    }
                    index += 1;
                }
                let inner = tokens.get(start..index - 1).unwrap_or_default();
                let arguments = components(inner, nesting + 1)?;
                current.push(Cv::Function(name.clone(), arguments));
            }
            _ => return Err((OcssErrorKind::Syntax, Some(*offset))),
        }
    }
    if groups.iter().any(Vec::is_empty) && !(groups.len() == 1) {
        return Err((OcssErrorKind::InvalidValue, None));
    }
    Ok(groups)
}

// ---------------------------------------------------------------------------
// Typed values.

type Typed<T> = Result<T, OcssErrorKind>;
const INVALID: OcssErrorKind = OcssErrorKind::InvalidValue;

/// The only group of a value that allows no comma.
fn single(groups: &Groups) -> Typed<&[Cv]> {
    match groups.as_slice() {
        [group] if !group.is_empty() => Ok(group),
        _ => Err(INVALID),
    }
}

fn keyword(value: &Cv, words: &'static [&'static str]) -> Option<&'static str> {
    match value {
        Cv::Ident(word) => words.iter().find(|known| **known == word).copied(),
        // `font-weight: 400`: numeric keywords of the table.
        Cv::Number {
            value,
            unit: Unit::None,
            integer: true,
        } => {
            let text = format!("{value}");
            words.iter().find(|known| **known == text).copied()
        }
        _ => None,
    }
}

fn is_none(groups: &Groups) -> bool {
    matches!(groups.as_slice(), [group] if matches!(group.as_slice(), [Cv::Ident(word)] if word == "none"))
}

/// `var(--name)` of a token of type `ty`.
fn token_of(value: &Cv, ty: TokenType) -> Option<Typed<&'static Token>> {
    let Cv::Function(name, arguments) = value else {
        return None;
    };
    if name != "var" {
        return None;
    }
    let found = match arguments.as_slice() {
        [argument] => match argument.as_slice() {
            [Cv::Ident(name)] if name.starts_with("--") => token(name)
                .filter(|token| token.ty == ty)
                .ok_or(OcssErrorKind::UnknownToken),
            _ => Err(INVALID),
        },
        _ => Err(INVALID),
    };
    Some(found)
}

fn bounded(value: f64, maximum: u64, negative: bool) -> Typed<f64> {
    let limit = maximum as f64;
    if value.abs() > limit || (!negative && value < 0.0) {
        return Err(INVALID);
    }
    Ok(value)
}

/// `<px>`, `0`, `<percent>` when allowed, a keyword or a length token.
fn length(
    value: &Cv,
    percent: bool,
    keywords: &'static [&'static str],
    negative: bool,
) -> Typed<Length> {
    if let Some(token) = token_of(value, TokenType::Length) {
        return token.map(Length::Token);
    }
    if let Some(word) = keyword(value, keywords) {
        return Ok(Length::Keyword(word));
    }
    match value {
        Cv::Number { value, unit, .. } => match unit {
            Unit::Px => bounded(*value, MAX_LENGTH_PX.value, negative).map(Length::Px),
            Unit::None if *value == 0.0 => Ok(Length::Px(0.0)),
            Unit::Percent if percent => {
                bounded(*value, MAX_PERCENT.value, negative).map(Length::Percent)
            }
            _ => Err(INVALID),
        },
        _ => Err(INVALID),
    }
}

fn number_in(value: &Cv, min: f64, max: f64) -> Typed<f64> {
    match value {
        Cv::Number {
            value,
            unit: Unit::None,
            ..
        } if (min..=max).contains(value) => Ok(*value),
        _ => Err(INVALID),
    }
}

fn integer_in(value: &Cv, min: i64, max: i64) -> Typed<i64> {
    match value {
        Cv::Number {
            value,
            unit: Unit::None,
            integer: true,
        } if (min as f64..=max as f64).contains(value) => Ok(*value as i64),
        _ => Err(INVALID),
    }
}

fn color(value: &Cv) -> Typed<Color> {
    if let Some(token) = token_of(value, TokenType::Color) {
        return token.map(Color::Token);
    }
    match value {
        Cv::Ident(word) if word == "transparent" => Ok(Color::Rgba([0; 4])),
        Cv::Ident(word) if word == "currentColor" => Ok(Color::CurrentColor),
        Cv::Hash(hex) => {
            let digits: Vec<u8> = hex
                .chars()
                .map(|digit| {
                    digit
                        .to_digit(16)
                        .and_then(|digit| u8::try_from(digit).ok())
                })
                .collect::<Option<_>>()
                .ok_or(INVALID)?;
            let channel = |high: u8, low: u8| high * 16 + low;
            let channels = match digits.as_slice() {
                [r, g, b] => [channel(*r, *r), channel(*g, *g), channel(*b, *b), 255],
                [r, g, b, a] => [
                    channel(*r, *r),
                    channel(*g, *g),
                    channel(*b, *b),
                    channel(*a, *a),
                ],
                [r1, r2, g1, g2, b1, b2] => {
                    [channel(*r1, *r2), channel(*g1, *g2), channel(*b1, *b2), 255]
                }
                [r1, r2, g1, g2, b1, b2, a1, a2] => [
                    channel(*r1, *r2),
                    channel(*g1, *g2),
                    channel(*b1, *b2),
                    channel(*a1, *a2),
                ],
                _ => return Err(INVALID),
            };
            Ok(Color::Rgba(channels))
        }
        Cv::Function(name, arguments) if name == "rgb" => {
            let [argument] = arguments.as_slice() else {
                return Err(INVALID);
            };
            let level = |value: &Cv| integer_in(value, 0, 255).map(|level| level as u8);
            let (r, g, b, alpha) = match argument.as_slice() {
                [r, g, b] => (r, g, b, None),
                [r, g, b, Cv::Slash, alpha] => (r, g, b, Some(alpha)),
                _ => return Err(INVALID),
            };
            let alpha = match alpha {
                None => 255,
                Some(Cv::Number {
                    value,
                    unit: Unit::Percent,
                    ..
                }) if (0.0..=100.0).contains(value) => (value / 100.0 * 255.0).round() as u8,
                Some(value) => (number_in(value, 0.0, 1.0)? * 255.0).round() as u8,
            };
            Ok(Color::Rgba([level(r)?, level(g)?, level(b)?, alpha]))
        }
        _ => Err(INVALID),
    }
}

fn time(value: &Cv) -> Typed<Time> {
    if let Some(token) = token_of(value, TokenType::Time) {
        return token.map(Time::Token);
    }
    let milliseconds = match value {
        Cv::Number {
            value,
            unit: Unit::Ms,
            ..
        } => *value,
        Cv::Number {
            value,
            unit: Unit::S,
            ..
        } => value * 1000.0,
        _ => return Err(INVALID),
    };
    if !(0.0..=MAX_ANIMATION_MS.value as f64).contains(&milliseconds) {
        return Err(INVALID);
    }
    Ok(Time::Ms(milliseconds))
}

fn is_time(value: &Cv) -> bool {
    matches!(
        value,
        Cv::Number {
            unit: Unit::Ms | Unit::S,
            ..
        }
    ) || matches!(value, Cv::Function(name, _) if name == "var")
}

fn easing(value: &Cv) -> Option<Typed<Easing>> {
    if let Some(word) = keyword(value, EASINGS) {
        return Some(Ok(Easing::Keyword(word)));
    }
    let Cv::Function(name, arguments) = value else {
        return None;
    };
    if name != "steps" {
        return None;
    }
    Some(match arguments.as_slice() {
        [argument] => match argument.as_slice() {
            [count] => integer_in(count, 1, MAX_EASING_STEPS.value as i64)
                .map(|count| Easing::Steps(count as u32)),
            _ => Err(INVALID),
        },
        _ => Err(INVALID),
    })
}

fn angle(value: &Cv) -> Typed<f64> {
    let degrees = match value {
        Cv::Number {
            value,
            unit: Unit::Deg,
            ..
        } => *value,
        Cv::Number {
            value,
            unit: Unit::Turn,
            ..
        } => value * 360.0,
        Cv::Number {
            value,
            unit: Unit::None,
            ..
        } if *value == 0.0 => 0.0,
        _ => return Err(INVALID),
    };
    bounded(degrees, MAX_ANGLE_DEG.value, true)
}

/// CSS side and corner expansion of one to four values.
fn four<T: Copy>(values: &[T]) -> Typed<[T; 4]> {
    match values {
        [a] => Ok([*a, *a, *a, *a]),
        [a, b] => Ok([*a, *b, *a, *b]),
        [a, b, c] => Ok([*a, *b, *c, *b]),
        [a, b, c, d] => Ok([*a, *b, *c, *d]),
        _ => Err(INVALID),
    }
}

fn track(value: &Cv, nested: bool) -> Typed<Track> {
    if let Some(word) = keyword(value, TRACK_KEYWORDS) {
        return Ok(Track::Keyword(word));
    }
    match value {
        Cv::Number {
            value,
            unit: Unit::Fr,
            ..
        } => bounded(*value, MAX_GRID_FRACTION.value, false).map(Track::Fraction),
        Cv::Function(name, arguments) if name == "minmax" && !nested => {
            match arguments.as_slice() {
                [min, max] => match (min.as_slice(), max.as_slice()) {
                    ([min], [max]) => Ok(Track::MinMax(
                        Box::new(track(min, true)?),
                        Box::new(track(max, true)?),
                    )),
                    _ => Err(INVALID),
                },
                _ => Err(INVALID),
            }
        }
        _ => length(value, true, &[], false).map(Track::Length),
    }
}

fn grid_line(values: &[Cv]) -> Typed<GridLine> {
    let line = |value: &Cv| {
        integer_in(
            value,
            1,
            overcrow_widget_schema::limits::MAX_GRID_TRACKS.value as i64,
        )
        .map(|line| line as u32)
    };
    match values {
        [Cv::Ident(word)] if word == "auto" => Ok(GridLine::Auto),
        [Cv::Ident(word), count] if word == "span" => line(count).map(GridLine::Span),
        [value] => line(value).map(GridLine::Line),
        _ => Err(INVALID),
    }
}

fn typed_value(grammar: StyleValue, groups: &Groups) -> Typed<Value> {
    match grammar {
        StyleValue::Keywords(words) => match single(groups)? {
            [value] => keyword(value, words).map(Value::Keyword).ok_or(INVALID),
            _ => Err(INVALID),
        },
        StyleValue::Length {
            percent,
            keyword,
            negative,
        } => match single(groups)? {
            [value] => {
                let keywords: &'static [&'static str] = match keyword {
                    Some("auto") => &["auto"],
                    Some("none") => &["none"],
                    _ => &[],
                };
                length(value, percent, keywords, negative).map(Value::Length)
            }
            _ => Err(INVALID),
        },
        StyleValue::Sides {
            percent,
            auto,
            negative,
        } => {
            let keywords: &'static [&'static str] = if auto { &["auto"] } else { &[] };
            let values = single(groups)?
                .iter()
                .map(|value| length(value, percent, keywords, negative))
                .collect::<Typed<Vec<_>>>()?;
            four(&values).map(Value::Sides)
        }
        StyleValue::Corners => {
            let values = single(groups)?
                .iter()
                .map(|value| length(value, true, &[], false))
                .collect::<Typed<Vec<_>>>()?;
            four(&values).map(Value::Corners)
        }
        StyleValue::Gap => {
            let values = single(groups)?
                .iter()
                .map(|value| length(value, true, &[], false))
                .collect::<Typed<Vec<_>>>()?;
            match values.as_slice() {
                [both] => Ok(Value::Gap([*both, *both])),
                [row, column] => Ok(Value::Gap([*row, *column])),
                _ => Err(INVALID),
            }
        }
        StyleValue::Number { min, max } => match single(groups)? {
            [value] => number_in(value, min, max).map(Value::Number),
            _ => Err(INVALID),
        },
        StyleValue::Integer { min, max } => match single(groups)? {
            [value] => integer_in(value, min, max).map(Value::Integer),
            _ => Err(INVALID),
        },
        StyleValue::Color => match single(groups)? {
            [value] => color(value).map(Value::Color),
            _ => Err(INVALID),
        },
        StyleValue::FontFamily => match single(groups)? {
            [value] => {
                if let Some(token) = token_of(value, TokenType::FontFamily) {
                    return token.map(|token| Value::FontFamily(FontFamily::Token(token)));
                }
                keyword(value, FONT_FAMILIES)
                    .map(|word| Value::FontFamily(FontFamily::Keyword(word)))
                    .ok_or(INVALID)
            }
            _ => Err(INVALID),
        },
        StyleValue::FontSize => match single(groups)? {
            [value] => {
                if let Some(token) = token_of(value, TokenType::FontSize) {
                    return token.map(|token| Value::FontSize(Length::Token(token)));
                }
                match value {
                    Cv::Number {
                        value,
                        unit: Unit::Px,
                        ..
                    } if (MIN_FONT_SIZE_PX.value as f64..=MAX_FONT_SIZE_PX.value as f64)
                        .contains(value) =>
                    {
                        Ok(Value::FontSize(Length::Px(*value)))
                    }
                    _ => Err(INVALID),
                }
            }
            _ => Err(INVALID),
        },
        StyleValue::LineHeight { min, max } => match single(groups)? {
            [
                value @ Cv::Number {
                    unit: Unit::None, ..
                },
            ] => number_in(value, min, max)
                .map(|value| Value::LineHeight(LineHeight::Multiple(value))),
            [value] => length(value, false, &[], false)
                .map(|length| Value::LineHeight(LineHeight::Length(length))),
            _ => Err(INVALID),
        },
        StyleValue::Background(stops_limit) => match single(groups)? {
            [Cv::Function(name, arguments)] if name == "linear-gradient" => {
                let mut arguments = arguments.as_slice();
                let mut angle_deg = 180.0;
                if let Some(first) = arguments.first()
                    && let [value] = first.as_slice()
                    && angle(value).is_ok()
                {
                    angle_deg = angle(value)?;
                    arguments = arguments.get(1..).unwrap_or_default();
                }
                if arguments.len() < 2 || arguments.len() as u64 > stops_limit.value {
                    return Err(INVALID);
                }
                let stops = arguments
                    .iter()
                    .map(|stop| match stop.as_slice() {
                        [value] => Ok((color(value)?, None)),
                        [
                            value,
                            Cv::Number {
                                value: at,
                                unit: Unit::Percent,
                                ..
                            },
                        ] if (0.0..=100.0).contains(at) => Ok((color(value)?, Some(*at))),
                        _ => Err(INVALID),
                    })
                    .collect::<Typed<Vec<_>>>()?;
                Ok(Value::Background(Background::LinearGradient {
                    angle_deg,
                    stops,
                }))
            }
            [value] => color(value).map(|color| Value::Background(Background::Color(color))),
            _ => Err(INVALID),
        },
        StyleValue::Border => {
            let values = single(groups)?;
            let (width, rest) = values.split_first().ok_or(INVALID)?;
            let width = length(width, false, &[], false)?;
            let mut rest = rest;
            let mut style = None;
            if let Some(first) = rest.first()
                && let Some(word) = keyword(first, &["solid", "none"])
            {
                style = Some(word);
                rest = rest.get(1..).unwrap_or_default();
            }
            let color = match rest {
                [] => None,
                [value] => Some(color(value)?),
                _ => return Err(INVALID),
            };
            Ok(Value::Border(Border {
                width,
                style,
                color,
            }))
        }
        StyleValue::Shadow(limit) => {
            if is_none(groups) {
                return Ok(Value::Shadows(Vec::new()));
            }
            if let [group] = groups.as_slice()
                && let [value] = group.as_slice()
                && let Some(token) = token_of(value, TokenType::Shadow)
            {
                return token.map(Value::ShadowToken);
            }
            if groups.len() as u64 > limit.value {
                return Err(INVALID);
            }
            let shadows = groups
                .iter()
                .map(|group| {
                    let (inset, rest) = match group.split_first() {
                        Some((Cv::Ident(word), rest)) if word == "inset" => (true, rest),
                        _ => (false, group.as_slice()),
                    };
                    let (color_value, lengths) = rest.split_last().ok_or(INVALID)?;
                    let offset = |value: &Cv| length(value, false, &[], true);
                    let radius = |value: &Cv, negative: bool| {
                        let length = length(value, false, &[], negative)?;
                        if let Length::Px(px) = length {
                            bounded(px, MAX_SHADOW_BLUR_PX.value, negative)?;
                        }
                        Ok(length)
                    };
                    let zero = Length::Px(0.0);
                    let (x, y, blur, spread) = match lengths {
                        [x, y] => (offset(x)?, offset(y)?, zero, zero),
                        [x, y, blur] => (offset(x)?, offset(y)?, radius(blur, false)?, zero),
                        [x, y, blur, spread] => (
                            offset(x)?,
                            offset(y)?,
                            radius(blur, false)?,
                            radius(spread, true)?,
                        ),
                        _ => return Err(INVALID),
                    };
                    Ok(Shadow {
                        inset,
                        x,
                        y,
                        blur,
                        spread,
                        color: color(color_value)?,
                    })
                })
                .collect::<Typed<Vec<_>>>()?;
            Ok(Value::Shadows(shadows))
        }
        StyleValue::Transform(limit) => {
            if is_none(groups) {
                return Ok(Value::Transform(Vec::new()));
            }
            let functions = single(groups)?;
            if functions.len() as u64 > limit.value {
                return Err(INVALID);
            }
            let offset = |value: &Cv| length(value, true, &[], true);
            let scale = |value: &Cv| number_in(value, 0.0, MAX_TRANSFORM_SCALE.value as f64);
            let transforms = functions
                .iter()
                .map(|function| {
                    let Cv::Function(name, arguments) = function else {
                        return Err(INVALID);
                    };
                    let arguments: Vec<&Cv> = arguments
                        .iter()
                        .map(|argument| match argument.as_slice() {
                            [value] => Ok(value),
                            _ => Err(INVALID),
                        })
                        .collect::<Typed<_>>()?;
                    match (name.as_str(), arguments.as_slice()) {
                        ("translate", [x, y]) => Ok(TransformFn::Translate(offset(x)?, offset(y)?)),
                        ("translateX", [x]) => {
                            Ok(TransformFn::Translate(offset(x)?, Length::Px(0.0)))
                        }
                        ("translateY", [y]) => {
                            Ok(TransformFn::Translate(Length::Px(0.0), offset(y)?))
                        }
                        ("scale", [both]) => {
                            let both = scale(both)?;
                            Ok(TransformFn::Scale(both, both))
                        }
                        ("scale", [x, y]) => Ok(TransformFn::Scale(scale(x)?, scale(y)?)),
                        ("rotate", [value]) => angle(value).map(TransformFn::RotateDeg),
                        _ => Err(INVALID),
                    }
                })
                .collect::<Typed<Vec<_>>>()?;
            Ok(Value::Transform(transforms))
        }
        StyleValue::TransformOrigin => {
            let values = single(groups)?
                .iter()
                .map(|value| length(value, true, ORIGIN_KEYWORDS, true))
                .collect::<Typed<Vec<_>>>()?;
            match values.as_slice() {
                [x] => Ok(Value::TransformOrigin([*x, Length::Keyword("center")])),
                [x, y] => Ok(Value::TransformOrigin([*x, *y])),
                _ => Err(INVALID),
            }
        }
        StyleValue::GridTracks(limit) => {
            if is_none(groups) {
                return Ok(Value::GridTracks(Vec::new()));
            }
            let values = single(groups)?;
            let tracks = match values {
                [Cv::Function(name, arguments)] if name == "repeat" => match arguments.as_slice() {
                    [count, repeated] => match (count.as_slice(), repeated.as_slice()) {
                        ([count], [repeated]) => {
                            let count = integer_in(count, 1, limit.value as i64)?;
                            let repeated = track(repeated, false)?;
                            vec![repeated; count as usize]
                        }
                        _ => return Err(INVALID),
                    },
                    _ => return Err(INVALID),
                },
                _ => values
                    .iter()
                    .map(|value| track(value, false))
                    .collect::<Typed<Vec<_>>>()?,
            };
            if tracks.len() as u64 > limit.value {
                return Err(INVALID);
            }
            Ok(Value::GridTracks(tracks))
        }
        StyleValue::GridTrack => match single(groups)? {
            [value] => track(value, false).map(Value::GridTrack),
            _ => Err(INVALID),
        },
        StyleValue::GridPlacement => {
            let values = single(groups)?;
            let mut parts = values.split(|value| *value == Cv::Slash);
            let start = grid_line(parts.next().ok_or(INVALID)?)?;
            let end = match parts.next() {
                None => GridLine::Auto,
                Some(end) => grid_line(end)?,
            };
            if parts.next().is_some() {
                return Err(INVALID);
            }
            Ok(Value::GridPlacement(start, end))
        }
        StyleValue::Transition(limit) => {
            if is_none(groups) {
                return Ok(Value::Transitions(Vec::new()));
            }
            if groups.len() as u64 > limit.value {
                return Err(INVALID);
            }
            let transitions = groups
                .iter()
                .map(|group| {
                    let (name, rest) = group.split_first().ok_or(INVALID)?;
                    let Cv::Ident(name) = name else {
                        return Err(INVALID);
                    };
                    let property = property(name).ok_or(OcssErrorKind::UnknownProperty)?;
                    if !property.animatable {
                        return Err(OcssErrorKind::NotAnimatable);
                    }
                    let (duration, rest) = rest.split_first().ok_or(INVALID)?;
                    let duration = time(duration)?;
                    let mut rest = rest;
                    let mut easing_value = Easing::Keyword("ease");
                    if let Some(first) = rest.first()
                        && let Some(parsed) = easing(first)
                    {
                        easing_value = parsed?;
                        rest = rest.get(1..).unwrap_or_default();
                    }
                    let delay = match rest {
                        [] => Time::Ms(0.0),
                        [delay] => time(delay)?,
                        _ => return Err(INVALID),
                    };
                    Ok(Transition {
                        property,
                        duration,
                        easing: easing_value,
                        delay,
                    })
                })
                .collect::<Typed<Vec<_>>>()?;
            Ok(Value::Transitions(transitions))
        }
        StyleValue::Animation(limit) => {
            if is_none(groups) {
                return Ok(Value::Animations(Vec::new()));
            }
            if groups.len() as u64 > limit.value {
                return Err(INVALID);
            }
            let animations = groups
                .iter()
                .map(|group| {
                    let (name, rest) = group.split_first().ok_or(INVALID)?;
                    let Cv::Ident(name) = name else {
                        return Err(INVALID);
                    };
                    if !valid_keyframes_name(name) {
                        return Err(INVALID);
                    }
                    let (duration, mut rest) = rest.split_first().ok_or(INVALID)?;
                    let duration = time(duration)?;
                    let mut animation = Animation {
                        name: name.clone(),
                        duration,
                        easing: Easing::Keyword("ease"),
                        delay: Time::Ms(0.0),
                        iterations: Some(1),
                        direction: "normal",
                        fill_mode: "none",
                    };
                    // Optional parts in their fixed order.
                    if let Some(first) = rest.first()
                        && let Some(parsed) = easing(first)
                    {
                        animation.easing = parsed?;
                        rest = rest.get(1..).unwrap_or_default();
                    }
                    if let Some(first) = rest.first()
                        && is_time(first)
                    {
                        animation.delay = time(first)?;
                        rest = rest.get(1..).unwrap_or_default();
                    }
                    match rest.first() {
                        Some(Cv::Ident(word)) if word == "infinite" => {
                            animation.iterations = None;
                            rest = rest.get(1..).unwrap_or_default();
                        }
                        Some(count @ Cv::Number { .. }) => {
                            animation.iterations =
                                Some(integer_in(count, 1, MAX_ANIMATION_ITERATIONS.value as i64)?
                                    as u32);
                            rest = rest.get(1..).unwrap_or_default();
                        }
                        _ => {}
                    }
                    if let Some(word) = rest
                        .first()
                        .and_then(|first| keyword(first, ANIMATION_DIRECTIONS))
                    {
                        animation.direction = word;
                        rest = rest.get(1..).unwrap_or_default();
                    }
                    if let Some(word) = rest.first().and_then(|first| keyword(first, FILL_MODES)) {
                        animation.fill_mode = word;
                        rest = rest.get(1..).unwrap_or_default();
                    }
                    if !rest.is_empty() {
                        return Err(INVALID);
                    }
                    Ok(animation)
                })
                .collect::<Typed<Vec<_>>>()?;
            Ok(Value::Animations(animations))
        }
    }
}
