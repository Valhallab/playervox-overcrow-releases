use super::{WirePermissions, validate_permissions};
use serde_json::{Value, json};

fn exact_rule() -> Value {
    json!({"origin":"https://api.example.test","method":"GET","path":"/v2/items"})
}

fn parameter_rule(constraint: Value, query: bool) -> Value {
    let mut rule = exact_rule();
    if query {
        rule["queryParams"] = json!({"value":constraint});
    } else {
        rule["path"] = json!("/v2/items/{value}");
        rule["pathParams"] = json!({"value":constraint});
    }
    rule
}

fn accepts_rules(rules: Value) -> bool {
    accepts_raw_rules(&serde_json::to_string(&rules).unwrap())
}

fn accepts_raw_rules(rules: &str) -> bool {
    serde_json::from_str::<WirePermissions>(&format!(r#"{{"network":{rules}}}"#))
        .is_ok_and(|permissions| validate_permissions(&permissions).is_ok())
}

#[test]
fn network_accepts_exact_routes_and_all_supported_methods() {
    for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
        for path in [
            "/v2/items".to_owned(),
            "/v2/items/".to_owned(),
            "/A._~-0".to_owned(),
            format!("/{}", "a".repeat(1023)),
        ] {
            let mut rule = exact_rule();
            rule["method"] = json!(method);
            rule["path"] = json!(path);
            assert!(accepts_rules(json!([rule])), "{method} {path}");
        }
    }
    assert!(accepts_rules(json!([])));
}

#[test]
fn network_accepts_explicit_dynamic_routes_and_bounded_query_schemas() {
    let constraints = [
        json!({"type":"integer","min":0,"max":9007199254740991_u64}),
        json!({"type":"integer","min":1,"max":4294967295_u64}),
        json!({"type":"slug","maxLength":128}),
        json!({"type":"enum","values":["A._~-0","pc","xbox"]}),
    ];
    for constraint in constraints {
        for query in [false, true] {
            let mut rule = parameter_rule(constraint.clone(), query);
            assert!(accepts_rules(json!([rule])), "{constraint}, query {query}");
            if query {
                for required in [false, true] {
                    rule["queryParams"]["value"]["required"] = json!(required);
                    assert!(accepts_rules(json!([rule])), "required {constraint}");
                }
            }
        }
    }
    assert!(accepts_rules(json!([parameter_rule(
        json!({"type":"string","maxLength":256,"required":true}),
        true
    )])));
    let mut rule = exact_rule();
    rule["pathParams"] = json!({});
    rule["queryParams"] = json!({});
    assert!(accepts_rules(json!([rule])));
}

#[test]
fn network_schema_numbers_are_semantic_safe_integers() {
    for min in ["0", "-0", "1.0", "1e0", "9.007199254740991e15"] {
        let raw = format!(
            r#"[{{"origin":"https://api.example.test","method":"GET","path":"/items/{{id}}","pathParams":{{"id":{{"type":"integer","min":{min},"max":9007199254740991}}}}}}]"#
        );
        assert!(accepts_raw_rules(&raw), "semantic integer {min}");
    }
}

#[test]
fn network_rejects_legacy_wildcard_and_ambiguous_path_schemas() {
    let legacy = json!({"origin":"https://api.example.test","method":"GET","pathPrefix":"/v2/"});
    assert!(!accepts_rules(json!([legacy])));
    for path in [
        "",
        "/",
        "v2/items",
        "//v2/items",
        "/v2//items",
        "/v2/./items",
        "/v2/../items",
        "/v2\\items",
        "/v2/%69tems",
        "/v2/items?x=1",
        "/v2/items#",
        "/v2/*",
        "/v2/:id",
        "/v2/[id]",
        "/v2/{id}?",
        "/v2/x{id}",
        "/v2/{id}x",
        "/v2/{id}/{id}",
        "/v2/{id",
        "/v2/id}",
        "/v2/é",
        "/v2/ x",
        "/v2/\n",
    ] {
        let mut rule = exact_rule();
        rule["path"] = json!(path);
        assert!(!accepts_rules(json!([rule])), "accepted {path:?}");
    }
    let mut rule = exact_rule();
    rule["path"] = json!(format!("/{}", "a".repeat(1024)));
    assert!(!accepts_rules(json!([rule])));
}

#[test]
fn network_requires_exact_fields_and_types_at_every_level() {
    for field in ["origin", "method", "path"] {
        let mut rule = exact_rule();
        rule.as_object_mut().unwrap().remove(field);
        assert!(!accepts_rules(json!([rule])), "missing {field}");
        for value in [Value::Null, json!(true), json!(1), json!([]), json!({})] {
            let mut rule = exact_rule();
            rule[field] = value;
            assert!(!accepts_rules(json!([rule])), "wrong type {field}");
        }
    }
    for field in ["pathPrefix", "unknown", "required"] {
        let mut rule = exact_rule();
        rule[field] = json!("/v2/");
        assert!(!accepts_rules(json!([rule])), "extra {field}");
    }
    for field in ["pathParams", "queryParams"] {
        for value in [Value::Null, json!(false), json!(0), json!(""), json!([])] {
            let mut rule = exact_rule();
            rule[field] = value;
            assert!(!accepts_rules(json!([rule])), "wrong map type {field}");
        }
    }
    for value in [Value::Null, json!(false), json!(0), json!(""), json!({})] {
        assert!(!accepts_rules(value.clone()), "wrong network type {value}");
        assert!(!accepts_rules(json!([value])), "wrong rule type");
    }
}

#[test]
fn network_requires_one_definition_for_each_path_placeholder() {
    let valid = parameter_rule(json!({"type":"slug","maxLength":96}), false);
    for name in ["a", "steamAppId", "A0_", "abcdefghijklmnopqrstu0123456789_"] {
        let mut rule = exact_rule();
        rule["path"] = json!(format!("/items/{{{name}}}"));
        rule["pathParams"] = json!({name:{"type":"slug","maxLength":96}});
        assert!(accepts_rules(json!([rule])), "valid name {name}");
    }
    for name in [
        "",
        "_id",
        "0id",
        "item-id",
        "id.id",
        "é",
        "a12345678901234567890123456789012",
    ] {
        let mut rule = exact_rule();
        rule["path"] = json!(format!("/items/{{{name}}}"));
        rule["pathParams"] = json!({name:{"type":"slug","maxLength":96}});
        assert!(!accepts_rules(json!([rule])), "invalid name {name}");
    }
    for path in ["/items/{missing}", "/items", "/items/{value}/{value}"] {
        let mut rule = valid.clone();
        rule["path"] = json!(path);
        assert!(!accepts_rules(json!([rule])), "unbound path {path}");
    }
    let mut missing = valid.clone();
    missing.as_object_mut().unwrap().remove("pathParams");
    assert!(!accepts_rules(json!([missing])));
    let mut unused = valid;
    unused["pathParams"]["extra"] = json!({"type":"integer","min":0,"max":3});
    assert!(!accepts_rules(json!([unused])));
}

#[test]
fn network_rejects_unbounded_invalid_and_mistyped_constraints() {
    let invalid = [
        Value::Null,
        json!([]),
        json!({}),
        json!({"type":"regex","pattern":".*"}),
        json!({"type":"integer","min":0}),
        json!({"type":"integer","max":10}),
        json!({"type":"integer","min":2,"max":1}),
        json!({"type":"integer","min":-1,"max":10}),
        json!({"type":"integer","min":0,"max":9007199254740992_u64}),
        json!({"type":"integer","min":0.5,"max":10}),
        json!({"type":"integer","min":0,"max":1.5}),
        json!({"type":"integer","min":"0","max":1}),
        json!({"type":"integer","min":0,"max":true}),
        json!({"type":"integer","min":null,"max":1}),
        json!({"type":"integer","min":0,"max":null}),
        json!({"type":"integer","min":0,"max":1,"maxLength":1}),
        json!({"type":"slug"}),
        json!({"type":"slug","maxLength":0}),
        json!({"type":"slug","maxLength":129}),
        json!({"type":"slug","maxLength":1.5}),
        json!({"type":"slug","maxLength":"12"}),
        json!({"type":"slug","maxLength":null}),
        json!({"type":"slug","maxLength":12,"min":0}),
        json!({"type":"enum"}),
        json!({"type":"enum","values":[]}),
        json!({"type":"enum","values":["a","a"]}),
        json!({"type":"enum","values":[""]}),
        json!({"type":"enum","values":["."]}),
        json!({"type":"enum","values":[".."]}),
        json!({"type":"enum","values":["a/b"]}),
        json!({"type":"enum","values":["é"]}),
        json!({"type":"enum","values":["%61"]}),
        json!({"type":"enum","values":["a b"]}),
        json!({"type":"enum","values":[1]}),
        json!({"type":"enum","values":null}),
        json!({"type":"enum","values":["x".repeat(129)]}),
        json!({"type":"enum","values":(0..33).map(|i|format!("v{i}")).collect::<Vec<_>>()}),
        json!({"type":"enum","values":["a"],"maxLength":1}),
    ];
    for constraint in invalid {
        for query in [false, true] {
            assert!(
                !accepts_rules(json!([parameter_rule(constraint.clone(), query)])),
                "accepted {constraint}, query {query}"
            );
        }
    }
    for constraint in [
        json!({"type":"string"}),
        json!({"type":"string","maxLength":0}),
        json!({"type":"string","maxLength":257}),
        json!({"type":"string","maxLength":1.5}),
        json!({"type":"string","maxLength":32,"values":["a"]}),
    ] {
        assert!(
            !accepts_rules(json!([parameter_rule(constraint.clone(), true)])),
            "accepted {constraint}"
        );
    }
    assert!(!accepts_rules(json!([parameter_rule(
        json!({"type":"string","maxLength":32}),
        false
    )])));
    for query in [false, true] {
        let mut rule = parameter_rule(json!({"type":"slug","maxLength":96}), query);
        let map = if query { "queryParams" } else { "pathParams" };
        rule[map]["value"]["unknown"] = json!(true);
        assert!(!accepts_rules(json!([rule])));
        for required in [
            Value::Null,
            json!(1),
            json!("true"),
            json!([]),
            json!({}),
            json!(true),
            json!(false),
        ] {
            if query && required.is_boolean() {
                continue;
            }
            let mut rule = parameter_rule(json!({"type":"slug","maxLength":96}), query);
            rule[map]["value"]["required"] = required;
            assert!(
                !accepts_rules(json!([rule])),
                "invalid required, query {query}"
            );
        }
    }
}

#[test]
fn network_rejects_duplicate_rules_after_canonical_parameter_ordering() {
    assert!(!accepts_raw_rules(
        r#"[
          {"origin":"https://api.example.test","method":"GET","path":"/items","queryParams":{"z":{"type":"slug","maxLength":8},"a":{"type":"integer","min":0,"max":1}}},
          {"origin":"https://api.example.test","method":"GET","path":"/items","queryParams":{"a":{"type":"integer","min":-0,"max":1e0,"required":false},"z":{"type":"slug","maxLength":8.0}}}
        ]"#
    ));
    let mut first = parameter_rule(json!({"type":"enum","values":["b","a"]}), false);
    first["queryParams"] =
        json!({"z":{"type":"enum","values":["y","x"]},"a":{"type":"integer","min":0,"max":1}});
    let mut second = first.clone();
    second["pathParams"]["value"]["values"] = json!(["a", "b"]);
    second["queryParams"]["z"]["values"] = json!(["x", "y"]);
    second["queryParams"]["a"]["required"] = json!(false);
    assert!(!accepts_rules(json!([first.clone(), second.clone()])));
    for (pointer, replacement) in [
        ("/pathParams/value/values", json!(["a", "c"])),
        ("/queryParams/z/values", json!(["x", "z"])),
        ("/queryParams/a/max", json!(2)),
        ("/queryParams/a/required", json!(true)),
        ("/path", json!("/v3/{value}")),
    ] {
        let mut distinct = second.clone();
        *distinct.pointer_mut(pointer).unwrap() = replacement;
        assert!(
            accepts_rules(json!([first.clone(), distinct])),
            "distinct {pointer}"
        );
    }
    let mut empty = exact_rule();
    empty["pathParams"] = json!({});
    empty["queryParams"] = json!({});
    assert!(!accepts_rules(json!([exact_rule(), empty])));
}

#[test]
fn network_rejects_duplicate_json_parameter_keys_and_constraint_fields() {
    for rule in [
        r#"{"origin":"https://api.example.test","method":"GET","path":"/items/{id}","pathParams":{"id":{"type":"slug","maxLength":1},"id":{"type":"slug","maxLength":2}}}"#,
        r#"{"origin":"https://api.example.test","method":"GET","path":"/items","queryParams":{"id":{"type":"slug","maxLength":1},"id":{"type":"slug","maxLength":2}}}"#,
        r#"{"origin":"https://api.example.test","method":"GET","path":"/items","path":"/other"}"#,
        r#"{"origin":"https://api.example.test","method":"GET","path":"/items/{id}","pathParams":{"id":{"type":"slug","maxLength":1,"maxLength":2}}}"#,
        r#"{"origin":"https://api.example.test","method":"GET","path":"/items","queryParams":{"id":{"type":"slug","maxLength":1,"required":true,"required":false}}}"#,
    ] {
        assert!(
            !accepts_raw_rules(&format!("[{rule}]")),
            "accepted duplicate {rule}"
        );
    }
}

#[test]
fn network_enforces_rule_and_parameter_count_limits() {
    let rules = (0..32)
        .map(|index| {
            let mut rule = exact_rule();
            rule["path"] = json!(format!("/items/{index}"));
            rule
        })
        .collect::<Vec<_>>();
    assert!(accepts_rules(json!(rules)));
    let mut excessive = rules;
    excessive.push(exact_rule());
    assert!(!accepts_rules(json!(excessive)));
    for count in [8, 9] {
        let mut rule = exact_rule();
        rule["path"] = json!(
            (0..count)
                .map(|index| format!("/{{p{index}}}"))
                .collect::<String>()
        );
        rule["pathParams"] = json!(
            (0..count)
                .map(|index| (format!("p{index}"), json!({"type":"slug","maxLength":1})))
                .collect::<serde_json::Map<_, _>>()
        );
        assert_eq!(
            accepts_rules(json!([rule])),
            count == 8,
            "path count {count}"
        );
    }
    for count in [16, 17] {
        let mut rule = exact_rule();
        rule["queryParams"] = json!(
            (0..count)
                .map(|index| (format!("q{index}"), json!({"type":"string","maxLength":1})))
                .collect::<serde_json::Map<_, _>>()
        );
        assert_eq!(
            accepts_rules(json!([rule])),
            count == 16,
            "query count {count}"
        );
    }
    let max_enum =
        json!({"type":"enum","values":(0..32).map(|i|format!("v{i}")).collect::<Vec<_>>()});
    assert!(accepts_rules(json!([parameter_rule(max_enum, false)])));
}

#[test]
fn network_origin_rejects_ip_addresses_and_numeric_host_aliases() {
    for origin in [
        "https://127.0.0.1",
        "https://1.2.3.4",
        "https://127.1",
        "https://0177.0.0.1",
        "https://0x7f.0.0.1",
        "https://0x7f000001",
        "https://2130706433",
        "https://api.123",
        "https://api.09",
        "https://api.0x1",
        "https://api.0x",
    ] {
        let mut rule = exact_rule();
        rule["origin"] = json!(origin);
        assert!(!accepts_rules(json!([rule])), "IP-style origin {origin}");
    }
    for origin in [
        "https://api.0xg",
        "https://api.1x",
        "https://api.example.test:0",
        "https://api.example.test:8443",
    ] {
        let mut rule = exact_rule();
        rule["origin"] = json!(origin);
        assert!(accepts_rules(json!([rule])), "DNS origin {origin}");
    }
}

#[test]
fn network_preserves_origin_and_method_restrictions() {
    for origin in [
        "http://api.example.test",
        "https://API.example.test",
        "https://api.example.test/",
        "https://user@api.example.test",
        "https://api.example.test?",
        "https://api.example.test#",
        "https://localhost",
        "https://api.example.test:443",
        "https://api.example.test:08443",
        "https://api.example.test:65536",
    ] {
        let mut rule = exact_rule();
        rule["origin"] = json!(origin);
        assert!(!accepts_rules(json!([rule])), "accepted origin {origin}");
    }
    for method in ["get", "HEAD", "OPTIONS", "CONNECT", "GET "] {
        let mut rule = exact_rule();
        rule["method"] = json!(method);
        assert!(!accepts_rules(json!([rule])), "accepted method {method}");
    }
    for name in [
        "",
        "_q",
        "0q",
        "q-value",
        "%71",
        "é",
        "a12345678901234567890123456789012",
    ] {
        let mut rule = exact_rule();
        rule["queryParams"] = json!({name:{"type":"string","maxLength":32}});
        assert!(!accepts_rules(json!([rule])), "accepted query name {name}");
    }
}
