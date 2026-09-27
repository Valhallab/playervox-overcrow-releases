//! Template expressions of `view.ocml` (ADR 0001, D3): the closed subset of
//! the schema's `EXPRESSION_SUMMARY`, parsed ahead of time into a typed tree.
//!
//! The VM has no `eval`, so the compiler turns every expression into code of
//! `logic.js`; [`Expr::to_js`] writes the canonical JavaScript text of one
//! expression, fully parenthesized. How that text is wrapped into the table
//! `logic.js` registers with the SDK belongs to P2.1.
//!
//! The grammar is a strict subset of JavaScript: literals, scope names and
//! their members, `!`, unary `-` and `+`, arithmetic, comparison, `&&`, `||`,
//! `??`, the conditional operator, array and object literals, and calls of
//! functions exported by the logic module. There is no assignment, update,
//! function literal, `new`, `this`, template literal, regular expression,
//! comma operator, spread or global access.

use overcrow_widget_schema::limits::{
    MAX_CALL_ARGUMENTS, MAX_EXPRESSION_BYTES, MAX_EXPRESSION_DEPTH, MAX_IDENTIFIER_BYTES,
};

/// Recursion bound of the parser, derived from the tree bound.
const PARSER_DEPTH: u64 = 3 * MAX_EXPRESSION_DEPTH.value + 1;

/// Root name of the widget state in every expression.
pub const STATE_ROOT: &str = "state";
/// Name of the event detail inside an event handler.
pub const EVENT_ROOT: &str = "event";

/// JavaScript reserved words, and names whose use in a template would reach
/// the engine rather than widget data. They never parse as an identifier.
const RESERVED: &[&str] = &[
    "arguments",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "constructor",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "eval",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "globalThis",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "overcrow",
    "package",
    "private",
    "protected",
    "prototype",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnaryOp {
    Not,
    Negate,
    Plus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinaryOp {
    Or,
    And,
    Coalesce,
    Equal,
    NotEqual,
    StrictEqual,
    StrictNotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Add,
    Subtract,
    Multiply,
    Divide,
    Remainder,
}

impl BinaryOp {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Or => "||",
            Self::And => "&&",
            Self::Coalesce => "??",
            Self::Equal => "==",
            Self::NotEqual => "!=",
            Self::StrictEqual => "===",
            Self::StrictNotEqual => "!==",
            Self::Less => "<",
            Self::LessEqual => "<=",
            Self::Greater => ">",
            Self::GreaterEqual => ">=",
            Self::Add => "+",
            Self::Subtract => "-",
            Self::Multiply => "*",
            Self::Divide => "/",
            Self::Remainder => "%",
        }
    }
}

/// A parsed template expression.
#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Null,
    Bool(bool),
    /// Finite, non-negative: a minus sign is a [`UnaryOp::Negate`].
    Number(f64),
    String(String),
    /// A name bound in template scope: [`STATE_ROOT`], a component prop, a
    /// `for` item or, in a handler, [`EVENT_ROOT`].
    Name(String),
    /// `object.name`, or `object?.name` when `optional`.
    Member {
        object: Box<Expr>,
        name: String,
        optional: bool,
    },
    /// `object[index]`, or `object?.[index]` when `optional`.
    Index {
        object: Box<Expr>,
        index: Box<Expr>,
        optional: bool,
    },
    /// Call of a function exported by the logic module (`t` included). Only
    /// a bare name can be called.
    Call {
        function: String,
        arguments: Vec<Expr>,
    },
    Unary(UnaryOp, Box<Expr>),
    Binary(BinaryOp, Box<Expr>, Box<Expr>),
    Conditional(Box<Expr>, Box<Expr>, Box<Expr>),
    Array(Vec<Expr>),
    Object(Vec<(String, Expr)>),
}

/// Fixed reasons an expression is rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExprErrorKind {
    Syntax,
    /// Longer than `MAX_EXPRESSION_BYTES`.
    TooLong,
    /// A tree deeper than `MAX_EXPRESSION_DEPTH`, or parentheses nested
    /// beyond the parser's derived recursion bound.
    TooDeep,
    /// More than `MAX_CALL_ARGUMENTS` arguments or literal entries.
    TooManyEntries,
    /// A reserved word, or a name outside `[A-Za-z_][A-Za-z0-9_]*` and
    /// `MAX_IDENTIFIER_BYTES`.
    ReservedName,
    /// A name that is not in scope, or a call of a name that is.
    UnknownName,
}

impl ExprErrorKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Syntax => "syntax",
            Self::TooLong => "too_long",
            Self::TooDeep => "too_deep",
            Self::TooManyEntries => "too_many_entries",
            Self::ReservedName => "reserved_name",
            Self::UnknownName => "unknown_name",
        }
    }
}

/// An expression error at a byte offset of the text given to the parser.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExprError {
    pub kind: ExprErrorKind,
    pub offset: usize,
}

/// Parses one expression embedded in markup: `source[start..]` holds the
/// expression followed by its closing `}`. Returns the expression and the
/// offset just past that `}`.
pub fn parse_embedded(source: &str, start: usize) -> Result<(Expr, usize), ExprError> {
    let bytes = source.as_bytes();
    let available = bytes.len().saturating_sub(start);
    let maximum = usize::try_from(MAX_EXPRESSION_BYTES.value).unwrap_or(usize::MAX);
    // One more byte than the bound, so that an expression of exactly the
    // bound still finds its closing brace.
    let end = start.saturating_add(available.min(maximum.saturating_add(1)));
    let mut parser = Parser {
        bytes: bytes.get(start..end).unwrap_or_default(),
        position: 0,
        depth: 0,
        truncated: available > maximum.saturating_add(1),
        base: start,
    };
    let expr = parser.expression()?;
    parser.check_tree(&expr)?;
    parser.skip_space();
    if parser.peek() != Some(b'}') {
        return Err(parser.error_here());
    }
    if parser.position > maximum {
        return Err(parser.error(ExprErrorKind::TooLong));
    }
    Ok((expr, start + parser.position + 1))
}

/// Parses a whole string as one expression (tests and tooling).
pub fn parse(text: &str) -> Result<Expr, ExprError> {
    if text.len() as u64 > MAX_EXPRESSION_BYTES.value {
        return Err(ExprError {
            kind: ExprErrorKind::TooLong,
            offset: 0,
        });
    }
    let mut parser = Parser {
        bytes: text.as_bytes(),
        position: 0,
        depth: 0,
        truncated: false,
        base: 0,
    };
    let expr = parser.expression()?;
    parser.check_tree(&expr)?;
    parser.skip_space();
    if parser.position != text.len() {
        return Err(parser.error(ExprErrorKind::Syntax));
    }
    Ok(expr)
}

/// A name usable in an expression: an ASCII identifier within
/// `MAX_IDENTIFIER_BYTES` that is not reserved.
pub fn valid_name(name: &str) -> bool {
    name.len() as u64 <= MAX_IDENTIFIER_BYTES.value
        && name
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && !is_reserved(name)
}

fn is_reserved(name: &str) -> bool {
    // `__proto__` and the other double-underscore accessors reach the
    // prototype chain.
    RESERVED.contains(&name) || name.starts_with("__") || matches!(name, "true" | "false" | "null")
}

impl Expr {
    fn for_each_child<'a>(&'a self, mut visit: impl FnMut(&'a Expr)) {
        match self {
            Self::Null | Self::Bool(_) | Self::Number(_) | Self::String(_) | Self::Name(_) => {}
            Self::Member { object, .. } => visit(object),
            Self::Index { object, index, .. } => {
                visit(object);
                visit(index);
            }
            Self::Call { arguments, .. } | Self::Array(arguments) => {
                arguments.iter().for_each(visit)
            }
            Self::Unary(_, operand) => visit(operand),
            Self::Binary(_, left, right) => {
                visit(left);
                visit(right);
            }
            Self::Conditional(test, then, otherwise) => {
                visit(test);
                visit(then);
                visit(otherwise);
            }
            Self::Object(entries) => entries.iter().for_each(|(_, value)| visit(value)),
        }
    }

    /// Checks every name against `in_scope` and collects called functions.
    /// A called name must not be in scope: only logic exports are callable.
    pub fn resolve(
        &self,
        in_scope: &dyn Fn(&str) -> bool,
        functions: &mut Vec<String>,
    ) -> Result<(), ExprErrorKind> {
        match self {
            Self::Null | Self::Bool(_) | Self::Number(_) | Self::String(_) => Ok(()),
            Self::Name(name) => {
                if in_scope(name) {
                    Ok(())
                } else {
                    Err(ExprErrorKind::UnknownName)
                }
            }
            Self::Member { object, .. } => object.resolve(in_scope, functions),
            Self::Index { object, index, .. } => {
                object.resolve(in_scope, functions)?;
                index.resolve(in_scope, functions)
            }
            Self::Call {
                function,
                arguments,
            } => {
                if in_scope(function) {
                    return Err(ExprErrorKind::UnknownName);
                }
                if !functions.contains(function) {
                    functions.push(function.clone());
                }
                arguments
                    .iter()
                    .try_for_each(|argument| argument.resolve(in_scope, functions))
            }
            Self::Unary(_, operand) => operand.resolve(in_scope, functions),
            Self::Binary(_, left, right) => {
                left.resolve(in_scope, functions)?;
                right.resolve(in_scope, functions)
            }
            Self::Conditional(test, then, otherwise) => {
                test.resolve(in_scope, functions)?;
                then.resolve(in_scope, functions)?;
                otherwise.resolve(in_scope, functions)
            }
            Self::Array(items) => items
                .iter()
                .try_for_each(|item| item.resolve(in_scope, functions)),
            Self::Object(entries) => entries
                .iter()
                .try_for_each(|(_, value)| value.resolve(in_scope, functions)),
        }
    }

    /// Canonical JavaScript text of the expression. Every operator is
    /// parenthesized, so the text never depends on precedence, and strings
    /// are JSON string literals, which JavaScript reads identically.
    pub fn to_js(&self) -> String {
        let mut out = String::new();
        self.write_js(&mut out);
        out
    }

    fn write_js(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Number(value) => out.push_str(&number_text(*value)),
            Self::String(value) => {
                out.push_str(&serde_json::Value::from(value.as_str()).to_string())
            }
            Self::Name(name) => out.push_str(name),
            Self::Member {
                object,
                name,
                optional,
            } => {
                object.write_js(out);
                out.push_str(if *optional { "?." } else { "." });
                out.push_str(name);
            }
            Self::Index {
                object,
                index,
                optional,
            } => {
                object.write_js(out);
                out.push_str(if *optional { "?.[" } else { "[" });
                index.write_js(out);
                out.push(']');
            }
            Self::Call {
                function,
                arguments,
            } => {
                out.push_str(function);
                out.push('(');
                for (position, argument) in arguments.iter().enumerate() {
                    if position > 0 {
                        out.push_str(", ");
                    }
                    argument.write_js(out);
                }
                out.push(')');
            }
            Self::Unary(op, operand) => {
                out.push('(');
                out.push(match op {
                    UnaryOp::Not => '!',
                    UnaryOp::Negate => '-',
                    UnaryOp::Plus => '+',
                });
                operand.write_js(out);
                out.push(')');
            }
            Self::Binary(op, left, right) => {
                out.push('(');
                left.write_js(out);
                out.push(' ');
                out.push_str(op.as_str());
                out.push(' ');
                right.write_js(out);
                out.push(')');
            }
            Self::Conditional(test, then, otherwise) => {
                out.push('(');
                test.write_js(out);
                out.push_str(" ? ");
                then.write_js(out);
                out.push_str(" : ");
                otherwise.write_js(out);
                out.push(')');
            }
            Self::Array(items) => {
                out.push('[');
                for (position, item) in items.iter().enumerate() {
                    if position > 0 {
                        out.push_str(", ");
                    }
                    item.write_js(out);
                }
                out.push(']');
            }
            Self::Object(entries) => {
                out.push_str("({");
                for (position, (key, value)) in entries.iter().enumerate() {
                    if position > 0 {
                        out.push_str(", ");
                    }
                    out.push_str(&serde_json::Value::from(key.as_str()).to_string());
                    out.push_str(": ");
                    value.write_js(out);
                }
                out.push_str("})");
            }
        }
    }
}

/// Shortest decimal text that JavaScript reads back as the same number.
fn number_text(value: f64) -> String {
    // Rust prints the shortest round-trip decimal without an exponent,
    // which JavaScript parses to the same double.
    format!("{value}")
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
    depth: u64,
    /// The source continues past `bytes`: running out means too long.
    truncated: bool,
    /// Offset of `bytes` in the caller's text, for error positions.
    base: usize,
}

type Parsed = Result<Expr, ExprError>;

impl Parser<'_> {
    fn error(&self, kind: ExprErrorKind) -> ExprError {
        ExprError {
            kind,
            offset: self.base + self.position,
        }
    }

    fn error_here(&self) -> ExprError {
        if self.position >= self.bytes.len() && self.truncated {
            self.error(ExprErrorKind::TooLong)
        } else {
            self.error(ExprErrorKind::Syntax)
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn peek_at(&self, offset: usize) -> Option<u8> {
        self.bytes
            .get(self.position.saturating_add(offset))
            .copied()
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.position += 1;
        }
    }

    /// Consumes `token` after optional space when it is next and is not the
    /// prefix of a longer operator listed in `longer`.
    fn eat(&mut self, token: &str, longer: &[&str]) -> bool {
        self.skip_space();
        let rest = self.bytes.get(self.position..).unwrap_or_default();
        if rest.starts_with(token.as_bytes())
            && !longer
                .iter()
                .any(|other| rest.starts_with(other.as_bytes()))
        {
            self.position += token.len();
            true
        } else {
            false
        }
    }

    /// Operator chains such as `a + b + c` nest the tree without nesting the
    /// parser; the whole tree is held to `MAX_EXPRESSION_DEPTH` so that every
    /// later walk, and the drop, recurses a bounded number of times.
    fn check_tree(&self, expr: &Expr) -> Result<(), ExprError> {
        let mut stack = vec![(expr, 1u64)];
        while let Some((node, depth)) = stack.pop() {
            if depth > MAX_EXPRESSION_DEPTH.value {
                return Err(self.error(ExprErrorKind::TooDeep));
            }
            node.for_each_child(|child| stack.push((child, depth + 1)));
        }
        Ok(())
    }

    /// Parser recursion. `MAX_EXPRESSION_DEPTH` bounds the tree; the parser
    /// may recurse up to three times per tree level (an object literal
    /// printed by [`Expr::to_js`] is `({"k": v})`), so that the canonical
    /// text of every accepted expression parses again.
    fn enter(&mut self) -> Result<(), ExprError> {
        self.depth += 1;
        if self.depth > PARSER_DEPTH {
            return Err(self.error(ExprErrorKind::TooDeep));
        }
        Ok(())
    }

    fn expression(&mut self) -> Parsed {
        self.enter()?;
        let test = self.short_circuit()?;
        let result = if self.eat("?", &["??", "?."]) {
            let then = self.expression()?;
            if !self.eat(":", &[]) {
                return Err(self.error_here());
            }
            let otherwise = self.expression()?;
            Expr::Conditional(Box::new(test), Box::new(then), Box::new(otherwise))
        } else {
            test
        };
        self.depth -= 1;
        Ok(result)
    }

    /// `||`, `&&` and `??`. As in JavaScript, `??` cannot be mixed with the
    /// other two without parentheses.
    fn short_circuit(&mut self) -> Parsed {
        let first = self.equality()?;
        if self.eat("??", &[]) {
            let mut left = first;
            loop {
                let right = self.equality()?;
                left = Expr::Binary(BinaryOp::Coalesce, Box::new(left), Box::new(right));
                if !self.eat("??", &[]) {
                    break;
                }
            }
            if self.eat("||", &[]) || self.eat("&&", &[]) {
                return Err(self.error(ExprErrorKind::Syntax));
            }
            return Ok(left);
        }
        let mut left = self.and_chain(first)?;
        while self.eat("||", &[]) {
            let operand = self.equality()?;
            let right = self.and_chain(operand)?;
            left = Expr::Binary(BinaryOp::Or, Box::new(left), Box::new(right));
        }
        if self.eat("??", &[]) {
            return Err(self.error(ExprErrorKind::Syntax));
        }
        Ok(left)
    }

    fn and_chain(&mut self, first: Expr) -> Parsed {
        let mut left = first;
        while self.eat("&&", &[]) {
            let right = self.equality()?;
            left = Expr::Binary(BinaryOp::And, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn equality(&mut self) -> Parsed {
        let mut left = self.relational()?;
        loop {
            let op = if self.eat("===", &[]) {
                BinaryOp::StrictEqual
            } else if self.eat("!==", &[]) {
                BinaryOp::StrictNotEqual
            } else if self.eat("==", &[]) {
                BinaryOp::Equal
            } else if self.eat("!=", &[]) {
                BinaryOp::NotEqual
            } else {
                return Ok(left);
            };
            let right = self.relational()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn relational(&mut self) -> Parsed {
        let mut left = self.additive()?;
        loop {
            let op = if self.eat("<=", &[]) {
                BinaryOp::LessEqual
            } else if self.eat(">=", &[]) {
                BinaryOp::GreaterEqual
            } else if self.eat("<", &["<<"]) {
                BinaryOp::Less
            } else if self.eat(">", &[">>"]) {
                BinaryOp::Greater
            } else {
                return Ok(left);
            };
            let right = self.additive()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn additive(&mut self) -> Parsed {
        let mut left = self.multiplicative()?;
        loop {
            let op = if self.eat("+", &["++", "+="]) {
                BinaryOp::Add
            } else if self.eat("-", &["--", "-="]) {
                BinaryOp::Subtract
            } else {
                return Ok(left);
            };
            let right = self.multiplicative()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn multiplicative(&mut self) -> Parsed {
        let mut left = self.unary()?;
        loop {
            let op = if self.eat("*", &["**", "*="]) {
                BinaryOp::Multiply
            } else if self.eat("/", &["/=", "//", "/*"]) {
                BinaryOp::Divide
            } else if self.eat("%", &["%="]) {
                BinaryOp::Remainder
            } else {
                return Ok(left);
            };
            let right = self.unary()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn unary(&mut self) -> Parsed {
        let op = if self.eat("!", &["!="]) {
            UnaryOp::Not
        } else if self.eat("-", &["--", "-="]) {
            UnaryOp::Negate
        } else if self.eat("+", &["++", "+="]) {
            UnaryOp::Plus
        } else {
            return self.postfix();
        };
        self.enter()?;
        let operand = self.unary()?;
        self.depth -= 1;
        Ok(Expr::Unary(op, Box::new(operand)))
    }

    fn postfix(&mut self) -> Parsed {
        let mut expr = self.primary()?;
        // Only a bare name can be called: no method calls, no calls of results.
        let callable = matches!(expr, Expr::Name(_));
        if callable && self.eat("(", &[]) {
            let Expr::Name(function) = expr else {
                return Err(self.error(ExprErrorKind::Syntax));
            };
            let arguments = self.list(b')')?;
            expr = Expr::Call {
                function,
                arguments,
            };
        }
        loop {
            let optional = if self.eat("?.", &[]) {
                true
            } else if self.eat(".", &[]) {
                false
            } else if self.eat("[", &[]) {
                self.enter()?;
                let index = self.expression()?;
                self.depth -= 1;
                if !self.eat("]", &[]) {
                    return Err(self.error_here());
                }
                expr = Expr::Index {
                    object: Box::new(expr),
                    index: Box::new(index),
                    optional: false,
                };
                continue;
            } else {
                break;
            };
            self.skip_space();
            if optional && self.eat("[", &[]) {
                self.enter()?;
                let index = self.expression()?;
                self.depth -= 1;
                if !self.eat("]", &[]) {
                    return Err(self.error_here());
                }
                expr = Expr::Index {
                    object: Box::new(expr),
                    index: Box::new(index),
                    optional: true,
                };
            } else {
                let name = self.identifier()?;
                expr = Expr::Member {
                    object: Box::new(expr),
                    name,
                    optional,
                };
            }
        }
        self.skip_space();
        if self.peek() == Some(b'(') {
            // A call of anything but a bare name.
            return Err(self.error(ExprErrorKind::Syntax));
        }
        Ok(expr)
    }

    fn primary(&mut self) -> Parsed {
        self.skip_space();
        match self.peek() {
            Some(b'(') => {
                self.position += 1;
                let expr = self.expression()?;
                if !self.eat(")", &[]) {
                    return Err(self.error_here());
                }
                Ok(expr)
            }
            Some(b'[') => {
                self.position += 1;
                self.enter()?;
                let items = self.list(b']')?;
                self.depth -= 1;
                Ok(Expr::Array(items))
            }
            Some(b'{') => {
                self.position += 1;
                self.enter()?;
                let object = self.object()?;
                self.depth -= 1;
                Ok(object)
            }
            Some(b'"' | b'\'') => self.string().map(Expr::String),
            Some(byte) if byte.is_ascii_digit() => self.number(),
            Some(byte) if byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$' => {
                let start = self.position;
                let word = self.word();
                match word {
                    "true" => Ok(Expr::Bool(true)),
                    "false" => Ok(Expr::Bool(false)),
                    "null" => Ok(Expr::Null),
                    _ if valid_name(word) => Ok(Expr::Name(word.to_owned())),
                    _ => {
                        self.position = start;
                        Err(self.error(ExprErrorKind::ReservedName))
                    }
                }
            }
            _ => Err(self.error_here()),
        }
    }

    /// Comma-separated expressions up to `close`, without trailing comma.
    fn list(&mut self, close: u8) -> Result<Vec<Expr>, ExprError> {
        let mut items = Vec::new();
        self.skip_space();
        if self.peek() == Some(close) {
            self.position += 1;
            return Ok(items);
        }
        loop {
            if items.len() as u64 >= MAX_CALL_ARGUMENTS.value {
                return Err(self.error(ExprErrorKind::TooManyEntries));
            }
            items.push(self.expression()?);
            self.skip_space();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(byte) if byte == close => {
                    self.position += 1;
                    return Ok(items);
                }
                _ => return Err(self.error_here()),
            }
        }
    }

    fn object(&mut self) -> Parsed {
        let mut entries: Vec<(String, Expr)> = Vec::new();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.position += 1;
            return Ok(Expr::Object(entries));
        }
        loop {
            if entries.len() as u64 >= MAX_CALL_ARGUMENTS.value {
                return Err(self.error(ExprErrorKind::TooManyEntries));
            }
            self.skip_space();
            let key_start = self.position;
            let key = match self.peek() {
                Some(b'"' | b'\'') => self.string()?,
                _ => self.identifier()?,
            };
            // `__proto__` as a key sets the prototype; duplicates are ambiguous.
            if key.starts_with("__") || entries.iter().any(|(existing, _)| *existing == key) {
                self.position = key_start;
                return Err(self.error(ExprErrorKind::ReservedName));
            }
            if !self.eat(":", &[]) {
                return Err(self.error_here());
            }
            let value = self.expression()?;
            entries.push((key, value));
            self.skip_space();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(b'}') => {
                    self.position += 1;
                    return Ok(Expr::Object(entries));
                }
                _ => return Err(self.error_here()),
            }
        }
    }

    fn word(&mut self) -> &str {
        let start = self.position;
        while self
            .peek()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$')
        {
            self.position += 1;
        }
        // ASCII only, so the slice is valid UTF-8.
        std::str::from_utf8(self.bytes.get(start..self.position).unwrap_or_default())
            .unwrap_or_default()
    }

    fn identifier(&mut self) -> Result<String, ExprError> {
        self.skip_space();
        let start = self.position;
        if !self
            .peek()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$')
        {
            return Err(self.error_here());
        }
        let word = self.word().to_owned();
        if !valid_name(&word) {
            self.position = start;
            return Err(self.error(ExprErrorKind::ReservedName));
        }
        Ok(word)
    }

    /// `0`, or digits without a leading zero, with an optional fraction. No
    /// exponent, hexadecimal, octal, separator or suffix.
    fn number(&mut self) -> Parsed {
        let start = self.position;
        let digits = |parser: &mut Self| {
            let from = parser.position;
            while parser.peek().is_some_and(|byte| byte.is_ascii_digit()) {
                parser.position += 1;
            }
            parser.position - from
        };
        let integer = digits(self);
        if integer > 1 && self.bytes.get(start) == Some(&b'0') {
            self.position = start;
            return Err(self.error(ExprErrorKind::Syntax));
        }
        if self.peek() == Some(b'.') && self.peek_at(1).is_some_and(|byte| byte.is_ascii_digit()) {
            self.position += 1;
            digits(self);
        }
        if self.peek().is_some_and(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte == b'.'
        }) {
            return Err(self.error(ExprErrorKind::Syntax));
        }
        let text = std::str::from_utf8(self.bytes.get(start..self.position).unwrap_or_default())
            .unwrap_or_default();
        match text.parse::<f64>() {
            Ok(value) if value.is_finite() => Ok(Expr::Number(value)),
            _ => {
                self.position = start;
                Err(self.error(ExprErrorKind::Syntax))
            }
        }
    }

    /// A single- or double-quoted string on one line. Escapes: `\\`, `\'`,
    /// `\"`, `\n`, `\r`, `\t` and `\uXXXX` outside the surrogate range.
    fn string(&mut self) -> Result<String, ExprError> {
        let quote = self.peek().unwrap_or(b'"');
        self.position += 1;
        let mut out = Vec::new();
        loop {
            let Some(byte) = self.peek() else {
                return Err(self.error_here());
            };
            self.position += 1;
            match byte {
                _ if byte == quote => break,
                b'\\' => {
                    let Some(escape) = self.peek() else {
                        return Err(self.error_here());
                    };
                    self.position += 1;
                    match escape {
                        b'\\' | b'\'' | b'"' => out.push(escape),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let hex = self
                                .bytes
                                .get(self.position..self.position.saturating_add(4))
                                .filter(|hex| hex.iter().all(u8::is_ascii_hexdigit))
                                .ok_or_else(|| self.error(ExprErrorKind::Syntax))?;
                            let code = hex.iter().fold(0u32, |code, digit| {
                                code * 16 + char::from(*digit).to_digit(16).unwrap_or(0)
                            });
                            let character = char::from_u32(code)
                                .filter(|character| *character != '\0')
                                .ok_or_else(|| self.error(ExprErrorKind::Syntax))?;
                            self.position += 4;
                            let mut buffer = [0; 4];
                            out.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
                        }
                        _ => return Err(self.error(ExprErrorKind::Syntax)),
                    }
                }
                // Raw line breaks, NUL and other controls are rejected.
                _ if byte < 0x20 || byte == 0x7f => {
                    return Err(self.error(ExprErrorKind::Syntax));
                }
                _ => out.push(byte),
            }
        }
        String::from_utf8(out).map_err(|_| self.error(ExprErrorKind::Syntax))
    }
}
