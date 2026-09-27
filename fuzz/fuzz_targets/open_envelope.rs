//! Catalog and seed envelopes and payloads: no input panics. Signatures are
//! verified by the host, so the payload validators are fuzzed directly.
#![no_main]

use libfuzzer_sys::fuzz_target;
use overcrow_widget_schema::catalog::{
    Document, Origin, open_envelope, validate_catalog, validate_seed,
};

/// 2026-10-01T00:00:00Z, the clock of the conformance fixtures.
const NOW: i64 = 1_790_812_800;

fuzz_target!(|data: &[u8]| {
    for document in [Document::Catalog, Document::Seed] {
        if let Ok(envelope) = open_envelope(data, document) {
            assert!(envelope.signed_message().starts_with(document.domain()));
            let _ = validate_catalog(&envelope.payload, NOW, Origin::Production);
        }
    }
    for origin in [Origin::Production, Origin::Development] {
        let _ = validate_catalog(data, NOW, origin);
        let _ = validate_seed(data, NOW, origin);
    }
});
