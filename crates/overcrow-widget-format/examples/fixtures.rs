//! Writes the golden outputs of the valid view fixtures:
//! `cargo run -p overcrow-widget-format --example fixtures`.

use std::fs;
use std::io::ErrorKind;

#[path = "../tests/fixture_gen/mod.rs"]
mod fixture_gen;

fn main() {
    let root = fixture_gen::fixtures_root();
    match fs::remove_dir_all(root.join(fixture_gen::GENERATED_DIR)) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            panic!("cannot clear {}: {error}", fixture_gen::GENERATED_DIR)
        }
        _ => {}
    }
    for (path, bytes) in fixture_gen::generate() {
        let path = root.join(path);
        fs::create_dir_all(path.parent().expect("fixture paths have a parent"))
            .expect("create fixture directory");
        fs::write(&path, bytes).expect("write fixture");
    }
}
