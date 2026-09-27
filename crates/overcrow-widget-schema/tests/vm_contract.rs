//! VM contract of the schema: `Fault` categories, the `--heap-mib`
//! argument, `ref` names used by `Draw.canvas` and node-reference
//! attributes, and the encoding of `on` and `class` in scene patches. An
//! invalid fixture is named `<expected error>--<case>`; the IPC fixtures are
//! checked against `fixtures/view/valid/refs.json`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use overcrow_widget_schema::compiled_view::static_value;
use overcrow_widget_schema::compiled_view::{ViewSummary, inspect_compiled_view};
use overcrow_widget_schema::ipc::{
    FAILURES, FAULT_CATEGORIES, FAULT_CATEGORY_NAMES, IpcError, parse_vm_arguments, validate_draw,
    validate_fault, validate_patch_attribute,
};
use overcrow_widget_schema::json::parse_strict;
use overcrow_widget_schema::limits::{VM_HEAP_BYTES, VM_MAX_HEAP_BYTES};
use overcrow_widget_schema::view::{COMMON_ATTRIBUTES, element};
use serde_json::{Value, json};

fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn read(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap_or_else(|_| panic!("{} is readable", path.display()))
}

fn cases(area: &str) -> Vec<(String, Value)> {
    let directory = fixtures_root().join(area);
    let mut cases: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|_| panic!("{} exists", directory.display()))
        .map(|entry| {
            let path = entry.expect("fixture entry").path();
            let name = path
                .file_stem()
                .expect("fixture has a name")
                .to_string_lossy()
                .into_owned();
            let value = parse_strict(&read(&path), u64::MAX).expect("strict JSON fixture");
            (name, value)
        })
        .collect();
    cases.sort_by(|left, right| left.0.cmp(&right.0));
    assert!(!cases.is_empty(), "no {area} fixtures");
    cases
}

fn expected_error(name: &str) -> &str {
    name.split_once("--")
        .map(|(error, _)| error)
        .unwrap_or_else(|| panic!("{name} names its error"))
}

fn assets() -> BTreeSet<String> {
    BTreeSet::from(["assets/logo.png".to_owned()])
}

fn refs_view() -> ViewSummary {
    inspect_compiled_view(
        &read(&fixtures_root().join("view/valid/refs.json")),
        &assets(),
    )
    .expect("refs view")
}

#[test]
fn a_view_summary_lists_its_refs_and_handlers() {
    let view = refs_view();
    assert_eq!(view.expressions, 4);
    assert_eq!(
        view.refs,
        BTreeMap::from([
            ("chart".to_owned(), "canvas"),
            ("more".to_owned(), "button"),
            ("spark".to_owned(), "canvas"),
            ("toolbar".to_owned(), "box"),
        ])
    );
    assert_eq!(view.handlers, BTreeSet::from([0, 1]));
}

#[test]
fn fault_fixtures() {
    let view = refs_view();
    for (name, value) in cases("ipc/fault/valid") {
        validate_fault(&value, &view).unwrap_or_else(|error| panic!("{name}: {}", error.as_str()));
    }
    for (name, value) in cases("ipc/fault/invalid") {
        let error = validate_fault(&value, &view).expect_err(&name);
        assert_eq!(error.as_str(), expected_error(&name), "{name}");
    }
}

#[test]
fn draw_fixtures() {
    let view = refs_view();
    for (name, value) in cases("ipc/draw/valid") {
        validate_draw(&value, &view).unwrap_or_else(|error| panic!("{name}: {}", error.as_str()));
    }
    for (name, value) in cases("ipc/draw/invalid") {
        let error = validate_draw(&value, &view).expect_err(&name);
        assert_eq!(error.as_str(), expected_error(&name), "{name}");
    }
}

#[test]
fn fault_categories_are_closed_and_known_failures() {
    let names: Vec<&str> = FAULT_CATEGORIES
        .iter()
        .map(|category| category.name)
        .collect();
    assert_eq!(names, FAULT_CATEGORY_NAMES);
    let failures: Vec<&str> = FAILURES.iter().map(|failure| failure.name).collect();
    for category in FAULT_CATEGORIES {
        assert!(
            failures.contains(&category.name) || !category.fatal,
            "{}",
            category.name
        );
    }
    // The host's fallback when no fault arrives is not a fault category.
    assert!(failures.contains(&"vm_exited"));
    assert!(!names.contains(&"vm_exited"));
    let non_fatal: Vec<&str> = FAULT_CATEGORIES
        .iter()
        .filter(|category| !category.fatal)
        .map(|category| category.name)
        .collect();
    assert_eq!(non_fatal, ["handler_exception"]);
}

#[test]
fn heap_argument_is_whole_mib_within_the_vm_bounds() {
    const MIB: u64 = 1024 * 1024;
    let (min, max) = (VM_HEAP_BYTES.value / MIB, VM_MAX_HEAP_BYTES.value / MIB);
    for mib in [min, 32, max] {
        let text = mib.to_string();
        assert_eq!(parse_vm_arguments(&["--heap-mib", &text]), Ok(mib * MIB));
    }
    let below = (min - 1).to_string();
    let above = (max + 1).to_string();
    for arguments in [
        vec!["--heap-mib", below.as_str()],
        vec!["--heap-mib", above.as_str()],
        vec!["--heap-mib", "016"],
        vec!["--heap-mib", "+16"],
        vec!["--heap-mib", "16.0"],
        vec!["--heap-mib", ""],
        vec!["--heap-mib=16"],
        vec!["--heap-mib"],
        vec![],
        vec!["--heap", "16"],
        vec!["--heap-mib", "16", "--heap-mib", "16"],
        vec!["--heap-mib", "99999999999999999999999"],
    ] {
        assert_eq!(
            parse_vm_arguments(&arguments),
            Err(IpcError::Argument),
            "{arguments:?}"
        );
    }
}

#[test]
fn patch_attributes_use_the_view_encodings() {
    let view = refs_view();
    let assets = assets();
    let button = element("button").expect("button");
    let canvas = element("canvas").expect("canvas");
    let popover = element("popover").expect("popover");
    let common = |name: &str| {
        COMMON_ATTRIBUTES
            .iter()
            .find(|field| field.name == name)
            .expect("common attribute")
    };
    let anchor = popover
        .attributes
        .iter()
        .find(|field| field.name == "anchor")
        .expect("anchor");
    let check = |element, field, value: Value| {
        validate_patch_attribute(element, field, &value, &view, &assets).map_err(IpcError::as_str)
    };
    assert_eq!(
        check(
            button,
            common("on"),
            json!(["activate", "focus", "keydown"])
        ),
        Ok(())
    );
    assert_eq!(check(button, common("on"), json!([])), Ok(()));
    for invalid in [
        json!(["focus", "activate"]),
        json!(["activate", "activate"]),
        json!(["activate", "reachend"]),
        json!("activate"),
        json!([1]),
    ] {
        assert_eq!(
            check(button, common("on"), invalid.clone()),
            Err("invalid_attribute"),
            "{invalid}"
        );
    }
    assert_eq!(
        check(button, common("class"), json!("row selected")),
        Ok(())
    );
    for invalid in [
        json!("row row"),
        json!("row  selected"),
        json!(["row"]),
        json!("Row"),
    ] {
        assert_eq!(
            check(button, common("class"), invalid.clone()),
            Err("invalid_attribute"),
            "{invalid}"
        );
    }
    assert_eq!(check(canvas, common("ref"), json!("chart")), Ok(()));
    assert_eq!(
        check(canvas, common("ref"), json!("more")),
        Err("invalid_attribute")
    );
    assert_eq!(
        check(canvas, common("ref"), json!("missing")),
        Err("unknown_ref")
    );
    assert_eq!(check(popover, anchor, json!("toolbar")), Ok(()));
    assert_eq!(check(popover, anchor, json!("missing")), Err("unknown_ref"));
    assert_eq!(check(popover, anchor, json!(3)), Err("invalid_attribute"));
}

#[test]
fn span_colors_and_asset_handles_are_accepted_strictly() {
    let view = refs_view();
    let assets = assets();
    let span = element("span").expect("span");
    let image = element("image").expect("image");
    let field = |element: &'static overcrow_widget_schema::view::Element, name: &str| {
        element
            .attributes
            .iter()
            .find(|field| field.name == name)
            .expect("attribute")
    };
    let color = field(span, "color");
    let source = field(image, "src");
    let check = |element, field, value: Value| {
        validate_patch_attribute(element, field, &value, &view, &assets).map_err(IpcError::as_str)
    };
    assert_eq!(check(span, color, json!("#00ff7F")), Ok(()));
    for invalid in [
        json!("#00ff0g"),
        json!("#fff"),
        json!("#00ff7f00"),
        json!("00ff7f"),
        json!("red"),
        json!(7),
    ] {
        assert_eq!(
            check(span, color, invalid.clone()),
            Err("invalid_attribute"),
            "{invalid}"
        );
    }
    // A static colour in the view obeys the same rule.
    assert!(static_value(color.ty, &json!("#0a0B0c"), &assets).is_ok());
    assert!(static_value(color.ty, &json!("#0a0B0"), &assets).is_err());

    assert_eq!(check(image, source, json!("asset:abc-123_X")), Ok(()));
    let long = format!("asset:{}", "a".repeat(4096));
    for invalid in [
        json!("asset:"),
        json!("asset:a b"),
        json!("asset:\u{7f}"),
        json!(long),
        json!("https://example.com/a.png"),
        json!("assets/missing.png"),
    ] {
        assert_eq!(
            check(image, source, invalid.clone()),
            Err("invalid_attribute"),
            "{invalid}"
        );
    }
    // A view never names a host handle: handles exist only at run time.
    assert!(static_value(source.ty, &json!("asset:abc"), &assets).is_err());
}
