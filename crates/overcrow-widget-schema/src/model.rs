//! Types shared by every schema table. Tables are `const` data so that the
//! host, the CLI and the Studio compile exactly the same definitions.

/// Whether a schema entry is final for v1 or awaits the evidence of a lot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Fixed,
    /// The value is a safe placeholder until the named lot (for example
    /// `P0.6`) records measurements or an audit; it must
    /// be revisited there.
    Provisional {
        lot: &'static str,
    },
}

impl Status {
    pub const P1_3: Self = Self::Provisional { lot: "P1.3" };
    pub const P1_6: Self = Self::Provisional { lot: "P1.6" };
    pub const P1_7: Self = Self::Provisional { lot: "P1.7" };
    pub const P1_8: Self = Self::Provisional { lot: "P1.8" };
    pub const P2_4: Self = Self::Provisional { lot: "P2.4" };

    pub const fn is_fixed(self) -> bool {
        matches!(self, Self::Fixed)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Unit {
    Bytes,
    Count,
    Milliseconds,
    Days,
    /// Logical pixels at 100 % content scale.
    Pixels,
    Hertz,
    PerSecond,
    /// Thousandths; content scale uses 1000 for 100 %.
    Permille,
    /// Millionths of a whole.
    PartsPerMillion,
    /// Percentage of one CPU core.
    PercentOfCore,
    /// Colour channel levels out of 255.
    Levels,
    /// Unicode scalar values.
    Characters,
    /// Absolute numeric value.
    Magnitude,
}

impl Unit {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bytes => "bytes",
            Self::Count => "count",
            Self::Milliseconds => "ms",
            Self::Days => "days",
            Self::Pixels => "px",
            Self::Hertz => "Hz",
            Self::PerSecond => "per second",
            Self::Permille => "‰",
            Self::PartsPerMillion => "ppm",
            Self::PercentOfCore => "% of one core",
            Self::Levels => "levels of 255",
            Self::Characters => "characters",
            Self::Magnitude => "absolute value",
        }
    }
}

/// One numeric bound. Exceeding a maximum or undercutting a minimum fails
/// closed for the affected widget only.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limit {
    pub key: &'static str,
    pub value: u64,
    pub unit: Unit,
    pub status: Status,
    pub summary: &'static str,
}

/// Value accepted by an attribute, an IPC field or a service parameter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueType {
    Bool,
    /// UTF-8 text without NUL, bounded in bytes.
    Text(&'static Limit),
    /// UTF-8 text without NUL, bounded in Unicode scalar values.
    Chars(&'static Limit),
    /// ASCII `[a-z][a-z0-9-]*`, bounded in bytes.
    Identifier(&'static Limit),
    Integer {
        min: i64,
        max: i64,
    },
    /// Finite IEEE 754 number; NaN and infinities are rejected.
    Number {
        min: f64,
        max: f64,
    },
    Keyword(&'static [&'static str]),
    /// Positive integer below 2^53, so that it survives a JavaScript number.
    Id,
    /// Space-separated class identifiers.
    ClassList,
    /// Name of a Lucide icon bundled by the host.
    Icon,
    /// `assets/<path>` inside the package ledger, or `asset:<handle>` issued by
    /// a host service. Nothing else, and never a URL.
    ImageSource,
    /// Scene node ID of another node of the same widget.
    NodeRef,
    /// Subset of the events of the element.
    EventSet,
    NumberList(&'static Limit),
    /// A structure defined elsewhere in the schema.
    Record(&'static str),
    ListOf(&'static str, &'static Limit),
    /// Arbitrary JSON bounded by the enclosing message limit.
    Json,
}

impl ValueType {
    pub fn describe(&self) -> String {
        match self {
            Self::Bool => "boolean".into(),
            Self::Text(limit) | Self::Chars(limit) => format!("text ≤ `{}`", limit.key),
            Self::Identifier(limit) => format!("identifier ≤ `{}`", limit.key),
            Self::Integer { min, max } => format!("integer {min}..={max}"),
            Self::Number { min, max } => format!("number {min}..={max}"),
            Self::Keyword(values) => values
                .iter()
                .map(|value| format!("`{value}`"))
                .collect::<Vec<_>>()
                .join(" \\| "),
            Self::Id => "id".into(),
            Self::ClassList => "class list".into(),
            Self::Icon => "Lucide icon name".into(),
            Self::ImageSource => "image source".into(),
            Self::NodeRef => "node reference".into(),
            Self::EventSet => "event set".into(),
            Self::NumberList(limit) => format!("number list ≤ `{}`", limit.key),
            Self::Record(name) => format!("`{name}`"),
            Self::ListOf(name, limit) => format!("list of `{name}` ≤ `{}`", limit.key),
            Self::Json => "JSON".into(),
        }
    }
}

/// A named, typed field of an attribute set, a message or a service call.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Field {
    pub name: &'static str,
    pub ty: ValueType,
    pub required: bool,
    pub summary: &'static str,
}

impl Field {
    pub const fn required(name: &'static str, ty: ValueType, summary: &'static str) -> Self {
        Self {
            name,
            ty,
            required: true,
            summary,
        }
    }

    pub const fn optional(name: &'static str, ty: ValueType, summary: &'static str) -> Self {
        Self {
            name,
            ty,
            required: false,
            summary,
        }
    }
}
