//! Internal consistency of the schema tables and freshness of the generated
//! reference. These checks stand in for review of every table edit.

use std::collections::BTreeSet;

use overcrow_widget_schema::{
    Status, Unit, ValueType, icons, ipc, is_supported_api_version, limits, permissions, reference,
    services, style, tokens, view, wrapper,
};

fn assert_unique<'a>(what: &str, names: impl IntoIterator<Item = &'a str>) {
    let mut seen = BTreeSet::new();
    for name in names {
        assert!(seen.insert(name), "duplicate {what}: {name}");
    }
}

#[test]
fn only_api_version_one_is_supported() {
    assert!(is_supported_api_version(1));
    assert!(!is_supported_api_version(0));
    assert!(!is_supported_api_version(2));
}

#[test]
fn limits_are_unique_positive_and_name_their_lot() {
    assert_unique("limit", limits::ALL.iter().map(|limit| limit.key));
    for limit in limits::ALL {
        assert!(limit.value > 0, "{} must be positive", limit.key);
        assert!(
            limit
                .key
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_'),
            "{} is not a constant name",
            limit.key
        );
        if let Status::Provisional { lot } = limit.status {
            assert!(
                ["P1.3", "P1.8", "P2.4"].contains(&lot),
                "{}: unknown lot {lot}",
                limit.key
            );
        }
    }
}

#[test]
fn adr_0003_parity_bounds_are_fixed_at_their_measured_values() {
    for (limit, value, unit) in [
        (&limits::PARITY_CHANNEL_TOLERANCE, 2, Unit::Levels),
        (
            &limits::PARITY_MAX_DIFFERENT_PIXELS,
            100,
            Unit::PartsPerMillion,
        ),
    ] {
        assert_eq!(limit.value, value, "{}", limit.key);
        assert_eq!(limit.unit, unit, "{}", limit.key);
        assert!(limit.status.is_fixed(), "{} must be fixed", limit.key);
    }
}

#[test]
fn adr_0002_budgets_are_fixed_at_their_decided_values() {
    const KIB: u64 = 1024;
    const MIB: u64 = 1024 * KIB;
    for (limit, value) in [
        (&limits::VM_HEAP_BYTES, 16 * MIB),
        (&limits::VM_MAX_HEAP_BYTES, 48 * MIB),
        (&limits::VM_PROCESS_MEMORY_BYTES, 64 * MIB),
        (&limits::VM_STACK_BYTES, 256 * KIB),
        (&limits::VM_TURN_BUDGET_MS, 50),
        (&limits::VM_JOBS_PER_TURN, 1024),
        (&limits::VM_MESSAGES_PER_TURN, 64),
        (&limits::MAX_PATCH_BYTES, 256 * KIB),
        (&limits::MAX_LOGIC_BYTES, 512 * KIB),
        (&limits::MAX_CONTROL_JSON_BYTES, MIB),
        (&limits::VM_ADDRESS_SPACE_BYTES, 512 * MIB),
    ] {
        assert_eq!(limit.value, value, "{}", limit.key);
        assert_eq!(limit.status, Status::Fixed, "{}", limit.key);
    }
    assert!(ipc::PAYLOAD_ENCODING_STATUS == Status::Fixed);
}

#[test]
fn elements_are_closed_and_self_consistent() {
    assert_unique("element", view::ELEMENTS.iter().map(|element| element.name));
    assert_unique("event", view::EVENTS.iter().map(|event| event.name));
    let common: BTreeSet<_> = view::COMMON_ATTRIBUTES
        .iter()
        .map(|field| field.name)
        .collect();
    for element in view::ELEMENTS {
        assert_unique(
            element.name,
            element.attributes.iter().map(|field| field.name),
        );
        for attribute in element.attributes {
            assert!(
                !common.contains(attribute.name),
                "{} redefines {}",
                element.name,
                attribute.name
            );
        }
        for event in element.events {
            assert!(
                view::event(event).is_some(),
                "{}: unknown event {event}",
                element.name
            );
        }
        if element.focus == view::Focus::WhenSubscribed {
            assert!(
                element.events.contains(&"activate") || element.events.contains(&"keydown"),
                "{} can never be focused",
                element.name
            );
        }
        if element.events.contains(&"activate") {
            assert_ne!(
                element.focus,
                view::Focus::Never,
                "{} is not keyboard-reachable",
                element.name
            );
        }
        if let view::Content::Only(children) = element.content {
            for child in children {
                let child = view::element(child).expect("allowed child exists");
                assert_eq!(
                    child.parents,
                    [element.name],
                    "{} must require its parent",
                    child.name
                );
            }
        }
        for parent in element.parents {
            let parent = view::element(parent).expect("parent exists");
            let accepts = match parent.content {
                view::Content::Only(children) => children.contains(&element.name),
                view::Content::Inline => element.name == "span",
                _ => false,
            };
            assert!(accepts, "{} does not accept {}", parent.name, element.name);
        }
    }
    let root = view::element("box").expect("the scene root is a box");
    assert_eq!(root.content, view::Content::Flow);
}

#[test]
fn style_tables_are_closed_and_resolve_tokens() {
    assert_unique(
        "property",
        style::PROPERTIES.iter().map(|property| property.name),
    );
    let paint_only = [
        "background-color",
        "border-color",
        "color",
        "opacity",
        "transform",
    ];
    for property in style::PROPERTIES {
        assert_eq!(
            property.animatable,
            paint_only.contains(&property.name),
            "{}: animation must never rerun layout",
            property.name
        );
        if let Some(token) = property
            .initial
            .strip_prefix("var(")
            .and_then(|value| value.strip_suffix(')'))
        {
            assert!(
                tokens::token(token).is_some(),
                "{}: unknown token {token}",
                property.name
            );
        }
    }
    for pseudo in style::PSEUDO_CLASSES {
        assert!(style::SELECTORS[2].syntax.contains(&format!(":{pseudo}")));
    }
}

#[test]
fn tokens_are_unique_and_well_formed() {
    assert_unique("token", tokens::TOKENS.iter().map(|token| token.name));
    for token in tokens::TOKENS {
        assert!(token.name.starts_with("--"), "{}", token.name);
        if token.ty == tokens::TokenType::Color {
            for value in [token.dark, token.light] {
                let hex = value.strip_prefix('#').expect("colour tokens are hex");
                assert!(matches!(hex.len(), 6 | 8), "{}: {value}", token.name);
                assert!(
                    hex.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                );
            }
        }
        if token.ty == tokens::TokenType::Shadow {
            for value in [token.dark, token.light] {
                assert!(
                    tokens::parse_shadow(value).is_some(),
                    "{}: {value}",
                    token.name
                );
            }
        }
    }
    assert_eq!(
        tokens::parse_shadow("0px 4px 16px 0px #00000066"),
        Some(tokens::TokenShadow {
            x: 0.0,
            y: 4.0,
            blur: 16.0,
            spread: 0.0,
            rgba: [0, 0, 0, 0x66],
        })
    );
    for invalid in [
        "0px 4px 16px #00000066",
        "0px 4px -1px 0px #00000066",
        "0 4px 16px 0px #00000066",
        "0px 4px 16px 0px #000000",
        "0px  4px 16px 0px #00000066",
        "0px 4px 16px 0px #0000006G",
    ] {
        assert_eq!(tokens::parse_shadow(invalid), None, "{invalid}");
    }
}

/// WCAG 2 relative luminance of an opaque `#rrggbb` colour.
fn relative_luminance(hex: &str) -> f64 {
    let hex = hex.strip_prefix('#').expect("colour tokens are hex");
    assert_eq!(hex.len(), 6, "contrast is only defined for opaque colours");
    let channel = |index: usize| {
        let value = f64::from(u8::from_str_radix(&hex[index..index + 2], 16).expect("hex"));
        let value = value / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

fn contrast(a: &str, b: &str) -> f64 {
    let (a, b) = (relative_luminance(a), relative_luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

#[test]
fn on_accent_keeps_aa_contrast_on_the_accent_in_both_themes() {
    let on_accent = tokens::token("--color-on-accent").expect("on-accent token");
    assert!(on_accent.status.is_fixed(), "fixed by the P0.6 audit");
    for background in ["--color-accent", "--color-accent-hover"] {
        let background = tokens::token(background).expect("accent token");
        for (foreground, fill) in [
            (on_accent.dark, background.dark),
            (on_accent.light, background.light),
        ] {
            let ratio = contrast(foreground, fill);
            assert!(
                ratio >= 4.5,
                "{} on {}: {foreground} on {fill} is {ratio:.2}:1",
                on_accent.name,
                background.name
            );
        }
    }
}

/// The panel and text colours fixed by the P2.4 pilots, and the warning and
/// danger colours fixed by the Performance rewrite (P3.2), keep WCAG AA
/// contrast for text in both themes (compared with the panel's colour).
#[test]
fn text_keeps_aa_contrast_on_the_panel_in_both_themes() {
    let panel = tokens::token("--color-surface-panel").expect("panel token");
    for name in [
        "--color-text",
        "--color-text-muted",
        "--color-warning",
        "--color-danger",
    ] {
        let text = tokens::token(name).expect("text token");
        assert!(text.status.is_fixed() && panel.status.is_fixed(), "{name}");
        for (foreground, fill) in [(text.dark, panel.dark), (text.light, panel.light)] {
            let ratio = contrast(foreground, &fill[..7]);
            assert!(
                ratio >= 4.5,
                "{name}: {foreground} on {fill} is {ratio:.2}:1"
            );
        }
    }
}

#[test]
fn icons_are_the_pinned_crate_names() {
    assert_eq!(icons::ICON_CRATE, "egui-lucide 0.1.0");
    assert_eq!(icons::LUCIDE_VERSION, "1.34.0");
    assert_eq!(icons::ICONS.len(), 1777);
    assert!(
        icons::ICONS.windows(2).all(|pair| pair[0] < pair[1]),
        "sorted and unique"
    );
    // Icons the wrapper and today's built-ins need.
    for name in [
        "grip-horizontal",
        "ellipsis",
        "eye",
        "eye-off",
        "x",
        "plus",
        "circle-check",
        "circle",
        "clipboard",
        "clock",
        "activity",
        "headphone-off",
        "skip-forward",
        "skip-back",
        "pause",
        "play",
        "mic-off",
        "sticky-note",
        "gauge",
        "reply",
        "hourglass",
        "star",
        "timer",
        "rotate-ccw",
        "music",
        "chevron-left",
        "chevron-right",
        "chevron-down",
        "layout-grid",
        "info",
        "pencil",
        "trash-2",
        "link-2",
        "external-link",
    ] {
        assert!(icons::is_icon(name), "{name}");
    }
    assert!(!icons::is_icon("Clock"));
    assert!(!icons::is_icon(""));
}

#[test]
fn capabilities_match_adr_0001_as_amended_by_p0_6() {
    assert_unique(
        "capability",
        permissions::CAPABILITIES.iter().map(|c| c.name),
    );
    let non_sensitive: BTreeSet<_> = permissions::CAPABILITIES
        .iter()
        .filter(|capability| !capability.sensitive)
        .map(|capability| capability.name)
        .collect();
    assert_eq!(
        non_sensitive,
        BTreeSet::from([
            "telemetry.read",
            "fps.read",
            "stopwatch.read",
            "stopwatch.control",
            "session.read"
        ])
    );
    for name in ["telemetry.read", "fps.read", "media.read", "media.control"] {
        let capability = permissions::capability_named(name).expect("SDK 1.3 capability is kept");
        assert_eq!(capability.status, Status::Fixed);
    }
    let rule = |name| {
        permissions::permission(name)
            .expect("permission exists")
            .with_sensitive
    };
    assert_eq!(rule("network"), permissions::SensitiveRule::Forbidden);
    assert_eq!(
        rule("clipboardWrite"),
        permissions::SensitiveRule::Forbidden
    );
    assert_eq!(rule("storage"), permissions::SensitiveRule::ProcessLifetime);
}

#[test]
fn services_reference_declared_authority() {
    assert_unique(
        "service",
        services::SERVICES.iter().map(|service| service.name),
    );
    assert_unique("service error", services::SERVICE_ERRORS.iter().copied());
    let mut reached = BTreeSet::new();
    for service in services::SERVICES {
        match service.requires {
            services::Requirement::None => {}
            services::Requirement::Permission(name) => {
                assert!(permissions::permission(name).is_some(), "{}", service.name);
            }
            services::Requirement::Capability(name) => {
                assert!(
                    permissions::capability_named(name).is_some(),
                    "{}",
                    service.name
                );
                reached.insert(name);
            }
        }
        assert!(
            !service.confirm || service.gesture,
            "{}: confirmation implies a gesture",
            service.name
        );
    }
    let intents: Vec<_> = services::WRITE_INTENTS
        .iter()
        .map(|intent| intent.name)
        .collect();
    assert_eq!(intents, services::WRITE_INTENT_NAMES);
    for intent in services::WRITE_INTENTS {
        let capability =
            permissions::capability_named(intent.capability).expect("intent capability");
        assert!(capability.sensitive, "{}", intent.name);
        reached.insert(intent.capability);
        // The host owns the controls an intent takes its values from:
        // `field`, `textarea` and `slider`, whose `value` it refuses from
        // the VM. A field of another type (a `toggle`, a `select`) needs
        // that rule extended to its control first.
        for field in intent.fields {
            assert!(
                matches!(
                    field.ty,
                    ValueType::Text(_)
                        | ValueType::Chars(_)
                        | ValueType::Integer { .. }
                        | ValueType::ListOf("NoteItem", _)
                ),
                "{}.{}: not a host-owned text or slider value",
                intent.name,
                field.name
            );
        }
    }
    for capability in permissions::CAPABILITIES {
        assert!(
            reached.contains(capability.name),
            "{} has no service",
            capability.name
        );
    }
}

#[test]
fn ipc_tables_are_closed_and_consistent() {
    let mut offset = 0;
    for field in ipc::HEADER {
        assert_eq!(field.offset, offset, "{}", field.name);
        offset += field.bytes;
    }
    assert_eq!(offset, ipc::HEADER_BYTES);
    for (index, kind) in ipc::FRAME_KINDS.iter().enumerate() {
        assert_eq!(
            usize::from(kind.code),
            index + 1,
            "frame codes are dense from 1"
        );
    }
    let direction = |code: u8| {
        ipc::FRAME_KINDS
            .iter()
            .find(|kind| kind.code == code)
            .expect("message frame exists")
            .direction
    };
    for message in ipc::HOST_MESSAGES {
        assert_eq!(
            direction(message.frame),
            ipc::Direction::HostToVm,
            "{}",
            message.name
        );
    }
    for message in ipc::VM_MESSAGES
        .iter()
        .chain(ipc::PATCH_OPS)
        .chain(ipc::DRAW_COMMANDS)
    {
        assert_eq!(
            direction(message.frame),
            ipc::Direction::VmToHost,
            "{}",
            message.name
        );
    }
    assert_unique(
        "message",
        ipc::HOST_MESSAGES
            .iter()
            .chain(ipc::VM_MESSAGES)
            .map(|message| message.name),
    );
    assert_unique("patch op", ipc::PATCH_OPS.iter().map(|op| op.name));
    assert_unique(
        "draw command",
        ipc::DRAW_COMMANDS.iter().map(|command| command.name),
    );
    let failures: Vec<_> = ipc::FAILURES.iter().map(|failure| failure.name).collect();
    assert_eq!(
        failures,
        [
            "invalid_bundle",
            "permission_denied",
            "protocol_violation",
            "resource_limit",
            "unresponsive",
            "vm_exited"
        ]
    );
}

#[test]
fn menu_row_types_are_closed() {
    let names: Vec<_> = wrapper::ROW_TYPES.iter().map(|row| row.name).collect();
    assert_eq!(names, ["toggle", "slider", "choice", "action", "group"]);
    assert_eq!(limits::MAX_MENU_ROWS.value, 16);
    assert_eq!(limits::MAX_MENU_DEPTH.value, 1);
    assert_eq!(limits::MAX_MENU_LABEL_CHARS.value, 80);
}

#[test]
fn committed_reference_is_current() {
    let committed = include_str!("../../../docs/widget-schema-v1.md");
    assert!(
        committed == reference::markdown(),
        "{} is stale; regenerate it with `cargo run -p overcrow-widget-schema --example reference > {}`",
        reference::DOCUMENT_PATH,
        reference::DOCUMENT_PATH
    );
}

#[test]
fn reference_tables_have_consistent_columns() {
    let cells = |line: &str| {
        let bytes = line.as_bytes();
        (0..bytes.len())
            .filter(|&i| bytes[i] == b'|' && (i == 0 || bytes[i - 1] != b'\\'))
            .count()
    };
    let mut columns = None;
    for (number, line) in reference::markdown().lines().enumerate() {
        if !line.starts_with('|') {
            columns = None;
            continue;
        }
        let count = cells(line);
        let expected = *columns.get_or_insert(count);
        assert_eq!(count, expected, "line {}: {line}", number + 1);
    }
}

#[test]
fn default_sizes_name_host_drawn_elements_and_keyword_conditions() {
    use overcrow_widget_schema::model::{field, is_keyword};
    use overcrow_widget_schema::style::{DEFAULT_SIZES, default_size};
    for (index, row) in DEFAULT_SIZES.iter().enumerate() {
        let element = view::element(row.element).expect("known element");
        match row.when {
            Some((attribute, value)) => {
                assert!(
                    field(element.attributes, attribute).is_some(),
                    "{attribute}"
                );
                assert!(is_keyword(element.attributes, attribute, value), "{value}");
            }
            // The unconditional row of an element comes after its conditions,
            // and there is one.
            None => assert!(
                DEFAULT_SIZES[index + 1..]
                    .iter()
                    .all(|later| later.element != row.element),
                "{}",
                row.element
            ),
        }
    }
    let arc = default_size("gauge", |name| (name == "shape").then_some("arc"));
    assert_eq!(arc.map(|row| row.height), Some(style::Extent::Px(32)));
    let ring = default_size("gauge", |_| None);
    assert_eq!(ring.map(|row| row.height), Some(style::Extent::Px(48)));
    assert_eq!(default_size("canvas", |_| None), None);
}
