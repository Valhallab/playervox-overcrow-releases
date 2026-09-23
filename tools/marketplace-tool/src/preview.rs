use std::{io::Cursor, path::Path};

use image::{DynamicImage, ImageDecoder as _, Limits, codecs::png::PngDecoder};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::{package, private_fs};

pub(crate) const MAX_BYTES: u64 = 256 * 1024;
const MAX_DIMENSION: u32 = 1024;
const MAX_DECODED_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct PreviewError;

pub(crate) struct Asset {
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Descriptor {
    url: String,
    media_type: String,
    size: u64,
    sha256: String,
}

impl Asset {
    pub(crate) fn descriptor(&self, base: &str, id: &str, version: &str) -> Descriptor {
        Descriptor {
            url: format!("{base}previews/{id}/{version}/{}.png", self.sha256),
            media_type: "image/png".to_owned(),
            size: self.size,
            sha256: self.sha256.clone(),
        }
    }
}

impl Descriptor {
    pub(crate) fn relative_path(
        &self,
        base: &str,
        id: &str,
        version: &str,
    ) -> Result<String, PreviewError> {
        if !package::valid_extension_id(id)
            || !package::canonical_semver(version)
            || self.size == 0
            || self.size > MAX_BYTES
            || self.media_type != "image/png"
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(PreviewError);
        }
        let relative = format!("previews/{id}/{version}/{}.png", self.sha256);
        if self.url.len() > 2048 || self.url != format!("{base}{relative}") {
            return Err(PreviewError);
        }
        Ok(relative)
    }

    pub(crate) fn commit(
        &self,
        output: &Path,
        base: &str,
        id: &str,
        version: &str,
        bytes: &[u8],
    ) -> Result<(), PreviewError> {
        let relative = self.relative_path(base, id, version)?;
        self.validate_bytes(bytes)?;
        let previews = private_fs::ensure_private_directory(&output.join("previews"))
            .map_err(|_| PreviewError)?;
        let identity =
            private_fs::ensure_private_directory(&previews.join(id)).map_err(|_| PreviewError)?;
        private_fs::ensure_private_directory(&identity.join(version)).map_err(|_| PreviewError)?;
        private_fs::commit_file(output, &output.join(relative), bytes).map_err(|_| PreviewError)
    }

    fn validate_bytes(&self, bytes: &[u8]) -> Result<(), PreviewError> {
        if bytes.len() as u64 != self.size || hash(bytes) != self.sha256 {
            return Err(PreviewError);
        }
        validate_png(bytes)
    }
}

// Retained catalogs do not carry source listing paths. Locate the PNG by its
// signed digest in the package ledger, then revalidate the package before use.
pub(crate) fn packaged_bytes(
    archive: &[u8],
    manifest: &serde_json::Value,
    descriptor: &Descriptor,
) -> Result<Vec<u8>, PreviewError> {
    let files = manifest
        .get("files")
        .and_then(serde_json::Value::as_object)
        .ok_or(PreviewError)?;
    let (path, _) = files
        .iter()
        .find(|(path, file)| {
            valid_source_path(path)
                && file.get("sha256").and_then(serde_json::Value::as_str)
                    == Some(descriptor.sha256.as_str())
                && file.get("bytes").and_then(serde_json::Value::as_u64) == Some(descriptor.size)
        })
        .ok_or(PreviewError)?;
    let bytes =
        package::validated_asset_bytes(archive, path, MAX_BYTES).map_err(|_| PreviewError)?;
    descriptor.validate_bytes(&bytes)?;
    Ok(bytes)
}

pub(crate) fn valid_source_path(path: &str) -> bool {
    package::valid_entry_path(path) && path.ends_with(".png")
}

pub(crate) fn selected(archive: &[u8], path: Option<&str>) -> Result<Option<Asset>, PreviewError> {
    let Some(path) = path else {
        return Ok(None);
    };
    if !valid_source_path(path) {
        return Err(PreviewError);
    }
    let bytes =
        package::validated_asset_bytes(archive, path, MAX_BYTES).map_err(|_| PreviewError)?;
    validate_png(&bytes)?;
    Ok(Some(Asset {
        size: bytes.len() as u64,
        sha256: hash(&bytes),
    }))
}

fn hash(bytes: &[u8]) -> String {
    package::sha256_hex(&Sha256::digest(bytes).into())
}

pub(crate) fn validate_png(bytes: &[u8]) -> Result<(), PreviewError> {
    if bytes.len() as u64 > MAX_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(PreviewError);
    }
    // Check the entire container: decoders may stop after the default image and
    // otherwise overlook a truncated trailer, appended animation, or bad CRC.
    let mut remaining = &bytes[8..];
    loop {
        let header = remaining.get(..8).ok_or(PreviewError)?;
        let length = u32::from_be_bytes(header[..4].try_into().map_err(|_| PreviewError)?) as usize;
        let end = length.checked_add(12).ok_or(PreviewError)?;
        let chunk = remaining.get(..end).ok_or(PreviewError)?;
        let kind = &header[4..];
        let checksum = u32::from_be_bytes(chunk[end - 4..].try_into().map_err(|_| PreviewError)?);
        if crc32fast::hash(&chunk[4..end - 4]) != checksum
            || matches!(kind, b"acTL" | b"fcTL" | b"fdAT")
        {
            return Err(PreviewError);
        }
        remaining = &remaining[end..];
        if kind == b"IEND" {
            if length != 0 || !remaining.is_empty() {
                return Err(PreviewError);
            }
            break;
        }
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    let decoder = PngDecoder::with_limits(Cursor::new(bytes), limits).map_err(|_| PreviewError)?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || decoder.total_bytes() > MAX_DECODED_BYTES {
        return Err(PreviewError);
    }
    DynamicImage::from_decoder(decoder).map_err(|_| PreviewError)?;
    Ok(())
}
