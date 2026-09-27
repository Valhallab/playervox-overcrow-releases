//! OCWV v1 between the overlay and one widget VM (ADR 0001, D6): the framing
//! of the Web runtime's IPC with a redefined message set.
//! Any unknown frame kind, message, field or value is a `protocol_violation`.

use crate::limits::{
    MAX_ATTRIBUTE_TEXT_BYTES, MAX_CHILDREN, MAX_CONTENT_SCALE, MAX_DRAW_COMMANDS, MAX_FONT_SIZE_PX,
    MAX_HTTP_REQUEST_BYTES, MAX_HTTP_RESPONSE_BYTES, MAX_LENGTH_PX, MAX_LOG_BYTES, MAX_LOGIC_BYTES,
    MAX_NODE_TEXT_BYTES, MAX_PATCH_BYTES, MAX_PATCH_OPS, MIN_CONTENT_SCALE, MIN_FONT_SIZE_PX,
};
use crate::model::{Field, Limit, Status, ValueType};

pub const MAGIC: &[u8; 4] = b"OCWV";
/// Framing version; unchanged because no Web API peer can coexist with v1.
pub const FRAME_VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HeaderField {
    pub offset: usize,
    pub bytes: usize,
    pub name: &'static str,
    pub rule: &'static str,
}

/// Big-endian header of every frame.
pub const HEADER: &[HeaderField] = &[
    HeaderField {
        offset: 0,
        bytes: 4,
        name: "magic",
        rule: "`OCWV`.",
    },
    HeaderField {
        offset: 4,
        bytes: 2,
        name: "version",
        rule: "`1`.",
    },
    HeaderField {
        offset: 6,
        bytes: 1,
        name: "kind",
        rule: "A frame kind of the sending direction.",
    },
    HeaderField {
        offset: 7,
        bytes: 1,
        name: "reserved",
        rule: "`0`.",
    },
    HeaderField {
        offset: 8,
        bytes: 8,
        name: "sequence",
        rule: "Starts at 1 and increases by exactly 1 per frame in each direction.",
    },
    HeaderField {
        offset: 16,
        bytes: 4,
        name: "json length",
        rule: "≤ `MAX_CONTROL_JSON_BYTES`.",
    },
    HeaderField {
        offset: 20,
        bytes: 4,
        name: "raw length",
        rule: "≤ the raw limit of the frame kind; `0` when it has none.",
    },
    HeaderField {
        offset: 24,
        bytes: 4,
        name: "reserved",
        rule: "`0` (surface width in the Web API).",
    },
    HeaderField {
        offset: 28,
        bytes: 4,
        name: "reserved",
        rule: "`0` (surface height in the Web API).",
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    HostToVm,
    VmToHost,
}

impl Direction {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::HostToVm => "host → VM",
            Self::VmToHost => "VM → host",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameKind {
    pub code: u8,
    pub name: &'static str,
    pub direction: Direction,
    /// Raw payload ceiling; `None` requires a raw length of zero.
    pub raw: Option<&'static Limit>,
    pub summary: &'static str,
}

pub const FRAME_KINDS: &[FrameKind] = &[
    FrameKind {
        code: 1,
        name: "host-control",
        direction: Direction::HostToVm,
        raw: None,
        summary: "One control message.",
    },
    FrameKind {
        code: 2,
        name: "vm-control",
        direction: Direction::VmToHost,
        raw: None,
        summary: "One control message.",
    },
    FrameKind {
        code: 3,
        name: "host-init",
        direction: Direction::HostToVm,
        raw: Some(&MAX_LOGIC_BYTES),
        summary: "`Init`; raw payload is the ledger-checked `logic.js`. Always the first host frame, sent once.",
    },
    FrameKind {
        code: 4,
        name: "host-service-result",
        direction: Direction::HostToVm,
        raw: Some(&MAX_HTTP_RESPONSE_BYTES),
        summary: "`ServiceResult`; raw payload is an HTTP response body when one is returned.",
    },
    FrameKind {
        code: 5,
        name: "vm-service-call",
        direction: Direction::VmToHost,
        raw: Some(&MAX_HTTP_REQUEST_BYTES),
        summary: "`ServiceCall`; raw payload is an HTTP request body when one is sent.",
    },
    FrameKind {
        code: 6,
        name: "vm-scene-patch",
        direction: Direction::VmToHost,
        raw: Some(&MAX_PATCH_BYTES),
        summary: "`ScenePatch`; raw payload holds the operations.",
    },
    FrameKind {
        code: 7,
        name: "vm-draw",
        direction: Direction::VmToHost,
        raw: Some(&MAX_PATCH_BYTES),
        summary: "`Draw`; raw payload holds the command list.",
    },
];

/// Encoding of the `ScenePatch` and `Draw` raw payloads. JSON keeps the
/// Studio, CLI and host decoders trivially identical; ADR 0002 measured it as
/// sufficient (a 1000-node patch costs 3.3 ms end to end, mostly in the VM).
pub const PAYLOAD_ENCODING: &str = "UTF-8 JSON: an array of operation objects for `ScenePatch`, \
an array of command arrays `[name, …arguments]` for `Draw`.";
pub const PAYLOAD_ENCODING_STATUS: Status = Status::Fixed;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Message {
    pub name: &'static str,
    pub frame: u8,
    pub fields: &'static [Field],
    pub summary: &'static str,
}

const LOCALE: ValueType = ValueType::Keyword(&["en", "fr"]);
const THEME: ValueType = ValueType::Keyword(&["dark", "light"]);
const MODE: ValueType = ValueType::Keyword(&["passive", "interactive"]);
const SCALE: ValueType = ValueType::Integer {
    min: MIN_CONTENT_SCALE.value as i64,
    max: MAX_CONTENT_SCALE.value as i64,
};
const INDEX: ValueType = ValueType::Integer {
    min: 0,
    max: MAX_CHILDREN.value as i64,
};

/// Host → VM control messages carry `"type": "<Name>"` next to their fields.
pub const HOST_MESSAGES: &[Message] = &[
    Message {
        name: "Init",
        frame: 3,
        fields: &[
            Field::required(
                "apiVersion",
                ValueType::Integer { min: 1, max: 1 },
                "Widget API version.",
            ),
            Field::required(
                "generation",
                ValueType::Id,
                "VM generation; results of older generations are dropped.",
            ),
            Field::required("locale", LOCALE, "Active locale."),
            Field::required(
                "messages",
                ValueType::Record("locale messages"),
                "Messages of the active locale.",
            ),
            Field::required(
                "view",
                ValueType::Record("compiled view"),
                "The package's `view.json`, validated by the host at activation.",
            ),
            Field::required("theme", THEME, "Active theme."),
            Field::required(
                "region",
                ValueType::Record("Region"),
                "Regional formats, as in the `Region` message.",
            ),
            Field::required("scale", SCALE, "Content scale in ‰."),
            Field::required(
                "viewport",
                ValueType::Record("{ width, height }"),
                "Content rectangle, logical px.",
            ),
            Field::required("mode", MODE, "Overlay mode."),
            Field::required("visible", ValueType::Bool, "Whether the widget is shown."),
            Field::required(
                "options",
                ValueType::Record("menu values"),
                "Durable `wrapper.menu` values by row ID.",
            ),
            Field::required(
                "grants",
                ValueType::Record("capability names"),
                "Consented capabilities.",
            ),
        ],
        summary: "Starts the VM. The VM answers `Ready` within `VM_READY_TIMEOUT_MS`.",
    },
    Message {
        name: "Event",
        frame: 1,
        fields: &[
            Field::required(
                "target",
                ValueType::Keyword(&["node", "menu", "timer"]),
                "Event source.",
            ),
            Field::optional("node", ValueType::NodeRef, "`node`: subscribed node."),
            Field::optional(
                "event",
                ValueType::Record("event name"),
                "`node`: one of the node's events.",
            ),
            Field::optional("detail", ValueType::Json, "`node`: event detail."),
            Field::optional(
                "row",
                ValueType::Record("menu row ID"),
                "`menu`: `action` row.",
            ),
            Field::optional("timer", ValueType::Id, "`timer`: timer ID."),
        ],
        summary: "Input, menu action or timer tick. A gesture event's frame sequence is the only gesture token.",
    },
    Message {
        name: "ServiceResult",
        frame: 4,
        fields: &[
            Field::required("call", ValueType::Id, "`callId` of the call."),
            Field::required(
                "final",
                ValueType::Bool,
                "`false` for subscription updates.",
            ),
            Field::required(
                "outcome",
                ValueType::Keyword(&["success", "failure"]),
                "Outcome.",
            ),
            Field::optional("value", ValueType::Json, "Success value."),
            Field::optional("error", ValueType::Record("ServiceError"), "Failure code."),
        ],
        summary: "Answer or update of a service call.",
    },
    Message {
        name: "Snapshot",
        frame: 1,
        fields: &[
            Field::required(
                "viewport",
                ValueType::Record("{ width, height }"),
                "Content rectangle.",
            ),
            Field::required("scale", SCALE, "Content scale."),
            Field::required("mode", MODE, "Overlay mode."),
            Field::required(
                "options",
                ValueType::Record("menu values"),
                "Durable menu values.",
            ),
        ],
        summary: "Latest host state after a change, coalesced.",
    },
    Message {
        name: "Visibility",
        frame: 1,
        fields: &[Field::required(
            "visible",
            ValueType::Bool,
            "Shown or hidden.",
        )],
        summary: "A hidden VM keeps its state and receives no timer ticks or animation frames.",
    },
    Message {
        name: "Locale",
        frame: 1,
        fields: &[
            Field::required("locale", LOCALE, "New locale."),
            Field::required(
                "messages",
                ValueType::Record("locale messages"),
                "Its messages.",
            ),
        ],
        summary: "Locale change.",
    },
    Message {
        name: "Theme",
        frame: 1,
        fields: &[Field::required("theme", THEME, "New theme.")],
        summary: "Theme change; token values are resolved by the host.",
    },
    Message {
        name: "Region",
        frame: 1,
        fields: &[
            Field::required(
                "numberFormat",
                ValueType::Keyword(&["us", "fr", "de"]),
                "User preference, independent of the locale: `us` 1,234.5 (default), `fr` 1 234,5, `de` 1.234,5.",
            ),
            Field::required(
                "dateOrder",
                ValueType::Keyword(&["mdy", "dmy", "ymd"]),
                "User preference for numeric dates; the default follows the locale (`en` `mdy`, `fr` `dmy`).",
            ),
            Field::required(
                "offsetMinutes",
                ValueType::Integer {
                    min: -840,
                    max: 840,
                },
                "Current UTC offset of the user's time zone; VM local time is UTC (ADR 0002).",
            ),
            Field::optional(
                "nextChangeAt",
                ValueType::Integer {
                    min: 0,
                    max: 9_007_199_254_740_991,
                },
                "Unix milliseconds of the next offset change; the host sends a new `Region` then.",
            ),
        ],
        summary: "Regional formats and time zone. The SDK formats numbers, dates and times from them; timestamps in service results carry their own offset.",
    },
    Message {
        name: "Heartbeat",
        frame: 1,
        fields: &[Field::required(
            "nonce",
            ValueType::Id,
            "Echoed by `HeartbeatAck`.",
        )],
        summary: "Sent every `HEARTBEAT_INTERVAL_MS`.",
    },
    Message {
        name: "Shutdown",
        frame: 1,
        fields: &[Field::required(
            "reason",
            ValueType::Keyword(&[
                "closed",
                "disabled",
                "revoked",
                "updated",
                "game_ended",
                "host_exit",
            ]),
            "Reason.",
        )],
        summary: "Graceful stop; the host kills the process after a bounded delay.",
    },
];

pub const VM_MESSAGES: &[Message] = &[
    Message {
        name: "Ready",
        frame: 2,
        fields: &[
            Field::required(
                "apiVersion",
                ValueType::Integer { min: 1, max: 1 },
                "Must equal `Init`.",
            ),
            Field::required("sdk", ValueType::Record("semver"), "Embedded SDK version."),
        ],
        summary: "Initialization finished; the first `ScenePatch` may follow.",
    },
    Message {
        name: "ScenePatch",
        frame: 6,
        fields: &[Field::required(
            "ops",
            ValueType::Integer {
                min: 1,
                max: MAX_PATCH_OPS.value as i64,
            },
            "Number of operations in the raw payload.",
        )],
        summary: "Atomic: validated in full against the resulting scene before it is applied.",
    },
    Message {
        name: "ServiceCall",
        frame: 5,
        fields: &[
            Field::required("call", ValueType::Id, "Strictly increasing per VM."),
            Field::required(
                "service",
                ValueType::Record("service name"),
                "A service of the schema.",
            ),
            Field::required("params", ValueType::Json, "Parameters of that service."),
            Field::optional(
                "cause",
                ValueType::Id,
                "Sequence of the host frame carrying the gesture event being handled; required by gesture services.",
            ),
        ],
        summary: "Requests a host service; authority is checked by the host at each call.",
    },
    Message {
        name: "Draw",
        frame: 7,
        fields: &[
            Field::required("canvas", ValueType::NodeRef, "Target `canvas` node."),
            Field::required(
                "commands",
                ValueType::Integer {
                    min: 0,
                    max: MAX_DRAW_COMMANDS.value as i64,
                },
                "Commands in the raw payload.",
            ),
        ],
        summary: "Replaces the canvas command list.",
    },
    Message {
        name: "Log",
        frame: 2,
        fields: &[
            Field::required(
                "level",
                ValueType::Keyword(&["debug", "info", "warn", "error"]),
                "Level.",
            ),
            Field::required("text", ValueType::Text(&MAX_LOG_BYTES), "Message."),
        ],
        summary: "Development sessions only; production hosts drop it unread.",
    },
    Message {
        name: "HeartbeatAck",
        frame: 2,
        fields: &[Field::required(
            "nonce",
            ValueType::Id,
            "Nonce of the latest `Heartbeat`.",
        )],
        summary: "Missing it within `HEARTBEAT_DEADLINE_MS` is `unresponsive`.",
    },
];

/// Scene patch operations, discriminated by `"op"`. Node 0 is the host-owned
/// root `box`; the VM picks every other ID (1..2^32) and may reuse an ID only
/// after removing it.
pub const PATCH_OPS: &[Message] = &[
    Message {
        name: "create",
        frame: 6,
        fields: &[
            Field::required("node", ValueType::Id, "New node ID."),
            Field::required(
                "parent",
                ValueType::NodeRef,
                "Parent accepting this element.",
            ),
            Field::required("index", INDEX, "Position among siblings."),
            Field::required("element", ValueType::Record("element name"), "Element."),
            Field::optional(
                "attrs",
                ValueType::Record("attribute map"),
                "Initial attributes.",
            ),
            Field::optional(
                "text",
                ValueType::Text(&MAX_NODE_TEXT_BYTES),
                "Text of a text-content element.",
            ),
        ],
        summary: "Adds a node.",
    },
    Message {
        name: "remove",
        frame: 6,
        fields: &[Field::required(
            "node",
            ValueType::NodeRef,
            "Node; its subtree is removed.",
        )],
        summary: "Removes a subtree.",
    },
    Message {
        name: "move",
        frame: 6,
        fields: &[
            Field::required("node", ValueType::NodeRef, "Node."),
            Field::required(
                "parent",
                ValueType::NodeRef,
                "New parent, not inside the node.",
            ),
            Field::required("index", INDEX, "Position among siblings."),
        ],
        summary: "Reorders or reparents a node (keyed lists).",
    },
    Message {
        name: "setAttrs",
        frame: 6,
        fields: &[
            Field::required("node", ValueType::NodeRef, "Node."),
            Field::required(
                "attrs",
                ValueType::Record("attribute map"),
                "`null` removes an attribute.",
            ),
        ],
        summary: "Changes attributes, classes (`class`) and subscriptions (`on`).",
    },
    Message {
        name: "setText",
        frame: 6,
        fields: &[
            Field::required("node", ValueType::NodeRef, "Text-content node."),
            Field::required("text", ValueType::Text(&MAX_NODE_TEXT_BYTES), "Text."),
        ],
        summary: "Replaces text content.",
    },
];

const COORD: ValueType = ValueType::Number {
    min: -(MAX_LENGTH_PX.value as f64),
    max: MAX_LENGTH_PX.value as f64,
};

/// Vector commands of a `Draw` list, executed by the host inside the canvas
/// rectangle. Coordinates are logical px from the canvas origin.
pub const DRAW_COMMANDS: &[Message] = &[
    draw(
        "moveTo",
        &[req("x", COORD), req("y", COORD)],
        "Starts a subpath.",
    ),
    draw(
        "lineTo",
        &[req("x", COORD), req("y", COORD)],
        "Straight segment.",
    ),
    draw(
        "quadTo",
        &[
            req("cx", COORD),
            req("cy", COORD),
            req("x", COORD),
            req("y", COORD),
        ],
        "Quadratic Bézier segment.",
    ),
    draw(
        "cubicTo",
        &[
            req("c1x", COORD),
            req("c1y", COORD),
            req("c2x", COORD),
            req("c2y", COORD),
            req("x", COORD),
            req("y", COORD),
        ],
        "Cubic Bézier segment.",
    ),
    draw(
        "arc",
        &[
            req("cx", COORD),
            req("cy", COORD),
            req("r", COORD),
            req(
                "start",
                ValueType::Number {
                    min: -720.0,
                    max: 720.0,
                },
            ),
            req(
                "end",
                ValueType::Number {
                    min: -720.0,
                    max: 720.0,
                },
            ),
        ],
        "Circular arc in degrees, clockwise.",
    ),
    draw(
        "rect",
        &[
            req("x", COORD),
            req("y", COORD),
            req("w", COORD),
            req("h", COORD),
            req("radius", COORD),
        ],
        "Closed rounded-rectangle subpath.",
    ),
    draw(
        "circle",
        &[req("cx", COORD), req("cy", COORD), req("r", COORD)],
        "Closed circle subpath.",
    ),
    draw("close", &[], "Closes the subpath."),
    draw(
        "fill",
        &[req("color", ValueType::Record("<color>"))],
        "Fills and clears the current path.",
    ),
    draw(
        "stroke",
        &[
            req("color", ValueType::Record("<color>")),
            req(
                "width",
                ValueType::Number {
                    min: 0.0,
                    max: 256.0,
                },
            ),
        ],
        "Strokes and clears the current path.",
    ),
    draw(
        "text",
        &[
            req("x", COORD),
            req("y", COORD),
            req("text", ValueType::Text(&MAX_ATTRIBUTE_TEXT_BYTES)),
            req(
                "size",
                ValueType::Number {
                    min: MIN_FONT_SIZE_PX.value as f64,
                    max: MAX_FONT_SIZE_PX.value as f64,
                },
            ),
            req("color", ValueType::Record("<color>")),
            req("align", ValueType::Keyword(&["start", "center", "end"])),
            req("family", ValueType::Keyword(&["ui", "mono", "display"])),
            req("weight", ValueType::Keyword(&["400", "500", "600", "700"])),
        ],
        "One line of text on its baseline.",
    ),
    draw(
        "image",
        &[
            req("src", ValueType::ImageSource),
            req("x", COORD),
            req("y", COORD),
            req("w", COORD),
            req("h", COORD),
        ],
        "Draws an image scaled into the rectangle.",
    ),
    draw(
        "save",
        &[],
        "Pushes transform, clip and alpha, ≤ `MAX_DRAW_STATE_DEPTH`.",
    ),
    draw("restore", &[], "Pops the state; unbalanced is a violation."),
    draw(
        "clip",
        &[
            req("x", COORD),
            req("y", COORD),
            req("w", COORD),
            req("h", COORD),
        ],
        "Intersects the clip rectangle.",
    ),
    draw(
        "translate",
        &[req("x", COORD), req("y", COORD)],
        "Translates.",
    ),
    draw(
        "rotate",
        &[req(
            "degrees",
            ValueType::Number {
                min: -360.0,
                max: 360.0,
            },
        )],
        "Rotates.",
    ),
    draw(
        "scale",
        &[
            req("x", ValueType::Number { min: 0.0, max: 8.0 }),
            req("y", ValueType::Number { min: 0.0, max: 8.0 }),
        ],
        "Scales.",
    ),
    draw(
        "alpha",
        &[req("value", ValueType::Number { min: 0.0, max: 1.0 })],
        "Multiplies opacity.",
    ),
];

const fn req(name: &'static str, ty: ValueType) -> Field {
    Field::required(name, ty, "")
}

const fn draw(name: &'static str, fields: &'static [Field], summary: &'static str) -> Message {
    Message {
        name,
        frame: 7,
        fields,
        summary,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Failure {
    pub name: &'static str,
    /// Transient failures restart with 1/5/15 s backoff, at most three times,
    /// reset after 60 s of stable run; others need explicit reactivation.
    pub restarts: bool,
    pub summary: &'static str,
}

/// The only failure categories recorded in production diagnostics.
pub const FAILURES: &[Failure] = &[
    Failure {
        name: "invalid_bundle",
        restarts: false,
        summary: "Package, ledger or compiled content rejected.",
    },
    Failure {
        name: "permission_denied",
        restarts: false,
        summary: "Declared, consented and requested authority disagree.",
    },
    Failure {
        name: "protocol_violation",
        restarts: false,
        summary: "Malformed, unknown or out-of-order IPC or scene data.",
    },
    Failure {
        name: "resource_limit",
        restarts: true,
        summary: "A memory, CPU, queue, rate or size ceiling was exceeded.",
    },
    Failure {
        name: "unresponsive",
        restarts: true,
        summary: "Missed `Ready` or heartbeat deadline, or turn budget exceeded.",
    },
    Failure {
        name: "vm_exited",
        restarts: true,
        summary: "The VM process ended unexpectedly.",
    },
];
