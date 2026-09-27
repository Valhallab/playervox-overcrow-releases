//! `manifest.json` v1 (P0.5): widget identity, version, name, sizing, the
//! optional VM heap request, permissions and the `wrapper` section.
//!
//! The manifest is creator-authored and hashed into the package ledger. The
//! host, the CLI and the Studio validate it with [`validate_manifest`]; the
//! catalog repeats the same object and the host requires the two to be equal.
//! Any other shape, including a Web API manifest, is rejected.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::json::{has_exact_fields, integer_in, parse_strict};
use crate::limits::{
    MAX_DNS_LABEL_BYTES, MAX_DNS_NAME_BYTES, MAX_ENUM_VALUE_BYTES, MAX_ENUM_VALUES,
    MAX_GAME_EVENTS, MAX_MANIFEST_BYTES, MAX_NETWORK_PATH_BYTES, MAX_NETWORK_RULES,
    MAX_PARAMETER_NAME_BYTES, MAX_PATH_PARAMS, MAX_QUERY_PARAMS, MAX_SLUG_PARAMETER_BYTES,
    MAX_STRING_PARAMETER_BYTES, MAX_WIDGET_EDGE_PX, MAX_WIDGET_ID_BYTES, MAX_WIDGET_NAME_CHARS,
    MIN_WIDGET_ID_BYTES, VM_HEAP_BYTES, VM_MAX_HEAP_BYTES,
};
use crate::model::{Field, ValueType, field, is_keyword};
use crate::permissions::{
    CAPABILITIES, NETWORK_RULE_FIELDS, PARAMETER_CONSTRAINTS, capability_named,
};
use crate::version::Version;
use crate::wrapper::{valid_label_text, validate_wrapper};

const MIB: u64 = 1024 * 1024;
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

/// The only manifest document version.
pub const MANIFEST_SCHEMA_VERSION: i64 = 1;

/// IDs of this prefix are reserved for packages signed by PlayerVox: local
/// (sideloaded) installs cannot use them, and only they can carry the
/// `built-in` catalog tag.
pub const RESERVED_ID_PREFIX: &str = "com.playervox";

pub const MANIFEST_FIELDS: &[Field] = &[
    Field::required(
        "schemaVersion",
        ValueType::Integer { min: 1, max: 1 },
        "Manifest document version.",
    ),
    Field::required(
        "apiVersion",
        ValueType::Integer { min: 1, max: 1 },
        "Widget API version; selects this schema.",
    ),
    Field::required(
        "id",
        ValueType::Record("widget ID"),
        "Reverse-DNS ID, `MIN_WIDGET_ID_BYTES`..=`MAX_WIDGET_ID_BYTES`: at least two dot-separated segments of `[a-z0-9-]`, each at most `MAX_DNS_LABEL_BYTES` and not starting or ending with `-`. `com.playervox` and `com.playervox.*` are reserved for packages signed by PlayerVox.",
    ),
    Field::required(
        "version",
        ValueType::Record("version"),
        "SemVer 2.0.0 `MAJOR.MINOR.PATCH[-PRERELEASE]` in canonical form, at most `MAX_VERSION_BYTES`; build metadata is rejected.",
    ),
    Field::required(
        "name",
        ValueType::Record("WidgetName"),
        "Localized widget name shown by the host.",
    ),
    Field::required(
        "sizing",
        ValueType::Record("Sizing"),
        "Size and fit rules applied by the wrapper.",
    ),
    Field::optional(
        "vm",
        ValueType::Record("VmRequest"),
        "VM budget request; absent means the defaults.",
    ),
    Field::optional(
        "permissions",
        ValueType::Record("Permissions"),
        "Requested permissions; absent means none.",
    ),
    Field::optional(
        "wrapper",
        ValueType::Record("wrapper"),
        "Widget rows of the host options menu.",
    ),
];

/// `{ "en": …, "fr": … }`, each non-empty, trimmed, without control
/// characters and at most `MAX_WIDGET_NAME_CHARS` characters.
pub const NAME_FIELDS: &[Field] = &[
    Field::required("en", ValueType::Record("name text"), "English name."),
    Field::required("fr", ValueType::Record("name text"), "French name."),
];

pub const SIZING_FIELDS: &[Field] = &[
    Field::required(
        "fit",
        ValueType::Keyword(&["none", "both", "height"]),
        "Content fitting the widget supports: `both` axes, `height` only, or `none`. Manual resizing is always available.",
    ),
    Field::optional(
        "defaultMode",
        ValueType::Keyword(&["fit", "manual"]),
        "Mode of a new layout; default `fit` when `fit` is not `none`, else `manual`. `fit` with `fit: none` is rejected.",
    ),
    Field::required(
        "preferred",
        ValueType::Record("Dimensions"),
        "Initial size; within `min` and `max`.",
    ),
    Field::required("min", ValueType::Record("Dimensions"), "Smallest size."),
    Field::required("max", ValueType::Record("Dimensions"), "Largest size."),
];

const EDGE: ValueType = ValueType::Integer {
    min: 1,
    max: MAX_WIDGET_EDGE_PX.value as i64,
};

pub const DIMENSION_FIELDS: &[Field] = &[
    Field::required("width", EDGE, "Logical px."),
    Field::required("height", EDGE, "Logical px."),
];

pub const VM_FIELDS: &[Field] = &[Field::required(
    "heapMiB",
    ValueType::Integer {
        min: (VM_HEAP_BYTES.value / MIB) as i64,
        max: (VM_MAX_HEAP_BYTES.value / MIB) as i64,
    },
    "QuickJS heap ceiling in MiB, from `VM_HEAP_BYTES` to `VM_MAX_HEAP_BYTES`. The VM process ceiling (`VM_PROCESS_MEMORY_BYTES`) does not change.",
)];

pub const PERMISSION_FIELDS: &[Field] = &[
    Field::optional(
        "network",
        ValueType::ListOf("NetworkRule", &MAX_NETWORK_RULES),
        "Distinct network rules.",
    ),
    Field::optional(
        "storage",
        ValueType::Bool,
        "Host key-value storage; default `false`.",
    ),
    Field::optional(
        "clipboardWrite",
        ValueType::Bool,
        "Clipboard text writes; default `false`.",
    ),
    Field::optional(
        "gameEvents",
        ValueType::ListOf("game event", &MAX_GAME_EVENTS),
        "Distinct `overcrow.game.<name>.v1` event names.",
    ),
    Field::optional(
        "capabilities",
        ValueType::Record("capability names"),
        "Distinct capabilities of the schema.",
    ),
];

/// Fixed reasons a manifest is rejected. They carry no manifest content.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManifestError {
    /// Larger than `MAX_MANIFEST_BYTES`.
    Size,
    /// Not one strict JSON document (duplicate key, byte-order mark, syntax).
    Json,
    /// Wrong JSON type, missing field or unknown field.
    Shape,
    SchemaVersion,
    ApiVersion,
    Id,
    Version,
    Name,
    Sizing,
    VmHeap,
    NetworkRule,
    GameEvent,
    Capability,
    /// A sensitive capability together with `network` or `clipboardWrite`.
    SensitiveEgress,
    Wrapper,
}

impl ManifestError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Json => "json",
            Self::Shape => "shape",
            Self::SchemaVersion => "schema_version",
            Self::ApiVersion => "api_version",
            Self::Id => "id",
            Self::Version => "version",
            Self::Name => "name",
            Self::Sizing => "sizing",
            Self::VmHeap => "vm_heap",
            Self::NetworkRule => "network_rule",
            Self::GameEvent => "game_event",
            Self::Capability => "capability",
            Self::SensitiveEgress => "sensitive_egress",
            Self::Wrapper => "wrapper",
        }
    }
}

/// A validated manifest. `value` is the exact validated object, compared
/// with the catalog's copy.
#[derive(Clone, Debug, PartialEq)]
pub struct Manifest {
    pub id: String,
    pub version: Version,
    /// Heap ceiling granted to the VM: the request, or `VM_HEAP_BYTES`.
    pub heap_bytes: u64,
    pub permissions: Permissions,
    pub value: Value,
}

impl Manifest {
    pub fn has_reserved_id(&self) -> bool {
        is_reserved_id(&self.id)
    }
}

/// Requested authority, normalized for comparison between versions.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Permissions {
    /// Each rule in compact JSON with sorted keys.
    pub network: BTreeSet<String>,
    pub storage: bool,
    pub clipboard_write: bool,
    pub game_events: BTreeSet<String>,
    pub capabilities: BTreeSet<&'static str>,
}

impl Permissions {
    /// Whether `self` requests anything `previous` did not. A widening update
    /// requires explicit consent, even for a `built-in` package (ADR 0001, D7).
    pub fn widens(&self, previous: &Self) -> bool {
        !self.network.is_subset(&previous.network)
            || (self.storage && !previous.storage)
            || (self.clipboard_write && !previous.clipboard_write)
            || !self.game_events.is_subset(&previous.game_events)
            || !self.capabilities.is_subset(&previous.capabilities)
    }

    pub fn has_sensitive_capability(&self) -> bool {
        self.capabilities
            .iter()
            .any(|name| capability_named(name).is_some_and(|capability| capability.sensitive))
    }
}

pub fn is_reserved_id(id: &str) -> bool {
    id == RESERVED_ID_PREFIX
        || id
            .strip_prefix(RESERVED_ID_PREFIX)
            .is_some_and(|rest| rest.starts_with('.'))
}

/// Validates `manifest.json` bytes.
pub fn validate_manifest(bytes: &[u8]) -> Result<Manifest, ManifestError> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES.value {
        return Err(ManifestError::Size);
    }
    let value = parse_strict(bytes, MAX_MANIFEST_BYTES.value).ok_or(ManifestError::Json)?;
    validate_manifest_value(value)
}

/// Validates a manifest object already parsed strictly (the catalog copy).
pub fn validate_manifest_value(value: Value) -> Result<Manifest, ManifestError> {
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    // Versions first: a legacy or future document reports why it is refused.
    if object.get("schemaVersion").and_then(Value::as_i64) != Some(MANIFEST_SCHEMA_VERSION) {
        return Err(ManifestError::SchemaVersion);
    }
    if object.get("apiVersion").and_then(Value::as_i64) != Some(crate::API_VERSION as i64) {
        return Err(ManifestError::ApiVersion);
    }
    if !has_exact_fields(object, &[MANIFEST_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let id = object["id"].as_str().ok_or(ManifestError::Shape)?;
    if !valid_widget_id(id) {
        return Err(ManifestError::Id);
    }
    let version = object["version"]
        .as_str()
        .and_then(Version::parse)
        .ok_or(ManifestError::Version)?;
    validate_name(&object["name"])?;
    validate_sizing(&object["sizing"])?;
    let heap_bytes = match object.get("vm") {
        Some(vm) => validate_vm(vm)?,
        None => VM_HEAP_BYTES.value,
    };
    let permissions = match object.get("permissions") {
        Some(permissions) => validate_permissions(permissions)?,
        None => Permissions::default(),
    };
    if let Some(wrapper) = object.get("wrapper") {
        validate_wrapper(wrapper).map_err(|_| ManifestError::Wrapper)?;
    }
    Ok(Manifest {
        id: id.to_owned(),
        version,
        heap_bytes,
        permissions,
        value,
    })
}

/// Reverse-DNS widget ID, the grammar of the Web runtime kept unchanged.
pub fn valid_widget_id(id: &str) -> bool {
    (MIN_WIDGET_ID_BYTES.value..=MAX_WIDGET_ID_BYTES.value).contains(&(id.len() as u64))
        && id.split('.').count() >= 2
        && id.split('.').all(|segment| {
            !segment.is_empty()
                && segment.len() as u64 <= MAX_DNS_LABEL_BYTES.value
                && !segment.starts_with('-')
                && !segment.ends_with('-')
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn validate_name(name: &Value) -> Result<(), ManifestError> {
    let object = name.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[NAME_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    for field in NAME_FIELDS {
        let text = object[field.name].as_str().ok_or(ManifestError::Shape)?;
        if !valid_label_text(text, MAX_WIDGET_NAME_CHARS.value) {
            return Err(ManifestError::Name);
        }
    }
    Ok(())
}

fn validate_sizing(sizing: &Value) -> Result<(), ManifestError> {
    let object = sizing.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[SIZING_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let fit = object["fit"].as_str().ok_or(ManifestError::Shape)?;
    if !is_keyword(SIZING_FIELDS, "fit", fit) {
        return Err(ManifestError::Sizing);
    }
    if let Some(mode) = object.get("defaultMode") {
        let mode = mode.as_str().ok_or(ManifestError::Sizing)?;
        // `fit` needs something to fit to.
        if !is_keyword(SIZING_FIELDS, "defaultMode", mode) || (mode == "fit" && fit == "none") {
            return Err(ManifestError::Sizing);
        }
    }
    let [preferred, min, max] = ["preferred", "min", "max"].map(|name| dimensions(&object[name]));
    let (preferred, min, max) = (preferred?, min?, max?);
    let ordered = |low: (i64, i64), high: (i64, i64)| low.0 <= high.0 && low.1 <= high.1;
    if !ordered(min, preferred) || !ordered(preferred, max) {
        return Err(ManifestError::Sizing);
    }
    Ok(())
}

fn dimensions(value: &Value) -> Result<(i64, i64), ManifestError> {
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[DIMENSION_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let edge = |name: &str| {
        integer_in(&object[name], 1, MAX_WIDGET_EDGE_PX.value as i64).ok_or(ManifestError::Sizing)
    };
    Ok((edge("width")?, edge("height")?))
}

fn validate_vm(vm: &Value) -> Result<u64, ManifestError> {
    let object = vm.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[VM_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let heap = integer_in(
        &object["heapMiB"],
        (VM_HEAP_BYTES.value / MIB) as i64,
        (VM_MAX_HEAP_BYTES.value / MIB) as i64,
    )
    .ok_or(ManifestError::VmHeap)?;
    Ok(heap as u64 * MIB)
}

fn validate_permissions(permissions: &Value) -> Result<Permissions, ManifestError> {
    let object = permissions.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[PERMISSION_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let flag = |name: &str| match object.get(name) {
        None => Ok(false),
        Some(value) => value.as_bool().ok_or(ManifestError::Shape),
    };
    let list = |name: &str| match object.get(name) {
        None => Ok(&[][..]),
        Some(value) => value
            .as_array()
            .map(Vec::as_slice)
            .ok_or(ManifestError::Shape),
    };

    let rules = list("network")?;
    if rules.len() as u64 > MAX_NETWORK_RULES.value {
        return Err(ManifestError::NetworkRule);
    }
    let mut network = BTreeSet::new();
    for rule in rules {
        validate_network_rule(rule)?;
        // `serde_json` maps keep sorted keys, so this form is canonical.
        if !network.insert(rule.to_string()) {
            return Err(ManifestError::NetworkRule);
        }
    }

    let events = list("gameEvents")?;
    if events.len() as u64 > MAX_GAME_EVENTS.value {
        return Err(ManifestError::GameEvent);
    }
    let mut game_events = BTreeSet::new();
    for event in events {
        let event = event.as_str().ok_or(ManifestError::Shape)?;
        if !valid_game_event(event) || !game_events.insert(event.to_owned()) {
            return Err(ManifestError::GameEvent);
        }
    }

    let mut capabilities = BTreeSet::new();
    for name in list("capabilities")? {
        let name = name.as_str().ok_or(ManifestError::Shape)?;
        let capability = CAPABILITIES
            .iter()
            .find(|capability| capability.name == name)
            .ok_or(ManifestError::Capability)?;
        if !capabilities.insert(capability.name) {
            return Err(ManifestError::Capability);
        }
    }

    let permissions = Permissions {
        network,
        storage: flag("storage")?,
        clipboard_write: flag("clipboardWrite")?,
        game_events,
        capabilities,
    };
    if permissions.has_sensitive_capability()
        && (!permissions.network.is_empty() || permissions.clipboard_write)
    {
        return Err(ManifestError::SensitiveEgress);
    }
    Ok(permissions)
}

/// One network rule: the exact-route grammar of the Web runtime, kept
/// unchanged.
fn validate_network_rule(rule: &Value) -> Result<(), ManifestError> {
    let invalid = ManifestError::NetworkRule;
    let object = rule.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[NETWORK_RULE_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let origin = object["origin"].as_str().ok_or(invalid)?;
    if !canonical_https_origin(origin) {
        return Err(invalid);
    }
    let method = object["method"].as_str().ok_or(invalid)?;
    if !is_keyword(NETWORK_RULE_FIELDS, "method", method) {
        return Err(invalid);
    }
    let parameters = |name: &str, maximum: u64| match object.get(name) {
        None => Ok(Map::new()),
        Some(Value::Object(map)) if map.len() as u64 <= maximum => Ok(map.clone()),
        Some(_) => Err(invalid),
    };
    let path_params = parameters("pathParams", MAX_PATH_PARAMS.value)?;
    let query_params = parameters("queryParams", MAX_QUERY_PARAMS.value)?;
    let path = object["path"].as_str().ok_or(invalid)?;
    validate_route_path(path, &path_params)?;
    for constraint in path_params.values() {
        validate_constraint(constraint, false)?;
    }
    for (name, constraint) in &query_params {
        if !valid_parameter_name(name) {
            return Err(invalid);
        }
        validate_constraint(constraint, true)?;
    }
    Ok(())
}

fn validate_route_path(path: &str, parameters: &Map<String, Value>) -> Result<(), ManifestError> {
    let invalid = ManifestError::NetworkRule;
    if path.len() as u64 > MAX_NETWORK_PATH_BYTES.value
        || path.len() < 2
        || !path.starts_with('/')
        || !path.is_ascii()
        || path.contains("//")
    {
        return Err(invalid);
    }
    let mut placeholders = BTreeSet::new();
    for segment in path.strip_suffix('/').unwrap_or(path).split('/').skip(1) {
        match segment
            .strip_prefix('{')
            .and_then(|rest| rest.strip_suffix('}'))
        {
            Some(name)
                if valid_parameter_name(name)
                    && placeholders.insert(name)
                    && parameters.contains_key(name) => {}
            None if valid_literal_segment(segment) => {}
            _ => return Err(invalid),
        }
    }
    if placeholders.len() != parameters.len() {
        return Err(invalid);
    }
    Ok(())
}

fn validate_constraint(constraint: &Value, query: bool) -> Result<(), ManifestError> {
    let invalid = ManifestError::NetworkRule;
    let object = constraint.as_object().ok_or(invalid)?;
    let kind = object.get("type").and_then(Value::as_str).ok_or(invalid)?;
    if field(PARAMETER_CONSTRAINTS, kind).is_none() {
        return Err(invalid);
    }
    let expected: &[&str] = match kind {
        "integer" => &["min", "max"],
        "slug" | "string" => &["maxLength"],
        "enum" => &["values"],
        _ => return Err(invalid),
    };
    let known =
        |key: &str| key == "type" || expected.contains(&key) || (query && key == "required");
    if !object.keys().all(|key| known(key)) || !expected.iter().all(|key| object.contains_key(*key))
    {
        return Err(invalid);
    }
    if object
        .get("required")
        .is_some_and(|required| !required.is_boolean())
    {
        return Err(invalid);
    }
    match kind {
        "integer" => {
            let min = integer_in(&object["min"], 0, MAX_SAFE_INTEGER).ok_or(invalid)?;
            let max = integer_in(&object["max"], 0, MAX_SAFE_INTEGER).ok_or(invalid)?;
            if min > max {
                return Err(invalid);
            }
        }
        "slug" => {
            integer_in(
                &object["maxLength"],
                1,
                MAX_SLUG_PARAMETER_BYTES.value as i64,
            )
            .ok_or(invalid)?;
        }
        "string" => {
            if !query {
                return Err(invalid);
            }
            integer_in(
                &object["maxLength"],
                1,
                MAX_STRING_PARAMETER_BYTES.value as i64,
            )
            .ok_or(invalid)?;
        }
        _ => {
            let values = object["values"].as_array().ok_or(invalid)?;
            let mut unique = BTreeSet::new();
            if values.is_empty() || values.len() as u64 > MAX_ENUM_VALUES.value {
                return Err(invalid);
            }
            for value in values {
                let value = value.as_str().ok_or(invalid)?;
                if value.len() as u64 > MAX_ENUM_VALUE_BYTES.value
                    || !valid_literal_segment(value)
                    || !unique.insert(value)
                {
                    return Err(invalid);
                }
            }
        }
    }
    Ok(())
}

/// `https://host[:port]` exactly as a URL parser would serialize it: a
/// lowercase DNS name with at least two labels, no IP literal, no default
/// port, no user information, path, query or fragment.
fn canonical_https_origin(origin: &str) -> bool {
    let Some(authority) = origin.strip_prefix("https://") else {
        return false;
    };
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    let port_valid = port.is_none_or(|port| {
        !port.starts_with('0')
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && port.parse::<u16>().is_ok_and(|port| port != 443)
    });
    let last_label = host.rsplit('.').next().unwrap_or_default();
    // A numeric or hexadecimal last label makes a URL parser read an IPv4 address.
    let ip_like =
        last_label.bytes().all(|byte| byte.is_ascii_digit()) || last_label.starts_with("0x");
    port_valid
        && !ip_like
        && host.len() as u64 <= MAX_DNS_NAME_BYTES.value
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() as u64 <= MAX_DNS_LABEL_BYTES.value
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn valid_parameter_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() as u64 <= MAX_PARAMETER_NAME_BYTES.value
        && name.as_bytes()[0].is_ascii_alphabetic()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn valid_literal_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~'))
}

/// `overcrow.game.<segments>.v1`, the grammar of the Web runtime.
fn valid_game_event(value: &str) -> bool {
    let Some(name) = value
        .strip_prefix("overcrow.game.")
        .and_then(|value| value.strip_suffix(".v1"))
    else {
        return false;
    };
    !name.is_empty()
        && name.split('.').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('-')
                && !segment.ends_with('-')
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}
