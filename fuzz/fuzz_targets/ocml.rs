//! `view.ocml` compiler: no input panics, and whatever compiles is a view
//! the host accepts, deterministic, with expressions that round-trip.
#![no_main]

use std::collections::BTreeSet;

use libfuzzer_sys::fuzz_target;
use overcrow_widget_format::{expr, ocml};
use overcrow_widget_schema::compiled_view::validate_compiled_view;
use overcrow_widget_schema::limits::MAX_EXPRESSION_BYTES;

fuzz_target!(|data: &[u8]| {
    let assets = BTreeSet::from(["assets/logo.png".to_owned()]);
    let Ok(view) = ocml::compile(data, &assets) else {
        return;
    };
    assert!(validate_compiled_view(&view.json, &assets).is_ok());
    assert_eq!(ocml::compile(data, &assets).as_ref(), Ok(&view));
    for expression in &view.expressions {
        // Parentheses and spacing can lengthen the canonical text past the
        // source bound; within it, the text must parse to the same tree.
        let text = expression.expr.to_js();
        if text.len() as u64 <= MAX_EXPRESSION_BYTES.value {
            assert_eq!(expr::parse(&text).as_ref(), Ok(&expression.expr));
        }
    }
});
