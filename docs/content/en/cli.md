# The command-line tool

`overcrow-widget` creates, checks and packages PlayerVox OverCrow widgets,
runs them in OverCrow while you write them, and tests them. It is one
program for Linux and Windows, and it contains the same validators that
OverCrow runs when it installs and starts a widget: a package it accepts is
a package OverCrow reads.

```sh
overcrow-widget init my-widget --template counter
cd my-widget
overcrow-widget check
overcrow-widget package
overcrow-widget inspect dist/com.example.my-widget-0.1.0.ocpkg
overcrow-widget doctor
overcrow-widget dev
overcrow-widget test
```

| Command | Does |
| --- | --- |
| [`init`](#init) | Creates a project from a template. |
| [`check`](#check) | Validates a project without writing anything. |
| [`package`](#package) | Checks, then writes the `.ocpkg` package. |
| [`inspect`](#inspect) | Shows what a package holds and asks for. |
| [`dev`](#dev) | Runs the widget in OverCrow and reloads it when you save. |
| [`test`](#test) | Plays the project's test scenarios and compares their images. |
| [`doctor`](#doctor) | Says what your setup has and lacks. |
| [`admit`](#admit) | Runs the admission of the marketplace on your submission. |

Every command takes the project directory as its argument and uses the
current directory without one.

## Installing

Each [OverCrow release](https://github.com/Valhallab/playervox-overcrow-releases/releases)
carries the tool for Linux and Windows x86-64, with its license, its
third-party notices and the release's `SHA256SUMS`:

| Platform | File |
| --- | --- |
| Linux | `overcrow-widget-VERSION-linux-x86_64` |
| Windows | `overcrow-widget-VERSION-windows-x86_64.exe` |

Check the file against `SHA256SUMS`, rename it `overcrow-widget`
(`overcrow-widget.exe` on Windows), make it executable on Linux
(`chmod +x`) and put it on your `PATH`. It needs nothing else to check and
package a widget. `overcrow-widget --version` gives its version and the SDK
it embeds.

```sh
sha256sum --check --ignore-missing SHA256SUMS
```

The tool also builds from the
[public repository](https://github.com/Valhallab/playervox-overcrow-releases)
with Rust; the repository pins the toolchain it needs. The program is then
`target/dist/overcrow-widget`.

```sh
cargo build -p overcrow-widget-cli --profile dist --locked
```

### The SDK types

`check` type-checks your logic with the project's own TypeScript, when
Node.js 22 or later and `node_modules/typescript` are there; otherwise it
warns that types were not checked (`typecheck.skipped`) and goes on. The
SDK itself is inside the tool, so packaging never depends on
`node_modules`.

`@overcrow/sdk` is on [npm](https://www.npmjs.com/package/@overcrow/sdk).
The `package.json` of a project made by `init` names TypeScript and the SDK
version the tool embeds: run `npm install` in the project. In another
project, install the SDK with:

```sh
npm install --save-dev --save-exact @overcrow/sdk@1.0.0
```

Keep the version the tool embeds (`overcrow-widget --version`).
`overcrow-widget doctor` reports a missing TypeScript, and an SDK in
`node_modules` whose version differs from the one the tool embeds. The
CLI 1.0.0-beta.1 still says that the SDK is not on npm: `npm install`
works all the same.

## Files of a project

| File | Role | Packaged |
| --- | --- | --- |
| `manifest.json` | [The manifest](manifest.md), packaged as written. | yes |
| `view.ocml` | [The view](view.md), compiled to `view.json`. | compiled |
| `style.ocss` | [The style](style.md); optional. | yes |
| `logic.ts` or `logic.js` | [The logic](logic.md), one module; bundled with the SDK into `logic.js`. | bundled |
| `locales/en.json`, `locales/fr.json` | [Messages](logic.md#messages); both or neither, with the same keys. | yes |
| `LICENSE` | The license text of the package. The templates start with MIT; choose your own. | yes |
| `assets/` | PNG, JPEG or WebP images; optional. | yes |
| `package.json`, `tsconfig.json` | Tooling only: TypeScript and the SDK types. | no |
| `listing.json` | The marketplace text of a [submission](publishing.md#the-listing); read by `admit`. | no |
| `tests/` | [Scenarios](testing.md#scenarios) (`tests/<name>.scenario.json`), their reference images (`tests/reference/`) and your unit tests. `tests/output/` holds the images of failed runs. | no |

## init

```sh
overcrow-widget init my-widget --template list --id com.example.my-widget --name "My widget"
```

Writes a new project into the directory, which must not exist or must be
empty: `init` never overwrites a file.

| Template | Shows |
| --- | --- |
| `blank` (default) | A title from the locales and an empty state. |
| `counter` | A value and two buttons whose handlers the logic exports. |
| `list` | A keyed checklist: `for`, handlers with arguments, `t()` with parameters. |
| `chart` | A live chart updated by a timer. |

The ID defaults to `com.example.<dir>`; pass `--id` with a reverse-DNS ID
under a domain you control (`com.playervox.*` is reserved). Every template
comes with a test scenario, `tests/example.scenario.json`, and `counter`,
`list` and `chart` with its reference images.

## check

```sh
overcrow-widget check
overcrow-widget check --deny-warnings --format json
```

Runs every check, in this order, and writes nothing:

1. **Project files**: the required files are there and within their size
   bounds, one logic module, both locale files or neither.
2. **Manifest**: OverCrow's own manifest validator.
3. **View**: `view.ocml` is compiled and the result validated; static
   images must exist in `assets/`.
4. **Style**: `style.ocss` is parsed with OverCrow's parser.
5. **Locales**: objects of strings with valid keys, the same keys in both
   files. A `t("key")` of the view whose key has no message is a warning.
6. **Logic**: the [lint](logic.md#what-the-logic-cannot-use), and the
   exports the view calls.
7. **Types**: the project's `tsc --noEmit -p tsconfig.json`.
8. **Package**: `logic.js` is built, the package is written in memory and
   read back exactly as OverCrow will read it.

Options: `--no-typecheck`, `--deny-warnings` (a warning fails the command),
`--format json`.

## package

```sh
overcrow-widget package
overcrow-widget package --out build/my-widget.ocpkg
```

Runs `check`, then writes the package to `dist/<id>-<version>.ocpkg`, or to
`--out`. It prints the path, the size and the SHA-256 of the archive.

Packaging is deterministic: the same sources and the same version of the
tool give the same bytes on every run and every system. What the package
holds is described in [the package](package.md).

## inspect

```sh
overcrow-widget inspect dist/com.example.my-widget-0.1.0.ocpkg
```

Validates a package as OverCrow does, then shows it as a reviewer sees it:
the ID, version and names; the size and SHA-256 of the archive; the SDK
version its `logic.js` contains; each permission in words (network routes
with their parameter constraints and declared response bound, storage,
clipboard, game events); each capability with its summary and whether it is
sensitive or needs an account; the number of menu rows; and every file with
its size and SHA-256. A package that OverCrow would refuse is reported
instead, with the reason.

## dev

```sh
overcrow-widget dev
```

Runs the widget in the OverCrow overlay running on your machine, while you
edit it:

1. it connects to the overlay, which must have been started with
   development installs allowed;
2. it builds the package as `package` does and sends it to the overlay,
   which validates it in full and shows it marked
   **Unverified · development package**, with the permissions of its
   manifest granted for the session only;
3. it watches the project's files and, 200 ms after the last change,
   rebuilds and reloads the widget. A build with errors is not sent: the
   widget keeps running its last good build;
4. it prints what the overlay reports: the widget's states (`starting`,
   `running`, `restarting` with the failure, `failed`…) and the `log.*`
   output of its logic;
5. on **Ctrl+C**, it removes the widget from the overlay.

Options: `--no-typecheck`, `--format json` (one JSON object per line).
Exit status: 0 after Ctrl+C, 1 when the overlay ends the session, 2 when no
overlay is reachable. [The development channel](dev-channel.md) says how to
start OverCrow for it, and what each state and refusal means.

## test

```sh
overcrow-widget test
overcrow-widget test --scenario example
overcrow-widget test --update
```

Plays the scenarios of `tests/` in OverCrow's headless runtime and compares
the images it renders with the references:

1. it builds the package as `package` does;
2. it reads every `tests/<name>.scenario.json` and checks it against the
   manifest before anything runs; a mistake in a scenario is a
   `test.scenario` diagnostic in its file;
3. it runs each scenario in the [headless runtime](testing.md#the-headless-runtime)
   this tool pins, or the one given by `--runtime`, and prints the
   runtime's version and SHA-256;
4. it compares each captured image with
   `tests/reference/<name>/<image>.png`. A difference, a size change or a
   missing reference fails the scenario and writes
   `tests/output/<name>/<image>.actual.png` and, for a difference,
   `<image>.diff.png`.

Options: `--runtime <path>` (another `overcrow-widget-headless` program),
`--scenario <name>` (only that one), `--update` (records the captured
images as the references: review them before you commit them),
`--format json`, `--no-typecheck`.

Exit status: 0 when every scenario passed, 1 when one failed, 2 when no
runtime can run. Scenarios are described in
[testing a widget](testing.md).

## doctor

```sh
overcrow-widget doctor
```

| Line | Checked |
| --- | --- |
| `cli`, `sdk` | The version of the tool, its widget API, and the `@overcrow/sdk` it embeds. |
| `platform` | Operating system and architecture. |
| `overcrow` | An installed OverCrow. |
| `development` | A running overlay that allows development installs, and its version. |
| `node`, `typescript`, `project sdk` | In a widget project: Node.js on `PATH`, `node_modules/typescript`, and the version of `node_modules/@overcrow/sdk`. |

| Code | Severity | Meaning |
| --- | --- | --- |
| `doctor.overcrow_missing` | warning | OverCrow is not installed. |
| `doctor.development_off` | warning | No overlay allows development installs; the help gives the commands to restart OverCrow with them. |
| `doctor.channel_busy` | warning | The overlay already serves its maximum of `dev` sessions. |
| `doctor.channel_io` | warning | The connection to the overlay failed. |
| `doctor.channel_untrusted` | error | What answers is not this user's overlay. |
| `doctor.protocol_version` | error | The overlay and the tool do not speak the same version of the development channel. |
| `doctor.node_missing`, `doctor.node_version` | warning | No Node.js, or older than 22: `check` cannot type-check. |
| `doctor.typescript_missing`, `doctor.sdk_missing` | warning | TypeScript or the SDK types are not installed in the project. |
| `doctor.sdk_version` | warning | `node_modules/@overcrow/sdk` differs from the SDK in the tool. |

Options: `--format json`, `--deny-warnings`.

## admit

```sh
overcrow-widget admit
overcrow-widget admit --package dist/com.example.my-widget-0.1.0.ocpkg
```

Runs the static admission that a marketplace submission goes through,
exactly as the marketplace runs it. It never runs your code or `tsc`:

1. the directory is built as `package` builds it;
2. with `--package`, that archive's compiled view must be byte for byte
   what `view.ocml` compiles to;
3. the ID is not reserved, `listing.json` is valid, its preview is a
   packaged PNG of at most 256 KiB;
4. the authority the widget asks for is listed for the reviewer:
   capabilities (the sensitive ones marked), network routes with their
   response bound, clipboard writes, storage and game events.

| Code | Severity | Meaning |
| --- | --- | --- |
| `admission.reserved_id` | error | A `com.playervox.*` ID, reserved for PlayerVox. |
| `admission.listing_missing`, `admission.listing` | error | No `listing.json`, or one that breaks the listing's rules. |
| `admission.preview` | error | `preview` does not name a packaged PNG within bounds. |
| `admission.license` | error | A PlayerVox widget whose license is not MIT. |
| `admission.view_not_reproducible` | error | The submitted compiled view differs from what `view.ocml` compiles to. |
| `admission.package_rebuilt` | warning | The submitted archive differs from the rebuild in other files. |
| `admission.not_rebuilt` | warning | An archive was admitted without its sources. |

Options: `--package FILE`, `--out DIR` (writes the admitted package, its
listing and a report into an empty directory), `--format json`,
`--deny-warnings`. `admit <file.ocpkg> --listing FILE` checks an archive
without its sources. Exit status: 0 admitted, 1 refused, 2 on a usage or
file error. See [publishing and review](publishing.md).

## Diagnostics

Every problem is one diagnostic, with a stable code, a position and, when
there is one, a suggestion:

```text
error[view.unknown_attribute]: `clas` is not an attribute of <text>
  --> view.ocml:4:9
   |
 4 |   <text clas="value">{state.count}</text>
   |         ^
   = help: did you mean `class`?
check: 1 error(s), 0 warning(s)
```

The code is `<domain>.<category>`:

| Domain | From | Codes |
| --- | --- | --- |
| `project` | The files of the project | `missing_file`, `file_size`, `encoding`, `ambiguous_logic`, `asset_path`, `entry_limit`, `read` |
| `manifest` | `manifest.json` | see [the manifest](manifest.md#how-the-manifest-is-checked) |
| `view` | `view.ocml` | see [the view](view.md#when-the-view-is-wrong) |
| `style` | `style.ocss` | see [the style](style.md#when-the-style-is-wrong) |
| `locales` | `locales/*.json` | `missing_file`, `json`, `shape`, `key`, `value`, `keys`, `entry_limit`, `unknown_key` |
| `logic` | `logic.ts` | see [the logic](logic.md#what-the-logic-cannot-use) |
| `typecheck` | TypeScript | `tsc` (TypeScript's own message), `skipped`, `sdk_version`, `timeout` |
| `package` | The package read back | `archive_size`, `file_size` and the categories of OverCrow's package reader |
| `test` | Scenarios | `scenario`, `scenario_name`, `too_many_scenarios` |
| `init`, `doctor`, `admission` | Those commands | listed above |

- Lines and columns start at 1; a column counts characters, not bytes.
- An unknown name comes with the closest name that exists.
- With `--format json`, each diagnostic is one JSON object on a line of the
  standard output:
  `{"severity","code","file","line","column","message","help"}`, with
  `null` for what is unknown. `package --format json` ends with one
  `{"package","bytes","sha256","logicBytes"}` object.
- Texts that come from a widget (its logs, its names) are shown with
  terminal control characters neutralized.

Scripts should match the codes: messages and help texts may be reworded.

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | Success. Warnings are allowed unless `--deny-warnings`. |
| 1 | Errors were found; `admit` refused the submission; a scenario of `test` failed; the overlay ended a `dev` session. |
| 2 | A usage or file error; no overlay for `dev`; no runtime for `test`. |
