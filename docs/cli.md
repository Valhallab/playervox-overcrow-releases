# The widget CLI: `overcrow-widget`

`overcrow-widget` creates, checks and packages widgets for widget API v1. It
is one Rust binary for Linux and Windows, built from `cli/` in this
repository (MIT). It compiles the same public validators the OverCrow host
runs at admission and at every activation (`crates/overcrow-widget-schema`
and `crates/overcrow-widget-format`), so a package it accepts is a package
the host reads.

```sh
overcrow-widget init my-widget --template counter
cd my-widget
npm install              # TypeScript and the SDK types, for type checking
overcrow-widget check
overcrow-widget package  # dist/<id>-<version>.ocpkg
overcrow-widget inspect dist/com.example.my-widget-0.1.0.ocpkg
```

## Installing

Build it from this repository with the pinned Rust toolchain:

```sh
cargo build -p overcrow-widget-cli --profile dist --locked
# target/dist/overcrow-widget (overcrow-widget.exe on Windows)
```

The binary needs nothing else to check and package a widget. Type checking
uses the project's own TypeScript through Node.js 22 or later, when they are
installed (see [`check`](#check)).

**npm distribution (planned).** The binary will also ship through npm as a
thin wrapper package, so `npx overcrow-widget` works in a widget project:
one package per platform (`linux-x64`, `win32-x64`) carrying the prebuilt
binary with its SHA-256, selected through `optionalDependencies` and `os`/
`cpu` fields, and a launcher package without install scripts that runs the
matching binary. The wrapper and `@overcrow/sdk` are published together
with the CLI release; until then, build from source. `@overcrow/sdk` is not
on npm yet either: `npm install` in a new project fails until it is, and
`check` then says that types were not checked. The workflow
`.github/workflows/sdk-cli.yml` shows how to type-check against this
repository's `sdk/` in the meantime.

## Project layout

| File | Role |
| --- | --- |
| `manifest.json` | Manifest v1 ([schema reference](widget-schema-v1.md#manifest)); packaged as authored. |
| `view.ocml` | The view ([source formats](widget-source-formats.md)); compiled to `view.json`, never shipped. |
| `style.ocss` | Optional style sheet. |
| `logic.ts` or `logic.js` | The logic module, written against `@overcrow/sdk` ([SDK guide](sdk-guide.md)). |
| `locales/en.json`, `locales/fr.json` | Optional messages, both or neither, with the same keys. |
| `LICENSE` | The package's license text. The templates start with MIT; choose your own. |
| `assets/` | Optional PNG, JPEG or WebP images. |
| `package.json`, `tsconfig.json` | Tooling only: TypeScript and the SDK types. Never packaged. |

## Commands

### `init <dir> [--template NAME] [--id ID] [--name NAME]`

Writes a new project into `<dir>`, which must not exist or be empty; it
never overwrites a file. Templates (`templates/` in this repository):

| Template | Shows |
| --- | --- |
| `blank` (default) | A title from the locales and an empty state. |
| `counter` | A value and two buttons whose handlers the logic exports. |
| `list` | A keyed checklist: `<for>`, handlers with arguments, `t()` with parameters. |
| `chart` | A live chart updated by a host timer. |

The ID defaults to `com.example.<dir>`; use `--id` with a reverse-DNS ID you
control (`com.playervox.*` is reserved). `package.json` pins the embedded
SDK version and TypeScript.

### `check [dir]`

Runs every check without writing anything, in this order:

1. **Project files**: required files present, within their size bounds, one
   logic module, both locale files or neither.
2. **Manifest**: the host's `validate_manifest`.
3. **View**: `view.ocml` compiled by the host's compiler, then the compiled
   view validated by `validate_compiled_view`; static images must exist in
   `assets/`.
4. **Style**: `style.ocss` parsed with the host's parser.
5. **Locales**: strict JSON objects of strings, valid keys, the same keys in
   both files; `t("key")` calls of the view whose key has no message are
   warnings.
6. **Logic lint** (see below) and the exports the view calls.
7. **Types**: the project's `tsc --noEmit -p tsconfig.json`, when
   `node_modules/typescript` and Node.js are present; otherwise a
   `typecheck.skipped` warning says so. The CLI does not embed TypeScript.
   A different `node_modules/@overcrow/sdk` version than the one the CLI
   links is a `typecheck.sdk_version` warning.
8. **Package**: `logic.js` is built, the package is written in memory and
   read back with `read_package` and the style check, exactly as the host
   will.

Options: `--no-typecheck`, `--deny-warnings` (warnings fail the command),
`--format json`.

#### Logic lint

The logic module must fit what the widget VM runs (one ES2023 script in a
QuickJS realm with the ECMAScript intrinsics and the `overcrow` global):

| Code | Rule |
| --- | --- |
| `logic.syntax` | The module parses as ES2023 (TypeScript types allowed) with the early errors of a module. |
| `logic.import` | Its only import is `@overcrow/sdk`; no other module, file or package, no `export *`. |
| `logic.dynamic_import`, `logic.import_meta` | No `import()` and no `import.meta`: `logic.js` is a script. |
| `logic.eval`, `logic.function_constructor` | No `eval`, no `Function(…)` or `new Function(…)`. |
| `logic.unavailable_global` | Every global it reads exists in the VM. `Intl`, `setTimeout`, `console`, `fetch`, `WebAssembly`, `SharedArrayBuffer`, `performance`, `WeakRef`, browser and Node.js globals do not; the help names the SDK replacement. |
| `logic.top_level_await`, `logic.top_level_this` | No top-level `await` or `for await`, no top-level `this`. |
| `logic.syntax_version` | Nothing newer than ES2023 that the VM may lack: decorators, `using`, the regular expression `v` flag, import attributes. |
| `logic.default_export` | The view calls named exports; `export default` is refused. |
| `logic.missing_export` | Every function the view calls is exported (`t` may come from the SDK). |
| `logic.debugger` | `debugger` is a warning. |

The lint helps; it is no security boundary. The host sandbox, the VM's
budgets and the host's validation of every message are.

### `package [dir] [--out FILE]`

Runs `check`, then writes the `.ocpkg` v1 ([package format](widget-package-v1.md))
to `dist/<id>-<version>.ocpkg`, or to `--out`, through a temporary file and
a rename. It prints the path, the size and the SHA-256 of the archive. The
package holds `manifest.json` as authored, `view.json`, `logic.js`,
`LICENSE`, `ledger.json` and, when present, `style.ocss`, the locales and
the assets. `view.ocml` and the TypeScript sources are never shipped.

Packaging is deterministic: the same sources and the same CLI version give
the same bytes on every run and every system (stored zip with pinned
headers, sorted entries, canonical ledger and compiled view, deterministic
bundling). The package is read back with the host's validators before it is
written.

### `inspect <file.ocpkg> [--format json]`

Validates a package with the host's reader, then shows, for its author or a
reviewer: the ID, version and names; the archive size and SHA-256; the SDK
version its `logic.js` links; the VM heap; each permission in words
(network routes with their parameter constraints, storage, clipboard, game
events); each capability with its summary and whether it is sensitive or
needs an account; the number of menu rows; and every file with its size and
SHA-256 (the ledger). A package the host would refuse is reported instead,
with the refusing category.

### `dev`, `doctor`

Not available in this version: `dev` will drive an installed OverCrow
(hot reload in the real runtime, event replay, service fixtures) and
`doctor` will diagnose the creator's setup. They exit with status 2.

## Diagnostics

Every problem is one diagnostic:

```text
error[view.unknown_attribute]: `clas` is not an attribute of <text>
  --> view.ocml:4:9
   |
 4 |   <text clas="value">{state.count}</text>
   |         ^
   = help: did you mean `class`?
check: 1 error(s), 0 warning(s)
```

- The code is `<domain>.<category>`. Domains: `project`, `manifest`,
  `view`, `style`, `locales`, `logic`, `typecheck`, `package`, `init`.
  Categories of `manifest`, `view`, `style` and `package` are the stable
  names of the public validators ([source formats](widget-source-formats.md#error-categories),
  [schema reference](widget-schema-v1.md)); the lint's are listed above;
  `typecheck.tsc` relays TypeScript's own messages. Scripts should match
  codes; messages and help may improve.
- Lines and columns start at 1; columns count characters (Unicode scalar
  values) of the UTF-8 source, not bytes. Manifest and locale positions
  point at the member the validator refused.
- Unknown names get the closest name of the schema as a suggestion.
- `--format json` prints one JSON object per line on standard output:
  `{"severity","code","file","line","column","message","help"}`, with
  `null` for what is unknown; `package --format json` ends with one
  `{"package","bytes","sha256","logicBytes"}` object.

Exit status: 0 success (warnings allowed unless `--deny-warnings`), 1 errors
found, 2 usage or I/O error.

## How `logic.js` is built

1. The logic module, the SDK and a generated view module are parsed and
   their TypeScript is stripped (oxc, target ES2023).
2. The view module is the expression table of `view.json` in the calling
   convention of `registerView` ([SDK reference](sdk-reference.md#calling-convention-of-the-view-table)).
   It imports the logic module first, so the logic always runs before the
   table is registered.
3. The linker resolves imports and exports and orders the modules as ES
   module evaluation would. Every top-level binding gets a name unique in
   the bundle; imports become direct references; `ns.name` on
   `import * as ns` becomes the binding itself.
4. The linked modules run inside `(() => { "use strict"; … })()`, which is
   minified: unused SDK code is removed (the SDK marks its pure
   initializers `/* @__PURE__ */`), local names are shortened. Globals
   (`overcrow`, `globalThis`, `Date`, `Math`…) are never renamed or removed.
5. The SDK's MIT notice is kept on the first line:
   `/*! @overcrow/sdk 1.0.0 | MIT License | Copyright (c) 2026 Valhallab SASU */`.

The SDK linked is the one embedded in the CLI, from `sdk/src/` at the
revision the CLI was built from: a bundle depends only on the widget's
sources and the CLI version, works offline and can be rebuilt identically
at review. `inspect` shows the linked SDK version. The package never holds
QuickJS bytecode: the host loads only source it can read and check.

For the SDK's end-to-end Clock, `logic.js` is 4.3 KB (the SDK's test
bundler of the previous release made 25.1 KB) and the VM's start-up cost
over a hand-written script falls from about 1.5 ms to 0.4 ms.

## Maintenance

- **oxc** parses, strips types, minifies and prints; the linker, the lint,
  the view table and the diagnostics are this crate's. oxc is pre-1.0 and
  changes its API with each minor release: every `oxc_*` crate is pinned to
  one exact version. Upgrading it is an explicit change: rebuild the SDK
  Clock, compare `logic.js` size and the VM start-up and tick measurements
  with the previous version, and review `cargo deny` and the lockfile.
- The SDK modules are embedded by `cli/src/sdk.rs`; its tests fail when a
  module is added to `sdk/src/` without it, or when the version or notice
  drift from `sdk/package.json` and `sdk/LICENSE`.
- The VM's global set (`cli/src/lint.rs`, `VM_GLOBALS`) mirrors the realm
  the VM builds; update both together.
- Diagnostic renderings are pinned by golden files in `cli/tests/golden/`;
  regenerate them with
  `OVERCROW_UPDATE_GOLDEN=1 cargo test -p overcrow-widget-cli --test cli`
  and review the diff.
