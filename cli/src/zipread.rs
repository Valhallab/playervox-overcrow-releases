//! A strict reader of ZIP archives, with two rule sets:
//!
//! - [`Rules::CREATOR_TOOLS`]: the creator tools ZIP
//!   (`overcrow-creator-tools-<v>-<platform>.zip`, assembled by OverCrow's
//!   release publisher), the downloaded runtime comes out of it. The
//!   archive cannot be pinned (the CLI is inside it); the caller checks the
//!   extracted runtime's SHA-256 against the pin.
//! - [`Rules::SOURCES`]: a creator's source archive, hostile until proven
//!   otherwise. It adds folder entries (what archivers write) and a short
//!   archive comment (the commit ID of `git archive` and GitHub's
//!   "Download ZIP"), refuses links and special files, hidden or trailing
//!   bytes, ZIP64 extra fields, entry comments, names Windows cannot use
//!   (`\` named apart, as PowerShell 5.1 writes it) and abnormal
//!   compression ratios.
//!
//! The reader trusts nothing an archive declares: every entry is checked
//! before any byte is inflated, and one entry is then extracted within its
//! declared size and CRC-32. Always required: one disk, no ZIP64, no
//! encryption, stored or deflated entries, the central directory right
//! before its end record, no other archive comment, relative names of
//! safe components, local headers that agree with the central directory,
//! entries that do not overlap. This file depends on nothing else in the
//! crate: the `creator_tools_zip` and `source_zip` fuzz targets include it.

use std::io::{Read, Seek, SeekFrom, Write};

/// Bounds of one archive.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Files; folder entries, when accepted, are bounded separately by the
    /// same number.
    pub max_entries: usize,
    /// The largest uncompressed entry.
    pub max_entry_bytes: u64,
    /// The sum of every uncompressed entry.
    pub max_total_bytes: u64,
    /// The central directory: headers, names, extra fields.
    pub max_directory_bytes: u64,
}

/// What an archive may hold beyond the rules every archive follows.
#[derive(Clone, Copy, Debug)]
pub struct Rules {
    /// A name ending in `/` of size 0 is a folder entry: returned with
    /// `directory`, never needed to rebuild the tree.
    pub folders: bool,
    /// Unix and DOS attributes: links, reparse points, devices, FIFOs and
    /// sockets are refused, and only folder entries may say "folder".
    pub attributes: bool,
    /// No entry comment; extra fields of at most `MAX_EXTRA_BYTES` that are
    /// well-formed records and hold no ZIP64 field; entries (local header,
    /// name, extra field, data, data descriptor) that tile the archive from
    /// its first byte to the central directory, with no byte left over; a
    /// data descriptor that repeats the directory's CRC and sizes.
    pub strict_layout: bool,
    /// Names of printable ASCII that Windows can use (no final dot or
    /// space, no device name), unique without regard to case, and no file
    /// that is also a folder of another entry.
    pub portable_names: bool,
    /// An entry declared above `RATIO_FLOOR_BYTES` may not declare more
    /// than this many times its compressed size; and no entry may declare
    /// a size deflate cannot reach from its compressed size.
    pub max_ratio: Option<u64>,
    /// The longest archive comment, never read: GitHub's "Download ZIP" and
    /// `git archive` write the commit ID there. It may not hold an end
    /// record signature, so that one end record only ends the archive.
    pub max_comment_bytes: u16,
}

impl Rules {
    pub const CREATOR_TOOLS: Self = Self {
        folders: false,
        attributes: false,
        strict_layout: false,
        portable_names: false,
        max_ratio: None,
        max_comment_bytes: 0,
    };
    pub const SOURCES: Self = Self {
        folders: true,
        attributes: true,
        strict_layout: true,
        portable_names: true,
        max_ratio: Some(100),
        max_comment_bytes: 1024,
    };
}

/// One file (or folder) of the archive, checked against its local header.
#[derive(Clone, Debug)]
pub struct Entry {
    /// For a folder, without its final `/`.
    pub name: String,
    pub size: u64,
    pub directory: bool,
    compressed: u64,
    deflated: bool,
    crc32: u32,
    data_start: u64,
    /// Under `strict_layout`, the inflater must use every compressed byte:
    /// nothing may follow the end of the deflate stream.
    exact: bool,
}

/// Why an archive or an entry is refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZipError {
    Io,
    /// Not a ZIP this reader accepts; the text says which rule failed. The
    /// texts callers match are the constants of this module.
    Invalid(&'static str),
    /// An entry name that could leave the destination or clash on disk.
    UnsafeName,
    /// More bytes than the limits allow.
    TooLarge,
    /// More files (or folder entries) than the limits allow.
    TooManyEntries,
    /// A symbolic link or a reparse point.
    Link,
    /// A device, a FIFO or a socket.
    SpecialFile,
    /// A compression ratio no honest entry has.
    Bomb,
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io => formatter.write_str("the archive cannot be read"),
            Self::Invalid(rule) => write!(formatter, "invalid archive: {rule}"),
            Self::UnsafeName => formatter.write_str("the archive holds an unsafe file name"),
            Self::TooLarge => formatter.write_str("the archive exceeds its size bounds"),
            Self::TooManyEntries => formatter.write_str("the archive holds too many files"),
            Self::Link => formatter.write_str("the archive holds a link"),
            Self::SpecialFile => {
                formatter.write_str("the archive holds a device, a FIFO or a socket")
            }
            Self::Bomb => formatter.write_str("the archive declares an abnormal compression ratio"),
        }
    }
}

/// A refusal and the entry it concerns, when there is one (a name that
/// is not UTF-8 is given lossily).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub error: ZipError,
    pub entry: Option<String>,
}

impl From<ZipError> for Refused {
    fn from(error: ZipError) -> Self {
        Self { error, entry: None }
    }
}

/// Rule texts of [`ZipError::Invalid`] that callers tell apart.
pub const ZIP64: &str = "ZIP64";
pub const ENCRYPTED: &str = "encrypted entry";
pub const DUPLICATE: &str = "duplicate entry";
pub const FILE_IS_FOLDER: &str = "a file and a folder of the same name";
pub const ARCHIVE_COMMENT: &str = "archive comment";
/// A name with `\` between folders, as Windows PowerShell 5.1
/// `Compress-Archive` writes them (under `portable_names`).
pub const BACKSLASH: &str = "backslash in a name";
pub const ENTRY_COMMENT: &str = "entry comment";
pub const HIDDEN_DATA: &str = "bytes outside the entries";
pub const LARGER_THAN_DECLARED: &str = "entry larger than declared";

const END_SIGNATURE: u32 = 0x0605_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const DESCRIPTOR_SIGNATURE: u32 = 0x0807_4b50;
const ZIP64_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const ZIP64_EXTRA_ID: u16 = 0x0001;
const STRONG_ENCRYPTION_EXTRA_ID: u16 = 0x0017;
const AES_EXTRA_ID: u16 = 0x9901;
/// Info-ZIP's Unicode path and comment fields: another name for the entry.
const UNICODE_PATH_EXTRA_ID: u16 = 0x7075;
const UNICODE_COMMENT_EXTRA_ID: u16 = 0x6375;
const END_BYTES: u64 = 22;
const CENTRAL_BYTES: usize = 46;
const LOCAL_BYTES: usize = 30;
/// Encryption (bit 0), strong encryption (bit 6), masked headers (bit 13).
const ENCRYPTED_FLAGS: u16 = 1 | 1 << 6 | 1 << 13;
/// The flags this reader understands: encryption ones (refused), deflate
/// options (bits 1-2), data descriptor (bit 3), UTF-8 names (bit 11).
const KNOWN_FLAGS: u16 = ENCRYPTED_FLAGS | 0b110 | 1 << 3 | 1 << 11;
const DESCRIPTOR_FLAG: u16 = 1 << 3;
/// The AES encryption of WinZip and 7-Zip, written as a method.
const AES_METHOD: u16 = 99;
const MAX_NAME_BYTES: usize = 255;
/// The extra field of one header, under `strict_layout`: timestamps,
/// Unix owners and NTFS times take a few dozen bytes.
pub const MAX_EXTRA_BYTES: usize = 1024;
/// Entries declared at most this large are never refused for their ratio:
/// `extract` bounds them anyway.
pub const RATIO_FLOOR_BYTES: u64 = 1 << 20;
/// The most deflate can expand (258 bytes per 2-bit code, about 1032:1),
/// with room for a block header.
const DEFLATE_MAX_RATIO: u64 = 1032;
const DEFLATE_SLACK_BYTES: u64 = 64;
/// File type bits of a Unix mode.
const UNIX_TYPE: u32 = 0o170_000;
const UNIX_REGULAR: u32 = 0o100_000;
const UNIX_FOLDER: u32 = 0o040_000;
const UNIX_LINK: u32 = 0o120_000;
/// Hosts of "version made by" whose high attribute bytes are a Unix mode.
const UNIX_HOSTS: [u8; 2] = [3, 19];
/// 7-Zip's flag saying the high attribute bytes are a Unix mode.
const UNIX_EXTENSION_FLAG: u32 = 0x8000;
const DOS_FOLDER: u32 = 0x10;
const DOS_REPARSE_POINT: u32 = 0x400;

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

/// A component of printable ASCII that Windows keeps as written: no final
/// dot or space, and no device name, whatever its case and extension
/// (`con`, `NUL.txt`, `com1.json`). [`safe_name`] already refused the
/// other characters Windows forbids.
pub fn portable_component(component: &str) -> bool {
    if component.ends_with(['.', ' '])
        || !component.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
    {
        return false;
    }
    let stem = component
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ')
        .to_ascii_lowercase();
    let numbered = stem.len() == 4
        && (stem.starts_with("com") || stem.starts_with("lpt"))
        && stem.as_bytes()[3].is_ascii_digit();
    !(numbered
        || matches!(
            stem.as_str(),
            "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
        ))
}

/// Checks that `extra` is a sequence of `(id, size, data)` records without
/// a ZIP64 one.
fn check_extra(extra: &[u8]) -> Result<(), ZipError> {
    if extra.len() > MAX_EXTRA_BYTES {
        return Err(ZipError::Invalid("oversized extra field"));
    }
    let mut cursor = 0;
    while cursor < extra.len() {
        let record = extra
            .get(cursor..cursor + 4)
            .ok_or(ZipError::Invalid("malformed extra field"))?;
        match u16_at(record, 0) {
            ZIP64_EXTRA_ID => return Err(ZipError::Invalid(ZIP64)),
            AES_EXTRA_ID | STRONG_ENCRYPTION_EXTRA_ID => {
                return Err(ZipError::Invalid(ENCRYPTED));
            }
            // Another name or comment than the one checked and reviewed.
            UNICODE_PATH_EXTRA_ID | UNICODE_COMMENT_EXTRA_ID => {
                return Err(ZipError::Invalid("alternate name or comment field"));
            }
            _ => {}
        }
        cursor += 4 + usize::from(u16_at(record, 2));
    }
    if cursor != extra.len() {
        return Err(ZipError::Invalid("malformed extra field"));
    }
    Ok(())
}

/// The kind of entry its attributes allow, under `rules.attributes`.
fn check_attributes(made_by: u16, attributes: u32, folder: bool) -> Result<(), ZipError> {
    let host = (made_by >> 8) as u8;
    if attributes & DOS_REPARSE_POINT != 0 {
        return Err(ZipError::Link);
    }
    if attributes & DOS_FOLDER != 0 && !folder {
        return Err(ZipError::Invalid("folder attributes on a file"));
    }
    let mode = if UNIX_HOSTS.contains(&host) || attributes & UNIX_EXTENSION_FLAG != 0 {
        attributes >> 16
    } else {
        0
    };
    match mode & UNIX_TYPE {
        0 => Ok(()),
        UNIX_REGULAR if !folder => Ok(()),
        UNIX_FOLDER if folder => Ok(()),
        UNIX_REGULAR | UNIX_FOLDER => {
            Err(ZipError::Invalid("attributes disagree with the entry name"))
        }
        UNIX_LINK => Err(ZipError::Link),
        _ => Err(ZipError::SpecialFile),
    }
}

/// One central directory record, before its local header is read.
struct Pending {
    local_offset: u64,
    entry: Entry,
    flags: u16,
    method: u16,
    name_bytes: Vec<u8>,
}

/// Where the end record starts. Without a comment allowed, it is the last
/// 22 bytes. With one, it is the only end record whose comment length
/// reaches the end of the archive exactly, and that comment is within the
/// bound and holds no end record signature.
fn end_record<R: Read + Seek>(
    reader: &mut R,
    length: u64,
    max_comment: u16,
) -> Result<u64, ZipError> {
    let no_end = ZipError::Invalid("no end record at the end");
    if max_comment == 0 {
        let mut end = [0_u8; END_BYTES as usize];
        read_at(reader, length - END_BYTES, &mut end)?;
        if u32_at(&end, 0) != END_SIGNATURE {
            return Err(no_end);
        }
        if u16_at(&end, 20) != 0 {
            return Err(ZipError::Invalid(ARCHIVE_COMMENT));
        }
        return Ok(length - END_BYTES);
    }
    // Every comment length a record can declare, to name a long comment.
    let tail_length = length.min(END_BYTES + u64::from(u16::MAX));
    let mut tail = vec![0_u8; tail_length as usize];
    read_at(reader, length - tail_length, &mut tail)?;
    let signature = END_SIGNATURE.to_le_bytes();
    let mut found = None;
    for start in (0..=tail.len() - END_BYTES as usize).rev() {
        if tail[start..start + 4] != signature {
            continue;
        }
        let comment = &tail[start + END_BYTES as usize..];
        if usize::from(u16_at(&tail, start + 20)) != comment.len() {
            continue;
        }
        if found.is_some() {
            return Err(ZipError::Invalid(ARCHIVE_COMMENT));
        }
        if comment.len() > usize::from(max_comment)
            || comment.windows(4).any(|window| window == signature)
        {
            return Err(ZipError::Invalid(ARCHIVE_COMMENT));
        }
        found = Some(length - tail_length + start as u64);
    }
    found.ok_or(no_end)
}

/// Reads and checks the whole directory of an archive of `length` bytes
/// under the creator tools rules.
pub fn entries<R: Read + Seek>(
    reader: &mut R,
    length: u64,
    limits: Limits,
) -> Result<Vec<Entry>, ZipError> {
    entries_with(reader, length, limits, Rules::CREATOR_TOOLS).map_err(|refused| refused.error)
}

/// Reads and checks the whole directory of an archive of `length` bytes.
/// Entries come back in the order of their data.
pub fn entries_with<R: Read + Seek>(
    reader: &mut R,
    length: u64,
    limits: Limits,
    rules: Rules,
) -> Result<Vec<Entry>, Refused> {
    if length < END_BYTES {
        return Err(ZipError::Invalid("too short").into());
    }
    let end_offset = end_record(reader, length, rules.max_comment_bytes)?;
    let mut end = [0_u8; END_BYTES as usize];
    read_at(reader, end_offset, &mut end)?;
    let (disk, directory_disk) = (u16_at(&end, 4), u16_at(&end, 6));
    let (disk_entries, total_entries) = (u16_at(&end, 8), u16_at(&end, 10));
    let directory_size = u64::from(u32_at(&end, 12));
    let directory_offset = u64::from(u32_at(&end, 16));
    if disk_entries == u16::MAX
        || total_entries == u16::MAX
        || directory_size == u64::from(u32::MAX)
        || directory_offset == u64::from(u32::MAX)
    {
        return Err(ZipError::Invalid(ZIP64).into());
    }
    if end_offset >= 20 {
        let mut locator = [0_u8; 4];
        read_at(reader, end_offset - 20, &mut locator)?;
        if u32_at(&locator, 0) == ZIP64_LOCATOR_SIGNATURE {
            return Err(ZipError::Invalid(ZIP64).into());
        }
    }
    if disk != 0 || directory_disk != 0 || disk_entries != total_entries {
        return Err(ZipError::Invalid("several disks").into());
    }
    let most_entries = if rules.folders {
        limits.max_entries.saturating_mul(2)
    } else {
        limits.max_entries
    };
    if usize::from(total_entries) > most_entries {
        return Err(ZipError::TooManyEntries.into());
    }
    if directory_size > limits.max_directory_bytes {
        return Err(ZipError::TooLarge.into());
    }
    if directory_offset.checked_add(directory_size) != Some(end_offset) {
        return Err(ZipError::Invalid("central directory not before its end record").into());
    }
    let mut directory = vec![0_u8; directory_size as usize];
    read_at(reader, directory_offset, &mut directory)?;

    let mut found: Vec<Pending> = Vec::with_capacity(usize::from(total_entries));
    let mut seen = std::collections::HashSet::new();
    let (mut files, mut folders) = (0_usize, 0_usize);
    let mut total = 0_u64;
    let mut cursor = 0_usize;
    for _ in 0..total_entries {
        let header = directory
            .get(cursor..cursor + CENTRAL_BYTES)
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        if u32_at(header, 0) != CENTRAL_SIGNATURE {
            return Err(ZipError::Invalid("bad central header").into());
        }
        let made_by = u16_at(header, 4);
        let flags = u16_at(header, 8);
        let method = u16_at(header, 10);
        let crc32 = u32_at(header, 16);
        let compressed = u64::from(u32_at(header, 20));
        let size = u64::from(u32_at(header, 24));
        let name_length = usize::from(u16_at(header, 28));
        let extra_length = usize::from(u16_at(header, 30));
        let comment_length = usize::from(u16_at(header, 32));
        let disk_start = u16_at(header, 34);
        let attributes = u32_at(header, 38);
        let local_offset = u64::from(u32_at(header, 42));
        let name_start = cursor + CENTRAL_BYTES;
        let name_bytes = directory
            .get(name_start..name_start + name_length)
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        let shown = Some(String::from_utf8_lossy(name_bytes).into_owned());
        let refuse = |error: ZipError| Refused {
            error,
            entry: shown.clone(),
        };
        if flags & ENCRYPTED_FLAGS != 0 || method == AES_METHOD {
            return Err(refuse(ZipError::Invalid(ENCRYPTED)));
        }
        if flags & !KNOWN_FLAGS != 0 {
            return Err(refuse(ZipError::Invalid("unknown entry flags")));
        }
        let deflated = match method {
            0 => false,
            8 => true,
            _ => return Err(refuse(ZipError::Invalid("unsupported compression method"))),
        };
        if compressed == u64::from(u32::MAX)
            || size == u64::from(u32::MAX)
            || local_offset == u64::from(u32::MAX)
        {
            return Err(refuse(ZipError::Invalid(ZIP64)));
        }
        if disk_start != 0 {
            return Err(refuse(ZipError::Invalid("several disks")));
        }
        if !deflated && compressed != size {
            return Err(refuse(ZipError::Invalid("stored entry sizes differ")));
        }
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| refuse(ZipError::UnsafeName))?
            .to_owned();
        let folder_name = name.strip_suffix('/').filter(|_| rules.folders);
        let directory_entry = folder_name.is_some();
        let path = folder_name.unwrap_or(&name).to_owned();
        if rules.portable_names && path.contains('\\') {
            return Err(refuse(ZipError::Invalid(BACKSLASH)));
        }
        if !safe_name(&path) || (rules.portable_names && !path.split('/').all(portable_component)) {
            return Err(refuse(ZipError::UnsafeName));
        }
        // An empty deflate stream takes two bytes; a folder holds nothing
        // more (and `sourcetree` inflates it to check).
        if directory_entry && (size != 0 || crc32 != 0 || compressed > 2) {
            return Err(refuse(ZipError::Invalid("folder entry with data")));
        }
        if rules.attributes {
            check_attributes(made_by, attributes, directory_entry).map_err(refuse)?;
        }
        let extra_start = name_start + name_length;
        let extra = directory
            .get(extra_start..extra_start + extra_length)
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        if rules.strict_layout {
            if comment_length != 0 {
                return Err(refuse(ZipError::Invalid(ENTRY_COMMENT)));
            }
            check_extra(extra).map_err(refuse)?;
        }
        // Case-insensitive file systems would merge two such names; a
        // folder entry may repeat a folder another entry implies.
        let key = if rules.portable_names {
            path.to_ascii_lowercase()
        } else {
            path.to_lowercase()
        };
        if !seen.insert((directory_entry, key)) {
            return Err(refuse(ZipError::Invalid(DUPLICATE)));
        }
        cursor = name_start
            .checked_add(name_length + extra_length + comment_length)
            .filter(|end| *end <= directory.len())
            .ok_or(ZipError::Invalid("truncated central directory"))?;
        if directory_entry {
            folders += 1;
        } else {
            files += 1;
        }
        if files > limits.max_entries || folders > limits.max_entries {
            return Err(ZipError::TooManyEntries.into());
        }
        if size > limits.max_entry_bytes {
            return Err(refuse(ZipError::TooLarge));
        }
        total = total.checked_add(size).ok_or(ZipError::TooLarge)?;
        if total > limits.max_total_bytes {
            return Err(refuse(ZipError::TooLarge));
        }
        if let Some(ratio) = rules.max_ratio
            && (size
                > compressed
                    .saturating_mul(DEFLATE_MAX_RATIO)
                    .saturating_add(DEFLATE_SLACK_BYTES)
                || (size > RATIO_FLOOR_BYTES && size > compressed.saturating_mul(ratio)))
        {
            return Err(refuse(ZipError::Bomb));
        }
        found.push(Pending {
            local_offset,
            entry: Entry {
                name: path,
                size,
                directory: directory_entry,
                compressed,
                deflated,
                crc32,
                data_start: 0,
                exact: rules.strict_layout,
            },
            flags,
            method,
            name_bytes: name_bytes.to_vec(),
        });
    }
    if cursor != directory.len() {
        return Err(ZipError::Invalid("bytes after the central directory").into());
    }
    if rules.portable_names {
        check_file_folder_clashes(&found)?;
    }

    // Local headers: they must repeat the central directory, and the
    // entries must follow one another without overlapping (and, under
    // `strict_layout`, without any byte between them).
    found.sort_by_key(|pending| pending.local_offset);
    let starts: Vec<u64> = found
        .iter()
        .skip(1)
        .map(|pending| pending.local_offset)
        .chain([directory_offset])
        .collect();
    let mut next_free = 0_u64;
    let mut checked = Vec::with_capacity(found.len());
    for (pending, next_start) in found.into_iter().zip(starts) {
        let shown = Some(String::from_utf8_lossy(&pending.name_bytes).into_owned());
        let refuse = |error: ZipError| Refused {
            error,
            entry: shown.clone(),
        };
        if pending.local_offset < next_free {
            return Err(refuse(ZipError::Invalid("overlapping entries")));
        }
        if rules.strict_layout && pending.local_offset != next_free {
            return Err(refuse(ZipError::Invalid(HIDDEN_DATA)));
        }
        let data_start = check_local(reader, &pending, directory_offset, rules).map_err(refuse)?;
        let Pending {
            mut entry, flags, ..
        } = pending;
        let data_end = data_start
            .checked_add(entry.compressed)
            .filter(|end| *end <= directory_offset)
            .ok_or_else(|| refuse(ZipError::Invalid("entry data outside the archive")))?;
        entry.data_start = data_start;
        next_free = if rules.strict_layout {
            let descriptor = if flags & DESCRIPTOR_FLAG == 0 {
                0
            } else {
                descriptor_length(reader, &entry, data_end, next_start).map_err(refuse)?
            };
            if data_end + descriptor != next_start {
                return Err(refuse(ZipError::Invalid(HIDDEN_DATA)));
            }
            next_start
        } else {
            data_end
        };
        checked.push(entry);
    }
    if rules.strict_layout && checked.is_empty() && directory_offset != 0 {
        return Err(ZipError::Invalid(HIDDEN_DATA).into());
    }
    Ok(checked)
}

/// Under `portable_names`: every folder is spelled one way, whatever the
/// case (a case-insensitive file system would merge `Docs/` and `docs/`),
/// and no file is also a folder that another entry names or implies.
fn check_file_folder_clashes(found: &[Pending]) -> Result<(), Refused> {
    let refuse = |name: &str, rule: &'static str| Refused {
        error: ZipError::Invalid(rule),
        entry: Some(name.to_owned()),
    };
    // Lowercase folder path -> its spelling.
    let mut folders: std::collections::HashMap<String, &str> = std::collections::HashMap::new();
    for pending in found {
        let name = pending.entry.name.as_str();
        let mut folder = if pending.entry.directory {
            Some(name)
        } else {
            name.rsplit_once('/').map(|(parent, _)| parent)
        };
        while let Some(path) = folder {
            match folders.get(&path.to_ascii_lowercase()) {
                // Its parents were recorded with it.
                Some(spelling) if *spelling == path => break,
                Some(_) => return Err(refuse(name, DUPLICATE)),
                None => {
                    folders.insert(path.to_ascii_lowercase(), path);
                }
            }
            folder = path.rsplit_once('/').map(|(parent, _)| parent);
        }
    }
    match found.iter().find(|pending| {
        !pending.entry.directory && folders.contains_key(&pending.entry.name.to_ascii_lowercase())
    }) {
        Some(pending) => Err(refuse(&pending.entry.name, FILE_IS_FOLDER)),
        None => Ok(()),
    }
}

/// Checks the local header of `pending` against the central directory;
/// returns where its data starts.
fn check_local<R: Read + Seek>(
    reader: &mut R,
    pending: &Pending,
    directory_offset: u64,
    rules: Rules,
) -> Result<u64, ZipError> {
    let (local_offset, entry) = (pending.local_offset, &pending.entry);
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
    let disagrees = ZipError::Invalid("local header disagrees with the directory");
    if u16_at(&local, 6) != pending.flags || u16_at(&local, 8) != pending.method {
        return Err(disagrees);
    }
    // With a data descriptor (bit 3) the local fields may be zero; under
    // `strict_layout`, each is then zero or the directory's value, so that a
    // streaming reader sees what this one sees.
    let fields = [
        (u32_at(&local, 14), entry.crc32),
        (u32_at(&local, 18), entry.compressed as u32),
        (u32_at(&local, 22), entry.size as u32),
    ];
    let streamed = pending.flags & DESCRIPTOR_FLAG != 0;
    if fields.iter().any(|(local, central)| {
        local != central && (!streamed || (rules.strict_layout && *local != 0))
    }) {
        return Err(disagrees);
    }
    let name_length = u64::from(u16_at(&local, 26));
    let extra_length = u64::from(u16_at(&local, 28));
    if name_length != pending.name_bytes.len() as u64 {
        return Err(disagrees);
    }
    let mut local_name = vec![0_u8; pending.name_bytes.len()];
    read_at(reader, local_offset + LOCAL_BYTES as u64, &mut local_name)?;
    if local_name != pending.name_bytes {
        return Err(disagrees);
    }
    let extra_start = local_offset + LOCAL_BYTES as u64 + name_length;
    if rules.strict_layout {
        if extra_length > MAX_EXTRA_BYTES as u64 || extra_start + extra_length > directory_offset {
            return Err(ZipError::Invalid("oversized extra field"));
        }
        let mut extra = vec![0_u8; extra_length as usize];
        read_at(reader, extra_start, &mut extra)?;
        check_extra(&extra)?;
    }
    Ok(extra_start + extra_length)
}

/// Under `strict_layout`, the length of the data descriptor after an entry
/// whose data ends at `data_end`: 16 bytes with its signature or 12
/// without, repeating the directory's CRC and sizes, and ending exactly at
/// `next_start`.
fn descriptor_length<R: Read + Seek>(
    reader: &mut R,
    entry: &Entry,
    data_end: u64,
    next_start: u64,
) -> Result<u64, ZipError> {
    let room = next_start.saturating_sub(data_end);
    let fields = |bytes: &[u8]| {
        u32_at(bytes, 0) == entry.crc32
            && u64::from(u32_at(bytes, 4)) == entry.compressed
            && u64::from(u32_at(bytes, 8)) == entry.size
    };
    let mut bytes = [0_u8; 16];
    match room {
        16 => {
            read_at(reader, data_end, &mut bytes)?;
            if u32_at(&bytes, 0) == DESCRIPTOR_SIGNATURE && fields(&bytes[4..]) {
                return Ok(16);
            }
        }
        12 => {
            read_at(reader, data_end, &mut bytes[..12])?;
            if fields(&bytes) {
                return Ok(12);
            }
        }
        _ => {}
    }
    Err(ZipError::Invalid(
        "data descriptor disagrees with the directory",
    ))
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
    if entry.deflated {
        let mut decoder = flate2::read::DeflateDecoder::new(raw);
        copy_checked(&mut decoder, entry, output)?;
        if entry.exact && decoder.total_in() != entry.compressed {
            return Err(ZipError::Invalid(HIDDEN_DATA));
        }
        Ok(())
    } else {
        copy_checked(&mut { raw }, entry, output)
    }
}

/// Copies `source` to `output`: exactly the entry's declared size, with
/// its CRC-32.
fn copy_checked<W: Write>(
    source: &mut impl Read,
    entry: &Entry,
    output: &mut W,
) -> Result<(), ZipError> {
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
            return Err(ZipError::Invalid(LARGER_THAN_DECLARED));
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
        max_directory_bytes: 64 * 1024,
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
            ZipError::TooManyEntries
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

    // ------------------------------------------------------------ sources

    use crate::testzip::{self as zipwrite, Item};

    const SOURCE_LIMITS: Limits = Limits {
        max_entries: 2000,
        max_entry_bytes: 64 << 20,
        max_total_bytes: 64 << 20,
        max_directory_bytes: 4 << 20,
    };

    fn read_sources(bytes: &[u8]) -> Result<Vec<Entry>, Refused> {
        entries_with(
            &mut Cursor::new(bytes),
            bytes.len() as u64,
            SOURCE_LIMITS,
            Rules::SOURCES,
        )
    }

    fn refusal(bytes: &[u8]) -> ZipError {
        read_sources(bytes).expect_err("refused").error
    }

    fn widget() -> Vec<Item> {
        vec![
            Item::file("manifest.json", b"{\"id\": \"nova.lol-timers\"}"),
            Item::file("logic.ts", DATA),
            Item::stored("LICENSE", b"MIT"),
        ]
    }

    #[test]
    fn source_rules_accept_what_archivers_write() {
        let zip_r = zipwrite::archive(&[
            Item::folder("my-widget/"),
            Item::file("my-widget/manifest.json", b"{}").extra(&zipwrite::timestamp_extra()),
            Item::folder("my-widget/assets/"),
            Item::stored("my-widget/assets/icon.png", b"png"),
        ]);
        let found = read_sources(&zip_r).unwrap();
        assert_eq!(
            found
                .iter()
                .map(|entry| (entry.name.as_str(), entry.directory))
                .collect::<Vec<_>>(),
            [
                ("my-widget", true),
                ("my-widget/manifest.json", false),
                ("my-widget/assets", true),
                ("my-widget/assets/icon.png", false),
            ]
        );
        // Finder streams its entries with data descriptors; Explorer
        // writes DOS attributes.
        let finder = zipwrite::archive(&[
            Item::file("manifest.json", b"{}").descriptor(true),
            Item::file("logic.ts", DATA).descriptor(false),
        ]);
        let found = read_sources(&finder).unwrap();
        let mut output = Vec::new();
        extract(&mut Cursor::new(&finder), &found[1], &mut output).unwrap();
        assert_eq!(output, DATA);
        let explorer = zipwrite::archive(&[
            Item::folder("w/").windows(),
            Item::file("w/logic.ts", DATA).windows(),
        ]);
        assert!(read_sources(&explorer).is_ok());
        assert!(
            read_sources(&zipwrite::archive(&[])).is_ok(),
            "an empty archive"
        );
    }

    #[test]
    fn links_and_special_files_are_refused() {
        for (mode, error) in [
            (0o120_777, ZipError::Link),
            (0o010_644, ZipError::SpecialFile),
            (0o020_644, ZipError::SpecialFile),
            (0o060_644, ZipError::SpecialFile),
            (0o140_644, ZipError::SpecialFile),
        ] {
            let mut items = widget();
            items.push(Item::stored("escape", b"/etc/passwd").mode(mode));
            let refused = read_sources(&zipwrite::archive(&items)).unwrap_err();
            assert_eq!(refused.error, error, "{mode:o}");
            assert_eq!(refused.entry.as_deref(), Some("escape"));
        }
        let mut reparse = Item::stored("junction", b"").windows();
        reparse.attributes |= 0x400;
        assert_eq!(refusal(&zipwrite::archive(&[reparse])), ZipError::Link);
        // 7-Zip on Windows says the high bytes are a Unix mode.
        let mut seven = Item::stored("link", b"target").windows();
        seven.attributes = 0x8000 | 0o120_777 << 16;
        assert_eq!(refusal(&zipwrite::archive(&[seven])), ZipError::Link);
        // A file that says it is a folder, and the reverse.
        let mut items = widget();
        items.push(Item::stored("notes", b"x").mode(0o040_755));
        assert!(matches!(
            refusal(&zipwrite::archive(&items)),
            ZipError::Invalid(_)
        ));
        let mut items = widget();
        items.push(Item::folder("assets/").mode(0o100_644));
        assert!(matches!(
            refusal(&zipwrite::archive(&items)),
            ZipError::Invalid(_)
        ));
        // The creator tools reader does not look at attributes.
        let link = zipwrite::archive(&[Item::stored("tools/a", b"x").mode(0o120_777)]);
        assert!(read(&link).is_ok());
    }

    #[test]
    fn hidden_and_trailing_data_is_refused() {
        let hidden = ZipError::Invalid(HIDDEN_DATA);
        assert_eq!(
            refusal(&zipwrite::archive_with(&widget(), b"MZ stub", b"", b"")),
            hidden
        );
        assert_eq!(
            refusal(&zipwrite::archive_with(&widget(), b"", b"hidden", b"")),
            hidden
        );
        // A descriptor that lies about the CRC.
        let mut bytes = zipwrite::archive(&[Item::file("logic.ts", DATA).descriptor(true)]);
        let at = bytes
            .windows(4)
            .position(|window| window == [0x50, 0x4b, 7, 8])
            .unwrap();
        bytes[at + 4] ^= 0xff;
        assert!(matches!(refusal(&bytes), ZipError::Invalid(_)));
        // The creator tools reader accepts a prefix, as it always did.
        let stub = zipwrite::archive_with(&[Item::stored("tools/a", b"x")], b"stub", b"", b"");
        assert!(read(&stub).is_ok());
    }

    #[test]
    fn a_short_archive_comment_is_ignored() {
        // GitHub's "Download ZIP" and `git archive` write the commit ID.
        let commit = b"0b7f2c4e5a6d7c8b9a0f1e2d3c4b5a6978695a4b";
        let bytes = zipwrite::archive_with(&widget(), b"", b"", commit);
        let found = read_sources(&bytes).unwrap();
        assert_eq!(found.len(), 3);
        let mut output = Vec::new();
        extract(&mut Cursor::new(&bytes), &found[1], &mut output).unwrap();
        assert_eq!(output, DATA);
        let longest = vec![b'c'; usize::from(Rules::SOURCES.max_comment_bytes)];
        assert!(read_sources(&zipwrite::archive_with(&widget(), b"", b"", &longest)).is_ok());
    }

    #[test]
    fn long_or_ambiguous_archive_comments_are_refused() {
        let comment = ZipError::Invalid(ARCHIVE_COMMENT);
        let long = vec![b'c'; usize::from(Rules::SOURCES.max_comment_bytes) + 1];
        assert_eq!(
            refusal(&zipwrite::archive_with(&widget(), b"", b"", &long)),
            comment
        );
        // A comment that holds an end record could pass for another archive.
        let mut fake = b"PK\x05\x06".to_vec();
        fake.extend([0; 18]);
        assert_eq!(
            refusal(&zipwrite::archive_with(&widget(), b"", b"", &fake)),
            comment
        );
        let mut inside = b"see ".to_vec();
        inside.extend(&fake);
        assert_eq!(
            refusal(&zipwrite::archive_with(&widget(), b"", b"", &inside)),
            comment
        );
        // A byte after the comment it declares.
        let mut bytes = zipwrite::archive_with(&widget(), b"", b"", b"note");
        bytes.push(b'!');
        assert!(read_sources(&bytes).is_err());
        // Bytes between the directory and its end record stay hidden data.
        let mut bytes = zipwrite::archive_with(&widget(), b"", b"", b"note");
        let end = bytes.len() - 22 - 4;
        bytes.splice(end..end, *b"hide");
        assert!(read_sources(&bytes).is_err());
        // The creator tools reader still refuses any comment.
        let tools = zipwrite::archive_with(&[Item::stored("tools/a", b"x")], b"", b"", b"note");
        assert!(read(&tools).is_err());
    }

    #[test]
    fn zip64_extra_fields_and_entry_comments_are_refused() {
        let mut zip64 = vec![1, 0, 16, 0];
        zip64.extend([0; 16]);
        let mut items = widget();
        items[1] = Item::file("logic.ts", DATA).extra(&zip64);
        assert_eq!(
            refusal(&zipwrite::archive(&items)),
            ZipError::Invalid(ZIP64)
        );
        items[1] = Item::file("logic.ts", DATA).extra(&[0x55, 0x54, 9, 0, 1]);
        assert_eq!(
            refusal(&zipwrite::archive(&items)),
            ZipError::Invalid("malformed extra field")
        );
        items[1] = Item::file("logic.ts", DATA);
        items[1].comment = b"look here".to_vec();
        assert_eq!(
            refusal(&zipwrite::archive(&items)),
            ZipError::Invalid(ENTRY_COMMENT)
        );
        let mut bytes = zipwrite::archive(&[Item::stored("logic.ts", DATA)]);
        // Method 99 in both headers: WinZip's AES.
        bytes[8] = 99;
        let central = bytes.len() - 22 - (46 + 8);
        bytes[central + 10] = 99;
        assert_eq!(refusal(&bytes), ZipError::Invalid(ENCRYPTED));
    }

    #[test]
    fn source_names_are_portable_and_unique() {
        for name in [
            "assets/caf\u{e9}.png",
            "logic.ts\u{202e}",
            "a/con.txt",
            "a/NUL",
            "a/com1.json",
            "a/lpt9",
            "a/conin$",
            "a/x.",
            "a/x ",
            "../escape",
            "/etc/passwd",
            "C:x",
        ] {
            let mut items = widget();
            items.push(Item::stored(name, b"x"));
            assert_eq!(
                refusal(&zipwrite::archive(&items)),
                ZipError::UnsafeName,
                "{name:?}"
            );
        }
        // PowerShell 5.1 `Compress-Archive` separates folders with a backslash.
        for name in ["assets\\icon.png", "..\\escape"] {
            let mut items = widget();
            items.push(Item::stored(name, b"x"));
            let refused = read_sources(&zipwrite::archive(&items)).unwrap_err();
            assert_eq!(refused.error, ZipError::Invalid(BACKSLASH), "{name:?}");
            assert_eq!(refused.entry.as_deref(), Some(name));
        }
        // Not UTF-8: refused, and shown lossily.
        let mut bad = Item::stored("x", b"x");
        bad.name = vec![b'a', 0xff];
        let refused = read_sources(&zipwrite::archive(&[bad])).unwrap_err();
        assert_eq!(refused.error, ZipError::UnsafeName);
        assert_eq!(refused.entry.as_deref(), Some("a\u{fffd}"));
        for names in [
            ["logic.ts", "LOGIC.TS"],
            ["assets/a.png", "Assets/A.png"],
            ["assets", "assets/a.png"],
            ["Assets", "assets/a.png"],
        ] {
            let items: Vec<Item> = names.iter().map(|name| Item::stored(name, b"x")).collect();
            assert!(
                matches!(
                    refusal(&zipwrite::archive(&items)),
                    ZipError::Invalid(DUPLICATE | FILE_IS_FOLDER)
                ),
                "{names:?}"
            );
        }
        let clash = zipwrite::archive(&[Item::folder("notes/"), Item::stored("NOTES", b"x")]);
        assert_eq!(refusal(&clash), ZipError::Invalid(FILE_IS_FOLDER));
        // A folder entry next to the files it holds is not a duplicate.
        let fine =
            zipwrite::archive(&[Item::folder("assets/"), Item::stored("assets/a.png", b"x")]);
        assert!(read_sources(&fine).is_ok());
        assert!(portable_component("con-sole.ts") && portable_component("comic.ts"));
    }

    #[test]
    fn abnormal_ratios_are_bombs() {
        // 2 MiB of zeros deflate to about 2 KiB: a thousand to one.
        let zeros = vec![0_u8; 2 << 20];
        let bomb = zipwrite::archive(&[Item::file("data.json", &zeros)]);
        assert_eq!(refusal(&bomb), ZipError::Bomb);
        // Small entries are never refused for their ratio.
        let small = zipwrite::archive(&[Item::file("data.json", &zeros[..512 << 10])]);
        assert!(read_sources(&small).is_ok());
        // A size deflate cannot reach is a lie, even small.
        let mut lie = Item::file("data.json", b"tiny");
        lie.declared_size = Some(600 << 10);
        assert_eq!(refusal(&zipwrite::archive(&[lie])), ZipError::Bomb);
        // A size declared smaller than the data stops the inflater.
        let mut short = Item::file("data.json", &zeros[..64 << 10]);
        short.declared_size = Some(1024);
        let bytes = zipwrite::archive(&[short]);
        let found = read_sources(&bytes).unwrap();
        let mut output = Vec::new();
        assert_eq!(
            extract(&mut Cursor::new(&bytes), &found[0], &mut output).unwrap_err(),
            ZipError::Invalid(LARGER_THAN_DECLARED)
        );
        assert!(output.len() <= 1024 + 64 * 1024, "bounded by one buffer");
    }

    #[test]
    fn file_and_folder_counts_are_bounded_separately() {
        let names: Vec<String> = (0..2001).map(|index| format!("f/{index}.txt")).collect();
        let items: Vec<Item> = names.iter().map(|name| Item::stored(name, b"")).collect();
        assert_eq!(
            refusal(&zipwrite::archive(&items)),
            ZipError::TooManyEntries
        );
        let items: Vec<Item> = names[..2000]
            .iter()
            .map(|name| Item::stored(name, b""))
            .collect();
        let mut with_folders = items.clone();
        with_folders.extend((0..100).map(|index| Item::folder(&format!("d{index}/"))));
        assert!(read_sources(&zipwrite::archive(&with_folders)).is_ok());
        // 65 MiB declared: refused from the directory, before any inflating.
        let mut big = Item::stored("big.bin", b"");
        big.declared_size = Some(65 << 20);
        big.deflate = true;
        let refused = read_sources(&zipwrite::archive(&[big])).unwrap_err();
        assert_eq!(refused.error, ZipError::TooLarge);
    }

    #[test]
    fn creator_tools_rules_are_unchanged() {
        let folder = zipwrite::archive(&[Item::folder("tools/"), Item::stored("tools/a", b"x")]);
        assert_eq!(read(&folder).unwrap_err(), ZipError::UnsafeName);
        let accented = zipwrite::archive(&[Item::stored("tools/caf\u{e9}", b"x")]);
        assert!(read(&accented).is_ok());
        let backslash = zipwrite::archive(&[Item::stored("tools\\a", b"x")]);
        assert_eq!(read(&backslash).unwrap_err(), ZipError::UnsafeName);
    }

    #[test]
    fn nothing_may_hide_inside_an_entry() {
        // Bytes after the end of the deflate stream.
        let mut padded = Item::file("notes.txt", DATA);
        padded.trailing = vec![b'x'; 300];
        let bytes = zipwrite::archive(&[padded.clone()]);
        let found = read_sources(&bytes).unwrap();
        let mut output = Vec::new();
        assert_eq!(
            extract(&mut Cursor::new(&bytes), &found[0], &mut output).unwrap_err(),
            ZipError::Invalid(HIDDEN_DATA)
        );
        // The creator tools reader keeps its behavior.
        let bytes = zipwrite::archive(&[Item {
            name: b"tools/a".to_vec(),
            ..padded
        }]);
        let found = read(&bytes).unwrap();
        assert!(extract(&mut Cursor::new(&bytes), &found[0], &mut Vec::new()).is_ok());
        // A folder entry holds at most an empty deflate stream.
        let mut empty = Item::folder("docs/");
        empty.deflate = true;
        assert!(read_sources(&zipwrite::archive(&[empty.clone()])).is_ok());
        empty.trailing = vec![0; 64];
        assert!(matches!(
            refusal(&zipwrite::archive(&[empty])),
            ZipError::Invalid(_)
        ));
        // Another name in an Info-ZIP Unicode path field.
        let mut alias = vec![0x75, 0x70, 10, 0, 1, 0, 0, 0, 0];
        alias.extend(b"x.ts");
        alias.push(0);
        assert!(matches!(
            refusal(&zipwrite::archive(&[
                Item::file("logic.ts", DATA).extra(&alias)
            ])),
            ZipError::Invalid(_)
        ));
    }

    #[test]
    fn a_streamed_local_header_is_zero_or_the_truth() {
        let mut item = Item::file("logic.ts", DATA).descriptor(true);
        let truth = read_sources(&zipwrite::archive(&[item.clone()])).unwrap();
        assert_eq!(truth.len(), 1);
        item.local_fields = Some([1, 2, 3]);
        assert!(matches!(
            refusal(&zipwrite::archive(&[item.clone()])),
            ZipError::Invalid(_)
        ));
        // The creator tools reader does not look at them.
        item.name = b"tools/a".to_vec();
        assert!(read(&zipwrite::archive(&[item])).is_ok());
    }

    #[test]
    fn a_folder_has_one_spelling() {
        let bytes = zipwrite::archive(&[
            Item::stored("Docs/a.md", b"a"),
            Item::stored("docs/b.md", b"b"),
        ]);
        assert_eq!(refusal(&bytes), ZipError::Invalid(DUPLICATE));
        let bytes =
            zipwrite::archive(&[Item::folder("Assets/"), Item::stored("assets/a.png", b"x")]);
        assert_eq!(refusal(&bytes), ZipError::Invalid(DUPLICATE));
    }
}
