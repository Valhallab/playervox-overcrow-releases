//! Golden outputs of the valid `view.ocml` fixtures: the compiled
//! `view.json` and the expression table. `cargo run -p
//! overcrow-widget-format --example fixtures` writes them; the conformance
//! test regenerates them in memory and requires the committed files to be
//! identical.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use overcrow_widget_format::ocml::compile;

/// Directory owned by this generator; the example rewrites it entirely.
pub const GENERATED_DIR: &str = "ocml/compiled";

pub fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// The package files every fixture view may name.
pub fn assets() -> BTreeSet<String> {
    BTreeSet::from(["assets/logo.png".to_owned()])
}

/// Relative path → bytes of every golden output.
pub fn generate() -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut sources: Vec<_> = fs::read_dir(fixtures_root().join("ocml/valid"))
        .expect("ocml/valid exists")
        .map(|entry| entry.expect("fixture entry").path())
        .collect();
    sources.sort();
    for path in sources {
        let name = path
            .file_stem()
            .expect("fixture has a name")
            .to_string_lossy()
            .into_owned();
        let source = fs::read(&path).expect("fixture is readable");
        let view = compile(&source, &assets()).unwrap_or_else(|error| {
            panic!("{name}: {} at {:?}", error.kind.as_str(), error.position)
        });
        let mut json = view.json.clone();
        json.push(b'\n');
        out.insert(format!("{GENERATED_DIR}/{name}.view.json"), json);
        let mut table = String::new();
        for (index, expression) in view.expressions.iter().enumerate() {
            table.push_str(&format!(
                "{index}\t{:?}\t[{}]\t{}\n",
                expression.role,
                expression.scope.join(", "),
                expression.expr.to_js()
            ));
        }
        table.push_str(&format!("functions\t{}\n", view.functions.join(", ")));
        out.insert(
            format!("{GENERATED_DIR}/{name}.expressions.txt"),
            table.into_bytes(),
        );
    }
    out
}
