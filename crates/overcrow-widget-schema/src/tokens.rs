//! Design-system tokens available to `var(--name)`. The dark values are the
//! current overlay palette. The built-ins had no light theme: the reference
//! images of the P2.4 pilots (Clock, Session, FPS, in both themes) fixed the
//! panel and the primary and muted text, the Performance rewrite (P3.2) the
//! warning and danger colours; the other colours stay provisional until a
//! built-in that draws them checks them.

use crate::model::Status;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TokenType {
    Color,
    Length,
    FontSize,
    FontFamily,
    Time,
    /// One outer shadow, written `<x>px <y>px <blur>px <spread>px #rrggbbaa`;
    /// usable only as the whole `box-shadow` value.
    Shadow,
}

impl TokenType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Color => "color",
            Self::Length => "length",
            Self::FontSize => "font size",
            Self::FontFamily => "font family",
            Self::Time => "time",
            Self::Shadow => "shadow",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Token {
    pub name: &'static str,
    pub ty: TokenType,
    pub dark: &'static str,
    pub light: &'static str,
    pub status: Status,
    pub summary: &'static str,
    /// The value follows the user's accent colour ([`USER_ACCENTS`]) for a
    /// widget whose manifest declares `"accent": "user"`; `dark` and
    /// `light` are the default, lime. Another widget cannot use the token.
    pub user_accent: bool,
}

/// A colour the pilots' reference images checked in both themes (P2.4).
const fn checked(
    name: &'static str,
    dark: &'static str,
    light: &'static str,
    summary: &'static str,
) -> Token {
    Token {
        status: Status::Fixed,
        ..color(name, dark, light, summary)
    }
}

const fn color(
    name: &'static str,
    dark: &'static str,
    light: &'static str,
    summary: &'static str,
) -> Token {
    Token {
        name,
        ty: TokenType::Color,
        dark,
        light,
        status: Status::P2_4,
        summary,
        user_accent: false,
    }
}

const fn same(
    name: &'static str,
    ty: TokenType,
    value: &'static str,
    summary: &'static str,
) -> Token {
    Token {
        name,
        ty,
        dark: value,
        light: value,
        status: Status::Fixed,
        summary,
        user_accent: false,
    }
}

/// A colour of the user's accent; the table holds its default, lime.
const fn user_accent_token(
    name: &'static str,
    dark: &'static str,
    light: &'static str,
    summary: &'static str,
) -> Token {
    Token {
        status: Status::Fixed,
        user_accent: true,
        ..color(name, dark, light, summary)
    }
}

pub const TOKENS: &[Token] = &[
    color(
        "--color-accent",
        "#a3e635",
        "#4d7c0f",
        "Brand accent: primary actions, checked state.",
    ),
    color(
        "--color-accent-hover",
        "#b5f153",
        "#3f6212",
        "Accent under the pointer.",
    ),
    color(
        "--color-accent-soft",
        "#a3e6351c",
        "#4d7c0f1f",
        "Accent wash behind selected content.",
    ),
    // Fixed by P0.6: the dark value is the overlay's current primary button
    // label; the light value keeps WCAG AA contrast
    // on the proposed light accent, which a schema test enforces.
    Token {
        name: "--color-on-accent",
        ty: TokenType::Color,
        dark: "#09090b",
        light: "#ffffff",
        status: Status::Fixed,
        summary: "Text and icons drawn on the accent and its hover state.",
        user_accent: false,
    },
    user_accent_token(
        "--color-user-accent",
        DEFAULT_USER_ACCENT.dark.fill,
        DEFAULT_USER_ACCENT.light.fill,
        "The user's accent colour, a fill for what belongs to the user; never a text colour on the panel. Needs `\"accent\": \"user\"` in the manifest; lime by default.",
    ),
    user_accent_token(
        "--color-on-user-accent",
        DEFAULT_USER_ACCENT.dark.on_fill,
        DEFAULT_USER_ACCENT.light.on_fill,
        "Text and icons drawn on `--color-user-accent`. Needs `\"accent\": \"user\"` in the manifest.",
    ),
    checked(
        "--color-surface-panel",
        "#111114ee",
        "#fafafaee",
        "Widget panel background, drawn by the host wrapper behind the content.",
    ),
    color(
        "--color-surface-raised",
        "#1e1e22e0",
        "#f4f4f5eb",
        "Raised surface inside the panel.",
    ),
    color(
        "--color-surface-hover",
        "#28282deb",
        "#e4e4e7f0",
        "Surface under the pointer.",
    ),
    color(
        "--color-surface-field",
        "#0f0f12",
        "#ffffff",
        "Text input background.",
    ),
    color(
        "--color-surface-popover",
        "#18181c",
        "#ffffff",
        "Popover and drop-down background.",
    ),
    color(
        "--color-border",
        "#ffffff18",
        "#0000001a",
        "Default border.",
    ),
    color(
        "--color-border-strong",
        "#ffffff2a",
        "#0000002e",
        "Emphasized border and separator.",
    ),
    checked("--color-text", "#f7f7f8", "#18181b", "Primary text."),
    color(
        "--color-text-secondary",
        "#d4d4d8",
        "#3f3f46",
        "Secondary text.",
    ),
    checked(
        "--color-text-muted",
        "#a1a1aa",
        "#52525b",
        "Captions and metadata.",
    ),
    color(
        "--color-text-subtle",
        "#71717a",
        "#71717a",
        "Placeholders and disabled text.",
    ),
    // Fixed by P3.2: the Performance built-in's critical values, at WCAG AA
    // on the panel in both themes (a schema test enforces it).
    checked(
        "--color-danger",
        "#fb7185",
        "#e11d48",
        "Errors and destructive actions.",
    ),
    color(
        "--color-danger-soft",
        "#fb71851a",
        "#e11d481a",
        "Danger wash behind destructive confirmations and errors.",
    ),
    // Fixed by P3.2: the Performance built-in's warning values.
    checked("--color-warning", "#fbbf24", "#b45309", "Warnings."),
    color(
        "--color-success",
        "#86efac",
        "#15803d",
        "Success and healthy states.",
    ),
    same("--space-1", TokenType::Length, "2px", "Spacing step 1."),
    same("--space-2", TokenType::Length, "4px", "Spacing step 2."),
    same(
        "--space-3",
        TokenType::Length,
        "6px",
        "Spacing step 3 (default item spacing).",
    ),
    same("--space-4", TokenType::Length, "8px", "Spacing step 4."),
    same("--space-5", TokenType::Length, "12px", "Spacing step 5."),
    same("--space-6", TokenType::Length, "16px", "Spacing step 6."),
    same(
        "--radius-sm",
        TokenType::Length,
        "6px",
        "Small controls and images.",
    ),
    same("--radius-md", TokenType::Length, "9px", "Buttons."),
    same("--radius-lg", TokenType::Length, "10px", "Cards."),
    same(
        "--radius-pill",
        TokenType::Length,
        "999px",
        "Pills and round buttons.",
    ),
    same(
        "--control-height",
        TokenType::Length,
        "28px",
        "Standard control height.",
    ),
    same(
        "--icon-button-size",
        TokenType::Length,
        "22px",
        "Compact icon button.",
    ),
    same(
        "--font-size-caption",
        TokenType::FontSize,
        "10px",
        "Eyebrow and captions.",
    ),
    same(
        "--font-size-small",
        TokenType::FontSize,
        "11px",
        "Metadata.",
    ),
    same(
        "--font-size-button",
        TokenType::FontSize,
        "13px",
        "Button labels.",
    ),
    same(
        "--font-size-body",
        TokenType::FontSize,
        "14px",
        "Body text.",
    ),
    same(
        "--font-size-title",
        TokenType::FontSize,
        "18px",
        "Section titles.",
    ),
    same(
        "--font-size-value",
        TokenType::FontSize,
        "22px",
        "Headline values (clock, FPS).",
    ),
    same(
        "--font-ui",
        TokenType::FontFamily,
        "ui",
        "Noto Sans UI, the interface face.",
    ),
    same(
        "--font-mono",
        TokenType::FontFamily,
        "mono",
        "Noto Sans Mono, for values.",
    ),
    same(
        "--font-display",
        TokenType::FontFamily,
        "display",
        "Space Grotesk, for grades and scores.",
    ),
    same(
        "--duration-fast",
        TokenType::Time,
        "120ms",
        "State transitions.",
    ),
    same(
        "--duration-medium",
        TokenType::Time,
        "240ms",
        "Panels and popovers.",
    ),
    Token {
        name: "--shadow-panel",
        ty: TokenType::Shadow,
        dark: "0px 4px 16px 0px #00000066",
        light: "0px 4px 16px 0px #0000001f",
        status: Status::P2_4,
        summary: "Shadow of the widget panel and of floating host surfaces.",
        user_accent: false,
    },
];

pub fn token(name: &str) -> Option<&'static Token> {
    TOKENS.iter().find(|token| token.name == name)
}

/// The catalog v2 feature of a manifest that declares `"accent": "user"`:
/// a reader that does not know the field refuses the manifest, and its
/// style could not resolve the user accent tokens.
pub const FEATURE_USER_ACCENT: &str = "user-accent";

/// The colours of a user accent in one theme.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccentColors {
    /// Value of `--color-user-accent`.
    pub fill: &'static str,
    /// Value of `--color-on-user-accent`, at WCAG AA (4.5:1) on `fill`.
    pub on_fill: &'static str,
}

/// One accent colour the user can choose in PlayerVox OverCrow.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UserAccent {
    pub name: &'static str,
    pub dark: AccentColors,
    pub light: AccentColors,
}

/// A PlayerVox accent: its fill in the dark and in the light theme, both
/// under `on_fill` text.
const fn accent(
    name: &'static str,
    dark: &'static str,
    light: &'static str,
    on_fill: &'static str,
) -> UserAccent {
    UserAccent {
        name,
        dark: AccentColors {
            fill: dark,
            on_fill,
        },
        light: AccentColors {
            fill: light,
            on_fill,
        },
    }
}

/// The default accent, sent when the user chose none.
pub const DEFAULT_USER_ACCENT: UserAccent = USER_ACCENTS[0];

/// The accent colours of PlayerVox, in its order, `lime` first (the
/// default). The dark theme takes each colour's light shade; the light
/// theme its strong shade, except `purple` and `steel`, whose strong shades
/// (`#8b5cf6`, `#71717a`) fall below WCAG AA under `#18181b`. `red` is
/// `#991b1b` under white text in both themes. A schema test keeps every
/// `on_fill` at AA on its `fill`.
pub const USER_ACCENTS: [UserAccent; 9] = [
    accent("lime", "#a3e635", "#84cc16", "#18181b"),
    accent("amber", "#fbbf24", "#f59e0b", "#18181b"),
    accent("red", "#991b1b", "#991b1b", "#ffffff"),
    accent("pink", "#fb7185", "#f43f5e", "#18181b"),
    accent("purple", "#a78bfa", "#a78bfa", "#18181b"),
    accent("blue", "#60a5fa", "#3b82f6", "#18181b"),
    accent("cyan", "#22d3ee", "#06b6d4", "#18181b"),
    accent("emerald", "#34d399", "#10b981", "#18181b"),
    accent("steel", "#a1a1aa", "#a1a1aa", "#18181b"),
];

/// The names of [`USER_ACCENTS`], in its order: the keyword of the IPC
/// field `userAccent`.
pub const USER_ACCENT_NAMES: &[&str] = &{
    let mut names = [""; USER_ACCENTS.len()];
    let mut index = 0;
    while index < names.len() {
        names[index] = USER_ACCENTS[index].name;
        index += 1;
    }
    names
};

/// The accent named `name`, one of [`USER_ACCENTS`].
pub fn user_accent(name: &str) -> Option<&'static UserAccent> {
    USER_ACCENTS.iter().find(|accent| accent.name == name)
}

/// The value of a [`TokenType::Shadow`] token for one theme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TokenShadow {
    pub x: f64,
    pub y: f64,
    pub blur: f64,
    pub spread: f64,
    pub rgba: [u8; 4],
}

/// Parses a shadow token value: exactly four whole or decimal `px`
/// lengths (blur non-negative) and one `#rrggbbaa` colour, separated by one
/// space. The table is trusted data; a test parses every entry.
pub fn parse_shadow(text: &str) -> Option<TokenShadow> {
    let parts: Vec<&str> = text.split(' ').collect();
    let [x, y, blur, spread, color] = parts.as_slice() else {
        return None;
    };
    let px = |part: &str| {
        part.strip_suffix("px")
            .and_then(|number| number.parse::<f64>().ok())
            .filter(|value| value.is_finite())
    };
    let hex = color.strip_prefix('#').filter(|hex| {
        hex.len() == 8
            && hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })?;
    let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
    Some(TokenShadow {
        x: px(x)?,
        y: px(y)?,
        blur: px(blur).filter(|blur| *blur >= 0.0)?,
        spread: px(spread)?,
        rgba: [channel(0)?, channel(2)?, channel(4)?, channel(6)?],
    })
}
