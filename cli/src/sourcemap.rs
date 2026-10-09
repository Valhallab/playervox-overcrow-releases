//! The code map of `logic.js`: a Source Map v3 (ECMA-426) from each
//! position of the shipped bundle to the file, line and column of the
//! sources, with the functions of the sources. It is private to the creator
//! space (errors reported by players are mapped back with it) and never
//! enters the package.
//!
//! `bundle` prints the code three times (types stripped, modules linked,
//! script minified); each print gives a map, and the three compose into
//! one. This module adds what Source Map v3 lacks:
//!
//! - `ignoreList`: the sources of the embedded `@overcrow/sdk`;
//! - `sourcesContent`: `null`, except the generated view table, whose text
//!   no source file holds;
//! - `x_overcrow_functions`: `{source, name, start, end}` for every named
//!   function of the sources (`start` and `end` are `[line, column]`,
//!   zero-based, columns in UTF-16 units like `mappings`). The function of
//!   a position is the innermost range holding it. The view table's
//!   entries are named `view expression <index>`, the index of the
//!   expression in `view.json`.
//!
//! The JSON is written with sorted keys: the same sources always give the
//! same bytes.

use std::borrow::Cow;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionExpression, Class, Expression, Function, MethodDefinition, ObjectProperty,
    PropertyDefinition, VariableDeclarator,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};
use oxc_syntax::scope::ScopeFlags;
use serde_json::{Value, json};

/// The source name of the generated view table.
pub const VIEW_TABLE: &str = "overcrow:view-table";
const SDK_PREFIX: &str = "@overcrow/sdk/";

/// One named function of a source.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Named {
    pub start: (u32, u32),
    pub end: (u32, u32),
    pub name: String,
}

/// Zero-based line and UTF-16 column of every byte offset of a text.
struct Lines<'a> {
    text: &'a str,
    starts: Vec<usize>,
}

impl<'a> Lines<'a> {
    fn new(text: &'a str) -> Self {
        let mut starts = vec![0];
        starts.extend(text.match_indices('\n').map(|(at, _)| at + 1));
        Self { text, starts }
    }

    fn position(&self, offset: u32) -> (u32, u32) {
        let offset = (offset as usize).min(self.text.len());
        let line = self.starts.partition_point(|start| *start <= offset) - 1;
        let column = self.text[self.starts[line]..offset].encode_utf16().count();
        (line as u32, column as u32)
    }
}

/// The named functions of `source`, in order. In the view table, every
/// function is an entry of the expression table.
pub fn functions(name: &str, source: &str, source_type: SourceType) -> Vec<Named> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let mut collector = Collector {
        lines: Lines::new(source),
        pending: None,
        classes: Vec::new(),
        view_table: name == VIEW_TABLE,
        found: Vec::new(),
    };
    collector.visit_program(&parsed.program);
    collector.found.sort();
    collector.found
}

struct Collector<'s> {
    lines: Lines<'s>,
    /// The name the next function takes: its variable, property or method.
    pending: Option<String>,
    /// Names of the enclosing classes.
    classes: Vec<Option<String>>,
    view_table: bool,
    found: Vec<Named>,
}

impl Collector<'_> {
    fn record(&mut self, own: Option<&str>, span: Span) {
        let name = if self.view_table {
            Some(format!("view expression {}", self.found.len()))
        } else {
            own.map(str::to_owned).or_else(|| self.pending.take())
        };
        self.pending = None;
        if let Some(name) = name {
            self.found.push(Named {
                start: self.lines.position(span.start),
                end: self.lines.position(span.end),
                name,
            });
        }
    }

    fn named(&mut self, name: Option<Cow<'_, str>>, value: Option<&Expression<'_>>) {
        let function = matches!(
            value,
            Some(Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_))
        );
        self.pending = name.filter(|_| function).map(Cow::into_owned);
    }
}

impl<'a> Visit<'a> for Collector<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        let own = it.id.as_ref().map(|id| id.name.as_str());
        self.record(own, it.span);
        walk::walk_function(self, it, flags);
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.record(None, it.span);
        walk::walk_arrow_function_expression(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let name = it
            .id
            .get_identifier_name()
            .map(|name| Cow::Owned(name.to_string()));
        self.named(name, it.init.as_ref());
        walk::walk_variable_declarator(self, it);
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        self.named(it.key.static_name(), Some(&it.value));
        walk::walk_object_property(self, it);
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        self.classes
            .push(it.id.as_ref().map(|id| id.name.to_string()));
        walk::walk_class(self, it);
        self.classes.pop();
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        let class = self.classes.last().cloned().flatten();
        self.pending = it.key.static_name().map(|key| match class {
            Some(class) => format!("{class}.{key}"),
            None => key.into_owned(),
        });
        walk::walk_method_definition(self, it);
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.named(it.key.static_name(), it.value.as_ref());
        walk::walk_property_definition(self, it);
    }
}

/// The final JSON of a composed map: `file`, `ignoreList`,
/// `sourcesContent` and `x_overcrow_functions` set, keys sorted.
/// `sources` gives, by source name, its text and type.
pub fn finish(
    map: &oxc_sourcemap::SourceMap<'_>,
    sources: &[(String, String, SourceType)],
) -> String {
    let mut value: Value = serde_json::from_str(&map.to_json_string()).unwrap_or(Value::Null);
    let names: Vec<String> = value["sources"]
        .as_array()
        .map(|sources| {
            sources
                .iter()
                .map(|name| name.as_str().unwrap_or_default().to_owned())
                .collect()
        })
        .unwrap_or_default();
    let text = |name: &str| sources.iter().find(|(source, ..)| source == name);
    value["file"] = json!("logic.js");
    value["sourcesContent"] = names
        .iter()
        .map(|name| match text(name) {
            Some((_, source, _)) if name == VIEW_TABLE => json!(source),
            _ => Value::Null,
        })
        .collect();
    value["ignoreList"] = names
        .iter()
        .enumerate()
        .filter(|(_, name)| name.starts_with(SDK_PREFIX))
        .map(|(index, _)| json!(index))
        .collect();
    let mut functions = Vec::new();
    for (index, name) in names.iter().enumerate() {
        if let Some((_, source, source_type)) = text(name) {
            for function in self::functions(name, source, *source_type) {
                functions.push(json!({
                    "source": index,
                    "name": function.name,
                    "start": [function.start.0, function.start.1],
                    "end": [function.end.0, function.end.1],
                }));
            }
        }
    }
    value["x_overcrow_functions"] = Value::Array(functions);
    if let Some(object) = value.as_object_mut() {
        object.remove("debugId");
    }
    value.to_string()
}

/// Where a position of `logic.js` comes from.
#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
pub struct Resolved {
    pub source: String,
    /// Zero-based, like the map.
    pub line: u32,
    pub column: u32,
    pub function: Option<String>,
}

/// Maps a zero-based line and UTF-16 column of `logic.js` back, as the
/// creator space does: the mapping at or before the position on its line,
/// then the innermost function holding the original position.
#[cfg(test)]
pub fn resolve(map: &str, line: u32, column: u32) -> Option<Resolved> {
    let parsed = oxc_sourcemap::SourceMap::from_json_string(map).ok()?;
    let table = parsed.generate_lookup_table();
    let token = parsed.lookup_token(&table, line, column)?;
    let source_id = token.get_source_id()?;
    let value: Value = serde_json::from_str(map).ok()?;
    let original = (token.get_src_line(), token.get_src_col());
    let function = value["x_overcrow_functions"]
        .as_array()?
        .iter()
        .filter(|function| function["source"] == json!(source_id))
        .filter(|function| {
            let at = |field: &str| {
                (
                    function[field][0].as_u64().unwrap_or_default() as u32,
                    function[field][1].as_u64().unwrap_or_default() as u32,
                )
            };
            at("start") <= original && original < at("end")
        })
        // Ranges nest: the innermost starts last.
        .max_by_key(|function| {
            (
                function["start"][0].as_u64().unwrap_or_default(),
                function["start"][1].as_u64().unwrap_or_default(),
            )
        })
        .and_then(|function| function["name"].as_str().map(str::to_owned));
    Some(Resolved {
        source: parsed.get_source(source_id)?.to_owned(),
        line: original.0,
        column: original.1,
        function,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn functions_take_the_name_of_what_holds_them() {
        let source = "export function add(a: number) { return a; }\n\
            const twice = (x: number) => x * 2;\n\
            const table = { pick: function () { return 1; }, drop() { return 2; } };\n\
            class Timer { start() { [1].map(() => 0); } }\n";
        let names: Vec<String> = functions("logic.ts", source, SourceType::ts())
            .into_iter()
            .map(|function| function.name)
            .collect();
        assert_eq!(names, ["add", "twice", "pick", "drop", "Timer.start"]);
    }

    #[test]
    fn view_table_entries_are_numbered() {
        let table = "__registerView([\n  function (state, __scope) {\n    return 1;\n  },\n  function (state, __scope) {\n    return 2;\n  },\n]);\n";
        let found = functions(VIEW_TABLE, table, SourceType::mjs());
        assert_eq!(found[1].name, "view expression 1");
        assert_eq!(found[1].start, (4, 2));
    }

    #[test]
    fn columns_count_utf16_units() {
        let lines = Lines::new("a\n\u{1f600}x\n");
        assert_eq!(lines.position(2 + 4), (1, 2));
        assert_eq!(lines.position(0), (0, 0));
    }
}
