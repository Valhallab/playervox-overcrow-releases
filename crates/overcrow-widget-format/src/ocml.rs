//! `view.ocml`: the XML-like view source (ADR 0001, D3), its typed tree and
//! its ahead-of-time compilation into `view.json` (ADR 0005).
//!
//! [`parse`] checks the markup against the schema's elements, attributes,
//! events and template constructs and returns a [`Document`]. [`compile`]
//! numbers every template expression and event handler, writes the canonical
//! `view.json` bytes and revalidates them with the host's own
//! `validate_compiled_view`, so the compiler can never emit a view the host
//! would refuse.
//!
//! Markup rules, all fail-closed:
//!
//! - UTF-8 without byte-order mark; no NUL or control character other than
//!   tab, line feed and carriage return;
//! - elements `<name attr="text" attr={expr} on:event={handler}>`, `/>` for
//!   empty elements, `<!-- comments -->` without `--` inside; no DOCTYPE,
//!   processing instruction, CDATA or namespace;
//! - entities `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&lbrace;` `&rbrace;`
//!   `&nbsp;` and numeric references to non-control characters; a literal
//!   `{` or `}` in a quoted value, or a lone `}` in text, is rejected;
//! - text follows the JSX whitespace rule: tabs become spaces, lines are
//!   trimmed, a line break between two words becomes one space, and a line
//!   break next to a tag or an expression disappears with its indentation.
//!   A whitespace-only run next to a tag is dropped; one between two
//!   expressions on the same line is kept. Use `&#32;` to force a space.
//!
//! The document is a list of top-level nodes: `<component>` declarations and
//! the children of the scene root, a `box`.

use std::collections::BTreeSet;

use overcrow_widget_schema::compiled_view::{
    VIEW_FORMAT, ViewError, accepts, static_value, valid_identifier, valid_scope_name,
    validate_compiled_view,
};
use overcrow_widget_schema::limits::{
    MAX_CHILDREN, MAX_COMPONENT_PROPS, MAX_COMPONENTS, MAX_NODE_TEXT_BYTES, MAX_TREE_DEPTH,
    MAX_VIEW_ELEMENTS, MAX_VIEW_EXPRESSIONS, MAX_VIEW_SOURCE_BYTES,
};
use overcrow_widget_schema::model::{Field, ValueType};
use overcrow_widget_schema::view::{COMMON_ATTRIBUTES, Content, Element, element};
use serde_json::{Map, Value};

use crate::Position;
use crate::expr::{self, EVENT_ROOT, Expr, ExprErrorKind, STATE_ROOT};

/// Template construct tags; none of them is a schema element.
const CONSTRUCTS: &[&str] = &["component", "if", "else-if", "else", "for", "slot"];

/// Fixed reasons a view source is rejected. They carry no source text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcmlErrorKind {
    /// Larger than `MAX_VIEW_SOURCE_BYTES`, or a compiled view larger than
    /// `MAX_COMPILED_VIEW_BYTES`.
    Size,
    /// Not UTF-8, a byte-order mark, NUL or a control character.
    Encoding,
    /// Malformed markup.
    Syntax,
    InvalidEntity,
    UnknownElement,
    InvalidParent,
    UnknownAttribute,
    DuplicateAttribute,
    InvalidAttribute,
    MissingAttribute,
    UnknownEvent,
    /// A handler that is neither a function name nor a call.
    InvalidHandler,
    Expression(ExprErrorKind),
    InvalidText,
    RecursiveComponent,
    InvalidComponent,
    InvalidSlot,
    /// `else-if` or `else` without `if`, or a construct misused.
    InvalidConstruct,
    MissingAsset,
    /// A `ref` bound, repeated, or inside a `for` or a component body.
    InvalidRef,
    /// A reference to a `ref` the view does not declare.
    UnknownRef,
    TooManyElements,
    TooManyComponents,
    TooManyChildren,
    TooManyExpressions,
    TooDeep,
}

impl OcmlErrorKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Encoding => "encoding",
            Self::Syntax => "syntax",
            Self::InvalidEntity => "invalid_entity",
            Self::UnknownElement => "unknown_element",
            Self::InvalidParent => "invalid_parent",
            Self::UnknownAttribute => "unknown_attribute",
            Self::DuplicateAttribute => "duplicate_attribute",
            Self::InvalidAttribute => "invalid_attribute",
            Self::MissingAttribute => "missing_attribute",
            Self::UnknownEvent => "unknown_event",
            Self::InvalidHandler => "invalid_handler",
            Self::Expression(kind) => match kind {
                ExprErrorKind::Syntax => "expression_syntax",
                ExprErrorKind::TooLong => "expression_too_long",
                ExprErrorKind::TooDeep => "expression_too_deep",
                ExprErrorKind::TooManyEntries => "expression_too_many_entries",
                ExprErrorKind::ReservedName => "reserved_name",
                ExprErrorKind::UnknownName => "unknown_name",
            },
            Self::InvalidText => "invalid_text",
            Self::RecursiveComponent => "recursive_component",
            Self::InvalidComponent => "invalid_component",
            Self::InvalidSlot => "invalid_slot",
            Self::InvalidConstruct => "invalid_construct",
            Self::MissingAsset => "missing_asset",
            Self::InvalidRef => "invalid_ref",
            Self::UnknownRef => "unknown_ref",
            Self::TooManyElements => "too_many_elements",
            Self::TooManyComponents => "too_many_components",
            Self::TooManyChildren => "too_many_children",
            Self::TooManyExpressions => "too_many_expressions",
            Self::TooDeep => "too_deep",
        }
    }
}

/// A rejected view: its category and where it was found. `position` is
/// zero when only the final compiled-view check could tell.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OcmlError {
    pub kind: OcmlErrorKind,
    pub position: Position,
}

/// The typed tree of one view.
#[derive(Clone, Debug, PartialEq)]
pub struct Document {
    pub components: Vec<ComponentDecl>,
    /// Children of the scene root.
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ComponentDecl {
    pub name: String,
    pub props: Vec<String>,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Element(ElementNode),
    /// Conditional branches; only the last may have no test (`else`).
    If(Vec<Branch>),
    For {
        each: Expr,
        item: String,
        key: Expr,
        children: Vec<Node>,
    },
    Component {
        name: String,
        props: Vec<(String, Expr)>,
        children: Vec<Node>,
    },
    Slot,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Branch {
    pub test: Option<Expr>,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ElementNode {
    pub element: &'static Element,
    /// Attributes in source order.
    pub attributes: Vec<(&'static str, AttributeValue)>,
    /// Handled events in source order; every handler is a call.
    pub events: Vec<(&'static str, Expr)>,
    /// Text content of a text or inline element; empty otherwise.
    pub text: Vec<TextPart>,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AttributeValue {
    /// Checked against the attribute type at parse time.
    Static(Value),
    Bound(Expr),
}

#[derive(Clone, Debug, PartialEq)]
pub enum TextPart {
    Literal(String),
    Expr(Expr),
}

/// Where a compiled expression is used; the VM calls value expressions with
/// the names of `scope` bound, and handlers with `event` bound as well.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Text,
    Attribute,
    Handler,
    Test,
    List,
    Key,
    Prop,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TemplateExpression {
    pub role: Role,
    /// Names in scope besides `state`, outermost first; for a handler the
    /// last one is `event`.
    pub scope: Vec<String>,
    pub expr: Expr,
}

/// The result of [`compile`].
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledView {
    /// Canonical `view.json`: sorted keys, no whitespace. Recompiling the
    /// same source always gives the same bytes (ADR 0005, admission).
    pub json: Vec<u8>,
    /// The expression table, in index order.
    pub expressions: Vec<TemplateExpression>,
    /// Logic-module functions the expressions call, sorted; P2.2 checks
    /// that `logic.js` exports each of them.
    pub functions: Vec<String>,
}

/// Parses and checks `view.ocml`. `assets` holds the package's `assets/…`
/// paths, the only images a static `src` may name.
pub fn parse(source: &[u8], assets: &BTreeSet<String>) -> Result<Document, OcmlError> {
    parse_with_functions(source, assets).map(|(document, _)| document)
}

fn parse_with_functions(
    source: &[u8],
    assets: &BTreeSet<String>,
) -> Result<(Document, Vec<String>), OcmlError> {
    if source.len() as u64 > MAX_VIEW_SOURCE_BYTES.value {
        return Err(OcmlError {
            kind: OcmlErrorKind::Size,
            position: Position::default(),
        });
    }
    let text = decode(source)?;
    let raw = Markup::new(text).document()?;
    let mut checker = Checker {
        source: text,
        assets,
        components: Vec::new(),
        elements: 0,
        functions: Vec::new(),
        refs: BTreeSet::new(),
        references: Vec::new(),
    };
    let document = checker.document(raw)?;
    if let Some((_, offset)) = checker
        .references
        .iter()
        .find(|(name, _)| !checker.refs.contains(name))
    {
        return Err(checker.error(OcmlErrorKind::UnknownRef, *offset));
    }
    let mut functions = checker.functions;
    functions.sort();
    Ok((document, functions))
}

/// Compiles `view.ocml` into `view.json` and its expression table.
pub fn compile(source: &[u8], assets: &BTreeSet<String>) -> Result<CompiledView, OcmlError> {
    let (document, functions) = parse_with_functions(source, assets)?;
    let mut emitter = Emitter {
        expressions: Vec::new(),
        scope: Vec::new(),
    };
    let view = emitter.document(&document)?;
    let mut json = Vec::new();
    write_canonical(&view, &mut json);
    if let Err(error) = validate_compiled_view(&json, assets) {
        return Err(OcmlError {
            kind: view_error(error),
            position: Position::default(),
        });
    }
    Ok(CompiledView {
        json,
        expressions: emitter.expressions,
        functions,
    })
}

fn view_error(error: ViewError) -> OcmlErrorKind {
    match error {
        ViewError::Size => OcmlErrorKind::Size,
        ViewError::UnknownElement => OcmlErrorKind::UnknownElement,
        ViewError::InvalidParent => OcmlErrorKind::InvalidParent,
        ViewError::UnknownAttribute => OcmlErrorKind::UnknownAttribute,
        ViewError::InvalidAttribute => OcmlErrorKind::InvalidAttribute,
        ViewError::MissingAttribute => OcmlErrorKind::MissingAttribute,
        ViewError::UnknownEvent => OcmlErrorKind::UnknownEvent,
        ViewError::InvalidText => OcmlErrorKind::InvalidText,
        // Unknown tags are reported as unknown elements before compilation.
        ViewError::UnknownComponent => OcmlErrorKind::UnknownElement,
        ViewError::RecursiveComponent => OcmlErrorKind::RecursiveComponent,
        ViewError::InvalidComponent => OcmlErrorKind::InvalidComponent,
        ViewError::InvalidSlot => OcmlErrorKind::InvalidSlot,
        ViewError::MissingAsset => OcmlErrorKind::MissingAsset,
        ViewError::InvalidRef => OcmlErrorKind::InvalidRef,
        ViewError::UnknownRef => OcmlErrorKind::UnknownRef,
        ViewError::TooManyElements => OcmlErrorKind::TooManyElements,
        ViewError::TooManyComponents => OcmlErrorKind::TooManyComponents,
        ViewError::TooManyChildren => OcmlErrorKind::TooManyChildren,
        ViewError::TooDeep => OcmlErrorKind::TooDeep,
        ViewError::InvalidExpression => OcmlErrorKind::TooManyExpressions,
        // The emitter writes only the shapes the validator accepts.
        ViewError::Json | ViewError::Shape | ViewError::ViewFormat => OcmlErrorKind::Syntax,
    }
}

fn decode(source: &[u8]) -> Result<&str, OcmlError> {
    let encoding = |offset: usize| OcmlError {
        kind: OcmlErrorKind::Encoding,
        position: Position {
            line: 0,
            column: u32::try_from(offset.saturating_add(1)).unwrap_or(u32::MAX),
        },
    };
    if source.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(encoding(0));
    }
    let text = std::str::from_utf8(source).map_err(|error| encoding(error.valid_up_to()))?;
    if let Some(offset) = text
        .char_indices()
        .find(|(_, character)| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
        .map(|(offset, _)| offset)
    {
        return Err(OcmlError {
            kind: OcmlErrorKind::Encoding,
            position: Position::of(text, offset),
        });
    }
    Ok(text)
}

// ---------------------------------------------------------------------------
// Markup: the generic tree of tags, attributes and text runs.

#[derive(Debug)]
enum RawNode {
    Tag(RawTag),
    /// A cleaned, non-empty text run.
    Text(Vec<RawPiece>, usize),
}

#[derive(Debug)]
struct RawTag {
    name: String,
    attributes: Vec<RawAttribute>,
    children: Vec<RawNode>,
    offset: usize,
}

#[derive(Debug)]
struct RawAttribute {
    name: String,
    value: RawValue,
    offset: usize,
}

#[derive(Debug)]
enum RawValue {
    Bare,
    Quoted(String),
    Expr(Expr),
}

#[derive(Debug)]
enum RawPiece {
    /// Raw source text, entities still encoded (they are checked already).
    Literal(String),
    Expr(Expr),
}

struct Markup<'a> {
    text: &'a str,
    bytes: &'a [u8],
    position: usize,
}

type MarkupResult<T> = Result<T, OcmlError>;

impl<'a> Markup<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            bytes: text.as_bytes(),
            position: 0,
        }
    }

    fn error_at(&self, kind: OcmlErrorKind, offset: usize) -> OcmlError {
        OcmlError {
            kind,
            position: Position::of(self.text, offset),
        }
    }

    fn error(&self, kind: OcmlErrorKind) -> OcmlError {
        self.error_at(kind, self.position)
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn rest(&self) -> &[u8] {
        self.bytes.get(self.position..).unwrap_or_default()
    }

    fn skip_space(&mut self) -> bool {
        let start = self.position;
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.position += 1;
        }
        self.position > start
    }

    fn document(&mut self) -> MarkupResult<Vec<RawNode>> {
        let children = self.content(1)?;
        if self.position < self.bytes.len() {
            // Only a stray end tag stops the top-level content early.
            return Err(self.error(OcmlErrorKind::Syntax));
        }
        Ok(children)
    }

    /// Nodes up to an end tag or the end of input. `depth` is the nesting
    /// of these nodes; the tree may be one level deeper than
    /// `MAX_TREE_DEPTH` because component declarations wrap their body.
    fn content(&mut self, depth: u64) -> MarkupResult<Vec<RawNode>> {
        let mut nodes = Vec::new();
        let mut pieces: Vec<(RawPiece, usize)> = Vec::new();
        loop {
            match self.peek() {
                None => break,
                Some(b'<') if self.rest().starts_with(b"</") => break,
                Some(b'<') if self.rest().starts_with(b"<!--") => {
                    self.flush(&mut pieces, &mut nodes);
                    self.comment()?;
                }
                Some(b'<') => {
                    self.flush(&mut pieces, &mut nodes);
                    if depth > MAX_TREE_DEPTH.value.saturating_add(1) {
                        return Err(self.error(OcmlErrorKind::TooDeep));
                    }
                    let tag = self.tag(depth)?;
                    nodes.push(RawNode::Tag(tag));
                }
                Some(b'{') => {
                    let offset = self.position;
                    let (expr, end) =
                        expr::parse_embedded(self.text, self.position + 1).map_err(|error| {
                            self.error_at(OcmlErrorKind::Expression(error.kind), error.offset)
                        })?;
                    self.position = end;
                    pieces.push((RawPiece::Expr(expr), offset));
                }
                Some(b'}') => return Err(self.error(OcmlErrorKind::Syntax)),
                Some(_) => {
                    let offset = self.position;
                    let literal = self.text_literal()?;
                    pieces.push((RawPiece::Literal(literal), offset));
                }
            }
            if nodes.len() as u64 > MAX_CHILDREN.value {
                return Err(self.error(OcmlErrorKind::TooManyChildren));
            }
        }
        self.flush(&mut pieces, &mut nodes);
        Ok(nodes)
    }

    /// Ends a text run: cleans its literals and keeps it if anything is left.
    fn flush(&self, pieces: &mut Vec<(RawPiece, usize)>, nodes: &mut Vec<RawNode>) {
        let Some(offset) = pieces.first().map(|(_, offset)| *offset) else {
            return;
        };
        let count = pieces.len();
        let mut cleaned = Vec::new();
        for (index, (piece, _)) in pieces.drain(..).enumerate() {
            match piece {
                RawPiece::Expr(expr) => cleaned.push(RawPiece::Expr(expr)),
                RawPiece::Literal(text) => {
                    let text = clean_whitespace(&text);
                    let edge = index == 0 || index + 1 == count;
                    if text.is_empty() || (edge && text.bytes().all(|byte| byte == b' ')) {
                        continue;
                    }
                    cleaned.push(RawPiece::Literal(text));
                }
            }
        }
        if !cleaned.is_empty() {
            nodes.push(RawNode::Text(cleaned, offset));
        }
    }

    fn comment(&mut self) -> MarkupResult<()> {
        let start = self.position;
        self.position += 4;
        loop {
            if self.rest().starts_with(b"-->") {
                self.position += 3;
                return Ok(());
            }
            if self.rest().starts_with(b"--") || self.peek().is_none() {
                return Err(self.error_at(OcmlErrorKind::Syntax, start));
            }
            self.position += 1;
        }
    }

    /// Text up to `<`, `{` or `}`, with every entity checked.
    fn text_literal(&mut self) -> MarkupResult<String> {
        let start = self.position;
        while let Some(byte) = self.peek() {
            match byte {
                b'<' | b'{' | b'}' => break,
                b'&' => {
                    self.entity()?;
                }
                _ => self.position += 1,
            }
        }
        Ok(self
            .text
            .get(start..self.position)
            .unwrap_or_default()
            .to_owned())
    }

    /// Checks the entity at the cursor and moves past it.
    fn entity(&mut self) -> MarkupResult<char> {
        let start = self.position;
        let invalid = |markup: &Self| markup.error_at(OcmlErrorKind::InvalidEntity, start);
        let rest = self.rest();
        let end = rest
            .iter()
            .take(12)
            .position(|byte| *byte == b';')
            .ok_or_else(|| invalid(self))?;
        let name =
            std::str::from_utf8(rest.get(1..end).unwrap_or_default()).map_err(|_| invalid(self))?;
        let character = entity_char(name).ok_or_else(|| invalid(self))?;
        self.position += end + 1;
        Ok(character)
    }

    fn name(&mut self, allow_upper: bool) -> Option<String> {
        let start = self.position;
        let first = self.peek()?;
        if !(first.is_ascii_lowercase()
            || (allow_upper && (first.is_ascii_uppercase() || first == b'_')))
        {
            return None;
        }
        while self.peek().is_some_and(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || byte == b'-'
                || (allow_upper && (byte.is_ascii_uppercase() || byte == b'_'))
        }) {
            self.position += 1;
        }
        self.text.get(start..self.position).map(str::to_owned)
    }

    fn tag(&mut self, depth: u64) -> MarkupResult<RawTag> {
        let offset = self.position;
        self.position += 1;
        let name = self
            .name(false)
            .ok_or_else(|| self.error(OcmlErrorKind::Syntax))?;
        let mut attributes: Vec<RawAttribute> = Vec::new();
        loop {
            let spaced = self.skip_space();
            match self.peek() {
                Some(b'/') if self.rest().starts_with(b"/>") => {
                    self.position += 2;
                    return Ok(RawTag {
                        name,
                        attributes,
                        children: Vec::new(),
                        offset,
                    });
                }
                Some(b'>') => {
                    self.position += 1;
                    break;
                }
                Some(_) if spaced => attributes.push(self.attribute()?),
                _ => return Err(self.error(OcmlErrorKind::Syntax)),
            }
        }
        let children = self.content(depth + 1)?;
        if !self.rest().starts_with(b"</") {
            return Err(self.error_at(OcmlErrorKind::Syntax, offset));
        }
        self.position += 2;
        let close = self.name(false);
        self.skip_space();
        if close.as_deref() != Some(name.as_str()) || self.peek() != Some(b'>') {
            return Err(self.error(OcmlErrorKind::Syntax));
        }
        self.position += 1;
        Ok(RawTag {
            name,
            attributes,
            children,
            offset,
        })
    }

    fn attribute(&mut self) -> MarkupResult<RawAttribute> {
        let offset = self.position;
        let mut name = self
            .name(true)
            .ok_or_else(|| self.error(OcmlErrorKind::Syntax))?;
        if name == "on" && self.peek() == Some(b':') {
            self.position += 1;
            let event = self
                .name(false)
                .ok_or_else(|| self.error(OcmlErrorKind::Syntax))?;
            name = format!("on:{event}");
        }
        if self.peek() != Some(b'=') {
            return Ok(RawAttribute {
                name,
                value: RawValue::Bare,
                offset,
            });
        }
        self.position += 1;
        let value = match self.peek() {
            Some(quote @ (b'"' | b'\'')) => {
                self.position += 1;
                let mut value = String::new();
                loop {
                    match self.peek() {
                        None => return Err(self.error_at(OcmlErrorKind::Syntax, offset)),
                        Some(byte) if byte == quote => {
                            self.position += 1;
                            break;
                        }
                        Some(b'<' | b'{' | b'}') => return Err(self.error(OcmlErrorKind::Syntax)),
                        Some(b'&') => value.push(self.entity()?),
                        Some(_) => {
                            let start = self.position;
                            while self.peek().is_some_and(|byte| {
                                !matches!(byte, b'<' | b'{' | b'}' | b'&') && byte != quote
                            }) {
                                self.position += 1;
                            }
                            value.push_str(self.text.get(start..self.position).unwrap_or_default());
                        }
                    }
                }
                RawValue::Quoted(value)
            }
            Some(b'{') => {
                let (expr, end) =
                    expr::parse_embedded(self.text, self.position + 1).map_err(|error| {
                        self.error_at(OcmlErrorKind::Expression(error.kind), error.offset)
                    })?;
                self.position = end;
                RawValue::Expr(expr)
            }
            _ => return Err(self.error(OcmlErrorKind::Syntax)),
        };
        Ok(RawAttribute {
            name,
            value,
            offset,
        })
    }
}

fn entity_char(name: &str) -> Option<char> {
    let character = match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "lbrace" => '{',
        "rbrace" => '}',
        "nbsp" => '\u{a0}',
        _ => {
            let number = name.strip_prefix('#')?;
            let code = match number.strip_prefix('x') {
                Some(hex)
                    if !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
                {
                    u32::from_str_radix(hex, 16).ok()?
                }
                None if !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()) => {
                    number.parse().ok()?
                }
                _ => return None,
            };
            char::from_u32(code).filter(|character| !character.is_control())?
        }
    };
    Some(character)
}

/// Decodes the entities of text already checked by [`Markup::entity`].
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(rest.get(..start).unwrap_or_default());
        let after = rest.get(start + 1..).unwrap_or_default();
        match after
            .find(';')
            .and_then(|end| Some((end, entity_char(after.get(..end)?)?)))
        {
            Some((end, character)) => {
                out.push(character);
                rest = after.get(end + 1..).unwrap_or_default();
            }
            // Unreachable for checked text; keep the byte rather than panic.
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The JSX rule: tabs become spaces, lines after the first lose leading
/// spaces, lines before the last lose trailing spaces, empty lines vanish,
/// and the remaining lines join with one space.
fn clean_whitespace(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let last_non_empty = lines
        .iter()
        .rposition(|line| {
            line.bytes()
                .any(|byte| !matches!(byte, b' ' | b'\t' | b'\r'))
        })
        .unwrap_or(0);
    let mut out = String::new();
    for (index, line) in lines.iter().enumerate() {
        let line = line.replace(['\t', '\r'], " ");
        let mut trimmed = line.as_str();
        if index > 0 {
            trimmed = trimmed.trim_start_matches(' ');
        }
        if index + 1 < lines.len() {
            trimmed = trimmed.trim_end_matches(' ');
        }
        if trimmed.is_empty() {
            continue;
        }
        out.push_str(trimmed);
        if index != last_non_empty {
            out.push(' ');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Semantic check: the typed tree.

struct Checker<'a> {
    source: &'a str,
    assets: &'a BTreeSet<String>,
    /// Declared components and their props.
    components: Vec<(String, Vec<String>)>,
    elements: u64,
    functions: Vec<String>,
    /// Declared `ref` names.
    refs: BTreeSet<String>,
    /// Static references to a `ref`, checked once the view is read.
    references: Vec<(String, usize)>,
}

/// Where a list of nodes is placed.
struct Place<'s> {
    /// Element whose content model applies; constructs are transparent.
    parent: &'static Element,
    depth: u64,
    /// Names in scope besides `state`.
    scope: &'s [String],
    /// Inside a component body: the running count of `slot` nodes.
    slots: Option<&'s mut u32>,
    /// Inside a `for` or a component body, where a node may exist several
    /// times and cannot carry a `ref`.
    repeated: bool,
}

impl<'s> Place<'s> {
    fn nested<'t>(&'t mut self, parent: &'static Element, scope: &'t [String]) -> Place<'t> {
        Place {
            parent,
            depth: self.depth + 1,
            scope,
            slots: self.slots.as_deref_mut(),
            repeated: self.repeated,
        }
    }
}

impl Checker<'_> {
    fn error(&self, kind: OcmlErrorKind, offset: usize) -> OcmlError {
        OcmlError {
            kind,
            position: Position::of(self.source, offset),
        }
    }

    fn document(&mut self, raw: Vec<RawNode>) -> Result<Document, OcmlError> {
        // Declarations first, so that a component can be used before it is
        // declared.
        for node in &raw {
            if let RawNode::Tag(tag) = node
                && tag.name == "component"
            {
                let (name, props) = self.declaration(tag)?;
                if self
                    .components
                    .iter()
                    .any(|(existing, _)| *existing == name)
                {
                    return Err(self.error(OcmlErrorKind::InvalidComponent, tag.offset));
                }
                if self.components.len() as u64 >= MAX_COMPONENTS.value {
                    return Err(self.error(OcmlErrorKind::TooManyComponents, tag.offset));
                }
                self.components.push((name, props));
            }
        }
        let root = element("box").ok_or_else(|| self.error(OcmlErrorKind::UnknownElement, 0))?;
        let mut components = Vec::new();
        let mut body = Vec::new();
        for node in raw {
            match node {
                RawNode::Tag(tag) if tag.name == "component" => {
                    let (name, props) = self.declaration(&tag)?;
                    let mut slots = 0;
                    let children = self.children(
                        tag.children,
                        Place {
                            parent: root,
                            depth: 1,
                            scope: &props,
                            slots: Some(&mut slots),
                            repeated: true,
                        },
                    )?;
                    if slots > 1 {
                        return Err(self.error(OcmlErrorKind::InvalidSlot, tag.offset));
                    }
                    components.push(ComponentDecl {
                        name,
                        props,
                        children,
                    });
                }
                other => body.push(other),
            }
        }
        let children = self.children(
            body,
            Place {
                parent: root,
                depth: 1,
                scope: &[],
                slots: None,
                repeated: false,
            },
        )?;
        Ok(Document {
            components,
            children,
        })
    }

    fn declaration(&self, tag: &RawTag) -> Result<(String, Vec<String>), OcmlError> {
        let invalid = |offset| self.error(OcmlErrorKind::InvalidComponent, offset);
        let mut name = None;
        let mut props = Vec::new();
        for attribute in &tag.attributes {
            match (attribute.name.as_str(), &attribute.value) {
                ("name", RawValue::Quoted(value)) if name.is_none() => name = Some(value.clone()),
                ("props", RawValue::Quoted(value)) if props.is_empty() => {
                    for prop in value.split_ascii_whitespace() {
                        if !valid_scope_name(prop)
                            || !expr::valid_name(prop)
                            || prop == STATE_ROOT
                            || prop == EVENT_ROOT
                            || props.iter().any(|existing: &String| existing == prop)
                        {
                            return Err(invalid(attribute.offset));
                        }
                        props.push(prop.to_owned());
                    }
                    if props.len() as u64 > MAX_COMPONENT_PROPS.value {
                        return Err(invalid(attribute.offset));
                    }
                }
                _ => return Err(invalid(attribute.offset)),
            }
        }
        let name = name.ok_or_else(|| self.error(OcmlErrorKind::MissingAttribute, tag.offset))?;
        if !valid_identifier(&name)
            || element(&name).is_some()
            || CONSTRUCTS.contains(&name.as_str())
        {
            return Err(invalid(tag.offset));
        }
        Ok((name, props))
    }

    fn children(
        &mut self,
        raw: Vec<RawNode>,
        mut place: Place<'_>,
    ) -> Result<Vec<Node>, OcmlError> {
        let mut nodes = Vec::new();
        let mut raw = raw.into_iter().peekable();
        while let Some(node) = raw.next() {
            let tag = match node {
                RawNode::Tag(tag) => tag,
                RawNode::Text(_, offset) => {
                    return Err(self.error(OcmlErrorKind::InvalidText, offset));
                }
            };
            if place.depth > MAX_TREE_DEPTH.value {
                return Err(self.error(OcmlErrorKind::TooDeep, tag.offset));
            }
            let node = match tag.name.as_str() {
                "if" => {
                    let mut branches = vec![self.branch(tag, &mut place, true)?];
                    while let Some(RawNode::Tag(next)) = raw.peek() {
                        let is_else = next.name == "else";
                        if next.name != "else-if" && !is_else {
                            break;
                        }
                        let Some(RawNode::Tag(next)) = raw.next() else {
                            break;
                        };
                        branches.push(self.branch(next, &mut place, !is_else)?);
                        if is_else {
                            break;
                        }
                    }
                    Node::If(branches)
                }
                "else-if" | "else" | "component" => {
                    let kind = if tag.name == "component" {
                        OcmlErrorKind::InvalidComponent
                    } else {
                        OcmlErrorKind::InvalidConstruct
                    };
                    return Err(self.error(kind, tag.offset));
                }
                "for" => self.for_node(tag, &mut place)?,
                "slot" => {
                    let Some(slots) = place.slots.as_deref_mut() else {
                        return Err(self.error(OcmlErrorKind::InvalidSlot, tag.offset));
                    };
                    if !tag.attributes.is_empty()
                        || !tag.children.is_empty()
                        || place.parent.content != Content::Flow
                    {
                        return Err(self.error(OcmlErrorKind::InvalidSlot, tag.offset));
                    }
                    *slots += 1;
                    Node::Slot
                }
                name => {
                    if let Some(element) = element(name) {
                        Node::Element(self.element(element, tag, &mut place)?)
                    } else if let Some(props) = self
                        .components
                        .iter()
                        .find(|(declared, _)| declared == name)
                        .map(|(_, props)| props.clone())
                    {
                        self.component_use(tag, props, &mut place)?
                    } else if valid_identifier(name) {
                        return Err(self.error(OcmlErrorKind::UnknownElement, tag.offset));
                    } else {
                        return Err(self.error(OcmlErrorKind::Syntax, tag.offset));
                    }
                }
            };
            nodes.push(node);
            if nodes.len() as u64 > MAX_CHILDREN.value {
                return Err(self.error(OcmlErrorKind::TooManyChildren, 0));
            }
        }
        Ok(nodes)
    }

    fn in_scope(scope: &[String], extra: &[&str]) -> impl Fn(&str) -> bool {
        let names: Vec<String> = scope
            .iter()
            .cloned()
            .chain(extra.iter().map(|name| (*name).to_owned()))
            .collect();
        move |name: &str| name == STATE_ROOT || names.iter().any(|known| known == name)
    }

    fn resolve(
        &mut self,
        expr: &Expr,
        scope: &[String],
        extra: &[&str],
        offset: usize,
    ) -> Result<(), OcmlError> {
        let in_scope = Self::in_scope(scope, extra);
        expr.resolve(&in_scope, &mut self.functions)
            .map_err(|kind| self.error(OcmlErrorKind::Expression(kind), offset))
    }

    /// The single expression attribute `name` of a construct, and nothing
    /// else besides the attributes listed in `others`.
    fn construct_expression(
        &mut self,
        tag: &RawTag,
        name: &str,
        others: &[&str],
        scope: &[String],
    ) -> Result<Expr, OcmlError> {
        let mut found = None;
        for attribute in &tag.attributes {
            if attribute.name == name {
                if found.is_some() {
                    return Err(self.error(OcmlErrorKind::DuplicateAttribute, attribute.offset));
                }
                let RawValue::Expr(expr) = &attribute.value else {
                    return Err(self.error(OcmlErrorKind::InvalidAttribute, attribute.offset));
                };
                self.resolve(expr, scope, &[], attribute.offset)?;
                found = Some(expr.clone());
            } else if !others.contains(&attribute.name.as_str()) {
                return Err(self.error(OcmlErrorKind::UnknownAttribute, attribute.offset));
            }
        }
        found.ok_or_else(|| self.error(OcmlErrorKind::MissingAttribute, tag.offset))
    }

    fn branch(
        &mut self,
        tag: RawTag,
        place: &mut Place<'_>,
        tested: bool,
    ) -> Result<Branch, OcmlError> {
        let test = if tested {
            Some(self.construct_expression(&tag, "test", &[], place.scope)?)
        } else {
            if let Some(attribute) = tag.attributes.first() {
                return Err(self.error(OcmlErrorKind::UnknownAttribute, attribute.offset));
            }
            None
        };
        let parent = place.parent;
        let scope = place.scope.to_vec();
        let children = self.children(tag.children, place.nested(parent, &scope))?;
        Ok(Branch { test, children })
    }

    fn for_node(&mut self, tag: RawTag, place: &mut Place<'_>) -> Result<Node, OcmlError> {
        let each = self.construct_expression(&tag, "each", &["as", "key"], place.scope)?;
        let mut item = None;
        for attribute in &tag.attributes {
            if attribute.name != "as" {
                continue;
            }
            match &attribute.value {
                RawValue::Quoted(name)
                    if item.is_none()
                        && valid_scope_name(name)
                        && expr::valid_name(name)
                        && name != STATE_ROOT
                        && name != EVENT_ROOT
                        && !place.scope.contains(name) =>
                {
                    item = Some(name.clone());
                }
                _ => return Err(self.error(OcmlErrorKind::InvalidAttribute, attribute.offset)),
            }
        }
        let item = item.ok_or_else(|| self.error(OcmlErrorKind::MissingAttribute, tag.offset))?;
        let mut scope = place.scope.to_vec();
        scope.push(item.clone());
        let key = self.construct_expression(&tag, "key", &["as", "each"], &scope)?;
        let parent = place.parent;
        let mut nested = place.nested(parent, &scope);
        nested.repeated = true;
        let children = self.children(tag.children, nested)?;
        Ok(Node::For {
            each,
            item,
            key,
            children,
        })
    }

    fn component_use(
        &mut self,
        tag: RawTag,
        declared: Vec<String>,
        place: &mut Place<'_>,
    ) -> Result<Node, OcmlError> {
        if place.parent.content != Content::Flow {
            return Err(self.error(OcmlErrorKind::InvalidParent, tag.offset));
        }
        let mut props: Vec<(String, Expr)> = Vec::new();
        for attribute in &tag.attributes {
            if attribute.name.starts_with("on:") {
                return Err(self.error(OcmlErrorKind::UnknownEvent, attribute.offset));
            }
            if !declared.contains(&attribute.name) {
                return Err(self.error(OcmlErrorKind::InvalidComponent, attribute.offset));
            }
            if props.iter().any(|(name, _)| *name == attribute.name) {
                return Err(self.error(OcmlErrorKind::DuplicateAttribute, attribute.offset));
            }
            let value = match &attribute.value {
                RawValue::Bare => Expr::Bool(true),
                RawValue::Quoted(text) => Expr::String(text.clone()),
                RawValue::Expr(expr) => {
                    self.resolve(expr, place.scope, &[], attribute.offset)?;
                    expr.clone()
                }
            };
            props.push((attribute.name.clone(), value));
        }
        let parent = place.parent;
        let scope = place.scope.to_vec();
        let children = self.children(tag.children, place.nested(parent, &scope))?;
        Ok(Node::Component {
            name: tag.name,
            props,
            children,
        })
    }

    fn element(
        &mut self,
        element: &'static Element,
        tag: RawTag,
        place: &mut Place<'_>,
    ) -> Result<ElementNode, OcmlError> {
        if !accepts(place.parent, element) {
            return Err(self.error(OcmlErrorKind::InvalidParent, tag.offset));
        }
        self.elements += 1;
        if self.elements > MAX_VIEW_ELEMENTS.value {
            return Err(self.error(OcmlErrorKind::TooManyElements, tag.offset));
        }
        let mut attributes: Vec<(&'static str, AttributeValue)> = Vec::new();
        let mut events: Vec<(&'static str, Expr)> = Vec::new();
        for attribute in &tag.attributes {
            let offset = attribute.offset;
            if let Some(event) = attribute.name.strip_prefix("on:") {
                let event = element
                    .events
                    .iter()
                    .find(|known| **known == event)
                    .copied()
                    .ok_or_else(|| self.error(OcmlErrorKind::UnknownEvent, offset))?;
                if events.iter().any(|(existing, _)| *existing == event) {
                    return Err(self.error(OcmlErrorKind::DuplicateAttribute, offset));
                }
                let RawValue::Expr(handler) = &attribute.value else {
                    return Err(self.error(OcmlErrorKind::InvalidHandler, offset));
                };
                let handler = self.handler(handler, place.scope, offset)?;
                events.push((event, handler));
                continue;
            }
            let field: &'static Field = COMMON_ATTRIBUTES
                .iter()
                .chain(element.attributes)
                .find(|field| field.name == attribute.name && field.name != "on")
                .ok_or_else(|| self.error(OcmlErrorKind::UnknownAttribute, offset))?;
            if attributes
                .iter()
                .any(|(existing, _)| *existing == field.name)
            {
                return Err(self.error(OcmlErrorKind::DuplicateAttribute, offset));
            }
            // A `ref` is one static name for one node of the view.
            if field.ty == ValueType::Ref {
                let RawValue::Quoted(name) = &attribute.value else {
                    return Err(self.error(OcmlErrorKind::InvalidRef, offset));
                };
                if place.repeated || !self.refs.insert(name.clone()) {
                    return Err(self.error(OcmlErrorKind::InvalidRef, offset));
                }
            }
            if let (ValueType::RefName, RawValue::Quoted(name)) = (field.ty, &attribute.value) {
                self.references.push((name.clone(), offset));
            }
            let value = match &attribute.value {
                RawValue::Expr(expr) => {
                    self.resolve(expr, place.scope, &[], offset)?;
                    AttributeValue::Bound(expr.clone())
                }
                RawValue::Bare => {
                    if field.ty != ValueType::Bool {
                        return Err(self.error(OcmlErrorKind::InvalidAttribute, offset));
                    }
                    AttributeValue::Static(Value::Bool(true))
                }
                RawValue::Quoted(text) => {
                    let value = static_json(field.ty, text)
                        .ok_or_else(|| self.error(OcmlErrorKind::InvalidAttribute, offset))?;
                    static_value(field.ty, &value, self.assets).map_err(|error| {
                        let kind = if error == ViewError::MissingAsset {
                            OcmlErrorKind::MissingAsset
                        } else {
                            OcmlErrorKind::InvalidAttribute
                        };
                        self.error(kind, offset)
                    })?;
                    AttributeValue::Static(value)
                }
            };
            attributes.push((field.name, value));
        }
        if element
            .attributes
            .iter()
            .any(|field| field.required && !attributes.iter().any(|(name, _)| *name == field.name))
        {
            return Err(self.error(OcmlErrorKind::MissingAttribute, tag.offset));
        }

        let has_tags = tag
            .children
            .iter()
            .any(|node| matches!(node, RawNode::Tag(_)));
        let mut text = Vec::new();
        let mut children = Vec::new();
        match element.content {
            Content::Empty if !tag.children.is_empty() => {
                return Err(self.error(OcmlErrorKind::InvalidParent, tag.offset));
            }
            Content::Empty => {}
            _ if tag.children.is_empty() => {}
            Content::Text | Content::Inline if !has_tags => {
                text = self.text(tag.children, place.scope, tag.offset)?;
            }
            Content::Text => return Err(self.error(OcmlErrorKind::InvalidParent, tag.offset)),
            Content::Inline | Content::Flow | Content::Only(_) => {
                let scope = place.scope.to_vec();
                children = self.children(tag.children, place.nested(element, &scope))?;
            }
        }
        Ok(ElementNode {
            element,
            attributes,
            events,
            text,
            children,
        })
    }

    /// A handler is a call, or the name of a logic function called with the
    /// event detail.
    fn handler(
        &mut self,
        handler: &Expr,
        scope: &[String],
        offset: usize,
    ) -> Result<Expr, OcmlError> {
        let call = match handler {
            Expr::Name(function) if !scope.contains(function) && function != STATE_ROOT => {
                Expr::Call {
                    function: function.clone(),
                    arguments: vec![Expr::Name(EVENT_ROOT.to_owned())],
                }
            }
            Expr::Call { .. } => handler.clone(),
            _ => return Err(self.error(OcmlErrorKind::InvalidHandler, offset)),
        };
        self.resolve(&call, scope, &[EVENT_ROOT], offset)?;
        Ok(call)
    }

    fn text(
        &mut self,
        raw: Vec<RawNode>,
        scope: &[String],
        offset: usize,
    ) -> Result<Vec<TextPart>, OcmlError> {
        let mut parts: Vec<TextPart> = Vec::new();
        let mut literal_bytes = 0u64;
        for node in raw {
            let RawNode::Text(pieces, run_offset) = node else {
                return Err(self.error(OcmlErrorKind::InvalidText, offset));
            };
            for piece in pieces {
                match piece {
                    RawPiece::Expr(expr) => {
                        self.resolve(&expr, scope, &[], run_offset)?;
                        parts.push(TextPart::Expr(expr));
                    }
                    RawPiece::Literal(raw) => {
                        let literal = decode_entities(&raw);
                        literal_bytes = literal_bytes.saturating_add(literal.len() as u64);
                        match parts.last_mut() {
                            Some(TextPart::Literal(previous)) => previous.push_str(&literal),
                            _ => parts.push(TextPart::Literal(literal)),
                        }
                    }
                }
            }
        }
        if parts.is_empty() || literal_bytes > MAX_NODE_TEXT_BYTES.value {
            return Err(self.error(OcmlErrorKind::InvalidText, offset));
        }
        Ok(parts)
    }
}

/// The JSON form of a quoted attribute value for its type, or `None` when
/// the text cannot have that type.
fn static_json(ty: ValueType, text: &str) -> Option<Value> {
    match ty {
        ValueType::Bool => match text {
            "true" => Some(Value::Bool(true)),
            "false" => Some(Value::Bool(false)),
            _ => None,
        },
        ValueType::Integer { .. } => {
            let digits = text.strip_prefix('-').unwrap_or(text);
            let canonical = !digits.is_empty()
                && digits.bytes().all(|byte| byte.is_ascii_digit())
                && (digits == "0" || !digits.starts_with('0'))
                && text != "-0";
            if !canonical {
                return None;
            }
            text.parse::<i64>().ok().map(Value::from)
        }
        ValueType::Number { .. } => decimal(text).map(Value::from),
        ValueType::NumberList(_) => text
            .split_ascii_whitespace()
            .map(|item| {
                decimal(item)
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
            })
            .collect::<Option<Vec<_>>>()
            .map(Value::Array),
        _ => Some(Value::String(text.to_owned())),
    }
}

/// `-?digits(.digits)?`, finite; no exponent, sign `+` or leading zero.
fn decimal(text: &str) -> Option<f64> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (integer, fraction) = match unsigned.split_once('.') {
        Some((integer, fraction)) => (integer, Some(fraction)),
        None => (unsigned, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(integer)
        || (integer.len() > 1 && integer.starts_with('0'))
        || fraction.is_some_and(|fraction| !digits(fraction))
    {
        return None;
    }
    text.parse::<f64>().ok().filter(|value| value.is_finite())
}

// ---------------------------------------------------------------------------
// Emission of `view.json`.

struct Emitter {
    expressions: Vec<TemplateExpression>,
    /// Names in scope besides `state` for the node being emitted.
    scope: Vec<String>,
}

impl Emitter {
    fn expression(&mut self, role: Role, expr: &Expr) -> Result<Value, OcmlError> {
        let index = self.expressions.len() as u64;
        if index >= MAX_VIEW_EXPRESSIONS.value {
            return Err(OcmlError {
                kind: OcmlErrorKind::TooManyExpressions,
                position: Position::default(),
            });
        }
        let mut scope = self.scope.clone();
        if role == Role::Handler {
            scope.push(EVENT_ROOT.to_owned());
        }
        self.expressions.push(TemplateExpression {
            role,
            scope,
            expr: expr.clone(),
        });
        Ok(Value::from(index))
    }

    fn document(&mut self, document: &Document) -> Result<Value, OcmlError> {
        let mut components = Vec::new();
        for component in &document.components {
            self.scope = component.props.clone();
            let children = self.nodes(&component.children)?;
            let mut object = Map::new();
            object.insert("name".into(), Value::from(component.name.as_str()));
            object.insert(
                "props".into(),
                Value::Array(
                    component
                        .props
                        .iter()
                        .map(|prop| Value::from(prop.as_str()))
                        .collect(),
                ),
            );
            object.insert("children".into(), children);
            components.push(Value::Object(object));
        }
        self.scope.clear();
        let children = self.nodes(&document.children)?;
        let mut view = Map::new();
        view.insert("viewFormat".into(), Value::from(VIEW_FORMAT));
        if !components.is_empty() {
            view.insert("components".into(), Value::Array(components));
        }
        view.insert("children".into(), children);
        view.insert(
            "expressions".into(),
            Value::from(self.expressions.len() as u64),
        );
        Ok(Value::Object(view))
    }

    fn nodes(&mut self, nodes: &[Node]) -> Result<Value, OcmlError> {
        let mut out = Vec::with_capacity(nodes.len());
        for node in nodes {
            out.push(self.node(node)?);
        }
        Ok(Value::Array(out))
    }

    fn node(&mut self, node: &Node) -> Result<Value, OcmlError> {
        let mut object = Map::new();
        match node {
            Node::Element(element) => {
                object.insert("element".into(), Value::from(element.element.name));
                let mut attrs = Map::new();
                let mut bind = Map::new();
                for (name, value) in &element.attributes {
                    match value {
                        AttributeValue::Static(value) => {
                            attrs.insert((*name).into(), value.clone());
                        }
                        AttributeValue::Bound(expr) => {
                            bind.insert((*name).into(), self.expression(Role::Attribute, expr)?);
                        }
                    }
                }
                let mut on = Map::new();
                for (event, handler) in &element.events {
                    on.insert((*event).into(), self.expression(Role::Handler, handler)?);
                }
                for (key, map) in [("attrs", attrs), ("bind", bind), ("on", on)] {
                    if !map.is_empty() {
                        object.insert(key.into(), Value::Object(map));
                    }
                }
                if !element.text.is_empty() {
                    let mut parts = Vec::new();
                    for part in &element.text {
                        parts.push(match part {
                            TextPart::Literal(text) => Value::from(text.as_str()),
                            TextPart::Expr(expr) => {
                                let mut part = Map::new();
                                part.insert("expr".into(), self.expression(Role::Text, expr)?);
                                Value::Object(part)
                            }
                        });
                    }
                    object.insert("text".into(), Value::Array(parts));
                }
                if !element.children.is_empty() {
                    object.insert("children".into(), self.nodes(&element.children)?);
                }
            }
            Node::If(branches) => {
                let mut out = Vec::new();
                for branch in branches {
                    let mut entry = Map::new();
                    if let Some(test) = &branch.test {
                        entry.insert("test".into(), self.expression(Role::Test, test)?);
                    }
                    entry.insert("children".into(), self.nodes(&branch.children)?);
                    out.push(Value::Object(entry));
                }
                object.insert("if".into(), Value::Array(out));
            }
            Node::For {
                each,
                item,
                key,
                children,
            } => {
                object.insert("for".into(), self.expression(Role::List, each)?);
                object.insert("as".into(), Value::from(item.as_str()));
                self.scope.push(item.clone());
                object.insert("key".into(), self.expression(Role::Key, key)?);
                let children = self.nodes(children);
                self.scope.pop();
                object.insert("children".into(), children?);
            }
            Node::Component {
                name,
                props,
                children,
            } => {
                object.insert("component".into(), Value::from(name.as_str()));
                if !props.is_empty() {
                    let mut map = Map::new();
                    for (prop, expr) in props {
                        map.insert(prop.clone(), self.expression(Role::Prop, expr)?);
                    }
                    object.insert("props".into(), Value::Object(map));
                }
                if !children.is_empty() {
                    object.insert("children".into(), self.nodes(children)?);
                }
            }
            Node::Slot => {
                object.insert("slot".into(), Value::Bool(true));
            }
        }
        Ok(Value::Object(object))
    }
}

/// Compact JSON with object keys sorted by their UTF-8 bytes, whatever map
/// order `serde_json` was built with.
fn write_canonical(value: &Value, out: &mut Vec<u8>) {
    match value {
        Value::Array(items) => {
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_canonical(item, out);
            }
            out.push(b']');
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
            out.push(b'{');
            for (index, (key, item)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(Value::from(key.as_str()).to_string().as_bytes());
                out.push(b':');
                write_canonical(item, out);
            }
            out.push(b'}');
        }
        scalar => out.extend_from_slice(scalar.to_string().as_bytes()),
    }
}
