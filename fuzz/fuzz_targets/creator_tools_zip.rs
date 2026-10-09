//! The CLI's reader of the creator tools ZIP (`cli/src/zipread.rs`, the
//! archive its runtime download comes from): no input panics, and an
//! accepted entry never comes out larger than declared.
#![no_main]

use std::io::Cursor;

use libfuzzer_sys::fuzz_target;

#[path = "../../cli/src/zipread.rs"]
#[allow(dead_code)]
mod zipread;

const LIMITS: zipread::Limits = zipread::Limits {
    max_entries: 64,
    max_entry_bytes: 1 << 20,
    max_total_bytes: 4 << 20,
};

fuzz_target!(|data: &[u8]| {
    let mut reader = Cursor::new(data);
    let Ok(entries) = zipread::entries(&mut reader, data.len() as u64, LIMITS) else {
        return;
    };
    for entry in &entries {
        let mut output = Vec::new();
        if zipread::extract(&mut reader, entry, &mut output).is_ok() {
            assert_eq!(output.len() as u64, entry.size);
        }
        assert!(output.len() as u64 <= entry.size);
    }
});
