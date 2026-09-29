//! Compiles one `view.ocml` from standard input and prints, as JSON, the
//! canonical `view.json`, the expression table (role, names in scope,
//! canonical JavaScript) and the logic functions it calls:
//! `cargo run -p overcrow-widget-format --example compile < view.ocml`.
//! A development aid until the widget CLI (P2.2); `assets/` references are
//! not resolved.

use std::collections::BTreeSet;
use std::io::{self, Read, Write};
use std::process::ExitCode;

use overcrow_widget_format::ocml::{Role, compile};
use serde_json::json;

fn role(role: Role) -> &'static str {
    match role {
        Role::Text => "text",
        Role::Attribute => "attribute",
        Role::Handler => "handler",
        Role::Test => "test",
        Role::List => "list",
        Role::Key => "key",
        Role::Prop => "prop",
    }
}

fn main() -> ExitCode {
    let mut source = Vec::new();
    if io::stdin().read_to_end(&mut source).is_err() {
        return ExitCode::FAILURE;
    }
    let compiled = match compile(&source, &BTreeSet::new()) {
        Ok(compiled) => compiled,
        Err(error) => {
            eprintln!("{}", error.kind.as_str());
            return ExitCode::FAILURE;
        }
    };
    let expressions: Vec<_> = compiled
        .expressions
        .iter()
        .map(|expression| {
            json!({
                "role": role(expression.role),
                "scope": expression.scope,
                "js": expression.expr.to_js(),
            })
        })
        .collect();
    let output = json!({
        "view": String::from_utf8_lossy(&compiled.json),
        "expressions": expressions,
        "functions": compiled.functions,
    });
    let written = writeln!(io::stdout(), "{output:#}");
    if written.is_err() {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
