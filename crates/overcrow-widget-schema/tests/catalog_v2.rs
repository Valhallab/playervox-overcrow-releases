//! Shared vectors of the creator portal contract: identifier rules
//! (`fixtures/identifiers/`) and the signed catalog v2
//! (`fixtures/catalog-v2/`).

use std::fs;
use std::path::PathBuf;

use overcrow_widget_schema::identifiers::{
    Owner, domains_overlap, handle_syntax, id_owner, validate_domain, validate_handle,
};
use serde_json::Value;

fn fixtures() -> PathBuf {
    PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("run by Cargo")).join("fixtures")
}

fn vector_file(relative: &str) -> Value {
    let path = fixtures().join(relative);
    let bytes = fs::read(&path).unwrap_or_else(|_| panic!("{} is readable", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|_| panic!("{} is JSON", path.display()))
}

fn cases<'a>(file: &'a Value, list: &str) -> &'a [Value] {
    let cases = file[list].as_array().expect("a list of cases");
    assert!(!cases.is_empty(), "no {list}");
    cases
}

fn text<'a>(case: &'a Value, field: &str) -> &'a str {
    case[field]
        .as_str()
        .unwrap_or_else(|| panic!("{case} has a text `{field}`"))
}

fn outcome<E: Copy>(result: Result<(), E>, name: impl Fn(E) -> &'static str) -> &'static str {
    result.map_or_else(name, |()| "ok")
}

#[test]
fn identifier_vectors() {
    let handles = vector_file("identifiers/handles.json");
    for case in cases(&handles, "cases") {
        let handle = text(case, "handle");
        assert_eq!(
            outcome(validate_handle(handle), |error| error.as_str()),
            text(case, "registration"),
            "registration of {handle:?}"
        );
        assert_eq!(
            outcome(handle_syntax(handle), |error| error.as_str()),
            text(case, "catalog"),
            "grammar of {handle:?}"
        );
    }

    let domains = vector_file("identifiers/domains.json");
    for case in cases(&domains, "cases") {
        let domain = text(case, "domain");
        assert_eq!(
            outcome(validate_domain(domain, text(case, "handle")), |error| error
                .as_str()),
            text(case, "expected"),
            "{case}"
        );
    }
    for case in cases(&domains, "overlaps") {
        assert_eq!(
            Value::Bool(domains_overlap(text(case, "a"), text(case, "b"))),
            case["overlap"],
            "{case}"
        );
    }

    let ids = vector_file("identifiers/widget-ids.json");
    for case in cases(&ids, "cases") {
        let owned: Vec<String> = case["domains"]
            .as_array()
            .expect("domains")
            .iter()
            .map(|domain| domain.as_str().expect("domain text").to_owned())
            .collect();
        let (expected, domain) = match id_owner(text(case, "id"), text(case, "handle"), &owned) {
            Ok(Owner::Handle) => ("handle", None),
            Ok(Owner::Domain(domain)) => ("domain", Some(domain)),
            Err(error) => (error.as_str(), None),
        };
        assert_eq!(expected, text(case, "expected"), "{case}");
        assert_eq!(domain, case["domain"].as_str(), "{case}");
    }
}
