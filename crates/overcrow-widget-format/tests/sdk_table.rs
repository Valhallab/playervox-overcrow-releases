//! The end-to-end fixture of `@overcrow/sdk` (`sdk/test/e2e/`) matches the
//! compiler: its `clock.view.json` is the compiled `clock.ocml`, and
//! `clock.view.js` registers one function per expression in the calling
//! convention of `registerView` (docs/widget-source-formats.md).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use overcrow_widget_format::ocml::{Role, TemplateExpression, compile};

fn fixture(name: &str) -> Vec<u8> {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo");
    let path = PathBuf::from(manifest)
        .join("../../sdk/test/e2e")
        .join(name);
    fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// The table entry of one expression: scope names bound from `scope`,
/// `event` bound to the detail in a handler, then the canonical text.
fn entry(expression: &TemplateExpression) -> String {
    let handler = expression.role == Role::Handler;
    let mut out = format!(
        "  function (state, scope{}) {{\n",
        if handler { ", raw" } else { "" }
    );
    for name in &expression.scope {
        if handler && name == "event" {
            out.push_str("    const event = raw.detail;\n");
        } else {
            out.push_str(&format!("    const {name} = scope.{name};\n"));
        }
    }
    out.push_str(&format!("    return {};\n  }},\n", expression.expr.to_js()));
    out
}

#[test]
fn the_sdk_clock_fixture_follows_the_compiler() {
    let compiled = compile(&fixture("clock.ocml"), &BTreeSet::new()).expect("clock view");
    assert_eq!(
        String::from_utf8(compiled.json).expect("UTF-8"),
        String::from_utf8(fixture("clock.view.json")).expect("UTF-8"),
        "regenerate clock.view.json with the compile example"
    );
    let table = String::from_utf8(fixture("clock.view.js")).expect("UTF-8");
    let body = &table[table.find("registerView([\n").expect("registration") + 15..];
    let expected: String = compiled.expressions.iter().map(entry).collect();
    assert!(
        body.starts_with(&expected),
        "clock.view.js does not match the expression table:\n{expected}"
    );
    assert!(body[expected.len()..].starts_with("]);"));
    let bound = format!(
        "const {{ {} }} = logic;",
        compiled
            .functions
            .iter()
            .filter(|name| *name != "t")
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    );
    assert!(table.contains(&bound), "{bound}");
}
