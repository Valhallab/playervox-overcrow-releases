//! Writes the generated TypeScript sources of `@overcrow/sdk` under
//! `sdk/src/generated/`, relative to the current directory (the repository
//! root): `cargo run -p overcrow-widget-schema --example sdk-types`.

use std::fs;
use std::path::Path;

use overcrow_widget_schema::typescript::{OUTPUT_DIR, files};

fn main() -> std::io::Result<()> {
    let directory = Path::new(OUTPUT_DIR);
    fs::create_dir_all(directory)?;
    for (name, content) in files() {
        fs::write(directory.join(name), content)?;
    }
    Ok(())
}
