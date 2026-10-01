//! Elements of `view.ocml` and of the retained scene, their attributes, the
//! events they can raise and the template constructs compiled by the CLI.

use crate::limits::{
    MAX_ATTRIBUTE_TEXT_BYTES, MAX_CHART_POINTS, MAX_FIELD_TEXT_BYTES, MAX_IDENTIFIER_BYTES,
    MAX_INITIALS_BYTES, MAX_KEY_BYTES, MAX_LABEL_BYTES, MAX_LENGTH_PX, MAX_WIDGET_EDGE_PX,
};
use crate::model::{Field, ValueType};
use crate::services::WRITE_INTENT_NAMES;

/// How a node's content is formed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Content {
    /// No children and no text.
    Empty,
    /// Text content only, set with `setText`.
    Text,
    /// Text flow: `span`, `icon` and `image` children laid out inline.
    Inline,
    /// Any element allowed in flow content.
    Flow,
    /// Only the listed elements.
    Only(&'static [&'static str]),
}

/// When the host puts a node in the focus order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Focus {
    Never,
    Always,
    /// Only while the node subscribes to `activate` or `keydown`.
    WhenSubscribed,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Element {
    pub name: &'static str,
    pub summary: &'static str,
    /// Accessibility role exposed through AccessKit.
    pub role: &'static str,
    pub content: Content,
    /// Required parent elements; empty means any element accepting flow content.
    pub parents: &'static [&'static str],
    pub focus: Focus,
    pub attributes: &'static [Field],
    pub events: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Event {
    pub name: &'static str,
    pub summary: &'static str,
    /// The event is a user gesture: it may authorize a gesture-bound service
    /// call made while the VM handles it.
    pub gesture: bool,
    pub detail: &'static [Field],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TemplateConstruct {
    pub syntax: &'static str,
    pub summary: &'static str,
}

const LABEL: ValueType = ValueType::Text(&MAX_LABEL_BYTES);
const ATTRIBUTE_TEXT: ValueType = ValueType::Text(&MAX_ATTRIBUTE_TEXT_BYTES);
const IDENTIFIER: ValueType = ValueType::Identifier(&MAX_IDENTIFIER_BYTES);
const AXIS: ValueType = ValueType::Keyword(&["vertical", "horizontal"]);
const NUMBER: ValueType = ValueType::Number {
    min: -1.0e9,
    max: 1.0e9,
};
const FIELD_TEXT: ValueType = ValueType::Text(&MAX_FIELD_TEXT_BYTES);
const FIELD_LENGTH: ValueType = ValueType::Integer {
    min: 1,
    max: MAX_FIELD_TEXT_BYTES.value as i64,
};
const POSITION: ValueType = ValueType::Integer {
    min: -(MAX_LENGTH_PX.value as i64),
    max: MAX_LENGTH_PX.value as i64,
};

/// Record name of an opaque `#rrggbb` colour attribute (`span.color`).
pub const OPAQUE_COLOR: &str = "opaque `#rrggbb`";

/// Accepted by every element.
pub const COMMON_ATTRIBUTES: &[Field] = &[
    Field::optional(
        "class",
        ValueType::ClassList,
        "Style classes; in a scene patch, one string of distinct classes separated by one space, as in the view.",
    ),
    Field::optional(
        "ref",
        ValueType::Ref,
        "Name by which `Draw.canvas` and node-reference attributes such as `popover.anchor` designate this node. Static, unique in the view, and not allowed inside a `for` or a component body, where it would name several nodes.",
    ),
    Field::optional(
        "label",
        LABEL,
        "Accessible name; required on icon-only controls.",
    ),
    Field::optional(
        "tooltip",
        LABEL,
        "Plain text drawn by the host on hover or focus.",
    ),
    Field::optional(
        "on",
        ValueType::EventSet,
        "Events forwarded to the VM; written `on:<event>` in the view.",
    ),
];

const DISABLED: Field = Field::optional(
    "disabled",
    ValueType::Bool,
    "Rejects input; matches `:disabled`.",
);
const POINTER_EVENTS: &[&str] = &["activate", "contextmenu", "wheel"];
const FOCUS_EVENTS: &[&str] = &[
    "activate",
    "contextmenu",
    "wheel",
    "keydown",
    "focus",
    "blur",
];
const FIELD_EVENTS: &[&str] = &[
    "input",
    "change",
    "submit",
    "keydown",
    "focus",
    "blur",
    "contextmenu",
];

pub const ELEMENTS: &[Element] = &[
    Element {
        name: "box",
        summary: "Generic container; flex or grid layout comes from style. The scene root (node 0) is a `box`.",
        role: "group",
        content: Content::Flow,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "scroll",
        summary: "Clipping container scrolled by the host with wheel, drag and keyboard.",
        role: "scroll-view",
        content: Content::Flow,
        parents: &[],
        focus: Focus::Never,
        attributes: &[
            Field::optional("axis", AXIS, "Scroll direction; default `vertical`."),
            Field::optional(
                "stick-to-end",
                ValueType::Bool,
                "Stay at the end while content grows, until the user scrolls away (chat).",
            ),
        ],
        events: &["reachend", "contextmenu"],
    },
    Element {
        name: "list",
        summary: "Vertical scrolling list whose children are laid out and painted only when visible.",
        role: "list",
        content: Content::Flow,
        parents: &[],
        focus: Focus::Never,
        attributes: &[
            Field::optional("stick-to-end", ValueType::Bool, "As for `scroll`."),
            Field::optional(
                "item-height",
                ValueType::Integer {
                    min: 1,
                    max: MAX_WIDGET_EDGE_PX.value as i64,
                },
                "Estimated child height used before a child is first measured.",
            ),
        ],
        events: &["reachend", "contextmenu"],
    },
    Element {
        name: "text",
        summary: "Block of wrapped text; its inline children flow with it (chat line with emotes).",
        role: "label",
        content: Content::Inline,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[Field::optional(
            "selectable",
            ValueType::Bool,
            "The user can select the text and copy it through the host; no widget permission involved.",
        )],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "span",
        summary: "Styled run of text inside `text`.",
        role: "label",
        content: Content::Text,
        parents: &["text"],
        focus: Focus::Never,
        attributes: &[Field::optional(
            "color",
            ValueType::Record(OPAQUE_COLOR),
            "Colour from data, such as a chat author's; overrides the style colour, and the host raises its contrast to at least 4.5:1 against the panel.",
        )],
        events: &[],
    },
    Element {
        name: "icon",
        summary: "Lucide icon tinted with `color`, sized by `font-size` unless `width`/`height` are set.",
        role: "image",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[Field::required(
            "name",
            ValueType::Icon,
            "Icon name, for example `circle-check`.",
        )],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "image",
        summary: "Raster image from the package or a host asset handle; `object-fit` applies.",
        role: "image",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[Field::required(
            "src",
            ValueType::ImageSource,
            "Image source.",
        )],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "avatar",
        summary: "Round image with a text fallback while the image is missing or failed.",
        role: "image",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[
            Field::optional("src", ValueType::ImageSource, "Image source."),
            Field::optional(
                "initials",
                ValueType::Text(&MAX_INITIALS_BYTES),
                "Fallback text.",
            ),
        ],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "badge",
        summary: "Short pill of text.",
        role: "label",
        content: Content::Text,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[],
        events: POINTER_EVENTS,
    },
    Element {
        name: "button",
        summary: "Activatable control; its children (icon, text) form its content.",
        role: "button",
        content: Content::Flow,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            DISABLED,
            Field::optional("submit", ValueType::Bool, "Submits the enclosing `form`."),
        ],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "toggle",
        summary: "On/off switch.",
        role: "switch",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::optional("checked", ValueType::Bool, "State; matches `:checked`."),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: &["change", "focus", "blur", "contextmenu"],
    },
    Element {
        name: "checkbox",
        summary: "Check control (checklists).",
        role: "check-box",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::optional("checked", ValueType::Bool, "State; matches `:checked`."),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: &["change", "focus", "blur", "contextmenu"],
    },
    Element {
        name: "slider",
        summary: "Numeric range control; dragging is resolved in the host.",
        role: "slider",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::required("min", NUMBER, "Lower bound."),
            Field::required("max", NUMBER, "Upper bound, greater than `min`."),
            Field::optional("step", NUMBER, "Positive increment; default 1."),
            Field::optional(
                "value",
                NUMBER,
                "Current value, clamped to the range; rejected on a slider bound to a write intent.",
            ),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: &["input", "change", "focus", "blur", "contextmenu"],
    },
    Element {
        name: "select",
        summary: "Drop-down choice; the open list is drawn by the host.",
        role: "combo-box",
        content: Content::Only(&["option"]),
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::optional("value", ATTRIBUTE_TEXT, "Selected option value."),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: &["change", "focus", "blur", "contextmenu"],
    },
    Element {
        name: "option",
        summary: "Choice of a `select`; its text is the visible label.",
        role: "list-box-option",
        content: Content::Text,
        parents: &["select"],
        focus: Focus::Never,
        attributes: &[
            Field::required("value", ATTRIBUTE_TEXT, "Value reported by `change`."),
            DISABLED,
        ],
        events: &[],
    },
    Element {
        name: "field",
        summary: "Single-line text input edited by the host, IME included.",
        role: "text-input",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::optional(
                "value",
                FIELD_TEXT,
                "Replaces the content; rejected on a field bound to a write intent.",
            ),
            Field::optional("placeholder", LABEL, "Hint shown while empty."),
            Field::optional(
                "max-length",
                FIELD_LENGTH,
                "Content limit in bytes; a write intent may impose a lower one.",
            ),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: FIELD_EVENTS,
    },
    Element {
        name: "textarea",
        summary: "Multi-line text input edited by the host, IME included.",
        role: "multiline-text-input",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Always,
        attributes: &[
            Field::optional("value", FIELD_TEXT, "As for `field`."),
            Field::optional("placeholder", LABEL, "Hint shown while empty."),
            Field::optional("max-length", FIELD_LENGTH, "As for `field`."),
            Field::optional(
                "rows",
                ValueType::Integer { min: 1, max: 40 },
                "Visible rows before scrolling; default 3.",
            ),
            DISABLED,
            Field::optional("name", IDENTIFIER, "Field name inside a `form`."),
        ],
        events: FIELD_EVENTS,
    },
    Element {
        name: "form",
        summary: "Groups named controls. With `intent`, submitting sends their values to a write service directly from the host; the VM never supplies that body.",
        role: "form",
        content: Content::Flow,
        parents: &[],
        focus: Focus::Never,
        attributes: &[
            Field::optional(
                "intent",
                ValueType::Keyword(WRITE_INTENT_NAMES),
                "Bound write intent.",
            ),
            Field::optional(
                "target",
                ATTRIBUTE_TEXT,
                "Opaque ID of the edited object (note, reply parent), checked by the service.",
            ),
        ],
        events: &["submit"],
    },
    Element {
        name: "elapsed",
        summary: "Duration text advanced by the host from a service anchor, so a running stopwatch needs no VM traffic. Styled like `text`; repainted only when the shown text changes, at most at `ANIMATION_RATE_HZ`, and never while hidden.",
        role: "timer",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[
            Field::required(
                "base",
                ValueType::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
                "Elapsed milliseconds at `at`.",
            ),
            Field::required(
                "at",
                ValueType::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
                "Host monotonic milliseconds from the service result.",
            ),
            Field::optional(
                "running",
                ValueType::Bool,
                "Advance from `at`; default `false`.",
            ),
            Field::required(
                "format",
                ValueType::Keyword(&["hh:mm:ss", "hh:mm:ss.cc", "mm:ss"]),
                "Hours grow past 99; `cc` are hundredths, truncated.",
            ),
        ],
        events: POINTER_EVENTS,
    },
    Element {
        name: "progress",
        summary: "Horizontal progress bar.",
        role: "progress-indicator",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[
            Field::required("value", NUMBER, "Current value."),
            Field::optional("max", NUMBER, "Positive upper bound; default 1."),
        ],
        events: POINTER_EVENTS,
    },
    Element {
        name: "gauge",
        summary: "Ring or arc gauge.",
        role: "meter",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[
            Field::required("value", NUMBER, "Current value."),
            Field::optional("max", NUMBER, "Positive upper bound; default 1."),
            Field::optional(
                "shape",
                ValueType::Keyword(&["ring", "arc"]),
                "Default `ring`.",
            ),
        ],
        events: POINTER_EVENTS,
    },
    Element {
        name: "chart",
        summary: "Line, area, bar or sparkline chart drawn by the host.",
        role: "figure",
        content: Content::Only(&["series"]),
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[
            Field::required(
                "kind",
                ValueType::Keyword(&["line", "area", "bar", "sparkline"]),
                "Chart type.",
            ),
            Field::optional("min", NUMBER, "Fixed lower bound of the value axis."),
            Field::optional("max", NUMBER, "Fixed upper bound of the value axis."),
        ],
        events: POINTER_EVENTS,
    },
    Element {
        name: "series",
        summary: "One data series of a `chart`, coloured with `color`.",
        role: "figure",
        content: Content::Empty,
        parents: &["chart"],
        focus: Focus::Never,
        attributes: &[Field::required(
            "values",
            ValueType::NumberList(&MAX_CHART_POINTS),
            "Values in order.",
        )],
        events: &[],
    },
    Element {
        name: "separator",
        summary: "Thin rule between groups.",
        role: "splitter",
        content: Content::Empty,
        parents: &[],
        focus: Focus::Never,
        attributes: &[Field::optional("axis", AXIS, "Default `horizontal`.")],
        events: &[],
    },
    Element {
        name: "canvas",
        summary: "Surface painted by the host from the widget's latest `Draw` command list.",
        role: "image",
        content: Content::Empty,
        parents: &[],
        focus: Focus::WhenSubscribed,
        attributes: &[],
        events: FOCUS_EVENTS,
    },
    Element {
        name: "popover",
        summary: "Floating panel anchored to a node, drawn above the content and clipped to the widget container (drop-downs, context menus).",
        role: "menu",
        content: Content::Flow,
        parents: &[],
        focus: Focus::Never,
        attributes: &[
            Field::required(
                "anchor",
                ValueType::RefName,
                "`ref` of the node the panel is placed against.",
            ),
            Field::optional(
                "open",
                ValueType::Bool,
                "Visibility; the host closes it and sends `dismiss`.",
            ),
            Field::optional(
                "placement",
                ValueType::Keyword(&["below", "above", "start", "end", "pointer"]),
                "Preferred side, or the last pointer position; default `below`.",
            ),
        ],
        events: &["dismiss"],
    },
];

const XY: &[Field] = &[
    Field::required("x", POSITION, "Pointer x relative to the node, logical px."),
    Field::required("y", POSITION, "Pointer y relative to the node, logical px."),
];

pub const EVENTS: &[Event] = &[
    Event {
        name: "activate",
        summary: "Primary click, or Enter/Space on the focused node.",
        gesture: true,
        detail: XY,
    },
    Event {
        name: "contextmenu",
        summary: "Secondary click, Menu key or Shift+F10.",
        gesture: true,
        detail: XY,
    },
    Event {
        name: "wheel",
        summary: "Wheel or touchpad scroll over a node that is not a scroll container.",
        gesture: false,
        detail: &[
            Field::required("dx", POSITION, "Horizontal delta, logical px."),
            Field::required("dy", POSITION, "Vertical delta, logical px."),
        ],
    },
    Event {
        name: "keydown",
        summary: "Key pressed while the node has focus in Interactive mode. Keys reserved by the host (Tab traversal, OverCrow shortcuts, IME composition) are never delivered.",
        gesture: true,
        detail: &[
            Field::required(
                "key",
                ValueType::Text(&MAX_KEY_BYTES),
                "One grapheme or a named key.",
            ),
            Field::required("ctrl", ValueType::Bool, "Control held."),
            Field::required("alt", ValueType::Bool, "Alt held."),
            Field::required("shift", ValueType::Bool, "Shift held."),
            Field::required("meta", ValueType::Bool, "Super/Windows held."),
            Field::required("repeat", ValueType::Bool, "Auto-repeat."),
        ],
    },
    Event {
        name: "input",
        summary: "Value edited (text, slider drag). Read-only copy; the host keeps the content.",
        gesture: true,
        detail: &[Field::required(
            "value",
            ValueType::Json,
            "Text or number, within the element bounds.",
        )],
    },
    Event {
        name: "change",
        summary: "Value committed: blur or Enter for text, release for a slider, any change for toggle, checkbox and select.",
        gesture: true,
        detail: &[Field::required(
            "value",
            ValueType::Json,
            "Text, number or boolean, within the element bounds.",
        )],
    },
    Event {
        name: "submit",
        summary: "Form submitted by Enter in a field, Ctrl+Enter in a `field` or `textarea`, or a `submit` button; a write intent may keep plain Enter for moving between its fields. With an intent, carries the service outcome.",
        gesture: true,
        detail: &[
            Field::required(
                "outcome",
                ValueType::Keyword(&["submitted", "accepted", "rejected", "cancelled"]),
                "`submitted` without intent; otherwise the outcome of the host service call.",
            ),
            Field::optional(
                "error",
                ValueType::Record("ServiceError"),
                "Failure code when rejected.",
            ),
        ],
    },
    Event {
        name: "focus",
        summary: "Node gained keyboard focus.",
        gesture: false,
        detail: &[],
    },
    Event {
        name: "blur",
        summary: "Node lost keyboard focus.",
        gesture: false,
        detail: &[],
    },
    Event {
        name: "reachend",
        summary: "Scrolled within one viewport of the end (load more, history).",
        gesture: false,
        detail: &[],
    },
    Event {
        name: "dismiss",
        summary: "The host closed a popover (Escape, outside click, anchor removed).",
        gesture: false,
        detail: &[],
    },
];

/// Named `keydown` keys (W3C `KeyboardEvent.key` values). Any other key is a
/// single printable grapheme.
pub const NAMED_KEYS: &[&str] = &[
    "Enter",
    "Escape",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
];

pub const TEMPLATE_CONSTRUCTS: &[TemplateConstruct] = &[
    TemplateConstruct {
        syntax: "{expr}",
        summary: "Interpolates an expression into text or an attribute value.",
    },
    TemplateConstruct {
        syntax: "<if test={expr}> … <else-if test={expr}> … <else>",
        summary: "Conditional subtree.",
    },
    TemplateConstruct {
        syntax: "<for each={expr} as=\"item\" key={expr}>",
        summary: "Repeats a subtree; `key` is mandatory and must be unique among siblings.",
    },
    TemplateConstruct {
        syntax: "<component name=\"x\" props=\"a b\"> … <slot/> … </component>",
        summary: "Local component with declared props and one slot, used as `<x a={…}>`.",
    },
    TemplateConstruct {
        syntax: "on:<event>={handler}",
        summary: "Subscribes the node to an event of its element and names the logic handler.",
    },
];

/// Expression subset compiled ahead of time by the CLI into `logic.js`.
pub const EXPRESSION_SUMMARY: &str = "Literals, state and prop paths, `!`, `&&`, `||`, `??`, \
comparison and arithmetic operators, the conditional operator, calls to functions exported by \
the logic module and `t(key, params)` for localized text. No assignment, function literal, \
`new`, `this`, template literal or access to globals.";

pub fn element(name: &str) -> Option<&'static Element> {
    ELEMENTS.iter().find(|element| element.name == name)
}

pub fn event(name: &str) -> Option<&'static Event> {
    EVENTS.iter().find(|event| event.name == name)
}
