//! The images of a scenario's `assets`: files of the widget project that a
//! fixture value names as `fixture:<name>`. The CLI and the headless runtime
//! read them with [`load_assets`], which accepts only a relative path of
//! plain names inside the project, never a link, and only a PNG or JPEG
//! file within the host's image bounds. The runtime then decodes them with
//! the host's own decoder.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use overcrow_widget_schema::limits::{MAX_IMAGE_EDGE_PX, MAX_IMAGE_ENCODED_BYTES};

use crate::{MAX_ASSET_PATH_BYTES, ScenarioError, report};

/// The names of an asset path, or `None` unless it is relative, made of
/// plain names (ASCII letters, digits, `-`, `_`, `.`) separated by `/`,
/// without `.` or `..`.
pub(crate) fn asset_components(path: &str) -> Option<Vec<&str>> {
    if path.is_empty() || path.len() > MAX_ASSET_PATH_BYTES {
        return None;
    }
    let names: Vec<&str> = path.split('/').collect();
    let plain = |name: &&str| {
        !name.is_empty()
            && *name != "."
            && *name != ".."
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    names.iter().all(plain).then_some(names)
}

/// Reads the scenario's images from the project at `project`: each path
/// inside it, no link on the way, a regular file of at most
/// `MAX_IMAGE_ENCODED_BYTES`, a PNG or JPEG whose sides are within
/// `MAX_IMAGE_EDGE_PX`. Returns the bytes by name.
pub fn load_assets(
    project: &Path,
    assets: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, Vec<u8>>, ScenarioError> {
    let mut loaded = BTreeMap::new();
    for (name, path) in assets {
        let here = format!("assets.{}", report::neutral(name));
        let fail = |message: &str| ScenarioError::new(here.clone(), message);
        let names = asset_components(path).ok_or_else(|| fail("not a relative project path"))?;
        let mut current = PathBuf::from(project);
        for (index, component) in names.iter().enumerate() {
            current.push(component);
            let metadata = std::fs::symlink_metadata(&current)
                .map_err(|_| fail("the file does not exist in the project"))?;
            let last = index + 1 == names.len();
            if metadata.file_type().is_symlink() {
                return Err(fail("links are refused"));
            }
            if (last && !metadata.is_file()) || (!last && !metadata.is_dir()) {
                return Err(fail("not a regular file"));
            }
        }
        let limit = MAX_IMAGE_ENCODED_BYTES.value;
        let file = File::open(&current).map_err(|_| fail("unreadable"))?;
        if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
            return Err(fail("not a regular file"));
        }
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| fail("unreadable"))?;
        if bytes.len() as u64 > limit {
            return Err(fail("larger than MAX_IMAGE_ENCODED_BYTES"));
        }
        let (width, height) = image_size(&bytes).ok_or_else(|| fail("not a PNG or JPEG image"))?;
        let edge = MAX_IMAGE_EDGE_PX.value;
        if width == 0 || height == 0 || u64::from(width) > edge || u64::from(height) > edge {
            return Err(fail("a side is beyond MAX_IMAGE_EDGE_PX"));
        }
        loaded.insert(name.clone(), bytes);
    }
    Ok(loaded)
}

/// The size a PNG or JPEG header declares.
fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
    if let Some(rest) = bytes.strip_prefix(PNG) {
        // The first chunk is IHDR: length, type, width, height.
        if rest.get(4..8)? != b"IHDR" {
            return None;
        }
        let width = u32::from_be_bytes(rest.get(8..12)?.try_into().ok()?);
        let height = u32::from_be_bytes(rest.get(12..16)?.try_into().ok()?);
        return Some((width, height));
    }
    let mut at = bytes.strip_prefix(b"\xff\xd8").map(|_| 2)?;
    // Markers until a start of frame, which holds the size.
    loop {
        if *bytes.get(at)? != 0xff {
            return None;
        }
        let marker = *bytes.get(at + 1)?;
        at += 2;
        match marker {
            0xff => at -= 1,
            0x01 | 0xd0..=0xd7 => {}
            0xd9 | 0xda => return None,
            _ => {
                let length =
                    usize::from(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]));
                if length < 2 {
                    return None;
                }
                let frame = matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
                if frame {
                    let height = u16::from_be_bytes([*bytes.get(at + 3)?, *bytes.get(at + 4)?]);
                    let width = u16::from_be_bytes([*bytes.get(at + 5)?, *bytes.get(at + 6)?]);
                    return Some((u32::from(width), u32::from(height)));
                }
                at += length;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_are_plain_relative_names() {
        assert_eq!(
            asset_components("tests/assets/cover.png"),
            Some(vec!["tests", "assets", "cover.png"])
        );
        for invalid in [
            "",
            "/etc/passwd",
            "../cover.png",
            "tests/../../cover.png",
            "tests/./cover.png",
            "tests//cover.png",
            "tests\\cover.png",
            "C:/cover.png",
            "tests/cover.png/",
            "tests/cov er.png",
        ] {
            assert_eq!(asset_components(invalid), None, "{invalid:?}");
        }
        assert_eq!(
            asset_components(&"a".repeat(MAX_ASSET_PATH_BYTES + 1)),
            None
        );
    }

    #[test]
    fn headers_give_the_declared_size() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&64_u32.to_be_bytes());
        png.extend_from_slice(&32_u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((64, 32)));
        // SOI, an APP0 segment, then SOF0 with height 20 and width 30.
        let jpeg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
            0x14, 0x00, 0x1e, 0x01, 0x01, 0x11, 0x00,
        ];
        assert_eq!(image_size(&jpeg), Some((30, 20)));
        assert_eq!(image_size(b"GIF89a"), None);
        assert_eq!(image_size(&png[..20]), None, "a cut header");
        assert_eq!(
            image_size(&[0xff, 0xd8, 0xff, 0xda]),
            None,
            "no frame before the scan"
        );
    }
}
