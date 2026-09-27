//! The closed `style.ocss` subset: properties, value grammars, selectors and
//! cascade rules. Anything absent from these tables is rejected.

use crate::limits::{MAX_GRADIENT_STOPS, MAX_GRID_TRACKS, MAX_SHADOWS, MAX_TRANSITIONS};
use crate::model::Limit;

/// Grammar of a property value. Every length is bounded by `MAX_LENGTH_PX`,
/// every duration by `MAX_ANIMATION_MS`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StyleValue {
    Keywords(&'static [&'static str]),
    /// `<px>`, optionally `<percent>`, a keyword such as `auto`, and negative values.
    Length {
        percent: bool,
        keyword: Option<&'static str>,
        negative: bool,
    },
    /// One to four lengths in CSS side order (top, right, bottom, left).
    Sides {
        percent: bool,
        auto: bool,
        negative: bool,
    },
    /// One to four radii in CSS corner order.
    Corners,
    /// One or two lengths: row then column gap.
    Gap,
    Number {
        min: f64,
        max: f64,
    },
    Integer {
        min: i64,
        max: i64,
    },
    Color,
    FontFamily,
    FontSize,
    LineHeight,
    /// `<color>` or one `linear-gradient()` with bounded stops.
    Background(&'static Limit),
    /// `<width> <style>? <color>?`.
    Border,
    Shadow(&'static Limit),
    Transform,
    TransformOrigin,
    GridTracks(&'static Limit),
    GridTrack,
    GridPlacement,
    Transition(&'static Limit),
    Animation(&'static Limit),
}

impl StyleValue {
    pub fn syntax(&self) -> String {
        match self {
            Self::Keywords(values) => values
                .iter()
                .map(|value| format!("`{value}`"))
                .collect::<Vec<_>>()
                .join(" \\| "),
            Self::Length {
                percent,
                keyword,
                negative,
            } => {
                let mut syntax = String::from("`<px>`");
                if *percent {
                    syntax.push_str(" \\| `<percent>`");
                }
                if let Some(keyword) = keyword {
                    syntax.push_str(&format!(" \\| `{keyword}`"));
                }
                if *negative {
                    syntax.push_str(", negative allowed");
                }
                syntax
            }
            Self::Sides {
                percent,
                auto,
                negative,
            } => {
                let mut syntax = String::from("1–4 × (`<px>`");
                if *percent {
                    syntax.push_str(" \\| `<percent>`");
                }
                if *auto {
                    syntax.push_str(" \\| `auto`");
                }
                syntax.push(')');
                if *negative {
                    syntax.push_str(", negative allowed");
                }
                syntax
            }
            Self::Corners => "1–4 × (`<px>` \\| `<percent>`)".into(),
            Self::Gap => "1–2 × (`<px>` \\| `<percent>`)".into(),
            Self::Number { min, max } => format!("number {min}..={max}"),
            Self::Integer { min, max } => format!("integer {min}..={max}"),
            Self::Color => "`<color>`".into(),
            Self::FontFamily => "`ui` \\| `mono` \\| `display`, or a font token".into(),
            Self::FontSize => {
                "`<px>` within `MIN_FONT_SIZE_PX`..=`MAX_FONT_SIZE_PX`, or a size token".into()
            }
            Self::LineHeight => "number 0.5..=4 (× font size) \\| `<px>`".into(),
            Self::Background(limit) => format!(
                "`<color>` \\| `linear-gradient(<angle>?, <color> <percent>?, …)`, stops ≤ `{}`",
                limit.key
            ),
            Self::Border => "`<px>` (`solid` \\| `none`)? `<color>`?".into(),
            Self::Shadow(limit) => format!(
                "`none` \\| list ≤ `{}` of `inset`? `<px> <px> <px>? <px>? <color>`",
                limit.key
            ),
            Self::Transform => {
                "`none` \\| up to 4 of `translate(<length>, <length>)` with `<px>` or `<percent>`, `translateX()`, `translateY()`, `scale(<number>{1,2})` 0..=8, `rotate(<angle>)`"
                    .into()
            }
            Self::TransformOrigin => {
                "1–2 × (`left` \\| `center` \\| `right` \\| `top` \\| `bottom` \\| `<percent>` \\| `<px>`)"
                    .into()
            }
            Self::GridTracks(limit) => format!(
                "`none` \\| list ≤ `{}` of `<track>`, or `repeat(<integer>, <track>)`",
                limit.key
            ),
            Self::GridTrack => {
                "`<track>`: `<px>` \\| `<percent>` \\| `<fr>` \\| `auto` \\| `min-content` \\| `max-content` \\| `minmax(<track>, <track>)`"
                    .into()
            }
            Self::GridPlacement => {
                "`auto` \\| `<integer>` \\| `span <integer>` \\| `<start> / <end>` (1..=24)".into()
            }
            Self::Transition(limit) => format!(
                "`none` \\| list ≤ `{}` of `<animatable-property> <time> <easing>? <time>?`",
                limit.key
            ),
            Self::Animation(limit) => format!(
                "`none` \\| list ≤ `{}` of `<keyframes-name> <time> <easing>? <time>? (<integer> \\| infinite)? <direction>? <fill-mode>?`",
                limit.key
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Property {
    pub name: &'static str,
    pub value: StyleValue,
    pub initial: &'static str,
    pub inherited: bool,
    /// Paint-only properties: animating them never reruns layout.
    pub animatable: bool,
    pub group: &'static str,
}

const fn prop(
    group: &'static str,
    name: &'static str,
    value: StyleValue,
    initial: &'static str,
) -> Property {
    Property {
        name,
        value,
        initial,
        inherited: false,
        animatable: false,
        group,
    }
}

const fn inherited(
    group: &'static str,
    name: &'static str,
    value: StyleValue,
    initial: &'static str,
) -> Property {
    Property {
        name,
        value,
        initial,
        inherited: true,
        animatable: false,
        group,
    }
}

const fn animatable(mut property: Property) -> Property {
    property.animatable = true;
    property
}

const LAYOUT: &str = "Layout";
const BOX: &str = "Box";
const VISUAL: &str = "Visual";
const TEXT: &str = "Text";
const MOTION: &str = "Motion";
const INTERACTION: &str = "Interaction";

const OFFSET: StyleValue = StyleValue::Length {
    percent: true,
    keyword: Some("auto"),
    negative: true,
};
const SIZE: StyleValue = StyleValue::Length {
    percent: true,
    keyword: Some("auto"),
    negative: false,
};
const MAX_SIZE: StyleValue = StyleValue::Length {
    percent: true,
    keyword: Some("none"),
    negative: false,
};
const GAP: StyleValue = StyleValue::Length {
    percent: true,
    keyword: None,
    negative: false,
};
const ALIGN: &[&str] = &["start", "end", "center", "baseline", "stretch"];
const DISTRIBUTE: &[&str] = &[
    "start",
    "end",
    "center",
    "stretch",
    "space-between",
    "space-around",
    "space-evenly",
];

pub const PROPERTIES: &[Property] = &[
    prop(
        LAYOUT,
        "display",
        StyleValue::Keywords(&["flex", "grid", "none"]),
        "flex",
    ),
    prop(
        LAYOUT,
        "position",
        StyleValue::Keywords(&["relative", "absolute"]),
        "relative",
    ),
    prop(LAYOUT, "top", OFFSET, "auto"),
    prop(LAYOUT, "right", OFFSET, "auto"),
    prop(LAYOUT, "bottom", OFFSET, "auto"),
    prop(LAYOUT, "left", OFFSET, "auto"),
    prop(
        LAYOUT,
        "flex-direction",
        StyleValue::Keywords(&["row", "column", "row-reverse", "column-reverse"]),
        "row",
    ),
    prop(
        LAYOUT,
        "flex-wrap",
        StyleValue::Keywords(&["nowrap", "wrap"]),
        "nowrap",
    ),
    prop(
        LAYOUT,
        "flex-grow",
        StyleValue::Number {
            min: 0.0,
            max: 1000.0,
        },
        "0",
    ),
    prop(
        LAYOUT,
        "flex-shrink",
        StyleValue::Number {
            min: 0.0,
            max: 1000.0,
        },
        "1",
    ),
    prop(LAYOUT, "flex-basis", SIZE, "auto"),
    prop(
        LAYOUT,
        "justify-content",
        StyleValue::Keywords(DISTRIBUTE),
        "start",
    ),
    prop(
        LAYOUT,
        "align-items",
        StyleValue::Keywords(ALIGN),
        "stretch",
    ),
    prop(
        LAYOUT,
        "align-self",
        StyleValue::Keywords(&["auto", "start", "end", "center", "baseline", "stretch"]),
        "auto",
    ),
    prop(
        LAYOUT,
        "align-content",
        StyleValue::Keywords(DISTRIBUTE),
        "stretch",
    ),
    prop(
        LAYOUT,
        "justify-items",
        StyleValue::Keywords(&["start", "end", "center", "stretch"]),
        "stretch",
    ),
    prop(
        LAYOUT,
        "justify-self",
        StyleValue::Keywords(&["auto", "start", "end", "center", "stretch"]),
        "auto",
    ),
    prop(LAYOUT, "gap", StyleValue::Gap, "0"),
    prop(LAYOUT, "row-gap", GAP, "0"),
    prop(LAYOUT, "column-gap", GAP, "0"),
    prop(
        LAYOUT,
        "grid-template-columns",
        StyleValue::GridTracks(&MAX_GRID_TRACKS),
        "none",
    ),
    prop(
        LAYOUT,
        "grid-template-rows",
        StyleValue::GridTracks(&MAX_GRID_TRACKS),
        "none",
    ),
    prop(
        LAYOUT,
        "grid-auto-flow",
        StyleValue::Keywords(&["row", "column"]),
        "row",
    ),
    prop(LAYOUT, "grid-auto-columns", StyleValue::GridTrack, "auto"),
    prop(LAYOUT, "grid-auto-rows", StyleValue::GridTrack, "auto"),
    prop(LAYOUT, "grid-column", StyleValue::GridPlacement, "auto"),
    prop(LAYOUT, "grid-row", StyleValue::GridPlacement, "auto"),
    prop(BOX, "width", SIZE, "auto"),
    prop(BOX, "height", SIZE, "auto"),
    prop(BOX, "min-width", SIZE, "auto"),
    prop(BOX, "min-height", SIZE, "auto"),
    prop(BOX, "max-width", MAX_SIZE, "none"),
    prop(BOX, "max-height", MAX_SIZE, "none"),
    prop(
        BOX,
        "aspect-ratio",
        StyleValue::Number {
            min: 0.01,
            max: 100.0,
        },
        "auto",
    ),
    prop(
        BOX,
        "margin",
        StyleValue::Sides {
            percent: true,
            auto: true,
            negative: true,
        },
        "0",
    ),
    prop(BOX, "margin-top", OFFSET, "0"),
    prop(BOX, "margin-right", OFFSET, "0"),
    prop(BOX, "margin-bottom", OFFSET, "0"),
    prop(BOX, "margin-left", OFFSET, "0"),
    prop(
        BOX,
        "padding",
        StyleValue::Sides {
            percent: true,
            auto: false,
            negative: false,
        },
        "0",
    ),
    prop(BOX, "padding-top", GAP, "0"),
    prop(BOX, "padding-right", GAP, "0"),
    prop(BOX, "padding-bottom", GAP, "0"),
    prop(BOX, "padding-left", GAP, "0"),
    prop(
        BOX,
        "overflow",
        StyleValue::Keywords(&["visible", "hidden"]),
        "visible",
    ),
    animatable(prop(
        VISUAL,
        "background-color",
        StyleValue::Color,
        "transparent",
    )),
    prop(
        VISUAL,
        "background",
        StyleValue::Background(&MAX_GRADIENT_STOPS),
        "transparent",
    ),
    prop(VISUAL, "border", StyleValue::Border, "0 none"),
    prop(VISUAL, "border-top", StyleValue::Border, "0 none"),
    prop(VISUAL, "border-right", StyleValue::Border, "0 none"),
    prop(VISUAL, "border-bottom", StyleValue::Border, "0 none"),
    prop(VISUAL, "border-left", StyleValue::Border, "0 none"),
    prop(
        VISUAL,
        "border-width",
        StyleValue::Sides {
            percent: false,
            auto: false,
            negative: false,
        },
        "0",
    ),
    prop(
        VISUAL,
        "border-style",
        StyleValue::Keywords(&["solid", "none"]),
        "none",
    ),
    animatable(prop(
        VISUAL,
        "border-color",
        StyleValue::Color,
        "currentColor",
    )),
    prop(VISUAL, "border-radius", StyleValue::Corners, "0"),
    prop(
        VISUAL,
        "box-shadow",
        StyleValue::Shadow(&MAX_SHADOWS),
        "none",
    ),
    animatable(prop(
        VISUAL,
        "opacity",
        StyleValue::Number { min: 0.0, max: 1.0 },
        "1",
    )),
    inherited(
        VISUAL,
        "visibility",
        StyleValue::Keywords(&["visible", "hidden"]),
        "visible",
    ),
    prop(
        VISUAL,
        "object-fit",
        StyleValue::Keywords(&["contain", "cover", "fill", "none"]),
        "contain",
    ),
    animatable(inherited(
        TEXT,
        "color",
        StyleValue::Color,
        "var(--color-text)",
    )),
    inherited(TEXT, "font-family", StyleValue::FontFamily, "ui"),
    inherited(
        TEXT,
        "font-size",
        StyleValue::FontSize,
        "var(--font-size-body)",
    ),
    inherited(
        TEXT,
        "font-weight",
        StyleValue::Keywords(&["400", "500", "600", "700", "normal", "bold"]),
        "400",
    ),
    inherited(
        TEXT,
        "font-style",
        StyleValue::Keywords(&["normal", "italic"]),
        "normal",
    ),
    inherited(
        TEXT,
        "font-variant-numeric",
        StyleValue::Keywords(&["normal", "tabular-nums"]),
        "normal",
    ),
    inherited(TEXT, "line-height", StyleValue::LineHeight, "1.3"),
    inherited(
        TEXT,
        "letter-spacing",
        StyleValue::Length {
            percent: false,
            keyword: None,
            negative: true,
        },
        "0",
    ),
    inherited(
        TEXT,
        "text-align",
        StyleValue::Keywords(&["start", "center", "end"]),
        "start",
    ),
    prop(
        TEXT,
        "text-decoration",
        StyleValue::Keywords(&["none", "underline", "line-through"]),
        "none",
    ),
    inherited(
        TEXT,
        "text-transform",
        StyleValue::Keywords(&["none", "uppercase", "lowercase", "capitalize"]),
        "none",
    ),
    inherited(
        TEXT,
        "white-space",
        StyleValue::Keywords(&["normal", "nowrap", "pre-wrap"]),
        "normal",
    ),
    prop(
        TEXT,
        "text-overflow",
        StyleValue::Keywords(&["clip", "ellipsis", "marquee"]),
        "clip",
    ),
    prop(
        TEXT,
        "line-clamp",
        StyleValue::Integer { min: 0, max: 64 },
        "0",
    ),
    inherited(
        TEXT,
        "overflow-wrap",
        StyleValue::Keywords(&["normal", "anywhere"]),
        "normal",
    ),
    animatable(prop(MOTION, "transform", StyleValue::Transform, "none")),
    prop(
        MOTION,
        "transform-origin",
        StyleValue::TransformOrigin,
        "center",
    ),
    prop(
        MOTION,
        "transition",
        StyleValue::Transition(&MAX_TRANSITIONS),
        "none",
    ),
    prop(
        MOTION,
        "animation",
        StyleValue::Animation(&MAX_TRANSITIONS),
        "none",
    ),
    inherited(
        INTERACTION,
        "cursor",
        StyleValue::Keywords(&[
            "default",
            "pointer",
            "text",
            "not-allowed",
            "grab",
            "grabbing",
        ]),
        "default",
    ),
    prop(
        INTERACTION,
        "pointer-events",
        StyleValue::Keywords(&["auto", "none"]),
        "auto",
    ),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SyntaxEntry {
    pub syntax: &'static str,
    pub summary: &'static str,
}

pub const SELECTORS: &[SyntaxEntry] = &[
    SyntaxEntry {
        syntax: "text",
        summary: "Element type; specificity (0, 1).",
    },
    SyntaxEntry {
        syntax: ".name",
        summary: "Class; specificity (1, 0).",
    },
    SyntaxEntry {
        syntax: ":hover :active :focus :disabled :checked",
        summary: "State resolved by the host; specificity (1, 0). `:checked` applies to `toggle` and `checkbox`.",
    },
    SyntaxEntry {
        syntax: "a b",
        summary: "Descendant combinator.",
    },
    SyntaxEntry {
        syntax: "a > b",
        summary: "Child combinator.",
    },
    SyntaxEntry {
        syntax: "a, b",
        summary: "Selector list; each selector keeps its own specificity.",
    },
];

pub const PSEUDO_CLASSES: &[&str] = &["hover", "active", "focus", "disabled", "checked"];

pub const VALUE_SYNTAX: &[SyntaxEntry] = &[
    SyntaxEntry {
        syntax: "<px>",
        summary: "`12px`; `0` may omit the unit. Decimal numbers, no exponent.",
    },
    SyntaxEntry {
        syntax: "<percent>",
        summary: "`50%` of the containing block, as in CSS.",
    },
    SyntaxEntry {
        syntax: "<fr>",
        summary: "`1fr`, grid tracks only.",
    },
    SyntaxEntry {
        syntax: "<time>",
        summary: "`120ms` or `0.12s`, 0..=`MAX_ANIMATION_MS`.",
    },
    SyntaxEntry {
        syntax: "<angle>",
        summary: "`4deg` or `0.5turn`.",
    },
    SyntaxEntry {
        syntax: "<color>",
        summary: "`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b)`, `rgb(r g b / a)`, `transparent`, `currentColor`, or a colour token. No named colours.",
    },
    SyntaxEntry {
        syntax: "var(--token)",
        summary: "Design-system token of the expected type, as a whole value or a component of a composite value. No fallback argument; widgets cannot declare custom properties.",
    },
    SyntaxEntry {
        syntax: "<easing>",
        summary: "`linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(<integer 1..=60>)`.",
    },
    SyntaxEntry {
        syntax: "<direction>",
        summary: "`normal`, `reverse`, `alternate`.",
    },
    SyntaxEntry {
        syntax: "<fill-mode>",
        summary: "`none`, `forwards`, `backwards`, `both`.",
    },
];

pub const SHEET_RULES: &[SyntaxEntry] = &[
    SyntaxEntry {
        syntax: "cascade",
        summary: "Higher specificity wins; equal specificity resolves by source order. Inherited properties take the parent's computed value when unset.",
    },
    SyntaxEntry {
        syntax: "@keyframes name { from { … } 50% { … } to { … } }",
        summary: "The only at-rule. Stops hold only animatable properties.",
    },
    SyntaxEntry {
        syntax: "/* comment */",
        summary: "Comments are allowed and ignored.",
    },
    SyntaxEntry {
        syntax: "rejected",
        summary: "`!important`, `@media`, `@import`, `@font-face`, `url()`, `calc()`, custom property declarations, attribute and ID selectors, `*`, sibling combinators, unknown properties or values. Any of them rejects the whole sheet.",
    },
];

pub fn property(name: &str) -> Option<&'static Property> {
    PROPERTIES.iter().find(|property| property.name == name)
}
