//! Builds `logic.js`: the logic module, the embedded `@overcrow/sdk` and the
//! view table, linked into one ES2023 script without imports.
//!
//! 1. Each module is parsed, its TypeScript stripped (oxc, target ES2023)
//!    and printed back as JavaScript.
//! 2. The linker reads the imports and exports of every module reachable
//!    from the generated view module, and orders them as ES module
//!    evaluation would (depth first, in import order).
//! 3. Scope hoisting: every top-level binding gets a name unique in the
//!    bundle, each import binding takes the name of the binding it resolves
//!    to, and `ns.name` on a namespace import becomes that binding. Import
//!    and export declarations disappear.
//! 4. The modules are concatenated inside `(() => { "use strict"; ... })()`,
//!    then oxc's minifier compresses, removes what nothing uses (unused SDK
//!    functions and `/* @__PURE__ */` initializers: the tree shaking) and
//!    mangles local names. Globals (`overcrow`, `globalThis`, `Date`...) are
//!    never bindings of the bundle, so they are never renamed or removed.
//!
//! The output is a function of the sources and of this CLI only: modules
//! are visited in a fixed order and oxc is deterministic.
//!
//! On request, each of the three prints (stripped, linked, minified) also
//! gives a source map; composed, they map `logic.js` back to the sources
//! (`crate::sourcemap`). Asking for the map never changes the code.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::Path;

use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::ast::{Expression, ImportDeclarationSpecifier, ModuleExportName, Program, Statement};
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_codegen::{Codegen, CodegenOptions, CommentOptions};
use oxc_ecmascript::BoundNames;
use oxc_minifier::{CompressOptions, MangleOptions, Minifier, MinifierOptions};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_sourcemap::{ConcatSourceMapBuilder, SourceMap};
use oxc_span::{SourceType, Span};
use oxc_str::Ident;
use oxc_syntax::symbol::SymbolId;
use oxc_transformer::{TransformOptions, Transformer};

use overcrow_widget_format::ocml::{CompiledView, Role, TemplateExpression};

use crate::diag::Diagnostic;
use crate::lint::{self, SDK_SPECIFIER};
use crate::sdk;
use crate::sourcemap;

/// Module IDs: `logic`, `view`, or `sdk/<path of sdk/src>`.
const LOGIC: &str = "logic";
const VIEW: &str = "view";
const SDK_PREFIX: &str = "sdk/";
/// Language level of the bundle: the VM runs ES2023 (ADR 0002).
const TARGET: &str = "es2023";

/// The parameters of generated table functions start with `__`, which the
/// view's expressions can never name, so they never shadow a called
/// function or a name in scope.
const SCOPE_PARAM: &str = "__scope";
const RAW_PARAM: &str = "__raw";
const REGISTER: &str = "__registerView";

pub struct Bundle {
    /// `logic.js`, with the SDK notice first.
    pub code: String,
    /// Modules linked, the view table included.
    pub modules: usize,
    /// The code map of `logic.js` (JSON), when asked for.
    pub map: Option<String>,
}

/// A bundling failure: a diagnostic about the logic module, or an internal
/// error of the linker on the embedded SDK (a bug of this CLI).
pub type Result<T> = std::result::Result<T, Diagnostic>;

pub fn build(
    logic_path: &str,
    logic_source: &str,
    view: &CompiledView,
    logic_exports: &BTreeSet<String>,
    map: bool,
) -> Result<Bundle> {
    let table = view_module(view, logic_exports);
    let mut sources: BTreeMap<String, (String, SourceType)> = BTreeMap::new();
    sources.insert(VIEW.into(), (table, SourceType::mjs()));
    sources.insert(
        LOGIC.into(),
        (logic_source.to_owned(), lint::source_type(logic_path)),
    );
    for (path, source) in sdk::MODULES {
        sources.insert(
            format!("{SDK_PREFIX}{path}"),
            ((*source).to_owned(), SourceType::ts()),
        );
    }

    // 1. JavaScript of every module that may be reached.
    let mut javascript = BTreeMap::new();
    let mut stripped_maps = BTreeMap::new();
    for (id, (source, source_type)) in &sources {
        let display = display_path(id, logic_path);
        let map_name = map.then(|| map_source(id, logic_path));
        let (code, stripped_map) = strip_types(&display, source, *source_type, map_name)?;
        javascript.insert(id.clone(), code);
        if let Some(stripped_map) = stripped_map {
            stripped_maps.insert(id.clone(), stripped_map);
        }
    }

    // 2. Imports, exports and evaluation order.
    let mut modules = BTreeMap::new();
    let mut order = Vec::new();
    visit(VIEW, &javascript, &mut modules, &mut order, logic_path)?;

    // 3. Unique names for every top-level binding.
    let mut taken: BTreeSet<String> = BTreeSet::new();
    for module in modules.values() {
        taken.extend(module.names.iter().cloned());
    }
    let mut finals: BTreeMap<(String, String), String> = BTreeMap::new();
    for id in &order {
        let module = &modules[id];
        for local in &module.locals {
            let mut candidate = format!("{local}${}", finals.len());
            while taken.contains(&candidate) {
                candidate.push('_');
            }
            taken.insert(candidate.clone());
            finals.insert((id.clone(), local.clone()), candidate);
        }
    }
    let linker = Linker {
        modules: &modules,
        finals: &finals,
        logic_path,
    };

    // The script starts with two lines: `(() => {` and `"use strict";`.
    let mut body = String::new();
    let mut line = 2;
    let mut linked_maps = Vec::new();
    for id in &order {
        let (text, printed_map, prefix_lines) = linker.print(id, &javascript[id], map)?;
        if let (Some(printed_map), Some(stripped_map)) = (printed_map, stripped_maps.remove(id)) {
            linked_maps.push((printed_map.compose(stripped_map), line + prefix_lines));
        }
        body.push_str(&text);
        body.push('\n');
        line += sourcemap::line_breaks(&text) + 1;
    }

    // 4. One script, minified.
    let script = format!("(() => {{\n\"use strict\";\n{body}}})();\n");
    let (minified, minified_map) = minify(&script, map)?;
    // The notice and its line break come before the minified script.
    let notice_lines = sourcemap::line_breaks(sdk::NOTICE) + 1;
    let map = minified_map.map(|minified_map| {
        let linked = ConcatSourceMapBuilder::from_owned_sourcemaps(linked_maps).into_sourcemap();
        let shipped = ConcatSourceMapBuilder::from_owned_sourcemaps(vec![(
            minified_map.compose(linked),
            notice_lines,
        )])
        .into_sourcemap();
        let originals: Vec<(String, String, SourceType)> = sources
            .iter()
            .map(|(id, (source, source_type))| {
                (map_source(id, logic_path), source.clone(), *source_type)
            })
            .collect();
        sourcemap::finish(&shipped, &originals)
    });
    Ok(Bundle {
        code: format!("{}\n{minified}", sdk::NOTICE),
        modules: order.len(),
        map,
    })
}

/// The name of a module in the code map.
fn map_source(id: &str, logic_path: &str) -> String {
    match id {
        VIEW => sourcemap::VIEW_TABLE.to_owned(),
        _ => display_path(id, logic_path),
    }
}

fn map_options(name: Option<String>, options: CodegenOptions) -> CodegenOptions {
    CodegenOptions {
        source_map_path: name.map(std::path::PathBuf::from),
        ..options
    }
}

fn display_path(id: &str, logic_path: &str) -> String {
    match id {
        LOGIC => logic_path.to_owned(),
        VIEW => "view table".to_owned(),
        _ => format!("@overcrow/sdk/{}", &id[SDK_PREFIX.len()..]),
    }
}

fn internal(message: impl Into<String>) -> Diagnostic {
    Diagnostic::error("bundle.internal", message.into())
        .help("this is a bug of overcrow-widget; please report it with the widget sources")
}

/// Parses `source`, strips its TypeScript and prints JavaScript. Comments
/// are kept so that `/* @__PURE__ */` annotations reach the minifier. With
/// `map_name`, also the map of the printed code back to `source`.
fn strip_types(
    display: &str,
    source: &str,
    source_type: SourceType,
    map_name: Option<String>,
) -> Result<(String, Option<SourceMap<'static>>)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if let Some(error) = parsed.diagnostics.first() {
        return Err(lint::oxc_diagnostic("logic.syntax", error, display, source));
    }
    let mut program = parsed.program;
    let scoping = SemanticBuilder::new()
        .build(&program)
        .semantic
        .into_scoping();
    let options = TransformOptions::from_target(TARGET).map_err(internal)?;
    let transformed = Transformer::new(&allocator, Path::new(display), &options)
        .build_with_scoping(scoping, &mut program);
    if let Some(error) = transformed.diagnostics.first() {
        return Err(lint::oxc_diagnostic("logic.syntax", error, display, source));
    }
    let printed = Codegen::new()
        .with_options(map_options(map_name, CodegenOptions::default()))
        .build(&program);
    Ok((printed.code, printed.map.map(SourceMap::into_owned)))
}

/// What the linker knows of one module.
#[derive(Debug, Default)]
struct Module {
    /// `import { a as b } from "x"`: local `b` -> (module, `a`); `None` for
    /// `import * as b`.
    imports: BTreeMap<String, (String, Option<String>)>,
    /// `export { local as name }` and exported declarations.
    local_exports: BTreeMap<String, String>,
    /// `export { a as name } from "x"`: name -> (module, `a`).
    indirect_exports: BTreeMap<String, (String, String)>,
    /// `export * from "x"`, in order.
    star_exports: Vec<String>,
    /// Top-level bindings that are not imports.
    locals: Vec<String>,
    /// Every symbol and global name in the module, to keep new names fresh.
    names: BTreeSet<String>,
}

/// Where an export name leads.
#[derive(Clone, Debug, Eq, PartialEq)]
enum Target {
    Binding(String, String),
    Namespace(String),
}

fn resolve_specifier(from: &str, specifier: &str, logic_path: &str) -> Result<String> {
    if specifier == SDK_SPECIFIER {
        return Ok(format!("{SDK_PREFIX}{}", sdk::ENTRY));
    }
    if from == VIEW && specifier == "./logic" {
        return Ok(LOGIC.into());
    }
    if let Some(inner) = from.strip_prefix(SDK_PREFIX)
        && (specifier.starts_with("./") || specifier.starts_with("../"))
    {
        let mut parts: Vec<&str> = inner.split('/').collect();
        parts.pop();
        for part in specifier.split('/') {
            match part {
                ".." => {
                    parts.pop();
                }
                "." => {}
                part => parts.push(part),
            }
        }
        let path = parts.join("/");
        if let Some(stem) = path.strip_suffix(".js")
            && sdk::module(&format!("{stem}.ts")).is_some()
        {
            return Ok(format!("{SDK_PREFIX}{stem}.ts"));
        }
    }
    Err(
        Diagnostic::error("logic.import", format!("`{specifier}` cannot be imported"))
            .in_file(display_path(from, logic_path)),
    )
}

fn visit(
    id: &str,
    javascript: &BTreeMap<String, String>,
    modules: &mut BTreeMap<String, Module>,
    order: &mut Vec<String>,
    logic_path: &str,
) -> Result<()> {
    if modules.contains_key(id) {
        return Ok(());
    }
    let source = javascript
        .get(id)
        .ok_or_else(|| internal(format!("missing module {id}")))?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::mjs()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(internal(format!(
            "{id} does not parse after type stripping"
        )));
    }
    let program = parsed.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;
    let scoping = semantic.scoping();

    let mut module = Module::default();
    let mut requests = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                let target = resolve_specifier(id, import.source.value.as_str(), logic_path)?;
                requests.push(target.clone());
                for specifier in import.specifiers.iter().flatten() {
                    match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            module.imports.insert(
                                named.local.name.to_string(),
                                (target.clone(), Some(export_name(&named.imported))),
                            );
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                            module
                                .imports
                                .insert(namespace.local.name.to_string(), (target.clone(), None));
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                            return Err(Diagnostic::error(
                                "logic.import",
                                "@overcrow/sdk has no default export",
                            )
                            .in_file(display_path(id, logic_path))
                            .help(format!(
                                "write `import {{ ... }} from \"@overcrow/sdk\"` or `import * as {} from \"@overcrow/sdk\"`",
                                default.local.name
                            )));
                        }
                    }
                }
            }
            Statement::ExportFromDeclaration(export) => {
                let target = resolve_specifier(id, export.source.value.as_str(), logic_path)?;
                requests.push(target.clone());
                for specifier in &export.specifiers {
                    module.indirect_exports.insert(
                        export_name(&specifier.exported),
                        (target.clone(), export_name(&specifier.local)),
                    );
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    module.local_exports.insert(
                        export_name(&specifier.exported),
                        export_name(&specifier.local),
                    );
                }
            }
            Statement::ExportDeclaration(export) => {
                export.declaration.bound_names(&mut |binding| {
                    module
                        .local_exports
                        .insert(binding.name.to_string(), binding.name.to_string());
                });
            }
            Statement::ExportAllDeclaration(export) => {
                if export.exported.is_some() {
                    return Err(internal(format!("{id}: `export * as` is not supported")));
                }
                let target = resolve_specifier(id, export.source.value.as_str(), logic_path)?;
                requests.push(target.clone());
                module.star_exports.push(target);
            }
            Statement::ExportDefaultDeclaration(_) => {
                return Err(Diagnostic::error(
                    "logic.default_export",
                    "the view calls named exports; `export default` is never used",
                )
                .in_file(display_path(id, logic_path)));
            }
            _ => {}
        }
    }

    let root = scoping.root_scope_id();
    let mut locals: Vec<(u32, String)> = scoping
        .get_bindings(root)
        .iter()
        .filter(|(name, _)| !module.imports.contains_key(name.as_str()))
        .map(|(name, symbol)| (scoping.symbol_span(*symbol).start, name.to_string()))
        .collect();
    locals.sort();
    module.locals = locals.into_iter().map(|(_, name)| name).collect();
    module.names = scoping.symbol_names().map(str::to_owned).collect();
    module.names.extend(
        scoping
            .root_unresolved_references()
            .keys()
            .map(|name| name.to_string()),
    );

    modules.insert(id.to_owned(), module);
    for request in requests {
        visit(&request, javascript, modules, order, logic_path)?;
    }
    order.push(id.to_owned());
    Ok(())
}

fn export_name(name: &ModuleExportName<'_>) -> String {
    name.name().to_string()
}

struct Linker<'l> {
    modules: &'l BTreeMap<String, Module>,
    finals: &'l BTreeMap<(String, String), String>,
    logic_path: &'l str,
}

impl Linker<'_> {
    /// Where `name`, exported by `module`, leads.
    fn resolve(&self, module: &str, name: &str, depth: usize) -> Option<Target> {
        if depth > 64 {
            return None;
        }
        let record = self.modules.get(module)?;
        if let Some(local) = record.local_exports.get(name) {
            return match record.imports.get(local) {
                Some((source, Some(imported))) => self.resolve(source, imported, depth + 1),
                Some((source, None)) => Some(Target::Namespace(source.clone())),
                None => Some(Target::Binding(module.to_owned(), local.clone())),
            };
        }
        if let Some((source, imported)) = record.indirect_exports.get(name) {
            return self.resolve(source, imported, depth + 1);
        }
        if name != "default" {
            for source in &record.star_exports {
                if let Some(target) = self.resolve(source, name, depth + 1) {
                    return Some(target);
                }
            }
        }
        None
    }

    /// Every export name of `module`, sorted.
    fn export_names(&self, module: &str, depth: usize, out: &mut BTreeSet<String>) {
        let Some(record) = self.modules.get(module).filter(|_| depth <= 64) else {
            return;
        };
        out.extend(record.local_exports.keys().cloned());
        out.extend(record.indirect_exports.keys().cloned());
        for source in &record.star_exports {
            let mut inner = BTreeSet::new();
            self.export_names(source, depth + 1, &mut inner);
            out.extend(inner.into_iter().filter(|name| name != "default"));
        }
    }

    fn final_name(&self, target: &Target) -> Option<String> {
        match target {
            Target::Binding(module, local) => {
                self.finals.get(&(module.clone(), local.clone())).cloned()
            }
            Target::Namespace(_) => None,
        }
    }

    /// The object of a namespace import used as a value: every export of
    /// the module, frozen, without prototype.
    fn namespace_object(&self, module: &str) -> Result<String> {
        let mut names = BTreeSet::new();
        self.export_names(module, 0, &mut names);
        let mut out = String::from("Object.freeze({ __proto__: null");
        for name in names {
            let target = self
                .resolve(module, &name, 0)
                .and_then(|target| self.final_name(&target))
                .ok_or_else(|| internal(format!("unresolved export {name} of {module}")))?;
            let _ = write!(
                out,
                ", {}: {target}",
                serde_json::to_string(&name).unwrap_or_default()
            );
        }
        out.push_str(" })");
        Ok(out)
    }

    /// The module's JavaScript with its bindings renamed and its import and
    /// export declarations removed; with `map`, also the map of the printed
    /// code back to `source` and the number of lines put before it.
    fn print(
        &self,
        id: &str,
        source: &str,
        map: bool,
    ) -> Result<(String, Option<SourceMap<'static>>, u32)> {
        let module = &self.modules[id];
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::mjs()).parse();
        let mut program = parsed.program;
        let mut scoping = SemanticBuilder::new()
            .build(&program)
            .semantic
            .into_scoping();
        let root = scoping.root_scope_id();
        let bindings: Vec<(String, SymbolId)> = scoping
            .get_bindings(root)
            .iter()
            .map(|(name, symbol)| (name.to_string(), *symbol))
            .collect();

        let mut namespaces: BTreeMap<SymbolId, (String, String)> = BTreeMap::new();
        let mut prefix = String::new();
        for (name, symbol) in bindings {
            let new_name = match module.imports.get(&name) {
                Some((source, Some(imported))) => {
                    let target = self.resolve(source, imported, 0).ok_or_else(|| {
                        Diagnostic::error(
                            "logic.import",
                            format!("@overcrow/sdk does not export `{imported}`"),
                        )
                        .in_file(display_path(id, self.logic_path))
                        .help("see https://overcrow.playervox.com/docs/en/sdk/ for the exported names")
                    })?;
                    match target {
                        Target::Namespace(module) => {
                            return Err(internal(format!(
                                "{id}: re-exported namespace {module} is not supported"
                            )));
                        }
                        binding => self
                            .final_name(&binding)
                            .ok_or_else(|| internal(format!("no name for {imported}")))?,
                    }
                }
                Some((source, None)) => {
                    // A namespace import: members become direct references;
                    // any other use sees a frozen namespace object.
                    let fresh = format!("{name}$ns${}", namespaces.len());
                    namespaces.insert(symbol, (source.clone(), fresh.clone()));
                    fresh
                }
                None => self
                    .finals
                    .get(&(id.to_owned(), name.clone()))
                    .cloned()
                    .ok_or_else(|| internal(format!("no name for {name} in {id}")))?,
            };
            scoping.set_symbol_name(symbol, Ident::from(allocator.alloc_str(&new_name)));
        }

        let mut rewriter = NamespaceRewriter {
            allocator: &allocator,
            scoping: &scoping,
            namespaces: &namespaces,
            linker: self,
            error: None,
            object_uses: BTreeSet::new(),
        };
        rewriter.visit_program(&mut program);
        if let Some(error) = rewriter.error {
            return Err(error);
        }
        for symbol in rewriter.object_uses.clone() {
            let (source, fresh) = &namespaces[&symbol];
            let _ = writeln!(
                prefix,
                "const {fresh} = {};",
                self.namespace_object(source)?
            );
        }
        remove_module_syntax(&allocator, &mut program);
        let printed = Codegen::new()
            .with_options(map_options(
                map.then(|| id.to_owned()),
                CodegenOptions {
                    comments: CommentOptions {
                        annotation: true,
                        ..CommentOptions::disabled()
                    },
                    ..CodegenOptions::default()
                },
            ))
            .with_scoping(Some(scoping))
            .build(&program);
        let prefix_lines = sourcemap::line_breaks(&prefix);
        Ok((
            format!("{prefix}{}", printed.code),
            printed.map.map(SourceMap::into_owned),
            prefix_lines,
        ))
    }
}

/// Replaces `ns.member` of a namespace import with the member's binding.
struct NamespaceRewriter<'a, 'l> {
    allocator: &'a Allocator,
    scoping: &'l Scoping,
    namespaces: &'l BTreeMap<SymbolId, (String, String)>,
    linker: &'l Linker<'l>,
    error: Option<Diagnostic>,
    /// Namespaces also used as values.
    object_uses: BTreeSet<SymbolId>,
}

impl NamespaceRewriter<'_, '_> {
    fn namespace_of(&self, expression: &Expression<'_>) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        let reference = identifier.reference_id.get()?;
        let symbol = self.scoping.get_reference(reference).symbol_id()?;
        self.namespaces.contains_key(&symbol).then_some(symbol)
    }
}

impl<'a> VisitMut<'a> for NamespaceRewriter<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::StaticMemberExpression(member) = expression
            && let Some(symbol) = self.namespace_of(&member.object)
        {
            let (module, _) = &self.namespaces[&symbol];
            let name = member.property.name.as_str();
            match self
                .linker
                .resolve(module, name, 0)
                .and_then(|target| self.linker.final_name(&target))
            {
                Some(final_name) => {
                    let span: Span = member.span;
                    *expression = Expression::new_identifier(
                        span,
                        Ident::from(self.allocator.alloc_str(&final_name)),
                        &AstBuilder::new(self.allocator),
                    );
                }
                None => {
                    self.error.get_or_insert(
                        Diagnostic::error(
                            "logic.import",
                            format!("@overcrow/sdk does not export `{name}`"),
                        )
                        .help("see https://overcrow.playervox.com/docs/en/sdk/ for the exported names"),
                    );
                }
            }
            return;
        }
        if let Some(symbol) = self.namespace_of(expression) {
            self.object_uses.insert(symbol);
        }
        walk_mut::walk_expression(self, expression);
    }
}

/// Drops import declarations and `export` wrappers, keeping exported
/// declarations as plain statements.
fn remove_module_syntax<'a>(allocator: &'a Allocator, program: &mut Program<'a>) {
    let body = std::mem::replace(&mut program.body, ArenaVec::new_in(&allocator));
    for statement in body {
        match statement {
            Statement::ImportDeclaration(_)
            | Statement::ExportAllDeclaration(_)
            | Statement::ExportNamedDeclaration(_)
            | Statement::ExportFromDeclaration(_) => {}
            Statement::ExportDeclaration(export) => {
                program
                    .body
                    .push(Statement::from(export.unbox().declaration));
            }
            other => program.body.push(other),
        }
    }
}

fn minify(script: &str, map: bool) -> Result<(String, Option<SourceMap<'static>>)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, script, SourceType::cjs().with_script(true)).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(internal("the linked bundle does not parse"));
    }
    let mut program = parsed.program;
    let mut compress = CompressOptions::smallest();
    compress.target = oxc_compat::EngineTargets::from_target(TARGET).map_err(internal)?;
    let minified = Minifier::new(MinifierOptions {
        mangle: Some(MangleOptions::default()),
        compress: Some(compress),
        ..MinifierOptions::default()
    })
    .minify(&allocator, &mut program);
    let printed = Codegen::new()
        .with_options(map_options(
            map.then(|| "script.js".to_owned()),
            CodegenOptions::minify(),
        ))
        .with_scoping(minified.scoping)
        .build(&program);
    Ok((printed.code, printed.map.map(SourceMap::into_owned)))
}

// ------------------------------------------------------------- view table

/// The generated view module: the expression table of `view.json` in the
/// calling convention of `registerView` (docs/cli.md). Called
/// names are the logic module's exports; `t` is the SDK's unless the logic
/// module exports its own.
pub fn view_module(view: &CompiledView, logic_exports: &BTreeSet<String>) -> String {
    let mut from_logic: Vec<&str> = view
        .functions
        .iter()
        .map(String::as_str)
        .filter(|name| *name != "t" || logic_exports.contains("t"))
        .collect();
    from_logic.sort_unstable();
    let sdk_t = view.functions.iter().any(|name| name == "t") && !logic_exports.contains("t");
    // The logic module always runs first, even when the view calls none of
    // its functions: it owns the state and the timers.
    let mut out =
        String::from("// The view table, generated by overcrow-widget.\nimport \"./logic\";\n");
    if !from_logic.is_empty() {
        let _ = writeln!(
            out,
            "import {{ {} }} from \"./logic\";",
            from_logic.join(", ")
        );
    }
    let _ = writeln!(
        out,
        "import {{ registerView as {REGISTER}{} }} from \"@overcrow/sdk\";",
        if sdk_t { ", t" } else { "" }
    );
    let _ = writeln!(out, "{REGISTER}([");
    for expression in &view.expressions {
        out.push_str(&table_entry(expression));
    }
    out.push_str("]);\n");
    out
}

/// One entry: names in scope bound from the scope, `event` bound to the
/// event detail in a handler, then the canonical expression.
pub fn table_entry(expression: &TemplateExpression) -> String {
    let handler = expression.role == Role::Handler;
    let mut out = if handler {
        format!("  function (state, {SCOPE_PARAM}, {RAW_PARAM}) {{\n")
    } else {
        format!("  function (state, {SCOPE_PARAM}) {{\n")
    };
    for name in &expression.scope {
        if handler && name == "event" {
            let _ = writeln!(out, "    const event = {RAW_PARAM}.detail;");
        } else {
            let _ = writeln!(out, "    const {name} = {SCOPE_PARAM}.{name};");
        }
    }
    let _ = writeln!(out, "    return {};\n  }},", expression.expr.to_js());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use overcrow_widget_format::ocml::compile;

    fn view(source: &str) -> CompiledView {
        compile(source.as_bytes(), &BTreeSet::new()).expect("test view compiles")
    }

    fn exports(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    fn bundle(logic: &str, view_source: &str, names: &[&str]) -> String {
        build(
            "logic.ts",
            logic,
            &view(view_source),
            &exports(names),
            false,
        )
        .unwrap_or_else(|diagnostic| panic!("bundles: {}", diagnostic.render(None)))
        .code
    }

    const COUNTER_VIEW: &str = "<box><text>{label(state.count)}</text><button on:activate={add}><text>+</text></button></box>";
    const COUNTER: &str = "import { initState, formatNumber } from \"@overcrow/sdk\";\n\
        declare module \"@overcrow/sdk\" { interface WidgetState { count: number } }\n\
        const state = initState({ count: 0 });\n\
        export function label(count: number): string { return formatNumber(count); }\n\
        export function add(): void { state.count += 1; }\n";

    #[test]
    fn the_table_follows_the_calling_convention() {
        let compiled = view(
            "<box><for each={state.items} as=\"item\" key={item.id}>\
             <button on:activate={remove(item.id, event)}><text>{t(\"x\")}</text></button></for></box>",
        );
        let module = view_module(&compiled, &exports(&["remove"]));
        assert_eq!(
            module,
            "// The view table, generated by overcrow-widget.\n\
             import \"./logic\";\n\
             import { remove } from \"./logic\";\n\
             import { registerView as __registerView, t } from \"@overcrow/sdk\";\n\
             __registerView([\n  \
             function (state, __scope) {\n    return state.items;\n  },\n  \
             function (state, __scope) {\n    const item = __scope.item;\n    return item.id;\n  },\n  \
             function (state, __scope, __raw) {\n    const item = __scope.item;\n    \
             const event = __raw.detail;\n    return remove(item.id, event);\n  },\n  \
             function (state, __scope) {\n    const item = __scope.item;\n    return t(\"x\");\n  },\n\
             ]);\n"
        );
        let own_t = view_module(&compiled, &exports(&["remove", "t"]));
        assert!(own_t.contains("import { remove, t } from \"./logic\";"));
        assert!(own_t.contains("import { registerView as __registerView } from"));
    }

    #[test]
    fn the_bundle_is_one_script_without_module_syntax() {
        let code = bundle(COUNTER, COUNTER_VIEW, &["add", "label"]);
        assert!(code.starts_with(sdk::NOTICE), "the SDK notice comes first");
        let body = &code[sdk::NOTICE.len()..];
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, body, SourceType::cjs().with_script(true)).parse();
        assert!(parsed.diagnostics.is_empty(), "parses as a classic script");
        assert!(
            !parsed.module_record.has_module_syntax,
            "no import or export remains"
        );
        for keyword in ["import", "export", "require("] {
            assert!(!body.contains(keyword), "{keyword} in {body}");
        }
    }

    #[test]
    fn globals_survive_mangling_and_dead_code_removal() {
        let logic = "import { initState } from \"@overcrow/sdk\";\n\
            const state = initState({ now: Date.now(), pi: Math.PI });\n\
            export function tick(): void { state.now = Date.now() + Number(JSON.parse(\"1\")); }\n\
            export function raw(): unknown { return (globalThis as any).overcrow.host; }\n";
        let code = bundle(
            logic,
            "<box><button on:activate={tick}/><text>{raw()}</text></box>",
            &["raw", "tick"],
        );
        for global in [
            "globalThis.overcrow",
            "Date.now()",
            "Math.PI",
            "JSON.parse",
            "Object.assign",
            "Number(",
        ] {
            assert!(code.contains(global), "{global} kept in {code}");
        }
    }

    #[test]
    fn unused_sdk_code_is_removed() {
        let code = bundle(COUNTER, COUNTER_VIEW, &["add", "label"]);
        // Used: formatNumber and what it needs. Unused: timers, services,
        // drawing and the other formatters.
        assert!(
            code.contains("numberFormat"),
            "formatNumber reads the region"
        );
        for absent in [
            "writeText",
            "playPause",
            "gameEvents",
            "reviews.page",
            "offsetMinutes",
        ] {
            assert!(
                !code.contains(absent),
                "{absent} should be tree-shaken: {code}"
            );
        }
    }

    #[test]
    fn namespace_imports_link_and_tree_shake() {
        let logic = "import * as sdk from \"@overcrow/sdk\";\n\
            const state = sdk.initState({ count: 0 });\n\
            export function add(): void { state.count += 1; sdk.log.info(\"added\"); }\n";
        let code = bundle(logic, "<box><button on:activate={add}/></box>", &["add"]);
        assert!(code.contains("added"));
        assert!(
            !code.contains("clipboard"),
            "no namespace object when only members are used"
        );

        let whole = "import * as sdk from \"@overcrow/sdk\";\n\
            const keys = Object.keys(sdk);\n\
            export function count(): number { return keys.length; }\n";
        let code = bundle(whole, "<box><text>{count()}</text></box>", &["count"]);
        assert!(
            code.contains("clipboard"),
            "a namespace used as a value is materialized"
        );
    }

    #[test]
    fn two_builds_are_identical() {
        let first = bundle(COUNTER, COUNTER_VIEW, &["add", "label"]);
        let second = bundle(COUNTER, COUNTER_VIEW, &["add", "label"]);
        assert_eq!(first, second);
    }

    #[test]
    fn unknown_sdk_names_are_reported() {
        let logic = "import { nothing } from \"@overcrow/sdk\";\nexport function f(): unknown { return nothing; }\n";
        let error = match build(
            "logic.ts",
            logic,
            &view("<box><text>{f()}</text></box>"),
            &exports(&["f"]),
            false,
        ) {
            Err(error) => error,
            Ok(_) => panic!("an unknown SDK export must fail"),
        };
        assert_eq!(error.code, "logic.import");
        assert!(error.message.contains("nothing"));
    }

    // ------------------------------------------------------------ code map

    fn mapped(logic: &str, view_source: &str, names: &[&str]) -> Bundle {
        build("logic.ts", logic, &view(view_source), &exports(names), true)
            .unwrap_or_else(|diagnostic| panic!("bundles: {}", diagnostic.render(None)))
    }

    /// Zero-based line and UTF-16 column of the first `needle` in `code`.
    fn position_of(code: &str, needle: &str) -> (u32, u32) {
        let at = code
            .find(needle)
            .unwrap_or_else(|| panic!("{needle} in {code}"));
        let line_start = code[..at].rfind('\n').map_or(0, |newline| newline + 1);
        (
            code[..at].matches('\n').count() as u32,
            code[line_start..at].encode_utf16().count() as u32,
        )
    }

    const EXPLODING: &str = r#"import { initState } from "@overcrow/sdk";
const state = initState({ count: 0 });
export function label(): string {
  return String(state.count);
}
export function explode(): void {
  if (state.count > 2) {
    throw new Error("boom");
  }
  state.count += 1;
}
"#;
    const EXPLODING_VIEW: &str = "<box><text>{label()}</text><button on:activate={explode}/></box>";

    #[test]
    fn a_thrown_error_maps_back_to_its_source_line() {
        let built = mapped(EXPLODING, EXPLODING_VIEW, &["explode", "label"]);
        let map = built.map.as_deref().expect("a map");
        // The SDK throws too: the logic's throw is the one with `boom`.
        let (line, column) = position_of(&built.code, "throw Error(`boom`)");
        assert_eq!(
            sourcemap::resolve(map, line, column),
            Some(sourcemap::Resolved {
                source: "logic.ts".into(),
                line: 7,
                column: 4,
                function: Some("explode".into()),
            }),
            "{}",
            built.code
        );
        let (line, column) = position_of(&built.code, "`boom`");
        let resolved = sourcemap::resolve(map, line, column).expect("mapped");
        assert_eq!((resolved.source.as_str(), resolved.line), ("logic.ts", 7));
        assert_eq!(resolved.column, 20, "the string literal itself");
    }

    #[test]
    fn sdk_and_view_positions_map_to_their_own_sources() {
        let built = mapped(EXPLODING, EXPLODING_VIEW, &["explode", "label"]);
        let map_json = built.map.expect("a map");
        let map = oxc_sourcemap::SourceMap::from_json_string(&map_json).expect("valid map");
        let value: serde_json::Value = serde_json::from_str(&map_json).unwrap();
        let sources: Vec<&str> = value["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|source| source.as_str().unwrap())
            .collect();
        let logic_lines = EXPLODING.lines().count() as u32;
        let (mut view, mut sdk) = (false, false);
        for token in map.get_tokens() {
            let Some(source) = token.get_source_id() else {
                continue;
            };
            let name = sources[source as usize];
            if name == "logic.ts" {
                assert!(token.get_src_line() < logic_lines, "inside logic.ts");
            }
            if name == sourcemap::VIEW_TABLE {
                let resolved =
                    sourcemap::resolve(&map_json, token.get_dst_line(), token.get_dst_col())
                        .unwrap();
                view |= resolved
                    .function
                    .is_some_and(|function| function.starts_with("view expression "));
            }
            sdk |= name.starts_with("@overcrow/sdk/");
        }
        assert!(view, "a position of the view table names its expression");
        assert!(sdk, "the SDK keeps its own sources");
        let ignored: Vec<&str> = value["ignoreList"]
            .as_array()
            .unwrap()
            .iter()
            .map(|index| sources[index.as_u64().unwrap() as usize])
            .collect();
        assert!(!ignored.is_empty());
        assert!(
            ignored
                .iter()
                .all(|name| name.starts_with("@overcrow/sdk/"))
        );
        let contents = value["sourcesContent"].as_array().unwrap();
        for (name, content) in sources.iter().zip(contents) {
            assert_eq!(
                content.is_string(),
                *name == sourcemap::VIEW_TABLE,
                "{name}"
            );
        }
        assert_eq!(value["file"], "logic.js");
    }

    #[test]
    fn the_map_never_changes_the_code_and_is_deterministic() {
        let plain = bundle(EXPLODING, EXPLODING_VIEW, &["explode", "label"]);
        let first = mapped(EXPLODING, EXPLODING_VIEW, &["explode", "label"]);
        let second = mapped(EXPLODING, EXPLODING_VIEW, &["explode", "label"]);
        assert_eq!(first.code, plain);
        assert!(!plain.contains("sourceMappingURL"));
        assert_eq!(first.map, second.map);
        assert!(bundle_without_map_has_none());
    }

    fn bundle_without_map_has_none() -> bool {
        build(
            "logic.ts",
            EXPLODING,
            &view(EXPLODING_VIEW),
            &exports(&["explode", "label"]),
            false,
        )
        .is_ok_and(|bundle| bundle.map.is_none())
    }
}
