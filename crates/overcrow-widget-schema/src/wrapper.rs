//! The manifest `wrapper.menu` section (ADR 0001, D12): widget rows appended
//! to the host options menu, after the separated host rows. Host rows
//! (opacity, scale, fit to content, passive visibility) are not declared here.
//!
//! Rows only set a declared value or emit a declared event. Values are stored
//! by the host profile store and reach the VM in `Init` and `Snapshot` after
//! durable acknowledgement; an `action` row reaches it as a `menu` event,
//! which is never a user gesture.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::icons::is_icon;
use crate::json::has_exact_fields;
use crate::limits::{
    MAX_MENU_CHOICES, MAX_MENU_DEPTH, MAX_MENU_ID_BYTES, MAX_MENU_LABEL_CHARS, MAX_MENU_NUMBER,
    MAX_MENU_ROWS, MAX_SLIDER_STEPS, MIN_MENU_CHOICES,
};
use crate::model::{Field, ValueType};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RowType {
    pub name: &'static str,
    pub summary: &'static str,
    /// Fields in addition to [`ROW_FIELDS`].
    pub fields: &'static [Field],
}

const MENU_NUMBER: ValueType = ValueType::Number {
    min: -(MAX_MENU_NUMBER.value as f64),
    max: MAX_MENU_NUMBER.value as f64,
};

/// Fields of every row.
pub const ROW_FIELDS: &[Field] = &[
    Field::required(
        "type",
        ValueType::Keyword(&["toggle", "slider", "choice", "action", "group"]),
        "Row type.",
    ),
    Field::required(
        "id",
        ValueType::Identifier(&MAX_MENU_ID_BYTES),
        "Unique among all rows of the widget; key of the stored value.",
    ),
    Field::required(
        "label",
        ValueType::Record("MenuLabel"),
        "Localized row label.",
    ),
    Field::optional(
        "icon",
        ValueType::Icon,
        "Leading icon from the host list, drawn by the host.",
    ),
    Field::optional(
        "visibleWhen",
        ValueType::Identifier(&MAX_MENU_ID_BYTES),
        "ID of a `toggle` row declared earlier; this row is shown only while that toggle is on.",
    ),
    Field::optional(
        "requires",
        ValueType::Keyword(HOST_FEATURES),
        "Host data source; the host hides the row when it cannot supply it.",
    ),
];

/// Host data sources a row can depend on (`requires`). A host hides the row,
/// and keeps its stored value, when the source is missing on that machine.
pub const HOST_FEATURES: &[&str] = &[
    "fps",
    "telemetry.cpuTemperature",
    "telemetry.gpuTemperature",
];

/// `{ "en": …, "fr": … }`: non-empty, trimmed, no control character.
pub const LABEL_FIELDS: &[Field] = &[
    Field::required("en", ValueType::Record("label text"), "English label."),
    Field::required("fr", ValueType::Record("label text"), "French label."),
];

pub const CHOICE_FIELDS: &[Field] = &[
    Field::required(
        "value",
        ValueType::Identifier(&MAX_MENU_ID_BYTES),
        "Stored value; unique within the row.",
    ),
    Field::required(
        "label",
        ValueType::Record("MenuLabel"),
        "Localized choice label.",
    ),
];

pub const ROW_TYPES: &[RowType] = &[
    RowType {
        name: "toggle",
        summary: "Boolean switch.",
        fields: &[Field::required(
            "default",
            ValueType::Bool,
            "Initial value.",
        )],
    },
    RowType {
        name: "slider",
        summary: "Bounded number; `step` > 0, `step` ≤ `max - min`, at most `MAX_SLIDER_STEPS` steps, `default` within range.",
        fields: &[
            Field::required("min", MENU_NUMBER, "Lower bound."),
            Field::required("max", MENU_NUMBER, "Upper bound, greater than `min`."),
            Field::required("step", MENU_NUMBER, "Increment."),
            Field::required("default", MENU_NUMBER, "Initial value."),
        ],
    },
    RowType {
        name: "choice",
        summary: "One value among declared choices.",
        fields: &[
            Field::required(
                "choices",
                ValueType::ListOf("MenuChoice", &MAX_MENU_CHOICES),
                "At least `MIN_MENU_CHOICES` choices.",
            ),
            Field::required(
                "default",
                ValueType::Identifier(&MAX_MENU_ID_BYTES),
                "Value of one declared choice.",
            ),
        ],
    },
    RowType {
        name: "action",
        summary: "Sends a `menu` event carrying the row ID to the VM. Not a user gesture.",
        fields: &[],
    },
    RowType {
        name: "group",
        summary: "Side flyout holding non-group rows.",
        fields: &[Field::required(
            "rows",
            ValueType::ListOf("MenuRow", &MAX_MENU_ROWS),
            "At least one row; a `group` is not allowed here.",
        )],
    },
];

/// Fields of the manifest `wrapper` object.
pub const WRAPPER_FIELDS: &[Field] = &[Field::optional(
    "menu",
    ValueType::ListOf("MenuRow", &MAX_MENU_ROWS),
    "Widget rows in display order.",
)];

/// Fixed reasons a `wrapper` section is rejected. They carry no manifest
/// content so they can be reported without leaking creator text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MenuError {
    /// Wrong JSON type, missing field or unknown field.
    Shape,
    UnknownRowType,
    TooManyRows,
    NestedGroup,
    EmptyGroup,
    InvalidId,
    DuplicateId,
    InvalidLabel,
    UnknownIcon,
    InvalidRange,
    InvalidDefault,
    InvalidChoices,
    InvalidCondition,
}

impl MenuError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Shape => "shape",
            Self::UnknownRowType => "unknown_row_type",
            Self::TooManyRows => "too_many_rows",
            Self::NestedGroup => "nested_group",
            Self::EmptyGroup => "empty_group",
            Self::InvalidId => "invalid_id",
            Self::DuplicateId => "duplicate_id",
            Self::InvalidLabel => "invalid_label",
            Self::UnknownIcon => "unknown_icon",
            Self::InvalidRange => "invalid_range",
            Self::InvalidDefault => "invalid_default",
            Self::InvalidChoices => "invalid_choices",
            Self::InvalidCondition => "invalid_condition",
        }
    }
}

pub fn row_type(name: &str) -> Option<&'static RowType> {
    ROW_TYPES.iter().find(|row| row.name == name)
}

/// Validates the manifest `wrapper` object against the tables above.
pub fn validate_wrapper(wrapper: &Value) -> Result<(), MenuError> {
    let object = wrapper.as_object().ok_or(MenuError::Shape)?;
    check_fields(object, &[WRAPPER_FIELDS])?;
    let Some(menu) = object.get("menu") else {
        return Ok(());
    };
    let mut ids = BTreeSet::new();
    let mut toggles = BTreeSet::new();
    let mut count = 0;
    validate_rows(menu, 0, &mut count, &mut ids, &mut toggles)
}

fn validate_rows<'a>(
    rows: &'a Value,
    depth: u64,
    count: &mut u64,
    ids: &mut BTreeSet<&'a str>,
    toggles: &mut BTreeSet<&'a str>,
) -> Result<(), MenuError> {
    for row in rows.as_array().ok_or(MenuError::Shape)? {
        *count += 1;
        if *count > MAX_MENU_ROWS.value {
            return Err(MenuError::TooManyRows);
        }
        validate_row(row, depth, count, ids, toggles)?;
    }
    Ok(())
}

fn validate_row<'a>(
    row: &'a Value,
    depth: u64,
    count: &mut u64,
    ids: &mut BTreeSet<&'a str>,
    toggles: &mut BTreeSet<&'a str>,
) -> Result<(), MenuError> {
    let object = row.as_object().ok_or(MenuError::Shape)?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(MenuError::Shape)?;
    let row_type = row_type(kind).ok_or(MenuError::UnknownRowType)?;
    check_fields(object, &[ROW_FIELDS, row_type.fields])?;

    let id = object["id"].as_str().ok_or(MenuError::Shape)?;
    if !valid_identifier(id) {
        return Err(MenuError::InvalidId);
    }
    if !ids.insert(id) {
        return Err(MenuError::DuplicateId);
    }
    validate_label(&object["label"])?;
    if let Some(icon) = object.get("icon")
        && !icon.as_str().is_some_and(is_icon)
    {
        return Err(MenuError::UnknownIcon);
    }
    // A condition names a toggle declared before this row, so conditions
    // cannot form a cycle and the host resolves them in one pass.
    if let Some(toggle) = object.get("visibleWhen")
        && !toggle
            .as_str()
            .is_some_and(|toggle| toggles.contains(toggle))
    {
        return Err(MenuError::InvalidCondition);
    }
    if let Some(feature) = object.get("requires")
        && !feature
            .as_str()
            .is_some_and(|feature| HOST_FEATURES.contains(&feature))
    {
        return Err(MenuError::InvalidCondition);
    }

    match kind {
        "toggle" => {
            if !object["default"].is_boolean() {
                return Err(MenuError::InvalidDefault);
            }
            toggles.insert(id);
        }
        "slider" => validate_slider(object)?,
        "choice" => validate_choice(object)?,
        "group" => {
            if depth >= MAX_MENU_DEPTH.value {
                return Err(MenuError::NestedGroup);
            }
            let rows = &object["rows"];
            if rows.as_array().is_some_and(Vec::is_empty) {
                return Err(MenuError::EmptyGroup);
            }
            validate_rows(rows, depth + 1, count, ids, toggles)?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_slider(object: &Map<String, Value>) -> Result<(), MenuError> {
    let number = |name: &str| {
        object[name]
            .as_f64()
            .filter(|value| value.is_finite() && value.abs() <= MAX_MENU_NUMBER.value as f64)
            .ok_or(MenuError::InvalidRange)
    };
    let (min, max, step) = (number("min")?, number("max")?, number("step")?);
    if min >= max || step <= 0.0 || step > max - min {
        return Err(MenuError::InvalidRange);
    }
    if (max - min) / step > MAX_SLIDER_STEPS.value as f64 {
        return Err(MenuError::InvalidRange);
    }
    let default = number("default").map_err(|_| MenuError::InvalidDefault)?;
    if !(min..=max).contains(&default) {
        return Err(MenuError::InvalidDefault);
    }
    Ok(())
}

fn validate_choice(object: &Map<String, Value>) -> Result<(), MenuError> {
    let choices = object["choices"].as_array().ok_or(MenuError::Shape)?;
    let count = choices.len() as u64;
    if !(MIN_MENU_CHOICES.value..=MAX_MENU_CHOICES.value).contains(&count) {
        return Err(MenuError::InvalidChoices);
    }
    let mut values = BTreeSet::new();
    for choice in choices {
        let choice = choice.as_object().ok_or(MenuError::Shape)?;
        check_fields(choice, &[CHOICE_FIELDS])?;
        let value = choice["value"].as_str().ok_or(MenuError::Shape)?;
        if !valid_identifier(value) || !values.insert(value) {
            return Err(MenuError::InvalidChoices);
        }
        validate_label(&choice["label"])?;
    }
    let default = object["default"]
        .as_str()
        .ok_or(MenuError::InvalidDefault)?;
    if !values.contains(default) {
        return Err(MenuError::InvalidDefault);
    }
    Ok(())
}

fn validate_label(label: &Value) -> Result<(), MenuError> {
    let object = label.as_object().ok_or(MenuError::Shape)?;
    check_fields(object, &[LABEL_FIELDS])?;
    for field in LABEL_FIELDS {
        let text = object[field.name].as_str().ok_or(MenuError::Shape)?;
        if !valid_label_text(text, MAX_MENU_LABEL_CHARS.value) {
            return Err(MenuError::InvalidLabel);
        }
    }
    Ok(())
}

/// Non-empty, trimmed text without control characters, at most `maximum`
/// Unicode scalar values: menu labels and widget names.
pub(crate) fn valid_label_text(text: &str, maximum: u64) -> bool {
    !text.is_empty()
        && text.trim() == text
        && text.chars().count() as u64 <= maximum
        && !text.chars().any(char::is_control)
}

fn check_fields(object: &Map<String, Value>, sets: &[&[Field]]) -> Result<(), MenuError> {
    if has_exact_fields(object, sets) {
        Ok(())
    } else {
        Err(MenuError::Shape)
    }
}

/// `[a-z][a-z0-9-]*` within `MAX_MENU_ID_BYTES`.
fn valid_identifier(value: &str) -> bool {
    value.len() as u64 <= MAX_MENU_ID_BYTES.value
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}
