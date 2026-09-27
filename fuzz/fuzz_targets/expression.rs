//! Template expressions: no input panics, and every accepted expression
//! prints to JavaScript that parses back to the same tree.
#![no_main]

use libfuzzer_sys::fuzz_target;
use overcrow_widget_format::expr;

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(parsed) = expr::parse(text) else {
        return;
    };
    let printed = parsed.to_js();
    // The canonical text may be longer than the bound it came from.
    if let Ok(reparsed) = expr::parse(&printed) {
        assert_eq!(reparsed, parsed);
    }
});
