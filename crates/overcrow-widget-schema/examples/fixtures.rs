//! Writes the generated package, catalog and seed conformance fixtures:
//! `cargo run -p overcrow-widget-schema --example fixtures`.

use std::fs;
use std::io::ErrorKind;

// The conformance test uses the whole generator; this example only writes.
#[allow(dead_code)]
#[path = "../tests/fixture_gen/mod.rs"]
mod fixture_gen;

fn main() {
    let root = fixture_gen::fixtures_root();
    for directory in fixture_gen::GENERATED_DIRS {
        match fs::remove_dir_all(root.join(directory)) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                panic!("cannot clear {directory}: {error}")
            }
            _ => {}
        }
    }
    for (path, bytes) in fixture_gen::generate() {
        let path = root.join(path);
        fs::create_dir_all(path.parent().expect("fixture paths have a parent"))
            .expect("create fixture directory");
        fs::write(&path, bytes).expect("write fixture");
    }
}
