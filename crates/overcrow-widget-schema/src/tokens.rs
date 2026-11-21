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
    /// The token's role in the user's accent: its value follows the accent
    /// colour ([`USER_ACCENTS`]) for a widget whose manifest declares it
    /// ([`AccentDeclaration::allows`]); `dark` and `light` are the default,
    /// lime. Another widget cannot use the token. `None` for every other
    /// token.
    pub user_accent: Option<AccentRole>,
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
        user_accent: None,
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
        user_accent: None,
    }
}

/// The colour of one role of the user's accent. The table holds its
/// default, lime, as `"accent": "user-roles"` gives it: the brand accent
/// family.
const fn role_token(name: &'static str, role: AccentRole, summary: &'static str) -> Token {
    Token {
        status: Status::Fixed,
        user_accent: Some(role),
        ..color(
            name,
            DEFAULT_USER_ACCENT.roles(true).get(role),
            DEFAULT_USER_ACCENT.roles(false).get(role),
            summary,
        )
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
        user_accent: None,
    },
    role_token(
        "--color-user-accent",
        AccentRole::Fill,
        "The user's accent colour, a fill that carries text or a mark; never a text colour or a border on a surface. Needs `\"accent\": \"user-roles\"` or `\"user\"` in the manifest; lime by default, the brand accent.",
    ),
    role_token(
        "--color-on-user-accent",
        AccentRole::OnFill,
        "Text and icons drawn on `--color-user-accent` and on its hover state. Needs `\"accent\": \"user-roles\"` or `\"user\"` in the manifest.",
    ),
    role_token(
        "--color-user-accent-hover",
        AccentRole::Hover,
        "`--color-user-accent` under the pointer. Needs `\"accent\": \"user-roles\"` in the manifest.",
    ),
    role_token(
        "--color-user-accent-soft",
        AccentRole::Soft,
        "Wash of the user's accent behind selected content. Needs `\"accent\": \"user-roles\"` in the manifest.",
    ),
    role_token(
        "--color-user-accent-text",
        AccentRole::Text,
        "Text and icons in the user's accent on a surface, readable in every accent colour. Needs `\"accent\": \"user-roles\"` in the manifest.",
    ),
    role_token(
        "--color-user-accent-text-hover",
        AccentRole::TextHover,
        "`--color-user-accent-text` under the pointer or pressed. Needs `\"accent\": \"user-roles\"` in the manifest.",
    ),
    role_token(
        "--color-user-accent-outline",
        AccentRole::Outline,
        "Borders, rails, rings and gauges in the user's accent on a surface, visible in every accent colour. Needs `\"accent\": \"user-roles\"` in the manifest.",
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
        user_accent: None,
    },
];

pub fn token(name: &str) -> Option<&'static Token> {
    TOKENS.iter().find(|token| token.name == name)
}

/// The catalog v2 feature of a manifest that declares `"accent": "user"` or
/// `"user-roles"`: a reader that does not know the field refuses the
/// manifest, and its style could not resolve the user accent tokens.
pub const FEATURE_USER_ACCENT: &str = "user-accent";

/// The catalog v2 feature of a manifest that declares
/// `"accent": "user-roles"`: a reader that does not know the value refuses
/// the manifest, and its style could not resolve the role tokens. Such a
/// reader keeps the version of the widget it already has.
pub const FEATURE_USER_ACCENT_ROLES: &str = "user-accent-roles";

/// What a manifest declares with `accent`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum AccentDeclaration {
    /// No `accent`: the widget keeps the brand accent and gets nothing of
    /// the user's.
    #[default]
    None,
    /// `"user"`, the reduced form: the user's fill and the text on it,
    /// with the values of [`UserAccent::dark`] and [`UserAccent::light`].
    /// The controls the host draws keep the brand accent.
    User,
    /// `"user-roles"`: a colour for each role ([`AccentRoles`]), and the
    /// controls the host draws follow the user's accent.
    UserRoles,
}

impl AccentDeclaration {
    /// The values `accent` may take in the manifest, the normal form first.
    pub const VALUES: &'static [&'static str] = &["user-roles", "user"];

    /// The declaration of the manifest value `accent`, one of
    /// [`Self::VALUES`].
    pub fn from_manifest(accent: &str) -> Option<Self> {
        [Self::UserRoles, Self::User]
            .into_iter()
            .find(|declaration| declaration.as_str() == Some(accent))
    }

    /// The value of `accent` in the manifest; `None` when it is absent.
    pub const fn as_str(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::User => Some(Self::VALUES[1]),
            Self::UserRoles => Some(Self::VALUES[0]),
        }
    }

    /// The catalog v2 features a reader must support to run a manifest
    /// that declares it.
    pub const fn features(self) -> &'static [&'static str] {
        match self {
            Self::None => &[],
            Self::User => &[FEATURE_USER_ACCENT],
            Self::UserRoles => &[FEATURE_USER_ACCENT, FEATURE_USER_ACCENT_ROLES],
        }
    }

    /// Whether the widget receives the name of the user's accent.
    pub const fn follows_user(self) -> bool {
        !matches!(self, Self::None)
    }

    /// Whether the widget may use the user accent token of `role`.
    pub const fn allows(self, role: AccentRole) -> bool {
        match self {
            Self::None => false,
            Self::User => matches!(role, AccentRole::Fill | AccentRole::OnFill),
            Self::UserRoles => true,
        }
    }
}

/// The role of a colour of the user's accent: what it is drawn as, and on
/// what.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccentRole {
    /// `--color-user-accent`: a fill that carries text or a mark.
    Fill,
    /// `--color-on-user-accent`: text and icons on the fill and on its
    /// hover state, at WCAG AA (4.5:1) on both.
    OnFill,
    /// `--color-user-accent-hover`: the fill under the pointer.
    Hover,
    /// `--color-user-accent-soft`: a wash behind selected content.
    Soft,
    /// `--color-user-accent-text`: text and icons on a surface, at WCAG AA
    /// (4.5:1) on every surface token and on the wash over each.
    Text,
    /// `--color-user-accent-text-hover`: that text under the pointer or
    /// pressed, at the same contrast.
    TextHover,
    /// `--color-user-accent-outline`: a border, a rail, a ring or a gauge
    /// on a surface, an indicator at 3:1 (WCAG 1.4.11) on every surface
    /// token.
    Outline,
}

impl AccentRole {
    pub const ALL: [Self; 7] = [
        Self::Fill,
        Self::OnFill,
        Self::Hover,
        Self::Soft,
        Self::Text,
        Self::TextHover,
        Self::Outline,
    ];

    /// What the role is drawn as, in the words of the schema reference.
    pub const fn summary(self) -> &'static str {
        match self {
            Self::Fill => "Fill that carries text or a mark",
            Self::OnFill => "Text and icons on the fill and on its hover state",
            Self::Hover => "The fill under the pointer",
            Self::Soft => "Wash behind selected content",
            Self::Text => "Text and icons on a surface",
            Self::TextHover => "That text under the pointer or pressed",
            Self::Outline => "Border, rail, ring or gauge on a surface",
        }
    }

    /// The contrast the schema's tests hold the role at; empty for a role
    /// that is a background.
    pub const fn contrast(self) -> &'static str {
        match self {
            Self::Fill | Self::Hover | Self::Soft => "",
            Self::OnFill => "4.5:1 on both",
            Self::Text => "4.5:1 on every surface token and on the wash over it",
            Self::TextHover => "the same",
            Self::Outline => {
                "3:1 on every surface token, on the wash and on a control track over it"
            }
        }
    }
}

/// The published colours of a user accent in one theme, those of
/// `"accent": "user"`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccentColors {
    /// Value of `--color-user-accent`.
    pub fill: &'static str,
    /// Value of `--color-on-user-accent`, at WCAG AA (4.5:1) on `fill`.
    pub on_fill: &'static str,
}

/// The colour of each role of a user accent in one theme, those of
/// `"accent": "user-roles"` and of PlayerVox OverCrow's own interface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccentRoles {
    pub fill: &'static str,
    pub on_fill: &'static str,
    pub hover: &'static str,
    /// `#rrggbbaa`: the fill at the alpha of `--color-accent-soft`.
    pub soft: &'static str,
    pub text: &'static str,
    pub text_hover: &'static str,
    pub outline: &'static str,
}

impl AccentRoles {
    pub const fn get(&self, role: AccentRole) -> &'static str {
        match role {
            AccentRole::Fill => self.fill,
            AccentRole::OnFill => self.on_fill,
            AccentRole::Hover => self.hover,
            AccentRole::Soft => self.soft,
            AccentRole::Text => self.text,
            AccentRole::TextHover => self.text_hover,
            AccentRole::Outline => self.outline,
        }
    }
}

/// One accent colour the user can choose in PlayerVox OverCrow.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UserAccent {
    pub name: &'static str,
    pub dark: AccentColors,
    pub light: AccentColors,
    pub dark_roles: AccentRoles,
    pub light_roles: AccentRoles,
}

impl UserAccent {
    /// The colour of each role in the dark or the light theme.
    pub const fn roles(&self, dark: bool) -> AccentRoles {
        if dark {
            self.dark_roles
        } else {
            self.light_roles
        }
    }

    /// The value of the user accent token of `role` for a widget that
    /// declares `declaration`, in the dark or the light theme. Under
    /// `"user"` the fill and its text keep their published values; every
    /// other case reads the roles.
    pub const fn value(
        &self,
        role: AccentRole,
        dark: bool,
        declaration: AccentDeclaration,
    ) -> &'static str {
        let colors = if dark { self.dark } else { self.light };
        match (declaration, role) {
            (AccentDeclaration::UserRoles, _) => self.roles(dark).get(role),
            (_, AccentRole::Fill) => colors.fill,
            (_, AccentRole::OnFill) => colors.on_fill,
            _ => self.roles(dark).get(role),
        }
    }
}

/// The roles of one theme: `[fill, on_fill, hover, soft, text, text_hover,
/// outline]`.
const fn roles(values: [&'static str; 7]) -> AccentRoles {
    let [fill, on_fill, hover, soft, text, text_hover, outline] = values;
    AccentRoles {
        fill,
        on_fill,
        hover,
        soft,
        text,
        text_hover,
        outline,
    }
}

/// A PlayerVox accent: its published fill in the dark and in the light
/// theme, both under `on_fill` text, and its roles in each theme.
const fn accent(
    name: &'static str,
    dark: &'static str,
    light: &'static str,
    on_fill: &'static str,
    dark_roles: [&'static str; 7],
    light_roles: [&'static str; 7],
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
        dark_roles: roles(dark_roles),
        light_roles: roles(light_roles),
    }
}

/// The default accent, sent when the user chose none.
pub const DEFAULT_USER_ACCENT: UserAccent = USER_ACCENTS[0];

/// The shade of `red` for text and outlines on the dark surfaces: the hue
/// of its fill (`#991b1b`), fully saturated, at the lightness where text
/// holds 4.5:1 on every surface token and on its wash, and where a gauge
/// holds 3:1 on a control's track over each of them. One shade for both
/// roles: a label, the border around it and the gauge beside it are the
/// same red.
pub const RED_ON_DARK_SURFACES: &str = "#ff6565";

/// The accent colours of PlayerVox, in its order, `lime` first (the
/// default).
///
/// The published pair of `"accent": "user"`: the dark theme takes each
/// colour's light shade; the light theme its strong shade, except `purple`
/// and `steel`, whose strong shades (`#8b5cf6`, `#71717a`) fall below WCAG
/// AA under `#18181b`. `red` is `#991b1b` under white text in both themes.
///
/// The roles of `"accent": "user-roles"`, `[fill, on_fill, hover, soft,
/// text, text_hover, outline]` in the dark then in the light theme. `lime`
/// is exactly the brand accent family (`--color-accent`,
/// `--color-on-accent`, `--color-accent-hover`, `--color-accent-soft`), so a
/// widget that follows a user who kept lime draws what it drew with the
/// brand tokens. Every other colour keeps the fill and the text of its
/// published pair, and:
///
/// - `hover` moves the fill away from the text it carries: 20 % towards
///   white in the dark theme; in the light theme 15 % towards white under
///   dark text, towards black under white text;
/// - `soft` is the fill at the alpha of `--color-accent-soft`;
/// - `text` is the fill where it reaches 4.5:1 on every surface token
///   (`--color-surface-panel`, `-raised`, `-hover`, `-field`, `-popover`),
///   `--color-text` otherwise;
/// - `text_hover` moves `text` away from the surfaces: 20 % towards white
///   in the dark theme, 15 % towards black in the light theme;
/// - `outline` is the fill where it reaches 3:1 on every surface token,
///   `--color-text` otherwise.
///
/// One colour has its own shade: `red` in the dark theme. Its fill is too
/// dark to be seen on a dark surface (2.3:1 on the panel), and red is a
/// colour like the others: its `text` and its `outline` are
/// [`RED_ON_DARK_SURFACES`], not `--color-text`.
///
/// The schema's tests derive every value from these rules and hold each
/// role at its contrast on each surface.
#[rustfmt::skip]
pub const USER_ACCENTS: [UserAccent; 9] = [
    accent("lime", "#a3e635", "#84cc16", "#18181b",
        ["#a3e635", "#09090b", "#b5f153", "#a3e6351c", "#a3e635", "#b5f153", "#a3e635"],
        ["#4d7c0f", "#ffffff", "#3f6212", "#4d7c0f1f", "#4d7c0f", "#3f6212", "#4d7c0f"]),
    accent("amber", "#fbbf24", "#f59e0b", "#18181b",
        ["#fbbf24", "#18181b", "#fccc50", "#fbbf241c", "#fbbf24", "#fccc50", "#fbbf24"],
        ["#f59e0b", "#18181b", "#f7ad30", "#f59e0b1f", "#18181b", "#141417", "#18181b"]),
    accent("red", "#991b1b", "#991b1b", "#ffffff",
        ["#991b1b", "#ffffff", "#ad4949", "#991b1b1c", RED_ON_DARK_SURFACES, "#ff8484", RED_ON_DARK_SURFACES],
        ["#991b1b", "#ffffff", "#821717", "#991b1b1f", "#991b1b", "#821717", "#991b1b"]),
    accent("pink", "#fb7185", "#f43f5e", "#18181b",
        ["#fb7185", "#18181b", "#fc8d9d", "#fb71851c", "#fb7185", "#fc8d9d", "#fb7185"],
        ["#f43f5e", "#18181b", "#f65c76", "#f43f5e1f", "#18181b", "#141417", "#18181b"]),
    accent("purple", "#a78bfa", "#a78bfa", "#18181b",
        ["#a78bfa", "#18181b", "#b9a2fb", "#a78bfa1c", "#a78bfa", "#b9a2fb", "#a78bfa"],
        ["#a78bfa", "#18181b", "#b49cfb", "#a78bfa1f", "#18181b", "#141417", "#18181b"]),
    accent("blue", "#60a5fa", "#3b82f6", "#18181b",
        ["#60a5fa", "#18181b", "#80b7fb", "#60a5fa1c", "#60a5fa", "#80b7fb", "#60a5fa"],
        ["#3b82f6", "#18181b", "#5895f7", "#3b82f61f", "#18181b", "#141417", "#18181b"]),
    accent("cyan", "#22d3ee", "#06b6d4", "#18181b",
        ["#22d3ee", "#18181b", "#4edcf1", "#22d3ee1c", "#22d3ee", "#4edcf1", "#22d3ee"],
        ["#06b6d4", "#18181b", "#2bc1da", "#06b6d41f", "#18181b", "#141417", "#18181b"]),
    accent("emerald", "#34d399", "#10b981", "#18181b",
        ["#34d399", "#18181b", "#5ddcad", "#34d3991c", "#34d399", "#5ddcad", "#34d399"],
        ["#10b981", "#18181b", "#34c494", "#10b9811f", "#18181b", "#141417", "#18181b"]),
    accent("steel", "#a1a1aa", "#a1a1aa", "#18181b",
        ["#a1a1aa", "#18181b", "#b4b4bb", "#a1a1aa1c", "#a1a1aa", "#b4b4bb", "#a1a1aa"],
        ["#a1a1aa", "#18181b", "#afafb7", "#a1a1aa1f", "#18181b", "#141417", "#18181b"]),
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
