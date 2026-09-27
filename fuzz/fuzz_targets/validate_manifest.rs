//! `manifest.json` v1 validator: no input panics, and an accepted manifest
//! revalidates identically from its own value.
#![no_main]

use libfuzzer_sys::fuzz_target;
use overcrow_widget_schema::manifest::{validate_manifest, validate_manifest_value};

fuzz_target!(|data: &[u8]| {
    if let Ok(manifest) = validate_manifest(data) {
        assert_eq!(validate_manifest_value(manifest.value.clone()), Ok(manifest));
    }
});
