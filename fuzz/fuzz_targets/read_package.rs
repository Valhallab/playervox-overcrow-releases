//! `.ocpkg` v1 reader: no input panics, and an accepted archive is exactly
//! what `write_package` produces from its files.
#![no_main]

use std::collections::BTreeMap;

use libfuzzer_sys::fuzz_target;
use overcrow_widget_schema::package::{read_package, write_package};

fuzz_target!(|data: &[u8]| {
    let Ok(package) = read_package(data) else {
        return;
    };
    let _ = overcrow_widget_format::validate_package_style(&package);
    let files: BTreeMap<String, Vec<u8>> = package
        .paths()
        .filter(|path| *path != "ledger.json")
        .map(|path| (path.to_owned(), package.file(path).unwrap_or_default().to_vec()))
        .collect();
    assert_eq!(write_package(&files).as_deref(), Ok(data));
});
