//! A ZIP writer for tests: it writes what archivers write (folder entries,
//! data descriptors, Unix modes, extra fields) and, on request, what a
//! hostile archive holds. Compiled only for tests: the unit tests use it as
//! `crate::testzip`, the integration tests include this file.
#![allow(dead_code)]

use std::io::Write as _;

/// One entry; `name` ends in `/` for a folder.
#[derive(Clone, Debug)]
pub struct Item {
    pub name: Vec<u8>,
    pub data: Vec<u8>,
    pub deflate: bool,
    /// "Version made by": host in the high byte (3 Unix, 0 DOS, 19 OS X).
    pub made_by: u16,
    pub attributes: u32,
    pub flags: u16,
    /// A data descriptor after the data: `Some(true)` with its signature.
    pub descriptor: Option<bool>,
    /// Written in both headers.
    pub extra: Vec<u8>,
    pub comment: Vec<u8>,
    /// Declared uncompressed size, when it must lie.
    pub declared_size: Option<u32>,
}

impl Item {
    pub fn file(name: &str, data: &[u8]) -> Self {
        Self {
            name: name.as_bytes().to_vec(),
            data: data.to_vec(),
            deflate: true,
            made_by: 0x031e,
            attributes: 0o100_644 << 16,
            flags: 0,
            descriptor: None,
            extra: Vec::new(),
            comment: Vec::new(),
            declared_size: None,
        }
    }

    pub fn stored(name: &str, data: &[u8]) -> Self {
        Self {
            deflate: false,
            ..Self::file(name, data)
        }
    }

    pub fn folder(name: &str) -> Self {
        Self {
            deflate: false,
            attributes: (0o040_755 << 16) | 0x10,
            ..Self::file(name, b"")
        }
    }

    /// As Windows Explorer writes it: DOS host, archive attribute.
    pub fn windows(mut self) -> Self {
        self.made_by = 0x0014;
        self.attributes = if self.name.ends_with(b"/") {
            0x10
        } else {
            0x20
        };
        self
    }

    pub fn mode(mut self, mode: u32) -> Self {
        self.attributes = mode << 16;
        self
    }

    pub fn descriptor(mut self, signature: bool) -> Self {
        self.flags |= 1 << 3;
        self.descriptor = Some(signature);
        self
    }

    pub fn extra(mut self, extra: &[u8]) -> Self {
        self.extra = extra.to_vec();
        self
    }
}

pub fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(data).expect("deflate");
    encoder.finish().expect("deflate")
}

/// An extended timestamp field (`UT`), as Info-ZIP writes it.
pub fn timestamp_extra() -> Vec<u8> {
    let mut extra = vec![0x55, 0x54, 5, 0, 1];
    extra.extend(1_700_000_000_u32.to_le_bytes());
    extra
}

/// Writes `items` in order: local headers and data (with descriptors), the
/// central directory, its end record. `prefix` comes first, `between` after
/// each entry, `comment` is the archive comment.
pub fn archive_with(items: &[Item], prefix: &[u8], between: &[u8], comment: &[u8]) -> Vec<u8> {
    let mut out = prefix.to_vec();
    let mut central = Vec::new();
    for item in items {
        let body = if item.deflate {
            deflate(&item.data)
        } else {
            item.data.clone()
        };
        let crc = crc32fast::hash(&item.data);
        let size = item.declared_size.unwrap_or(item.data.len() as u32);
        let method: u16 = if item.deflate { 8 } else { 0 };
        let offset = out.len() as u32;
        let streamed = item.descriptor.is_some();
        let mut local = Vec::new();
        local.extend(0x0403_4b50_u32.to_le_bytes());
        local.extend(20_u16.to_le_bytes());
        local.extend(item.flags.to_le_bytes());
        local.extend(method.to_le_bytes());
        local.extend([0, 0, 0x21, 0]);
        if streamed {
            local.extend([0; 12]);
        } else {
            local.extend(crc.to_le_bytes());
            local.extend((body.len() as u32).to_le_bytes());
            local.extend(size.to_le_bytes());
        }
        local.extend((item.name.len() as u16).to_le_bytes());
        local.extend((item.extra.len() as u16).to_le_bytes());
        local.extend(&item.name);
        local.extend(&item.extra);
        out.extend(&local);
        out.extend(&body);
        if let Some(signature) = item.descriptor {
            if signature {
                out.extend(0x0807_4b50_u32.to_le_bytes());
            }
            out.extend(crc.to_le_bytes());
            out.extend((body.len() as u32).to_le_bytes());
            out.extend(size.to_le_bytes());
        }
        out.extend(between);
        central.extend(0x0201_4b50_u32.to_le_bytes());
        central.extend(item.made_by.to_le_bytes());
        central.extend(20_u16.to_le_bytes());
        central.extend(item.flags.to_le_bytes());
        central.extend(method.to_le_bytes());
        central.extend([0, 0, 0x21, 0]);
        central.extend(crc.to_le_bytes());
        central.extend((body.len() as u32).to_le_bytes());
        central.extend(size.to_le_bytes());
        central.extend((item.name.len() as u16).to_le_bytes());
        central.extend((item.extra.len() as u16).to_le_bytes());
        central.extend((item.comment.len() as u16).to_le_bytes());
        central.extend([0; 4]);
        central.extend(item.attributes.to_le_bytes());
        central.extend(offset.to_le_bytes());
        central.extend(&item.name);
        central.extend(&item.extra);
        central.extend(&item.comment);
    }
    let directory_offset = out.len() as u32;
    out.extend(&central);
    out.extend(0x0605_4b50_u32.to_le_bytes());
    out.extend([0; 4]);
    out.extend((items.len() as u16).to_le_bytes());
    out.extend((items.len() as u16).to_le_bytes());
    out.extend((central.len() as u32).to_le_bytes());
    out.extend(directory_offset.to_le_bytes());
    out.extend((comment.len() as u16).to_le_bytes());
    out.extend(comment);
    out
}

pub fn archive(items: &[Item]) -> Vec<u8> {
    archive_with(items, b"", b"", b"")
}
