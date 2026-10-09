//! Every numeric bound of widget API v1. Code reads `limits::NAME.value`; the
//! reference documentation is generated from [`ALL`].
//!
//! The VM budgets decided by ADR 0002 from the P0.3 measurements are fixed.
//! Bounds that P0.3 did not measure stay provisional for the phase 1 lot that
//! exercises them. The contractual ceiling is 80 MiB per widget, VM process
//! and renderer share included; the engineering target is 8 MB private.

use crate::model::{Limit, Status, Unit};

const KIB: u64 = 1024;
const MIB: u64 = 1024 * 1024;

const fn fixed(key: &'static str, value: u64, unit: Unit, summary: &'static str) -> Limit {
    Limit {
        key,
        value,
        unit,
        status: Status::Fixed,
        summary,
    }
}

const fn pending(
    status: Status,
    key: &'static str,
    value: u64,
    unit: Unit,
    summary: &'static str,
) -> Limit {
    Limit {
        key,
        value,
        unit,
        status,
        summary,
    }
}

// Package sources. The package container itself is specified by P0.5.
pub const MAX_VIEW_SOURCE_BYTES: Limit = fixed(
    "MAX_VIEW_SOURCE_BYTES",
    256 * KIB,
    Unit::Bytes,
    "`view.ocml` source size.",
);
pub const MAX_STYLE_SOURCE_BYTES: Limit = fixed(
    "MAX_STYLE_SOURCE_BYTES",
    128 * KIB,
    Unit::Bytes,
    "`style.ocss` source size.",
);
pub const MAX_LOGIC_BYTES: Limit = fixed(
    "MAX_LOGIC_BYTES",
    512 * KIB,
    Unit::Bytes,
    "`logic.js` source, compiled template code included; bounds parse time and heap at start (ADR 0002).",
);
pub const MAX_LOCALE_ENTRIES: Limit = fixed(
    "MAX_LOCALE_ENTRIES",
    2048,
    Unit::Count,
    "Messages in one `locales/<locale>.json` file.",
);
pub const MAX_LOCALE_KEY_BYTES: Limit = fixed(
    "MAX_LOCALE_KEY_BYTES",
    128,
    Unit::Bytes,
    "Length of one message key.",
);
pub const MAX_LOCALE_VALUE_BYTES: Limit = fixed(
    "MAX_LOCALE_VALUE_BYTES",
    4 * KIB,
    Unit::Bytes,
    "Length of one message text.",
);
pub const MAX_LOCALE_FILE_BYTES: Limit = fixed(
    "MAX_LOCALE_FILE_BYTES",
    256 * KIB,
    Unit::Bytes,
    "One `locales/<locale>.json` file; the active one travels in `Init` with the compiled view.",
);

// Package container `.ocpkg` v1 (P0.5, `docs/widget-package-v1.md`).
pub const MAX_PACKAGE_BYTES: Limit = fixed(
    "MAX_PACKAGE_BYTES",
    16 * MIB,
    Unit::Bytes,
    "Size of one `.ocpkg` archive, download and offline seed included.",
);
pub const MAX_PACKAGE_FILES: Limit = fixed(
    "MAX_PACKAGE_FILES",
    256,
    Unit::Count,
    "Entries in one archive, `manifest.json` and `ledger.json` included.",
);
pub const MAX_PACKAGE_PATH_BYTES: Limit = fixed(
    "MAX_PACKAGE_PATH_BYTES",
    128,
    Unit::Bytes,
    "Path of one archive entry.",
);
pub const MAX_ASSET_PATH_SEGMENTS: Limit = fixed(
    "MAX_ASSET_PATH_SEGMENTS",
    4,
    Unit::Count,
    "Path segments below `assets/`, the file name included.",
);
pub const MAX_MANIFEST_BYTES: Limit = fixed(
    "MAX_MANIFEST_BYTES",
    64 * KIB,
    Unit::Bytes,
    "`manifest.json` size.",
);
pub const MAX_LEDGER_BYTES: Limit = fixed(
    "MAX_LEDGER_BYTES",
    64 * KIB,
    Unit::Bytes,
    "`ledger.json` size; holds `MAX_PACKAGE_FILES` entries at the longest path.",
);
pub const MAX_COMPILED_VIEW_BYTES: Limit = fixed(
    "MAX_COMPILED_VIEW_BYTES",
    512 * KIB,
    Unit::Bytes,
    "`view.json`, the compiled view; it travels in the `Init` control JSON.",
);
pub const MAX_LICENSE_BYTES: Limit = fixed(
    "MAX_LICENSE_BYTES",
    64 * KIB,
    Unit::Bytes,
    "`LICENSE` text.",
);
pub const MIN_WIDGET_ID_BYTES: Limit = fixed(
    "MIN_WIDGET_ID_BYTES",
    3,
    Unit::Bytes,
    "Shortest widget ID, as today.",
);
pub const MAX_WIDGET_ID_BYTES: Limit = fixed(
    "MAX_WIDGET_ID_BYTES",
    128,
    Unit::Bytes,
    "Longest widget ID, as today; each dot-separated segment is at most 63 bytes.",
);
pub const MAX_VERSION_BYTES: Limit = fixed(
    "MAX_VERSION_BYTES",
    64,
    Unit::Bytes,
    "Package version text.",
);
pub const MAX_WIDGET_NAME_CHARS: Limit = fixed(
    "MAX_WIDGET_NAME_CHARS",
    48,
    Unit::Characters,
    "One EN or FR widget name in the manifest.",
);

// Signed catalog and offline seed (P0.5; the pipeline and production key are P4.2).
pub const MAX_CATALOG_BYTES: Limit = fixed(
    "MAX_CATALOG_BYTES",
    MIB,
    Unit::Bytes,
    "Signed envelope of the catalog or of the offline seed, as today.",
);
pub const MAX_CATALOG_PAYLOAD_BYTES: Limit = fixed(
    "MAX_CATALOG_PAYLOAD_BYTES",
    700 * KIB,
    Unit::Bytes,
    "Decoded signed payload; its Base64 form fits `MAX_CATALOG_BYTES`, as today.",
);
pub const MAX_CATALOG_TARGETS: Limit = fixed(
    "MAX_CATALOG_TARGETS",
    500,
    Unit::Count,
    "Package versions listed by one catalog or seed, as today.",
);
pub const MAX_CATALOG_LIFETIME_DAYS: Limit = fixed(
    "MAX_CATALOG_LIFETIME_DAYS",
    90,
    Unit::Days,
    "Longest `expiresAt - generatedAt` of a production catalog, as today.",
);
pub const MAX_SEED_LIFETIME_DAYS: Limit = fixed(
    "MAX_SEED_LIFETIME_DAYS",
    365,
    Unit::Days,
    "Longest `expiresAt - generatedAt` of the offline seed shipped with an application release.",
);
pub const MAX_CATALOG_CLOCK_SKEW_MS: Limit = fixed(
    "MAX_CATALOG_CLOCK_SKEW_MS",
    300_000,
    Unit::Milliseconds,
    "Tolerated lead of `generatedAt` over the host clock, as today.",
);
pub const MAX_KEY_ID_BYTES: Limit = fixed(
    "MAX_KEY_ID_BYTES",
    64,
    Unit::Bytes,
    "Signing key ID, as today.",
);
pub const MAX_TRUST_KEYS: Limit = fixed(
    "MAX_TRUST_KEYS",
    8,
    Unit::Count,
    "Catalog public keys trusted by one host at once (rotation), as today.",
);
pub const MAX_CATALOG_URL_BYTES: Limit = fixed(
    "MAX_CATALOG_URL_BYTES",
    2 * KIB,
    Unit::Bytes,
    "Package, preview or source URL in a catalog target, as today.",
);
pub const MAX_PREVIEW_BYTES: Limit = fixed(
    "MAX_PREVIEW_BYTES",
    256 * KIB,
    Unit::Bytes,
    "PNG preview image of a catalog target, as today.",
);
pub const MAX_LISTING_LOCALIZATIONS: Limit = fixed(
    "MAX_LISTING_LOCALIZATIONS",
    16,
    Unit::Count,
    "Localized listing texts of one target, as today.",
);
pub const MAX_LISTING_NAME_BYTES: Limit = fixed(
    "MAX_LISTING_NAME_BYTES",
    128,
    Unit::Bytes,
    "Marketplace name of one localization, as today.",
);
pub const MAX_LISTING_DESCRIPTION_BYTES: Limit = fixed(
    "MAX_LISTING_DESCRIPTION_BYTES",
    512,
    Unit::Bytes,
    "Marketplace description of one localization, as today.",
);
pub const MAX_AUTHOR_BYTES: Limit = fixed(
    "MAX_AUTHOR_BYTES",
    128,
    Unit::Bytes,
    "Author shown in a listing, as today.",
);
pub const MAX_SPDX_LICENSE_BYTES: Limit = fixed(
    "MAX_SPDX_LICENSE_BYTES",
    64,
    Unit::Bytes,
    "SPDX license expression of a listing, as today.",
);

// Publishers and widget ID ownership (CR.1).
pub const MIN_HANDLE_BYTES: Limit = fixed(
    "MIN_HANDLE_BYTES",
    3,
    Unit::Bytes,
    "Shortest publisher handle; it also keeps every two-letter country extension out of the handles.",
);
pub const MAX_HANDLE_BYTES: Limit = fixed(
    "MAX_HANDLE_BYTES",
    32,
    Unit::Bytes,
    "Longest publisher handle.",
);
pub const MAX_PUBLISHER_DOMAINS: Limit = fixed(
    "MAX_PUBLISHER_DOMAINS",
    8,
    Unit::Count,
    "Domains under which one publisher owns widget IDs.",
);

// Signed catalog v2 (CR.1). An application in the field never changes its
// bounds, so they leave room for the whole third-party catalog.
pub const MAX_CATALOG_V2_BYTES: Limit = fixed(
    "MAX_CATALOG_V2_BYTES",
    4 * MIB,
    Unit::Bytes,
    "Signed envelope of the catalog v2.",
);
pub const MAX_CATALOG_V2_PAYLOAD_BYTES: Limit = fixed(
    "MAX_CATALOG_V2_PAYLOAD_BYTES",
    3000 * KIB,
    Unit::Bytes,
    "Decoded signed payload of the catalog v2; its Base64 form fits `MAX_CATALOG_V2_BYTES`.",
);
pub const MAX_CATALOG_V2_TARGETS: Limit = fixed(
    "MAX_CATALOG_V2_TARGETS",
    2000,
    Unit::Count,
    "Package versions listed by one catalog v2.",
);
pub const MAX_CATALOG_V2_WIDGETS: Limit = fixed(
    "MAX_CATALOG_V2_WIDGETS",
    1000,
    Unit::Count,
    "Widget entries of one catalog v2.",
);
pub const MAX_CATALOG_PUBLISHERS: Limit = fixed(
    "MAX_CATALOG_PUBLISHERS",
    1000,
    Unit::Count,
    "Publisher entries of one catalog v2.",
);
pub const MAX_CATALOG_CATEGORIES: Limit = fixed(
    "MAX_CATALOG_CATEGORIES",
    32,
    Unit::Count,
    "Categories of one catalog v2, `other` included.",
);
pub const MAX_CATEGORY_ID_BYTES: Limit =
    fixed("MAX_CATEGORY_ID_BYTES", 32, Unit::Bytes, "Category ID.");
pub const MAX_CATEGORY_LABEL_CHARS: Limit = fixed(
    "MAX_CATEGORY_LABEL_CHARS",
    32,
    Unit::Characters,
    "One localized category label: a filter or a chip.",
);
pub const MAX_PUBLISHER_NAME_CHARS: Limit = fixed(
    "MAX_PUBLISHER_NAME_CHARS",
    64,
    Unit::Characters,
    "Displayed publisher name, one line of a card.",
);
pub const MAX_LISTING_DESCRIPTION_CHARS: Limit = fixed(
    "MAX_LISTING_DESCRIPTION_CHARS",
    500,
    Unit::Characters,
    "Listing description of one locale in the catalog v2.",
);
pub const MAX_RELEASE_NOTES_CHARS: Limit = fixed(
    "MAX_RELEASE_NOTES_CHARS",
    500,
    Unit::Characters,
    "Release notes of one version in one locale.",
);
pub const MAX_LISTING_GAMES: Limit = fixed(
    "MAX_LISTING_GAMES",
    5,
    Unit::Count,
    "PlayerVox games a widget is listed for.",
);
pub const MAX_GAME_NAME_CHARS: Limit = fixed(
    "MAX_GAME_NAME_CHARS",
    100,
    Unit::Characters,
    "Game name copied from the PlayerVox games database; longer names are shortened by the catalog producer.",
);
pub const MAX_GAME_SLUG_BYTES: Limit = fixed(
    "MAX_GAME_SLUG_BYTES",
    128,
    Unit::Bytes,
    "Slug of a game page on playervox.com.",
);
pub const MAX_SUPPORT_EMAIL_BYTES: Limit = fixed(
    "MAX_SUPPORT_EMAIL_BYTES",
    254,
    Unit::Bytes,
    "Public support e-mail address of a listing.",
);
pub const MAX_REQUIRED_FEATURES: Limit = fixed(
    "MAX_REQUIRED_FEATURES",
    8,
    Unit::Count,
    "Feature names of one `requires` list.",
);
pub const MAX_FEATURE_NAME_BYTES: Limit = fixed(
    "MAX_FEATURE_NAME_BYTES",
    32,
    Unit::Bytes,
    "One feature name of a `requires` list.",
);

// View source and templates.
pub const MAX_VIEW_ELEMENTS: Limit = fixed(
    "MAX_VIEW_ELEMENTS",
    4096,
    Unit::Count,
    "Elements written in `view.ocml`, components included.",
);
pub const MAX_COMPONENTS: Limit = fixed(
    "MAX_COMPONENTS",
    64,
    Unit::Count,
    "Local components declared in one view.",
);
pub const MAX_EXPRESSION_BYTES: Limit = fixed(
    "MAX_EXPRESSION_BYTES",
    KIB,
    Unit::Bytes,
    "Source length of one `{expr}` template expression.",
);
pub const MAX_VIEW_EXPRESSIONS: Limit = fixed(
    "MAX_VIEW_EXPRESSIONS",
    4096,
    Unit::Count,
    "Compiled template expressions of one view, handlers included.",
);
pub const MAX_COMPONENT_PROPS: Limit = fixed(
    "MAX_COMPONENT_PROPS",
    32,
    Unit::Count,
    "Declared props of one local component.",
);
pub const MAX_EXPRESSION_DEPTH: Limit = fixed(
    "MAX_EXPRESSION_DEPTH",
    32,
    Unit::Count,
    "Nesting of operators, calls, members and literals in one template expression.",
);
pub const MAX_CALL_ARGUMENTS: Limit = fixed(
    "MAX_CALL_ARGUMENTS",
    8,
    Unit::Count,
    "Arguments of one call, and entries of one object or array literal, in a template expression.",
);

// Retained scene, enforced on every patch.
pub const MAX_SCENE_NODES: Limit = fixed(
    "MAX_SCENE_NODES",
    4096,
    Unit::Count,
    "Live nodes in one widget scene, list items included.",
);
pub const MAX_TREE_DEPTH: Limit = fixed(
    "MAX_TREE_DEPTH",
    32,
    Unit::Count,
    "Depth of the scene tree below the root, also the template nesting limit.",
);
pub const MAX_CHILDREN: Limit = fixed("MAX_CHILDREN", 1024, Unit::Count, "Children of one node.");
pub const MAX_NODE_TEXT_BYTES: Limit = fixed(
    "MAX_NODE_TEXT_BYTES",
    16 * KIB,
    Unit::Bytes,
    "Text content of one `text`, `span`, `badge` or `option` node.",
);
pub const MAX_ATTRIBUTE_TEXT_BYTES: Limit = fixed(
    "MAX_ATTRIBUTE_TEXT_BYTES",
    KIB,
    Unit::Bytes,
    "Any text attribute not bounded more tightly.",
);
pub const MAX_LABEL_BYTES: Limit = fixed(
    "MAX_LABEL_BYTES",
    256,
    Unit::Bytes,
    "`label`, `tooltip` and `placeholder` attributes.",
);
pub const MAX_IDENTIFIER_BYTES: Limit = fixed(
    "MAX_IDENTIFIER_BYTES",
    64,
    Unit::Bytes,
    "Class names, component names, field names, keyframe names and similar identifiers.",
);
pub const MAX_INITIALS_BYTES: Limit = fixed(
    "MAX_INITIALS_BYTES",
    16,
    Unit::Bytes,
    "`initials` fallback of an `avatar`.",
);
pub const MAX_CLASSES_PER_NODE: Limit = fixed(
    "MAX_CLASSES_PER_NODE",
    16,
    Unit::Count,
    "Classes on one node.",
);
pub const MAX_FIELD_TEXT_BYTES: Limit = fixed(
    "MAX_FIELD_TEXT_BYTES",
    16 * KIB,
    Unit::Bytes,
    "Content of one `field` or `textarea`, and of one `input`/`change` event.",
);
pub const MAX_CHART_POINTS: Limit = fixed(
    "MAX_CHART_POINTS",
    1024,
    Unit::Count,
    "Values in one chart series.",
);
pub const MAX_CHART_SERIES: Limit = fixed(
    "MAX_CHART_SERIES",
    4,
    Unit::Count,
    "`series` children of one `chart`.",
);

// Style.
pub const MAX_STYLE_RULES: Limit = fixed(
    "MAX_STYLE_RULES",
    1024,
    Unit::Count,
    "Rules in one style sheet, keyframe blocks excluded.",
);
pub const MAX_SELECTORS_PER_RULE: Limit = fixed(
    "MAX_SELECTORS_PER_RULE",
    8,
    Unit::Count,
    "Comma-separated selectors of one rule.",
);
pub const MAX_COMPOUNDS_PER_SELECTOR: Limit = fixed(
    "MAX_COMPOUNDS_PER_SELECTOR",
    4,
    Unit::Count,
    "Compound selectors joined by combinators in one selector.",
);
pub const MAX_SIMPLE_SELECTORS_PER_COMPOUND: Limit = fixed(
    "MAX_SIMPLE_SELECTORS_PER_COMPOUND",
    6,
    Unit::Count,
    "Type, class and state selectors in one compound selector.",
);
pub const MAX_DECLARATIONS_PER_RULE: Limit = fixed(
    "MAX_DECLARATIONS_PER_RULE",
    64,
    Unit::Count,
    "Declarations in one rule or keyframe stop.",
);
pub const MAX_KEYFRAMES: Limit = fixed(
    "MAX_KEYFRAMES",
    32,
    Unit::Count,
    "`@keyframes` blocks in one style sheet.",
);
pub const MAX_KEYFRAME_STOPS: Limit = fixed(
    "MAX_KEYFRAME_STOPS",
    16,
    Unit::Count,
    "Stops in one `@keyframes` block.",
);
pub const MAX_SHADOWS: Limit = fixed(
    "MAX_SHADOWS",
    2,
    Unit::Count,
    "Layers in one `box-shadow` value.",
);
pub const MAX_SHADOW_BLUR_PX: Limit = fixed(
    "MAX_SHADOW_BLUR_PX",
    64,
    Unit::Pixels,
    "Blur and spread radius of one shadow.",
);
pub const MAX_GRADIENT_STOPS: Limit = fixed(
    "MAX_GRADIENT_STOPS",
    8,
    Unit::Count,
    "Colour stops in one `linear-gradient()`.",
);
pub const MAX_GRID_TRACKS: Limit = fixed(
    "MAX_GRID_TRACKS",
    24,
    Unit::Count,
    "Tracks in one `grid-template-rows` or `grid-template-columns`.",
);
pub const MAX_GRID_FRACTION: Limit = fixed(
    "MAX_GRID_FRACTION",
    1000,
    Unit::Magnitude,
    "Largest `<fr>` factor of one grid track.",
);
pub const MAX_TRANSITIONS: Limit = fixed(
    "MAX_TRANSITIONS",
    8,
    Unit::Count,
    "Entries in one `transition` or `animation` list.",
);
pub const MAX_ANIMATION_MS: Limit = fixed(
    "MAX_ANIMATION_MS",
    300_000,
    Unit::Milliseconds,
    "Duration or delay of one transition or animation; covers the 120 s Twitch passive fade.",
);
pub const MAX_ACTIVE_ANIMATIONS: Limit = fixed(
    "MAX_ACTIVE_ANIMATIONS",
    64,
    Unit::Count,
    "Transitions and animations running at once in one widget; extra ones jump to their end state.",
);
pub const ANIMATION_RATE_HZ: Limit = fixed(
    "ANIMATION_RATE_HZ",
    60,
    Unit::Hertz,
    "Maximum repaint rate while an animation runs; nothing repaints when nothing changes.",
);
pub const MAX_LENGTH_PX: Limit = fixed(
    "MAX_LENGTH_PX",
    16_384,
    Unit::Pixels,
    "Absolute value of any length, offset or coordinate.",
);
pub const MIN_FONT_SIZE_PX: Limit = fixed(
    "MIN_FONT_SIZE_PX",
    6,
    Unit::Pixels,
    "Smallest `font-size` before content scale.",
);
pub const MAX_FONT_SIZE_PX: Limit = fixed(
    "MAX_FONT_SIZE_PX",
    96,
    Unit::Pixels,
    "Largest `font-size` before content scale.",
);
pub const MAX_PERCENT: Limit = fixed(
    "MAX_PERCENT",
    1000,
    Unit::Magnitude,
    "Absolute value of any `<percent>` in a style value.",
);
pub const MAX_ANGLE_DEG: Limit = fixed(
    "MAX_ANGLE_DEG",
    3600,
    Unit::Magnitude,
    "Absolute value of any `<angle>`, in degrees (ten turns).",
);
pub const MAX_TRANSFORM_FUNCTIONS: Limit = fixed(
    "MAX_TRANSFORM_FUNCTIONS",
    4,
    Unit::Count,
    "Functions in one `transform` value.",
);
pub const MAX_TRANSFORM_SCALE: Limit = fixed(
    "MAX_TRANSFORM_SCALE",
    8,
    Unit::Magnitude,
    "Largest `scale()` factor; the smallest is 0.",
);
pub const MAX_EASING_STEPS: Limit = fixed(
    "MAX_EASING_STEPS",
    60,
    Unit::Count,
    "Steps of one `steps()` easing.",
);
pub const MAX_ANIMATION_ITERATIONS: Limit = fixed(
    "MAX_ANIMATION_ITERATIONS",
    10_000,
    Unit::Count,
    "Finite iteration count of one animation; `infinite` stays allowed.",
);

// Vector drawing on `canvas`.
pub const MAX_CANVASES: Limit = fixed(
    "MAX_CANVASES",
    8,
    Unit::Count,
    "`canvas` nodes in one widget.",
);
pub const MAX_DRAW_COMMANDS: Limit = pending(
    Status::P1_3,
    "MAX_DRAW_COMMANDS",
    4096,
    Unit::Count,
    "Commands in one `Draw` message, replacing the canvas content.",
);
pub const MAX_PATH_POINTS: Limit = fixed(
    "MAX_PATH_POINTS",
    16_384,
    Unit::Count,
    "Vertices the host draws for one `Draw` message, all paths included, counted with a fixed ceiling per command that the renderer's adaptive flattening never exceeds: `moveTo` and `lineTo` 1, `quadTo` 8, `cubicTo` 16, `arc` and `circle` 64, `rect` 36, other commands 0.",
);
pub const MAX_DRAW_STATE_DEPTH: Limit = fixed(
    "MAX_DRAW_STATE_DEPTH",
    16,
    Unit::Count,
    "Nested `save` commands.",
);

// Rendering and assets (trusted renderer share of the per-widget contract).
pub const MAX_IMAGE_EDGE_PX: Limit = fixed(
    "MAX_IMAGE_EDGE_PX",
    2048,
    Unit::Pixels,
    "Width or height of one decoded image.",
);
pub const MAX_IMAGE_ENCODED_BYTES: Limit = fixed(
    "MAX_IMAGE_ENCODED_BYTES",
    2 * MIB,
    Unit::Bytes,
    "Encoded size of one PNG, JPEG or WebP image before decoding.",
);
pub const MAX_WIDGET_TEXTURE_BYTES: Limit = fixed(
    "MAX_WIDGET_TEXTURE_BYTES",
    16 * MIB,
    Unit::Bytes,
    "Decoded image textures cached for one widget (LRU).",
);
pub const MAX_GLOBAL_TEXTURE_BYTES: Limit = fixed(
    "MAX_GLOBAL_TEXTURE_BYTES",
    128 * MIB,
    Unit::Bytes,
    "Decoded image textures cached for all widgets (LRU).",
);
pub const MAX_GLYPH_ATLAS_BYTES: Limit = fixed(
    "MAX_GLYPH_ATLAS_BYTES",
    4 * MIB,
    Unit::Bytes,
    "Glyph atlas shared by all widgets: four 512 × 512 RGBA8 pages; the least recently used page is cleared when none has room.",
);
pub const MAX_WIDGET_EDGE_PX: Limit = fixed(
    "MAX_WIDGET_EDGE_PX",
    4096,
    Unit::Pixels,
    "Width or height of a widget container.",
);
pub const MIN_CONTENT_SCALE: Limit = fixed(
    "MIN_CONTENT_SCALE",
    500,
    Unit::Permille,
    "Smallest content scale (50 %).",
);
pub const MAX_CONTENT_SCALE: Limit = fixed(
    "MAX_CONTENT_SCALE",
    1750,
    Unit::Permille,
    "Largest content scale (175 %).",
);

// Input.
pub const MAX_KEY_BYTES: Limit = fixed(
    "MAX_KEY_BYTES",
    32,
    Unit::Bytes,
    "`key` of one `keydown` event: one grapheme or a named key.",
);

// VM process: budgets decided by ADR 0002 from the P0.3 measurements.
pub const VM_HEAP_BYTES: Limit = fixed(
    "VM_HEAP_BYTES",
    16 * MIB,
    Unit::Bytes,
    "Default QuickJS heap ceiling (`JS_SetMemoryLimit`) when the manifest requests none.",
);
pub const VM_MAX_HEAP_BYTES: Limit = fixed(
    "VM_MAX_HEAP_BYTES",
    48 * MIB,
    Unit::Bytes,
    "Largest heap ceiling a manifest may request; the process ceiling keeps 16 MiB for the runtime and IPC buffers.",
);
pub const VM_STACK_BYTES: Limit = fixed(
    "VM_STACK_BYTES",
    256 * KIB,
    Unit::Bytes,
    "QuickJS stack ceiling (`JS_SetMaxStackSize`).",
);
pub const VM_TURN_BUDGET_MS: Limit = fixed(
    "VM_TURN_BUDGET_MS",
    50,
    Unit::Milliseconds,
    "Wall time of one host-to-VM turn before the interrupt handler stops it.",
);
pub const VM_JOBS_PER_TURN: Limit = fixed(
    "VM_JOBS_PER_TURN",
    1024,
    Unit::Count,
    "Promise jobs drained in one turn; a longer queue is a resource failure.",
);
pub const VM_EVENT_QUEUE: Limit = fixed(
    "VM_EVENT_QUEUE",
    256,
    Unit::Count,
    "Host messages waiting for one VM; the host coalesces updates beyond it.",
);
pub const VM_PROCESS_MEMORY_BYTES: Limit = fixed(
    "VM_PROCESS_MEMORY_BYTES",
    64 * MIB,
    Unit::Bytes,
    "Hard memory ceiling of one VM process: cgroup `memory.max` on Linux, Job Object memory limit on Windows.",
);
pub const VM_MESSAGES_PER_TURN: Limit = fixed(
    "VM_MESSAGES_PER_TURN",
    64,
    Unit::Count,
    "Messages the VM may emit during one host turn (ADR 0002).",
);
pub const VM_ADDRESS_SPACE_BYTES: Limit = fixed(
    "VM_ADDRESS_SPACE_BYTES",
    512 * MIB,
    Unit::Bytes,
    "Linux address-space rlimit of one VM process (ADR 0002); virtual reservations, not resident memory.",
);
pub const VM_CPU_PERCENT: Limit = fixed(
    "VM_CPU_PERCENT",
    25,
    Unit::PercentOfCore,
    "CPU ceiling of one VM process: cgroup `cpu.max` of 5 ms per 20 ms period on Linux (the default 100 ms period caused false `unresponsive` faults), Job Object hard CPU rate on Windows.",
);
pub const VM_TURN_WATCHDOG_MS: Limit = fixed(
    "VM_TURN_WATCHDOG_MS",
    100,
    Unit::Milliseconds,
    "Wall time the host allows between the last frame of a turn and the VM's acknowledgement; catches a turn stuck outside the QuickJS interrupt (measured worst heavy turn under the CPU ceiling: 30.6 ms).",
);
pub const VM_TURNS_IN_FLIGHT: Limit = fixed(
    "VM_TURNS_IN_FLIGHT",
    8,
    Unit::Count,
    "Turns the host sends ahead of the VM's acknowledgement; beyond it, host messages wait in the coalescing queue.",
);
pub const VM_READY_TIMEOUT_MS: Limit = fixed(
    "VM_READY_TIMEOUT_MS",
    1000,
    Unit::Milliseconds,
    "Deadline between process start and `Ready`; measured p50 is 4.5 ms on Linux and 11.7 ms on Windows, and the acceptance target stays 150 ms warm.",
);
pub const MAX_TIMERS: Limit = fixed(
    "MAX_TIMERS",
    16,
    Unit::Count,
    "Active host-managed timers of one widget.",
);
pub const MIN_TIMER_INTERVAL_MS: Limit = fixed(
    "MIN_TIMER_INTERVAL_MS",
    100,
    Unit::Milliseconds,
    "Shortest timer period; animation belongs to style, not to timers.",
);
pub const CLOCK_RESOLUTION_MS: Limit = fixed(
    "CLOCK_RESOLUTION_MS",
    1,
    Unit::Milliseconds,
    "Granularity of `Date.now()` and `performance.now()` inside the VM.",
);

// IPC.
pub const MAX_CONTROL_JSON_BYTES: Limit = fixed(
    "MAX_CONTROL_JSON_BYTES",
    MIB,
    Unit::Bytes,
    "JSON control part of one frame, unchanged from the Web runtime (ADR 0002).",
);
pub const MAX_PATCH_BYTES: Limit = fixed(
    "MAX_PATCH_BYTES",
    256 * KIB,
    Unit::Bytes,
    "Raw payload of one `ScenePatch` or `Draw` frame.",
);
pub const MAX_PATCH_OPS: Limit = fixed(
    "MAX_PATCH_OPS",
    4096,
    Unit::Count,
    "Operations in one `ScenePatch`; a 1000-node patch measured 3.3 ms end to end, so this ceiling stays well inside one turn.",
);
pub const MAX_VM_MESSAGES_PER_SECOND: Limit = fixed(
    "MAX_VM_MESSAGES_PER_SECOND",
    120,
    Unit::PerSecond,
    "Sustained VM-to-host message rate (token bucket).",
);
pub const MAX_VM_MESSAGE_BURST: Limit = fixed(
    "MAX_VM_MESSAGE_BURST",
    240,
    Unit::Count,
    "Token bucket capacity of the VM-to-host message rate.",
);
pub const MAX_QUEUED_BYTES: Limit = fixed(
    "MAX_QUEUED_BYTES",
    4 * MIB,
    Unit::Bytes,
    "Bytes queued in either direction for one widget; holds the largest frame (control JSON plus raw payload).",
);
pub const HEARTBEAT_INTERVAL_MS: Limit = fixed(
    "HEARTBEAT_INTERVAL_MS",
    1000,
    Unit::Milliseconds,
    "Period of host `Heartbeat` messages.",
);
pub const HEARTBEAT_DEADLINE_MS: Limit = fixed(
    "HEARTBEAT_DEADLINE_MS",
    3000,
    Unit::Milliseconds,
    "Deadline for the matching `HeartbeatAck`; missing it is `unresponsive`.",
);
pub const MAX_LOG_BYTES: Limit = fixed(
    "MAX_LOG_BYTES",
    4 * KIB,
    Unit::Bytes,
    "Text of one development `Log` message.",
);

// Services.
pub const MAX_SERVICE_CALLS_IN_FLIGHT: Limit = fixed(
    "MAX_SERVICE_CALLS_IN_FLIGHT",
    16,
    Unit::Count,
    "Unanswered service calls of one widget, subscriptions excluded.",
);
pub const MAX_SUBSCRIPTIONS: Limit = fixed(
    "MAX_SUBSCRIPTIONS",
    16,
    Unit::Count,
    "Open service subscriptions of one widget.",
);
pub const STORAGE_QUOTA_BYTES: Limit = fixed(
    "STORAGE_QUOTA_BYTES",
    256 * KIB,
    Unit::Bytes,
    "Keys and values stored by one widget.",
);
pub const MAX_STORAGE_KEYS: Limit = fixed(
    "MAX_STORAGE_KEYS",
    512,
    Unit::Count,
    "Keys stored by one widget.",
);
pub const MAX_STORAGE_KEY_BYTES: Limit = fixed(
    "MAX_STORAGE_KEY_BYTES",
    128,
    Unit::Bytes,
    "Length of one storage key.",
);
pub const MAX_STORAGE_VALUE_BYTES: Limit = fixed(
    "MAX_STORAGE_VALUE_BYTES",
    64 * KIB,
    Unit::Bytes,
    "Serialized JSON size of one storage value.",
);
pub const MAX_CLIPBOARD_BYTES: Limit = fixed(
    "MAX_CLIPBOARD_BYTES",
    16 * KIB,
    Unit::Bytes,
    "Text of one clipboard write.",
);
pub const MAX_NETWORK_RULES: Limit = fixed(
    "MAX_NETWORK_RULES",
    32,
    Unit::Count,
    "Network rules declared by one package.",
);
pub const MAX_REQUEST_URL_BYTES: Limit = fixed(
    "MAX_REQUEST_URL_BYTES",
    2048,
    Unit::Bytes,
    "Original URL text of one request, as today.",
);
pub const MAX_HTTP_REQUEST_BYTES: Limit = fixed(
    "MAX_HTTP_REQUEST_BYTES",
    256 * KIB,
    Unit::Bytes,
    "Body of one outgoing request.",
);
pub const MAX_HTTP_RESPONSE_BYTES: Limit = fixed(
    "MAX_HTTP_RESPONSE_BYTES",
    MIB,
    Unit::Bytes,
    "Body of one response delivered to the VM when its network rule declares no `maxResponseBytes`, and of every `as: \"image\"` response; must fit the VM heap.",
);
pub const MAX_HTTP_DECLARED_RESPONSE_BYTES: Limit = fixed(
    "MAX_HTTP_DECLARED_RESPONSE_BYTES",
    3 * MIB,
    Unit::Bytes,
    "Largest `maxResponseBytes` of one network rule: the body of one response the rule allows, delivered to the VM; must fit the VM heap and, with its control part, the frame queue.",
);
pub const MAX_HTTP_RESPONSE_BYTES_PER_WIDGET: Limit = fixed(
    "MAX_HTTP_RESPONSE_BYTES_PER_WIDGET",
    4 * MIB,
    Unit::Bytes,
    "Response bytes one widget's requests in flight may reserve, each the bound of its rule; `busy` beyond. Equals `MAX_HTTP_CONCURRENT_PER_WIDGET` × `MAX_HTTP_RESPONSE_BYTES`, so rules without `maxResponseBytes` never reach it.",
);
pub const MAX_HTTP_RESPONSE_BYTES_GLOBAL: Limit = fixed(
    "MAX_HTTP_RESPONSE_BYTES_GLOBAL",
    64 * MIB,
    Unit::Bytes,
    "Response bytes all widgets' requests in flight may reserve; `busy` beyond. Equals `MAX_HTTP_CONCURRENT_GLOBAL` × `MAX_HTTP_RESPONSE_BYTES`, the worst case before declared bounds existed.",
);
pub const MAX_HTTP_CONCURRENT_PER_WIDGET: Limit = fixed(
    "MAX_HTTP_CONCURRENT_PER_WIDGET",
    4,
    Unit::Count,
    "Requests in flight for one widget.",
);
pub const MAX_HTTP_CONCURRENT_GLOBAL: Limit = fixed(
    "MAX_HTTP_CONCURRENT_GLOBAL",
    64,
    Unit::Count,
    "Requests in flight for all widgets.",
);
pub const HTTP_TIMEOUT_MS: Limit = fixed(
    "HTTP_TIMEOUT_MS",
    30_000,
    Unit::Milliseconds,
    "Total duration of one request, as today.",
);
pub const MAX_NETWORK_PATH_BYTES: Limit = fixed(
    "MAX_NETWORK_PATH_BYTES",
    1024,
    Unit::Bytes,
    "`path` template of one network rule, as today.",
);
pub const MAX_PATH_PARAMS: Limit = fixed(
    "MAX_PATH_PARAMS",
    8,
    Unit::Count,
    "`pathParams` of one network rule, as today.",
);
pub const MAX_QUERY_PARAMS: Limit = fixed(
    "MAX_QUERY_PARAMS",
    16,
    Unit::Count,
    "`queryParams` of one network rule, as today.",
);
pub const MAX_ENUM_VALUES: Limit = fixed(
    "MAX_ENUM_VALUES",
    32,
    Unit::Count,
    "Values of one `enum` parameter constraint, as today.",
);
pub const MAX_ENUM_VALUE_BYTES: Limit = fixed(
    "MAX_ENUM_VALUE_BYTES",
    128,
    Unit::Bytes,
    "One `enum` parameter value, as today.",
);
pub const MAX_PARAMETER_NAME_BYTES: Limit = fixed(
    "MAX_PARAMETER_NAME_BYTES",
    32,
    Unit::Bytes,
    "Name of one path or query parameter, as today.",
);
pub const MAX_SLUG_PARAMETER_BYTES: Limit = fixed(
    "MAX_SLUG_PARAMETER_BYTES",
    128,
    Unit::Bytes,
    "Largest `maxLength` of a `slug` parameter constraint, as today.",
);
pub const MAX_STRING_PARAMETER_BYTES: Limit = fixed(
    "MAX_STRING_PARAMETER_BYTES",
    256,
    Unit::Bytes,
    "Largest `maxLength` of a `string` query parameter constraint, as today.",
);
pub const MAX_DNS_LABEL_BYTES: Limit = fixed(
    "MAX_DNS_LABEL_BYTES",
    63,
    Unit::Bytes,
    "One dot-separated label of a network origin host or of a widget ID.",
);
pub const MAX_DNS_NAME_BYTES: Limit = fixed(
    "MAX_DNS_NAME_BYTES",
    253,
    Unit::Bytes,
    "Host name of one network origin.",
);
pub const MAX_OBJECT_ID_BYTES: Limit = fixed(
    "MAX_OBJECT_ID_BYTES",
    128,
    Unit::Bytes,
    "Opaque object ID or cursor exchanged with a capability service.",
);
pub const MAX_GAME_EVENTS: Limit = fixed(
    "MAX_GAME_EVENTS",
    32,
    Unit::Count,
    "Semantic game events declared by one package.",
);

// Write intents: the current built-in limits, confirmed by the P0.6 audit.
pub const MAX_NOTES: Limit = fixed(
    "MAX_NOTES",
    8,
    Unit::Count,
    "Notes in the user's notes document; `notes.create` fails beyond it.",
);
pub const MAX_NOTE_TITLE_BYTES: Limit = fixed(
    "MAX_NOTE_TITLE_BYTES",
    96,
    Unit::Bytes,
    "Note title, non-empty after trimming.",
);
pub const MAX_NOTE_BODY_BYTES: Limit =
    fixed("MAX_NOTE_BODY_BYTES", 8 * KIB, Unit::Bytes, "Note body.");
pub const MAX_NOTE_ITEMS: Limit = fixed(
    "MAX_NOTE_ITEMS",
    64,
    Unit::Count,
    "Checklist items of one note.",
);
pub const MAX_NOTE_ITEM_BYTES: Limit = fixed(
    "MAX_NOTE_ITEM_BYTES",
    256,
    Unit::Bytes,
    "One checklist item.",
);
pub const MAX_REVIEW_CHARS: Limit = fixed(
    "MAX_REVIEW_CHARS",
    2000,
    Unit::Characters,
    "PlayerVox review text, as enforced by the editor, the host and the PlayerVox API.",
);
pub const MAX_CHAT_MESSAGE_CHARS: Limit = fixed(
    "MAX_CHAT_MESSAGE_CHARS",
    500,
    Unit::Characters,
    "Twitch chat message, the Twitch limit; not empty or whitespace-only, no control characters.",
);
pub const MAX_CHAT_FRAGMENTS: Limit = fixed(
    "MAX_CHAT_FRAGMENTS",
    16,
    Unit::Count,
    "Text and emote runs of one delivered chat message; the host merges the rest into text, keeping 200 messages within `MAX_SCENE_NODES`.",
);
pub const MAX_CHAT_FAVORITES: Limit = fixed(
    "MAX_CHAT_FAVORITES",
    20,
    Unit::Count,
    "Favourite Twitch channels kept by the host, as today.",
);
pub const MAX_CHAT_CHANNEL_BYTES: Limit = fixed(
    "MAX_CHAT_CHANNEL_BYTES",
    25,
    Unit::Bytes,
    "Twitch channel login after normalization: ASCII letters, digits and `_`, lowercased.",
);

// Wrapper options menu (ADR 0001, D12). Host rows are not counted.
pub const MAX_MENU_ROWS: Limit = fixed(
    "MAX_MENU_ROWS",
    16,
    Unit::Count,
    "Widget rows in `wrapper.menu`, group rows and their children included.",
);
pub const MAX_MENU_DEPTH: Limit = fixed(
    "MAX_MENU_DEPTH",
    1,
    Unit::Count,
    "Submenu levels: a `group` cannot contain another `group`.",
);
pub const MAX_MENU_LABEL_CHARS: Limit = fixed(
    "MAX_MENU_LABEL_CHARS",
    80,
    Unit::Characters,
    "One EN or FR label of a row or choice, as today.",
);
pub const MAX_MENU_ID_BYTES: Limit = fixed(
    "MAX_MENU_ID_BYTES",
    48,
    Unit::Bytes,
    "Row ID and choice value, as today.",
);
pub const MIN_MENU_CHOICES: Limit = fixed(
    "MIN_MENU_CHOICES",
    2,
    Unit::Count,
    "Choices of one `choice` row, lower bound.",
);
pub const MAX_MENU_CHOICES: Limit = fixed(
    "MAX_MENU_CHOICES",
    16,
    Unit::Count,
    "Choices of one `choice` row, upper bound.",
);
pub const MAX_MENU_NUMBER: Limit = fixed(
    "MAX_MENU_NUMBER",
    1_000_000,
    Unit::Magnitude,
    "Absolute value of a slider bound, step or default, as today.",
);
pub const MAX_SLIDER_STEPS: Limit = fixed(
    "MAX_SLIDER_STEPS",
    10_000,
    Unit::Count,
    "`(max - min) / step` of one slider row.",
);

// Studio and native reference-image parity (acceptance criterion), measured
// by the P0.4 spike (ADR 0003): images are compared as straight RGBA8 and
// rendered without dithering.
pub const PARITY_CHANNEL_TOLERANCE: Limit = fixed(
    "PARITY_CHANNEL_TOLERANCE",
    2,
    Unit::Levels,
    "Largest per-channel difference for a pixel to count as equal across Linux, Windows and Studio reference images, rendered without dithering; GPU and llvmpipe renderers measured at most 2 (ADR 0003).",
);
pub const PARITY_MAX_DIFFERENT_PIXELS: Limit = fixed(
    "PARITY_MAX_DIFFERENT_PIXELS",
    100,
    Unit::PartsPerMillion,
    "Share of pixels allowed beyond the channel tolerance. Measured renderer noise is 0 to 11 ppm; one wrong 10 px letter in a 360 × 260 widget is 385 ppm (ADR 0003).",
);

pub const ALL: &[&Limit] = &[
    &MAX_VIEW_SOURCE_BYTES,
    &MAX_STYLE_SOURCE_BYTES,
    &MAX_LOGIC_BYTES,
    &MAX_LOCALE_ENTRIES,
    &MAX_LOCALE_KEY_BYTES,
    &MAX_LOCALE_VALUE_BYTES,
    &MAX_LOCALE_FILE_BYTES,
    &MAX_PACKAGE_BYTES,
    &MAX_PACKAGE_FILES,
    &MAX_PACKAGE_PATH_BYTES,
    &MAX_ASSET_PATH_SEGMENTS,
    &MAX_MANIFEST_BYTES,
    &MAX_LEDGER_BYTES,
    &MAX_COMPILED_VIEW_BYTES,
    &MAX_LICENSE_BYTES,
    &MIN_WIDGET_ID_BYTES,
    &MAX_WIDGET_ID_BYTES,
    &MAX_VERSION_BYTES,
    &MAX_WIDGET_NAME_CHARS,
    &MAX_CATALOG_BYTES,
    &MAX_CATALOG_PAYLOAD_BYTES,
    &MAX_CATALOG_TARGETS,
    &MAX_CATALOG_LIFETIME_DAYS,
    &MAX_SEED_LIFETIME_DAYS,
    &MAX_CATALOG_CLOCK_SKEW_MS,
    &MAX_KEY_ID_BYTES,
    &MAX_TRUST_KEYS,
    &MAX_CATALOG_URL_BYTES,
    &MAX_PREVIEW_BYTES,
    &MAX_LISTING_LOCALIZATIONS,
    &MAX_LISTING_NAME_BYTES,
    &MAX_LISTING_DESCRIPTION_BYTES,
    &MAX_AUTHOR_BYTES,
    &MAX_SPDX_LICENSE_BYTES,
    &MIN_HANDLE_BYTES,
    &MAX_HANDLE_BYTES,
    &MAX_PUBLISHER_DOMAINS,
    &MAX_CATALOG_V2_BYTES,
    &MAX_CATALOG_V2_PAYLOAD_BYTES,
    &MAX_CATALOG_V2_TARGETS,
    &MAX_CATALOG_V2_WIDGETS,
    &MAX_CATALOG_PUBLISHERS,
    &MAX_CATALOG_CATEGORIES,
    &MAX_CATEGORY_ID_BYTES,
    &MAX_CATEGORY_LABEL_CHARS,
    &MAX_PUBLISHER_NAME_CHARS,
    &MAX_LISTING_DESCRIPTION_CHARS,
    &MAX_RELEASE_NOTES_CHARS,
    &MAX_LISTING_GAMES,
    &MAX_GAME_NAME_CHARS,
    &MAX_GAME_SLUG_BYTES,
    &MAX_SUPPORT_EMAIL_BYTES,
    &MAX_REQUIRED_FEATURES,
    &MAX_FEATURE_NAME_BYTES,
    &MAX_VIEW_ELEMENTS,
    &MAX_COMPONENTS,
    &MAX_EXPRESSION_BYTES,
    &MAX_VIEW_EXPRESSIONS,
    &MAX_COMPONENT_PROPS,
    &MAX_EXPRESSION_DEPTH,
    &MAX_CALL_ARGUMENTS,
    &MAX_SCENE_NODES,
    &MAX_TREE_DEPTH,
    &MAX_CHILDREN,
    &MAX_NODE_TEXT_BYTES,
    &MAX_ATTRIBUTE_TEXT_BYTES,
    &MAX_LABEL_BYTES,
    &MAX_IDENTIFIER_BYTES,
    &MAX_INITIALS_BYTES,
    &MAX_CLASSES_PER_NODE,
    &MAX_FIELD_TEXT_BYTES,
    &MAX_CHART_POINTS,
    &MAX_CHART_SERIES,
    &MAX_STYLE_RULES,
    &MAX_SELECTORS_PER_RULE,
    &MAX_COMPOUNDS_PER_SELECTOR,
    &MAX_SIMPLE_SELECTORS_PER_COMPOUND,
    &MAX_DECLARATIONS_PER_RULE,
    &MAX_KEYFRAMES,
    &MAX_KEYFRAME_STOPS,
    &MAX_SHADOWS,
    &MAX_SHADOW_BLUR_PX,
    &MAX_GRADIENT_STOPS,
    &MAX_GRID_TRACKS,
    &MAX_GRID_FRACTION,
    &MAX_TRANSITIONS,
    &MAX_ANIMATION_MS,
    &MAX_ACTIVE_ANIMATIONS,
    &ANIMATION_RATE_HZ,
    &MAX_LENGTH_PX,
    &MIN_FONT_SIZE_PX,
    &MAX_FONT_SIZE_PX,
    &MAX_PERCENT,
    &MAX_ANGLE_DEG,
    &MAX_TRANSFORM_FUNCTIONS,
    &MAX_TRANSFORM_SCALE,
    &MAX_EASING_STEPS,
    &MAX_ANIMATION_ITERATIONS,
    &MAX_CANVASES,
    &MAX_DRAW_COMMANDS,
    &MAX_PATH_POINTS,
    &MAX_DRAW_STATE_DEPTH,
    &MAX_IMAGE_EDGE_PX,
    &MAX_IMAGE_ENCODED_BYTES,
    &MAX_WIDGET_TEXTURE_BYTES,
    &MAX_GLOBAL_TEXTURE_BYTES,
    &MAX_GLYPH_ATLAS_BYTES,
    &MAX_WIDGET_EDGE_PX,
    &MIN_CONTENT_SCALE,
    &MAX_CONTENT_SCALE,
    &MAX_KEY_BYTES,
    &VM_HEAP_BYTES,
    &VM_MAX_HEAP_BYTES,
    &VM_STACK_BYTES,
    &VM_TURN_BUDGET_MS,
    &VM_JOBS_PER_TURN,
    &VM_EVENT_QUEUE,
    &VM_PROCESS_MEMORY_BYTES,
    &VM_MESSAGES_PER_TURN,
    &VM_ADDRESS_SPACE_BYTES,
    &VM_CPU_PERCENT,
    &VM_TURN_WATCHDOG_MS,
    &VM_TURNS_IN_FLIGHT,
    &VM_READY_TIMEOUT_MS,
    &MAX_TIMERS,
    &MIN_TIMER_INTERVAL_MS,
    &CLOCK_RESOLUTION_MS,
    &MAX_CONTROL_JSON_BYTES,
    &MAX_PATCH_BYTES,
    &MAX_PATCH_OPS,
    &MAX_VM_MESSAGES_PER_SECOND,
    &MAX_VM_MESSAGE_BURST,
    &MAX_QUEUED_BYTES,
    &HEARTBEAT_INTERVAL_MS,
    &HEARTBEAT_DEADLINE_MS,
    &MAX_LOG_BYTES,
    &MAX_SERVICE_CALLS_IN_FLIGHT,
    &MAX_SUBSCRIPTIONS,
    &STORAGE_QUOTA_BYTES,
    &MAX_STORAGE_KEYS,
    &MAX_STORAGE_KEY_BYTES,
    &MAX_STORAGE_VALUE_BYTES,
    &MAX_CLIPBOARD_BYTES,
    &MAX_NETWORK_RULES,
    &MAX_REQUEST_URL_BYTES,
    &MAX_HTTP_REQUEST_BYTES,
    &MAX_HTTP_RESPONSE_BYTES,
    &MAX_HTTP_DECLARED_RESPONSE_BYTES,
    &MAX_HTTP_RESPONSE_BYTES_PER_WIDGET,
    &MAX_HTTP_RESPONSE_BYTES_GLOBAL,
    &MAX_HTTP_CONCURRENT_PER_WIDGET,
    &MAX_HTTP_CONCURRENT_GLOBAL,
    &HTTP_TIMEOUT_MS,
    &MAX_NETWORK_PATH_BYTES,
    &MAX_PATH_PARAMS,
    &MAX_QUERY_PARAMS,
    &MAX_ENUM_VALUES,
    &MAX_ENUM_VALUE_BYTES,
    &MAX_PARAMETER_NAME_BYTES,
    &MAX_SLUG_PARAMETER_BYTES,
    &MAX_STRING_PARAMETER_BYTES,
    &MAX_DNS_LABEL_BYTES,
    &MAX_DNS_NAME_BYTES,
    &MAX_OBJECT_ID_BYTES,
    &MAX_GAME_EVENTS,
    &MAX_NOTES,
    &MAX_NOTE_TITLE_BYTES,
    &MAX_NOTE_BODY_BYTES,
    &MAX_NOTE_ITEMS,
    &MAX_NOTE_ITEM_BYTES,
    &MAX_REVIEW_CHARS,
    &MAX_CHAT_MESSAGE_CHARS,
    &MAX_CHAT_FRAGMENTS,
    &MAX_CHAT_FAVORITES,
    &MAX_CHAT_CHANNEL_BYTES,
    &MAX_MENU_ROWS,
    &MAX_MENU_DEPTH,
    &MAX_MENU_LABEL_CHARS,
    &MAX_MENU_ID_BYTES,
    &MIN_MENU_CHOICES,
    &MAX_MENU_CHOICES,
    &MAX_MENU_NUMBER,
    &MAX_SLIDER_STEPS,
    &PARITY_CHANNEL_TOLERANCE,
    &PARITY_MAX_DIFFERENT_PIXELS,
];

// Relations between bounds, checked at compile time so that no edit can ship
// an inconsistent schema.
const _: () = {
    // ADR 0001: at most 80 MiB per widget, VM process and renderer share included.
    assert!(VM_PROCESS_MEMORY_BYTES.value + MAX_WIDGET_TEXTURE_BYTES.value <= 80 * MIB);
    assert!(VM_HEAP_BYTES.value <= VM_MAX_HEAP_BYTES.value);
    // The largest heap leaves room for the runtime and the largest frames.
    assert!(VM_MAX_HEAP_BYTES.value + MAX_QUEUED_BYTES.value < VM_PROCESS_MEMORY_BYTES.value);
    assert!(MAX_HTTP_RESPONSE_BYTES.value <= MAX_HTTP_DECLARED_RESPONSE_BYTES.value);
    assert!(MAX_HTTP_DECLARED_RESPONSE_BYTES.value < VM_HEAP_BYTES.value);
    // Response budgets: the largest declared bound fits one widget's budget,
    // and undeclared rules alone never reach either budget, so the worst
    // case of bytes in flight is the one before declared bounds.
    assert!(MAX_HTTP_DECLARED_RESPONSE_BYTES.value <= MAX_HTTP_RESPONSE_BYTES_PER_WIDGET.value);
    assert!(
        MAX_HTTP_CONCURRENT_PER_WIDGET.value * MAX_HTTP_RESPONSE_BYTES.value
            == MAX_HTTP_RESPONSE_BYTES_PER_WIDGET.value
    );
    assert!(
        MAX_HTTP_CONCURRENT_GLOBAL.value * MAX_HTTP_RESPONSE_BYTES.value
            == MAX_HTTP_RESPONSE_BYTES_GLOBAL.value
    );
    assert!(MAX_LOGIC_BYTES.value < VM_HEAP_BYTES.value);
    assert!(VM_PROCESS_MEMORY_BYTES.value < VM_ADDRESS_SPACE_BYTES.value);
    assert!(VM_MESSAGES_PER_TURN.value <= MAX_VM_MESSAGE_BURST.value);
    // The queue holds the largest frame: control JSON plus the largest raw payload.
    assert!(
        MAX_CONTROL_JSON_BYTES.value + MAX_HTTP_DECLARED_RESPONSE_BYTES.value
            <= MAX_QUEUED_BYTES.value
    );
    assert!(MAX_CONTROL_JSON_BYTES.value + MAX_LOGIC_BYTES.value <= MAX_QUEUED_BYTES.value);
    assert!(MAX_CONTROL_JSON_BYTES.value + MAX_PATCH_BYTES.value <= MAX_QUEUED_BYTES.value);
    assert!(HEARTBEAT_INTERVAL_MS.value < HEARTBEAT_DEADLINE_MS.value);
    assert!(VM_TURN_BUDGET_MS.value < VM_TURN_WATCHDOG_MS.value);
    assert!(VM_TURN_WATCHDOG_MS.value < HEARTBEAT_DEADLINE_MS.value);
    assert!(VM_TURNS_IN_FLIGHT.value <= VM_EVENT_QUEUE.value);
    assert!(MAX_VM_MESSAGES_PER_SECOND.value <= MAX_VM_MESSAGE_BURST.value);
    assert!(MIN_CONTENT_SCALE.value < MAX_CONTENT_SCALE.value);
    assert!(MIN_FONT_SIZE_PX.value < MAX_FONT_SIZE_PX.value);
    assert!(MIN_MENU_CHOICES.value <= MAX_MENU_CHOICES.value);
    assert!(MAX_WIDGET_TEXTURE_BYTES.value <= MAX_GLOBAL_TEXTURE_BYTES.value);
    assert!(MAX_HTTP_CONCURRENT_PER_WIDGET.value <= MAX_HTTP_CONCURRENT_GLOBAL.value);
    // One decoded image at the edge limit fits the per-widget texture cache.
    assert!(
        MAX_IMAGE_EDGE_PX.value * MAX_IMAGE_EDGE_PX.value * 4 <= MAX_WIDGET_TEXTURE_BYTES.value
    );
    // The Twitch passive fade lasts up to 120 s.
    assert!(MAX_ANIMATION_MS.value >= 120_000);
    // Every write-intent text fits one host-owned field (4 bytes per character).
    assert!(MAX_NOTE_BODY_BYTES.value <= MAX_FIELD_TEXT_BYTES.value);
    assert!(MAX_REVIEW_CHARS.value * 4 <= MAX_FIELD_TEXT_BYTES.value);
    assert!(MAX_CHAT_MESSAGE_CHARS.value * 4 <= MAX_FIELD_TEXT_BYTES.value);
    // The compiled view and the active locale travel together in `Init`.
    assert!(
        MAX_COMPILED_VIEW_BYTES.value + MAX_LOCALE_FILE_BYTES.value < MAX_CONTROL_JSON_BYTES.value
    );
    assert!(MAX_MANIFEST_BYTES.value + MAX_LEDGER_BYTES.value < MAX_PACKAGE_BYTES.value);
    assert!(MAX_LOGIC_BYTES.value + MAX_COMPILED_VIEW_BYTES.value < MAX_PACKAGE_BYTES.value);
    assert!(MAX_IMAGE_ENCODED_BYTES.value < MAX_PACKAGE_BYTES.value);
    // Base64 without padding of the largest payload fits the envelope.
    assert!(MAX_CATALOG_PAYLOAD_BYTES.value.div_ceil(3) * 4 < MAX_CATALOG_BYTES.value);
    assert!(MAX_CATALOG_LIFETIME_DAYS.value < MAX_SEED_LIFETIME_DAYS.value);
    assert!(MIN_WIDGET_ID_BYTES.value < MAX_WIDGET_ID_BYTES.value);
    assert!(MAX_DNS_LABEL_BYTES.value < MAX_DNS_NAME_BYTES.value);
    assert!(MAX_WIDGET_ID_BYTES.value + MAX_VERSION_BYTES.value < MAX_CATALOG_URL_BYTES.value);
    // A handle plus a one-letter name fits a widget ID.
    assert!(MIN_HANDLE_BYTES.value < MAX_HANDLE_BYTES.value);
    assert!(MAX_HANDLE_BYTES.value + 2 <= MAX_WIDGET_ID_BYTES.value);
    // Catalog v2: Base64 without padding of the largest payload fits the
    // envelope with its other fields; each widget has a target and each
    // publisher a widget.
    assert!(
        MAX_CATALOG_V2_PAYLOAD_BYTES.value.div_ceil(3) * 4 + 4 * KIB < MAX_CATALOG_V2_BYTES.value
    );
    assert!(MAX_CATALOG_V2_PAYLOAD_BYTES.value >= MAX_CATALOG_PAYLOAD_BYTES.value);
    assert!(MAX_CATALOG_V2_WIDGETS.value <= MAX_CATALOG_V2_TARGETS.value);
    assert!(MAX_CATALOG_PUBLISHERS.value <= MAX_CATALOG_V2_WIDGETS.value);
    assert!(MAX_CATALOG_CATEGORIES.value >= 7);
};
