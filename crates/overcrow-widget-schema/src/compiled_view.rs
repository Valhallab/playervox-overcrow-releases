//! `view.json`, the compiled view (ADR 0001, D3; P0.5).
//!
//! The CLI compiles `view.ocml` into this JSON tree and compiles every
//! template expression and event handler into a function of `logic.js`; the
//! tree names those functions by their index in the table `logic.js`
//! registers with the SDK. The VM instantiates the tree and emits scene
//! patches; the host never evaluates an expression. The host validates the
//! tree at activation with [`validate_compiled_view`], before the VM starts,
//! and still validates every patch at runtime.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::icons::is_icon;
use crate::json::{has_exact_fields, integer_in, parse_strict};
use crate::limits::{
    MAX_CHILDREN, MAX_CLASSES_PER_NODE, MAX_COMPILED_VIEW_BYTES, MAX_COMPONENT_PROPS,
    MAX_COMPONENTS, MAX_IDENTIFIER_BYTES, MAX_NODE_TEXT_BYTES, MAX_TREE_DEPTH, MAX_VIEW_ELEMENTS,
    MAX_VIEW_EXPRESSIONS,
};
use crate::model::{Field, ValueType};
use crate::view::{COMMON_ATTRIBUTES, Content, Element, OPAQUE_COLOR, element};

/// The only compiled view format.
pub const VIEW_FORMAT: i64 = 1;

/// Elements a `text` node lays out inline.
const INLINE_ELEMENTS: &[&str] = &["span", "icon", "image"];

const EXPRESSION: ValueType = ValueType::Record("expression index");

pub const VIEW_FIELDS: &[Field] = &[
    Field::required(
        "viewFormat",
        ValueType::Integer {
            min: VIEW_FORMAT,
            max: VIEW_FORMAT,
        },
        "Compiled view format.",
    ),
    Field::required(
        "expressions",
        ValueType::Integer {
            min: 0,
            max: MAX_VIEW_EXPRESSIONS.value as i64,
        },
        "Length of the expression table `logic.js` registers; every expression index is below it.",
    ),
    Field::optional(
        "components",
        ValueType::ListOf("Component", &MAX_COMPONENTS),
        "Local components.",
    ),
    Field::required(
        "children",
        ValueType::ListOf("Node", &MAX_CHILDREN),
        "Children of the scene root, a `box` (node 0).",
    ),
];

pub const COMPONENT_FIELDS: &[Field] = &[
    Field::required(
        "name",
        ValueType::Identifier(&MAX_IDENTIFIER_BYTES),
        "Unique; not an element name.",
    ),
    Field::required(
        "props",
        ValueType::ListOf("scope name", &MAX_COMPONENT_PROPS),
        "Distinct prop names.",
    ),
    Field::required(
        "children",
        ValueType::ListOf("Node", &MAX_CHILDREN),
        "Body, laid out where the component is used; flow content with at most one `slot`.",
    ),
];

/// One node kind of the compiled tree, recognised by its discriminating key.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NodeKind {
    pub key: &'static str,
    pub summary: &'static str,
    pub fields: &'static [Field],
}

pub const NODE_KINDS: &[NodeKind] = &[
    NodeKind {
        key: "element",
        summary: "An element of the schema. `text` holds the content of a text or inline element; an inline element has `text` or inline `children`, not both.",
        fields: &[
            Field::required("element", ValueType::Record("element name"), "Element."),
            Field::optional(
                "attrs",
                ValueType::Record("attribute map"),
                "Static attributes, checked against the element's types; `assets/…` images must be in the package.",
            ),
            Field::optional(
                "bind",
                ValueType::Record("attribute → expression index"),
                "Attributes computed by the VM; checked in every patch.",
            ),
            Field::optional(
                "on",
                ValueType::Record("event → expression index"),
                "Events of the element and their handlers.",
            ),
            Field::optional(
                "text",
                ValueType::Record("list of Part"),
                "Text content: literal strings and `{ \"expr\": n }` parts.",
            ),
            Field::optional(
                "children",
                ValueType::ListOf("Node", &MAX_CHILDREN),
                "Child nodes, checked against the element's content model.",
            ),
        ],
    },
    NodeKind {
        key: "if",
        summary: "Conditional subtree: branches `{ \"test\": n, \"children\": […] }`; only the last may omit `test` (the `else`).",
        fields: &[Field::required(
            "if",
            ValueType::Record("list of Branch"),
            "At least one branch.",
        )],
    },
    NodeKind {
        key: "for",
        summary: "Repeats `children` for each item of the list expression.",
        fields: &[
            Field::required("for", EXPRESSION, "List expression."),
            Field::required("as", ValueType::Record("scope name"), "Item name in scope."),
            Field::required(
                "key",
                EXPRESSION,
                "Mandatory key expression, unique among siblings at runtime.",
            ),
            Field::required(
                "children",
                ValueType::ListOf("Node", &MAX_CHILDREN),
                "Repeated nodes.",
            ),
        ],
    },
    NodeKind {
        key: "component",
        summary: "Use of a local component; allowed where flow content is.",
        fields: &[
            Field::required(
                "component",
                ValueType::Record("component name"),
                "Component.",
            ),
            Field::optional(
                "props",
                ValueType::Record("prop → expression index"),
                "Declared props only.",
            ),
            Field::optional(
                "children",
                ValueType::ListOf("Node", &MAX_CHILDREN),
                "Content placed at the component's `slot`.",
            ),
        ],
    },
    NodeKind {
        key: "slot",
        summary: "Where a component places the children of its use; only in a component body, in flow content.",
        fields: &[Field::required(
            "slot",
            ValueType::Keyword(&["true"]),
            "Always `true`.",
        )],
    },
];

/// Fixed reasons a compiled view is rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ViewError {
    Size,
    Json,
    /// Wrong JSON type, missing, unknown or conflicting field.
    Shape,
    ViewFormat,
    UnknownElement,
    InvalidParent,
    UnknownAttribute,
    InvalidAttribute,
    MissingAttribute,
    UnknownEvent,
    InvalidExpression,
    InvalidText,
    UnknownComponent,
    RecursiveComponent,
    InvalidComponent,
    InvalidSlot,
    MissingAsset,
    /// A `ref` bound, repeated, or inside a `for` or a component body.
    InvalidRef,
    /// A reference to a `ref` the view does not declare.
    UnknownRef,
    TooManyElements,
    TooManyComponents,
    TooManyChildren,
    TooDeep,
}

impl ViewError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Json => "json",
            Self::Shape => "shape",
            Self::ViewFormat => "view_format",
            Self::UnknownElement => "unknown_element",
            Self::InvalidParent => "invalid_parent",
            Self::UnknownAttribute => "unknown_attribute",
            Self::InvalidAttribute => "invalid_attribute",
            Self::MissingAttribute => "missing_attribute",
            Self::UnknownEvent => "unknown_event",
            Self::InvalidExpression => "invalid_expression",
            Self::InvalidText => "invalid_text",
            Self::UnknownComponent => "unknown_component",
            Self::RecursiveComponent => "recursive_component",
            Self::InvalidComponent => "invalid_component",
            Self::InvalidSlot => "invalid_slot",
            Self::MissingAsset => "missing_asset",
            Self::InvalidRef => "invalid_ref",
            Self::UnknownRef => "unknown_ref",
            Self::TooManyElements => "too_many_elements",
            Self::TooManyComponents => "too_many_components",
            Self::TooManyChildren => "too_many_children",
            Self::TooDeep => "too_deep",
        }
    }
}

/// What the host keeps from a validated view to check the VM's messages.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ViewSummary {
    /// Length of the expression table.
    pub expressions: u64,
    /// Every `ref` name and the element that carries it.
    pub refs: BTreeMap<String, &'static str>,
    /// Expression indices of the event handlers (`on`), the only ones a
    /// non-fatal `Fault` may name.
    pub handlers: BTreeSet<u64>,
}

/// Validates `view.json` bytes. `assets` holds the `assets/…` paths of the
/// package, the only images a static `src` may name.
pub fn validate_compiled_view(bytes: &[u8], assets: &BTreeSet<String>) -> Result<(), ViewError> {
    inspect_compiled_view(bytes, assets).map(|_| ())
}

/// [`validate_compiled_view`], returning the [`ViewSummary`] of the view.
pub fn inspect_compiled_view(
    bytes: &[u8],
    assets: &BTreeSet<String>,
) -> Result<ViewSummary, ViewError> {
    if bytes.len() as u64 > MAX_COMPILED_VIEW_BYTES.value {
        return Err(ViewError::Size);
    }
    let view = parse_strict(bytes, MAX_COMPILED_VIEW_BYTES.value).ok_or(ViewError::Json)?;
    let object = view.as_object().ok_or(ViewError::Shape)?;
    if object.get("viewFormat").and_then(Value::as_i64) != Some(VIEW_FORMAT) {
        return Err(ViewError::ViewFormat);
    }
    if !has_exact_fields(object, &[VIEW_FIELDS]) {
        return Err(ViewError::Shape);
    }
    let expressions = integer_in(&object["expressions"], 0, MAX_VIEW_EXPRESSIONS.value as i64)
        .ok_or(ViewError::InvalidExpression)? as u64;

    let empty = Vec::new();
    let components = match object.get("components") {
        Some(value) => value.as_array().ok_or(ViewError::Shape)?,
        None => &empty,
    };
    if components.len() as u64 > MAX_COMPONENTS.value {
        return Err(ViewError::TooManyComponents);
    }
    let mut declared = BTreeMap::new();
    for component in components {
        let component = component.as_object().ok_or(ViewError::Shape)?;
        if !has_exact_fields(component, &[COMPONENT_FIELDS]) {
            return Err(ViewError::Shape);
        }
        let name = component["name"].as_str().ok_or(ViewError::Shape)?;
        let props = component["props"].as_array().ok_or(ViewError::Shape)?;
        let mut unique = BTreeSet::new();
        let props_valid = props.len() as u64 <= MAX_COMPONENT_PROPS.value
            && props.iter().all(|prop| {
                prop.as_str()
                    .is_some_and(|prop| valid_scope_name(prop) && unique.insert(prop))
            });
        if !valid_identifier(name) || element(name).is_some() || !props_valid {
            return Err(ViewError::InvalidComponent);
        }
        if declared.insert(name, (unique, component)).is_some() {
            return Err(ViewError::InvalidComponent);
        }
    }

    let mut checker = Checker {
        expressions,
        assets,
        components: declared
            .iter()
            .map(|(name, (props, _))| (*name, props.clone()))
            .collect(),
        elements: 0,
        uses: BTreeSet::new(),
        refs: BTreeMap::new(),
        references: Vec::new(),
        handlers: BTreeSet::new(),
    };
    let root = element("box").ok_or(ViewError::UnknownElement)?;
    let mut graph = BTreeMap::new();
    for (name, (_, component)) in &declared {
        checker.uses.clear();
        let mut slots = 0;
        let context = Context {
            parent: root,
            depth: 1,
            slots: Some(&mut slots),
            repeated: true,
        };
        checker.children(&component["children"], context)?;
        if slots > 1 {
            return Err(ViewError::InvalidSlot);
        }
        graph.insert(*name, std::mem::take(&mut checker.uses));
    }
    let context = Context {
        parent: root,
        depth: 1,
        slots: None,
        repeated: false,
    };
    checker.children(&object["children"], context)?;
    if graph.keys().any(|name| reaches_itself(name, &graph)) {
        return Err(ViewError::RecursiveComponent);
    }
    if checker
        .references
        .iter()
        .any(|name| !checker.refs.contains_key(name))
    {
        return Err(ViewError::UnknownRef);
    }
    Ok(ViewSummary {
        expressions,
        refs: checker.refs,
        handlers: checker.handlers,
    })
}

struct Checker<'a> {
    expressions: u64,
    assets: &'a BTreeSet<String>,
    components: BTreeMap<&'a str, BTreeSet<&'a str>>,
    elements: u64,
    /// Components used by the body being checked.
    uses: BTreeSet<String>,
    refs: BTreeMap<String, &'static str>,
    /// Static `ref` names used by node-reference attributes.
    references: Vec<String>,
    handlers: BTreeSet<u64>,
}

/// Where a list of nodes is placed: the element whose content model applies
/// (constructs are transparent), the nesting depth, and, inside a component
/// body, the running count of `slot` nodes.
struct Context<'s> {
    parent: &'static Element,
    depth: u64,
    slots: Option<&'s mut u32>,
    /// Inside a `for` or a component body: a node here may exist several
    /// times, so it cannot carry a `ref`.
    repeated: bool,
}

impl Context<'_> {
    fn nested(&mut self, parent: &'static Element) -> Context<'_> {
        Context {
            parent,
            depth: self.depth + 1,
            slots: self.slots.as_deref_mut(),
            repeated: self.repeated,
        }
    }
}

impl Checker<'_> {
    fn children(&mut self, nodes: &Value, mut context: Context<'_>) -> Result<(), ViewError> {
        let nodes = nodes.as_array().ok_or(ViewError::Shape)?;
        if nodes.len() as u64 > MAX_CHILDREN.value {
            return Err(ViewError::TooManyChildren);
        }
        if !nodes.is_empty() && context.depth > MAX_TREE_DEPTH.value {
            return Err(ViewError::TooDeep);
        }
        for node in nodes {
            self.node(node, &mut context)?;
        }
        Ok(())
    }

    fn node(&mut self, node: &Value, context: &mut Context<'_>) -> Result<(), ViewError> {
        let object = node.as_object().ok_or(ViewError::Shape)?;
        let kind = NODE_KINDS
            .iter()
            .find(|kind| object.contains_key(kind.key))
            .ok_or(ViewError::Shape)?;
        if !has_exact_fields(object, &[kind.fields]) {
            return Err(ViewError::Shape);
        }
        match kind.key {
            "element" => self.element(object, context),
            "if" => {
                let branches = object["if"].as_array().ok_or(ViewError::Shape)?;
                if branches.is_empty() {
                    return Err(ViewError::Shape);
                }
                for (index, branch) in branches.iter().enumerate() {
                    let branch = branch.as_object().ok_or(ViewError::Shape)?;
                    let last = index + 1 == branches.len();
                    let fields = &[
                        Field::optional("test", EXPRESSION, ""),
                        Field::required("children", EXPRESSION, ""),
                    ];
                    if !has_exact_fields(branch, &[fields])
                        || (!last && !branch.contains_key("test"))
                    {
                        return Err(ViewError::Shape);
                    }
                    if let Some(test) = branch.get("test") {
                        self.expression(test)?;
                    }
                    let parent = context.parent;
                    self.children(&branch["children"], context.nested(parent))?;
                }
                Ok(())
            }
            "for" => {
                self.expression(&object["for"])?;
                self.expression(&object["key"])?;
                if !object["as"].as_str().is_some_and(valid_scope_name) {
                    return Err(ViewError::Shape);
                }
                let parent = context.parent;
                let mut nested = context.nested(parent);
                nested.repeated = true;
                self.children(&object["children"], nested)
            }
            "component" => {
                let name = object["component"].as_str().ok_or(ViewError::Shape)?;
                let props = self
                    .components
                    .get(name)
                    .ok_or(ViewError::UnknownComponent)?
                    .clone();
                if context.parent.content != Content::Flow {
                    return Err(ViewError::InvalidParent);
                }
                if let Some(given) = object.get("props") {
                    let given = given.as_object().ok_or(ViewError::Shape)?;
                    for (prop, value) in given {
                        if !props.contains(prop.as_str()) {
                            return Err(ViewError::InvalidComponent);
                        }
                        self.expression(value)?;
                    }
                }
                self.uses.insert(name.to_owned());
                if let Some(children) = object.get("children") {
                    let parent = context.parent;
                    self.children(children, context.nested(parent))?;
                }
                Ok(())
            }
            _ => {
                let Some(slots) = context.slots.as_deref_mut() else {
                    return Err(ViewError::InvalidSlot);
                };
                if object["slot"] != Value::Bool(true) || context.parent.content != Content::Flow {
                    return Err(ViewError::InvalidSlot);
                }
                *slots += 1;
                Ok(())
            }
        }
    }

    fn element(
        &mut self,
        object: &Map<String, Value>,
        context: &mut Context<'_>,
    ) -> Result<(), ViewError> {
        let name = object["element"].as_str().ok_or(ViewError::Shape)?;
        let element = element(name).ok_or(ViewError::UnknownElement)?;
        if !accepts(context.parent, element) {
            return Err(ViewError::InvalidParent);
        }
        self.elements += 1;
        if self.elements > MAX_VIEW_ELEMENTS.value {
            return Err(ViewError::TooManyElements);
        }

        let attribute = |name: &str| {
            COMMON_ATTRIBUTES
                .iter()
                .chain(element.attributes)
                .find(|field| field.name == name && field.name != "on")
        };
        let map = |key: &str| match object.get(key) {
            None => Ok(None),
            Some(Value::Object(map)) => Ok(Some(map)),
            Some(_) => Err(ViewError::Shape),
        };
        let (attrs, bind, on) = (map("attrs")?, map("bind")?, map("on")?);
        for (name, value) in attrs.into_iter().flatten() {
            let field = attribute(name).ok_or(ViewError::UnknownAttribute)?;
            self.static_value(field.ty, value)?;
            match field.ty {
                ValueType::Ref => {
                    let name = value.as_str().ok_or(ViewError::InvalidRef)?;
                    if context.repeated || self.refs.insert(name.to_owned(), element.name).is_some()
                    {
                        return Err(ViewError::InvalidRef);
                    }
                }
                ValueType::RefName => {
                    let name = value.as_str().ok_or(ViewError::InvalidAttribute)?;
                    self.references.push(name.to_owned());
                }
                _ => {}
            }
        }
        for (name, value) in bind.into_iter().flatten() {
            let field = attribute(name).ok_or(ViewError::UnknownAttribute)?;
            // A `ref` names one node for the whole life of the view.
            if field.ty == ValueType::Ref {
                return Err(ViewError::InvalidRef);
            }
            if attrs.is_some_and(|attrs| attrs.contains_key(name)) {
                return Err(ViewError::Shape);
            }
            self.expression(value)?;
        }
        let present = |name: &str| {
            attrs.is_some_and(|attrs| attrs.contains_key(name))
                || bind.is_some_and(|bind| bind.contains_key(name))
        };
        if element
            .attributes
            .iter()
            .any(|field| field.required && !present(field.name))
        {
            return Err(ViewError::MissingAttribute);
        }
        for (event, handler) in on.into_iter().flatten() {
            if !element.events.contains(&event.as_str()) {
                return Err(ViewError::UnknownEvent);
            }
            self.expression(handler)?;
            if let Some(index) = handler.as_u64() {
                self.handlers.insert(index);
            }
        }

        let text = object.get("text");
        let children = object.get("children");
        let text_allowed = matches!(element.content, Content::Text | Content::Inline);
        let children_allowed = !matches!(element.content, Content::Text | Content::Empty);
        if (text.is_some() && !text_allowed)
            || (children.is_some() && !children_allowed)
            || (text.is_some() && children.is_some())
        {
            return Err(ViewError::InvalidParent);
        }
        if let Some(text) = text {
            self.text(text)?;
        }
        if let Some(children) = children {
            self.children(children, context.nested(element))?;
        }
        Ok(())
    }

    fn text(&self, parts: &Value) -> Result<(), ViewError> {
        let parts = parts.as_array().ok_or(ViewError::Shape)?;
        let mut literal_bytes = 0u64;
        for part in parts {
            match part {
                Value::String(text) => {
                    literal_bytes += text.len() as u64;
                    if text.is_empty() || text.contains('\0') {
                        return Err(ViewError::InvalidText);
                    }
                }
                Value::Object(object) if object.len() == 1 && object.contains_key("expr") => {
                    self.expression(&object["expr"])?;
                }
                _ => return Err(ViewError::Shape),
            }
        }
        if parts.is_empty() || literal_bytes > MAX_NODE_TEXT_BYTES.value {
            return Err(ViewError::InvalidText);
        }
        Ok(())
    }

    fn expression(&self, index: &Value) -> Result<(), ViewError> {
        index
            .as_u64()
            .filter(|index| *index < self.expressions)
            .map(|_| ())
            .ok_or(ViewError::InvalidExpression)
    }

    fn static_value(&self, ty: ValueType, value: &Value) -> Result<(), ViewError> {
        static_value(ty, value, self.assets)
    }
}

/// Checks a static attribute value against its type. `assets` holds the
/// `assets/…` paths of the package, the only images a static `src` may name.
pub fn static_value(
    ty: ValueType,
    value: &Value,
    assets: &BTreeSet<String>,
) -> Result<(), ViewError> {
    let invalid = ViewError::InvalidAttribute;
    let text = |maximum: u64, characters: bool| {
        value
            .as_str()
            .filter(|text| {
                let length = if characters {
                    text.chars().count()
                } else {
                    text.len()
                };
                length as u64 <= maximum && !text.contains('\0')
            })
            .map(|_| ())
            .ok_or(invalid)
    };
    match ty {
        ValueType::Bool => value.is_boolean().then_some(()).ok_or(invalid),
        ValueType::Text(limit) => text(limit.value, false),
        ValueType::Chars(limit) => text(limit.value, true),
        ValueType::Identifier(limit) => value
            .as_str()
            .filter(|name| name.len() as u64 <= limit.value && valid_identifier(name))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::Integer { min, max } => integer_in(value, min, max).map(|_| ()).ok_or(invalid),
        ValueType::Number { min, max } => value
            .as_f64()
            .filter(|number| number.is_finite() && (min..=max).contains(number))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::Keyword(words) => value
            .as_str()
            .filter(|word| words.contains(word))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::ClassList => {
            let list = value.as_str().ok_or(invalid)?;
            let mut unique = BTreeSet::new();
            let valid = !list.is_empty()
                && list.split(' ').all(|class| {
                    class.len() as u64 <= MAX_IDENTIFIER_BYTES.value
                        && valid_identifier(class)
                        && unique.insert(class)
                })
                && unique.len() as u64 <= MAX_CLASSES_PER_NODE.value;
            valid.then_some(()).ok_or(invalid)
        }
        ValueType::Icon => value
            .as_str()
            .filter(|name| is_icon(name))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::ImageSource => {
            // Host asset handles exist only at runtime; a static source
            // names a file of this package.
            let source = value.as_str().ok_or(invalid)?;
            if !source.starts_with("assets/") {
                return Err(invalid);
            }
            assets
                .contains(source)
                .then_some(())
                .ok_or(ViewError::MissingAsset)
        }
        // Checked against the view's `ref` names by the caller.
        ValueType::Ref | ValueType::RefName => value
            .as_str()
            .filter(|name| valid_identifier(name))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::Record(OPAQUE_COLOR) => value
            .as_str()
            .filter(|color| is_opaque_color(color))
            .map(|_| ())
            .ok_or(invalid),
        ValueType::NumberList(limit) => {
            let values = value.as_array().ok_or(invalid)?;
            let valid = values.len() as u64 <= limit.value
                && values
                    .iter()
                    .all(|value| value.as_f64().is_some_and(f64::is_finite));
            valid.then_some(()).ok_or(invalid)
        }
        // Node references, IDs and structured values exist only at runtime.
        _ => Err(invalid),
    }
}

/// `#rrggbb`, exactly: six hexadecimal digits, no alpha.
pub fn is_opaque_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Content model of the retained scene, shared with patch validation.
pub fn accepts(parent: &Element, child: &Element) -> bool {
    let by_parent = match parent.content {
        Content::Flow => child.parents.is_empty(),
        Content::Inline => INLINE_ELEMENTS.contains(&child.name),
        Content::Only(names) => names.contains(&child.name),
        Content::Empty | Content::Text => false,
    };
    by_parent && (child.parents.is_empty() || child.parents.contains(&parent.name))
}

fn reaches_itself(start: &str, graph: &BTreeMap<&str, BTreeSet<String>>) -> bool {
    let mut stack: Vec<&str> = graph
        .get(start)
        .map(|uses| uses.iter().map(String::as_str).collect())
        .unwrap_or_default();
    let mut seen = BTreeSet::new();
    while let Some(name) = stack.pop() {
        if name == start {
            return true;
        }
        if seen.insert(name)
            && let Some(uses) = graph.get(name)
        {
            stack.extend(uses.iter().map(String::as_str));
        }
    }
    false
}

/// `[a-z][a-z0-9-]*`: component and class names.
pub fn valid_identifier(value: &str) -> bool {
    value.len() as u64 <= MAX_IDENTIFIER_BYTES.value
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// `[A-Za-z_][A-Za-z0-9_]*`: names bound in template scope (props, `as`).
pub fn valid_scope_name(value: &str) -> bool {
    value.len() as u64 <= MAX_IDENTIFIER_BYTES.value
        && value
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}
