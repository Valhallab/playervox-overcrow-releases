//! Signed widget catalog v1, its offline seed and the built-in lifecycle
//! (ADR 0001, D7, D11 and Q3; P0.5).
//!
//! Both documents are an Ed25519 signature over a domain-separation string
//! followed by a strict JSON payload. This crate parses the envelope and
//! returns the exact signed message; the caller verifies the signature with a
//! trusted key before calling [`validate_catalog`] or [`validate_seed`]. The
//! host links `ring` for that; the Studio never verifies catalogs.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Map, Value};

use crate::json::{has_exact_fields, parse_strict, plain_text};
use crate::limits::{
    MAX_AUTHOR_BYTES, MAX_CATALOG_BYTES, MAX_CATALOG_CLOCK_SKEW_MS, MAX_CATALOG_LIFETIME_DAYS,
    MAX_CATALOG_PAYLOAD_BYTES, MAX_CATALOG_TARGETS, MAX_CATALOG_URL_BYTES, MAX_KEY_ID_BYTES,
    MAX_LISTING_DESCRIPTION_BYTES, MAX_LISTING_LOCALIZATIONS, MAX_LISTING_NAME_BYTES,
    MAX_PACKAGE_BYTES, MAX_PREVIEW_BYTES, MAX_SEED_LIFETIME_DAYS, MAX_SPDX_LICENSE_BYTES,
};
use crate::manifest::{Manifest, ManifestError, Permissions, validate_manifest_value};
use crate::model::{Field, ValueType};
use crate::package::{Package, PackageError, hex, read_package, sha256};
use crate::version::Version;

/// Signed prefix of a live catalog. It never starts with `{`, so no Web
/// catalog signature (made over the bare payload) verifies as a v1 catalog,
/// and a seed signature never verifies as a catalog or the reverse.
pub const CATALOG_DOMAIN: &[u8] = b"OverCrow widget catalog v1\0";
/// Signed prefix of the offline seed shipped with the application.
pub const SEED_DOMAIN: &[u8] = b"OverCrow widget seed v1\0";

pub const FORMAT_VERSION: i64 = 1;

/// The v1 catalog lives under a new path: the Web catalog (`/marketplace/v1/`)
/// can never be fetched in its place.
pub const PRODUCTION_BASE_URL: &str = "https://overcrow.playervox.com/marketplace/widgets/v1/";
/// Local marketplace of a development host; production hosts refuse it.
pub const DEVELOPMENT_BASE_URL: &str = "http://127.0.0.1:8787/marketplace/widgets/v1/";
pub const CATALOG_FILE: &str = "catalog.json";

/// Key of the conformance fixtures. Its private seed is public
/// (`SHA-256("OverCrow widget conformance key; never trusted")`), so no host
/// may trust it: production hosts accept only [`is_production_key_id`] IDs.
pub const CONFORMANCE_KEY_ID: &str = "overcrow-widgets-conformance";
/// Key of local development marketplaces.
pub const DEVELOPMENT_KEY_ID: &str = "overcrow-widgets-development";

pub const BUILT_IN_TAG: &str = "built-in";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Tag {
    pub name: &'static str,
    pub summary: &'static str,
}

/// Closed set of catalog tags.
pub const TAGS: &[Tag] = &[Tag {
    name: BUILT_IN_TAG,
    summary: "PlayerVox reference widget: installed by default from the live catalog or the offline seed, with default consent to its declared permissions (ADR 0001, D7). Accepted only for `com.playervox.*` IDs, on every listed version of the ID.",
}];

pub const STATUSES: &[&str] = &["verified", "security-suspended", "revoked"];

pub const ENVELOPE_FIELDS: &[Field] = &[
    Field::required(
        "formatVersion",
        ValueType::Integer { min: 1, max: 1 },
        "Envelope format.",
    ),
    Field::required(
        "keyId",
        ValueType::Text(&MAX_KEY_ID_BYTES),
        "Signing key ID: `[a-z0-9._-]`; production IDs are `overcrow-widgets-YYYY-NN`.",
    ),
    Field::required(
        "payload",
        ValueType::Record("Base64url"),
        "Canonical unpadded Base64url of the payload bytes, at most `MAX_CATALOG_PAYLOAD_BYTES` decoded.",
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
        ValueType::Integer { min: 1, max: 1 },
        "Catalog format.",
    ),
    Field::required(
        "sequence",
        ValueType::Integer {
            min: 1,
            max: (1 << 53) - 1,
        },
        "Anti-rollback sequence of the v1 catalog, started at 1 and independent of the Web catalog.",
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
        "targets",
        ValueType::ListOf("Target", &MAX_CATALOG_TARGETS),
        "Listed package versions, unique by ID and version.",
    ),
];

pub const SEED_FIELDS: &[Field] = &[
    Field::required(
        "formatVersion",
        ValueType::Integer { min: 1, max: 1 },
        "Seed format.",
    ),
    Field::required(
        "catalogSequence",
        ValueType::Integer {
            min: 1,
            max: (1 << 53) - 1,
        },
        "Sequence of the live catalog the seed was cut from.",
    ),
    Field::required(
        "generatedAt",
        ValueType::Record("UTC timestamp"),
        "`YYYY-MM-DDTHH:MM:SSZ`.",
    ),
    Field::required(
        "expiresAt",
        ValueType::Record("UTC timestamp"),
        "After `generatedAt`, at most `MAX_SEED_LIFETIME_DAYS` later.",
    ),
    Field::required(
        "targets",
        ValueType::ListOf("Target", &MAX_CATALOG_TARGETS),
        "`built-in` targets with status `verified` only, as listed by that catalog.",
    ),
];

pub const TARGET_FIELDS: &[Field] = &[
    Field::required(
        "manifest",
        ValueType::Record("manifest"),
        "The package's manifest object, validated as v1; the package must contain an equal one.",
    ),
    Field::optional(
        "tags",
        ValueType::Record("list of tags"),
        "Distinct tags from the closed set.",
    ),
    Field::required(
        "status",
        ValueType::Keyword(STATUSES),
        "`verified` may be installed; `security-suspended` and `revoked` may not, and stop an installed copy.",
    ),
    Field::required(
        "package",
        ValueType::Record("PackageRef"),
        "Immutable archive.",
    ),
    Field::required("listing", ValueType::Record("Listing"), "Marketplace text."),
    Field::optional("preview", ValueType::Record("Preview"), "PNG preview."),
];

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

pub const LISTING_FIELDS: &[Field] = &[
    Field::required(
        "author",
        ValueType::Text(&MAX_AUTHOR_BYTES),
        "Plain text, trimmed, without `<` or `>`.",
    ),
    Field::required(
        "spdxLicense",
        ValueType::Text(&MAX_SPDX_LICENSE_BYTES),
        "SPDX expression characters `[A-Za-z0-9.+-]`.",
    ),
    Field::required(
        "sourceUrl",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Canonical HTTPS URL of the reviewed source, without port, query or fragment.",
    ),
    Field::required(
        "defaultLocale",
        ValueType::Record("locale"),
        "One of the localizations.",
    ),
    Field::required(
        "localizations",
        ValueType::ListOf("Localization", &MAX_LISTING_LOCALIZATIONS),
        "`{ locale, name, description }` with distinct `xx` or `xx-YY` locales; name ≤ `MAX_LISTING_NAME_BYTES`, description ≤ `MAX_LISTING_DESCRIPTION_BYTES`.",
    ),
];

pub const PREVIEW_FIELDS: &[Field] = &[
    Field::required(
        "url",
        ValueType::Text(&MAX_CATALOG_URL_BYTES),
        "Exactly `<base>previews/<id>/<version>/<sha256>.png`.",
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

/// What a signature covers. The caller chooses it from where the bytes come
/// from (the catalog URL, or the seed shipped with the application).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Document {
    Catalog,
    Seed,
}

impl Document {
    pub const fn domain(self) -> &'static [u8] {
        match self {
            Self::Catalog => CATALOG_DOMAIN,
            Self::Seed => SEED_DOMAIN,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Origin {
    Production,
    Development,
}

impl Origin {
    pub const fn base_url(self) -> &'static str {
        match self {
            Self::Production => PRODUCTION_BASE_URL,
            Self::Development => DEVELOPMENT_BASE_URL,
        }
    }
}

/// Fixed reasons a catalog, a seed or a downloaded package is rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogError {
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
    TargetLimit,
    Manifest(ManifestError),
    DuplicateTarget,
    Tag,
    BuiltInId,
    TagConsistency,
    Status,
    PackageRef,
    Url,
    Listing,
    Preview,
    SeedTarget,
    PackageSize,
    PackageDigest,
    Package(PackageError),
    ManifestMismatch,
}

impl CatalogError {
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
            Self::TargetLimit => "target_limit",
            Self::Manifest(_) => "manifest",
            Self::DuplicateTarget => "duplicate_target",
            Self::Tag => "tag",
            Self::BuiltInId => "built_in_id",
            Self::TagConsistency => "tag_consistency",
            Self::Status => "status",
            Self::PackageRef => "package_ref",
            Self::Url => "url",
            Self::Listing => "listing",
            Self::Preview => "preview",
            Self::SeedTarget => "seed_target",
            Self::PackageSize => "package_size",
            Self::PackageDigest => "package_digest",
            Self::Package(_) => "package",
            Self::ManifestMismatch => "manifest_mismatch",
        }
    }
}

/// A parsed envelope whose signature is not verified yet.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Envelope {
    pub key_id: String,
    pub payload: Vec<u8>,
    pub signature: [u8; 64],
    pub document: Document,
}

impl Envelope {
    /// The exact bytes the Ed25519 signature covers.
    pub fn signed_message(&self) -> Vec<u8> {
        [self.document.domain(), &self.payload].concat()
    }
}

/// Parses a catalog or seed envelope. It does not verify the signature.
pub fn open_envelope(bytes: &[u8], document: Document) -> Result<Envelope, CatalogError> {
    if bytes.len() as u64 > MAX_CATALOG_BYTES.value {
        return Err(CatalogError::EnvelopeSize);
    }
    let value = parse_strict(bytes, MAX_CATALOG_BYTES.value).ok_or(CatalogError::Envelope)?;
    let object = value.as_object().ok_or(CatalogError::Envelope)?;
    if object.get("formatVersion").and_then(Value::as_i64) != Some(FORMAT_VERSION) {
        return Err(CatalogError::FormatVersion);
    }
    if !has_exact_fields(object, &[ENVELOPE_FIELDS]) {
        return Err(CatalogError::Envelope);
    }
    let key_id = object["keyId"].as_str().ok_or(CatalogError::Envelope)?;
    if !valid_key_id(key_id) {
        return Err(CatalogError::KeyId);
    }
    let payload = object["payload"].as_str().ok_or(CatalogError::Envelope)?;
    if payload.len() > (MAX_CATALOG_PAYLOAD_BYTES.value as usize).div_ceil(3) * 4 {
        return Err(CatalogError::PayloadSize);
    }
    let payload = decode_canonical(payload).ok_or(CatalogError::Envelope)?;
    if payload.len() as u64 > MAX_CATALOG_PAYLOAD_BYTES.value {
        return Err(CatalogError::PayloadSize);
    }
    let signature = object["signature"]
        .as_str()
        .filter(|text| text.len() <= 88)
        .and_then(decode_canonical)
        .and_then(|bytes| <[u8; 64]>::try_from(bytes).ok())
        .ok_or(CatalogError::Signature)?;
    Ok(Envelope {
        key_id: key_id.to_owned(),
        payload,
        signature,
        document,
    })
}

/// Encodes an envelope; used by the signing pipeline and the fixtures.
pub fn encode_envelope(key_id: &str, payload: &[u8], signature: &[u8; 64]) -> Vec<u8> {
    format!(
        "{{\"formatVersion\":{FORMAT_VERSION},\"keyId\":\"{key_id}\",\"payload\":\"{}\",\"signature\":\"{}\"}}",
        URL_SAFE_NO_PAD.encode(payload),
        URL_SAFE_NO_PAD.encode(signature)
    )
    .into_bytes()
}

/// `[a-z0-9._-]`, at most `MAX_KEY_ID_BYTES`, as today.
pub fn valid_key_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() as u64 <= MAX_KEY_ID_BYTES.value
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

/// `overcrow-widgets-YYYY-NN`: the only IDs a production host trusts. The
/// Web catalog keys (`overcrow-production-*`, `overcrow-development-*`), the
/// development key and the conformance key never match.
pub fn is_production_key_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("overcrow-widgets-") else {
        return false;
    };
    let bytes = rest.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().chain(&bytes[5..]).all(u8::is_ascii_digit)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TargetStatus {
    Verified,
    SecuritySuspended,
    Revoked,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PackageRef {
    pub url: String,
    pub size: u64,
    pub sha256: [u8; 32],
}

#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub manifest: Manifest,
    pub built_in: bool,
    pub status: TargetStatus,
    pub package: PackageRef,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Catalog {
    pub sequence: u64,
    pub generated_at: i64,
    pub expires_at: i64,
    pub targets: Vec<Target>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Seed {
    pub catalog_sequence: u64,
    pub generated_at: i64,
    pub expires_at: i64,
    pub targets: Vec<Target>,
}

impl Seed {
    /// Path of a target's archive inside the seed directory, next to
    /// `seed.json`. The directory holds exactly these files.
    pub fn package_path(target: &Target) -> String {
        format!("packages/{}.ocpkg", hex(&target.package.sha256))
    }
}

/// Validates a verified catalog payload at `now` (Unix seconds).
pub fn validate_catalog(payload: &[u8], now: i64, origin: Origin) -> Result<Catalog, CatalogError> {
    let object = payload_object(payload)?;
    if !has_exact_fields(&object, &[CATALOG_FIELDS]) {
        return Err(CatalogError::Payload);
    }
    let sequence = sequence(&object["sequence"])?;
    let lifetime = (origin == Origin::Production).then_some(MAX_CATALOG_LIFETIME_DAYS.value);
    let (generated_at, expires_at) = validity(&object, now, lifetime)?;
    let targets = targets(&object["targets"], origin)?;
    Ok(Catalog {
        sequence,
        generated_at,
        expires_at,
        targets,
    })
}

/// Validates a verified seed payload at `now` (Unix seconds). An expired or
/// not yet valid seed is refused as a whole: nothing is installed from it.
pub fn validate_seed(payload: &[u8], now: i64, origin: Origin) -> Result<Seed, CatalogError> {
    let object = payload_object(payload)?;
    if !has_exact_fields(&object, &[SEED_FIELDS]) {
        return Err(CatalogError::Payload);
    }
    let catalog_sequence = sequence(&object["catalogSequence"])?;
    let (generated_at, expires_at) = validity(&object, now, Some(MAX_SEED_LIFETIME_DAYS.value))?;
    let targets = targets(&object["targets"], origin)?;
    if targets
        .iter()
        .any(|target| !target.built_in || target.status != TargetStatus::Verified)
    {
        return Err(CatalogError::SeedTarget);
    }
    Ok(Seed {
        catalog_sequence,
        generated_at,
        expires_at,
        targets,
    })
}

/// Checks downloaded or seeded archive bytes against their signed target.
pub fn verify_target_package(bytes: &[u8], target: &Target) -> Result<Package, CatalogError> {
    if bytes.len() as u64 != target.package.size {
        return Err(CatalogError::PackageSize);
    }
    if sha256(bytes) != target.package.sha256 {
        return Err(CatalogError::PackageDigest);
    }
    let package = read_package(bytes).map_err(CatalogError::Package)?;
    if package.manifest.value != target.manifest.value {
        return Err(CatalogError::ManifestMismatch);
    }
    Ok(package)
}

fn payload_object(payload: &[u8]) -> Result<Map<String, Value>, CatalogError> {
    let value =
        parse_strict(payload, MAX_CATALOG_PAYLOAD_BYTES.value).ok_or(CatalogError::Payload)?;
    let Value::Object(object) = value else {
        return Err(CatalogError::Payload);
    };
    if object.get("formatVersion").and_then(Value::as_i64) != Some(FORMAT_VERSION) {
        return Err(CatalogError::FormatVersion);
    }
    Ok(object)
}

fn sequence(value: &Value) -> Result<u64, CatalogError> {
    value
        .as_u64()
        .filter(|sequence| (1..(1 << 53)).contains(sequence))
        .ok_or(CatalogError::Sequence)
}

fn validity(
    object: &Map<String, Value>,
    now: i64,
    max_lifetime_days: Option<u64>,
) -> Result<(i64, i64), CatalogError> {
    let time = |name: &str| {
        object[name]
            .as_str()
            .and_then(parse_timestamp)
            .ok_or(CatalogError::Time)
    };
    let (generated_at, expires_at) = (time("generatedAt")?, time("expiresAt")?);
    if expires_at <= generated_at
        || max_lifetime_days.is_some_and(|days| expires_at - generated_at > days as i64 * 86_400)
    {
        return Err(CatalogError::Time);
    }
    if generated_at > now.saturating_add(MAX_CATALOG_CLOCK_SKEW_MS.value as i64 / 1000) {
        return Err(CatalogError::NotYetValid);
    }
    if expires_at <= now {
        return Err(CatalogError::Expired);
    }
    Ok((generated_at, expires_at))
}

fn targets(value: &Value, origin: Origin) -> Result<Vec<Target>, CatalogError> {
    let list = value.as_array().ok_or(CatalogError::Payload)?;
    if list.len() as u64 > MAX_CATALOG_TARGETS.value {
        return Err(CatalogError::TargetLimit);
    }
    let mut identities = BTreeSet::new();
    let mut tags_by_id: BTreeMap<String, bool> = BTreeMap::new();
    let mut targets = Vec::with_capacity(list.len());
    for target in list {
        let target = target_entry(target, origin)?;
        if !identities.insert((
            target.manifest.id.clone(),
            target.manifest.version.to_string(),
        )) {
            return Err(CatalogError::DuplicateTarget);
        }
        let first = *tags_by_id
            .entry(target.manifest.id.clone())
            .or_insert(target.built_in);
        if first != target.built_in {
            return Err(CatalogError::TagConsistency);
        }
        targets.push(target);
    }
    Ok(targets)
}

fn target_entry(value: &Value, origin: Origin) -> Result<Target, CatalogError> {
    let object = value.as_object().ok_or(CatalogError::Payload)?;
    if !has_exact_fields(object, &[TARGET_FIELDS]) {
        return Err(CatalogError::Payload);
    }
    let manifest =
        validate_manifest_value(object["manifest"].clone()).map_err(CatalogError::Manifest)?;

    let built_in = match object.get("tags") {
        None => false,
        Some(tags) => {
            let tags = tags.as_array().ok_or(CatalogError::Tag)?;
            let mut unique = BTreeSet::new();
            for tag in tags {
                let tag = tag.as_str().ok_or(CatalogError::Tag)?;
                if !TAGS.iter().any(|known| known.name == tag) || !unique.insert(tag) {
                    return Err(CatalogError::Tag);
                }
            }
            unique.contains(BUILT_IN_TAG)
        }
    };
    if built_in && !manifest.has_reserved_id() {
        return Err(CatalogError::BuiltInId);
    }

    let status = match object["status"].as_str() {
        Some("verified") => TargetStatus::Verified,
        Some("security-suspended") => TargetStatus::SecuritySuspended,
        Some("revoked") => TargetStatus::Revoked,
        _ => return Err(CatalogError::Status),
    };

    let reference = object["package"]
        .as_object()
        .ok_or(CatalogError::PackageRef)?;
    if !has_exact_fields(reference, &[PACKAGE_REF_FIELDS]) {
        return Err(CatalogError::PackageRef);
    }
    let size = reference["size"]
        .as_u64()
        .filter(|size| (1..=MAX_PACKAGE_BYTES.value).contains(size))
        .ok_or(CatalogError::PackageRef)?;
    let digest = reference["sha256"]
        .as_str()
        .and_then(decode_sha256)
        .ok_or(CatalogError::PackageRef)?;
    let url = reference["url"].as_str().ok_or(CatalogError::PackageRef)?;
    let version = manifest.version.to_string();
    if url != immutable_url(origin, "packages", &manifest.id, &version, &digest, "ocpkg") {
        return Err(CatalogError::Url);
    }

    validate_listing(&object["listing"])?;
    if let Some(preview) = object.get("preview") {
        validate_preview(preview, origin, &manifest.id, &version)?;
    }

    Ok(Target {
        built_in,
        status,
        package: PackageRef {
            url: url.to_owned(),
            size,
            sha256: digest,
        },
        manifest,
    })
}

fn immutable_url(
    origin: Origin,
    area: &str,
    id: &str,
    version: &str,
    digest: &[u8; 32],
    extension: &str,
) -> String {
    format!(
        "{}{area}/{id}/{version}/{}.{extension}",
        origin.base_url(),
        hex(digest)
    )
}

fn validate_listing(value: &Value) -> Result<(), CatalogError> {
    let invalid = CatalogError::Listing;
    let object = value.as_object().ok_or(invalid)?;
    if !has_exact_fields(object, &[LISTING_FIELDS]) {
        return Err(invalid);
    }
    let author = plain_text(&object["author"], MAX_AUTHOR_BYTES.value).ok_or(invalid)?;
    let license = object["spdxLicense"].as_str().ok_or(invalid)?;
    let license_valid = !license.is_empty()
        && license.len() as u64 <= MAX_SPDX_LICENSE_BYTES.value
        && license.as_bytes()[0].is_ascii_alphanumeric()
        && license
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'));
    let source = object["sourceUrl"].as_str().ok_or(invalid)?;
    if !listing_text(author) || !license_valid || !canonical_source_url(source) {
        return Err(invalid);
    }
    let localizations = object["localizations"].as_array().ok_or(invalid)?;
    if localizations.is_empty() || localizations.len() as u64 > MAX_LISTING_LOCALIZATIONS.value {
        return Err(invalid);
    }
    let mut locales = BTreeSet::new();
    for localization in localizations {
        let localization = localization.as_object().ok_or(invalid)?;
        let fields = &[
            Field::required("locale", ValueType::Record("locale"), ""),
            Field::required("name", ValueType::Text(&MAX_LISTING_NAME_BYTES), ""),
            Field::required(
                "description",
                ValueType::Text(&MAX_LISTING_DESCRIPTION_BYTES),
                "",
            ),
        ];
        let locale = localization.get("locale").and_then(Value::as_str);
        let valid = has_exact_fields(localization, &[fields])
            && locale.is_some_and(|locale| valid_locale(locale) && locales.insert(locale))
            && plain_text(&localization["name"], MAX_LISTING_NAME_BYTES.value)
                .is_some_and(listing_text)
            && plain_text(
                &localization["description"],
                MAX_LISTING_DESCRIPTION_BYTES.value,
            )
            .is_some_and(listing_text);
        if !valid {
            return Err(invalid);
        }
    }
    let default = object["defaultLocale"].as_str().ok_or(invalid)?;
    if !locales.contains(default) {
        return Err(invalid);
    }
    Ok(())
}

fn validate_preview(
    value: &Value,
    origin: Origin,
    id: &str,
    version: &str,
) -> Result<(), CatalogError> {
    let invalid = CatalogError::Preview;
    let object = value.as_object().ok_or(invalid)?;
    let digest = object
        .get("sha256")
        .and_then(Value::as_str)
        .and_then(decode_sha256)
        .ok_or(invalid)?;
    let valid = has_exact_fields(object, &[PREVIEW_FIELDS])
        && object["mediaType"] == "image/png"
        && object["size"]
            .as_u64()
            .is_some_and(|size| (1..=MAX_PREVIEW_BYTES.value).contains(&size))
        && object["url"].as_str()
            == Some(immutable_url(origin, "previews", id, version, &digest, "png").as_str());
    valid.then_some(()).ok_or(invalid)
}

/// Trimmed plain text without markup characters, as today.
fn listing_text(text: &str) -> bool {
    text.trim() == text && !text.contains(['<', '>'])
}

/// `xx` or `xx-YY`, as today.
fn valid_locale(locale: &str) -> bool {
    let bytes = locale.as_bytes();
    let language = |part: &[u8]| part.len() == 2 && part.iter().all(u8::is_ascii_lowercase);
    match locale.split_once('-') {
        None => language(bytes),
        Some((lang, region)) => {
            language(lang.as_bytes())
                && region.len() == 2
                && region.bytes().all(|byte| byte.is_ascii_uppercase())
        }
    }
}

/// `https://host/segment/…`: DNS host, at least one path segment, no port,
/// user information, query, fragment, percent-encoding, trailing slash or
/// dot segment.
fn canonical_source_url(url: &str) -> bool {
    let Some((host, path)) = url
        .strip_prefix("https://")
        .and_then(|rest| rest.split_once('/'))
    else {
        return false;
    };
    url.len() as u64 <= MAX_CATALOG_URL_BYTES.value
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && !host
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .bytes()
            .all(|byte| byte.is_ascii_digit())
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && !matches!(segment, "." | "..")
                && segment.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~')
                })
        })
}

/// `YYYY-MM-DDTHH:MM:SSZ` to Unix seconds; anything else is rejected.
pub fn parse_timestamp(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 20
        || [4, 7].iter().any(|&index| bytes[index] != b'-')
        || bytes[10] != b'T'
        || [13, 16].iter().any(|&index| bytes[index] != b':')
        || bytes[19] != b'Z'
    {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let part = &text[range];
        part.bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| part.parse().ok())
            .flatten()
    };
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if year < 1970
        || !(1..=12).contains(&month)
        || day < 1
        || day > month_days[(month - 1) as usize]
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    // Days from the civil date (Howard Hinnant's algorithm).
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Unpadded Base64url that re-encodes to the same text; callers bound the
/// text length first.
fn decode_canonical(text: &str) -> Option<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD.decode(text).ok()?;
    (URL_SAFE_NO_PAD.encode(&bytes) == text).then_some(bytes)
}

fn decode_sha256(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64 {
        return None;
    }
    let mut digest = [0u8; 32];
    for (index, pair) in text.as_bytes().chunks(2).enumerate() {
        let digit = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        };
        digest[index] = digit(pair[0])? << 4 | digit(pair[1])?;
    }
    Some(digest)
}

/// The host's record of one built-in ID.
#[derive(Clone, Copy, Debug)]
pub enum Installed<'a> {
    /// Never installed, or removed by the host for a non-user reason.
    Absent,
    /// The user uninstalled it. The record survives updates, new seeds and
    /// new application versions; only an explicit install from the
    /// marketplace clears it.
    RemovedByUser,
    Present {
        version: &'a Version,
        permissions: &'a Permissions,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuiltInAction {
    /// Install with default consent to the declared permissions.
    Install,
    /// Update within the previously granted permissions.
    Update,
    /// Stage the update; it activates only after explicit consent.
    UpdateAfterConsent,
    /// Installed version is the same or newer: never downgrade.
    Keep,
    SkipRemovedByUser,
    /// Not tagged `built-in`, or not `verified`.
    NotOffered,
}

/// Decides the default installation of one catalog or seed target.
pub fn plan_built_in(target: &Target, installed: Installed<'_>) -> BuiltInAction {
    if !target.built_in || target.status != TargetStatus::Verified {
        return BuiltInAction::NotOffered;
    }
    match installed {
        Installed::RemovedByUser => BuiltInAction::SkipRemovedByUser,
        Installed::Absent => BuiltInAction::Install,
        Installed::Present { version, .. } if *version >= target.manifest.version => {
            BuiltInAction::Keep
        }
        Installed::Present { permissions, .. } => {
            if target.manifest.permissions.widens(permissions) {
                BuiltInAction::UpdateAfterConsent
            } else {
                BuiltInAction::Update
            }
        }
    }
}

/// The highest `verified` version of every `built-in` ID: what the host
/// plans with [`plan_built_in`].
pub fn built_in_offers(targets: &[Target]) -> BTreeMap<&str, &Target> {
    let mut offers: BTreeMap<&str, &Target> = BTreeMap::new();
    for target in targets
        .iter()
        .filter(|target| target.built_in && target.status == TargetStatus::Verified)
    {
        let newer = offers
            .get(target.manifest.id.as_str())
            .is_none_or(|current| current.manifest.version < target.manifest.version);
        if newer {
            offers.insert(&target.manifest.id, target);
        }
    }
    offers
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SeedUse {
    /// Plan the seed's targets as a catalog of `catalogSequence`, then raise
    /// the rollback floor: live catalogs below `catalogSequence` are refused.
    Apply,
    /// The host already accepted that catalog or a newer one; the seed is
    /// ignored and never replaces newer state.
    Superseded,
}

/// Whether a valid seed may be used, given the sequence of the newest live
/// catalog the host has accepted.
pub fn seed_use(seed: &Seed, accepted_catalog_sequence: Option<u64>) -> SeedUse {
    match accepted_catalog_sequence {
        Some(accepted) if accepted >= seed.catalog_sequence => SeedUse::Superseded,
        _ => SeedUse::Apply,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_production_key_id, parse_timestamp};

    #[test]
    fn timestamps_are_canonical_utc_seconds() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_timestamp("2026-10-01T00:00:00Z"), Some(1_790_812_800));
        assert_eq!(parse_timestamp("2024-02-29T23:59:59Z"), Some(1_709_251_199));
        for invalid in [
            "2026-10-01T00:00:00",
            "2026-10-01 00:00:00Z",
            "2026-10-01T00:00:00.0Z",
            "2026-10-01T00:00:00+00:00",
            "2025-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-10-01T24:00:00Z",
            "1969-12-31T23:59:59Z",
            "+026-10-01T00:00:00Z",
        ] {
            assert_eq!(parse_timestamp(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn only_v1_production_key_ids_are_production() {
        assert!(is_production_key_id("overcrow-widgets-2026-01"));
        for id in [
            "overcrow-production-2026-01",
            "overcrow-development-2026",
            "overcrow-widgets-conformance",
            "overcrow-widgets-development",
            "overcrow-widgets-2026-1",
            "overcrow-widgets-2026-001",
        ] {
            assert!(!is_production_key_id(id), "{id}");
        }
    }
}
