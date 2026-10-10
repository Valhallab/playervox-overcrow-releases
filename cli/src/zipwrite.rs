//! Writes the sources a creator sends (`overcrow-widget submit`) as a ZIP
//! the strict reader takes back unchanged: the validated files of a
//! [`crate::sourcetree::Tree`], sorted by path, without folder entries,
//! extra fields, comments, data descriptors or ZIP64, dated 1980-01-01 with
//! the mode 0644. The same files give the same bytes.

use std::collections::BTreeMap;
use std::io::Write as _;

use crate::zipread::RATIO_FLOOR_BYTES;

/// "Version made by": Unix, ZIP 3.0; the reader then reads the mode.
const MADE_BY: u16 = 0x031e;
/// "Version needed to extract": deflate.
const NEEDED: u16 = 20;
/// 1980-01-01 00:00 in MS-DOS time and date.
const DOS_TIME: u16 = 0;
const DOS_DATE: u16 = 0x0021;
/// A regular file, rw-r--r--, in the high bytes of the attributes.
const ATTRIBUTES: u32 = 0o100_644 << 16;
/// The ratio the reader allows above [`RATIO_FLOOR_BYTES`]
/// (`Rules::SOURCES`).
const MAX_RATIO: u64 = 100;

/// One entry: stored or deflated data and its central directory fields.
struct Written {
    name: Vec<u8>,
    method: u16,
    crc: u32,
    compressed: u32,
    size: u32,
    offset: u32,
}

/// The ZIP of `files` (paths with `/`, sorted by the map). The caller
/// keeps within the bounds of a source archive (2,000 files, 32 MiB), far
/// from the limits of a ZIP without ZIP64.
pub fn write(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut written = Vec::with_capacity(files.len());
    for (path, data) in files {
        let deflated = deflate(data);
        let size = data.len() as u64;
        // Stored when deflate does not shrink it, or shrinks it more than
        // the reader believes an honest file can be.
        let store = deflated.len() >= data.len()
            || (size > RATIO_FLOOR_BYTES && size > deflated.len() as u64 * MAX_RATIO);
        let (method, body) = if store {
            (0, data.as_slice())
        } else {
            (8, deflated.as_slice())
        };
        let entry = Written {
            name: path.as_bytes().to_vec(),
            method,
            crc: crc32fast::hash(data),
            compressed: body.len() as u32,
            size: data.len() as u32,
            offset: out.len() as u32,
        };
        out.extend(0x0403_4b50_u32.to_le_bytes());
        out.extend(NEEDED.to_le_bytes());
        out.extend(0_u16.to_le_bytes());
        common(&mut out, &entry);
        out.extend(0_u16.to_le_bytes());
        out.extend(&entry.name);
        out.extend(body);
        written.push(entry);
    }
    let directory_offset = out.len() as u32;
    for entry in &written {
        out.extend(0x0201_4b50_u32.to_le_bytes());
        out.extend(MADE_BY.to_le_bytes());
        out.extend(NEEDED.to_le_bytes());
        out.extend(0_u16.to_le_bytes());
        common(&mut out, entry);
        // Extra field, comment, disk, internal attributes.
        out.extend([0; 8]);
        out.extend(ATTRIBUTES.to_le_bytes());
        out.extend(entry.offset.to_le_bytes());
        out.extend(&entry.name);
    }
    let directory_size = out.len() as u32 - directory_offset;
    out.extend(0x0605_4b50_u32.to_le_bytes());
    out.extend([0; 4]);
    out.extend((written.len() as u16).to_le_bytes());
    out.extend((written.len() as u16).to_le_bytes());
    out.extend(directory_size.to_le_bytes());
    out.extend(directory_offset.to_le_bytes());
    out.extend(0_u16.to_le_bytes());
    out
}

/// Method, time, CRC, sizes and name length: the same in both headers.
fn common(out: &mut Vec<u8>, entry: &Written) {
    out.extend(entry.method.to_le_bytes());
    out.extend(DOS_TIME.to_le_bytes());
    out.extend(DOS_DATE.to_le_bytes());
    out.extend(entry.crc.to_le_bytes());
    out.extend(entry.compressed.to_le_bytes());
    out.extend(entry.size.to_le_bytes());
    out.extend((entry.name.len() as u16).to_le_bytes());
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    // Writing into a vector cannot fail.
    let _ = encoder.write_all(data);
    encoder.finish().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diag::Report;
    use crate::sourcetree;

    fn tree(files: &[(&str, &[u8])]) -> BTreeMap<String, Vec<u8>> {
        files
            .iter()
            .map(|(path, bytes)| ((*path).to_owned(), bytes.to_vec()))
            .collect()
    }

    fn read_back(bytes: &[u8]) -> sourcetree::Tree {
        let mut report = Report::default();
        sourcetree::read_archive_bytes(bytes, "widget.zip", &mut report)
            .unwrap_or_else(|| panic!("{:?}", report.diagnostics))
    }

    #[test]
    fn a_tree_reads_back_identically() {
        let files = tree(&[
            ("manifest.json", b"{\"id\": \"nova.lol-timers\"}"),
            (
                "logic.ts",
                b"export function tick() {}\n".repeat(50).as_slice(),
            ),
            ("LICENSE", b""),
            ("assets/icons/deep/a/b/c/x.png", b"\x89PNG\r\n\x1a\n"),
            ("locales/en.json", b"{}"),
        ]);
        let back = read_back(&write(&files));
        assert_eq!(back.files, files);
        assert!(back.ignored.is_empty());
        assert_eq!(back.archive.expect("an archive").prefix, None);
    }

    #[test]
    fn every_widget_of_the_repository_reads_back_identically() {
        let widgets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../widgets");
        let mut count = 0;
        for entry in std::fs::read_dir(&widgets).expect("widgets") {
            let root = entry.expect("entry").path();
            if !root.join("manifest.json").is_file() {
                continue;
            }
            let mut report = Report::default();
            let folder = sourcetree::read(&sourcetree::Input::Folder(root.clone()), &mut report)
                .unwrap_or_else(|| panic!("{}: {:?}", root.display(), report.diagnostics));
            assert_eq!(
                read_back(&write(&folder.files)).files,
                folder.files,
                "{}",
                root.display()
            );
            count += 1;
        }
        assert!(count >= 13, "{count} widgets");
    }

    #[test]
    fn the_same_tree_gives_the_same_bytes() {
        let files = tree(&[("manifest.json", b"{}"), ("logic.ts", b"export {};")]);
        assert_eq!(write(&files), write(&files.clone()));
        let other = tree(&[("manifest.json", b"{}"), ("logic.ts", b"export {}; ")]);
        assert_ne!(write(&files), write(&other));
    }

    #[test]
    fn a_large_file_that_compresses_too_well_is_stored() {
        // Deflate would reach about 1000:1, which the reader takes for a bomb.
        let zeros = vec![0_u8; 2 << 20];
        let files = tree(&[("manifest.json", b"{}"), ("data.json", &zeros)]);
        let bytes = write(&files);
        assert!(bytes.len() > 2 << 20, "stored, not deflated");
        assert_eq!(read_back(&bytes).files, files);
        // Below the reader's floor, it is deflated.
        let small = tree(&[("data.json", &zeros[..512 << 10])]);
        assert!(write(&small).len() < 64 << 10);
    }

    #[test]
    fn data_deflate_cannot_shrink_is_stored() {
        // A xorshift sequence: no pattern deflate could use.
        let mut state = 0x2545_f491_u32;
        let noise: Vec<u8> = (0..4096)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as u8
            })
            .collect();
        let files = tree(&[("assets/noise.bin", &noise)]);
        let bytes = write(&files);
        // One local header, the data, one central header, the end record.
        let name = "assets/noise.bin".len();
        assert_eq!(bytes.len(), 30 + name + noise.len() + 46 + name + 22);
        assert_eq!(read_back(&bytes).files, files);
    }
}
