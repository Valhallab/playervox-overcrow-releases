# The widget CLI: `overcrow-widget`

`overcrow-widget` creates, checks and packages widgets for widget API v1,
runs them in a local OverCrow while they are written, and tests them in
OverCrow's headless runtime. It is one Rust
binary for Linux and Windows, built from `cli/` in this
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
overcrow-widget doctor   # what the setup has and lacks
overcrow-widget dev      # run it in OverCrow, reload on save (Ctrl+C to stop)
overcrow-widget test --runtime path/to/overcrow-widget-headless  # scenarios and images
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
| `tests/<name>.scenario.json`, `tests/reference/` | Test scenarios and their reference images, played by [`test`](#test-dir) ([testing guide](widget-testing.md)). Never packaged; `tests/output/` holds the images of failed runs and is ignored by Git. |

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

Every template has a test scenario, `tests/example.scenario.json`; `counter`,
`list` and `chart` also have its reference images in
`tests/reference/example/`, so `overcrow-widget test` passes on a new
project. The `blank` greeting shows the project's name: its example checks
the text only, and `test --update` records its images once you add some.

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

### `dev [dir]`

Runs the widget in the OverCrow overlay running on this machine, as the
same user, while you edit it:

1. connects to the overlay's [development channel](dev-channel.md);
2. builds the package as `package` does, printing the same diagnostics, and
   sends its bytes to the overlay, which validates it in full and shows it
   **unverified** ("Unverified · development package"), with the
   permissions its manifest declares granted for the session only;
3. watches the project's sources (the files of the
   [project layout](#project-layout) and `assets/`, polled four times a
   second; `node_modules/` and `dist/` are not watched) and, 200 ms after the
   last change, rebuilds and reloads the widget; `tsc` runs again only when
   `logic.ts`, `tsconfig.json` or `package.json` changed. A build with errors
   is not sent: the widget keeps running its last good build;
4. prints what the overlay reports: installs, the widget's states
   (`starting`, `running`, `restarting` with the failure, `failed`…) and the
   logs of its logic (`log.info(…)` of the [SDK](sdk-reference.md)). Log
   texts come from the widget: control characters, terminal escape sequences,
   line separators and bidirectional controls are shown escaped (`\u{1b}`),
   never interpreted, and each line is cut at 512 characters (with
   `--format json`, they are `\uXXXX` escapes of the JSON strings);
5. on **Ctrl+C**, removes the widget from the overlay and exits with status
   0. If `dev` dies instead, the overlay removes the widget itself when the
   connection ends.

The overlay only offers the channel when OverCrow was started with
development installs allowed (`OVERCROW_WIDGET_DEVELOPMENT=1`; `doctor`
prints the commands). A development widget takes the place of an installed
widget of the same ID for the session; nothing of it is stored, and the
installed widget comes back when it is removed. Widget IDs under
`com.playervox.` are refused.

Options: `--no-typecheck`, `--format json` (one JSON object per line: the
diagnostics, `{"type":"built",…}` for each build, then the overlay's
[messages](dev-channel.md#overlay-messages) as they come).

Exit status: 0 after Ctrl+C, 1 when the overlay ends the session (it quit,
or refused the session), 2 when no overlay is reachable or on a usage error.

Simulated service answers, virtual time and replayed input belong to
[`test`](#test-dir), which plays scenarios in the headless runtime.

### `test [dir]`

Plays the project's test scenarios in OverCrow's headless runtime and
compares the images it renders with the references
([testing guide](widget-testing.md)):

1. builds the package as `package` does, printing the same diagnostics;
2. reads every `tests/<name>.scenario.json` (the name is the file's) and
   checks it, and its grants, menu values and fixtures against the
   manifest, before anything runs: a scenario error is a diagnostic
   (`test.scenario`) in its file;
3. finds the runtime: `--runtime <path>`, or the version this CLI pins,
   found in the cache (`$XDG_CACHE_HOME` or `~/.cache`, `%LOCALAPPDATA%` on
   Windows, under `overcrow-widget/runtime/<version>/`) and checked against
   its pinned SHA-256 before every run. It prints the runtime's version and
   SHA-256, and whether it is the pinned one. No runtime is pinned yet:
   `--runtime` is required until an OverCrow release publishes it, and
   downloading it comes with that release. The CLI never builds it;
4. runs each scenario in the runtime, which validates the package as the
   overlay does and runs the widget's code in the same OS sandbox;
5. compares each captured image with `tests/reference/<name>/<image>.png`
   within the schema's parity bounds (`PARITY_CHANNEL_TOLERANCE` per
   channel, `PARITY_MAX_DIFFERENT_PIXELS` of the pixels). A difference, a
   size change or a missing reference fails the scenario and writes
   `tests/output/<name>/<image>.actual.png` and, for a difference,
   `<image>.diff.png` (differing pixels in red over the reference, dimmed).

The widget's texts (expectation details, logs, call parameters) are shown
neutralized, as in [`dev`](#dev-dir).

Options:

- `--runtime <path>`: the `overcrow-widget-headless` executable to run;
- `--update`: writes the captured images as the references instead of
  comparing them (review them before committing);
- `--scenario <name>`: plays only `tests/<name>.scenario.json`;
- `--format json`: one JSON object per line: `{"type":"runtime",…}`, one
  `{"type":"scenario",…}` per scenario (its images with their status,
  `ppm` and `maxDelta`, its failed expectations, errors, faults and logs),
  then `{"type":"summary","passed":…,"failed":…}`;
- `--no-typecheck`.

Exit status: 0 when every scenario passed, 1 when one failed (or the
project or a scenario has an error), 2 when no runtime can run (none given
or pinned, a digest mismatch, an incompatible runtime, the sandbox not
available on this machine) or on a usage error.

### `doctor [dir]`

Shows what the setup has and lacks:

| Line | Checked |
| --- | --- |
| `cli`, `sdk` | This CLI's version, its widget API, and the `@overcrow/sdk` it embeds. |
| `platform` | OS and architecture. |
| `overcrow` | An installed OverCrow (Linux: `overcrow-overlay` in `/usr/bin`, `/usr/local/bin` or `PATH`; Windows: `%LOCALAPPDATA%\Programs\OverCrow\OverCrow.exe`). |
| `development` | A running overlay reachable through the development channel, its version, and so whether development installs are on. |
| `node`, `typescript`, `project sdk` | In a widget project (a directory with `manifest.json`): Node.js on `PATH`, `node_modules/typescript`, and the version of `node_modules/@overcrow/sdk` against the embedded SDK. |

Problems are diagnostics, as for `check`:

| Code | Severity | Meaning |
| --- | --- | --- |
| `doctor.overcrow_missing` | warning | OverCrow is not installed. |
| `doctor.development_off` | warning | No overlay allows development installs; the help gives the commands to restart OverCrow with them. |
| `doctor.channel_busy` | warning | The overlay already serves its maximum of `dev` sessions. |
| `doctor.channel_io` | warning | The channel failed while connecting. |
| `doctor.channel_untrusted` | error | The channel's socket or pipe is not this user's overlay. |
| `doctor.protocol_version` | error | The overlay speaks another channel version than this CLI. |
| `doctor.node_missing`, `doctor.node_version` | warning | No Node.js, or older than 22: `check` cannot type-check. |
| `doctor.typescript_missing`, `doctor.sdk_missing` | warning | `npm install` was not run in the project. |
| `doctor.sdk_version` | warning | `node_modules/@overcrow/sdk` differs from the embedded SDK. |

Options: `--format json` (the diagnostics, then one
`{"type":"doctor",…}` object with every fact), `--deny-warnings`. Exit
status as for `check`: 0 without errors (warnings allowed unless
`--deny-warnings`), 1 with errors, 2 on a usage error.

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
  `view`, `style`, `locales`, `logic`, `typecheck`, `package`, `init`,
  `doctor`.
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
5. The SDK is MIT-0 and needs no notice; a one-line courtesy comment names
   it on the first line:
   `/*! @overcrow/sdk 1.0.0 | MIT-0 | Copyright (c) 2026 Valhallab SASU */`.

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
- `dev` and `doctor` speak the [development channel](dev-channel.md)
  through `crates/overcrow-widget-devchannel`, which the OverCrow overlay
  links too; a change of message or bound is a new protocol version.
  `cli/tests/dev.rs` runs them against a scripted overlay in a private
  runtime directory; tests must never reach the user's real overlay (no
  bare `dev` or `doctor` in `cli/tests/cli.rs`).
- Diagnostic renderings are pinned by golden files in `cli/tests/golden/`;
  regenerate them with
  `OVERCROW_UPDATE_GOLDEN=1 cargo test -p overcrow-widget-cli --test cli`
  and review the diff.
