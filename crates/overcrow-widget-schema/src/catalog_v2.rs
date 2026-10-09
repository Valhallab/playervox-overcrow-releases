//! Signed widget catalog v2: every widget of the creator portal, beside the
//! frozen catalog v1, which keeps listing the PlayerVox widgets for the
//! applications already released.
//!
//! The envelope has the v1 shape with `formatVersion` 2 and its own
//! domain-separation string, so no v1 or seed signature verifies as v2 and
//! no v2 envelope opens as v1. The payload holds four tables: `categories`
//! (the list widgets refer to), `publishers`, `widgets` (the listing of each
//! ID, editable without a new version) and `targets` (one package version
//! each, with its release notes).
//!
//! Forward compatibility: an unknown object key of the payload is ignored,
//! an unknown value of a known key is refused, and an entry whose `requires`
//! names a feature this reader does not support is skipped rather than
//! refusing the catalog. The envelope and the manifest stay strict.

mod listing;

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Map, Value};

use crate::catalog::{
    self, BUILT_IN_TAG, CatalogError, Origin, PackageRef, TAGS, Target, TargetStatus,
    decode_canonical, decode_sha256, valid_key_id,
};
use crate::identifiers::{PLAYERVOX_HANDLE, handle_syntax, id_owner, validate_domain};
use crate::json::{has_exact_fields, parse_strict};
use crate::limits::{
    MAX_CATALOG_CATEGORIES, MAX_CATALOG_LIFETIME_DAYS, MAX_CATALOG_PUBLISHERS,
    MAX_CATALOG_URL_BYTES, MAX_CATALOG_V2_BYTES, MAX_CATALOG_V2_PAYLOAD_BYTES,
    MAX_CATALOG_V2_TARGETS, MAX_CATALOG_V2_WIDGETS, MAX_CATEGORY_ID_BYTES,
    MAX_CATEGORY_LABEL_CHARS, MAX_FEATURE_NAME_BYTES, MAX_GAME_NAME_CHARS, MAX_GAME_SLUG_BYTES,
    MAX_HANDLE_BYTES, MAX_KEY_ID_BYTES, MAX_LISTING_DESCRIPTION_CHARS, MAX_LISTING_GAMES,
    MAX_PACKAGE_BYTES, MAX_PREVIEW_BYTES, MAX_PUBLISHER_DOMAINS, MAX_PUBLISHER_NAME_CHARS,
    MAX_RELEASE_NOTES_CHARS, MAX_REQUIRED_FEATURES, MAX_SPDX_LICENSE_BYTES,
    MAX_SUPPORT_EMAIL_BYTES,
};
use crate::manifest::{ManifestError, is_reserved_id, valid_widget_id, validate_manifest_value};
use crate::model::{Field, ValueType};
use crate::package::hex;

pub use listing::{
    INVISIBLE_CHARACTERS, PROPRIETARY_LICENSE, display_text, email, link, spdx_license,
};

/// Signed prefix of the catalog v2. It differs from the v1 catalog and seed
/// domains, so a signature never verifies across them.
pub const CATALOG_V2_DOMAIN: &[u8] = b"OverCrow widget catalog v2\0";

pub const FORMAT_VERSION: i64 = 2;

/// The catalog v2 lives beside v1; the applications that read v2 read only
/// v2.
pub const PRODUCTION_BASE_URL: &str = "https://overcrow.playervox.com/marketplace/widgets/v2/";
/// Local marketplace of a development host; production hosts refuse it.
pub const DEVELOPMENT_BASE_URL: &str = "http://127.0.0.1:8787/marketplace/widgets/v2/";
pub const CATALOG_FILE: &str = "catalog.json";

/// The category every catalog lists: widgets of a removed category move
/// there.
pub const CATEGORY_OTHER: &str = "other";

/// The categories PlayerVox starts with: `(id, English label, French
/// label)`. Readers take the list from each catalog, never from here.
pub const INITIAL_CATEGORIES: &[(&str, &str, &str)] = &[
    ("game-tools", "Game tools", "Outils de jeu"),
    ("performance", "Performance", "Performance"),
    ("communication", "Communication", "Communication"),
    ("productivity", "Productivity", "Productivité"),
    ("media", "Media", "Médias"),
    ("streaming", "Streaming", "Streaming"),
    (CATEGORY_OTHER, "Other", "Autre"),
];

/// Feature names of `requires` this reader supports. Catalog v2 defines
/// none: any `requires` makes a v2 reader skip the entry.
pub const SUPPORTED_FEATURES: &[&str] = &[];

pub const ENVELOPE_FIELDS: &[Field] = &[
    Field::required(
        "formatVersion",
        ValueType::Integer { min: 2, max: 2 },
        "Envelope format.",
    ),
    Field::required(
        "keyId",
        ValueType::Text(&MAX_KEY_ID_BYTES),
        "Signing key ID, the family of the catalog v1: production IDs are `overcrow-widgets-YYYY-NN`.",
    ),
    Field::required(
        "payload",
        ValueType::Record("Base64url"),
        "Canonical unpadded Base64url of the payload bytes, at most `MAX_CATALOG_V2_PAYLOAD_BYTES` decoded.",
    ),
    Field::required(
        "signature",
        ValueType::Record("Base64url"),
        "Canonical unpadded Base64url of the 64-byte Ed25519 signature of the domain string followed by the payload bytes.",
    ),
];

pub const CATALOG_FIELDS: &[Field] = &[
    Field::required(
        "formatVersion",
        ValueType::Integer { min: 2, max: 2 },
        "Catalog format.",
    ),
    Field::required(
        "sequence",
        ValueType::Integer {
            min: 1,
            max: (1 << 53) - 1,
        },
        "Anti-rollback sequence of the catalog v2, started at 1 and independent of the v1 sequence.",
    ),
    Field::required(
        "generatedAt",
        ValueType::Record("UTC timestamp"),
        "`YYYY-MM-DDTHH:MM:SSZ`.",
    ),
    Field::required(
        "expiresAt",
        ValueType::Record("UTC timestamp"),
        "After `generatedAt`, at most `MAX_CATALOG_LIFETIME_DAYS` later in production.",
    ),
    Field::required(
        "categories",
        ValueType::ListOf("Category", &MAX_CATALOG_CATEGORIES),
        "Categories in display order, unique by ID, `other` included.",
    ),
    Field::required(
        "publishers",
        ValueType::ListOf("Publisher", &MAX_CATALOG_PUBLISHERS),
        "Publishers of the listed widgets, unique by handle.",
    ),
    Field::required(
        "widgets",
        ValueType::ListOf("Widget", &MAX_CATALOG_V2_WIDGETS),
        "One entry per listed widget ID.",
    ),
    Field::required(
        "targets",
        ValueType::ListOf("TargetV2", &MAX_CATALOG_V2_TARGETS),
        "Listed package versions, unique by ID and version.",
    ),
];

pub const CATEGORY_FIELDS: &[Field] = &[
    Field::required(
        "id",
        ValueType::Identifier(&MAX_CATEGORY_ID_BYTES),
        "`[a-z][a-z0-9-]*` without a final hyphen.",
    ),
    Field::required(
        "labels",
        ValueType::Record("LocalizedText"),
        "Label per locale, `en` required, each at most `MAX_CATEGORY_LABEL_CHARS` characters on one line.",
    ),
];

pub const PUBLISHER_FIELDS: &[Field] = &[
    Field::required(
        "handle",
        ValueType::Text(&MAX_HANDLE_BYTES),
        "Handle grammar (see Publisher handles and widget ID ownership); readers do not check the registration policy.",
    ),
    Field::required(
        "name",
        ValueType::Chars(&MAX_PUBLISHER_NAME_CHARS),
        "Displayed name, display text on one line.",
    ),
    Field::optional(
        "domains",
        ValueType::ListOf("domain", &MAX_PUBLISHER_DOMAINS),
        "Distinct domains under which the publisher owns widget IDs, each verified at least once. No two publishers list equal or nested domains; `playervox.com` and its subdomains belong to `playervox` only.",
    ),
    Field::optional(
        "verifiedDomain",
        ValueType::Record("domain"),
        "The domain verified now, one of `domains`, shown with the verified-domain badge.",
    ),
];

pub const WIDGET_FIELDS: &[Field] = &[
    Field::required(
        "id",
        ValueType::Record("widget ID"),
        "Widget ID of the manifest grammar, owned by the publisher (see Publisher handles and widget ID ownership); unique.",
    ),
    Field::required(
        "publisher",
        ValueType::Text(&MAX_HANDLE_BYTES),
        "Handle of an entry of `publishers`.",
    ),
    Field::optional(
        "tags",
        ValueType::Record("list of tags"),
        "Distinct tags of the catalog v1 set; `built-in` only for the publisher `playervox` on a `com.playervox.*` ID. They apply to every version.",
    ),
    Field::required(
        "listing",
        ValueType::Record("ListingV2"),
        "Store text and links.",
    ),
    Field::optional(
        "preview",
        ValueType::Record("PreviewV2"),
        "One PNG preview for every version.",
    ),
    Field::optional(
        "requires",
        ValueType::ListOf("feature name", &MAX_REQUIRED_FEATURES),
        "Features a reader must support to use the entry; otherwise it skips the widget and its targets.",
    ),
];

pub const LISTING_FIELDS: &[Field] = &[
    Field::required(
        "defaultLocale",
        ValueType::Keyword(&["en"]),
        "Always `en`: the text shown when the player's locale has none.",
    ),
    Field::required(
        "description",
        ValueType::Record("LocalizedText"),
        "Description per locale, `en` required, at most `MAX_LISTING_LOCALIZATIONS` locales, each at most `MAX_LISTING_DESCRIPTION_CHARS` characters; line feeds allowed.",
    ),
    Field::required(
        "category",
        ValueType::Identifier(&MAX_CATEGORY_ID_BYTES),
        "ID of an entry of `categories`.",
    ),
    Field::optional(
        "games",
        ValueType::ListOf("Game", &MAX_LISTING_GAMES),
        "PlayerVox games the widget is made for, distinct by ID.",
    ),
    Field::required(
        "spdxLicense",
        ValueType::Text(&MAX_SPDX_LICENSE_BYTES),
        "A simple SPDX license expression, by grammar only, or exactly `LicenseRef-Proprietary`.",
    ),
    Field::required(
        "support",
        ValueType::Record("Support"),
        "How players reach the publisher.",
    ),
    Field::optional(
        "privacyPolicyUrl",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Link; required when a listed, not skipped version declares `permissions.network`.",
    ),
    Field::optional(
        "sourceUrl",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Link to a public source repository; shown as a public-source badge.",
    ),
];

pub const GAME_FIELDS: &[Field] = &[
    Field::required(
        "id",
        ValueType::Id,
        "ID of the game in the PlayerVox games database; the key of the game filter.",
    ),
    Field::required(
        "slug",
        ValueType::Text(&MAX_GAME_SLUG_BYTES),
        "`[a-z0-9-]` starting and ending with a letter or digit: the page `https://playervox.com/games/<slug>`.",
    ),
    Field::required(
        "name",
        ValueType::Chars(&MAX_GAME_NAME_CHARS),
        "Game name, display text on one line.",
    ),
];

pub const SUPPORT_FIELDS: &[Field] = &[
    Field::optional(
        "url",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Support page, a link.",
    ),
    Field::optional(
        "email",
        ValueType::Text(&MAX_SUPPORT_EMAIL_BYTES),
        "Public support address. Exactly one of `url` and `email` is present.",
    ),
];

pub const PREVIEW_FIELDS: &[Field] = &[
    Field::required(
        "url",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Exactly `<base>previews/<id>/<sha256>.png`.",
    ),
    Field::required(
        "mediaType",
        ValueType::Keyword(&["image/png"]),
        "Media type.",
    ),
    Field::required(
        "size",
        ValueType::Integer {
            min: 1,
            max: MAX_PREVIEW_BYTES.value as i64,
        },
        "Image bytes.",
    ),
    Field::required(
        "sha256",
        ValueType::Record("lowercase hex SHA-256"),
        "Image digest.",
    ),
];

pub const TARGET_FIELDS: &[Field] = &[
    Field::required(
        "manifest",
        ValueType::Record("manifest"),
        "The package's manifest object, validated strictly as v1; its ID names an entry of `widgets`.",
    ),
    Field::required(
        "status",
        ValueType::Keyword(crate::catalog::STATUSES),
        "As in the catalog v1.",
    ),
    Field::required(
        "package",
        ValueType::Record("PackageRef"),
        "As in the catalog v1, with `url` exactly `<base>packages/<id>/<version>/<sha256>.ocpkg` under the v2 base.",
    ),
    Field::optional(
        "releaseNotes",
        ValueType::Record("LocalizedText"),
        "Release notes of this version per locale, `en` required, at most `MAX_LISTING_LOCALIZATIONS` locales, each at most `MAX_RELEASE_NOTES_CHARS` characters; line feeds allowed.",
    ),
    Field::optional(
        "requires",
        ValueType::ListOf("feature name", &MAX_REQUIRED_FEATURES),
        "Features a reader must support to use the entry; otherwise it skips the target.",
    ),
];

/// Package references keep the v1 fields; listed here for the reference.
pub const PACKAGE_REF_FIELDS: &[Field] = &[
    Field::required(
        "url",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Exactly `<base>packages/<id>/<version>/<sha256>.ocpkg`.",
    ),
    Field::required(
        "size",
        ValueType::Integer {
            min: 1,
            max: MAX_PACKAGE_BYTES.value as i64,
        },
        "Archive bytes.",
    ),
    Field::required(
        "sha256",
        ValueType::Record("lowercase hex SHA-256"),
        "Archive digest.",
    ),
];

/// Fixed reasons a catalog v2 is refused. [`CatalogV2Error::as_str`] is the
/// prefix of the shared invalid vectors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogV2Error {
    EnvelopeSize,
    Envelope,
    FormatVersion,
    KeyId,
    PayloadSize,
    Payload,
    Signature,
    Sequence,
    Time,
    NotYetValid,
    Expired,
    /// More categories, publishers, widgets or targets than allowed.
    Limit,
    Category,
    Publisher,
    /// A publisher domain: grammar, overlap with another publisher, or
    /// `playervox.com` for another publisher.
    Domain,
    PublisherRef,
    Widget,
    DuplicateWidget,
    Ownership,
    Tag,
    BuiltInId,
    Listing,
    DefaultLocale,
    Description,
    CategoryRef,
    Games,
    License,
    Support,
    PrivacyPolicy,
    SourceUrl,
    Preview,
    Requires,
    Manifest(ManifestError),
    Status,
    PackageRef,
    Url,
    ReleaseNotes,
    DuplicateTarget,
    UnknownWidget,
}

impl CatalogV2Error {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EnvelopeSize => "envelope_size",
            Self::Envelope => "envelope",
            Self::FormatVersion => "format_version",
            Self::KeyId => "key_id",
            Self::PayloadSize => "payload_size",
            Self::Payload => "payload",
            Self::Signature => "signature",
            Self::Sequence => "sequence",
            Self::Time => "time",
            Self::NotYetValid => "not_yet_valid",
            Self::Expired => "expired",
            Self::Limit => "limit",
            Self::Category => "category",
            Self::Publisher => "publisher",
            Self::Domain => "domain",
            Self::PublisherRef => "publisher_ref",
            Self::Widget => "widget",
            Self::DuplicateWidget => "duplicate_widget",
            Self::Ownership => "ownership",
            Self::Tag => "tag",
            Self::BuiltInId => "built_in_id",
            Self::Listing => "listing",
            Self::DefaultLocale => "default_locale",
            Self::Description => "description",
            Self::CategoryRef => "category_ref",
            Self::Games => "games",
            Self::License => "license",
            Self::Support => "support",
            Self::PrivacyPolicy => "privacy_policy",
            Self::SourceUrl => "source_url",
            Self::Preview => "preview",
            Self::Requires => "requires",
            Self::Manifest(_) => "manifest",
            Self::Status => "status",
            Self::PackageRef => "package_ref",
            Self::Url => "url",
            Self::ReleaseNotes => "release_notes",
            Self::DuplicateTarget => "duplicate_target",
            Self::UnknownWidget => "unknown_widget",
        }
    }
}

/// Text per locale (`xx` or `xx-YY`), `en` always present.
pub type LocalizedText = BTreeMap<String, String>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Category {
    pub id: String,
    pub labels: LocalizedText,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Publisher {
    pub handle: String,
    pub name: String,
    pub domains: Vec<String>,
    pub verified_domain: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub id: u64,
    pub slug: String,
    pub name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Support {
    Url(String),
    Email(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub description: LocalizedText,
    pub category: String,
    pub games: Vec<Game>,
    pub spdx_license: String,
    pub support: Support,
    pub privacy_policy_url: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Widget {
    pub id: String,
    pub publisher: String,
    pub built_in: bool,
    pub listing: Listing,
    /// One PNG preview for every version (`image/png`).
    pub preview: Option<PackageRef>,
}

/// A listed version: the v1 target (its `built_in` and `preview` copied from
/// its widget entry) and its release notes, empty when absent.
#[derive(Clone, Debug, PartialEq)]
pub struct TargetV2 {
    pub target: Target,
    pub release_notes: LocalizedText,
}

/// A verified catalog v2, without its skipped entries.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogV2 {
    pub sequence: u64,
    pub generated_at: i64,
    pub expires_at: i64,
    pub categories: Vec<Category>,
    pub publishers: Vec<Publisher>,
    pub widgets: Vec<Widget>,
    pub targets: Vec<TargetV2>,
}

/// A parsed envelope whose signature is not verified yet.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Envelope {
    pub key_id: String,
    pub payload: Vec<u8>,
    pub signature: [u8; 64],
}

impl Envelope {
    /// The exact bytes the Ed25519 signature covers.
    pub fn signed_message(&self) -> Vec<u8> {
        [CATALOG_V2_DOMAIN, &self.payload].concat()
    }
}

/// Parses a catalog v2 envelope. It does not verify the signature.
pub fn open_envelope(bytes: &[u8]) -> Result<Envelope, CatalogV2Error> {
    use CatalogV2Error as E;
    if bytes.len() as u64 > MAX_CATALOG_V2_BYTES.value {
        return Err(E::EnvelopeSize);
    }
    let value = parse_strict(bytes, MAX_CATALOG_V2_BYTES.value).ok_or(E::Envelope)?;
    let object = value.as_object().ok_or(E::Envelope)?;
    if object.get("formatVersion").and_then(Value::as_i64) != Some(FORMAT_VERSION) {
        return Err(E::FormatVersion);
    }
    if !has_exact_fields(object, &[ENVELOPE_FIELDS]) {
        return Err(E::Envelope);
    }
    let key_id = object["keyId"].as_str().ok_or(E::Envelope)?;
    if !valid_key_id(key_id) {
        return Err(E::KeyId);
    }
    let payload = object["payload"].as_str().ok_or(E::Envelope)?;
    if payload.len() > (MAX_CATALOG_V2_PAYLOAD_BYTES.value as usize).div_ceil(3) * 4 {
        return Err(E::PayloadSize);
    }
    let payload = decode_canonical(payload).ok_or(E::Envelope)?;
    if payload.len() as u64 > MAX_CATALOG_V2_PAYLOAD_BYTES.value {
        return Err(E::PayloadSize);
    }
    let signature = object["signature"]
        .as_str()
        .filter(|text| text.len() <= 88)
        .and_then(decode_canonical)
        .and_then(|bytes| <[u8; 64]>::try_from(bytes).ok())
        .ok_or(E::Signature)?;
    Ok(Envelope {
        key_id: key_id.to_owned(),
        payload,
        signature,
    })
}

/// Encodes an envelope; used by the signing pipeline and the vectors.
pub fn encode_envelope(key_id: &str, payload: &[u8], signature: &[u8; 64]) -> Vec<u8> {
    format!(
        "{{\"formatVersion\":{FORMAT_VERSION},\"keyId\":\"{key_id}\",\"payload\":\"{}\",\"signature\":\"{}\"}}",
        URL_SAFE_NO_PAD.encode(payload),
        URL_SAFE_NO_PAD.encode(signature)
    )
    .into_bytes()
}

/// The base URL of the catalog v2 of `origin`.
pub const fn base_url(origin: Origin) -> &'static str {
    match origin {
        Origin::Production => PRODUCTION_BASE_URL,
        Origin::Development => DEVELOPMENT_BASE_URL,
    }
}

/// Validates a verified catalog v2 payload at `now` (Unix seconds). Skipped
/// entries and widgets left without a target are not returned.
pub fn validate_catalog(
    payload: &[u8],
    now: i64,
    origin: Origin,
) -> Result<CatalogV2, CatalogV2Error> {
    use CatalogV2Error as E;
    if payload.len() as u64 > MAX_CATALOG_V2_PAYLOAD_BYTES.value {
        return Err(E::PayloadSize);
    }
    let value = parse_strict(payload, MAX_CATALOG_V2_PAYLOAD_BYTES.value).ok_or(E::Payload)?;
    let Value::Object(object) = value else {
        return Err(E::Payload);
    };
    if object.get("formatVersion").and_then(Value::as_i64) != Some(FORMAT_VERSION) {
        return Err(E::FormatVersion);
    }
    if !has_required(&object, CATALOG_FIELDS) {
        return Err(E::Payload);
    }
    let sequence = catalog::sequence(&object["sequence"]).map_err(|_| E::Sequence)?;
    let lifetime = (origin == Origin::Production).then_some(MAX_CATALOG_LIFETIME_DAYS.value);
    let (generated_at, expires_at) =
        catalog::validity(&object, now, lifetime).map_err(|error| match error {
            CatalogError::NotYetValid => E::NotYetValid,
            CatalogError::Expired => E::Expired,
            _ => E::Time,
        })?;
    let categories = categories(&object["categories"])?;
    let publishers = publishers(&object["publishers"])?;
    let (mut widgets, skipped) = widgets(&object["widgets"], &categories, &publishers, origin)?;
    let targets = targets(&object["targets"], &widgets, &skipped, origin)?;

    // A widget without a retained version (all skipped, or none listed) is
    // not shown.
    let mut kept = Vec::with_capacity(widgets.len());
    for widget in widgets.drain(..) {
        let versions: Vec<&TargetV2> = targets
            .iter()
            .filter(|target| target.target.manifest.id == widget.id)
            .collect();
        if versions.is_empty() {
            continue;
        }
        let network = versions
            .iter()
            .any(|target| !target.target.manifest.permissions.network.is_empty());
        if network && widget.listing.privacy_policy_url.is_none() {
            return Err(E::PrivacyPolicy);
        }
        kept.push(widget);
    }
    Ok(CatalogV2 {
        sequence,
        generated_at,
        expires_at,
        categories,
        publishers,
        widgets: kept,
        targets,
    })
}

/// Every required field is present; other keys are ignored (forward
/// compatibility). Known fields are validated by the caller.
fn has_required(object: &Map<String, Value>, fields: &[Field]) -> bool {
    fields
        .iter()
        .all(|field| !field.required || object.contains_key(field.name))
}

/// `[a-z][a-z0-9-]*` without a final hyphen, at most `maximum` bytes: a
/// category ID or a feature name.
fn identifier(text: &str, maximum: u64) -> bool {
    text.len() as u64 <= maximum
        && text.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && !text.ends_with('-')
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn list(value: &Value, maximum: u64, invalid: CatalogV2Error) -> Result<&[Value], CatalogV2Error> {
    let list = value.as_array().ok_or(invalid)?;
    if list.len() as u64 > maximum {
        return Err(CatalogV2Error::Limit);
    }
    Ok(list)
}

fn categories(value: &Value) -> Result<Vec<Category>, CatalogV2Error> {
    let invalid = CatalogV2Error::Category;
    let mut categories: Vec<Category> = Vec::new();
    for entry in list(value, MAX_CATALOG_CATEGORIES.value, invalid)? {
        let entry = entry.as_object().ok_or(invalid)?;
        if !has_required(entry, CATEGORY_FIELDS) {
            return Err(invalid);
        }
        let id = entry["id"]
            .as_str()
            .filter(|id| identifier(id, MAX_CATEGORY_ID_BYTES.value))
            .ok_or(invalid)?;
        let labels = listing::localized(&entry["labels"], MAX_CATEGORY_LABEL_CHARS.value, false)
            .ok_or(invalid)?;
        if categories.iter().any(|category| category.id == id) {
            return Err(invalid);
        }
        categories.push(Category {
            id: id.to_owned(),
            labels,
        });
    }
    if !categories
        .iter()
        .any(|category| category.id == CATEGORY_OTHER)
    {
        return Err(invalid);
    }
    Ok(categories)
}

fn publishers(value: &Value) -> Result<Vec<Publisher>, CatalogV2Error> {
    use CatalogV2Error as E;
    let mut publishers: Vec<Publisher> = Vec::new();
    // Every domain of the catalog and the index of its publisher.
    let mut owners: BTreeMap<String, usize> = BTreeMap::new();
    for entry in list(value, MAX_CATALOG_PUBLISHERS.value, E::Publisher)? {
        let entry = entry.as_object().ok_or(E::Publisher)?;
        if !has_required(entry, PUBLISHER_FIELDS) {
            return Err(E::Publisher);
        }
        let handle = entry["handle"]
            .as_str()
            .filter(|handle| handle_syntax(handle).is_ok())
            .ok_or(E::Publisher)?;
        let name = entry["name"]
            .as_str()
            .filter(|name| display_text(name, MAX_PUBLISHER_NAME_CHARS.value, false))
            .ok_or(E::Publisher)?;
        if publishers
            .iter()
            .any(|publisher| publisher.handle == handle)
        {
            return Err(E::Publisher);
        }
        let mut domains: Vec<String> = Vec::new();
        if let Some(list_value) = entry.get("domains") {
            for domain in
                list(list_value, MAX_PUBLISHER_DOMAINS.value, E::Domain).map_err(|_| E::Domain)?
            {
                let domain = domain
                    .as_str()
                    .filter(|domain| validate_domain(domain, handle).is_ok())
                    .ok_or(E::Domain)?;
                if owners.insert(domain.to_owned(), publishers.len()).is_some() {
                    return Err(E::Domain);
                }
                domains.push(domain.to_owned());
            }
        }
        let verified_domain = match entry.get("verifiedDomain") {
            None => None,
            Some(domain) => Some(
                domain
                    .as_str()
                    .filter(|domain| domains.iter().any(|owned| owned == domain))
                    .ok_or(E::Publisher)?
                    .to_owned(),
            ),
        };
        publishers.push(Publisher {
            handle: handle.to_owned(),
            name: name.to_owned(),
            domains,
            verified_domain,
        });
    }
    // No domain of a publisher is equal to or nested in another publisher's.
    for (domain, owner) in &owners {
        let mut rest = domain.as_str();
        while let Some((_, parent)) = rest.split_once('.') {
            if parent.contains('.') && owners.get(parent).is_some_and(|other| other != owner) {
                return Err(E::Domain);
            }
            rest = parent;
        }
    }
    Ok(publishers)
}

/// The `requires` list of an entry: `Ok(true)` when this reader supports
/// every feature it names (or there is none).
fn supported(entry: &Map<String, Value>) -> Result<bool, CatalogV2Error> {
    let invalid = CatalogV2Error::Requires;
    let Some(value) = entry.get("requires") else {
        return Ok(true);
    };
    let names = value.as_array().ok_or(invalid)?;
    if names.len() as u64 > MAX_REQUIRED_FEATURES.value {
        return Err(invalid);
    }
    let mut unique = BTreeSet::new();
    for name in names {
        let name = name
            .as_str()
            .filter(|name| identifier(name, MAX_FEATURE_NAME_BYTES.value))
            .ok_or(invalid)?;
        if !unique.insert(name) {
            return Err(invalid);
        }
    }
    Ok(unique.iter().all(|name| SUPPORTED_FEATURES.contains(name)))
}

fn widgets(
    value: &Value,
    categories: &[Category],
    publishers: &[Publisher],
    origin: Origin,
) -> Result<(Vec<Widget>, BTreeSet<String>), CatalogV2Error> {
    use CatalogV2Error as E;
    let mut widgets: Vec<Widget> = Vec::new();
    let mut skipped = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for entry in list(value, MAX_CATALOG_V2_WIDGETS.value, E::Widget)? {
        let entry = entry.as_object().ok_or(E::Widget)?;
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_widget_id(id))
            .ok_or(E::Widget)?;
        if !ids.insert(id.to_owned()) {
            return Err(E::DuplicateWidget);
        }
        if !supported(entry)? {
            // Only the ID and `requires` of a skipped entry are read.
            skipped.insert(id.to_owned());
            continue;
        }
        if !has_required(entry, WIDGET_FIELDS) {
            return Err(E::Widget);
        }
        let publisher = entry["publisher"]
            .as_str()
            .and_then(|handle| {
                publishers
                    .iter()
                    .find(|publisher| publisher.handle == handle)
            })
            .ok_or(E::PublisherRef)?;
        id_owner(id, &publisher.handle, &publisher.domains).map_err(|_| E::Ownership)?;
        let built_in = match entry.get("tags") {
            None => false,
            Some(tags) => {
                let tags = tags.as_array().ok_or(E::Tag)?;
                let mut unique = BTreeSet::new();
                for tag in tags {
                    let tag = tag.as_str().ok_or(E::Tag)?;
                    if !TAGS.iter().any(|known| known.name == tag) || !unique.insert(tag) {
                        return Err(E::Tag);
                    }
                }
                unique.contains(BUILT_IN_TAG)
            }
        };
        if built_in && (publisher.handle != PLAYERVOX_HANDLE || !is_reserved_id(id)) {
            return Err(E::BuiltInId);
        }
        let listing = validate_listing(&entry["listing"], categories)?;
        let preview = entry
            .get("preview")
            .map(|preview| validate_preview(preview, origin, id))
            .transpose()?;
        widgets.push(Widget {
            id: id.to_owned(),
            publisher: publisher.handle.clone(),
            built_in,
            listing,
            preview,
        });
    }
    Ok((widgets, skipped))
}

/// Validates a widget entry's `listing` against the catalog's categories.
/// The creator portal checks a submitted listing with it.
pub fn validate_listing(value: &Value, categories: &[Category]) -> Result<Listing, CatalogV2Error> {
    use CatalogV2Error as E;
    let object = value.as_object().ok_or(E::Listing)?;
    if !has_required(object, LISTING_FIELDS) {
        return Err(match () {
            () if !object.contains_key("support") => E::Support,
            () => E::Listing,
        });
    }
    if object["defaultLocale"] != "en" {
        return Err(E::DefaultLocale);
    }
    let description = listing::localized(
        &object["description"],
        MAX_LISTING_DESCRIPTION_CHARS.value,
        true,
    )
    .ok_or(E::Description)?;
    let category = object["category"]
        .as_str()
        .filter(|id| categories.iter().any(|category| category.id == *id))
        .ok_or(E::CategoryRef)?;
    let games = match object.get("games") {
        None => Vec::new(),
        Some(games) => listing::games(games).ok_or(E::Games)?,
    };
    let spdx_license = object["spdxLicense"]
        .as_str()
        .filter(|license| spdx_license(license))
        .ok_or(E::License)?;
    let support = object["support"].as_object().ok_or(E::Support)?;
    let support = match (support.get("url"), support.get("email")) {
        (Some(url), None) => Support::Url(
            url.as_str()
                .filter(|url| link(url))
                .ok_or(E::Support)?
                .to_owned(),
        ),
        (None, Some(address)) => Support::Email(
            address
                .as_str()
                .filter(|address| email(address))
                .ok_or(E::Support)?
                .to_owned(),
        ),
        _ => return Err(E::Support),
    };
    let optional_link = |name: &str, invalid: CatalogV2Error| match object.get(name) {
        None => Ok(None),
        Some(url) => url
            .as_str()
            .filter(|url| link(url))
            .map(|url| Some(url.to_owned()))
            .ok_or(invalid),
    };
    Ok(Listing {
        description,
        category: category.to_owned(),
        games,
        spdx_license: spdx_license.to_owned(),
        support,
        privacy_policy_url: optional_link("privacyPolicyUrl", E::PrivacyPolicy)?,
        source_url: optional_link("sourceUrl", E::SourceUrl)?,
    })
}

fn validate_preview(value: &Value, origin: Origin, id: &str) -> Result<PackageRef, CatalogV2Error> {
    let invalid = CatalogV2Error::Preview;
    let object = value.as_object().ok_or(invalid)?;
    if !has_required(object, PREVIEW_FIELDS) || object["mediaType"] != "image/png" {
        return Err(invalid);
    }
    let size = object["size"]
        .as_u64()
        .filter(|size| (1..=MAX_PREVIEW_BYTES.value).contains(size))
        .ok_or(invalid)?;
    let sha256 = object["sha256"]
        .as_str()
        .and_then(decode_sha256)
        .ok_or(invalid)?;
    let url = format!("{}previews/{id}/{}.png", base_url(origin), hex(&sha256));
    if object["url"].as_str() != Some(url.as_str()) {
        return Err(invalid);
    }
    Ok(PackageRef { url, size, sha256 })
}

fn targets(
    value: &Value,
    widgets: &[Widget],
    skipped_widgets: &BTreeSet<String>,
    origin: Origin,
) -> Result<Vec<TargetV2>, CatalogV2Error> {
    use CatalogV2Error as E;
    let mut kept = Vec::new();
    let mut identities = BTreeSet::new();
    for entry in list(value, MAX_CATALOG_V2_TARGETS.value, E::Payload)? {
        let entry = entry.as_object().ok_or(E::Payload)?;
        if !supported(entry)? {
            continue;
        }
        // The versions of a skipped widget are skipped unread: they may use
        // what this reader does not know, a newer manifest included.
        let widget_id = entry
            .get("manifest")
            .and_then(|manifest| manifest.get("id"))
            .and_then(Value::as_str);
        if widget_id.is_some_and(|id| skipped_widgets.contains(id)) {
            continue;
        }
        if !has_required(entry, TARGET_FIELDS) {
            return Err(E::Payload);
        }
        let manifest = validate_manifest_value(entry["manifest"].clone()).map_err(E::Manifest)?;
        let widget = widgets
            .iter()
            .find(|widget| widget.id == manifest.id)
            .ok_or(E::UnknownWidget)?;
        let status = match entry["status"].as_str() {
            Some("verified") => TargetStatus::Verified,
            Some("security-suspended") => TargetStatus::SecuritySuspended,
            Some("revoked") => TargetStatus::Revoked,
            _ => return Err(E::Status),
        };
        let package = entry["package"].as_object().ok_or(E::PackageRef)?;
        if !has_required(package, PACKAGE_REF_FIELDS) {
            return Err(E::PackageRef);
        }
        let size = package["size"]
            .as_u64()
            .filter(|size| (1..=MAX_PACKAGE_BYTES.value).contains(size))
            .ok_or(E::PackageRef)?;
        let sha256 = package["sha256"]
            .as_str()
            .and_then(decode_sha256)
            .ok_or(E::PackageRef)?;
        let version = manifest.version.to_string();
        let url = format!(
            "{}packages/{}/{version}/{}.ocpkg",
            base_url(origin),
            manifest.id,
            hex(&sha256)
        );
        if package["url"].as_str() != Some(url.as_str()) {
            return Err(E::Url);
        }
        let release_notes = match entry.get("releaseNotes") {
            None => LocalizedText::new(),
            Some(notes) => listing::localized(notes, MAX_RELEASE_NOTES_CHARS.value, true)
                .ok_or(E::ReleaseNotes)?,
        };
        if !identities.insert((manifest.id.clone(), version)) {
            return Err(E::DuplicateTarget);
        }
        kept.push(TargetV2 {
            target: Target {
                built_in: widget.built_in,
                status,
                package: PackageRef { url, size, sha256 },
                preview: widget.preview.clone(),
                manifest,
            },
            release_notes,
        });
    }
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::catalog::{TargetStatus, parse_timestamp};

    const BASE: &str = PRODUCTION_BASE_URL;

    fn now() -> i64 {
        parse_timestamp("2026-11-10T00:00:00Z").expect("timestamp")
    }

    fn digest(seed: u8) -> String {
        format!("{seed:02x}").repeat(32)
    }

    fn manifest(id: &str, version: &str, network: bool) -> Value {
        let mut manifest = json!({
            "schemaVersion": 1, "apiVersion": 1, "id": id, "version": version,
            "name": {"en": "Widget", "fr": "Widget"},
            "sizing": {
                "fit": "both",
                "preferred": {"width": 200, "height": 100},
                "min": {"width": 100, "height": 50},
                "max": {"width": 400, "height": 200}
            }
        });
        if network {
            manifest["permissions"] = json!({
                "network": [{"origin": "https://api.raidforge.gg", "method": "GET", "path": "/v1/status"}]
            });
        }
        manifest
    }

    fn target(id: &str, version: &str, seed: u8, network: bool) -> Value {
        let digest = digest(seed);
        json!({
            "manifest": manifest(id, version, network),
            "status": "verified",
            "package": {
                "url": format!("{BASE}packages/{id}/{version}/{digest}.ocpkg"),
                "size": 4096,
                "sha256": digest
            }
        })
    }

    fn categories() -> Value {
        Value::Array(
            INITIAL_CATEGORIES
                .iter()
                .map(|(id, en, fr)| json!({"id": id, "labels": {"en": en, "fr": fr}}))
                .collect(),
        )
    }

    fn valid() -> Value {
        let preview = digest(0xc1);
        let mut timers_new = target("gg.raidforge.timers", "1.2.0", 0xa2, true);
        timers_new["releaseNotes"] = json!({
            "en": "Alerts when a server goes down.\nFixes the Baron timer.",
            "fr": "Alerte en cas d’incident.\nCorrige le minuteur du Baron."
        });
        let mut timers_old = target("gg.raidforge.timers", "1.1.0", 0xa1, true);
        timers_old["status"] = json!("revoked");
        json!({
            "formatVersion": 2,
            "sequence": 1,
            "generatedAt": "2026-11-02T10:00:00Z",
            "expiresAt": "2027-01-31T10:00:00Z",
            "categories": categories(),
            "publishers": [
                {"handle": "playervox", "name": "PlayerVox", "domains": ["playervox.com"], "verifiedDomain": "playervox.com"},
                {"handle": "raidforge", "name": "Raidforge", "domains": ["raidforge.gg"], "verifiedDomain": "raidforge.gg"},
                {"handle": "nightowl", "name": "Night Owl Studio"}
            ],
            "widgets": [
                {
                    "id": "com.playervox.overcrow.clock",
                    "publisher": "playervox",
                    "tags": ["built-in"],
                    "listing": {
                        "defaultLocale": "en",
                        "description": {"en": "Shows the local time.", "fr": "Affiche l’heure locale."},
                        "category": "productivity",
                        "spdxLicense": "MIT",
                        "support": {"url": "https://github.com/Valhallab/playervox-overcrow-releases/issues"},
                        "sourceUrl": "https://github.com/Valhallab/playervox-overcrow-releases/tree/main/widgets/clock"
                    },
                    "preview": {
                        "url": format!("{BASE}previews/com.playervox.overcrow.clock/{preview}.png"),
                        "mediaType": "image/png",
                        "size": 40000,
                        "sha256": preview
                    }
                },
                {
                    "id": "gg.raidforge.timers",
                    "publisher": "raidforge",
                    "listing": {
                        "defaultLocale": "en",
                        "description": {"en": "Raid timers.\nServer alerts.", "fr": "Minuteurs de raid.", "de": "Raid-Timer."},
                        "category": "game-tools",
                        "games": [{"id": 1942, "slug": "the-witcher-3-wild-hunt", "name": "The Witcher 3: Wild Hunt"}],
                        "spdxLicense": "LicenseRef-Proprietary",
                        "support": {"email": "support@raidforge.gg"},
                        "privacyPolicyUrl": "https://raidforge.gg/privacy"
                    }
                },
                {
                    "id": "nightowl.focus",
                    "publisher": "nightowl",
                    "listing": {
                        "defaultLocale": "en",
                        "description": {"en": "A quiet focus timer."},
                        "category": "other",
                        "spdxLicense": "MIT OR Apache-2.0",
                        "support": {"url": "https://nightowl.example/support/"},
                        "sourceUrl": "https://codeberg.org/nightowl/focus"
                    }
                }
            ],
            "targets": [
                target("com.playervox.overcrow.clock", "1.0.0", 0xb1, false),
                timers_old,
                timers_new,
                target("nightowl.focus", "0.3.0", 0xd1, false)
            ]
        })
    }

    fn check(payload: &Value) -> Result<CatalogV2, CatalogV2Error> {
        validate_catalog(
            &serde_json::to_vec(payload).expect("payload"),
            now(),
            Origin::Production,
        )
    }

    fn refused(expected: CatalogV2Error, change: impl FnOnce(&mut Value)) {
        let mut payload = valid();
        change(&mut payload);
        assert_eq!(check(&payload).map(|_| ()), Err(expected), "{payload}");
    }

    /// Index of the timers widget and of its newest target.
    const TIMERS: usize = 1;
    const TIMERS_NEW: usize = 2;

    #[test]
    fn a_full_catalog_is_valid() {
        let catalog = check(&valid()).expect("valid catalog");
        assert_eq!(catalog.sequence, 1);
        assert_eq!(catalog.categories.len(), 7);
        assert_eq!(catalog.categories[0].labels["fr"], "Outils de jeu");
        assert_eq!(
            catalog.publishers[1].verified_domain.as_deref(),
            Some("raidforge.gg")
        );
        assert_eq!(catalog.widgets.len(), 3);
        let clock = &catalog.widgets[0];
        assert!(clock.built_in);
        assert!(clock.preview.is_some());
        let timers = &catalog.widgets[TIMERS];
        assert_eq!(
            timers.listing.support,
            Support::Email("support@raidforge.gg".into())
        );
        assert_eq!(timers.listing.games[0].slug, "the-witcher-3-wild-hunt");
        assert_eq!(timers.listing.description.len(), 3);
        assert_eq!(catalog.targets.len(), 4);
        assert!(catalog.targets[0].target.built_in);
        assert_eq!(catalog.targets[0].target.preview, clock.preview);
        assert_eq!(catalog.targets[1].target.status, TargetStatus::Revoked);
        assert_eq!(catalog.targets[TIMERS_NEW].release_notes.len(), 2);
        assert!(catalog.targets[3].release_notes.is_empty());
    }

    #[test]
    fn envelopes_have_their_own_version_and_domain() {
        let payload = br#"{"formatVersion":2}"#;
        let signature = [7u8; 64];
        let bytes = encode_envelope("overcrow-widgets-2026-01", payload, &signature);
        let envelope = open_envelope(&bytes).expect("v2 envelope");
        assert_eq!(envelope.payload, payload);
        assert_eq!(envelope.signature, signature);
        assert!(
            envelope
                .signed_message()
                .starts_with(b"OverCrow widget catalog v2\0")
        );
        assert_ne!(CATALOG_V2_DOMAIN, crate::catalog::CATALOG_DOMAIN);
        assert_ne!(CATALOG_V2_DOMAIN, crate::catalog::SEED_DOMAIN);

        let v1 = crate::catalog::encode_envelope("overcrow-widgets-2026-01", payload, &signature);
        assert_eq!(open_envelope(&v1), Err(CatalogV2Error::FormatVersion));
        assert_eq!(
            crate::catalog::open_envelope(&bytes, crate::catalog::Document::Catalog),
            Err(crate::catalog::CatalogError::FormatVersion)
        );
        let text = String::from_utf8(bytes).expect("ASCII");
        let extra = text.replacen("{", "{\"extra\":1,", 1);
        assert_eq!(
            open_envelope(extra.as_bytes()),
            Err(CatalogV2Error::Envelope)
        );
        let upper = text.replacen("overcrow-widgets-2026-01", "OverCrow", 1);
        assert_eq!(open_envelope(upper.as_bytes()), Err(CatalogV2Error::KeyId));
        let huge = vec![b' '; MAX_CATALOG_V2_BYTES_FOR_TESTS + 1];
        assert_eq!(open_envelope(&huge), Err(CatalogV2Error::EnvelopeSize));
    }

    const MAX_CATALOG_V2_BYTES_FOR_TESTS: usize =
        crate::limits::MAX_CATALOG_V2_BYTES.value as usize;

    #[test]
    fn payload_versions_and_validity() {
        refused(CatalogV2Error::FormatVersion, |c| {
            c["formatVersion"] = json!(1)
        });
        refused(CatalogV2Error::Sequence, |c| c["sequence"] = json!(0));
        refused(CatalogV2Error::Time, |c| {
            c["expiresAt"] = json!("2027-02-01T10:00:00Z")
        });
        refused(CatalogV2Error::Expired, |c| {
            c["generatedAt"] = json!("2026-08-01T00:00:00Z");
            c["expiresAt"] = json!("2026-10-01T00:00:00Z");
        });
        refused(CatalogV2Error::Payload, |c| {
            c.as_object_mut().expect("payload").remove("widgets");
        });
        // The development origin uses its own base and, like v1, no
        // lifetime bound.
        let mut long = valid();
        long["expiresAt"] = json!("2027-06-01T00:00:00Z");
        let text = serde_json::to_string(&long)
            .expect("payload")
            .replace(PRODUCTION_BASE_URL, DEVELOPMENT_BASE_URL);
        assert!(validate_catalog(text.as_bytes(), now(), Origin::Development).is_ok());
        assert_eq!(
            validate_catalog(text.as_bytes(), now(), Origin::Production).map(|_| ()),
            Err(CatalogV2Error::Time)
        );
        let bytes = serde_json::to_vec(&valid()).expect("payload");
        assert_eq!(
            validate_catalog(&bytes, now(), Origin::Development).map(|_| ()),
            Err(CatalogV2Error::Preview)
        );
    }

    #[test]
    fn categories_come_from_the_catalog() {
        refused(CatalogV2Error::Category, |c| {
            c["categories"].as_array_mut().expect("list").pop();
        });
        refused(CatalogV2Error::Category, |c| {
            let first = c["categories"][0].clone();
            c["categories"].as_array_mut().expect("list").push(first);
        });
        refused(CatalogV2Error::Category, |c| {
            c["categories"][0]["labels"] = json!({"fr": "Outils de jeu"});
        });
        refused(CatalogV2Error::Category, |c| {
            c["categories"][0]["id"] = json!("Game-Tools")
        });
        refused(CatalogV2Error::Limit, |c| {
            let list = c["categories"].as_array_mut().expect("list");
            for index in 0..26 {
                list.push(json!({"id": format!("extra-{index}"), "labels": {"en": "Extra"}}));
            }
        });
        // A new category works without a new application.
        let mut payload = valid();
        payload["categories"].as_array_mut().expect("list").insert(
            0,
            json!({"id": "racing", "labels": {"en": "Racing", "fr": "Course"}}),
        );
        payload["widgets"][TIMERS]["listing"]["category"] = json!("racing");
        let catalog = check(&payload).expect("new category");
        assert_eq!(catalog.widgets[TIMERS].listing.category, "racing");
        refused(CatalogV2Error::CategoryRef, |c| {
            c["widgets"][TIMERS]["listing"]["category"] = json!("racing");
        });
    }

    #[test]
    fn publishers_hold_their_domains_alone() {
        refused(CatalogV2Error::Publisher, |c| {
            let first = c["publishers"][1].clone();
            c["publishers"].as_array_mut().expect("list").push(first);
        });
        refused(CatalogV2Error::Publisher, |c| {
            c["publishers"][1]["handle"] = json!("Raidforge")
        });
        refused(CatalogV2Error::Publisher, |c| {
            c["publishers"][1]["verifiedDomain"] = json!("raidforge.com");
        });
        refused(CatalogV2Error::Publisher, |c| {
            c["publishers"][1]["name"] = json!("Raid\u{202e}egrof");
        });
        refused(CatalogV2Error::Publisher, |c| {
            c["publishers"][1]["name"] = json!(" Raidforge")
        });
        refused(CatalogV2Error::Domain, |c| {
            c["publishers"][2]["domains"] = json!(["raidforge.gg"]);
        });
        refused(CatalogV2Error::Domain, |c| {
            c["publishers"][2]["domains"] = json!(["eu.raidforge.gg"]);
        });
        refused(CatalogV2Error::Domain, |c| {
            c["publishers"][2]["domains"] = json!(["store.playervox.com"]);
        });
        refused(CatalogV2Error::Domain, |c| {
            c["publishers"][1]["domains"] = json!(["raidforge.gg", "raidforge.gg"]);
        });
        refused(CatalogV2Error::Domain, |c| {
            c["publishers"][1]["domains"] = json!(["gg"])
        });
        // One publisher may hold nested domains of its own.
        let mut payload = valid();
        payload["publishers"][1]["domains"] = json!(["raidforge.gg", "eu.raidforge.gg"]);
        assert!(check(&payload).is_ok());
        // Reserved handles are a registration policy, not a catalog rule.
        let mut payload = valid();
        payload["publishers"][2]["handle"] = json!("admin");
        payload["widgets"][2]["publisher"] = json!("admin");
        payload["widgets"][2]["id"] = json!("admin.focus");
        payload["targets"][3] = target("admin.focus", "0.3.0", 0xd1, false);
        assert!(check(&payload).is_ok());
    }

    #[test]
    fn widgets_belong_to_their_publisher() {
        refused(CatalogV2Error::PublisherRef, |c| {
            c["widgets"][2]["publisher"] = json!("ghost")
        });
        refused(CatalogV2Error::DuplicateWidget, |c| {
            let first = c["widgets"][2].clone();
            c["widgets"].as_array_mut().expect("list").push(first);
        });
        refused(CatalogV2Error::Ownership, |c| {
            c["widgets"][2]["publisher"] = json!("raidforge")
        });
        refused(CatalogV2Error::Ownership, |c| {
            c["widgets"][TIMERS]["id"] = json!("com.playervox.timers");
            c["targets"][1] = target("com.playervox.timers", "1.1.0", 0xa1, true);
            c["targets"][2] = target("com.playervox.timers", "1.2.0", 0xa2, true);
        });
        refused(CatalogV2Error::Widget, |c| {
            c["widgets"][2]["id"] = json!("Night.Focus")
        });
        refused(CatalogV2Error::BuiltInId, |c| {
            c["widgets"][2]["tags"] = json!(["built-in"])
        });
        refused(CatalogV2Error::Tag, |c| {
            c["widgets"][0]["tags"] = json!(["built-in", "featured"])
        });
        refused(CatalogV2Error::Tag, |c| {
            c["widgets"][0]["tags"] = json!(["built-in", "built-in"])
        });
        refused(CatalogV2Error::Preview, |c| {
            let url = c["widgets"][0]["preview"]["url"]
                .as_str()
                .expect("url")
                .replace("/v2/", "/v1/");
            c["widgets"][0]["preview"]["url"] = json!(url);
        });
        refused(CatalogV2Error::Preview, |c| {
            c["widgets"][0]["preview"]["mediaType"] = json!("image/webp")
        });
    }

    fn listing(payload: &mut Value) -> &mut Value {
        &mut payload["widgets"][TIMERS]["listing"]
    }

    #[test]
    fn listings_follow_the_v2_rules() {
        refused(CatalogV2Error::DefaultLocale, |c| {
            listing(c)["defaultLocale"] = json!("fr")
        });
        refused(CatalogV2Error::Description, |c| {
            let description = listing(c)["description"].as_object_mut().expect("map");
            for locale in [
                "es", "it", "pt", "nl", "pl", "sv", "da", "fi", "nb", "cs", "hu", "ro", "tr", "el",
            ] {
                description.insert(locale.into(), json!("x"));
            }
        });
        refused(CatalogV2Error::Description, |c| {
            listing(c)["description"]["en"] = json!("é".repeat(501));
        });
        refused(CatalogV2Error::Description, |c| {
            listing(c)["description"] = json!({"fr": "Minuteurs"});
        });
        refused(CatalogV2Error::Games, |c| {
            listing(c)["games"] = json!(
                (1..=6)
                    .map(|id| json!({"id": id, "slug": format!("g-{id}"), "name": "Game"}))
                    .collect::<Vec<_>>()
            );
        });
        refused(CatalogV2Error::License, |c| {
            listing(c)["spdxLicense"] = json!("LicenseRef-Autre")
        });
        refused(CatalogV2Error::Support, |c| {
            listing(c)
                .as_object_mut()
                .expect("listing")
                .remove("support");
        });
        refused(CatalogV2Error::Support, |c| {
            listing(c)["support"] =
                json!({"url": "https://raidforge.gg/help", "email": "a@raidforge.gg"});
        });
        refused(CatalogV2Error::Support, |c| {
            listing(c)["support"] = json!({"phone": "+33"})
        });
        refused(CatalogV2Error::PrivacyPolicy, |c| {
            listing(c)
                .as_object_mut()
                .expect("listing")
                .remove("privacyPolicyUrl");
        });
        refused(CatalogV2Error::PrivacyPolicy, |c| {
            listing(c)["privacyPolicyUrl"] = json!("http://raidforge.gg/privacy");
        });
        refused(CatalogV2Error::SourceUrl, |c| {
            c["widgets"][2]["listing"]["sourceUrl"] = json!("http://codeberg.org/nightowl/focus");
        });
        // Only the old listed version uses the network: the policy stays required.
        refused(CatalogV2Error::PrivacyPolicy, |c| {
            listing(c)
                .as_object_mut()
                .expect("listing")
                .remove("privacyPolicyUrl");
            c["targets"][TIMERS_NEW] = target("gg.raidforge.timers", "1.2.0", 0xa2, false);
        });
        // Without any network version, no policy is needed.
        let mut payload = valid();
        payload["widgets"][TIMERS]["listing"]
            .as_object_mut()
            .expect("listing")
            .remove("privacyPolicyUrl");
        payload["targets"][1] = target("gg.raidforge.timers", "1.1.0", 0xa1, false);
        payload["targets"][TIMERS_NEW] = target("gg.raidforge.timers", "1.2.0", 0xa2, false);
        assert!(check(&payload).is_ok());
    }

    #[test]
    fn targets_follow_the_v2_rules() {
        refused(CatalogV2Error::UnknownWidget, |c| {
            c["targets"].as_array_mut().expect("list").push(target(
                "nightowl.other",
                "1.0.0",
                0xe1,
                false,
            ));
        });
        refused(CatalogV2Error::DuplicateTarget, |c| {
            let first = c["targets"][3].clone();
            c["targets"].as_array_mut().expect("list").push(first);
        });
        refused(CatalogV2Error::Url, |c| {
            let url = c["targets"][3]["package"]["url"]
                .as_str()
                .expect("url")
                .replace("/v2/", "/v1/");
            c["targets"][3]["package"]["url"] = json!(url);
        });
        refused(CatalogV2Error::Status, |c| {
            c["targets"][3]["status"] = json!("pending")
        });
        refused(CatalogV2Error::PackageRef, |c| {
            c["targets"][3]["package"]["size"] = json!(0)
        });
        refused(CatalogV2Error::ReleaseNotes, |c| {
            c["targets"][TIMERS_NEW]["releaseNotes"] = json!({"fr": "Corrections."});
        });
        refused(
            CatalogV2Error::Manifest(crate::manifest::ManifestError::Shape),
            |c| {
                c["targets"][3]["manifest"]["tags"] = json!(["built-in"]);
            },
        );
        // A widget entry without any target is not shown.
        let mut payload = valid();
        payload["targets"].as_array_mut().expect("list").pop();
        let catalog = check(&payload).expect("widget without target hidden");
        assert_eq!(catalog.widgets.len(), 2);
    }

    #[test]
    fn unknown_members_are_ignored() {
        let mut payload = valid();
        payload["collections"] = json!([{"id": "featured"}]);
        payload["categories"][0]["icon"] = json!("swords");
        payload["publishers"][1]["logo"] = json!({"url": "https://raidforge.gg/logo.png"});
        payload["widgets"][TIMERS]["price"] = json!({"amount": 0});
        payload["widgets"][TIMERS]["listing"]["trailerUrl"] = json!("https://raidforge.gg/trailer");
        payload["widgets"][TIMERS]["listing"]["support"]["hours"] = json!("9-17");
        payload["widgets"][TIMERS]["listing"]["games"][0]["cover"] = json!("x");
        payload["widgets"][0]["preview"]["width"] = json!(800);
        payload["targets"][3]["minimumApp"] = json!("0.7.0");
        payload["targets"][3]["package"]["mirror"] = json!("https://example.com/x");
        assert_eq!(
            check(&payload).expect("unknown members ignored"),
            check(&valid()).expect("valid")
        );
        // Unknown values of known members stay refused.
        refused(CatalogV2Error::Status, |c| {
            c["targets"][3]["status"] = json!("deprecated")
        });
        refused(CatalogV2Error::CategoryRef, |c| {
            c["widgets"][2]["listing"]["category"] = json!("racing");
        });
    }

    #[test]
    fn requires_skips_entries_it_cannot_honour() {
        // A target needing an unknown feature is skipped, even if not valid v2.
        let mut payload = valid();
        payload["targets"]
            .as_array_mut()
            .expect("list")
            .push(json!({"requires": ["entitlement"], "manifest": {"apiVersion": 2}}));
        let catalog = check(&payload).expect("target skipped");
        assert_eq!(catalog.targets.len(), 4);

        // A widget needing an unknown feature is skipped with its targets.
        let mut payload = valid();
        payload["widgets"][2] = json!({
            "id": "nightowl.focus",
            "requires": ["entitlement"],
            "publisher": "someone-not-listed",
            "listing": {"price": 3}
        });
        let catalog = check(&payload).expect("widget skipped");
        assert_eq!(catalog.widgets.len(), 2);
        assert_eq!(catalog.targets.len(), 3);
        assert!(
            catalog
                .targets
                .iter()
                .all(|t| t.target.manifest.id != "nightowl.focus")
        );
        // Its targets are skipped by ID, before their manifest is read.
        payload["targets"][3]["manifest"]["apiVersion"] = json!(2);
        payload["targets"][3]["manifest"]["entry"] = json!("logic.wasm");
        assert_eq!(check(&payload).expect("targets skipped").targets.len(), 3);

        // A widget whose only target is skipped is not shown.
        let mut payload = valid();
        payload["targets"][3]["requires"] = json!(["api-v2"]);
        let catalog = check(&payload).expect("widget without target hidden");
        assert_eq!(catalog.widgets.len(), 2);

        refused(CatalogV2Error::Requires, |c| {
            c["targets"][3]["requires"] = json!(["Bad Name"])
        });
        refused(CatalogV2Error::Requires, |c| {
            c["targets"][3]["requires"] = json!("entitlement")
        });
        refused(CatalogV2Error::Requires, |c| {
            c["widgets"][2]["requires"] = json!(["a", "a"]);
        });
        refused(CatalogV2Error::Widget, |c| {
            c["widgets"][2] = json!({"id": "Bad", "requires": ["entitlement"]});
        });
        refused(CatalogV2Error::DuplicateWidget, |c| {
            c["widgets"]
                .as_array_mut()
                .expect("list")
                .push(json!({"id": "nightowl.focus", "requires": ["entitlement"]}));
        });
    }
}
