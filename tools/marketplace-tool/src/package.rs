use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
};

use semver::Version;
use serde::{Deserialize, Deserializer, Serialize, de};
use sha2::{Digest, Sha256};

use crate::private_fs::{open_regular_file, read_bounded_file};

#[path = "package_manifest.rs"]
mod manifest_contract;
#[path = "package_network.rs"]
mod network_contract;

use network_contract::WireNetworkPermission;

#[cfg(test)]
#[path = "package_network_tests.rs"]
mod network_tests;

const UTF8_FLAG: u16 = 1 << 11;
const DOS_DATE_1980_01_01: u16 = 33;
const REGULAR_MODE: u32 = 0o100644;
const MAX_FILES: usize = 4096;
pub(crate) const MAX_PACKAGE_BYTES: usize = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_LISTING_BYTES: usize = 64 * 1024;
const MAX_FILE_PATH_BYTES: usize = 192;
const NATIVE_SUFFIXES: &[&str] = &[".so", ".dll", ".dylib", ".exe", ".node"];

#[derive(Clone, Debug)]
pub struct WrittenPackage {
    pub path: PathBuf,
    pub digest: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct InspectedManifest {
    pub id: String,
    pub version: String,
    pub(crate) catalog_value: serde_json::Value,
}

#[derive(Debug)]
pub struct PackageError {
    message: &'static str,
}

impl fmt::Display for PackageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl Error for PackageError {}

const fn error(message: &'static str) -> PackageError {
    PackageError { message }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireManifest {
    schema_version: u32,
    id: String,
    version: String,
    api_version: String,
    entrypoints: WireEntrypoints,
    permissions: WirePermissions,
    localization: Option<WireLocalization>,
    #[serde(default, deserialize_with = "deserialize_present")]
    presentation: Option<manifest_contract::WirePresentation>,
    #[serde(deserialize_with = "deserialize_unique_file_map")]
    files: BTreeMap<String, WireFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireEntrypoints {
    view: String,
    controller: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WirePermissions {
    #[serde(default)]
    network: Vec<WireNetworkPermission>,
    #[serde(default)]
    game_events: Vec<String>,
    #[serde(default)]
    storage: bool,
    #[serde(default)]
    clipboard_write: bool,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireLocalization {
    default_locale: String,
    available_locales: Vec<String>,
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireFile {
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Listing {
    pub(crate) author: String,
    pub(crate) spdx_license: String,
    pub(crate) source_url: String,
    pub(crate) default_locale: String,
    pub(crate) localizations: Vec<ListingLocalization>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceListing {
    author: String,
    spdx_license: String,
    source_url: String,
    default_locale: String,
    localizations: Vec<ListingLocalization>,
    pub(crate) preview: Option<String>,
}

impl SourceListing {
    // Publication-only fields must never enter the native catalog listing schema.
    pub(crate) fn into_catalog_listing(self) -> Listing {
        Listing {
            author: self.author,
            spdx_license: self.spdx_license,
            source_url: self.source_url,
            default_locale: self.default_locale,
            localizations: self.localizations,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListingLocalization {
    pub(crate) locale: String,
    pub(crate) name: String,
    pub(crate) description: String,
}

pub fn write_package(source: &Path, destination: &Path) -> Result<WrittenPackage, PackageError> {
    let entries = collect_entries(source)?;
    let archive = build_stored_archive(&entries)?;
    inspect_bytes(&archive)?;
    fs::write(destination, &archive).map_err(|_| error("unable to write package"))?;
    Ok(WrittenPackage {
        path: destination.to_path_buf(),
        digest: sha256(&archive),
    })
}

pub fn inspect(path: &Path) -> Result<InspectedManifest, PackageError> {
    let bytes = read_bounded_source(path, MAX_PACKAGE_BYTES, "unable to read package")?;
    inspect_bytes(&bytes)
}

pub fn inspect_bytes(archive: &[u8]) -> Result<InspectedManifest, PackageError> {
    validated_archive(archive).map(|(manifest, _)| manifest)
}

// Returns only a bounded asset from a fully validated package; never extracts paths.
pub(crate) fn validated_asset_bytes(
    archive: &[u8],
    path: &str,
    maximum: u64,
) -> Result<Vec<u8>, PackageError> {
    if !valid_entry_path(path) || path == "manifest.json" {
        return Err(error("invalid asset path"));
    }
    let (_, mut files) = validated_archive(archive)?;
    let bytes = files
        .remove(path)
        .ok_or_else(|| error("missing declared asset"))?;
    if bytes.len() as u64 > maximum {
        return Err(error("asset too large"));
    }
    Ok(bytes)
}

fn validated_archive(
    archive: &[u8],
) -> Result<(InspectedManifest, BTreeMap<String, Vec<u8>>), PackageError> {
    if archive.len() > MAX_PACKAGE_BYTES {
        return Err(error("package too large"));
    }
    let files = parse_stored_zip(archive)?;
    let manifest_bytes = files
        .get("manifest.json")
        .ok_or_else(|| error("missing manifest.json"))?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(error("invalid manifest"));
    }
    let manifest: WireManifest =
        serde_json::from_slice(manifest_bytes).map_err(|_| error("invalid manifest"))?;
    validate_manifest(&manifest, &files)?;
    let inspected = InspectedManifest {
        id: manifest.id,
        version: manifest.version,
        catalog_value: serde_json::from_slice(manifest_bytes)
            .map_err(|_| error("invalid manifest"))?,
    };
    Ok((inspected, files))
}

fn collect_entries(source: &Path) -> Result<BTreeMap<String, Vec<u8>>, PackageError> {
    let manifest_bytes = read_bounded_source(
        &source.join("manifest.json"),
        MAX_MANIFEST_BYTES,
        "missing manifest.json",
    )?;
    let manifest: WireManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| error("invalid manifest"))?;
    validate_declared_size(&manifest)?;
    let listing = validate_listing_source(source)?;
    let mut actual = BTreeSet::new();
    collect_paths(source, "", &mut actual)?;
    let mut expected = BTreeSet::from(["manifest.json".to_owned()]);
    expected.extend(manifest.files.keys().cloned());
    if actual != expected {
        return Err(error("file inventory mismatch"));
    }
    let mut entries = BTreeMap::new();
    for (path, declared) in &manifest.files {
        let maximum = usize::try_from(declared.bytes)
            .ok()
            .filter(|size| *size <= MAX_PACKAGE_BYTES)
            .ok_or_else(|| error("package too large"))?;
        let bytes = read_bounded_source(&source.join(path), maximum, "missing declared file")?;
        if u64::try_from(bytes.len()).ok() != Some(declared.bytes)
            || sha256_hex(&sha256(&bytes)) != declared.sha256
        {
            return Err(error("file inventory mismatch"));
        }
        if native_file(path, &bytes) {
            return Err(error("native files are unsupported"));
        }
        entries.insert(path.clone(), bytes);
    }
    entries.insert("manifest.json".to_owned(), manifest_bytes);
    validate_manifest(&manifest, &entries)?;
    if let Some(path) = listing.preview {
        let bytes = entries
            .get(&path)
            .ok_or_else(|| error("missing declared preview"))?;
        crate::preview::validate_png(bytes).map_err(|_| error("invalid preview PNG"))?;
    }
    Ok(entries)
}

fn read_bounded_source(
    path: &Path,
    maximum: usize,
    message: &'static str,
) -> Result<Vec<u8>, PackageError> {
    let file = open_regular_file(path).map_err(|_| error(message))?;
    read_bounded_file(file, maximum as u64).map_err(|_| error(message))
}

fn validate_listing_source(source: &Path) -> Result<SourceListing, PackageError> {
    let bytes = read_bounded_source(
        &source.join("listing.json"),
        MAX_LISTING_BYTES,
        "invalid listing",
    )?;
    parse_listing_bytes(&bytes)
}

pub(crate) fn parse_listing_bytes(bytes: &[u8]) -> Result<SourceListing, PackageError> {
    if bytes.is_empty() || bytes.len() > MAX_LISTING_BYTES {
        return Err(error("invalid listing"));
    }
    let listing: SourceListing =
        serde_json::from_slice(bytes).map_err(|_| error("invalid listing"))?;
    if !valid_plain_text(&listing.author, 128)
        || !valid_spdx_license(&listing.spdx_license)
        || !valid_source_url(&listing.source_url)
        || !valid_locale(&listing.default_locale)
        || listing.localizations.is_empty()
        || listing.localizations.len() > 16
        || listing
            .preview
            .as_ref()
            .is_some_and(|path| !crate::preview::valid_source_path(path))
    {
        return Err(error("invalid listing"));
    }
    let mut locales = BTreeSet::new();
    for localization in &listing.localizations {
        if !valid_locale(&localization.locale)
            || !locales.insert(localization.locale.as_str())
            || !valid_plain_text(&localization.name, 128)
            || !valid_plain_text(&localization.description, 512)
        {
            return Err(error("invalid listing"));
        }
    }
    if !locales.contains(listing.default_locale.as_str()) {
        return Err(error("invalid listing"));
    }
    Ok(listing)
}

fn collect_paths(
    root: &Path,
    prefix: &str,
    output: &mut BTreeSet<String>,
) -> Result<(), PackageError> {
    let current = if prefix.is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix)
    };
    let mut names = fs::read_dir(&current)
        .map_err(|_| error("unsafe source"))?
        .map(|entry| entry.map_err(|_| error("unsafe source")))
        .collect::<Result<Vec<_>, _>>()?;
    names.sort_by_key(|entry| entry.file_name());
    for entry in names {
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error("unsafe source"))?;
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if !valid_entry_path(&relative) {
            return Err(error("unsafe source"));
        }
        let file_type = entry.file_type().map_err(|_| error("unsafe source"))?;
        if file_type.is_symlink() {
            return Err(error("unsafe source"));
        }
        if relative == "listing.json" && file_type.is_file() {
            continue;
        }
        if file_type.is_dir() {
            collect_paths(root, &relative, output)?;
        } else if file_type.is_file() {
            if output.len() >= MAX_FILES || !output.insert(relative) {
                return Err(error("file inventory mismatch"));
            }
        } else {
            return Err(error("unsafe source"));
        }
    }
    Ok(())
}

fn validate_manifest(
    manifest: &WireManifest,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PackageError> {
    if manifest.schema_version != 1
        || manifest.api_version != "1"
        || !valid_extension_id(&manifest.id)
        || !canonical_semver(&manifest.version)
        || manifest.files.is_empty()
        || manifest.files.len() >= MAX_FILES
    {
        return Err(error("invalid manifest"));
    }
    if !valid_html_entrypoint(&manifest.entrypoints.view)
        || !manifest.files.contains_key(&manifest.entrypoints.view)
        || manifest
            .entrypoints
            .controller
            .as_ref()
            .is_some_and(|path| !valid_html_entrypoint(path) || !manifest.files.contains_key(path))
    {
        return Err(error("invalid manifest"));
    }
    validate_permissions(&manifest.permissions)?;
    if manifest
        .presentation
        .as_ref()
        .is_some_and(|presentation| !presentation.is_valid())
    {
        return Err(error("invalid presentation"));
    }
    if let Some(localization) = &manifest.localization {
        let locales = localization
            .available_locales
            .iter()
            .collect::<BTreeSet<_>>();
        if !(1..=16).contains(&locales.len())
            || locales.len() != localization.available_locales.len()
            || !locales.contains(&localization.default_locale)
            || locales.iter().any(|locale| !valid_locale(locale))
        {
            return Err(error("invalid localization"));
        }
    }
    validate_declared_size(manifest)?;
    let mut declared = BTreeSet::from(["manifest.json".to_owned()]);
    declared.extend(manifest.files.keys().cloned());
    if declared.len() != files.len() || files.keys().any(|path| !declared.contains(path)) {
        return Err(error("file inventory mismatch"));
    }
    let mut portable_paths = BTreeSet::from(["manifest.json".to_owned()]);
    for (path, declared) in &manifest.files {
        let bytes = files
            .get(path)
            .ok_or_else(|| error("file inventory mismatch"))?;
        if !valid_entry_path(path)
            || !portable_paths.insert(path.to_ascii_lowercase())
            || !valid_sha256(&declared.sha256)
            || u64::try_from(bytes.len()).ok() != Some(declared.bytes)
            || sha256_hex(&sha256(bytes)) != declared.sha256
            || native_file(path, bytes)
        {
            return Err(error("file inventory mismatch"));
        }
    }
    Ok(())
}

fn validate_declared_size(manifest: &WireManifest) -> Result<(), PackageError> {
    manifest.files.values().try_fold(0_u64, |total, file| {
        total
            .checked_add(file.bytes)
            .filter(|total| *total <= MAX_PACKAGE_BYTES as u64)
            .ok_or_else(|| error("package too large"))
    })?;
    Ok(())
}

fn native_file(path: &str, contents: &[u8]) -> bool {
    let lower = path.to_ascii_lowercase();
    NATIVE_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix))
        || contents.starts_with(b"\x7fELF")
        || contents.starts_with(b"MZ")
}

pub(crate) fn valid_entry_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_FILE_PATH_BYTES
        && path.is_ascii()
        && !path.starts_with('/')
        && !path.contains('\\')
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && !matches!(segment, "." | "..")
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn valid_html_entrypoint(path: &str) -> bool {
    valid_entry_path(path) && path.ends_with(".html")
}

pub(crate) fn valid_extension_id(value: &str) -> bool {
    (3..=128).contains(&value.len())
        && value.is_ascii()
        && value.split('.').count() >= 2
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment.len() <= 63
                && !segment.starts_with('-')
                && !segment.ends_with('-')
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

pub(crate) fn canonical_semver(value: &str) -> bool {
    Version::parse(value).is_ok_and(|version| version.to_string() == value)
}

fn validate_permissions(permissions: &WirePermissions) -> Result<(), PackageError> {
    if permissions.network.len() > 32
        || !manifest_contract::valid_capabilities(
            &permissions.capabilities,
            !permissions.network.is_empty() || permissions.clipboard_write,
        )
    {
        return Err(error("invalid permissions"));
    }
    let mut network = BTreeSet::new();
    for permission in &permissions.network {
        if !valid_https_origin(&permission.origin)
            || !permission.is_valid()
            || !network.insert(permission)
        {
            return Err(error("invalid permissions"));
        }
    }
    let mut events = BTreeSet::new();
    if permissions
        .game_events
        .iter()
        .any(|event| !valid_game_event_id(event) || !events.insert(event.as_str()))
    {
        return Err(error("invalid permissions"));
    }
    let _ = (permissions.storage, permissions.clipboard_write);
    Ok(())
}

fn valid_https_origin(value: &str) -> bool {
    let Some(authority) = value.strip_prefix("https://") else {
        return false;
    };
    if authority.is_empty()
        || authority
            .bytes()
            .any(|byte| matches!(byte, b'/' | b'?' | b'#' | b'@'))
    {
        return false;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    // URL parsers interpret a numeric final label as an IPv4 address, including
    // shortened, octal, and hexadecimal forms. Only DNS origins are admitted.
    let last_label = host.rsplit('.').next().unwrap_or_default();
    let numeric_host = last_label.bytes().all(|byte| byte.is_ascii_digit())
        || last_label
            .strip_prefix("0x")
            .is_some_and(|digits| digits.bytes().all(|byte| byte.is_ascii_hexdigit()));
    if !valid_dns_host(host) || numeric_host {
        return false;
    }
    port.is_none_or(|port| {
        !port.is_empty()
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && port
                .parse::<u16>()
                .is_ok_and(|parsed| parsed != 443 && parsed.to_string() == port)
    })
}

fn valid_dns_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.is_ascii()
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
}

fn valid_game_event_id(value: &str) -> bool {
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

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_locale(value: &str) -> bool {
    match value.split_once('-') {
        None => value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_lowercase()),
        Some((language, region)) => {
            language.len() == 2
                && language.bytes().all(|byte| byte.is_ascii_lowercase())
                && region.len() == 2
                && region.bytes().all(|byte| byte.is_ascii_uppercase())
        }
    }
}

fn valid_plain_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.trim() == value
        && !value.contains(['<', '>'])
        && !value.chars().any(char::is_control)
}

fn valid_spdx_license(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.is_ascii()
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
}

fn valid_source_url(value: &str) -> bool {
    if value.len() > 2_048
        || !value.is_ascii()
        || value.contains(['\\', '%', '?', '#', '@'])
        || value.ends_with('/')
    {
        return false;
    }
    let Some(rest) = value.strip_prefix("https://") else {
        return false;
    };
    let Some((host, path)) = rest.split_once('/') else {
        return false;
    };
    valid_dns_host(host)
        && !path.is_empty()
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && !matches!(segment, "." | ".."))
}

fn deserialize_unique_file_map<'de, D>(
    deserializer: D,
) -> Result<BTreeMap<String, WireFile>, D::Error>
where
    D: Deserializer<'de>,
{
    struct FileMapVisitor;

    impl<'de> de::Visitor<'de> for FileMapVisitor {
        type Value = BTreeMap<String, WireFile>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a unique, bounded web file map")
        }

        fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: de::MapAccess<'de>,
        {
            let mut files = BTreeMap::new();
            while let Some((path, file)) = map.next_entry()? {
                if files.len() >= MAX_FILES - 1 {
                    return Err(de::Error::custom("web package file limit exceeded"));
                }
                if files.insert(path, file).is_some() {
                    return Err(de::Error::custom("duplicate web package path"));
                }
            }
            Ok(files)
        }
    }

    deserializer.deserialize_map(FileMapVisitor)
}

fn build_stored_archive(entries: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, PackageError> {
    if entries.is_empty() || entries.len() > MAX_FILES {
        return Err(error("package too large"));
    }
    let mut archive = Vec::new();
    let mut records = Vec::with_capacity(entries.len());
    for (path, bytes) in entries {
        let offset = u32::try_from(archive.len()).map_err(|_| error("package too large"))?;
        let size = u32::try_from(bytes.len()).map_err(|_| error("package too large"))?;
        let checksum = crc32fast::hash(bytes);
        push_u32(&mut archive, 0x0403_4b50);
        push_u16(&mut archive, 20);
        push_u16(&mut archive, UTF8_FLAG);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, DOS_DATE_1980_01_01);
        push_u32(&mut archive, checksum);
        push_u32(&mut archive, size);
        push_u32(&mut archive, size);
        push_u16(
            &mut archive,
            u16::try_from(path.len()).map_err(|_| error("invalid manifest"))?,
        );
        push_u16(&mut archive, 0);
        archive.extend_from_slice(path.as_bytes());
        archive.extend_from_slice(bytes);
        records.push((path, size, checksum, offset));
        if archive.len() > MAX_PACKAGE_BYTES {
            return Err(error("package too large"));
        }
    }
    let central_offset = u32::try_from(archive.len()).map_err(|_| error("package too large"))?;
    for (path, size, checksum, offset) in records {
        push_u32(&mut archive, 0x0201_4b50);
        push_u16(&mut archive, (3 << 8) | 20);
        push_u16(&mut archive, 20);
        push_u16(&mut archive, UTF8_FLAG);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, DOS_DATE_1980_01_01);
        push_u32(&mut archive, checksum);
        push_u32(&mut archive, size);
        push_u32(&mut archive, size);
        push_u16(
            &mut archive,
            u16::try_from(path.len()).map_err(|_| error("invalid manifest"))?,
        );
        for _ in 0..4 {
            push_u16(&mut archive, 0);
        }
        push_u32(&mut archive, REGULAR_MODE << 16);
        push_u32(&mut archive, offset);
        archive.extend_from_slice(path.as_bytes());
    }
    let central_size = u32::try_from(archive.len())
        .ok()
        .and_then(|end| end.checked_sub(central_offset))
        .ok_or_else(|| error("package too large"))?;
    let count = u16::try_from(entries.len()).map_err(|_| error("package too large"))?;
    push_u32(&mut archive, 0x0605_4b50);
    push_u16(&mut archive, 0);
    push_u16(&mut archive, 0);
    push_u16(&mut archive, count);
    push_u16(&mut archive, count);
    push_u32(&mut archive, central_size);
    push_u32(&mut archive, central_offset);
    push_u16(&mut archive, 0);
    if archive.len() > MAX_PACKAGE_BYTES {
        return Err(error("package too large"));
    }
    Ok(archive)
}

fn parse_stored_zip(archive: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, PackageError> {
    inspect_bytes_via_writer_roundtrip(archive)
}

fn inspect_bytes_via_writer_roundtrip(
    archive: &[u8],
) -> Result<BTreeMap<String, Vec<u8>>, PackageError> {
    if archive.len() < 22 {
        return Err(error("invalid package"));
    }
    let end = archive.len() - 22;
    if read_u32(archive, end)? != 0x0605_4b50 {
        return Err(error("invalid package"));
    }
    let count = usize::from(read_u16(archive, end + 10)?);
    let central_size = read_u32(archive, end + 12)? as usize;
    let central_offset = read_u32(archive, end + 16)? as usize;
    if central_offset.checked_add(central_size) != Some(end) || count > MAX_FILES {
        return Err(error("invalid package"));
    }
    let mut files = BTreeMap::new();
    let mut position = central_offset;
    for _ in 0..count {
        if read_u32(archive, position)? != 0x0201_4b50 {
            return Err(error("invalid package"));
        }
        let method = read_u16(archive, position + 10)?;
        if method != 0 {
            return Err(error("compressed packages are unsupported"));
        }
        let name_length = usize::from(read_u16(archive, position + 28)?);
        let size = read_u32(archive, position + 24)? as usize;
        let local_offset = read_u32(archive, position + 42)? as usize;
        let name = std::str::from_utf8(
            archive
                .get(position + 46..position + 46 + name_length)
                .ok_or_else(|| error("invalid package"))?,
        )
        .map_err(|_| error("invalid package"))?
        .to_owned();
        if !valid_entry_path(&name) {
            return Err(error("invalid package"));
        }
        let data_start = local_offset
            .checked_add(30)
            .and_then(|offset| offset.checked_add(name_length))
            .ok_or_else(|| error("invalid package"))?;
        let data = archive
            .get(data_start..data_start + size)
            .ok_or_else(|| error("invalid package"))?
            .to_vec();
        if native_file(&name, &data) && name != "manifest.json" {
            return Err(error("native files are unsupported"));
        }
        if files.insert(name, data).is_some() {
            return Err(error("duplicate package path"));
        }
        position = position
            .checked_add(46 + name_length)
            .ok_or_else(|| error("invalid package"))?;
    }
    Ok(files)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, PackageError> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| error("invalid package"))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, PackageError> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| error("invalid package"))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn sha256_hex(digest: &[u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
fn file_sha256_hex(bytes: &[u8]) -> String {
    sha256_hex(&sha256(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    const VIEW: &[u8] = b"<!doctype html><p>hello</p>";

    #[test]
    fn package_rejects_invalid_critical_png_chunks_after_pixel_data() {
        let png = crate::test_png::png(2, 1);
        let mut accepted = Vec::new();
        for kind in [
            "unknown-critical",
            "duplicate-header",
            "late-palette",
            "duplicate-palette",
            "separated-data",
        ] {
            let trailer = match kind {
                "unknown-critical" => crate::test_png::chunk(b"EVIL", b""),
                "duplicate-header" => crate::test_png::chunk(b"IHDR", &png[16..29]),
                "late-palette" | "duplicate-palette" => {
                    crate::test_png::chunk(b"PLTE", &[255, 0, 0])
                }
                _ => [
                    crate::test_png::chunk(b"tEXt", b"Comment\0tail"),
                    crate::test_png::chunk(b"IDAT", b""),
                ]
                .concat(),
            };
            let mut malformed = png.clone();
            if kind == "duplicate-palette" {
                malformed.splice(33..33, crate::test_png::chunk(b"PLTE", &[255, 0, 0]));
            }
            malformed.splice(malformed.len() - 12..malformed.len() - 12, trailer);
            let source = fixture(&[("index.html", VIEW), ("preview.png", &malformed)]);
            set_preview(source.path(), "preview.png");
            let output = tempfile::tempdir().unwrap();
            let archive = output.path().join("rejected.ocpkg");
            if write_package(source.path(), &archive).is_ok() {
                accepted.push(kind);
            } else {
                assert!(!archive.exists(), "{kind}");
            }
        }
        assert!(
            accepted.is_empty(),
            "malformed PNGs were accepted: {accepted:?}"
        );
    }

    #[test]
    fn package_preserves_valid_ancillary_png_chunks_after_pixel_data() {
        for kind in [b"tEXt", b"paDd"] {
            let mut png = crate::test_png::png(2, 1);
            png.splice(
                png.len() - 12..png.len() - 12,
                crate::test_png::chunk(kind, b"Comment\0tail"),
            );
            let source = fixture(&[("index.html", VIEW), ("preview.png", &png)]);
            set_preview(source.path(), "preview.png");
            let output = tempfile::tempdir().unwrap();
            let archive = output.path().join("valid.ocpkg");
            write_package(source.path(), &archive).expect("valid ancillary tail");
            assert_eq!(
                parse_stored_zip(&fs::read(archive).unwrap()).unwrap()["preview.png"],
                png
            );
        }
    }

    #[test]
    fn package_accepts_legal_palette_and_consecutive_png_data_chunks() {
        let mut png = crate::test_png::png(2, 1);
        png.splice(33..33, crate::test_png::chunk(b"PLTE", &[255, 0, 0]));
        png.splice(
            png.len() - 12..png.len() - 12,
            crate::test_png::chunk(b"IDAT", b""),
        );
        let source = fixture(&[("index.html", VIEW), ("preview.png", &png)]);
        set_preview(source.path(), "preview.png");
        let output = tempfile::tempdir().unwrap();
        write_package(source.path(), &output.path().join("valid.ocpkg"))
            .expect("optional palette before consecutive image data");
    }

    #[test]
    fn package_rejects_missing_undeclared_and_invalid_preview_content() {
        let png = crate::test_png::png(2, 1);
        for kind in [
            "missing",
            "undeclared",
            "malformed",
            "svg",
            "oversize",
            "wide",
            "tall",
            "truncated",
            "crc",
            "animated",
            "decode",
        ] {
            let mut contents = png.clone();
            match kind {
                "malformed" => contents = b"not a PNG".to_vec(),
                "svg" => contents = b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
                "oversize" => contents.resize(256 * 1024 + 1, 0),
                "wide" => contents = crate::test_png::png(1025, 1),
                "tall" => contents = crate::test_png::png(1, 1025),
                "truncated" => {
                    contents.truncate(contents.len() - 12);
                }
                "crc" => contents[29] ^= 1,
                "animated" => {
                    contents.splice(
                        33..33,
                        crate::test_png::chunk(b"acTL", &[0, 0, 0, 1, 0, 0, 0, 0]),
                    );
                }
                "decode" => {
                    contents.truncate(33);
                    contents.extend(crate::test_png::chunk(
                        b"IDAT",
                        b"invalid compressed pixels",
                    ));
                    contents.extend(crate::test_png::chunk(b"IEND", b""));
                }
                _ => {}
            }
            let source = if matches!(kind, "missing" | "undeclared") {
                fixture(&[("index.html", VIEW)])
            } else {
                fixture(&[("index.html", VIEW), ("preview.png", &contents)])
            };
            if kind == "undeclared" {
                fs::write(source.path().join("preview.png"), &contents).unwrap();
            }
            set_preview(source.path(), "preview.png");
            let output = tempfile::tempdir().unwrap();
            let archive = output.path().join("rejected.ocpkg");
            assert!(write_package(source.path(), &archive).is_err(), "{kind}");
            assert!(!archive.exists(), "{kind}");
        }
    }

    #[test]
    fn package_rejects_unsafe_preview_paths_and_symlinks() {
        for path in [
            "../preview.png",
            "/preview.png",
            "images/../preview.png",
            "images\\preview.png",
            "https://example.test/a.png",
            "preview.svg",
            "images//preview.png",
            "preview.png?x=1",
        ] {
            let source = fixture(&[("index.html", VIEW)]);
            set_preview(source.path(), path);
            let output = tempfile::tempdir().unwrap();
            assert!(
                write_package(source.path(), &output.path().join("x.ocpkg")).is_err(),
                "{path}"
            );
        }
        let png = crate::test_png::png(1, 1);
        let source = fixture(&[("index.html", VIEW), ("preview.png", &png)]);
        set_preview(source.path(), "preview.png");
        let external = tempfile::NamedTempFile::new().unwrap();
        fs::write(external.path(), png).unwrap();
        fs::remove_file(source.path().join("preview.png")).unwrap();
        std::os::unix::fs::symlink(external.path(), source.path().join("preview.png")).unwrap();
        let output = tempfile::tempdir().unwrap();
        assert!(write_package(source.path(), &output.path().join("x.ocpkg")).is_err());
    }

    #[test]
    fn package_accepts_maximum_preview_dimensions_and_does_not_infer_preview_names() {
        let png = crate::test_png::png(1024, 1024);
        let source = fixture(&[("index.html", VIEW), ("preview.png", &png)]);
        set_preview(source.path(), "preview.png");
        let output = tempfile::tempdir().unwrap();
        write_package(source.path(), &output.path().join("max.ocpkg")).unwrap();
        let unselected = fixture(&[
            ("index.html", VIEW),
            ("preview.png", b"opaque unused asset"),
        ]);
        write_package(unselected.path(), &output.path().join("unselected.ocpkg")).unwrap();
    }

    #[test]
    fn package_accepts_a_png_at_the_exact_encoded_byte_limit() {
        let mut png = crate::test_png::png(1, 1);
        let padding = vec![b'x'; 256 * 1024 - png.len() - 12];
        png.splice(
            png.len() - 12..png.len() - 12,
            crate::test_png::chunk(b"paDd", &padding),
        );
        assert_eq!(png.len(), 262144);
        let source = fixture(&[("index.html", VIEW), ("preview.png", &png)]);
        set_preview(source.path(), "preview.png");
        let output = tempfile::tempdir().unwrap();
        write_package(source.path(), &output.path().join("limit.ocpkg")).unwrap();
    }

    fn set_preview(source: &Path, preview: &str) {
        let path = source.join("listing.json");
        let mut listing: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        listing["preview"] = serde_json::json!(preview);
        fs::write(path, serde_json::to_vec(&listing).unwrap()).unwrap();
    }

    #[test]
    fn package_accepts_explicit_root_and_nested_png_previews_without_packaging_the_listing() {
        use base64::Engine as _;
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=").unwrap();
        for path in ["preview.png", "images/screenshot.png"] {
            let source = fixture(&[("index.html", VIEW), (path, &png)]);
            let listing_path = source.path().join("listing.json");
            let mut listing: serde_json::Value =
                serde_json::from_slice(&fs::read(&listing_path).unwrap()).unwrap();
            listing["preview"] = serde_json::json!(path);
            fs::write(&listing_path, serde_json::to_vec(&listing).unwrap()).unwrap();
            let output = tempfile::tempdir().unwrap();
            let archive = output.path().join("preview.ocpkg");
            write_package(source.path(), &archive).expect("explicit, declared PNG preview");
            let files = parse_stored_zip(&fs::read(&archive).unwrap()).unwrap();
            assert_eq!(files[path], png);
            assert!(!files.contains_key("listing.json"));
            let manifest = inspect(&archive).unwrap();
            assert!(manifest.catalog_value.get("preview").is_none());
        }
    }

    #[test]
    fn package_rejects_oversized_ledger_before_reading_assets() {
        let source = fixture(&[("index.html", VIEW), ("extra.bin", b"asset")]);
        mutate_manifest(source.path(), |manifest| {
            manifest["files"]["index.html"]["bytes"] = serde_json::json!(MAX_PACKAGE_BYTES);
            manifest["files"]["extra.bin"]["bytes"] = serde_json::json!(1);
        });
        // The impossible aggregate is rejected from the ledger, before touching
        // payloads that would otherwise fail their declared length/digest checks.
        let output = tempfile::tempdir().unwrap();
        let package = output.path().join("x.ocpkg");
        let rejection = write_package(source.path(), &package).unwrap_err();
        assert_eq!(rejection.message, "package too large");
        assert!(!package.exists());
    }

    #[test]
    fn inspect_rejects_symlink_packages() {
        let source = fixture(&[("index.html", VIEW)]);
        let output = tempfile::tempdir().unwrap();
        let package = output.path().join("real.ocpkg");
        write_package(source.path(), &package).unwrap();
        let link = output.path().join("link.ocpkg");
        std::os::unix::fs::symlink(package, &link).unwrap();
        assert!(inspect(&link).is_err());
    }

    #[test]
    fn package_rejects_undeclared_nested_listing_entries() {
        for kind in ["file", "directory", "symlink"] {
            let source = fixture(&[("index.html", VIEW)]);
            fs::create_dir(source.path().join("nested")).unwrap();
            let hidden = source.path().join("nested/listing.json");
            match kind {
                "directory" => {
                    fs::create_dir(&hidden).unwrap();
                    fs::write(hidden.join("hidden.bin"), b"undeclared").unwrap();
                }
                "symlink" => {
                    std::os::unix::fs::symlink(source.path().join("index.html"), hidden).unwrap();
                }
                _ => fs::write(hidden, b"undeclared").unwrap(),
            }
            let output = tempfile::tempdir().unwrap();
            assert!(write_package(source.path(), &output.path().join("x.ocpkg")).is_err());
        }
    }

    #[test]
    fn package_includes_declared_nested_listing_files() {
        let source = fixture(&[("index.html", VIEW), ("nested/listing.json", b"declared")]);
        let output = tempfile::tempdir().unwrap();
        let package = output.path().join("x.ocpkg");
        write_package(source.path(), &package).expect("declared nested listing is an asset");
        let bytes = fs::read(package).unwrap();
        let entries = parse_stored_zip(&bytes).unwrap();
        assert_eq!(entries.get("nested/listing.json").unwrap(), b"declared");
    }

    #[test]
    fn package_is_deterministic_and_inspectable() {
        let source = fixture(&[("index.html", VIEW)]);
        let first_dir = tempfile::tempdir().unwrap();
        let second_dir = tempfile::tempdir().unwrap();
        let first = first_dir.path().join("a.ocpkg");
        let second = second_dir.path().join("b.ocpkg");
        let written = write_package(source.path(), &first).unwrap();
        write_package(source.path(), &second).unwrap();
        assert_eq!(fs::read(&first).unwrap(), fs::read(&second).unwrap());
        let inspected = inspect(&first).unwrap();
        assert_eq!(inspected.id, "com.example.hello");
        assert_eq!(written.digest, sha256(&fs::read(&first).unwrap()));
    }

    #[test]
    fn package_accepts_browser_and_opaque_assets_but_rejects_undeclared_or_native_files() {
        let extra = fixture(&[("index.html", VIEW)]);
        fs::write(extra.path().join("extra.js"), b"no").unwrap();
        assert!(write_package(extra.path(), &extra.path().join("x.ocpkg")).is_err());

        let web = fixture(&[
            ("index.html", VIEW),
            ("module.wasm", b"\0asm\x01\0\0\0"),
            ("catalog.bin", b"opaque browser data"),
            ("font.woff", b"browser font fixture"),
            ("photo.jpg", b"browser image fixture"),
        ]);
        let web_directory = tempfile::tempdir().unwrap();
        let web_output = web_directory.path().join("x.ocpkg");
        write_package(web.path(), &web_output).expect("web asset package");

        let native = fixture(&[("index.html", VIEW), ("module.so", b"\x7fELF")]);
        assert!(write_package(native.path(), &native.path().join("x.ocpkg")).is_err());
    }

    #[test]
    fn package_roundtrips_capabilities_and_native_presentation() {
        let source = fixture(&[("index.html", VIEW)]);
        mutate_manifest(source.path(), |manifest| {
            manifest["apiVersion"] = serde_json::json!("1");
            manifest["permissions"] =
                serde_json::json!({"capabilities":["media.read"],"storage":true});
            manifest["presentation"] = native_presentation();
            manifest["localization"] =
                serde_json::json!({"defaultLocale":"en","availableLocales":["en","fr"]});
        });
        let output = tempfile::tempdir().unwrap();
        let archive = output.path().join("services.ocpkg");
        write_package(source.path(), &archive).expect("widget package with bounded presentation");
        let inspected = inspect(&archive).expect("widget package inspection");
        assert_eq!(inspected.catalog_value["apiVersion"], "1");
        assert_eq!(
            inspected.catalog_value["presentation"],
            native_presentation()
        );
        assert_eq!(
            inspected.catalog_value["permissions"]["capabilities"],
            serde_json::json!(["media.read"])
        );
    }

    fn native_presentation() -> serde_json::Value {
        serde_json::json!({"sizing":{"fitToContent":"height","preferred":{"width":360,"height":240},"min":{"width":80,"height":24},"max":{"width":1600,"height":1200}},"options":[
            {"id":"showArtist","type":"boolean","label":{"en":"Show artist","fr":"Afficher l’artiste"},"default":true},
            {"id":"theme","type":"enum","label":{"en":"Theme","fr":"Thème"},"default":"dark","choices":[{"value":"dark","label":{"en":"Dark","fr":"Sombre"}},{"value":"light","label":{"en":"Light","fr":"Clair"}}]},
            {"id":"fontSize","type":"number","label":{"en":"Font size","fr":"Taille du texte"},"default":14.5,"min":8,"max":48,"step":0.5}
        ]})
    }

    fn service_manifest() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion":1,"id":"com.example.services","version":"1.0.0","apiVersion":"1",
            "entrypoints":{"view":"index.html"},"permissions":{},
            "files":{"index.html":{"sha256":file_sha256_hex(VIEW),"bytes":VIEW.len()}}
        })
    }

    fn accepts_manifest(value: &serde_json::Value) -> bool {
        let bytes = serde_json::to_vec(value).unwrap();
        let Ok(manifest) = serde_json::from_slice::<WireManifest>(&bytes) else {
            return false;
        };
        validate_manifest(
            &manifest,
            &BTreeMap::from([
                ("manifest.json".to_owned(), bytes),
                ("index.html".to_owned(), VIEW.to_vec()),
            ]),
        )
        .is_ok()
    }

    #[test]
    fn package_capabilities_reject_unknown_duplicate_and_sensitive_egress() {
        for capability in ["telemetry.read", "fps.read", "media.read", "media.control"] {
            let mut value = service_manifest();
            value["permissions"]["capabilities"] = serde_json::json!([capability]);
            assert!(
                accepts_manifest(&value),
                "supported capability {capability}"
            );
            let sensitive = !["telemetry.read", "fps.read"].contains(&capability);
            value["permissions"]["network"] = serde_json::json!([{"origin":"https://api.example.test","method":"GET","path":"/v2/items"}]);
            assert_eq!(
                accepts_manifest(&value),
                !sensitive,
                "network with {capability}"
            );
            value["permissions"]["network"] = serde_json::json!([]);
            value["permissions"]["clipboardWrite"] = serde_json::json!(true);
            assert_eq!(
                accepts_manifest(&value),
                !sensitive,
                "clipboard with {capability}"
            );
        }
        for capabilities in [
            serde_json::json!(["native.shell"]),
            serde_json::json!(["media.read", "media.read"]),
            serde_json::json!(null),
        ] {
            let mut value = service_manifest();
            value["permissions"]["capabilities"] = capabilities;
            assert!(!accepts_manifest(&value));
        }
        for api_version in [
            serde_json::json!("2"),
            serde_json::json!("3"),
            serde_json::json!(1),
            serde_json::json!(null),
        ] {
            let mut value = service_manifest();
            value["apiVersion"] = api_version;
            assert!(!accepts_manifest(&value));
        }
    }

    #[test]
    fn package_presentation_rejects_unsafe_and_unbounded_fields() {
        for capability in [
            serde_json::json!(false),
            serde_json::json!("both"),
            serde_json::json!("height"),
        ] {
            for default_mode in [None, Some("manual"), Some("fit")] {
                let mut value = service_manifest();
                value["presentation"] = native_presentation();
                value["presentation"]["sizing"]["fitToContent"] = capability.clone();
                if let Some(mode) = default_mode {
                    value["presentation"]["sizing"]["defaultMode"] = serde_json::json!(mode);
                }
                assert_eq!(
                    accepts_manifest(&value),
                    capability != serde_json::json!(false) || default_mode != Some("fit")
                );
            }
        }
        for invalid in [
            serde_json::json!(true),
            serde_json::json!(null),
            serde_json::json!(0),
            serde_json::json!("intrinsic"),
            serde_json::json!("autoHeight"),
            serde_json::json!("manual"),
        ] {
            let mut value = service_manifest();
            value["presentation"] = native_presentation();
            value["presentation"]["sizing"]["fitToContent"] = invalid;
            assert!(!accepts_manifest(&value));
        }
        for invalid in [
            serde_json::json!(null),
            serde_json::json!(false),
            serde_json::json!("both"),
            serde_json::json!("intrinsic"),
            serde_json::json!("autoHeight"),
        ] {
            let mut value = service_manifest();
            value["presentation"] = native_presentation();
            value["presentation"]["sizing"]["defaultMode"] = invalid;
            assert!(!accepts_manifest(&value));
        }
        for mode in ["intrinsic", "autoHeight", "manual"] {
            let mut value = service_manifest();
            value["presentation"] = native_presentation();
            value["presentation"]["sizing"]["mode"] = serde_json::json!(mode);
            assert!(!accepts_manifest(&value));
        }
        let mut value = service_manifest();
        value["presentation"] = native_presentation();
        value["presentation"]["sizing"]
            .as_object_mut()
            .unwrap()
            .remove("fitToContent");
        assert!(!accepts_manifest(&value));
        for (pointer, replacement) in [
            ("/presentation", serde_json::json!(null)),
            (
                "/presentation/sizing/fitToContent",
                serde_json::json!("free"),
            ),
            ("/presentation/sizing/min/width", serde_json::json!(361)),
            (
                "/presentation/sizing/preferred/height",
                serde_json::json!(0),
            ),
            ("/presentation/sizing/max/width", serde_json::json!(4097)),
            ("/presentation/options/0/id", serde_json::json!("__proto__")),
            ("/presentation/options/0/label/en", serde_json::json!(" ")),
            (
                "/presentation/options/0/label/fr",
                serde_json::json!("x".repeat(81)),
            ),
            ("/presentation/options/0/default", serde_json::json!(1)),
            (
                "/presentation/options/1/default",
                serde_json::json!("missing"),
            ),
            (
                "/presentation/options/1/choices/1/value",
                serde_json::json!("dark"),
            ),
            ("/presentation/options/2/default", serde_json::json!(49)),
            ("/presentation/options/2/min", serde_json::json!(-1_000_001)),
            ("/presentation/options/2/max", serde_json::json!(1_000_001)),
            ("/presentation/options/2/step", serde_json::json!(0)),
            ("/presentation/options/2/step", serde_json::json!(41)),
        ] {
            let mut value = service_manifest();
            value["presentation"] = native_presentation();
            *value.pointer_mut(pointer).unwrap() = replacement;
            assert!(!accepts_manifest(&value), "accepted {pointer}");
        }
        for pointer in [
            "/presentation",
            "/presentation/sizing",
            "/presentation/sizing/min",
            "/presentation/options/0",
            "/presentation/options/0/label",
            "/presentation/options/1/choices/0",
        ] {
            let mut value = service_manifest();
            value["presentation"] = native_presentation();
            value.pointer_mut(pointer).unwrap()["setValue"] = serde_json::json!(true);
            assert!(!accepts_manifest(&value), "unknown field at {pointer}");
        }
    }

    #[test]
    fn package_rejects_manifest_shapes_the_runtime_would_reject() {
        let mutations: [fn(&mut serde_json::Value); 4] = [
            |manifest: &mut serde_json::Value| manifest["version"] = serde_json::json!("latest"),
            |manifest: &mut serde_json::Value| {
                manifest["entrypoints"]["controller"] = serde_json::json!("missing.html")
            },
            |manifest: &mut serde_json::Value| {
                manifest["permissions"] = serde_json::json!({
                    "network": [{
                        "origin": "http://api.example.test",
                        "method": "GET",
                        "path": "/"
                    }]
                });
            },
            |manifest: &mut serde_json::Value| manifest["nativeCommand"] = serde_json::json!("id"),
        ];
        for mutation in mutations {
            let source = fixture(&[("index.html", VIEW)]);
            mutate_manifest(source.path(), mutation);
            let output_directory = tempfile::tempdir().unwrap();
            let output = output_directory.path().join("x.ocpkg");
            assert!(write_package(source.path(), &output).is_err());
        }
    }

    #[test]
    fn package_rejects_listing_metadata_the_catalog_would_reject() {
        let source = fixture(&[("index.html", VIEW)]);
        let listing_path = source.path().join("listing.json");
        let mut listing: serde_json::Value =
            serde_json::from_slice(&fs::read(&listing_path).unwrap()).unwrap();
        listing["sourceUrl"] = serde_json::json!("http://example.test/source");
        fs::write(&listing_path, serde_json::to_vec(&listing).unwrap()).unwrap();
        let output_directory = tempfile::tempdir().unwrap();

        assert!(write_package(source.path(), &output_directory.path().join("x.ocpkg")).is_err());
    }

    struct Fixture {
        directory: tempfile::TempDir,
    }

    impl Fixture {
        fn path(&self) -> &Path {
            self.directory.path()
        }
    }

    fn fixture(files: &[(&str, &[u8])]) -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let mut ledger = serde_json::Map::new();
        for (path, bytes) in files {
            let dest = directory.path().join(path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&dest, bytes).unwrap();
            ledger.insert(
                (*path).to_owned(),
                serde_json::json!({"sha256": file_sha256_hex(bytes), "bytes": bytes.len()}),
            );
        }
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "id": "com.example.hello",
            "version": "1.0.0",
            "apiVersion": "1",
            "entrypoints": {"view": "index.html"},
            "permissions": {},
            "files": ledger
        });
        fs::write(
            directory.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            directory.path().join("listing.json"),
            serde_json::to_vec(&serde_json::json!({
                "author": "Example",
                "spdxLicense": "MIT",
                "sourceUrl": "https://example.test/source",
                "defaultLocale": "en",
                "localizations": [{
                    "locale": "en",
                    "name": "Hello",
                    "description": "Test extension"
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        Fixture { directory }
    }

    fn mutate_manifest(path: &Path, mutation: fn(&mut serde_json::Value)) {
        let manifest_path = path.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        mutation(&mut manifest);
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    }
}
