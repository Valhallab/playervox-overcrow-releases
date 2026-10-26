//! Checks of the declarative sources: `manifest.json`, `view.ocml`,
//! `style.ocss` and the locales. The public validators decide; this module
//! turns their fixed categories into diagnostics with a position, a message
//! and, for unknown names, the closest name of the schema.

use std::collections::{BTreeMap, BTreeSet};

use overcrow_widget_format::expr::Expr;
use overcrow_widget_format::ocml::{self, CompiledView, OcmlErrorKind};
use overcrow_widget_format::ocss::{self, OcssErrorKind};
use overcrow_widget_format::{Position, expr::ExprErrorKind};
use overcrow_widget_schema::limits::{
    MAX_LOCALE_ENTRIES, MAX_LOCALE_KEY_BYTES, MAX_LOCALE_VALUE_BYTES,
};
use overcrow_widget_schema::manifest::{
    MANIFEST_FIELDS, Manifest, ManifestError, validate_manifest,
};
use overcrow_widget_schema::text::hidden_character;
use overcrow_widget_schema::{style, tokens, view};

use crate::diag::{Diagnostic, Report, closest};
use crate::jsonpos;
use crate::project::Project;

/// How to write a widget ID, for help texts: the two forms of the creator
/// space (`identifiers::id_owner`), with the example publisher `nova`.
pub const ID_FORMS: &str = "use <handle>.<name> with your publisher handle from the PlayerVox OverCrow creator space, such as nova.lol-timers, or a reverse domain you verified, such as gg.nova.lol-timers";

/// How to fix a name or label that holds a hidden character.
pub const HIDDEN_HELP: &str =
    "remove it: names and labels show as written, without invisible or text-direction characters";

/// `{subject} holds a hidden character, U+XXXX, at position N`, the
/// position counted in characters from 1.
pub fn hidden_message(subject: &str, index: usize, character: char) -> String {
    format!(
        "{subject} holds a hidden character, U+{:04X}, at position {}",
        u32::from(character),
        index + 1
    )
}

/// The declarative sources, validated.
pub struct Sources {
    pub manifest: Manifest,
    pub view: CompiledView,
}

pub fn check(project: &Project, report: &mut Report) -> Option<Sources> {
    let manifest = check_manifest(&project.manifest, report);
    let assets: BTreeSet<String> = project.assets.keys().cloned().collect();
    let view = match ocml::compile(&project.view, &assets) {
        Ok(view) => Some(view),
        Err(error) => {
            let source = String::from_utf8_lossy(&project.view);
            report.push(view_diagnostic(error.kind, error.position, &source));
            None
        }
    };
    if let Some(style) = &project.style
        && let Err(error) = ocss::parse(style)
    {
        let source = String::from_utf8_lossy(style);
        report.push(style_diagnostic(error.kind, error.position, &source));
    }
    let messages = project
        .locales
        .as_ref()
        .and_then(|(en, fr)| check_locales(en, fr, report));
    if let (Some(view), Some(messages)) = (&view, &messages) {
        check_message_keys(view, messages, &project.view, report);
    } else if let Some(view) = &view
        && project.locales.is_none()
        && uses_t(view)
    {
        report.push(
            Diagnostic::warning(
                "locales.missing_file",
                "the view calls t() but the widget has no locales; the key is shown as is",
            )
            .in_file("view.ocml")
            .help("add locales/en.json and locales/fr.json"),
        );
    }
    Some(Sources {
        manifest: manifest?,
        view: view?,
    })
}

fn at_offset(source: &str, offset: usize) -> Position {
    Position::of(source, offset)
}

// ---------------------------------------------------------------- manifest

fn check_manifest(bytes: &[u8], report: &mut Report) -> Option<Manifest> {
    let error = match validate_manifest(bytes) {
        Ok(manifest) => {
            let source = String::from_utf8_lossy(bytes);
            for origin in unused_origins(&manifest) {
                let mut diagnostic = Diagnostic::warning(
                    "manifest.unused_origin",
                    format!(
                        "no network rule targets `{}`, an origin of the account",
                        crate::sanitize::line(&origin)
                    ),
                )
                .in_file("manifest.json")
                .help("remove it from `origins`, or add the route that needs it");
                if let Some(member) = jsonpos::find(&source, "permissions.accounts") {
                    diagnostic = diagnostic.at(at_offset(&source, member.key));
                }
                report.push(diagnostic);
            }
            return Some(manifest);
        }
        Err(error) => error,
    };
    let source = String::from_utf8_lossy(bytes);
    report.push(manifest_diagnostic(error, &source));
    None
}

pub fn manifest_diagnostic(error: ManifestError, source: &str) -> Diagnostic {
    let code = format!("manifest.{}", error.as_str());
    if let Some((path, index, character)) = hidden_label(error, source) {
        let mut diagnostic =
            Diagnostic::error(code, hidden_message(&format!("`{path}`"), index, character))
                .in_file("manifest.json")
                .help(HIDDEN_HELP);
        if let Some(member) = jsonpos::find(source, &path) {
            diagnostic = diagnostic.at(at_offset(source, member.key));
        }
        return diagnostic;
    }
    let (path, message, help): (&str, String, Option<String>) = match error {
        ManifestError::Size => ("", "manifest.json is too large".into(), None),
        ManifestError::Json => {
            let position = serde_json::from_str::<serde_json::Value>(source)
                .err()
                .map(|error| Position {
                    line: u32::try_from(error.line()).unwrap_or(0),
                    column: u32::try_from(error.column()).unwrap_or(0),
                });
            let mut diagnostic = Diagnostic::error(
                code,
                "manifest.json is not one strict JSON object",
            )
            .in_file("manifest.json")
            .help("no comments, trailing commas, duplicate keys or byte-order mark");
            if let Some(position) = position.filter(|position| position.line > 0) {
                diagnostic = diagnostic.at(position);
            }
            return diagnostic;
        }
        ManifestError::Shape => return shape_diagnostic(code, source),
        ManifestError::SchemaVersion => (
            "schemaVersion",
            "`schemaVersion` must be the integer 1".into(),
            None,
        ),
        ManifestError::ApiVersion => (
            "apiVersion",
            "`apiVersion` must be the integer 1".into(),
            Some("a Web runtime manifest (apiVersion \"1\") is not accepted by widget API v1; start from `overcrow-widget init`".into()),
        ),
        ManifestError::Id => (
            "id",
            "`id` is not a valid widget ID".into(),
            Some(format!("lowercase letters, digits and `-` in at least two parts separated by dots; {ID_FORMS}")),
        ),
        ManifestError::Version => (
            "version",
            "`version` is not canonical SemVer".into(),
            Some("MAJOR.MINOR.PATCH, optionally `-prerelease`, without build metadata or leading zeros".into()),
        ),
        ManifestError::Name => (
            "name",
            "`name` needs non-empty `en` and `fr` texts within the length bound".into(),
            None,
        ),
        ManifestError::Sizing => (
            "sizing",
            "`sizing` is out of bounds or inconsistent".into(),
            Some("`min` <= `preferred` <= `max`, each within the schema's widget size bounds".into()),
        ),
        ManifestError::VmHeap => (
            "vm",
            "`vm.heapMiB` must be an integer from 16 to 48".into(),
            None,
        ),
        ManifestError::NetworkRule => (
            "permissions.network",
            "a `permissions.network` rule is invalid".into(),
            Some("each rule is an HTTPS origin with methods and path prefixes; see the Permissions section of docs/widget-schema-v1.md".into()),
        ),
        ManifestError::GameEvent => (
            "permissions.gameEvents",
            "`permissions.gameEvents` names an unknown or repeated game event".into(),
            None,
        ),
        ManifestError::Capability => {
            let names: Vec<&str> = overcrow_widget_schema::permissions::CAPABILITIES
                .iter()
                .map(|capability| capability.name)
                .collect();
            (
                "permissions.capabilities",
                "`permissions.capabilities` names an unknown or repeated capability".into(),
                Some(format!("capabilities: {}", names.join(", "))),
            )
        }
        ManifestError::SensitiveEgress if declares_account(source) => (
            "permissions",
            "a widget with an account cannot use a sensitive capability or `clipboardWrite`".into(),
            Some("the account confines the widget to its service: drop the sensitive capabilities and clipboard access, or the account".into()),
        ),
        ManifestError::SensitiveEgress => (
            "permissions",
            "a sensitive capability cannot be combined with `network`, `links` or `clipboardWrite`".into(),
            Some("the data it reads must not leave the computer, and a link's address carries data too: drop the network rules, links and clipboard access, or the sensitive capability".into()),
        ),
        ManifestError::LinkRule => (
            "permissions.links",
            "a `permissions.links` rule is invalid, repeated or covered by another".into(),
            Some("at most 8 rules, each an HTTPS `origin` (as in a network rule) and an optional `pathPrefix` of literal segments from `/`; two rules of one origin must not cover each other: keep the wider one".into()),
        ),
        ManifestError::AccountLink => (
            "permissions.links",
            "with an account, every link must stay on the account's service".into(),
            Some("a link's address could carry the account's data to another site: link only to the service's own sites (Steam: steampowered.com, steamcommunity.com; a declared account: the hosts of its `origins`, key page or sign-in page), or remove the rule".into()),
        ),
        ManifestError::Account => (
            "permissions.accounts",
            "`permissions.accounts` is invalid".into(),
            Some("exactly one entry: an integrated service, `{ \"service\": \"steam\" }` or `{ \"service\": \"twitch\", \"scopes\": [...] }` with scopes the service offers; or a declared account: an `id` of lowercase letters, digits and `-` (not `playervox` or `twitch`), the service's `name`, `mode` `key` with `send` and `key`, or `oauth` with `oauth`, 1 to 4 HTTPS `origins`, a `send.query` no route of the account declares; see the Accounts section of docs/widget-schema-v1.md".into()),
        ),
        ManifestError::AccountService => (
            "permissions.accounts",
            "this account is an integrated service's: its ID, name, origins, key page or OAuth endpoints are Steam's or Twitch's".into(),
            Some("name the service instead, `{ \"service\": \"steam\" }` or `{ \"service\": \"twitch\" }`: PlayerVox OverCrow connects it once and applies its guards; see the Integrated services section of docs/widget-schema-v1.md".into()),
        ),
        ManifestError::ServiceRoute => (
            "permissions.network",
            "a network rule of a widget with an integrated service is not one the service allows".into(),
            Some("integrated services are read-only: use `GET`, and stay on the paths the service allows (Steam: ISteamUser, IPlayerService, ISteamUserStats, ISteamApps, ISteamNews; Twitch: its listed /helix/ endpoints, each with the scope it reads in your `scopes`); see the Integrated services section of docs/widget-schema-v1.md".into()),
        ),
        ManifestError::AccountOrigin => (
            "permissions.network",
            "with an account, every network rule must target one of the account's `origins`".into(),
            Some("add the rule's origin to `origins` if it belongs to the service, or remove the rule".into()),
        ),
        ManifestError::AccountOverlap => (
            "permissions.network",
            "two network rules of the same origin and method may match the same URL but do not name the same `account`".into(),
            Some("give both rules the same `account`, or make their paths differ by a literal segment".into()),
        ),
        ManifestError::AccountEndpoint => (
            "permissions.network",
            "a network rule targets an OAuth endpoint of the account".into(),
            Some("OverCrow alone calls `authorize`, `token`, `device`, `verify`, `revoke` and `validate`: remove the rule".into()),
        ),
        ManifestError::AccountScope => (
            "permissions.accounts",
            "an OAuth scope would give the stream key to the widget".into(),
            Some("remove the scopes that contain `stream_key` or `streamkey`".into()),
        ),
        ManifestError::Wrapper => (
            "wrapper",
            "`wrapper.menu` is invalid".into(),
            Some("see the Wrapper menu section of docs/widget-schema-v1.md".into()),
        ),
        ManifestError::Requires => (
            "requires",
            "`requires` must list distinct host features".into(),
            Some(format!(
                "host features: {}",
                overcrow_widget_schema::wrapper::HOST_FEATURES.join(", ")
            )),
        ),
    };
    let mut diagnostic = Diagnostic::error(code, message).in_file("manifest.json");
    if !path.is_empty()
        && let Some(member) = jsonpos::find(source, path)
    {
        diagnostic = diagnostic.at(at_offset(source, member.key));
    }
    if let Some(help) = help {
        diagnostic = diagnostic.help(help);
    }
    diagnostic
}

/// Whether the manifest source declares an account.
fn declares_account(source: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(source).is_ok_and(|manifest| {
        manifest["permissions"]["accounts"]
            .as_array()
            .is_some_and(|accounts| !accounts.is_empty())
    })
}

/// For a name or menu error, the first name or menu label that holds a
/// hidden character: its dotted path, the character's index and the
/// character. The schema refuses the category; this says which text.
fn hidden_label(error: ManifestError, source: &str) -> Option<(String, usize, char)> {
    let manifest: serde_json::Value = serde_json::from_str(source).ok()?;
    let mut texts = Vec::new();
    match error {
        ManifestError::Name => label_texts(&manifest["name"], "name", &mut texts),
        ManifestError::Wrapper => {
            menu_labels(&manifest["wrapper"]["menu"], "wrapper.menu", &mut texts)
        }
        _ => return None,
    }
    texts.into_iter().find_map(|(path, text)| {
        let (index, character) = hidden_character(text.as_str()?)?;
        Some((path, index, character))
    })
}

fn label_texts<'a>(
    label: &'a serde_json::Value,
    path: &str,
    out: &mut Vec<(String, &'a serde_json::Value)>,
) {
    for locale in ["en", "fr"] {
        out.push((format!("{path}.{locale}"), &label[locale]));
    }
}

/// The label texts of the menu rows and choices under `value`.
fn menu_labels<'a>(
    value: &'a serde_json::Value,
    path: &str,
    out: &mut Vec<(String, &'a serde_json::Value)>,
) {
    match value {
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                menu_labels(item, &format!("{path}.{index}"), out);
            }
        }
        serde_json::Value::Object(members) => {
            if let Some(label) = members.get("label") {
                label_texts(label, &format!("{path}.label"), out);
            }
            for (key, member) in members {
                if key != "label" {
                    menu_labels(member, &format!("{path}.{key}"), out);
                }
            }
        }
        _ => {}
    }
}

/// A shape error: name the first unknown or missing top-level field when
/// there is one; nested shapes are reported on the whole file.
fn shape_diagnostic(code: String, source: &str) -> Diagnostic {
    let known: Vec<&str> = MANIFEST_FIELDS.iter().map(|field| field.name).collect();
    let top: Vec<jsonpos::Member> = jsonpos::members(source)
        .into_iter()
        .filter(|member| !member.path.contains('.'))
        .collect();
    if let Some(unknown) = top
        .iter()
        .find(|member| !known.contains(&member.path.as_str()))
    {
        let mut diagnostic =
            Diagnostic::error(code, format!("`{}` is not a manifest field", unknown.path))
                .in_file("manifest.json")
                .at(at_offset(source, unknown.key));
        diagnostic = match closest(&unknown.path, known.iter().copied()) {
            Some(name) => diagnostic.help(format!("did you mean `{name}`?")),
            None => diagnostic.help(format!("manifest fields: {}", known.join(", "))),
        };
        return diagnostic;
    }
    if let Some(missing) = MANIFEST_FIELDS
        .iter()
        .find(|field| field.required && !top.iter().any(|member| member.path == field.name))
    {
        return Diagnostic::error(
            code,
            format!("the required field `{}` is missing", missing.name),
        )
        .in_file("manifest.json");
    }
    Diagnostic::error(
        code,
        "a manifest field has the wrong type or an unknown member",
    )
    .in_file("manifest.json")
    .help("compare with docs/widget-schema-v1.md, section Manifest")
}

// -------------------------------------------------------------------- view

/// The name at `position`, skipping the markup that precedes it
/// (`<`, `</`, `on:`), and the tag of the element that contains it.
fn name_at(source: &str, position: Position) -> (Option<String>, Option<String>) {
    let Some(offset) = offset_of(source, position) else {
        return (None, None);
    };
    let rest = &source[offset..];
    let rest = rest.trim_start_matches(['<', '/']);
    let rest = rest.strip_prefix("on:").unwrap_or(rest);
    let name: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    let tag = source[..offset].rfind('<').map(|start| {
        source[start + 1..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
    });
    (
        (!name.is_empty()).then_some(name),
        tag.filter(|tag| !tag.is_empty()),
    )
}

/// Byte offset of a one-based line and character column.
pub fn offset_of(source: &str, position: Position) -> Option<usize> {
    if position.line == 0 {
        return None;
    }
    let mut offset = 0;
    for _ in 1..position.line {
        offset += source[offset..].find('\n')? + 1;
    }
    let line = &source[offset..];
    let column = line
        .char_indices()
        .nth(position.column.saturating_sub(1) as usize)
        .map_or(line.len(), |(index, _)| index);
    Some(offset + column)
}

pub fn view_diagnostic(kind: OcmlErrorKind, position: Position, source: &str) -> Diagnostic {
    let (name, tag) = name_at(source, position);
    let quoted = |fallback: &str| {
        name.clone()
            .map_or(fallback.to_owned(), |name| format!("`{name}`"))
    };
    let element = tag.as_deref().and_then(view::element);
    let (message, help): (String, Option<String>) = match kind {
        OcmlErrorKind::Size => ("the view or its compiled form is too large".into(), None),
        OcmlErrorKind::Encoding => (
            "view.ocml must be UTF-8 without byte-order mark or control characters".into(),
            None,
        ),
        OcmlErrorKind::Syntax => ("malformed markup".into(), Some(
            "check quotes, `/>` and closing tags; comments cannot contain `--`".into(),
        )),
        OcmlErrorKind::InvalidEntity => ("unknown or invalid entity".into(), Some(
            "entities: &amp; &lt; &gt; &quot; &apos; &lbrace; &rbrace; &nbsp; &#...;".into(),
        )),
        OcmlErrorKind::UnknownElement => {
            let names = view::ELEMENTS.iter().map(|element| element.name);
            let help = name
                .as_deref()
                .and_then(|name| closest(name, names))
                .map(|found| format!("did you mean <{found}>?"))
                .unwrap_or_else(|| "elements are listed in docs/widget-schema-v1.md, section View".into());
            (format!("{} is not an element or a declared component", quoted("this")), Some(help))
        }
        OcmlErrorKind::InvalidParent => (
            format!("{} is not allowed here", quoted("this element")),
            Some("check the Content and Parents columns of the element table".into()),
        ),
        OcmlErrorKind::UnknownAttribute => {
            let mut known: Vec<&str> = view::COMMON_ATTRIBUTES.iter().map(|field| field.name).collect();
            if let Some(element) = element {
                known.extend(element.attributes.iter().map(|field| field.name));
            }
            let help = name
                .as_deref()
                .and_then(|name| closest(name, known.iter().copied()))
                .map(|found| format!("did you mean `{found}`?"))
                .unwrap_or_else(|| format!("attributes: {}", known.join(", ")));
            let on = tag.as_deref().map(|tag| format!(" of <{tag}>")).unwrap_or_default();
            (format!("{} is not an attribute{on}", quoted("this")), Some(help))
        }
        OcmlErrorKind::DuplicateAttribute => (format!("{} is repeated", quoted("an attribute")), None),
        OcmlErrorKind::InvalidAttribute => {
            let help = match name.as_deref() {
                Some("name") if tag.as_deref() == Some("icon") => {
                    Some("icon names are Lucide names, such as `circle-check`".into())
                }
                _ => Some("check the attribute's type in docs/widget-schema-v1.md; runtime values need `{...}`".into()),
            };
            (format!("the value of {} is invalid", quoted("this attribute")), help)
        }
        OcmlErrorKind::MissingAttribute => {
            let required: Vec<&str> = element
                .map(|element| {
                    element
                        .attributes
                        .iter()
                        .filter(|field| field.required)
                        .map(|field| field.name)
                        .collect()
                })
                .unwrap_or_default();
            let on = tag.as_deref().map(|tag| format!("<{tag}>")).unwrap_or("this element".into());
            let help = (!required.is_empty()).then(|| format!("required: {}", required.join(", ")));
            (format!("{on} lacks a required attribute"), help)
        }
        OcmlErrorKind::UnknownEvent => {
            let events: Vec<&str> = element.map(|element| element.events.to_vec()).unwrap_or_default();
            let help = name
                .as_deref()
                .and_then(|name| closest(name, events.iter().copied()))
                .map(|found| format!("did you mean `on:{found}`?"))
                .or_else(|| (!events.is_empty()).then(|| format!("events: {}", events.join(", "))));
            let on = tag.as_deref().map(|tag| format!(" of <{tag}>")).unwrap_or_default();
            (format!("{} is not an event{on}", quoted("this")), help)
        }
        OcmlErrorKind::InvalidHandler => (
            "a handler is a logic function name or a call".into(),
            Some("write `on:activate={increment}` or `on:activate={remove(item.id)}`".into()),
        ),
        OcmlErrorKind::Expression(kind) => expression_message(kind, name.as_deref()),
        OcmlErrorKind::InvalidText => (
            "text is not allowed here".into(),
            Some("text goes in <text>, <span>, <badge> or <option>".into()),
        ),
        OcmlErrorKind::RecursiveComponent => ("a component uses itself".into(), None),
        OcmlErrorKind::InvalidComponent => (
            "invalid component declaration or use".into(),
            Some("components are declared once at the top level, with `name` and `props`, and used with declared props only".into()),
        ),
        OcmlErrorKind::InvalidSlot => ("a component body has at most one <slot/>".into(), None),
        OcmlErrorKind::InvalidConstruct => (
            "misplaced template construct".into(),
            Some("<else-if> and <else> follow an <if>; <for> needs `each`, `as` and `key`".into()),
        ),
        OcmlErrorKind::MissingAsset => (
            "the image is not in assets/".into(),
            Some("static `src` values name a file of the project's assets/ directory".into()),
        ),
        OcmlErrorKind::InvalidRef => (
            "invalid `ref`".into(),
            Some("a `ref` is a quoted identifier, unique, and not inside <for> or a component".into()),
        ),
        OcmlErrorKind::UnknownRef => ("this names a `ref` the view does not declare".into(), None),
        OcmlErrorKind::BoundValue => (
            "`value` on a control of a form with an `intent`".into(),
            Some("the host owns the fields, text areas and sliders of such a form and stops a widget that sets one: remove `value` and read the control's `input` events".into()),
        ),
        OcmlErrorKind::TooManyElements
        | OcmlErrorKind::TooManyComponents
        | OcmlErrorKind::TooManyChildren
        | OcmlErrorKind::TooManyExpressions
        | OcmlErrorKind::TooDeep => (
            "the view exceeds a size bound of the schema".into(),
            Some("split long static content, or render repeated content with <for>".into()),
        ),
    };
    let mut diagnostic = Diagnostic::error(format!("view.{}", kind.as_str()), message)
        .in_file("view.ocml")
        .at(position);
    if let Some(help) = help {
        diagnostic = diagnostic.help(help);
    }
    diagnostic
}

fn expression_message(kind: ExprErrorKind, name: Option<&str>) -> (String, Option<String>) {
    match kind {
        ExprErrorKind::Syntax => (
            "this expression is outside the template subset".into(),
            Some("no assignment, arrow, `new`, template literal, method call or global; move logic into an exported function".into()),
        ),
        ExprErrorKind::TooLong | ExprErrorKind::TooDeep | ExprErrorKind::TooManyEntries => (
            "this expression is too large".into(),
            Some("move the computation into an exported logic function".into()),
        ),
        ExprErrorKind::ReservedName => (
            "a reserved name is used in an expression".into(),
            Some("`eval`, `constructor`, `prototype`, `globalThis`, `overcrow`, `undefined` and names starting with `__` are reserved".into()),
        ),
        ExprErrorKind::UnknownName => (
            format!(
                "{} is not in scope",
                name.map_or("a name".to_owned(), |name| format!("`{name}`"))
            ),
            Some("names in scope: `state`, `for` items, component props and `event` in handlers; functions are called by bare name".into()),
        ),
    }
}

// ------------------------------------------------------------------- style

pub fn style_diagnostic(kind: OcssErrorKind, position: Position, source: &str) -> Diagnostic {
    let name = offset_of(source, position).map(|offset| {
        source[offset..]
            .trim_start_matches([':', '.'])
            .trim_start_matches("var(")
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
    });
    let name = name.filter(|name| !name.is_empty());
    let quoted = name
        .as_deref()
        .map_or("this".to_owned(), |name| format!("`{name}`"));
    let suggest = |candidates: Vec<&'static str>| {
        name.as_deref()
            .and_then(|name| closest(name, candidates))
            .map(|found| format!("did you mean `{found}`?"))
    };
    let (message, help): (String, Option<String>) = match kind {
        OcssErrorKind::Size => ("style.ocss is too large".into(), None),
        OcssErrorKind::Encoding => (
            "style.ocss is ASCII outside comments, without byte-order mark".into(),
            None,
        ),
        OcssErrorKind::Syntax => ("malformed style sheet".into(), Some("check braces, `;` and `:`".into())),
        OcssErrorKind::Unsupported => (
            "this CSS feature is outside the style subset".into(),
            Some("no @media, @import, !important, attribute or universal selectors; see https://overcrow.playervox.com/docs/en/style/#what-is-refused".into()),
        ),
        OcssErrorKind::UnknownElement => (
            format!("{quoted} is not an element"),
            suggest(view::ELEMENTS.iter().map(|element| element.name).collect()),
        ),
        OcssErrorKind::UnknownPseudoClass => (
            format!("{quoted} is not a supported state"),
            Some(format!("states: {}", style::PSEUDO_CLASSES.join(", "))),
        ),
        OcssErrorKind::InvalidSelector => ("invalid selector".into(), None),
        OcssErrorKind::UnknownProperty => (
            format!("{quoted} is not a property of the style subset"),
            suggest(style::PROPERTIES.iter().map(|property| property.name).collect()),
        ),
        OcssErrorKind::DuplicateProperty => (format!("{quoted} is repeated in this rule"), None),
        OcssErrorKind::InvalidValue => (
            "invalid value for this property".into(),
            Some("colors, lengths and radii come from `var(--token)` or literal values of the property's syntax".into()),
        ),
        OcssErrorKind::UnknownToken => (
            format!("{quoted} is not a design token of this type"),
            name.as_deref()
                .and_then(|name| {
                    closest(name, tokens::TOKENS.iter().map(|token| token.name.trim_start_matches("--")))
                })
                .map(|found| format!("did you mean `var(--{found})`?")),
        ),
        OcssErrorKind::NotAnimatable => (
            format!("{quoted} cannot be animated"),
            Some("only paint properties (colors, opacity, transforms) animate".into()),
        ),
        OcssErrorKind::UnknownKeyframes => ("no @keyframes has this name".into(), None),
        OcssErrorKind::DuplicateKeyframes => ("this @keyframes name is repeated".into(), None),
        OcssErrorKind::InvalidKeyframes => ("invalid @keyframes block".into(), None),
        OcssErrorKind::TooManyRules
        | OcssErrorKind::TooManySelectors
        | OcssErrorKind::TooManyCompounds
        | OcssErrorKind::TooManySimpleSelectors
        | OcssErrorKind::TooManyDeclarations
        | OcssErrorKind::TooManyKeyframes
        | OcssErrorKind::TooManyStops => ("the style sheet exceeds a size bound of the schema".into(), None),
    };
    let mut diagnostic = Diagnostic::error(format!("style.{}", kind.as_str()), message)
        .in_file("style.ocss")
        .at(position);
    if let Some(help) = help {
        diagnostic = diagnostic.help(help);
    }
    diagnostic
}

// ----------------------------------------------------------------- locales

/// Checks both locale files with the package's rules and returns the English
/// messages, or `None` after reporting.
fn check_locales(en: &[u8], fr: &[u8], report: &mut Report) -> Option<BTreeMap<String, String>> {
    let en_messages = locale_file("locales/en.json", en, report);
    let fr_messages = locale_file("locales/fr.json", fr, report);
    let (en_messages, fr_messages) = (en_messages?, fr_messages?);
    let mut same = true;
    for (file, own, other_file, other, source) in [
        (
            "locales/en.json",
            &en_messages,
            "locales/fr.json",
            &fr_messages,
            en,
        ),
        (
            "locales/fr.json",
            &fr_messages,
            "locales/en.json",
            &en_messages,
            fr,
        ),
    ] {
        let text = String::from_utf8_lossy(source);
        for key in own.keys().filter(|key| !other.contains_key(*key)) {
            same = false;
            let mut diagnostic = Diagnostic::error(
                "locales.keys",
                format!("`{key}` is in {file} but not in {other_file}"),
            )
            .in_file(file)
            .help("both locale files have exactly the same keys");
            if let Some(member) = jsonpos::find(&text, key).filter(|member| member.path == *key) {
                diagnostic = diagnostic.at(at_offset(&text, member.key));
            }
            report.push(diagnostic);
        }
    }
    same.then_some(en_messages)
}

fn locale_file(file: &str, bytes: &[u8], report: &mut Report) -> Option<BTreeMap<String, String>> {
    let text = String::from_utf8_lossy(bytes);
    let value = match overcrow_widget_schema::json::parse_strict(bytes, bytes.len() as u64) {
        Some(value) => value,
        None => {
            report.push(
                Diagnostic::error(
                    "locales.json",
                    format!("{file} is not one strict JSON object"),
                )
                .in_file(file)
                .help("no comments, trailing commas, duplicate keys or byte-order mark"),
            );
            return None;
        }
    };
    let Some(object) = value.as_object() else {
        report.push(
            Diagnostic::error(
                "locales.shape",
                format!("{file} must be an object of strings"),
            )
            .in_file(file),
        );
        return None;
    };
    if object.len() as u64 > MAX_LOCALE_ENTRIES.value {
        report.push(
            Diagnostic::error(
                "locales.entry_limit",
                format!("{file} has more than {} messages", MAX_LOCALE_ENTRIES.value),
            )
            .in_file(file),
        );
        return None;
    }
    let mut messages = BTreeMap::new();
    let mut valid = true;
    for (key, value) in object {
        let position = jsonpos::find(&text, key)
            .filter(|member| member.path == *key)
            .map(|member| at_offset(&text, member.key));
        let problem = if key.len() as u64 > MAX_LOCALE_KEY_BYTES.value
            || !key
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
        {
            Some((
                "locales.key",
                format!("`{key}` is not a valid message key"),
                "keys use ASCII letters, digits, `_`, `.` and `-`, starting with a letter or digit",
            ))
        } else {
            match value.as_str() {
                None => Some((
                    "locales.shape",
                    format!("`{key}` is not a string"),
                    "messages are strings",
                )),
                Some(text) if text.len() as u64 > MAX_LOCALE_VALUE_BYTES.value => Some((
                    "locales.value",
                    format!("the message `{key}` is too long"),
                    "shorten it below the schema's MAX_LOCALE_VALUE_BYTES",
                )),
                Some(text) if text.chars().any(|c| c.is_control() && c != '\n') => Some((
                    "locales.value",
                    format!("the message `{key}` contains a control character"),
                    "only line feeds are allowed",
                )),
                Some(text) => {
                    messages.insert(key.clone(), text.to_owned());
                    None
                }
            }
        };
        if let Some((code, message, help)) = problem {
            valid = false;
            let mut diagnostic = Diagnostic::error(code, message).in_file(file).help(help);
            if let Some(position) = position {
                diagnostic = diagnostic.at(position);
            }
            report.push(diagnostic);
        }
    }
    valid.then_some(messages)
}

fn uses_t(view: &CompiledView) -> bool {
    view.functions.iter().any(|name| name == "t")
}

/// Origins of the account that neither a network rule nor an OAuth
/// endpoint uses.
fn unused_origins(manifest: &Manifest) -> Vec<String> {
    let Some(account) = manifest.account() else {
        return Vec::new();
    };
    // An integrated service's origins come from its table.
    if account.service.is_some() {
        return Vec::new();
    }
    let rules = manifest.value["permissions"]["network"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let endpoints: Vec<&str> = account
        .oauth
        .as_ref()
        .map(|oauth| oauth.endpoints())
        .unwrap_or_default();
    account
        .origins
        .iter()
        .filter(|origin| {
            !rules.iter().any(|rule| rule["origin"] == origin.as_str())
                && !endpoints.iter().any(|endpoint| {
                    overcrow_widget_schema::accounts::https_url(endpoint, false)
                        .is_some_and(|(endpoint_origin, _)| endpoint_origin == origin.as_str())
                })
        })
        .cloned()
        .collect()
}

/// Warns about `t("key")` calls whose literal key has no message. Keys
/// computed at runtime cannot be checked.
fn check_message_keys(
    view: &CompiledView,
    messages: &BTreeMap<String, String>,
    source: &[u8],
    report: &mut Report,
) {
    let mut keys = BTreeSet::new();
    for expression in &view.expressions {
        collect_t_keys(&expression.expr, &mut keys);
    }
    let text = String::from_utf8_lossy(source);
    for key in keys.into_iter().filter(|key| !messages.contains_key(key)) {
        let mut diagnostic = Diagnostic::warning(
            "locales.unknown_key",
            format!("t(\"{key}\") has no message in the locales"),
        )
        .in_file("view.ocml")
        .help(format!(
            "add \"{key}\" to locales/en.json and locales/fr.json"
        ));
        if let Some(offset) = text.find(&format!("\"{key}\"")) {
            diagnostic = diagnostic.at(at_offset(&text, offset));
        }
        report.push(diagnostic);
    }
}

fn collect_t_keys(expr: &Expr, keys: &mut BTreeSet<String>) {
    match expr {
        Expr::Call {
            function,
            arguments,
        } => {
            if function == "t"
                && let Some(Expr::String(key)) = arguments.first()
            {
                keys.insert(key.clone());
            }
            arguments
                .iter()
                .for_each(|argument| collect_t_keys(argument, keys));
        }
        Expr::Member { object, .. } => collect_t_keys(object, keys),
        Expr::Index { object, index, .. } => {
            collect_t_keys(object, keys);
            collect_t_keys(index, keys);
        }
        Expr::Unary(_, operand) => collect_t_keys(operand, keys),
        Expr::Binary(_, left, right) => {
            collect_t_keys(left, keys);
            collect_t_keys(right, keys);
        }
        Expr::Conditional(test, then, otherwise) => {
            collect_t_keys(test, keys);
            collect_t_keys(then, keys);
            collect_t_keys(otherwise, keys);
        }
        Expr::Array(items) => items.iter().for_each(|item| collect_t_keys(item, keys)),
        Expr::Object(entries) => entries
            .iter()
            .for_each(|(_, value)| collect_t_keys(value, keys)),
        Expr::Null | Expr::Bool(_) | Expr::Number(_) | Expr::String(_) | Expr::Name(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diag::Severity;
    use serde_json::json;

    fn runlog(
        origins: serde_json::Value,
        extra_rules: Vec<serde_json::Value>,
    ) -> serde_json::Value {
        let mut network = vec![json!({
            "origin": "https://api.runlog.example",
            "method": "GET",
            "path": "/ISteamUser/GetPlayerSummaries/v2/",
            "account": "runlog"
        })];
        network.extend(extra_rules);
        json!({
            "schemaVersion": 1,
            "apiVersion": 1,
            "id": "nova.steam-stats",
            "version": "1.0.0",
            "name": {"en": "Steam stats", "fr": "Stats Steam"},
            "sizing": {
                "fit": "none",
                "preferred": {"width": 300, "height": 170},
                "min": {"width": 300, "height": 170},
                "max": {"width": 300, "height": 170}
            },
            "permissions": {
                "accounts": [{
                    "id": "runlog",
                    "name": "Run Log",
                    "mode": "key",
                    "origins": origins,
                    "send": {"header": "X-WebAPI-Key"},
                    "key": {
                        "format": {"charset": "hex", "minLength": 32, "maxLength": 32},
                        "page": "https://runlog.example/settings/api"
                    }
                }],
                "network": network
            }
        })
    }

    fn checked(manifest: &serde_json::Value) -> Report {
        let mut report = Report::default();
        let source = serde_json::to_string_pretty(manifest).expect("JSON");
        check_manifest(source.as_bytes(), &mut report);
        report
    }

    #[test]
    fn each_account_error_says_what_to_fix() {
        for error in [
            ManifestError::Account,
            ManifestError::AccountOrigin,
            ManifestError::AccountOverlap,
            ManifestError::AccountEndpoint,
            ManifestError::AccountScope,
            ManifestError::AccountService,
            ManifestError::ServiceRoute,
            ManifestError::LinkRule,
            ManifestError::AccountLink,
        ] {
            let diagnostic = manifest_diagnostic(error, "{}");
            assert_eq!(diagnostic.code, format!("manifest.{}", error.as_str()));
            assert!(
                diagnostic.help.is_some_and(|help| !help.is_empty()),
                "{error:?}"
            );
        }
        let mut manifest = runlog(json!(["https://api.runlog.example"]), Vec::new());
        manifest["permissions"]["clipboardWrite"] = json!(true);
        let report = checked(&manifest);
        let diagnostic = &report.diagnostics[0];
        assert_eq!(diagnostic.code, "manifest.sensitive_egress");
        assert!(
            diagnostic.message.contains("account"),
            "{}",
            diagnostic.message
        );
        let overlap = runlog(
            json!(["https://api.runlog.example"]),
            vec![json!({
                "origin": "https://api.runlog.example",
                "method": "GET",
                "path": "/ISteamUser/{method}/v2/",
                "pathParams": {"method": {"type": "slug", "maxLength": 32}}
            })],
        );
        let report = checked(&overlap);
        assert_eq!(report.diagnostics[0].code, "manifest.account_overlap");
        assert!(
            report.diagnostics[0].position.line > 0,
            "points at the rules"
        );
    }

    #[test]
    fn a_service_brings_its_origins_and_its_refusals_say_what_to_do() {
        let mut manifest = runlog(json!(["https://api.runlog.example"]), Vec::new());
        manifest["permissions"] = json!({
            "accounts": [{"service": "steam"}],
            "network": [{
                "origin": "https://api.steampowered.com",
                "method": "GET",
                "path": "/ISteamUser/GetPlayerSummaries/v2/",
                "account": "steam"
            }]
        });
        // The service's image origins are its table's: no unused origin.
        assert!(checked(&manifest).diagnostics.is_empty());
        manifest["permissions"]["network"][0]["path"] = json!("/IEconService/GetTradeOffers/v1/");
        let report = checked(&manifest);
        assert_eq!(report.diagnostics[0].code, "manifest.service_route");
        assert!(
            report.diagnostics[0]
                .help
                .as_deref()
                .is_some_and(|help| help.contains("read-only")),
            "{:?}",
            report.diagnostics[0].help
        );
        let mut imitation = runlog(json!(["https://api.runlog.example"]), Vec::new());
        imitation["permissions"]["accounts"][0]["name"] = json!("Steam");
        let report = checked(&imitation);
        assert_eq!(report.diagnostics[0].code, "manifest.account_service");
        assert!(
            report.diagnostics[0]
                .help
                .as_deref()
                .is_some_and(|help| help.contains("\"service\": \"steam\"")),
            "{:?}",
            report.diagnostics[0].help
        );
    }

    #[test]
    fn an_origin_no_route_uses_is_a_warning() {
        let report = checked(&runlog(
            json!(["https://api.runlog.example", "https://cdn.runlog.example"]),
            Vec::new(),
        ));
        let codes: Vec<(&str, Severity)> = report
            .diagnostics
            .iter()
            .map(|diagnostic| (diagnostic.code.as_str(), diagnostic.severity))
            .collect();
        assert_eq!(codes, [("manifest.unused_origin", Severity::Warning)]);
        assert!(
            report.diagnostics[0]
                .message
                .contains("https://cdn.runlog.example")
        );
        assert!(
            checked(&runlog(json!(["https://api.runlog.example"]), Vec::new()))
                .diagnostics
                .is_empty()
        );
    }

    #[test]
    fn the_origin_of_an_oauth_endpoint_is_used() {
        let mut manifest = runlog(
            json!([
                "https://api.streamstats.example",
                "https://id.streamstats.example"
            ]),
            Vec::new(),
        );
        let account = &mut manifest["permissions"]["accounts"][0];
        account["mode"] = json!("oauth");
        let object = account.as_object_mut().expect("account");
        object.remove("send");
        object.remove("key");
        account["oauth"] = json!({
            "clientId": "abc",
            "flow": "device",
            "device": "https://id.streamstats.example/oauth2/device",
            "verify": "https://streamstats.example/activate",
            "token": "https://id.streamstats.example/oauth2/token",
            "scopes": [{"name": "user:read:email", "access": "read"}]
        });
        manifest["permissions"]["network"][0]["origin"] = json!("https://api.streamstats.example");
        manifest["permissions"]["network"][0]["path"] = json!("/helix/users");
        assert!(checked(&manifest).diagnostics.is_empty());
    }
}
