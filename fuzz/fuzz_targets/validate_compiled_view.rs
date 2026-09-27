//! `view.json` validator: no input panics.
#![no_main]

use std::collections::BTreeSet;

use libfuzzer_sys::fuzz_target;
use overcrow_widget_schema::compiled_view::validate_compiled_view;

fuzz_target!(|data: &[u8]| {
    let assets = BTreeSet::from(["assets/logo.png".to_owned()]);
    let _ = validate_compiled_view(data, &assets);
});
