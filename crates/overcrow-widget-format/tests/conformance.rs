//! Conformance of the `view.ocml` compiler and the `style.ocss` parser: the
//! valid fixtures are accepted (views compile to their committed golden
//! outputs), every invalid fixture is rejected with the category that
//! prefixes its name (`<expected error>--<case>`), and every bound is
//! accepted at its `limits` value and rejected one past it.

mod fixture_gen;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use overcrow_widget_format::expr;
use overcrow_widget_format::ocml::{self, compile};
use overcrow_widget_format::ocss::{self, Combinator, Value};
use overcrow_widget_schema::compiled_view::validate_compiled_view;
use overcrow_widget_schema::json::parse_strict;
use overcrow_widget_schema::limits::{
    MAX_CHILDREN, MAX_COMPONENT_PROPS, MAX_COMPONENTS, MAX_DECLARATIONS_PER_RULE,
    MAX_EXPRESSION_BYTES, MAX_EXPRESSION_DEPTH, MAX_KEYFRAME_STOPS, MAX_KEYFRAMES,
    MAX_NODE_TEXT_BYTES, MAX_STYLE_RULES, MAX_STYLE_SOURCE_BYTES, MAX_TREE_DEPTH,
    MAX_VIEW_ELEMENTS, MAX_VIEW_EXPRESSIONS, MAX_VIEW_SOURCE_BYTES,
};
use overcrow_widget_schema::style::{PROPERTIES, PSEUDO_CLASSES, StyleValue};
use overcrow_widget_schema::tokens::{TOKENS, TokenType};
use overcrow_widget_schema::view::ELEMENTS;

use fixture_gen::{assets, fixtures_root};

/// `(case name, path)` of every file of `fixtures/<area>/<kind>`, sorted.
fn cases(area: &str, kind: &str) -> Vec<(String, PathBuf)> {
    let directory = fixtures_root().join(area).join(kind);
    let mut cases: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|_| panic!("{} exists", directory.display()))
        .map(|entry| {
            let path = entry.expect("fixture entry").path();
            let name = path
                .file_stem()
                .expect("fixture has a name")
                .to_string_lossy()
                .into_owned();
            (name, path)
        })
        .collect();
    cases.sort();
    assert!(!cases.is_empty(), "no {area}/{kind} fixtures");
    cases
}

fn expected_error(name: &str) -> &str {
    name.split_once("--")
        .map(|(error, _)| error)
        .unwrap_or_else(|| panic!("{name} names its error"))
}

fn read(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap_or_else(|_| panic!("{} is readable", path.display()))
}

fn view_error(source: &str) -> Result<(), &'static str> {
    compile(source.as_bytes(), &assets())
        .map(|_| ())
        .map_err(|error| error.kind.as_str())
}

fn style_error(source: &str) -> Result<(), &'static str> {
    ocss::parse(source.as_bytes())
        .map(|_| ())
        .map_err(|error| error.kind.as_str())
}

fn count(limit: u64) -> usize {
    usize::try_from(limit).expect("limits fit usize")
}

// ---------------------------------------------------------------------------
// view.ocml

#[test]
fn generated_view_goldens_are_current_and_deterministic() {
    let generated = fixture_gen::generate();
    assert_eq!(
        generated,
        fixture_gen::generate(),
        "compilation is deterministic"
    );
    let root = fixtures_root();
    let mut committed = std::collections::BTreeMap::new();
    for entry in fs::read_dir(root.join(fixture_gen::GENERATED_DIR)).expect("goldens exist") {
        let path = entry.expect("golden entry").path();
        let relative = path.strip_prefix(&root).expect("inside fixtures");
        committed.insert(relative.to_string_lossy().into_owned(), read(&path));
    }
    assert!(
        generated == committed,
        "run `cargo run -p overcrow-widget-format --example fixtures`"
    );
}

#[test]
fn valid_views_compile_to_views_the_host_accepts() {
    for (name, path) in cases("ocml", "valid") {
        let view = compile(&read(&path), &assets())
            .unwrap_or_else(|error| panic!("{name}: {}", error.kind.as_str()));
        validate_compiled_view(&view.json, &assets())
            .unwrap_or_else(|error| panic!("{name}: {}", error.as_str()));
        let expressions = parse_strict(&view.json, u64::MAX).expect("strict JSON")["expressions"]
            .as_u64()
            .expect("expression count");
        assert_eq!(expressions, view.expressions.len() as u64, "{name}");
        // Every expression's JavaScript text parses back to the same tree.
        for expression in &view.expressions {
            assert_eq!(
                expr::parse(&expression.expr.to_js()).as_ref(),
                Ok(&expression.expr),
                "{name}"
            );
        }
    }
}

#[test]
fn invalid_views_are_rejected_with_their_category() {
    for (name, path) in cases("ocml", "invalid") {
        let error = compile(&read(&path), &assets())
            .map(|_| ())
            .expect_err(&name)
            .kind
            .as_str();
        assert_eq!(error, expected_error(&name), "{name}");
    }
}

#[test]
fn the_clock_view_compiles_to_the_package_fixture() {
    let compiled = compile(
        &read(&fixtures_root().join("ocml/valid/clock.ocml")),
        &assets(),
    )
    .expect("clock view");
    let schema_fixture =
        fixtures_root().join("../../overcrow-widget-schema/fixtures/package-src/clock/view.json");
    let expected = parse_strict(&read(&schema_fixture), u64::MAX).expect("package view");
    let actual = parse_strict(&compiled.json, u64::MAX).expect("compiled view");
    assert_eq!(actual, expected);
}

#[test]
fn errors_point_at_the_offending_source() {
    let error = compile(b"<box>\n  <text>ok</text>\n  <div/>\n</box>", &assets()).unwrap_err();
    assert_eq!(error.kind.as_str(), "unknown_element");
    assert_eq!((error.position.line, error.position.column), (3, 3));
    let error = compile("<text>é {state.a = 1}</text>".as_bytes(), &assets()).unwrap_err();
    assert_eq!(error.kind.as_str(), "expression_syntax");
    assert_eq!((error.position.line, error.position.column), (1, 18));
}

fn nested(depth: usize) -> String {
    format!("{}{}", "<box>".repeat(depth), "</box>".repeat(depth))
}

#[test]
fn view_bounds_come_from_the_limits() {
    let depth = count(MAX_TREE_DEPTH.value);
    assert_eq!(view_error(&nested(depth)), Ok(()));
    assert_eq!(view_error(&nested(depth + 1)), Err("too_deep"));
    // Constructs nest like elements.
    let construct = format!(
        "{}<box/>{}",
        "<if test={state.a}>".repeat(depth - 1),
        "</if>".repeat(depth - 1)
    );
    assert_eq!(view_error(&construct), Ok(()));
    assert_eq!(
        view_error(&format!("<box>{construct}</box>")),
        Err("too_deep")
    );
    // No source can nest the parser without bound.
    assert_eq!(view_error(&"<box>".repeat(40_000)), Err("too_deep"));

    let children = count(MAX_CHILDREN.value);
    assert_eq!(view_error(&"<box/>".repeat(children)), Ok(()));
    assert_eq!(
        view_error(&"<box/>".repeat(children + 1)),
        Err("too_many_children")
    );

    let elements = count(MAX_VIEW_ELEMENTS.value);
    // Rows of eight elements keep every node within `MAX_CHILDREN`.
    let spread = |total: usize| {
        let row = format!("<box>{}</box>", "<box/>".repeat(7));
        format!("{}{}", row.repeat(total / 8), "<box/>".repeat(total % 8))
    };
    assert_eq!(view_error(&spread(elements)), Ok(()));
    assert_eq!(view_error(&spread(elements + 1)), Err("too_many_elements"));

    let components = |total: usize| {
        (0..total)
            .map(|index| format!("<component name=\"c{index}\"><box/></component>"))
            .collect::<String>()
    };
    let limit = count(MAX_COMPONENTS.value);
    assert_eq!(view_error(&components(limit)), Ok(()));
    assert_eq!(
        view_error(&components(limit + 1)),
        Err("too_many_components")
    );

    let props = |total: usize| {
        let names: Vec<String> = (0..total).map(|index| format!("p{index}")).collect();
        format!(
            "<component name=\"row\" props=\"{}\"><box/></component>",
            names.join(" ")
        )
    };
    let limit = count(MAX_COMPONENT_PROPS.value);
    assert_eq!(view_error(&props(limit)), Ok(()));
    assert_eq!(view_error(&props(limit + 1)), Err("invalid_component"));

    // Sixteen expressions per text node keep the elements within bounds.
    let in_boxes = |total: usize| {
        let text = |expressions: usize| format!("<text>{}</text>", "{state}".repeat(expressions));
        format!(
            "<box>{}</box>{}",
            text(16).repeat(total / 16),
            text(total % 16)
        )
    };
    let limit = count(MAX_VIEW_EXPRESSIONS.value);
    assert_eq!(view_error(&in_boxes(limit)), Ok(()));
    assert_eq!(
        view_error(&in_boxes(limit + 1)),
        Err("too_many_expressions")
    );

    let text = count(MAX_NODE_TEXT_BYTES.value);
    assert_eq!(
        view_error(&format!("<text>{}</text>", "a".repeat(text))),
        Ok(())
    );
    assert_eq!(
        view_error(&format!("<text>{}</text>", "a".repeat(text + 1))),
        Err("invalid_text")
    );

    let source = count(MAX_VIEW_SOURCE_BYTES.value);
    let padded = |total: usize| format!("<box/>{}", " ".repeat(total - 6));
    assert_eq!(view_error(&padded(source)), Ok(()));
    assert_eq!(view_error(&padded(source + 1)), Err("size"));
}

#[test]
fn expression_bounds_come_from_the_limits() {
    let bytes = count(MAX_EXPRESSION_BYTES.value);
    let long = |total: usize| format!("<text>{{state.a{}}}</text>", " ".repeat(total - 7));
    assert_eq!(view_error(&long(bytes)), Ok(()));
    assert_eq!(view_error(&long(bytes + 1)), Err("expression_too_long"));

    // The bound is the depth of the tree: literals nest it, parentheses do not.
    let depth = count(MAX_EXPRESSION_DEPTH.value);
    let arrays = |total: usize| {
        format!(
            "<text>{{{}state{}}}</text>",
            "[".repeat(total - 1),
            "]".repeat(total - 1)
        )
    };
    assert_eq!(view_error(&arrays(depth)), Ok(()));
    assert_eq!(view_error(&arrays(depth + 1)), Err("expression_too_deep"));
    let parens = |total: usize| {
        format!(
            "<text>{{{}state{}}}</text>",
            "(".repeat(total),
            ")".repeat(total)
        )
    };
    assert_eq!(view_error(&parens(depth * 2)), Ok(()));
    // The parser's own recursion stays bounded.
    assert_eq!(view_error(&parens(depth * 4)), Err("expression_too_deep"));
    // Operator chains deepen the tree without deepening the parser; the
    // name at the bottom is one level.
    let chain = |total: usize| format!("<text>{{state{}}}</text>", " + 1".repeat(total - 1));
    assert_eq!(view_error(&chain(depth)), Ok(()));
    assert_eq!(view_error(&chain(depth + 1)), Err("expression_too_deep"));
    let negations = |total: usize| format!("<text>{{{}state}}</text>", "!".repeat(total));
    assert_eq!(view_error(&negations(depth - 1)), Ok(()));
    assert_eq!(
        view_error(&negations(depth + 1)),
        Err("expression_too_deep")
    );
}

#[test]
fn every_element_attribute_and_event_of_the_schema_is_writable() {
    // Each element with its required attributes bound, and each event.
    for element in ELEMENTS {
        let mut attributes: Vec<String> = element
            .attributes
            .iter()
            .filter(|field| field.required)
            .map(|field| format!("{}={{state.v}}", field.name))
            .collect();
        attributes.extend(
            element
                .events
                .iter()
                .map(|event| format!("on:{event}={{handle}}")),
        );
        let tag = format!("<{} {}/>", element.name, attributes.join(" "));
        let source = match element.parents {
            [] => tag,
            [parent, ..] => {
                let mut wrapper: Vec<String> = ELEMENTS
                    .iter()
                    .find(|candidate| candidate.name == *parent)
                    .expect("parent element")
                    .attributes
                    .iter()
                    .filter(|field| field.required)
                    .map(|field| format!("{}={{state.v}}", field.name))
                    .collect();
                wrapper.insert(0, (*parent).to_owned());
                format!("<{}>{tag}</{parent}>", wrapper.join(" "))
            }
        };
        assert_eq!(view_error(&source), Ok(()), "{source}");
    }
}

// ---------------------------------------------------------------------------
// style.ocss

#[test]
fn valid_style_sheets_are_accepted() {
    for (name, path) in cases("ocss", "valid") {
        if let Err(error) = ocss::parse(&read(&path)) {
            panic!("{name}: {} at {:?}", error.kind.as_str(), error.position);
        }
    }
    // The package fixture's style sheet is valid too.
    let clock =
        fixtures_root().join("../../overcrow-widget-schema/fixtures/package-src/clock/style.ocss");
    ocss::parse(&read(&clock)).expect("clock style");
}

#[test]
fn invalid_style_sheets_are_rejected_with_their_category() {
    for (name, path) in cases("ocss", "invalid") {
        let error = ocss::parse(&read(&path)).expect_err(&name).kind.as_str();
        assert_eq!(error, expected_error(&name), "{name}");
    }
}

#[test]
fn the_valid_fixtures_cover_every_property() {
    let sheet = ocss::parse(&read(
        &fixtures_root().join("ocss/valid/all-properties.ocss"),
    ))
    .expect("all properties");
    let covered: BTreeSet<&str> = sheet
        .rules
        .iter()
        .flat_map(|rule| rule.declarations.iter())
        .map(|declaration| declaration.property.name)
        .collect();
    for property in PROPERTIES {
        assert!(
            covered.contains(property.name),
            "{} not covered",
            property.name
        );
    }
}

#[test]
fn every_keyword_token_selector_and_state_of_the_schema_is_accepted() {
    for property in PROPERTIES {
        if let StyleValue::Keywords(words) = property.value {
            for word in words {
                assert_eq!(
                    style_error(&format!(".a {{ {}: {word}; }}", property.name)),
                    Ok(()),
                    "{}: {word}",
                    property.name
                );
            }
        }
    }
    for token in TOKENS {
        let property = match token.ty {
            TokenType::Color => "color",
            TokenType::Length => "padding-left",
            TokenType::FontSize => "font-size",
            TokenType::FontFamily => "font-family",
            TokenType::Time => "transition",
        };
        let value = if token.ty == TokenType::Time {
            format!("opacity var({})", token.name)
        } else {
            format!("var({})", token.name)
        };
        assert_eq!(
            style_error(&format!(".a {{ {property}: {value}; }}")),
            Ok(()),
            "{}",
            token.name
        );
    }
    for element in ELEMENTS {
        assert_eq!(
            style_error(&format!("{} {{ opacity: 1; }}", element.name)),
            Ok(())
        );
    }
    for state in PSEUDO_CLASSES {
        assert_eq!(
            style_error(&format!("checkbox:{state} {{ opacity: 1; }}")),
            Ok(())
        );
    }
}

#[test]
fn selectors_record_combinators_specificity_and_source_order() {
    let sheet =
        ocss::parse(b"list > text .author:hover, button { opacity: 1; } .b { opacity: 0; }")
            .expect("sheet");
    let first = &sheet.rules[0].selectors[0];
    let combinators: Vec<_> = first
        .compounds
        .iter()
        .map(|(combinator, _)| *combinator)
        .collect();
    assert_eq!(
        combinators,
        [None, Some(Combinator::Child), Some(Combinator::Descendant)]
    );
    assert_eq!(first.specificity, (2, 2));
    assert_eq!(sheet.rules[0].selectors[1].specificity, (0, 1));
    assert_eq!(sheet.rules[1].declarations[0].value, Value::Number(0.0));
}

#[test]
fn style_bounds_come_from_the_limits() {
    let rules = |total: usize| ".a { opacity: 1; }\n".repeat(total);
    let limit = count(MAX_STYLE_RULES.value);
    assert_eq!(style_error(&rules(limit)), Ok(()));
    assert_eq!(style_error(&rules(limit + 1)), Err("too_many_rules"));

    // One valid declaration of each property, from the all-properties fixture.
    let fixture = String::from_utf8(read(
        &fixtures_root().join("ocss/valid/all-properties.ocss"),
    ))
    .expect("UTF-8 fixture");
    let mut seen = BTreeSet::new();
    let lines: Vec<&str> = fixture
        .lines()
        .map(str::trim)
        .filter(|line| line.ends_with(';') && line.contains(": "))
        .filter(|line| seen.insert(line.split(':').next().unwrap_or_default()))
        .collect();
    let limit = count(MAX_DECLARATIONS_PER_RULE.value);
    assert!(lines.len() > limit, "enough properties to exceed the bound");
    let declarations = |total: usize| {
        format!(
            ".a {{ {} }} @keyframes pulse {{ to {{ opacity: 0; }} }} @keyframes fade {{ to {{ opacity: 0; }} }}",
            lines[..total].join(" ")
        )
    };
    assert_eq!(style_error(&declarations(limit)), Ok(()));
    assert_eq!(
        style_error(&declarations(limit + 1)),
        Err("too_many_declarations")
    );

    let keyframes = |total: usize| {
        (0..total)
            .map(|index| format!("@keyframes k{index} {{ to {{ opacity: 0; }} }}\n"))
            .collect::<String>()
    };
    let limit = count(MAX_KEYFRAMES.value);
    assert_eq!(style_error(&keyframes(limit)), Ok(()));
    assert_eq!(
        style_error(&keyframes(limit + 1)),
        Err("too_many_keyframes")
    );

    let stops = |total: usize| {
        let body: String = (0..total)
            .map(|index| format!("{index}% {{ opacity: 1; }} "))
            .collect();
        format!("@keyframes k {{ {body}}}")
    };
    let limit = count(MAX_KEYFRAME_STOPS.value);
    assert_eq!(style_error(&stops(limit)), Ok(()));
    assert_eq!(style_error(&stops(limit + 1)), Err("too_many_stops"));

    let source = count(MAX_STYLE_SOURCE_BYTES.value);
    let padded = |total: usize| format!(".a{{}}{}", " ".repeat(total - 4));
    assert_eq!(style_error(&padded(source)), Ok(()));
    assert_eq!(style_error(&padded(source + 1)), Err("size"));
}

#[test]
fn values_are_typed() {
    let value = |source: &str| {
        ocss::parse(source.as_bytes()).expect(source).rules[0].declarations[0]
            .value
            .clone()
    };
    use ocss::{Color, Length};
    assert_eq!(
        value(".a { color: #0af8; }"),
        Value::Color(Color::Rgba([0, 0xaa, 0xff, 0x88]))
    );
    assert_eq!(
        value(".a { color: rgb(255 0 10 / 50%); }"),
        Value::Color(Color::Rgba([255, 0, 10, 128]))
    );
    assert_eq!(
        value(".a { margin: 1px auto; }"),
        Value::Sides([
            Length::Px(1.0),
            Length::Keyword("auto"),
            Length::Px(1.0),
            Length::Keyword("auto")
        ])
    );
    assert_eq!(value(".a { font-weight: 700; }"), Value::Keyword("700"));
    assert_eq!(
        value(".a { grid-column: span 2 / 5; }"),
        Value::GridPlacement(ocss::GridLine::Span(2), ocss::GridLine::Line(5))
    );
}

#[test]
fn parse_is_the_typed_tree_of_compile() {
    let source = read(&fixtures_root().join("ocml/valid/all-constructs.ocml"));
    let document = ocml::parse(&source, &assets()).expect("document");
    assert_eq!(document.components.len(), 1);
    assert!(matches!(document.children[0], ocml::Node::Element(_)));
}

#[test]
fn every_valid_package_fixture_has_a_valid_style() {
    let directory = fixtures_root().join("../../overcrow-widget-schema/fixtures/package/valid");
    let mut checked = 0;
    for entry in fs::read_dir(directory).expect("package fixtures") {
        let bytes = read(&entry.expect("package entry").path());
        let package = overcrow_widget_schema::package::read_package(&bytes).expect("valid package");
        overcrow_widget_format::validate_package_style(&package).expect("valid style");
        checked += usize::from(package.file("style.ocss").is_some());
    }
    assert!(
        checked > 0,
        "at least one package fixture has a style sheet"
    );
}

/// Fuzz regression (ocml target): the fully parenthesized JavaScript of an
/// accepted expression must parse again, even at the depth bound.
#[test]
fn canonical_expression_text_parses_again_at_the_depth_bound() {
    let depth = count(MAX_EXPRESSION_DEPTH.value);
    for source in [
        format!("{}state.cutz", "!".repeat(20)),
        format!("{}state", "!".repeat(depth - 1)),
        format!(
            "{}state{}",
            "f({a: ".repeat(depth / 2 - 1),
            "})".repeat(depth / 2 - 1)
        ),
        format!("state{}", " ? 1 : state".repeat(depth - 1)),
    ] {
        let parsed = expr::parse(&source).unwrap_or_else(|error| panic!("{source}: {error:?}"));
        assert_eq!(expr::parse(&parsed.to_js()), Ok(parsed), "{source}");
    }
}
