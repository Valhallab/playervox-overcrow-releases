//! The CLI's reader of creator source archives (`cli/src/zipread.rs` under
//! `Rules::SOURCES`): no input panics; an accepted archive holds only
//! relative, portable names, unique without regard to case, no file that
//! is also a folder; an accepted entry never comes out larger than
//! declared.
#![no_main]

use std::collections::HashSet;
use std::io::Cursor;

use libfuzzer_sys::fuzz_target;

#[path = "../../cli/src/zipread.rs"]
#[allow(dead_code)]
mod zipread;

const LIMITS: zipread::Limits = zipread::Limits {
    max_entries: 64,
    max_entry_bytes: 1 << 20,
    max_total_bytes: 4 << 20,
    max_directory_bytes: 64 * 1024,
};

fuzz_target!(|data: &[u8]| {
    let mut reader = Cursor::new(data);
    let Ok(entries) = zipread::entries_with(
        &mut reader,
        data.len() as u64,
        LIMITS,
        zipread::Rules::SOURCES,
    ) else {
        return;
    };
    let mut names = HashSet::new();
    for entry in &entries {
        assert!(!entry.name.starts_with('/'));
        assert!(entry.name.split('/').all(|component| {
            !component.is_empty()
                && component != "."
                && component != ".."
                && zipread::portable_component(component)
        }));
        assert!(names.insert(entry.name.to_ascii_lowercase()));
    }
    for entry in entries.iter().filter(|entry| !entry.directory) {
        let lower = entry.name.to_ascii_lowercase();
        assert!(!entries.iter().any(|other| {
            other
                .name
                .to_ascii_lowercase()
                .strip_prefix(&lower)
                .is_some_and(|rest| rest.starts_with('/'))
        }));
        let mut output = Vec::new();
        if zipread::extract(&mut reader, entry, &mut output).is_ok() {
            assert_eq!(output.len() as u64, entry.size);
        }
        assert!(output.len() as u64 <= entry.size);
    }
});
