//! The CLI's reader of the publish API's answers
//! (`cli/src/publish/api.rs`, used by `overcrow-widget submit` and
//! `status`): no input panics, whatever the server or a proxy sends, and a
//! version read is renamed to camelCase without panicking either.
#![no_main]

use libfuzzer_sys::fuzz_target;

#[path = "../../cli/src/publish/api.rs"]
#[allow(dead_code)]
mod api;

fuzz_target!(|data: &[u8]| {
    let _ = api::parse_key(data);
    let _ = api::parse_context(data);
    let _ = api::parse_submission(data);
    let _ = api::parse_error(data);
    if let Ok(finalized) = api::parse_finalized(data) {
        let _ = api::camelize(&finalized.version.value);
    }
    if let Ok(version) = api::parse_version(data) {
        let _ = api::camelize(&version.value);
    }
    if let Ok(versions) = api::parse_versions(data) {
        for version in versions {
            let _ = api::camelize(&version.value);
        }
    }
});
