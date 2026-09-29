//! Lint of the logic module against what the widget VM runs (ADR 0002): one
//! ES2023 module whose only import is `@overcrow/sdk`, no dynamic code or
//! module loading, and no global beyond the VM's realm. It also checks that
//! the module exports every function the view calls.

use std::collections::BTreeSet;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    AwaitExpression, CallExpression, Class, Decorator, Expression, ForOfStatement, Function,
    ModuleDeclaration, NewExpression, RegExpLiteral, Statement, StaticMemberExpression,
    ThisExpression, VariableDeclaration, VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, walk};
use oxc_ecmascript::BoundNames;
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::scope::ScopeFlags;

use overcrow_widget_format::Position;
use overcrow_widget_format::ocml::CompiledView;

use crate::diag::{Diagnostic, Report, closest};

/// The only module a logic module may import.
pub const SDK_SPECIFIER: &str = "@overcrow/sdk";

/// The global names of the widget VM's realm besides `overcrow`: the
/// ECMAScript intrinsics quickjs-ng provides, after the VM's prelude deleted
/// `eval`, `SharedArrayBuffer`, `Atomics`, `WebAssembly`, `performance` and
/// `queueMicrotask` (ADR 0002). `Function` stays, but calling it throws.
pub const VM_GLOBALS: &[&str] = &[
    "AggregateError",
    "Array",
    "ArrayBuffer",
    "AsyncDisposableStack",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DataView",
    "Date",
    "DisposableStack",
    "Error",
    "EvalError",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Function",
    "Infinity",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "InternalError",
    "Iterator",
    "JSON",
    "Map",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "String",
    "SuppressedError",
    "Symbol",
    "SyntaxError",
    "TypeError",
    "URIError",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "WeakMap",
    "WeakSet",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "globalThis",
    "isFinite",
    "isNaN",
    "overcrow",
    "parseFloat",
    "parseInt",
    "undefined",
    "unescape",
];

/// Why a familiar global is missing, and what to use instead.
fn missing_global_help(name: &str) -> String {
    match name {
        "Intl" => "the VM has no Intl: use formatNumber, formatDate, formatTime and formatDuration of @overcrow/sdk".into(),
        "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval" | "setImmediate"
        | "requestAnimationFrame" => "use timers.after or timers.every of @overcrow/sdk".into(),
        "queueMicrotask" => "use Promise.resolve().then(callback)".into(),
        "console" => "use log.debug, log.info, log.warn or log.error of @overcrow/sdk".into(),
        "fetch" | "XMLHttpRequest" | "WebSocket" | "EventSource" => {
            "use http.fetch of @overcrow/sdk with a `permissions.network` rule".into()
        }
        "localStorage" | "sessionStorage" | "indexedDB" => {
            "use storage of @overcrow/sdk with the `storage` permission".into()
        }
        "WebAssembly" => "widgets run no WebAssembly or native code".into(),
        "SharedArrayBuffer" | "Atomics" | "Worker" => "the widget VM has a single thread".into(),
        "performance" => "use Date.now()".into(),
        "eval" => "the VM has no eval".into(),
        "window" | "document" | "navigator" | "location" | "self" | "process" | "require"
        | "module" | "exports" | "Buffer" | "global" | "__dirname" | "__filename" => {
            "the widget VM has no browser or Node.js globals; everything goes through @overcrow/sdk".into()
        }
        _ => match closest(name, VM_GLOBALS.iter().copied()) {
            Some(found) => format!("did you mean `{found}`? The VM has the ECMAScript intrinsics and `overcrow` only"),
            None => "the widget VM has the ECMAScript intrinsics and `overcrow` only".into(),
        },
    }
}

/// What the rest of the build needs from a linted logic module.
#[derive(Debug, Default)]
pub struct LogicModule {
    /// Names the module exports.
    pub exports: BTreeSet<String>,
}

/// Lints `source` (`logic.ts` or `logic.js`) and checks its exports against
/// the functions `view` calls. Returns `None` after reporting errors.
pub fn lint(
    path: &str,
    source: &str,
    view: Option<(&CompiledView, &[u8])>,
    report: &mut Report,
) -> Option<LogicModule> {
    let before = report.errors();
    let first = report.diagnostics.len();
    let allocator = Allocator::default();
    let source_type = source_type(path);
    let parsed = Parser::new(&allocator, source, source_type).parse();
    for error in &parsed.diagnostics {
        report.push(oxc_diagnostic("logic.syntax", error, path, source));
    }
    if !parsed.diagnostics.is_empty() {
        return None;
    }
    let semantic = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .with_build_nodes(true)
        .build(&parsed.program);
    for error in &semantic.diagnostics {
        report.push(oxc_diagnostic("logic.syntax", error, path, source));
    }
    let semantic = semantic.semantic;
    let scoping = semantic.scoping();

    let mut exports = BTreeSet::new();
    for statement in &parsed.program.body {
        module_statement(statement, path, source, &mut exports, report);
    }

    let mut visitor = Linter {
        path,
        source,
        scoping,
        report,
        function_depth: 0,
        this_depth: 0,
    };
    visitor.visit_program(&parsed.program);
    unresolved_globals(&semantic, path, source, report);

    if let Some((view, view_source)) = view {
        let text = String::from_utf8_lossy(view_source);
        for function in view.functions.iter().filter(|name| *name != "t") {
            if !exports.contains(function) {
                let mut diagnostic = Diagnostic::error(
                    "logic.missing_export",
                    format!("the view calls `{function}`, which {path} does not export"),
                )
                .in_file("view.ocml")
                .help(format!("add `export function {function}(...)` to {path}"));
                if let Some(offset) = find_call(&text, function) {
                    diagnostic = diagnostic.at(Position::of(&text, offset));
                }
                report.push(diagnostic);
            }
        }
    }

    // Report in source order, file by file.
    report.diagnostics[first..].sort_by(|a, b| {
        (
            a.file != Some(path.to_owned()),
            &a.file,
            a.position.line,
            a.position.column,
        )
            .cmp(&(
                b.file != Some(path.to_owned()),
                &b.file,
                b.position.line,
                b.position.column,
            ))
    });
    (report.errors() == before).then_some(LogicModule { exports })
}

pub fn source_type(path: &str) -> SourceType {
    if path.ends_with(".ts") {
        SourceType::ts()
    } else {
        SourceType::mjs()
    }
}

/// The first use of `name` as a called function or a handler in the view.
fn find_call(text: &str, name: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    text.match_indices(name)
        .map(|(index, _)| index)
        .find(|index| {
            let before = index.checked_sub(1).map(|i| bytes[i]);
            let after = bytes.get(index + name.len()).copied();
            before.is_some_and(|b| matches!(b, b'{' | b' ' | b'(' | b',' | b'!' | b'?' | b':'))
                && after.is_some_and(|b| matches!(b, b'(' | b'}'))
        })
}

fn position(source: &str, span: Span) -> Position {
    Position::of(source, span.start as usize)
}

fn at(code: &str, message: String, path: &str, source: &str, span: Span) -> Diagnostic {
    Diagnostic::error(code, message)
        .in_file(path)
        .at(position(source, span))
}

pub fn oxc_diagnostic(
    code: &str,
    error: &oxc_diagnostics::OxcDiagnostic,
    path: &str,
    source: &str,
) -> Diagnostic {
    let mut diagnostic = Diagnostic::error(code, error.message.to_string()).in_file(path);
    if let Some(label) = error.labels.first() {
        diagnostic = diagnostic.at(Position::of(source, label.offset() as usize));
    }
    if let Some(help) = &error.help {
        diagnostic = diagnostic.help(help.to_string());
    }
    diagnostic
}

fn module_statement(
    statement: &Statement<'_>,
    path: &str,
    source: &str,
    exports: &mut BTreeSet<String>,
    report: &mut Report,
) {
    let Some(declaration) = statement.as_module_declaration() else {
        return;
    };
    let foreign = |specifier: &str| specifier != SDK_SPECIFIER;
    let import_help =
        "a widget has one logic module: move the code into it, or import it from @overcrow/sdk";
    match declaration {
        ModuleDeclaration::ImportDeclaration(import) => {
            if foreign(import.source.value.as_str()) {
                report.push(
                    at(
                        "logic.import",
                        format!("`{}` cannot be imported", import.source.value),
                        path,
                        source,
                        import.source.span,
                    )
                    .help(import_help),
                );
            }
            if import.with_clause.is_some() {
                report.push(at(
                    "logic.syntax_version",
                    "import attributes are not ES2023".into(),
                    path,
                    source,
                    import.span,
                ));
            }
        }
        ModuleDeclaration::ExportFromDeclaration(export) => {
            if foreign(export.source.value.as_str()) {
                report.push(
                    at(
                        "logic.import",
                        format!("`{}` cannot be re-exported", export.source.value),
                        path,
                        source,
                        export.source.span,
                    )
                    .help(import_help),
                );
            }
            if !export.export_kind.is_type() {
                for specifier in &export.specifiers {
                    if !specifier.export_kind.is_type() {
                        exports.insert(specifier.exported.name().to_string());
                    }
                }
            }
        }
        ModuleDeclaration::ExportNamedDeclaration(export) => {
            if !export.export_kind.is_type() {
                for specifier in &export.specifiers {
                    if !specifier.export_kind.is_type() {
                        exports.insert(specifier.exported.name().to_string());
                    }
                }
            }
        }
        ModuleDeclaration::ExportDeclaration(export) => {
            if !export.declaration.is_type() {
                export.declaration.bound_names(&mut |binding| {
                    exports.insert(binding.name.to_string());
                });
            }
        }
        ModuleDeclaration::ExportAllDeclaration(export) => {
            report.push(
                at(
                    "logic.import",
                    "`export *` is not supported in the logic module".into(),
                    path,
                    source,
                    export.span,
                )
                .help("export the functions the view calls by name"),
            );
        }
        ModuleDeclaration::ExportDefaultDeclaration(export) => {
            report.push(
                at(
                    "logic.default_export",
                    "the view calls named exports; `export default` is never used".into(),
                    path,
                    source,
                    export.span,
                )
                .help("export each function by name: `export function name(...)`"),
            );
        }
        ModuleDeclaration::TSExportAssignment(export) => report.push(at(
            "logic.default_export",
            "`export =` is not an ES module export".into(),
            path,
            source,
            export.span,
        )),
        ModuleDeclaration::TSNamespaceExportDeclaration(_) => {}
    }
}

/// Global names the module reads that the VM's realm does not have.
fn unresolved_globals(semantic: &Semantic<'_>, path: &str, source: &str, report: &mut Report) {
    let scoping = semantic.scoping();
    let mut seen = BTreeSet::new();
    let mut found: Vec<(u32, String)> = Vec::new();
    for (name, references) in scoping.root_unresolved_references() {
        let name = name.as_str();
        if VM_GLOBALS.contains(&name) && name != "eval" {
            continue;
        }
        let Some(first) = references
            .iter()
            .map(|id| scoping.get_reference(*id))
            .filter(|reference| reference.is_value())
            .map(|reference| semantic.nodes().get_node(reference.node_id()).span().start)
            .min()
        else {
            continue;
        };
        if seen.insert(name.to_owned()) {
            found.push((first, name.to_owned()));
        }
    }
    found.sort();
    for (start, name) in found {
        let code = if name == "eval" {
            "logic.eval"
        } else {
            "logic.unavailable_global"
        };
        report.push(
            at(
                code,
                format!("`{name}` does not exist in the widget VM"),
                path,
                source,
                Span::new(start, start),
            )
            .help(missing_global_help(&name)),
        );
    }
}

struct Linter<'s, 'r> {
    path: &'s str,
    source: &'s str,
    scoping: &'s oxc_semantic::Scoping,
    report: &'r mut Report,
    /// Functions around the current node; 0 is the module's top level.
    function_depth: usize,
    /// Functions and classes that bind their own `this`.
    this_depth: usize,
}

impl Linter<'_, '_> {
    fn error(&mut self, code: &str, message: impl Into<String>, span: Span, help: &str) {
        self.report
            .push(at(code, message.into(), self.path, self.source, span).help(help));
    }

    /// Whether `expression` is a global identifier `name` (not shadowed).
    fn is_global(&self, expression: &Expression<'_>, name: &str) -> bool {
        match expression.without_parentheses() {
            Expression::Identifier(identifier) => {
                identifier.name == name
                    && identifier
                        .reference_id
                        .get()
                        .is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none())
            }
            _ => false,
        }
    }

    fn dynamic_code(&mut self, callee: &Expression<'_>, span: Span) {
        if self.is_global(callee, "Function") {
            self.error(
                "logic.function_constructor",
                "the Function constructor compiles code at runtime; the VM refuses it",
                span,
                "write the function in the module instead",
            );
        }
    }
}

impl<'a> Visit<'a> for Linter<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        self.function_depth += 1;
        self.this_depth += 1;
        walk::walk_function(self, it, flags);
        self.function_depth -= 1;
        self.this_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &oxc_ast::ast::ArrowFunctionExpression<'a>) {
        self.function_depth += 1;
        walk::walk_arrow_function_expression(self, it);
        self.function_depth -= 1;
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        self.this_depth += 1;
        walk::walk_class(self, it);
        self.this_depth -= 1;
    }

    fn visit_this_expression(&mut self, it: &ThisExpression) {
        if self.this_depth == 0 {
            self.error(
                "logic.top_level_this",
                "`this` at the top level of the module is `undefined`",
                it.span,
                "use `globalThis` or a module variable",
            );
        }
    }

    fn visit_await_expression(&mut self, it: &AwaitExpression<'a>) {
        if self.function_depth == 0 {
            self.error(
                "logic.top_level_await",
                "top-level `await` is not supported: logic.js runs as one script",
                it.span,
                "start the work from an async function: `void start();`",
            );
        }
        walk::walk_await_expression(self, it);
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        if it.r#await && self.function_depth == 0 {
            self.error(
                "logic.top_level_await",
                "top-level `for await` is not supported: logic.js runs as one script",
                it.span,
                "move the loop into an async function",
            );
        }
        walk::walk_for_of_statement(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.dynamic_code(&it.callee, it.span);
        walk::walk_call_expression(self, it);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        self.dynamic_code(&it.callee, it.span);
        walk::walk_new_expression(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if self.is_global(&it.object, "globalThis") {
            let name = it.property.name.as_str();
            if !VM_GLOBALS.contains(&name) {
                self.error(
                    "logic.unavailable_global",
                    format!("`globalThis.{name}` does not exist in the widget VM"),
                    it.property.span,
                    &missing_global_help(name),
                );
            }
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_import_expression(&mut self, it: &oxc_ast::ast::ImportExpression<'a>) {
        self.error(
            "logic.dynamic_import",
            "dynamic `import()` always fails in the widget VM",
            it.span,
            "the whole widget is one bundle: use a static import of @overcrow/sdk",
        );
        walk::walk_import_expression(self, it);
    }

    fn visit_import_meta(&mut self, it: &oxc_ast::ast::ImportMeta) {
        self.error(
            "logic.import_meta",
            "`import.meta` does not exist in the widget VM",
            it.span,
            "the bundle is a script, not a module",
        );
    }

    fn visit_decorator(&mut self, it: &Decorator<'a>) {
        self.error(
            "logic.syntax_version",
            "decorators are not ES2023",
            it.span,
            "call the function explicitly",
        );
        walk::walk_decorator(self, it);
    }

    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        if matches!(
            it.kind,
            VariableDeclarationKind::Using | VariableDeclarationKind::AwaitUsing
        ) {
            self.error(
                "logic.syntax_version",
                "`using` declarations are not ES2023",
                it.span,
                "call the resource's dispose method in a `finally` block",
            );
        }
        walk::walk_variable_declaration(self, it);
    }

    fn visit_reg_exp_literal(&mut self, it: &RegExpLiteral<'a>) {
        if it.regex.flags.contains(oxc_ast::ast::RegExpFlags::V) {
            self.error(
                "logic.syntax_version",
                "the regular expression flag `v` is not ES2023",
                it.span,
                "use the `u` flag",
            );
        }
    }

    fn visit_debugger_statement(&mut self, it: &oxc_ast::ast::DebuggerStatement) {
        self.report.push(
            Diagnostic::warning(
                "logic.debugger",
                "`debugger` has no effect in the widget VM",
            )
            .in_file(self.path)
            .at(position(self.source, it.span)),
        );
    }
}
