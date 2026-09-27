//! `.ocpkg` v1 (ADR 0001, D9; P0.5): a deterministic stored zip holding a
//! closed set of files and their SHA-256 ledger.
//!
//! [`read_package`] is the single reader of the host, the CLI and the Studio.
//! It accepts exactly the bytes [`write_package`] produces for the same
//! files: one archive per content, so the archive digest identifies it.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::ops::Range;

use sha2::{Digest, Sha256};

use crate::compiled_view::{ViewError, validate_compiled_view};
use crate::json::parse_strict;
use crate::limits::{
    MAX_ASSET_PATH_SEGMENTS, MAX_COMPILED_VIEW_BYTES, MAX_IMAGE_ENCODED_BYTES, MAX_LEDGER_BYTES,
    MAX_LICENSE_BYTES, MAX_LOCALE_ENTRIES, MAX_LOCALE_FILE_BYTES, MAX_LOCALE_KEY_BYTES,
    MAX_LOCALE_VALUE_BYTES, MAX_LOGIC_BYTES, MAX_MANIFEST_BYTES, MAX_PACKAGE_BYTES,
    MAX_PACKAGE_FILES, MAX_PACKAGE_PATH_BYTES, MAX_STYLE_SOURCE_BYTES,
};
use crate::manifest::{Manifest, ManifestError, validate_manifest};

pub const MANIFEST_PATH: &str = "manifest.json";
pub const LEDGER_PATH: &str = "ledger.json";
pub const LEDGER_VERSION: u64 = 1;

/// One class of archive entry. Anything that matches no class is rejected;
/// in particular `view.ocml`, `.wasm`, `.html`, other scripts and native code.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FileClass {
    pub path: &'static str,
    pub required: bool,
    pub limit: &'static crate::Limit,
    pub summary: &'static str,
}

pub const FILE_CLASSES: &[FileClass] = &[
    FileClass {
        path: "manifest.json",
        required: true,
        limit: &MAX_MANIFEST_BYTES,
        summary: "Manifest v1, as authored.",
    },
    FileClass {
        path: "ledger.json",
        required: true,
        limit: &MAX_LEDGER_BYTES,
        summary: "Canonical SHA-256 and byte ledger of every other entry, written by the CLI.",
    },
    FileClass {
        path: "logic.js",
        required: true,
        limit: &MAX_LOGIC_BYTES,
        summary: "The only executable content: one ES2023 script without imports, compiled template expressions included. UTF-8, not empty.",
    },
    FileClass {
        path: "view.json",
        required: true,
        limit: &MAX_COMPILED_VIEW_BYTES,
        summary: "Compiled view. The `view.ocml` source is not shipped.",
    },
    FileClass {
        path: "style.ocss",
        required: false,
        limit: &MAX_STYLE_SOURCE_BYTES,
        summary: "Style sheet source, parsed by the host at activation. UTF-8.",
    },
    FileClass {
        path: "locales/en.json",
        required: false,
        limit: &MAX_LOCALE_FILE_BYTES,
        summary: "English messages; present if and only if `locales/fr.json` is, with the same keys.",
    },
    FileClass {
        path: "locales/fr.json",
        required: false,
        limit: &MAX_LOCALE_FILE_BYTES,
        summary: "French messages.",
    },
    FileClass {
        path: "LICENSE",
        required: true,
        limit: &MAX_LICENSE_BYTES,
        summary: "License text of the package. UTF-8, not empty.",
    },
    FileClass {
        path: "assets/<path>.{png,jpg,jpeg,webp}",
        required: false,
        limit: &MAX_IMAGE_ENCODED_BYTES,
        summary: "Images whose signature matches the extension; lowercase `[a-z0-9_-]` segments, at most `MAX_ASSET_PATH_SEGMENTS` below `assets/`.",
    },
];

/// Fixed reasons a package is rejected. `Manifest` and `View` keep the inner
/// reason for diagnostics; none carries package content.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PackageError {
    ArchiveSize,
    /// Not the pinned stored-zip layout (headers, offsets, directory, trailer).
    ArchiveFormat,
    EntryLimit,
    /// Deflate or any method other than stored.
    Compression,
    Encryption,
    /// Header fields other than the pinned values, or a CRC mismatch.
    EntryMetadata,
    /// Entries not in strictly increasing byte order of their paths.
    EntryOrder,
    UnsafePath,
    UnexpectedFile,
    MissingFile,
    FileSize,
    Ledger,
    Manifest(ManifestError),
    View(ViewError),
    Logic,
    Style,
    Locales,
    License,
    Asset,
}

impl PackageError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ArchiveSize => "archive_size",
            Self::ArchiveFormat => "archive_format",
            Self::EntryLimit => "entry_limit",
            Self::Compression => "compression",
            Self::Encryption => "encryption",
            Self::EntryMetadata => "entry_metadata",
            Self::EntryOrder => "entry_order",
            Self::UnsafePath => "unsafe_path",
            Self::UnexpectedFile => "unexpected_file",
            Self::MissingFile => "missing_file",
            Self::FileSize => "file_size",
            Self::Ledger => "ledger",
            Self::Manifest(_) => "manifest",
            Self::View(_) => "view",
            Self::Logic => "logic",
            Self::Style => "style",
            Self::Locales => "locales",
            Self::License => "license",
            Self::Asset => "asset",
        }
    }
}

/// A package whose archive, ledger and every file were validated.
#[derive(Clone, Debug)]
pub struct Package {
    pub manifest: Manifest,
    /// SHA-256 of the whole archive: the catalog pins it, the host's install
    /// receipt records it.
    pub digest: [u8; 32],
    bytes: Vec<u8>,
    files: BTreeMap<String, Range<usize>>,
}

impl Package {
    pub fn file(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(|range| &self.bytes[range.clone()])
    }

    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(String::as_str)
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

/// Reads and validates a whole package.
pub fn read_package(bytes: &[u8]) -> Result<Package, PackageError> {
    if bytes.len() as u64 > MAX_PACKAGE_BYTES.value {
        return Err(PackageError::ArchiveSize);
    }
    let entries = parse_stored_zip(bytes)?;
    let mut files = BTreeMap::new();
    for (path, range) in entries {
        let class = classify(&path).ok_or(PackageError::UnexpectedFile)?;
        if range.len() as u64 > class.limit.value {
            return Err(PackageError::FileSize);
        }
        files.insert(path, range);
    }
    for class in FILE_CLASSES.iter().filter(|class| class.required) {
        if !files.contains_key(class.path) {
            return Err(PackageError::MissingFile);
        }
    }
    let file = |path: &str| files.get(path).map(|range| &bytes[range.clone()]);

    let others: Vec<(&str, &[u8])> = files
        .iter()
        .filter(|(path, _)| path.as_str() != LEDGER_PATH)
        .map(|(path, range)| (path.as_str(), &bytes[range.clone()]))
        .collect();
    if file(LEDGER_PATH) != Some(ledger(&others).as_slice()) {
        return Err(PackageError::Ledger);
    }

    let manifest = validate_manifest(file(MANIFEST_PATH).unwrap_or_default())
        .map_err(PackageError::Manifest)?;
    let logic = file("logic.js").unwrap_or_default();
    if logic.is_empty() || !valid_source_text(logic) {
        return Err(PackageError::Logic);
    }
    if file("style.ocss").is_some_and(|style| !valid_source_text(style)) {
        return Err(PackageError::Style);
    }
    validate_locales(file("locales/en.json"), file("locales/fr.json"))?;
    let license = file("LICENSE").unwrap_or_default();
    if license.is_empty() || !valid_source_text(license) {
        return Err(PackageError::License);
    }
    let mut assets = BTreeSet::new();
    for (path, range) in &files {
        if path.starts_with("assets/") {
            if !image_matches_extension(path, &bytes[range.clone()]) {
                return Err(PackageError::Asset);
            }
            assets.insert(path.clone());
        }
    }
    validate_compiled_view(file("view.json").unwrap_or_default(), &assets)
        .map_err(PackageError::View)?;

    Ok(Package {
        manifest,
        digest: sha256(bytes),
        bytes: bytes.to_vec(),
        files,
    })
}

/// Writes the package of `files` (every entry except `ledger.json`, which is
/// derived) and validates the result with [`read_package`].
pub fn write_package(files: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, PackageError> {
    if files.contains_key(LEDGER_PATH) {
        return Err(PackageError::Ledger);
    }
    let entries: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect();
    let ledger = ledger(&entries);
    let mut all = entries;
    all.push((LEDGER_PATH, &ledger));
    all.sort_by(|a, b| a.0.cmp(b.0));
    let archive = stored_zip(&all);
    read_package(&archive)?;
    Ok(archive)
}

/// Canonical `ledger.json`: `{"ledgerVersion":1,"files":{…}}` with one
/// `{"bytes":n,"sha256":"…"}` entry per path in byte order, no whitespace
/// and no trailing newline. Paths never need JSON escaping.
pub fn ledger(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut sorted: Vec<_> = entries.to_vec();
    sorted.sort_by(|a, b| a.0.cmp(b.0));
    let mut text = format!("{{\"ledgerVersion\":{LEDGER_VERSION},\"files\":{{");
    for (index, (path, bytes)) in sorted.iter().enumerate() {
        if index > 0 {
            text.push(',');
        }
        let _ = write!(
            text,
            "\"{path}\":{{\"bytes\":{},\"sha256\":\"{}\"}}",
            bytes.len(),
            hex(&sha256(bytes))
        );
    }
    text.push_str("}}");
    text.into_bytes()
}

fn classify(path: &str) -> Option<&'static FileClass> {
    if path.len() as u64 > MAX_PACKAGE_PATH_BYTES.value {
        return None;
    }
    if let Some(class) = FILE_CLASSES.iter().find(|class| class.path == path) {
        return Some(class);
    }
    let asset = path.strip_prefix("assets/")?;
    let segments: Vec<&str> = asset.split('/').collect();
    let (name, directories) = segments.split_last()?;
    let (stem, extension) = name.rsplit_once('.')?;
    let lower_segment = |segment: &str| {
        segment
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
            && segment.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
            })
    };
    let valid = segments.len() as u64 <= MAX_ASSET_PATH_SEGMENTS.value
        && directories.iter().all(|segment| lower_segment(segment))
        && lower_segment(stem)
        && matches!(extension, "png" | "jpg" | "jpeg" | "webp");
    valid.then(|| FILE_CLASSES.last()).flatten()
}

fn image_matches_extension(path: &str, bytes: &[u8]) -> bool {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("png") => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        Some("jpg" | "jpeg") => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        Some("webp") => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// UTF-8 without byte-order mark or NUL.
fn valid_source_text(bytes: &[u8]) -> bool {
    !bytes.starts_with(&[0xef, 0xbb, 0xbf])
        && !bytes.contains(&0)
        && std::str::from_utf8(bytes).is_ok()
}

fn validate_locales(en: Option<&[u8]>, fr: Option<&[u8]>) -> Result<(), PackageError> {
    let keys = |bytes: &[u8]| -> Result<BTreeSet<String>, PackageError> {
        let value =
            parse_strict(bytes, MAX_LOCALE_FILE_BYTES.value).ok_or(PackageError::Locales)?;
        let object = value.as_object().ok_or(PackageError::Locales)?;
        if object.len() as u64 > MAX_LOCALE_ENTRIES.value {
            return Err(PackageError::Locales);
        }
        for (key, text) in object {
            let text = text.as_str().ok_or(PackageError::Locales)?;
            let key_valid = key.len() as u64 <= MAX_LOCALE_KEY_BYTES.value
                && key
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'));
            let text_valid = text.len() as u64 <= MAX_LOCALE_VALUE_BYTES.value
                && !text.chars().any(|c| c.is_control() && c != '\n');
            if !key_valid || !text_valid {
                return Err(PackageError::Locales);
            }
        }
        Ok(object.keys().cloned().collect())
    };
    match (en, fr) {
        (None, None) => Ok(()),
        (Some(en), Some(fr)) if keys(en)? == keys(fr)? => Ok(()),
        _ => Err(PackageError::Locales),
    }
}

// The pinned stored-zip layout, identical to the Web package writer: PKZIP
// 2.0 records with the UTF-8 flag only, method 0, 1980-01-01 00:00, Unix
// regular file 0644, no extra field, comment, data descriptor or ZIP64;
// local records in path order, then the central directory, then the trailer.
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const END_SIGNATURE: u32 = 0x0605_4b50;
const LOCAL_HEADER_BYTES: usize = 30;
const CENTRAL_HEADER_BYTES: usize = 46;
const END_HEADER_BYTES: usize = 22;
const VERSION_MADE_BY: u16 = (3 << 8) | 20;
const VERSION_NEEDED: u16 = 20;
const UTF8_FLAG: u16 = 1 << 11;
const DOS_DATE_1980_01_01: u16 = 33;
const REGULAR_FILE_ATTRIBUTES: u32 = 0o100_644 << 16;

/// Writes `entries` in the pinned layout, in the given order. It does not
/// validate: [`write_package`] does, and fixtures use it to build invalid
/// archives.
pub fn stored_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut archive = Vec::new();
    let mut offsets = Vec::with_capacity(entries.len());
    for (path, bytes) in entries {
        offsets.push(archive.len() as u32);
        put32(&mut archive, LOCAL_SIGNATURE);
        put16(&mut archive, VERSION_NEEDED);
        put16(&mut archive, UTF8_FLAG);
        put16(&mut archive, 0);
        put16(&mut archive, 0);
        put16(&mut archive, DOS_DATE_1980_01_01);
        put32(&mut archive, crc32fast::hash(bytes));
        put32(&mut archive, bytes.len() as u32);
        put32(&mut archive, bytes.len() as u32);
        put16(&mut archive, path.len() as u16);
        put16(&mut archive, 0);
        archive.extend_from_slice(path.as_bytes());
        archive.extend_from_slice(bytes);
    }
    let central_offset = archive.len() as u32;
    for ((path, bytes), offset) in entries.iter().zip(offsets) {
        put32(&mut archive, CENTRAL_SIGNATURE);
        put16(&mut archive, VERSION_MADE_BY);
        put16(&mut archive, VERSION_NEEDED);
        put16(&mut archive, UTF8_FLAG);
        put16(&mut archive, 0);
        put16(&mut archive, 0);
        put16(&mut archive, DOS_DATE_1980_01_01);
        put32(&mut archive, crc32fast::hash(bytes));
        put32(&mut archive, bytes.len() as u32);
        put32(&mut archive, bytes.len() as u32);
        put16(&mut archive, path.len() as u16);
        for _ in 0..4 {
            put16(&mut archive, 0);
        }
        put32(&mut archive, REGULAR_FILE_ATTRIBUTES);
        put32(&mut archive, offset);
        archive.extend_from_slice(path.as_bytes());
    }
    let central_size = archive.len() as u32 - central_offset;
    put32(&mut archive, END_SIGNATURE);
    put16(&mut archive, 0);
    put16(&mut archive, 0);
    put16(&mut archive, entries.len() as u16);
    put16(&mut archive, entries.len() as u16);
    put32(&mut archive, central_size);
    put32(&mut archive, central_offset);
    put16(&mut archive, 0);
    archive
}

fn put16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn put32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn read16(bytes: &[u8], offset: usize) -> Result<u16, PackageError> {
    let slice = slice(bytes, offset, 2)?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read32(bytes: &[u8], offset: usize) -> Result<u32, PackageError> {
    let slice = slice(bytes, offset, 4)?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn slice(bytes: &[u8], offset: usize, length: usize) -> Result<&[u8], PackageError> {
    offset
        .checked_add(length)
        .and_then(|end| bytes.get(offset..end))
        .ok_or(PackageError::ArchiveFormat)
}

/// Parses the pinned layout and returns each entry's path and data range.
fn parse_stored_zip(archive: &[u8]) -> Result<Vec<(String, Range<usize>)>, PackageError> {
    let end = archive
        .len()
        .checked_sub(END_HEADER_BYTES)
        .ok_or(PackageError::ArchiveFormat)?;
    let count = usize::from(read16(archive, end + 10)?);
    if read32(archive, end)? != END_SIGNATURE
        || read16(archive, end + 4)? != 0
        || read16(archive, end + 6)? != 0
        || usize::from(read16(archive, end + 8)?) != count
        || read16(archive, end + 20)? != 0
    {
        return Err(PackageError::ArchiveFormat);
    }
    if count == 0 {
        return Err(PackageError::MissingFile);
    }
    if count as u64 > MAX_PACKAGE_FILES.value {
        return Err(PackageError::EntryLimit);
    }
    let central_size = read32(archive, end + 12)? as usize;
    let central_offset = read32(archive, end + 16)? as usize;
    if central_offset.checked_add(central_size) != Some(end) {
        return Err(PackageError::ArchiveFormat);
    }

    let mut entries: Vec<(String, Range<usize>)> = Vec::with_capacity(count);
    let mut position = central_offset;
    let mut expected_local = 0usize;
    for _ in 0..count {
        if read32(archive, position)? != CENTRAL_SIGNATURE {
            return Err(PackageError::ArchiveFormat);
        }
        let flags = read16(archive, position + 8)?;
        if flags & ((1 << 0) | (1 << 6) | (1 << 13)) != 0 {
            return Err(PackageError::Encryption);
        }
        if read16(archive, position + 10)? != 0 {
            return Err(PackageError::Compression);
        }
        let crc = read32(archive, position + 16)?;
        let size = read32(archive, position + 20)?;
        let name_length = usize::from(read16(archive, position + 28)?);
        let pinned = read16(archive, position + 4)? == VERSION_MADE_BY
            && read16(archive, position + 6)? == VERSION_NEEDED
            && flags == UTF8_FLAG
            && read16(archive, position + 12)? == 0
            && read16(archive, position + 14)? == DOS_DATE_1980_01_01
            && read32(archive, position + 24)? == size
            && (30..=36).step_by(2).try_fold(true, |all, offset| {
                Ok::<_, PackageError>(all && read16(archive, position + offset)? == 0)
            })?
            && read32(archive, position + 38)? == REGULAR_FILE_ATTRIBUTES
            && read32(archive, position + 42)? as usize == expected_local;
        if !pinned {
            return Err(PackageError::EntryMetadata);
        }
        let name = slice(archive, position + CENTRAL_HEADER_BYTES, name_length)?;
        let path = std::str::from_utf8(name).map_err(|_| PackageError::UnsafePath)?;
        if !safe_path(path) {
            return Err(PackageError::UnsafePath);
        }
        if entries
            .last()
            .is_some_and(|(previous, _)| previous.as_str() >= path)
        {
            return Err(PackageError::EntryOrder);
        }

        // The local record must repeat the central one exactly.
        let local = expected_local;
        let local_matches = read32(archive, local)? == LOCAL_SIGNATURE
            && read16(archive, local + 4)? == VERSION_NEEDED
            && read16(archive, local + 6)? == UTF8_FLAG
            && read16(archive, local + 8)? == 0
            && read16(archive, local + 10)? == 0
            && read16(archive, local + 12)? == DOS_DATE_1980_01_01
            && read32(archive, local + 14)? == crc
            && read32(archive, local + 18)? == size
            && read32(archive, local + 22)? == size
            && usize::from(read16(archive, local + 26)?) == name_length
            && read16(archive, local + 28)? == 0
            && slice(archive, local + LOCAL_HEADER_BYTES, name_length)? == name;
        if !local_matches {
            return Err(PackageError::EntryMetadata);
        }
        let start = local + LOCAL_HEADER_BYTES + name_length;
        let data_end = start
            .checked_add(size as usize)
            .filter(|data_end| *data_end <= central_offset)
            .ok_or(PackageError::ArchiveFormat)?;
        if crc32fast::hash(&archive[start..data_end]) != crc {
            return Err(PackageError::EntryMetadata);
        }
        entries.push((path.to_owned(), start..data_end));
        expected_local = data_end;
        position += CENTRAL_HEADER_BYTES + name_length;
    }
    if position != end || expected_local != central_offset {
        return Err(PackageError::ArchiveFormat);
    }
    Ok(entries)
}

/// Relative, ASCII, `/`-separated, no empty, `.` or `..` segment; the
/// classes above narrow it further.
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() as u64 <= MAX_PACKAGE_PATH_BYTES.value
        && path.is_ascii()
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && !matches!(segment, "." | "..")
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}
