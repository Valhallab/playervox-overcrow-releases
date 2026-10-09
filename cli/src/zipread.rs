//! A strict reader of a creator tools ZIP (`overcrow-creator-tools-<v>-<platform>.zip`,
//! assembled by OverCrow's release publisher): the downloaded runtime comes
//! out of it. The archive cannot be pinned (the CLI is inside it), so the
//! reader trusts nothing it declares: every entry is checked before any
//! byte is inflated, and one entry is then extracted within its declared
//! size and CRC-32. The caller checks the result's SHA-256 against the pin.
//!
//! Accepted: one disk, no ZIP64, no encryption, stored or deflated
//! entries, the central directory right before its end record, relative
//! names of safe components, local headers that agree with the central
//! directory, entries that do not overlap. This file depends on nothing
//! else in the crate: the `creator_tools_zip` fuzz target includes it.

use std::io::{Read, Seek, SeekFrom, Write};

/// Bounds of one archive.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_entries: usize,
    /// The largest uncompressed entry.
    pub max_entry_bytes: u64,
    /// The sum of every uncompressed entry.
    pub max_total_bytes: u64,
}

/// One file of the archive, checked against its local header.
#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub size: u64,
    compressed: u64,
    deflated: bool,
    crc32: u32,
    data_start: u64,
}

/// Why an archive or an entry is refused.
#[derive(Debug, PartialEq, Eq)]
pub enum ZipError {
    Io,
    /// Not a ZIP this reader accepts; the text says which rule failed.
    Invalid(&'static str),
    /// An entry name that could leave the destination or clash on disk.
    UnsafeName,
    /// More entries or bytes than the limits allow.
    TooLarge,
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io => formatter.write_str("the archive cannot be read"),
            Self::Invalid(rule) => write!(formatter, "invalid archive: {rule}"),
            Self::UnsafeName => formatter.write_str("the archive holds an unsafe file name"),
            Self::TooLarge => formatter.write_str("the archive exceeds its size bounds"),
        }
    }
}

const END_SIGNATURE: u32 = 0x0605_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const ZIP64_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const END_BYTES: u64 = 22;
const CENTRAL_BYTES: usize = 46;
const LOCAL_BYTES: usize = 30;
/// Encryption (bit 0), strong encryption (bit 6), masked headers (bit 13).
const ENCRYPTED_FLAGS: u16 = 1 | 1 << 6 | 1 << 13;
/// The flags this reader understands: encryption ones (refused), deflate
/// options (bits 1-2), data descriptor (bit 3), UTF-8 names (bit 11).
const KNOWN_FLAGS: u16 = ENCRYPTED_FLAGS | 0b110 | 1 << 3 | 1 << 11;
/// Every central directory header and name of an accepted archive.
const MAX_DIRECTORY_BYTES: u64 = 64 * 1024;
const MAX_NAME_BYTES: usize = 255;

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_at<R: Read + Seek>(reader: &mut R, offset: u64, buffer: &mut [u8]) -> Result<(), ZipError> {
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|_| ZipError::Io)?;
    reader.read_exact(buffer).map_err(|_| ZipError::Io)
}

/// A name is a relative path of non-empty components other than `.` and
/// `..`, without backslashes, drive letters, control characters or a
/// trailing slash (directories are implied, never entries).
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && !name.starts_with('/')
        && !name.chars().any(|character| {
            character.is_control()
                || matches!(character, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        && name
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

/// Reads and checks the whole directory of an archive of `length` bytes.
pub fn entries<R: Read + Seek>(
    reader: &mut R,
    length: u64,
    limits: Limits,
) -> Result<Vec<Entry>, ZipError> {
    if length < END_BYTES {
        return Err(ZipError::Invalid("too short"));
    }
    // The end record has no comment: the publisher writes none.
    let end_offset = length - END_BYTES;
    let mut end = [0_u8; END_BYTES as usize];
    read_at(reader, end_offset, &mut end)?;
    if u32_at(&end, 0) != END_SIGNATURE {
        return Err(ZipError::Invalid("no end record at the end"));
    }
    if u16_at(&end, 20) != 0 {
        return Err(ZipError::Invalid("archive comment"));
    }
    let (disk, directory_disk) = (u16_at(&end, 4), u16_at(&end, 6));
    let (disk_entries, total_entries) = (u16_at(&end, 8), u16_at(&end, 10));
    let directory_size = u64::from(u32_at(&end, 12));
    let directory_offset = u64::from(u32_at(&end, 16));
    if disk_entries == u16::MAX
        || total_entries == u16::MAX
        || directory_size == u64::from(u32::MAX)
        || directory_offset == u64::from(u32::MAX)
    {
        return Err(ZipError::Invalid("ZIP64"));
    }
    if end_offset >= 20 {
        let mut locator = [0_u8; 4];
        read_at(reader, end_offset - 20, &mut locator)?;
        if u32_at(&locator, 0) == ZIP64_LOCATOR_SIGNATURE {
            return Err(ZipError::Invalid("ZIP64"));
        }
    }
    if disk != 0 || directory_disk != 0 || disk_entries != total_entries {
        return Err(ZipError::Invalid("several disks"));
    }
    if usize::from(total_entries) > limits.max_entries {
        return Err(ZipError::TooLarge);
    }
    if directory_size > MAX_DIRECTORY_BYTES {
        return Err(ZipError::TooLarge);
    }
    if directory_offset.checked_add(directory_size) != Some(end_offset) {
        return Err(ZipError::Invalid(
            "central directory not before its end record",
        ));
    }
    let mut directory = vec![0_u8; directory_size as usize];
    read_at(reader, directory_offset, &mut directory)?;

    let mut found = Vec::with_capacity(usize::from(total_entries));
    let mut seen = std::collections::HashSet::new();
    let mut total = 0_u64;
    let mut cursor = 0_usize;
    for _ in 0..total_entries {
        let header = directory
            .get(cursor..cursor + CENTRAL_BYTES)
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        if u32_at(header, 0) != CENTRAL_SIGNATURE {
            return Err(ZipError::Invalid("bad central header"));
        }
        let flags = u16_at(header, 8);
        let method = u16_at(header, 10);
        let crc32 = u32_at(header, 16);
        let compressed = u64::from(u32_at(header, 20));
        let size = u64::from(u32_at(header, 24));
        let name_length = usize::from(u16_at(header, 28));
        let extra_length = usize::from(u16_at(header, 30));
        let comment_length = usize::from(u16_at(header, 32));
        let disk_start = u16_at(header, 34);
        let local_offset = u64::from(u32_at(header, 42));
        if flags & ENCRYPTED_FLAGS != 0 {
            return Err(ZipError::Invalid("encrypted entry"));
        }
        if flags & !KNOWN_FLAGS != 0 {
            return Err(ZipError::Invalid("unknown entry flags"));
        }
        let deflated = match method {
            0 => false,
            8 => true,
            _ => return Err(ZipError::Invalid("unsupported compression method")),
        };
        if compressed == u64::from(u32::MAX)
            || size == u64::from(u32::MAX)
            || local_offset == u64::from(u32::MAX)
        {
            return Err(ZipError::Invalid("ZIP64"));
        }
        if disk_start != 0 {
            return Err(ZipError::Invalid("several disks"));
        }
        if !deflated && compressed != size {
            return Err(ZipError::Invalid("stored entry sizes differ"));
        }
        let name_start = cursor + CENTRAL_BYTES;
        let name_bytes = directory
            .get(name_start..name_start + name_length)
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| ZipError::UnsafeName)?
            .to_owned();
        if !safe_name(&name) {
            return Err(ZipError::UnsafeName);
        }
        // Case-insensitive file systems would merge two such names.
        if !seen.insert(name.to_lowercase()) {
            return Err(ZipError::Invalid("duplicate entry"));
        }
        cursor = name_start
            .checked_add(name_length + extra_length + comment_length)
            .filter(|end| *end <= directory.len())
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        if size > limits.max_entry_bytes {
            return Err(ZipError::TooLarge);
        }
        total = total.checked_add(size).ok_or(ZipError::TooLarge)?;
        if total > limits.max_total_bytes {
            return Err(ZipError::TooLarge);
        }
        found.push((
            local_offset,
            Entry {
                name,
                size,
                compressed,
                deflated,
                crc32,
                data_start: 0,
            },
            flags,
            method,
            name_bytes.to_vec(),
        ));
    }
    if cursor != directory.len() {
        return Err(ZipError::Invalid("bytes after the central directory"));
    }

    // Local headers: they must repeat the central directory, and the
    // entries must follow one another without overlapping.
    found.sort_by_key(|(offset, ..)| *offset);
    let mut next_free = 0_u64;
    let mut checked = Vec::with_capacity(found.len());
    for (local_offset, mut entry, flags, method, name_bytes) in found {
        if local_offset < next_free {
            return Err(ZipError::Invalid("overlapping entries"));
        }
        let mut local = [0_u8; LOCAL_BYTES];
        if local_offset
            .checked_add(LOCAL_BYTES as u64)
            .is_none_or(|end| end > directory_offset)
        {
            return Err(ZipError::Invalid("local header outside the data"));
        }
        read_at(reader, local_offset, &mut local)?;
        if u32_at(&local, 0) != LOCAL_SIGNATURE {
            return Err(ZipError::Invalid("bad local header"));
        }
        let local_flags = u16_at(&local, 6);
        if local_flags != flags || u16_at(&local, 8) != method {
            return Err(ZipError::Invalid(
                "local header disagrees with the directory",
            ));
        }
        // With a data descriptor (bit 3) the local fields may be zero.
        if flags & 1 << 3 == 0
            && (u32_at(&local, 14) != entry.crc32
                || u64::from(u32_at(&local, 18)) != entry.compressed
                || u64::from(u32_at(&local, 22)) != entry.size)
        {
            return Err(ZipError::Invalid(
                "local header disagrees with the directory",
            ));
        }
        let name_length = u64::from(u16_at(&local, 26));
        let extra_length = u64::from(u16_at(&local, 28));
        if name_length != name_bytes.len() as u64 {
            return Err(ZipError::Invalid(
                "local header disagrees with the directory",
            ));
        }
        let mut local_name = vec![0_u8; name_bytes.len()];
        read_at(reader, local_offset + LOCAL_BYTES as u64, &mut local_name)?;
        if local_name != name_bytes {
            return Err(ZipError::Invalid(
                "local header disagrees with the directory",
            ));
        }
        let data_start = local_offset + LOCAL_BYTES as u64 + name_length + extra_length;
        let data_end = data_start
            .checked_add(entry.compressed)
            .filter(|end| *end <= directory_offset)
            .ok_or(ZipError::Invalid("entry data outside the archive"))?;
        entry.data_start = data_start;
        next_free = data_end;
        checked.push(entry);
    }
    Ok(checked)
}

/// Writes the uncompressed bytes of `entry` to `output`: exactly its
/// declared size, with its CRC-32. Nothing is trusted to stop the inflater
/// but these two checks.
pub fn extract<R: Read + Seek, W: Write>(
    reader: &mut R,
    entry: &Entry,
    output: &mut W,
) -> Result<(), ZipError> {
    reader
        .seek(SeekFrom::Start(entry.data_start))
        .map_err(|_| ZipError::Io)?;
    let raw = reader.by_ref().take(entry.compressed);
    let mut source: Box<dyn Read + '_> = if entry.deflated {
        Box::new(flate2::read::DeflateDecoder::new(raw))
    } else {
        Box::new(raw)
    };
    let mut hasher = crc32fast::Hasher::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut written = 0_u64;
    loop {
        let read = match source.read(&mut buffer) {
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(ZipError::Invalid("corrupt entry data")),
        };
        if read == 0 {
            break;
        }
        written += read as u64;
        if written > entry.size {
            return Err(ZipError::Invalid("entry larger than declared"));
        }
        hasher.update(&buffer[..read]);
        output
            .write_all(&buffer[..read])
            .map_err(|_| ZipError::Io)?;
    }
    if written != entry.size {
        return Err(ZipError::Invalid("entry smaller than declared"));
    }
    if hasher.finalize() != entry.crc32 {
        return Err(ZipError::Invalid("CRC-32 mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const LIMITS: Limits = Limits {
        max_entries: 16,
        max_entry_bytes: 1 << 20,
        max_total_bytes: 4 << 20,
    };

    /// One entry of a test archive.
    struct Spec<'a> {
        name: &'a str,
        data: &'a [u8],
        deflate: bool,
    }

    fn deflate(data: &[u8]) -> Vec<u8> {
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    /// Writes a ZIP the way Python's zipfile does: local headers and data,
    /// the central directory, its end record. `edit` may alter the
    /// central (`true`) or local (`false`) header of each entry.
    fn archive(entries: &[Spec<'_>], edit: impl Fn(usize, bool, &mut Vec<u8>)) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (index, spec) in entries.iter().enumerate() {
            let body = if spec.deflate {
                deflate(spec.data)
            } else {
                spec.data.to_vec()
            };
            let crc = crc32fast::hash(spec.data);
            let method: u16 = if spec.deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            let mut local = Vec::new();
            local.extend(LOCAL_SIGNATURE.to_le_bytes());
            local.extend(20_u16.to_le_bytes());
            local.extend(0_u16.to_le_bytes());
            local.extend(method.to_le_bytes());
            local.extend([0, 0, 0x21, 0]);
            local.extend(crc.to_le_bytes());
            local.extend((body.len() as u32).to_le_bytes());
            local.extend((spec.data.len() as u32).to_le_bytes());
            local.extend((spec.name.len() as u16).to_le_bytes());
            local.extend(0_u16.to_le_bytes());
            local.extend(spec.name.as_bytes());
            edit(index, false, &mut local);
            out.extend(&local);
            out.extend(&body);
            let mut header = Vec::new();
            header.extend(CENTRAL_SIGNATURE.to_le_bytes());
            header.extend(0x031e_u16.to_le_bytes());
            header.extend(20_u16.to_le_bytes());
            header.extend(0_u16.to_le_bytes());
            header.extend(method.to_le_bytes());
            header.extend([0, 0, 0x21, 0]);
            header.extend(crc.to_le_bytes());
            header.extend((body.len() as u32).to_le_bytes());
            header.extend((spec.data.len() as u32).to_le_bytes());
            header.extend((spec.name.len() as u16).to_le_bytes());
            header.extend([0; 8]);
            header.extend((0o100_755_u32 << 16).to_le_bytes());
            header.extend(offset.to_le_bytes());
            header.extend(spec.name.as_bytes());
            edit(index, true, &mut header);
            central.extend(header);
        }
        let directory_offset = out.len() as u32;
        out.extend(&central);
        out.extend(END_SIGNATURE.to_le_bytes());
        out.extend([0; 4]);
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((central.len() as u32).to_le_bytes());
        out.extend(directory_offset.to_le_bytes());
        out.extend(0_u16.to_le_bytes());
        out
    }

    fn plain(entries: &[Spec<'_>]) -> Vec<u8> {
        archive(entries, |_, _, _| {})
    }

    fn read(bytes: &[u8]) -> Result<Vec<Entry>, ZipError> {
        entries(&mut Cursor::new(bytes), bytes.len() as u64, LIMITS)
    }

    fn extract_named(bytes: &[u8], name: &str) -> Result<Vec<u8>, ZipError> {
        let found = read(bytes)?;
        let entry = found.iter().find(|entry| entry.name == name).unwrap();
        let mut output = Vec::new();
        extract(&mut Cursor::new(bytes), entry, &mut output)?;
        Ok(output)
    }

    const DATA: &[u8] = b"overcrow-widget-headless runtime bytes, repeated. repeated. repeated.";

    fn two() -> Vec<Spec<'static>> {
        vec![
            Spec {
                name: "tools/a",
                data: DATA,
                deflate: true,
            },
            Spec {
                name: "tools/b.txt",
                data: b"stored",
                deflate: false,
            },
        ]
    }

    #[test]
    fn stored_and_deflated_entries_come_out_intact() {
        let bytes = plain(&two());
        let found = read(&bytes).unwrap();
        assert_eq!(
            found
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["tools/a", "tools/b.txt"]
        );
        assert_eq!(extract_named(&bytes, "tools/a").unwrap(), DATA);
        assert_eq!(extract_named(&bytes, "tools/b.txt").unwrap(), b"stored");
    }

    #[test]
    fn dangerous_names_are_refused() {
        for name in [
            "../runtime",
            "tools/../../runtime",
            "/etc/passwd",
            "tools\\runtime",
            "C:runtime",
            "tools//runtime",
            "tools/./runtime",
            "tools/",
            "",
            "tools/run\u{0}time",
            "tools/run\ntime",
        ] {
            let bytes = plain(&[Spec {
                name,
                data: b"x",
                deflate: false,
            }]);
            assert_eq!(read(&bytes).unwrap_err(), ZipError::UnsafeName, "{name:?}");
        }
        let long = "a".repeat(256);
        let bytes = plain(&[Spec {
            name: &long,
            data: b"x",
            deflate: false,
        }]);
        assert_eq!(read(&bytes).unwrap_err(), ZipError::UnsafeName);
    }

    #[test]
    fn duplicate_entries_are_refused_whatever_their_case() {
        for second in ["tools/a", "TOOLS/A"] {
            let bytes = plain(&[
                Spec {
                    name: "tools/a",
                    data: b"1",
                    deflate: false,
                },
                Spec {
                    name: second,
                    data: b"2",
                    deflate: false,
                },
            ]);
            assert_eq!(
                read(&bytes).unwrap_err(),
                ZipError::Invalid("duplicate entry")
            );
        }
    }

    #[test]
    fn local_and_central_headers_must_agree() {
        // Method, sizes, CRC and name of the local header.
        for (offset, value) in [(8_usize, 0_u8), (18, 1), (22, 1), (14, 1), (30, b'x')] {
            let bytes = archive(&two(), |index, central, header| {
                if index == 0 && !central {
                    header[offset] ^= value.max(1);
                }
            });
            assert!(read(&bytes).is_err(), "local byte {offset}");
        }
        // A local name of another length.
        let bytes = archive(&two(), |index, central, header| {
            if index == 0 && !central {
                header[26] = 3;
            }
        });
        assert!(read(&bytes).is_err());
    }

    #[test]
    fn sizes_that_lie_are_caught() {
        // A larger declared size than the data inflates to.
        let bytes = archive(&two(), |index, _, header| {
            if index == 0 {
                let offset = if header[2] == 1 { 24 } else { 22 };
                header[offset] += 1;
            }
        });
        assert_eq!(
            extract_named(&bytes, "tools/a").unwrap_err(),
            ZipError::Invalid("entry smaller than declared")
        );
        // A smaller one: the inflater is stopped at the declared size.
        let bytes = archive(&two(), |index, _, header| {
            if index == 0 {
                let offset = if header[2] == 1 { 24 } else { 22 };
                header[offset] -= 1;
            }
        });
        assert_eq!(
            extract_named(&bytes, "tools/a").unwrap_err(),
            ZipError::Invalid("entry larger than declared")
        );
        // A compressed size past the central directory.
        let bytes = archive(&two(), |index, _, header| {
            if index == 1 {
                let offset = if header[2] == 1 { 20 } else { 18 };
                header[offset] += 100;
                header[offset + 4] += 100;
            }
        });
        assert!(read(&bytes).is_err());
    }

    #[test]
    fn a_wrong_crc_is_refused() {
        let bytes = archive(&two(), |index, _, header| {
            if index == 0 {
                let offset = if header[2] == 1 { 16 } else { 14 };
                header[offset] ^= 0xff;
            }
        });
        assert_eq!(
            extract_named(&bytes, "tools/a").unwrap_err(),
            ZipError::Invalid("CRC-32 mismatch")
        );
    }

    #[test]
    fn encryption_unknown_methods_and_flags_are_refused() {
        for (offset, value, rule) in [
            (8_usize, 1_u8, "encrypted entry"),
            (8, 0x40, "encrypted entry"),
            (9, 0x20, "encrypted entry"),
            (10, 12, "unsupported compression method"),
            (9, 0x40, "unknown entry flags"),
        ] {
            let bytes = archive(&two(), |index, central, header| {
                if index == 0 {
                    // The local header's fields are 2 bytes earlier.
                    let at = if central { offset } else { offset - 2 };
                    header[at] = value;
                }
            });
            assert_eq!(read(&bytes).unwrap_err(), ZipError::Invalid(rule), "{rule}");
        }
    }

    #[test]
    fn zip64_is_refused() {
        let mut bytes = plain(&two());
        let end = bytes.len() - 22;
        bytes[end + 8..end + 12].copy_from_slice(&[0xff; 4]);
        assert_eq!(read(&bytes).unwrap_err(), ZipError::Invalid("ZIP64"));
        let bytes = archive(&two(), |index, central, header| {
            if index == 0 && central {
                header[20..24].copy_from_slice(&[0xff; 4]);
            }
        });
        assert_eq!(read(&bytes).unwrap_err(), ZipError::Invalid("ZIP64"));
        // A ZIP64 locator before the end record.
        let mut bytes = plain(&two());
        let end = bytes.len() - 22;
        let mut locator = ZIP64_LOCATOR_SIGNATURE.to_le_bytes().to_vec();
        locator.extend([0; 16]);
        bytes.splice(end..end, locator);
        assert_eq!(read(&bytes).unwrap_err(), ZipError::Invalid("ZIP64"));
    }

    #[test]
    fn truncated_archives_are_refused() {
        let bytes = plain(&two());
        for cut in [1, 10, 22, 40, bytes.len() / 2, bytes.len() - 1] {
            assert!(read(&bytes[..bytes.len() - cut]).is_err(), "cut {cut}");
        }
        assert!(read(&[]).is_err());
    }

    #[test]
    fn comments_and_trailing_bytes_are_refused() {
        let mut bytes = plain(&two());
        let length = bytes.len();
        bytes[length - 2] = 1;
        bytes.push(b'!');
        assert!(read(&bytes).is_err());
        let mut bytes = plain(&two());
        bytes.extend(b"trailing");
        assert!(read(&bytes).is_err());
    }

    #[test]
    fn overlapping_entries_are_refused() {
        // Both central headers point at the first local header.
        let bytes = archive(&two(), |index, central, header| {
            if index == 1 && central {
                header[42..46].copy_from_slice(&0_u32.to_le_bytes());
            }
        });
        assert!(read(&bytes).is_err());
    }

    #[test]
    fn limits_bound_entries_and_sizes() {
        let bytes = plain(&two());
        let tight = |limits| entries(&mut Cursor::new(&bytes), bytes.len() as u64, limits);
        assert_eq!(
            tight(Limits {
                max_entries: 1,
                ..LIMITS
            })
            .unwrap_err(),
            ZipError::TooLarge
        );
        assert_eq!(
            tight(Limits {
                max_entry_bytes: 10,
                ..LIMITS
            })
            .unwrap_err(),
            ZipError::TooLarge
        );
        assert_eq!(
            tight(Limits {
                max_total_bytes: DATA.len() as u64,
                ..LIMITS
            })
            .unwrap_err(),
            ZipError::TooLarge
        );
    }

    #[test]
    fn a_deflate_bomb_stops_at_the_declared_size() {
        let zeros = vec![0_u8; 1 << 20];
        let mut bytes = plain(&[Spec {
            name: "bomb",
            data: &zeros,
            deflate: true,
        }]);
        // Declare 1 KiB uncompressed in both headers.
        bytes[22..26].copy_from_slice(&1024_u32.to_le_bytes());
        let directory = bytes.len() - 22 - (46 + 4);
        bytes[directory + 24..directory + 28].copy_from_slice(&1024_u32.to_le_bytes());
        assert_eq!(
            extract_named(&bytes, "bomb").unwrap_err(),
            ZipError::Invalid("entry larger than declared")
        );
    }
}
