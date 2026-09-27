//! `style.ocss` parser: no input panics, and parsing is deterministic.
#![no_main]

use libfuzzer_sys::fuzz_target;
use overcrow_widget_format::ocss;

fuzz_target!(|data: &[u8]| {
    let first = ocss::parse(data);
    assert_eq!(first, ocss::parse(data));
});
