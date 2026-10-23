//! Third-party accounts of a widget (ADR 0009): `permissions.accounts`
//! declares at most one account on a service, and the network rules that
//! name it carry the user's secret. The host keeps the secret, asks for it
//! in its own panel and adds it to those requests only; the widget never
//! sees it.
//!
//! With an account, the widget is confined to the service: every network
//! rule targets one of the account's `origins`, no sensitive capability and
//! no `clipboardWrite` are allowed, two rules that may match the same URL
//! carry the same account, and no route targets a declared OAuth endpoint.
//!
//! Once a released application announces a feature (`account-key`,
//! `account-oauth`), this grammar and its bounds are frozen: a relaxation
//! takes a new feature name.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::identifiers::{reads_as_any, reads_as_reserved_name};
use crate::integrated::{IntegratedService, READER_GUARDS, ServiceEvent, service_named};
use crate::json::{has_exact_fields, integer_in};
use crate::limits::{
    MAX_ACCOUNT_ID_BYTES, MAX_ACCOUNT_KEY_BYTES, MAX_ACCOUNT_NAME_CHARS, MAX_ACCOUNT_ORIGINS,
    MAX_ACCOUNT_URL_BYTES, MAX_ACCOUNTS, MAX_AUTH_SCHEME_BYTES, MAX_HEADER_NAME_BYTES,
    MAX_OAUTH_CLIENT_ID_BYTES, MAX_OAUTH_SCOPE_BYTES, MAX_OAUTH_SCOPES, MAX_SERVICE_EVENTS,
    MIN_ACCOUNT_KEY_BYTES,
};
use crate::manifest::{ManifestError, canonical_https_origin, valid_literal_segment};
use crate::model::{Field, ValueType};
use crate::wrapper::valid_label_text;

/// Feature a manifest with a `key` account needs (catalog v2 `requires`).
pub const FEATURE_ACCOUNT_KEY: &str = "account-key";
/// Feature a manifest with an `oauth` account needs.
pub const FEATURE_ACCOUNT_OAUTH: &str = "account-oauth";

/// Account IDs of the host's own accounts, used by test scenarios.
pub const RESERVED_ACCOUNT_IDS: &[&str] = &["playervox", "twitch"];

/// Header names (lowercase) the broker owns or that carry ambient
/// authority; never a carrier of an account's secret or client ID.
pub const FORBIDDEN_HEADERS: &[&str] = &[
    "accept",
    "alt-used",
    "connection",
    "cookie",
    "cookie2",
    "early-data",
    "expect",
    "forwarded",
    "host",
    "http2-settings",
    "keep-alive",
    "max-forwards",
    "origin",
    "priority",
    "range",
    "referer",
    "set-cookie",
    "set-cookie2",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "user-agent",
    "via",
    "x-forwarded",
    "x-real-ip",
];

/// Prefixes (lowercase) of forbidden header names.
pub const FORBIDDEN_HEADER_PREFIXES: &[&str] = &[
    "accept-",
    "content-",
    "if-",
    "proxy-",
    "sec-",
    "x-forwarded-",
];

/// Scope words refused whatever their case and separators (`stream_key`,
/// `stream-key`, `Stream.Key`…): they would hand the broadcast key to the
/// widget.
pub const FORBIDDEN_SCOPE_WORDS: &[&str] = &["streamkey"];

pub const ACCOUNT_FIELDS: &[Field] = &[
    Field::required(
        "id",
        ValueType::Identifier(&MAX_ACCOUNT_ID_BYTES),
        "`[a-z][a-z0-9-]` of 2 bytes to `MAX_ACCOUNT_ID_BYTES`, without a final or double `-`; `playervox` is reserved, and an integrated service's ID (`steam`, `twitch`) is refused: name the service instead. The permission key is `account:<id>`; a network rule names it in `account`.",
    ),
    Field::required(
        "name",
        ValueType::Chars(&MAX_ACCOUNT_NAME_CHARS),
        "The service's name as the host shows it, plain text of at most `MAX_ACCOUNT_NAME_CHARS`; a name that reads as PlayerVox, OverCrow or Valhallab is refused, and so is one that reads as an integrated service (Steam, Valve, Twitch).",
    ),
    Field::required(
        "mode",
        ValueType::Keyword(&["key", "oauth"]),
        "`key`: a personal key or token the user pastes in the host's panel. `oauth`: a sign-in with the publisher's public OAuth client. Exactly the object of the mode is present.",
    ),
    Field::required(
        "origins",
        ValueType::ListOf("origin", &MAX_ACCOUNT_ORIGINS),
        "Distinct canonical HTTPS origins of the service, as in network rules, none of an integrated service. Every network rule of the widget targets one of them.",
    ),
    Field::optional(
        "required",
        ValueType::Bool,
        "Default `true`: the host covers the content until the account is connected. `false`: the widget works without it and opens the host's panel with `account.connect`.",
    ),
    Field::optional(
        "refusedStatus",
        ValueType::Record("list of 401 and 403"),
        "Distinct statuses, among 401 and 403, by which the service refuses the secret on a route of the account; default `[401]`. Such a response marks the account refused (key) or expired (OAuth) and the call fails with `account_refused`.",
    ),
    Field::optional(
        "send",
        ValueType::Record("AccountSend"),
        "Key mode only, required there: how the host sends the key.",
    ),
    Field::optional(
        "key",
        ValueType::Record("AccountKey"),
        "Key mode only, required there.",
    ),
    Field::optional(
        "oauth",
        ValueType::Record("AccountOAuth"),
        "OAuth mode only, required there. The host always sends `Authorization: Bearer <token>`.",
    ),
];

/// An entry of `permissions.accounts` that names an integrated service
/// instead of declaring an account (ADR 0009 §10).
pub const SERVICE_ACCOUNT_FIELDS: &[Field] = &[
    Field::required(
        "service",
        ValueType::Keyword(&["steam", "twitch"]),
        "An integrated service of the table: PlayerVox defines its origins, how the secret is sent, its key page or OAuth client and the paths no widget reaches; the user connects it once and every widget that names it shares the connection. The account's `id` is the service's: the permission key is `account:<service>` and the routes name it in `account`. Only `scopes`, `required` and `events` stand beside it.",
    ),
    Field::optional(
        "scopes",
        ValueType::ListOf("scope name", &MAX_OAUTH_SCOPES),
        "OAuth services only: distinct scopes among those the service offers, all read-only in version 1; default none.",
    ),
    Field::optional(
        "required",
        ValueType::Bool,
        "As for a declared account; default `true`.",
    ),
    Field::optional(
        "events",
        ValueType::ListOf("event type", &MAX_SERVICE_EVENTS),
        "A service with live events only (Twitch): distinct types of the service's table, each read by a scope among `scopes`; the host subscribes on the user's own channel and `twitch.events.subscribe` delivers them. Not part of the permission's detail: an event reads what its scope already opens. Needs the feature `twitch-events`.",
    ),
];

pub const ACCOUNT_SEND_FIELDS: &[Field] = &[
    Field::optional(
        "header",
        ValueType::Text(&MAX_HEADER_NAME_BYTES),
        "Header that carries the key: an HTTP token, not a header the host sets itself (`Host`, `Cookie`, `Content-*`, `Accept*`, `If-*`, `User-Agent`, `Referer`, `Origin`, `Connection`, `Proxy-*`, `Sec-*`, `X-Forwarded-*`…). Exactly one of `header` and `query`.",
    ),
    Field::optional(
        "scheme",
        ValueType::Text(&MAX_AUTH_SCHEME_BYTES),
        "With `header: \"Authorization\"` only: a word `[A-Za-z][A-Za-z0-9-]*` sent before the key (`<scheme> <key>`).",
    ),
    Field::optional(
        "query",
        ValueType::Text(&crate::limits::MAX_PARAMETER_NAME_BYTES),
        "Query parameter that carries the key, a parameter name of the network rules; no route of the account declares it in `queryParams`. Prefer a header.",
    ),
];

pub const ACCOUNT_KEY_FIELDS: &[Field] = &[
    Field::required(
        "format",
        ValueType::Record("KeyFormat"),
        "What a key looks like; the host refuses another one at entry.",
    ),
    Field::required(
        "page",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "The service's page where a user gets a key: `https://` canonical origin, path and optional static query, no fragment or credentials. The host opens it on a click in its panel.",
    ),
];

pub const KEY_FORMAT_FIELDS: &[Field] = &[
    Field::required(
        "charset",
        ValueType::Keyword(&["hex", "alnum", "base64url", "base64", "printable"]),
        "Characters of a key: `hex` (`0-9a-fA-F`), `alnum` (ASCII letters and digits), `base64url` (`alnum`, `-`, `_`, `=`), `base64` (`alnum`, `+`, `/`, `=`) or `printable` (ASCII `!` to `~`).",
    ),
    Field::required(
        "minLength",
        ValueType::Integer {
            min: MIN_ACCOUNT_KEY_BYTES.value as i64,
            max: MAX_ACCOUNT_KEY_BYTES.value as i64,
        },
        "Shortest key, `MIN_ACCOUNT_KEY_BYTES`..=`maxLength`.",
    ),
    Field::required(
        "maxLength",
        ValueType::Integer {
            min: MIN_ACCOUNT_KEY_BYTES.value as i64,
            max: MAX_ACCOUNT_KEY_BYTES.value as i64,
        },
        "Longest key, `minLength`..=`MAX_ACCOUNT_KEY_BYTES`.",
    ),
];

pub const OAUTH_FIELDS: &[Field] = &[
    Field::required(
        "clientId",
        ValueType::Text(&MAX_OAUTH_CLIENT_ID_BYTES),
        "The publisher's public client at the service: ASCII letters, digits, `-`, `.`, `_` and `~`. There is no client secret.",
    ),
    Field::required(
        "flow",
        ValueType::Keyword(&["loopback", "device"]),
        "`loopback`: the system browser and a `http://127.0.0.1:<port>/callback` redirect, PKCE S256. `device`: a code the user enters on the service's page (RFC 8628).",
    ),
    Field::optional(
        "authorize",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "Authorization endpoint; `loopback` only, required there. Every endpoint is an `https://` canonical origin and path, without query, fragment or credentials.",
    ),
    Field::required(
        "token",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "Token endpoint. `token`, `device`, `revoke` and `validate` are on one of the account's `origins`: the host sends them the code, the verifier or tokens.",
    ),
    Field::optional(
        "device",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "Device authorization endpoint; `device` only, required there.",
    ),
    Field::optional(
        "verify",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "The page where the user enters the code; `device` only, required there. The service's `verification_uri` must equal it.",
    ),
    Field::optional(
        "revoke",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "Revocation endpoint (RFC 7009), called at sign-out.",
    ),
    Field::optional(
        "validate",
        ValueType::Text(&MAX_ACCOUNT_URL_BYTES),
        "Token validation endpoint, called with the token at sign-in and hourly while the widget runs; a status of `refusedStatus` marks the account expired. Its body is never read.",
    ),
    Field::required(
        "scopes",
        ValueType::ListOf("AccountScope", &MAX_OAUTH_SCOPES),
        "Scopes the host requests, distinct by name.",
    ),
    Field::optional(
        "scopeParam",
        ValueType::Keyword(&["scope", "scopes"]),
        "Name of the scopes parameter of the host's requests to `device` and `token`; default `scope`. The authorization request always uses `scope`.",
    ),
    Field::optional(
        "clientIdHeader",
        ValueType::Text(&MAX_HEADER_NAME_BYTES),
        "Header that also carries `clientId` on the routes of the account (Twitch: `Client-Id`); the rules of `send.header`, `Authorization` excluded.",
    ),
];

pub const OAUTH_SCOPE_FIELDS: &[Field] = &[
    Field::required(
        "name",
        ValueType::Text(&MAX_OAUTH_SCOPE_BYTES),
        "ASCII letters, digits, `-`, `.`, `_`, `:` and `/`, nothing a service decodes or splits on; a name whose letters and digits contain `streamkey` in any case (`stream_key`, `stream-key`…) is refused.",
    ),
    Field::required(
        "access",
        ValueType::Keyword(&["read", "write"]),
        "Whether the scope can change the user's account; `write` is shown to the user and reviewed.",
    ),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountMode {
    Key,
    OAuth,
}

impl AccountMode {
    /// The catalog v2 feature a manifest with this mode needs.
    pub const fn feature(self) -> &'static str {
        match self {
            Self::Key => FEATURE_ACCOUNT_KEY,
            Self::OAuth => FEATURE_ACCOUNT_OAUTH,
        }
    }
}

/// Where the host puts a key.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Delivery {
    Header {
        name: String,
        scheme: Option<String>,
    },
    Query {
        name: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Charset {
    Hex,
    Alnum,
    Base64Url,
    Base64,
    Printable,
}

impl Charset {
    pub fn allows(self, byte: u8) -> bool {
        match self {
            Self::Hex => byte.is_ascii_hexdigit(),
            Self::Alnum => byte.is_ascii_alphanumeric(),
            Self::Base64Url => byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'='),
            Self::Base64 => byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='),
            Self::Printable => byte.is_ascii_graphic(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct KeyFormat {
    pub charset: Charset,
    pub min_length: usize,
    pub max_length: usize,
}

impl KeyFormat {
    /// Whether `key` has this format.
    pub fn accepts(&self, key: &str) -> bool {
        (self.min_length..=self.max_length).contains(&key.len())
            && key.bytes().all(|byte| self.charset.allows(byte))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KeySettings {
    pub format: KeyFormat,
    pub page: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OAuthFlow {
    Loopback,
    Device,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScopeAccess {
    Read,
    Write,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Scope {
    pub name: String,
    pub access: ScopeAccess,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ScopeParam {
    #[default]
    Scope,
    Scopes,
}

impl ScopeParam {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Scope => "scope",
            Self::Scopes => "scopes",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuth {
    pub client_id: String,
    pub flow: OAuthFlow,
    pub authorize: Option<String>,
    pub token: String,
    pub device: Option<String>,
    pub verify: Option<String>,
    pub revoke: Option<String>,
    pub validate: Option<String>,
    pub scopes: Vec<Scope>,
    pub scope_param: ScopeParam,
    pub client_id_header: Option<String>,
}

impl OAuth {
    /// Every declared endpoint: the host calls them, no route may.
    pub fn endpoints(&self) -> Vec<&str> {
        [
            self.authorize.as_deref(),
            Some(self.token.as_str()),
            self.device.as_deref(),
            self.verify.as_deref(),
            self.revoke.as_deref(),
            self.validate.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

/// A validated account declaration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub mode: AccountMode,
    /// The origins that receive the secret: every origin of a declared
    /// account, the secret origins of an integrated service.
    pub origins: Vec<String>,
    /// An integrated service's other origins (images): the widget may reach
    /// them, never with the secret. Empty for a declared account.
    pub image_origins: Vec<String>,
    pub required: bool,
    pub refused_status: Vec<u16>,
    /// Key mode only.
    pub send: Option<Delivery>,
    /// Key mode only.
    pub key: Option<KeySettings>,
    /// OAuth mode only.
    pub oauth: Option<OAuth>,
    /// The declaration in compact JSON with sorted keys: the detail of the
    /// permission key `account:<id>`.
    pub canonical: String,
    /// The integrated service the entry names; `None` for a declared
    /// account. Its definition fills the fields above.
    pub service: Option<&'static IntegratedService>,
    /// The service's live events the widget receives, in the declared
    /// order; empty for a declared account.
    pub events: Vec<&'static ServiceEvent>,
}

impl Account {
    /// Every origin a widget with this account may reach.
    pub fn all_origins(&self) -> impl Iterator<Item = &str> {
        self.origins
            .iter()
            .chain(&self.image_origins)
            .map(String::as_str)
    }

    /// Whether a scope can change the user's account.
    pub fn has_write_scope(&self) -> bool {
        self.oauth.as_ref().is_some_and(|oauth| {
            oauth
                .scopes
                .iter()
                .any(|scope| scope.access == ScopeAccess::Write)
        })
    }
}

/// `permissions.accounts`.
pub(crate) fn validate_accounts(value: &Value) -> Result<Vec<Account>, ManifestError> {
    let list = value.as_array().ok_or(ManifestError::Shape)?;
    // An empty list needs no feature, yet a reader that does not know the
    // field refuses the manifest (and with it the whole catalog).
    if list.is_empty() || list.len() as u64 > MAX_ACCOUNTS.value {
        return Err(ManifestError::Account);
    }
    list.iter().map(validate_account).collect()
}

fn validate_account(value: &Value) -> Result<Account, ManifestError> {
    let invalid = ManifestError::Account;
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    if object.contains_key("service") {
        return validate_service_account(object, value);
    }
    if !has_exact_fields(object, &[ACCOUNT_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let id = object["id"].as_str().ok_or(invalid)?;
    // A declared account never stands for an integrated service: its ID,
    // its name and its addresses would escape the service's guards. The
    // readers' guard is frozen (`READER_GUARDS`).
    if READER_GUARDS.iter().any(|guard| guard.id == id) {
        return Err(ManifestError::AccountService);
    }
    if !valid_account_id(id) {
        return Err(invalid);
    }
    let name = object["name"].as_str().ok_or(invalid)?;
    if !valid_label_text(name, MAX_ACCOUNT_NAME_CHARS.value) || reads_as_reserved_name(name) {
        return Err(invalid);
    }
    if READER_GUARDS
        .iter()
        .any(|guard| reads_as_any(name, guard.names))
    {
        return Err(ManifestError::AccountService);
    }
    let mode = match object["mode"].as_str() {
        Some("key") => AccountMode::Key,
        Some("oauth") => AccountMode::OAuth,
        _ => return Err(invalid),
    };
    let origins = object["origins"].as_array().ok_or(invalid)?;
    let mut unique = BTreeSet::new();
    if origins.is_empty() || origins.len() as u64 > MAX_ACCOUNT_ORIGINS.value {
        return Err(invalid);
    }
    for origin in origins {
        let origin = origin.as_str().ok_or(invalid)?;
        if !canonical_https_origin(origin) || !unique.insert(origin) {
            return Err(invalid);
        }
        if belongs_to_a_service(origin) {
            return Err(ManifestError::AccountService);
        }
    }
    let required = match object.get("required") {
        None => true,
        Some(required) => required.as_bool().ok_or(invalid)?,
    };
    let refused_status = match object.get("refusedStatus") {
        None => vec![401],
        Some(statuses) => {
            let statuses = statuses.as_array().ok_or(invalid)?;
            let mut seen = Vec::new();
            for status in statuses {
                let status = integer_in(status, 401, 403)
                    .filter(|status| matches!(status, 401 | 403))
                    .ok_or(invalid)? as u16;
                if seen.contains(&status) {
                    return Err(invalid);
                }
                seen.push(status);
            }
            if seen.is_empty() {
                return Err(invalid);
            }
            seen
        }
    };
    let (send, key, oauth) = match (
        mode,
        object.get("send"),
        object.get("key"),
        object.get("oauth"),
    ) {
        (AccountMode::Key, Some(send), Some(key), None) => {
            (Some(validate_send(send)?), Some(validate_key(key)?), None)
        }
        (AccountMode::OAuth, None, None, Some(oauth)) => (None, None, Some(validate_oauth(oauth)?)),
        _ => return Err(invalid),
    };
    let (oauth, stream_key) = match oauth {
        Some((oauth, stream_key)) => (Some(oauth), stream_key),
        None => (None, false),
    };
    // The host sends the code and the PKCE verifier to `token`, the device
    // request to `device`, tokens to `revoke` and `validate`: those go to the
    // service only. The browser opens `authorize` and `verify` with nothing
    // secret.
    if let Some(oauth) = &oauth {
        let receivers = [
            Some(&oauth.token),
            oauth.device.as_ref(),
            oauth.revoke.as_ref(),
            oauth.validate.as_ref(),
        ];
        for endpoint in receivers.into_iter().flatten() {
            let (origin, _) = https_url(endpoint, false).ok_or(invalid)?;
            if !unique.contains(origin) {
                return Err(invalid);
            }
        }
    }
    // Nor does it send the player to a service's pages: the player would get
    // their real Steam key, or sign in at Twitch, for another server.
    let pages = key
        .iter()
        .map(|key| key.page.as_str())
        .chain(oauth.iter().flat_map(OAuth::endpoints));
    for url in pages {
        if belongs_to_a_service(url) {
            return Err(ManifestError::AccountService);
        }
    }
    // Nor does it borrow a service's OAuth client: the service's consent
    // page would show PlayerVox's application.
    if oauth.as_ref().is_some_and(|oauth| {
        READER_GUARDS
            .iter()
            .any(|guard| guard.client_ids.contains(&oauth.client_id.as_str()))
    }) {
        return Err(ManifestError::AccountService);
    }
    // Last, so that the dedicated code names the only fault.
    if stream_key {
        return Err(ManifestError::AccountScope);
    }
    Ok(Account {
        id: id.to_owned(),
        name: name.to_owned(),
        mode,
        origins: unique.into_iter().map(str::to_owned).collect(),
        required,
        refused_status,
        send,
        key,
        oauth,
        canonical: value.to_string(),
        image_origins: Vec::new(),
        service: None,
        events: Vec::new(),
    })
}

/// `{ "service": …, "scopes"?: […], "required"?: bool }`: the account is
/// the service's, as the table defines it.
fn validate_service_account(
    object: &Map<String, Value>,
    value: &Value,
) -> Result<Account, ManifestError> {
    let invalid = ManifestError::Account;
    if !has_exact_fields(object, &[SERVICE_ACCOUNT_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let service = object["service"]
        .as_str()
        .and_then(service_named)
        .ok_or(invalid)?;
    let required = match object.get("required") {
        None => true,
        Some(required) => required.as_bool().ok_or(invalid)?,
    };
    let mut scopes = Vec::new();
    if let Some(requested) = object.get("scopes") {
        let requested = requested.as_array().ok_or(invalid)?;
        // A key service has no scope: even an empty list is a mistake.
        if service.mode != AccountMode::OAuth || requested.len() as u64 > MAX_OAUTH_SCOPES.value {
            return Err(invalid);
        }
        for name in requested {
            let offered = name
                .as_str()
                .and_then(|name| service.scope(name))
                .ok_or(invalid)?;
            if scopes
                .iter()
                .any(|scope: &Scope| scope.name == offered.name)
            {
                return Err(invalid);
            }
            scopes.push(Scope {
                name: offered.name.to_owned(),
                access: offered.access,
            });
        }
    }
    let mut events: Vec<&'static ServiceEvent> = Vec::new();
    if let Some(listed) = object.get("events") {
        let listed = listed.as_array().ok_or(invalid)?;
        // A reader that does not know the field refuses the manifest: an
        // empty list would need the feature for nothing.
        if listed.is_empty() || listed.len() as u64 > MAX_SERVICE_EVENTS.value {
            return Err(invalid);
        }
        for kind in listed {
            let event = kind
                .as_str()
                .and_then(|kind| service.event(kind))
                .ok_or(invalid)?;
            if !scopes.iter().any(|scope| scope.name == event.scope)
                || events.iter().any(|known| known.kind == event.kind)
            {
                return Err(invalid);
            }
            events.push(event);
        }
    }
    // The permission's detail: the declaration without `events`, which
    // never widens what the scopes open.
    let mut canonical = value.clone();
    if let Some(object) = canonical.as_object_mut() {
        object.remove("events");
    }
    let origins: Vec<String> = service
        .secret_origins
        .iter()
        .map(|origin| (*origin).to_owned())
        .collect();
    let image_origins: Vec<String> = service
        .origins
        .iter()
        .map(|origin| (*origin).to_owned())
        .collect();
    let oauth = service.oauth.map(|oauth| OAuth {
        client_id: oauth.client_id.to_owned(),
        flow: oauth.flow,
        authorize: oauth.authorize.map(str::to_owned),
        token: oauth.token.to_owned(),
        device: oauth.device.map(str::to_owned),
        verify: oauth.verify.map(str::to_owned),
        revoke: oauth.revoke.map(str::to_owned),
        validate: oauth.validate.map(str::to_owned),
        scopes,
        scope_param: oauth.scope_param,
        client_id_header: oauth.client_id_header.map(str::to_owned),
    });
    Ok(Account {
        id: service.id.to_owned(),
        name: service.name.to_owned(),
        mode: service.mode,
        origins,
        image_origins,
        required,
        refused_status: service.refused_status.to_vec(),
        send: service.send.map(|send| Delivery::Header {
            name: send.name.to_owned(),
            scheme: send.scheme.map(str::to_owned),
        }),
        key: service.key.map(|key| KeySettings {
            format: key.format,
            page: key.page.to_owned(),
        }),
        oauth,
        canonical: canonical.to_string(),
        service: Some(service),
        events,
    })
}

/// Whether an `https://` origin or URL is an integrated service's: one of
/// its origins, or a host under one of its domains.
fn belongs_to_a_service(url: &str) -> bool {
    let host = url
        .strip_prefix("https://")
        .unwrap_or(url)
        .split(['/', ':', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    READER_GUARDS.iter().any(|guard| guard.owns_host(&host))
}

/// `[a-z][a-z0-9-]{1,31}`, no final or double hyphen, not reserved.
pub fn valid_account_id(id: &str) -> bool {
    account_id_grammar(id) && !RESERVED_ACCOUNT_IDS.contains(&id)
}

/// `[a-z][a-z0-9-]{1,31}`, no final or double hyphen: the grammar of every
/// account ID, the host's and the integrated services' included.
pub fn account_id_grammar(id: &str) -> bool {
    let bytes = id.as_bytes();
    (2..=MAX_ACCOUNT_ID_BYTES.value as usize).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        && !id.ends_with('-')
        && !id.contains("--")
}

/// A scope name: 1 to `MAX_OAUTH_SCOPE_BYTES` of the bytes services name
/// scopes with ([`scope_byte`]).
pub fn valid_scope_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() as u64 <= MAX_OAUTH_SCOPE_BYTES.value
        && name.bytes().all(scope_byte)
}

fn validate_send(value: &Value) -> Result<Delivery, ManifestError> {
    let invalid = ManifestError::Account;
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[ACCOUNT_SEND_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let text = |name: &str| object.get(name).map(|value| value.as_str().ok_or(invalid));
    match (text("header"), text("scheme"), text("query")) {
        (Some(header), scheme, None) => {
            let header = header?;
            if !carrier_header(header) {
                return Err(invalid);
            }
            let scheme = match scheme {
                None => None,
                Some(scheme) => {
                    let scheme = scheme?;
                    if !header.eq_ignore_ascii_case("authorization") || !valid_scheme(scheme) {
                        return Err(invalid);
                    }
                    Some(scheme.to_owned())
                }
            };
            Ok(Delivery::Header {
                name: header.to_owned(),
                scheme,
            })
        }
        (None, None, Some(query)) => {
            let query = query?;
            if !crate::manifest::valid_parameter_name(query) {
                return Err(invalid);
            }
            Ok(Delivery::Query {
                name: query.to_owned(),
            })
        }
        _ => Err(invalid),
    }
}

/// An HTTP field name (RFC 9110 token) of at most `MAX_HEADER_NAME_BYTES`,
/// not owned by the broker.
pub fn carrier_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.is_empty()
        && name.len() as u64 <= MAX_HEADER_NAME_BYTES.value
        && name.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
        && !FORBIDDEN_HEADERS.contains(&lower.as_str())
        && !FORBIDDEN_HEADER_PREFIXES
            .iter()
            .any(|prefix| lower.starts_with(prefix))
}

fn valid_scheme(scheme: &str) -> bool {
    let bytes = scheme.as_bytes();
    !bytes.is_empty()
        && bytes.len() as u64 <= MAX_AUTH_SCHEME_BYTES.value
        && bytes[0].is_ascii_alphabetic()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
}

fn validate_key(value: &Value) -> Result<KeySettings, ManifestError> {
    let invalid = ManifestError::Account;
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[ACCOUNT_KEY_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let format = object["format"].as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(format, &[KEY_FORMAT_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let charset = match format["charset"].as_str() {
        Some("hex") => Charset::Hex,
        Some("alnum") => Charset::Alnum,
        Some("base64url") => Charset::Base64Url,
        Some("base64") => Charset::Base64,
        Some("printable") => Charset::Printable,
        _ => return Err(invalid),
    };
    let (low, high) = (
        MIN_ACCOUNT_KEY_BYTES.value as i64,
        MAX_ACCOUNT_KEY_BYTES.value as i64,
    );
    let min = integer_in(&format["minLength"], low, high).ok_or(invalid)?;
    let max = integer_in(&format["maxLength"], low, high).ok_or(invalid)?;
    if min > max {
        return Err(invalid);
    }
    let page = object["page"].as_str().ok_or(invalid)?;
    if https_url(page, true).is_none() {
        return Err(invalid);
    }
    Ok(KeySettings {
        format: KeyFormat {
            charset,
            min_length: min as usize,
            max_length: max as usize,
        },
        page: page.to_owned(),
    })
}

/// The OAuth object, and whether a scope would expose the stream key: the
/// caller reports it once the rest of the declaration is valid.
fn validate_oauth(value: &Value) -> Result<(OAuth, bool), ManifestError> {
    let invalid = ManifestError::Account;
    let object = value.as_object().ok_or(ManifestError::Shape)?;
    if !has_exact_fields(object, &[OAUTH_FIELDS]) {
        return Err(ManifestError::Shape);
    }
    let client_id = object["clientId"].as_str().ok_or(invalid)?;
    if client_id.is_empty()
        || client_id.len() as u64 > MAX_OAUTH_CLIENT_ID_BYTES.value
        || !client_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
    {
        return Err(invalid);
    }
    let flow = match object["flow"].as_str() {
        Some("loopback") => OAuthFlow::Loopback,
        Some("device") => OAuthFlow::Device,
        _ => return Err(invalid),
    };
    let endpoint = |name: &str| -> Result<Option<String>, ManifestError> {
        match object.get(name) {
            None => Ok(None),
            Some(url) => url
                .as_str()
                .filter(|url| https_url(url, false).is_some())
                .map(|url| Some(url.to_owned()))
                .ok_or(invalid),
        }
    };
    let (authorize, device, verify) = (
        endpoint("authorize")?,
        endpoint("device")?,
        endpoint("verify")?,
    );
    let flow_fits = match flow {
        OAuthFlow::Loopback => authorize.is_some() && device.is_none() && verify.is_none(),
        OAuthFlow::Device => authorize.is_none() && device.is_some() && verify.is_some(),
    };
    if !flow_fits {
        return Err(invalid);
    }
    let token = endpoint("token")?.ok_or(invalid)?;
    let scopes = object["scopes"].as_array().ok_or(invalid)?;
    if scopes.is_empty() || scopes.len() as u64 > MAX_OAUTH_SCOPES.value {
        return Err(invalid);
    }
    let mut names = BTreeSet::new();
    let mut parsed = Vec::new();
    let mut stream_key = false;
    for scope in scopes {
        let scope = scope.as_object().ok_or(ManifestError::Shape)?;
        if !has_exact_fields(scope, &[OAUTH_SCOPE_FIELDS]) {
            return Err(ManifestError::Shape);
        }
        let name = scope["name"].as_str().ok_or(invalid)?;
        if !valid_scope_name(name) || !names.insert(name) {
            return Err(invalid);
        }
        let access = match scope["access"].as_str() {
            Some("read") => ScopeAccess::Read,
            Some("write") => ScopeAccess::Write,
            _ => return Err(invalid),
        };
        // Letters and digits only: a separator never hides a word.
        let folded: String = name
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|character| character.to_ascii_lowercase())
            .collect();
        stream_key |= FORBIDDEN_SCOPE_WORDS
            .iter()
            .any(|word| folded.contains(word));
        parsed.push(Scope {
            name: name.to_owned(),
            access,
        });
    }
    let scope_param = match object.get("scopeParam").map(Value::as_str) {
        None => ScopeParam::Scope,
        Some(Some("scope")) => ScopeParam::Scope,
        Some(Some("scopes")) => ScopeParam::Scopes,
        Some(_) => return Err(invalid),
    };
    let client_id_header = match object.get("clientIdHeader") {
        None => None,
        Some(header) => {
            let header = header.as_str().ok_or(invalid)?;
            if !carrier_header(header) || header.eq_ignore_ascii_case("authorization") {
                return Err(invalid);
            }
            Some(header.to_owned())
        }
    };
    let oauth = OAuth {
        client_id: client_id.to_owned(),
        flow,
        authorize,
        token,
        device,
        verify,
        revoke: endpoint("revoke")?,
        validate: endpoint("validate")?,
        scopes: parsed,
        scope_param,
        client_id_header,
    };
    Ok((oauth, stream_key))
}

/// A byte of a scope name: what services name scopes with (`read:user`,
/// `user-read-private`, `https://…/auth/x.readonly`), and nothing a service
/// decodes (`%`) or splits on (`+`, `,`, space, `&`…).
fn scope_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b':' | b'/')
}

/// `https://<canonical origin><path>[?<query>]` of at most
/// `MAX_ACCOUNT_URL_BYTES`: the path is `/` or literal segments (a final
/// `/` allowed); the query, when allowed, is non-empty static text of
/// unreserved characters, `=`, `&` and `%XX`. No fragment or credentials.
/// Returns `(origin, path)`.
pub fn https_url(url: &str, query_allowed: bool) -> Option<(&str, &str)> {
    if url.len() as u64 > MAX_ACCOUNT_URL_BYTES.value {
        return None;
    }
    let rest = url.strip_prefix("https://")?;
    let slash = rest.find('/')?;
    let origin = &url[..("https://".len() + slash)];
    if !canonical_https_origin(origin) {
        return None;
    }
    let (path, query) = match rest[slash..].split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (&rest[slash..], None),
    };
    let path_valid = path == "/"
        || path
            .strip_suffix('/')
            .unwrap_or(path)
            .split('/')
            .skip(1)
            .all(valid_literal_segment)
            && !path.contains("//");
    let query_valid = match query {
        None => true,
        Some(query) => query_allowed && static_query(query),
    };
    (path_valid && query_valid).then_some((origin, path))
}

fn static_query(query: &str) -> bool {
    let bytes = query.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let escaped = bytes
                    .get(index + 1..index + 3)
                    .is_some_and(|pair| pair.iter().all(u8::is_ascii_hexdigit));
                if !escaped {
                    return false;
                }
                index += 3;
            }
            byte if byte.is_ascii_alphanumeric()
                || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'=' | b'&') =>
            {
                index += 1;
            }
            _ => return false,
        }
    }
    !bytes.is_empty()
}

/// Whether two route paths of the network grammar may match one request
/// path, as `overcrow-widget-net` matches them: segment by segment after
/// splitting on `/`, the empty segment after a final `/` included. Two
/// literals match when equal; a parameter matches any non-empty segment
/// (no constraint accepts an empty value), whatever its constraint.
pub fn paths_may_overlap(a: &str, b: &str) -> bool {
    let (a, b): (Vec<&str>, Vec<&str>) = (a.split('/').collect(), b.split('/').collect());
    a.len() == b.len()
        && a.iter()
            .zip(&b)
            .all(|(a, b)| match (placeholder(a), placeholder(b)) {
                (false, false) => a == b,
                (true, true) => true,
                (true, false) => !b.is_empty(),
                (false, true) => !a.is_empty(),
            })
}

/// A path lowercased, without its final `/` and without a format suffix on
/// its last segment (`token.json`), for the endpoint check: a service may
/// serve all of them as the same endpoint.
fn loose_path(path: &str) -> String {
    let path = path.to_ascii_lowercase();
    let path = match path.strip_suffix('/') {
        Some(stripped) if !stripped.is_empty() => stripped,
        _ => path.as_str(),
    };
    let (head, last) = path.rsplit_once('/').unwrap_or(("", path));
    let last = match last.split_once('.') {
        Some((stem, _)) if !stem.is_empty() && !last.starts_with('{') => stem,
        _ => last,
    };
    format!("{head}/{last}")
}

fn account_of(rule: &Map<String, Value>) -> Option<&str> {
    rule.get("account").and_then(Value::as_str)
}

fn placeholder(segment: &str) -> bool {
    segment.starts_with('{') && segment.ends_with('}')
}

/// The checks between the account and the network rules, once each rule is
/// valid on its own. `rules` are the validated rule objects.
pub(crate) fn validate_account_routes(
    accounts: &[Account],
    rules: &[Value],
) -> Result<(), ManifestError> {
    // A route names a declared account.
    for rule in rules {
        let rule = rule.as_object().ok_or(ManifestError::Shape)?;
        if let Some(name) = rule.get("account") {
            let name = name.as_str().ok_or(ManifestError::NetworkRule)?;
            if !accounts.iter().any(|account| account.id == name) {
                return Err(ManifestError::NetworkRule);
            }
        }
    }
    let Some(account) = accounts.first() else {
        return Ok(());
    };
    let rules: Vec<&Map<String, Value>> = rules.iter().filter_map(Value::as_object).collect();
    // The key's query parameter is the host's: a route of the account never
    // declares it.
    if let Some(Delivery::Query { name }) = &account.send
        && rules.iter().any(|rule| {
            account_of(rule).is_some()
                && rule
                    .get("queryParams")
                    .and_then(Value::as_object)
                    .is_some_and(|params| params.contains_key(name))
        })
    {
        return Err(ManifestError::Account);
    }
    let origin = |rule: &Map<String, Value>| rule["origin"].as_str().unwrap_or_default().to_owned();
    let path = |rule: &Map<String, Value>| rule["path"].as_str().unwrap_or_default().to_owned();
    if rules
        .iter()
        .any(|rule| !account.all_origins().any(|own| own == origin(rule)))
    {
        return Err(ManifestError::AccountOrigin);
    }
    // An integrated service's own guards: the secret goes to its secret
    // origins only, and every route is read-only and stays on the paths the
    // table allows.
    if let Some(service) = account.service {
        for rule in &rules {
            let on_secret_origin = service.secret_origins.contains(&origin(rule).as_str());
            if account_of(rule).is_some() && !on_secret_origin {
                return Err(ManifestError::AccountOrigin);
            }
        }
        // The token is shared: a widget reaches only what its own scopes open.
        let scopes: Vec<&str> = account
            .oauth
            .iter()
            .flat_map(|oauth| &oauth.scopes)
            .map(|scope| scope.name.as_str())
            .collect();
        for rule in &rules {
            let method = rule["method"].as_str().unwrap_or_default();
            if !service.methods.contains(&method)
                || (service.secret_origins.contains(&origin(rule).as_str())
                    && !service.route_path_allowed(&path(rule), &scopes))
            {
                return Err(ManifestError::ServiceRoute);
            }
        }
    }
    if let Some(oauth) = &account.oauth {
        for endpoint in oauth.endpoints() {
            let (endpoint_origin, endpoint_path) =
                https_url(endpoint, false).ok_or(ManifestError::Account)?;
            // A service may read paths without case or a final `/`: the
            // check is wider than the broker's matcher.
            if rules.iter().any(|rule| {
                origin(rule) == endpoint_origin
                    && paths_may_overlap(&loose_path(&path(rule)), &loose_path(endpoint_path))
            }) {
                return Err(ManifestError::AccountEndpoint);
            }
        }
    }
    for (index, first) in rules.iter().enumerate() {
        for second in &rules[index + 1..] {
            if account_of(first) != account_of(second)
                && origin(first) == origin(second)
                && first["method"] == second["method"]
                && paths_may_overlap(&path(first), &path(second))
            {
                return Err(ManifestError::AccountOverlap);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlap_follows_the_segment_matcher() {
        for (a, b) in [
            ("/v1/{id}", "/v1/me"),
            ("/v1/{a}", "/v1/{b}"),
            ("/v1/me", "/v1/me"),
            ("/{a}/x", "/y/{b}"),
            ("/v1/{a}/", "/v1/me/"),
        ] {
            assert!(paths_may_overlap(a, b), "{a} {b}");
            assert!(paths_may_overlap(b, a), "{b} {a}");
        }
        for (a, b) in [
            ("/v1/me", "/v1/me/"),
            ("/v1/", "/v1/{x}"),
            ("/v1/a", "/v1/b"),
            ("/v1/{x}", "/v1/{x}/y"),
            ("/v1", "/v1/{x}"),
        ] {
            assert!(!paths_may_overlap(a, b), "{a} {b}");
            assert!(!paths_may_overlap(b, a), "{b} {a}");
        }
    }

    #[test]
    fn urls_are_static_https_pages() {
        let accepted = [
            ("https://steamcommunity.com/dev/apikey", true),
            ("https://example.com/", true),
            ("https://example.com/settings/", true),
            ("https://example.com/settings?tab=tokens&x=%2F", true),
            ("https://id.twitch.tv/oauth2/token", false),
        ];
        for (url, query) in accepted {
            assert!(https_url(url, query).is_some(), "{url}");
        }
        let refused = [
            ("http://example.com/x", true),
            ("https://example.com", true),
            ("https://example.com/x#f", true),
            ("https://user@example.com/x", true),
            ("https://127.0.0.1/x", true),
            ("https://example.com:443/x", true),
            ("https://Example.com/x", true),
            ("https://example.com/x?", true),
            ("https://example.com/x?a=b c", true),
            ("https://example.com/x?a=%zz", true),
            ("https://example.com/x?{key}", true),
            ("https://example.com//x", true),
            ("https://example.com/../x", true),
            ("https://example.com/x?a=b", false),
        ];
        for (url, query) in refused {
            assert!(https_url(url, query).is_none(), "{url}");
        }
        let long = format!("https://example.com/{}", "a".repeat(493));
        assert_eq!(long.len(), 513);
        assert!(https_url(&long, true).is_none());
    }

    #[test]
    fn carrier_headers_exclude_the_brokers_own() {
        for name in [
            "X-WebAPI-Key",
            "Authorization",
            "Client-Id",
            "x-api-key",
            "Api_Key",
        ] {
            assert!(carrier_header(name), "{name}");
        }
        for name in [
            "Cookie",
            "cookie",
            "HOST",
            "Content-Length",
            "content-type",
            "Accept",
            "Accept-Language",
            "If-None-Match",
            "User-Agent",
            "Proxy-Authorization",
            "Sec-Fetch-Mode",
            "X-FORWARDED-FOR",
            "Forwarded",
            "X Key",
            "X:Key",
            "",
            "é",
        ] {
            assert!(!carrier_header(name), "{name}");
        }
        assert!(!carrier_header(&"x".repeat(65)));
    }
}
