//! Writes the generated package, catalog and seed conformance fixtures and
//! the catalog v2 vectors:
//! `cargo run -p overcrow-widget-schema --example fixtures`.

use std::fs;
use std::io::ErrorKind;

// The tests use the whole generators; this example only writes.
#[allow(dead_code)]
#[path = "../tests/catalog_v2_gen/mod.rs"]
mod catalog_v2_gen;
#[allow(dead_code)]
#[path = "../tests/fixture_gen/mod.rs"]
mod fixture_gen;

fn main() {
    let root = fixture_gen::fixtures_root();
    for directory in fixture_gen::GENERATED_DIRS
        .iter()
        .chain(catalog_v2_gen::GENERATED_DIRS)
    {
        match fs::remove_dir_all(root.join(directory)) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                panic!("cannot clear {directory}: {error}")
            }
            _ => {}
        }
    }
    for (path, bytes) in fixture_gen::generate()
        .into_iter()
        .chain(catalog_v2_gen::generate())
    {
        let path = root.join(path);
        fs::create_dir_all(path.parent().expect("fixture paths have a parent"))
            .expect("create fixture directory");
        fs::write(&path, bytes).expect("write fixture");
    }
}
