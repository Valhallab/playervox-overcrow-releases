# The command-line tool

`overcrow-widget` creates, checks and packages PlayerVox OverCrow widgets,
runs them in OverCrow while you write them, and tests them. It is one
program for Linux and Windows, and it contains the same validators that
OverCrow runs when it installs and starts a widget: a package it accepts is
a package OverCrow reads.

```sh
overcrow-widget init my-widget --template counter --id nova.my-widget
cd my-widget
overcrow-widget check
overcrow-widget package
overcrow-widget inspect dist/nova.my-widget-0.1.0.ocpkg
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
| [`admit`](#admit) | Runs the admission of the creator space on your sources, a folder or a ZIP. |
| [`diff`](#diff) | Compares two versions of a widget's sources. |
| [`submit`](#submit) | Sends a version to the creator space with a publish key, and follows its checks. |
| [`status`](#status) | Shows the versions of a widget, their checks and their review. |

Every command takes the project directory as its argument and uses the
current directory without one. [Machine-readable output](#machine-readable-output)
and [exit status](#exit-status) are stable for scripts.

## Installing

Each [OverCrow release](https://github.com/Valhallab/playervox-overcrow-releases/releases)
carries the creator tools in one ZIP per platform: the tool with its
license and third-party notices, OverCrow's headless runtime that
[`test`](#test) uses, a `README.txt` and a `SHA256SUMS` of every file.

| Platform | ZIP | Tool in the ZIP |
| --- | --- | --- |
| Linux x86-64 | `overcrow-creator-tools-VERSION-linux-x86_64.zip` | `overcrow-widget-VERSION-linux-x86_64` |
| Windows x64 | `overcrow-creator-tools-VERSION-windows-x86_64.zip` | `overcrow-widget-VERSION-windows-x86_64.exe` |

Unzip it, check the files, rename the tool `overcrow-widget`
(`overcrow-widget.exe` on Windows), make it executable on Linux
(`chmod +x`) and put it on your `PATH`. It needs nothing else to check and
package a widget. `overcrow-widget --version` gives its version and the SDK
it embeds.

```sh
unzip overcrow-creator-tools-VERSION-linux-x86_64.zip
cd overcrow-creator-tools-VERSION-linux-x86_64
sha256sum --check SHA256SUMS
install -m 755 overcrow-widget-*-linux-x86_64 ~/.local/bin/overcrow-widget
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
`node_modules` whose version differs from the one the tool embeds.

## Files of a project

| File | Role | Packaged |
| --- | --- | --- |
| `manifest.json` | [The manifest](manifest.md), packaged as written. | yes |
| `view.ocml` | [The view](view.md), compiled to `view.json`. | compiled |
| `style.ocss` | [The style](style.md); optional. | yes |
| `logic.ts` or `logic.js` | [The logic](logic.md), one module; bundled with the SDK into `logic.js`. | bundled |
| `locales/en.json`, `locales/fr.json` | [Messages](logic.md#messages); both or neither, with the same keys. | yes |
| `LICENSE` | The license text of the package. The templates start with MIT; choose your own. | yes |
| `assets/` | PNG, JPEG or WebP images; optional. Hidden files (`.DS_Store`) and what the creator tools never send (`dist/`…) are skipped, as in [source archives](#source-archives). | yes |
| `package.json`, `tsconfig.json` | Tooling only: TypeScript and the SDK types. | no |
| `listing.json` | The marketplace text of a [submission](publishing.md#the-listing); read by `admit`. In the creator space, where the listing is edited, only a proposal to import. | no |
| `tests/` | [Scenarios](testing.md#scenarios) (`tests/<name>.scenario.json`), their reference images (`tests/reference/`) and your unit tests. `tests/output/` holds the images of failed runs. | no |

## init

```sh
overcrow-widget init my-widget --template list --id nova.my-widget --name "My widget"
```

Writes a new project into the directory, which must not exist or must be
empty: `init` never overwrites a file.

| Template | Shows |
| --- | --- |
| `blank` (default) | A title from the locales and an empty state. |
| `counter` | A value and two buttons whose handlers the logic exports. |
| `list` | A keyed checklist: `for`, handlers with arguments, `t()` with parameters. |
| `chart` | A live chart updated by a timer. |

Pass `--id` with your widget's ID: `<handle>.<name>`, your publisher handle
in the OverCrow creator space and a name (`nova.lol-timers`), or a reverse
domain you verified and a name (`gg.nova.lol-timers`); see
[the manifest](manifest.md#identity-and-version). Without `--id`, the ID is
`yourhandle.<dir>`: replace `yourhandle` before you submit, as `admit`
refuses it. `com.playervox.*` is reserved. Every template
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

With `--source-map FILE`, it also writes [the code map](#the-code-map) of
`logic.js` to that file. The map never goes into the package: the package
is the same with or without it.

Packaging is deterministic: the same sources and the same version of the
tool give the same bytes on every run and every system. What the package
holds is described in [the package](package.md).

## inspect

```sh
overcrow-widget inspect dist/nova.my-widget-0.1.0.ocpkg
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
   runtime's version and SHA-256. The first time, it downloads the pinned
   runtime;
4. it compares each captured image with
   `tests/reference/<name>/<image>.png`. A difference, a size change or a
   missing reference fails the scenario and writes
   `tests/output/<name>/<image>.actual.png` and, for a difference,
   `<image>.diff.png`.

Options: `--runtime <path>` (another `overcrow-widget-headless` program),
`--offline` (never download the runtime), `--scenario <name>` (only that one), `--update` (records the captured
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
overcrow-widget admit --publisher nova
overcrow-widget admit lol-timers.zip --publisher nova --previous lol-timers-1.0.0.ocpkg
overcrow-widget admit --publisher nova --package dist/nova.my-widget-0.1.0.ocpkg
```

Runs the static admission that the creator space runs on every version you
send. The sources are the project folder or a ZIP of it, read as the
creator space receives them ([source archives](#source-archives)). It
never runs your code or `tsc`:

1. the sources are built as `package` builds them;
2. with `--package`, that archive's compiled view must be byte for byte
   what `view.ocml` compiles to;
3. the ID belongs to the publisher given by `--publisher` (its
   `<handle>.<name>` IDs, and with `--domain`, the IDs under a domain it
   verified); without `--publisher`, it is neither reserved, nor an example
   ID (`nova.*`, `yourhandle.*`, `gg.nova.*`, `com.example.*`…), nor under a
   handle nobody can register (`admin.*`, `com.*`). `listing.json` is
   valid, its preview is a packaged PNG of at most 256 KiB;
4. the authority the widget asks for is listed for the reviewer:
   capabilities (the sensitive ones marked), network routes with their
   response bound, clipboard writes, storage and game events;
5. with `--previous`, the last approved version (its `manifest.json`, its
   package, its folder or its ZIP): the ID must be the same and the version
   higher, and the report lists the
   [permission keys](#permission-keys) added, widened and removed, and the
   review the version needs.

| Code | Severity | Meaning |
| --- | --- | --- |
| `admission.reserved_id` | error | A `com.playervox.*` ID, reserved for PlayerVox; without `--publisher`, also an ID under a reserved handle (`playervox.*`, `admin.*`…). |
| `admission.placeholder_id` | error | An example ID, without `--publisher`. |
| `admission.id_not_owned` | error | The ID does not belong to the publisher, or, without `--publisher`, cannot belong to any. |
| `admission.listing_missing`, `admission.listing` | error | No `listing.json`, or one that breaks the listing's rules (a warning with `--listing optional`). |
| `admission.preview` | error | `preview` does not name a packaged PNG within bounds (a warning with `--listing optional`). |
| `admission.license` | error | A PlayerVox widget whose license is not MIT (a warning with `--listing optional`). |
| `admission.view_not_reproducible` | error | The submitted compiled view differs from what `view.ocml` compiles to. |
| `admission.previous` | error | The previous version cannot be read. |
| `admission.previous_mismatch` | error | The previous version is another widget. |
| `admission.version_not_newer` | error | The version is not above the previous one. |
| `admission.package_rebuilt` | warning | The submitted archive differs from the rebuild in other files. |
| `admission.not_rebuilt` | warning | An archive was admitted without its sources. |

Options: `--publisher HANDLE`, `--domain DOMAIN` (repeatable), `--previous
FILE`, `--package FILE`, `--source-map FILE` ([the code map](#the-code-map),
written when the sources are admitted), `--out DIR` (writes the admitted
package, its listing and a report into an empty directory), `--format
json`, `--deny-warnings`. `admit <file.ocpkg> --listing FILE` checks an
archive without its sources.

`--listing required|optional` is for sources. `required`, the default,
refuses sources without a valid `listing.json`. `optional` is the creator
space's way: the listing is edited there, so `listing.json` may be absent,
and one with a problem is left out (no listing in the report or in
`--out`) with warnings instead of refusing the sources. Exit status: 0 admitted, 1 refused, 2 on a
usage or file error. See [publishing and review](publishing.md).

### Permission keys

Each permission has a stable key, the same in the creator space:

| Key | Permission |
| --- | --- |
| `network:GET https://api.nova.gg/v1/timers` | A network route: method, origin and path. |
| `storage` | Storage. |
| `clipboardWrite` | Clipboard writes. |
| `capability:<name>` | A capability. |
| `gameEvent:<name>` | A game event. |

A key is *added* when the previous version did not have it, *widened* when
its route stays but its rule changes (path or query constraints, response
bound), and *removed* when it goes. An added or widened key calls for a
**full** review; otherwise the review is **quick**.

## diff

```sh
overcrow-widget diff lol-timers-1.0.0.zip .
overcrow-widget diff old/ new/ --format json
```

Shows what changed between two versions of a widget's sources, each a
folder or a ZIP, read as `admit` reads them: the files the creator space
receives. Files are sorted by path; each added, modified or removed file
comes with its unified changes (three lines of context) and its added and
removed line counts. A file that is not UTF-8 text is binary: only its
SHA-256 is compared. So is a text above 1 MiB or 20,000 lines, or once
200,000 lines were compared in one diff (`tooLarge`). When both versions have a valid manifest, the
[permission keys](#permission-keys) the new version adds, widens and
removes are listed, with the review it needs.

Option: `--format json`. Exit status: 0 when both versions were read,
whether or not they differ; 1 when one is refused; 2 on a usage or file
error (a version missing or unreadable).

## submit

```sh
overcrow-widget submit --dry-run --submission submission.json
overcrow-widget submit --submission submission.json
```

Sends a version of your widget to the OverCrow creator space, from a
terminal, a CI job or the OverCrow MCP server, then follows its checks. It
never asks a question: what is missing is said, with a stable
[exit status](#exit-status). It takes the widget folder (the current one
without argument) or a ZIP of it.

### The publish key

- Create it in the creator space (Publisher, Publish keys). A key can only
  submit versions of one widget, for 1 to 365 days (90 by default), and is
  shown once.
- `submit` and `status` read it from the environment variable
  `OVERCROW_PUBLISH_KEY`, and only there: never from an argument or a file
  of the project. In a CI, keep it as a secret.
- The tool never shows it: any `ocw_pub_…` text is masked in its output,
  its errors and its logs. Whatever the command, it removes the variable
  from the environment of the programs it starts (TypeScript, the runtime).
- A key that expires within 14 days gives a warning. An expired or revoked
  key ends with status 2: create a new one and replace the secret.

### What it does

1. It checks the key, and reads what the creator space needs for this
   widget: the last approved version, the lowest version it takes now, the
   submissions left (20 over 24 hours), whether the listing has a privacy
   policy.
2. It checks exactly what it will send. The folder is zipped as the
   creator space reads it ([source archives](#source-archives)), read back
   and admitted as the creator space admits it, `listing.json` being
   optional; a ZIP given instead is sent byte for byte. The manifest ID
   must be the key's widget and the version above the last approved one.
   Each permission the version adds or widens (each permission, for a first
   version) needs a justification, by its [key](#permission-keys). The
   texts must follow the creator space's rules. If anything is wrong,
   nothing is sent (status 1).
3. It sends the archive, then follows the six checks of the creator space,
   about a minute: manifest, version number, code analysis, package build,
   permissions, size and resources.
4. It ends when the version enters review (status 0), when a check fails
   (status 1: each problem is shown on the line of your file), or when the
   version passed its checks but waits in the creator space for what only
   the creator space takes (status 3): a privacy policy when the widget
   uses the network, a complete listing for a first version, or the review
   slot of a new publisher. The link to finish there is shown.

Ctrl+C while the checks run stops following them; they go on in the
creator space, and `overcrow-widget status --version 1.3.1 --wait` follows
them again (status 4). A run cut short before the end (network, Ctrl+C)
resumes the same submission when you run the same command again; changed
sources or texts make a new submission. A submission not finished within
an hour expires, and every submission counts in the daily limit.

| Option | Effect |
| --- | --- |
| `--submission FILE` | The texts of the version ([below](#the-texts-file)). |
| `--release-notes-en TEXT`, `--release-notes-fr TEXT`, `--review-message TEXT` | Replace those of the file. |
| `--dry-run` | Steps 1 and 2 only, nothing sent: what the creator space will ask for (justifications, privacy policy, review type, lowest version, submissions left) and the archive's SHA-256. |
| `--expect-sha256 HEX` | Sends only an archive with this SHA-256, the `archive.sha256` of a `--dry-run`: what is sent is what was checked. |
| `--no-wait` | Ends after the upload (status 4). |
| `--format json` | One JSON object ([machine-readable output](#machine-readable-output)). |
| `--verbose` | One line per request on the error output: method, address without its query, status and time; never a header, a key or a body. |

### The texts file

<!-- source: docs/content/examples/weather/submission.json -->
```json
{
  "releaseNotes": {
    "en": "First version: the forecast of your city, in metric or imperial units.",
    "fr": "Première version : les prévisions de votre ville, en unités métriques ou impériales."
  },
  "justifications": [
    {
      "permission": "network:GET https://api.example.com/v1/forecast/{city}",
      "text": "Reads the forecast of the city the player chose, every 30 minutes at most."
    },
    {
      "permission": "storage",
      "text": "Keeps the chosen city and units between two games."
    }
  ],
  "reviewMessage": "The forecast API needs no account and receives only the city."
}
```

| Key | Value |
| --- | --- |
| `releaseNotes` | The public notes of the version, shown to players: `en` (needed as soon as there are notes) and `fr`, 500 characters each, plain text, line breaks allowed. |
| `justifications` | For the reviewer, one `{permission, text}` per new or widened permission, by its [key](#permission-keys); 500 characters each. |
| `reviewMessage` | A private message to the reviewer, 2,000 characters. |

Every key is optional; any other key is refused. The OverCrow MCP server
writes this file.

### In a CI job

A GitHub Actions workflow that installs the tool ([installing](#installing))
and submits the example widget `nova.weather` on every version tag, with
the key in the repository's secrets:

<!-- source: docs/content/examples/weather/.github/workflows/submit.yml -->
```yaml
# Sends the widget to the OverCrow creator space when a version tag is
# pushed. The publish key is a secret of the repository, and the OverCrow
# release whose creator tools to use is a variable of the repository.
name: Submit to OverCrow

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  submit:
    runs-on: ubuntu-24.04
    env:
      OVERCROW_VERSION: ${{ vars.OVERCROW_VERSION }}
    steps:
      - uses: actions/checkout@v4
      - name: Install overcrow-widget
        run: |
          tools="overcrow-creator-tools-$OVERCROW_VERSION-linux-x86_64"
          curl --fail --location --silent --show-error --remote-name \
            "https://github.com/Valhallab/playervox-overcrow-releases/releases/download/v$OVERCROW_VERSION/$tools.zip"
          unzip -q "$tools.zip"
          (cd "$tools" && sha256sum --check --quiet SHA256SUMS)
          install -D -m 755 "$tools"/overcrow-widget-*-linux-x86_64 "$HOME/.local/bin/overcrow-widget"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Submit to OverCrow
        run: overcrow-widget submit --submission submission.json
        env:
          OVERCROW_PUBLISH_KEY: ${{ secrets.OVERCROW_PUBLISH_KEY }}
```

The job fails on any status but 0. `OVERCROW_API_URL` points `submit`
and `status` to another API, for tests only: `https://`, or `http://` to
`127.0.0.1`, `localhost` or `[::1]`, with a warning every time. Never set
it in a real job; the OverCrow MCP server never sets it.

## status

```sh
overcrow-widget status
overcrow-widget status --version 1.3.1 --wait
```

Shows the versions of the key's widget, with their state and review type.
With `--version`, one version, by its number (the latest of that number)
or its ID: its six checks and their problems, what keeps it out of review,
the reviewer's remarks and the review delay. `--wait` follows a version
still being checked. Options: `--version VERSION|ID`, `--wait`, `--format
json`, `--verbose`. Status: 0 when read, 2 on an error; with `--wait`, the
statuses of `submit`.

| State | Meaning |
| --- | --- |
| `checking` | The checks run. |
| `checks_failed` | A check failed: nothing reached the reviewers. |
| `ready` | The checks passed; the version waits in the creator space. |
| `in_review` | A person reviews it. |
| `changes_requested`, `approved`, `rejected` | The review's decision. |
| `published` | In the catalog. |
| `superseded`, `discarded` | Replaced by a newer submission, or abandoned. |
| `withdrawn`, `suspended` | Out of the catalog. |

## Source archives

`admit` and `diff` take the widget folder or a ZIP of it (its name ends in
`.zip`), as the creator space receives it. The ZIP may hold the files
directly, or one folder that holds them all, as Windows and macOS make it.
It may carry a short archive comment (1,024 bytes at most), as GitHub's
"Download ZIP" and `git archive` write it; the comment is never read.

Left out of both, and never sent by the creator tools: hidden files and
folders (`.env`, `.git/`, `assets/.DS_Store`…), `node_modules/`, `dist/`,
`tests/output/`, `__MACOSX/`, built packages, key files and system files,
and, in a folder, links and names that are not portable ASCII. In a ZIP,
they still count toward the bounds below and are checked like the rest.

| Bound | Value |
| --- | --- |
| Archive | 32 MiB |
| Uncompressed | 64 MiB |
| Files | 2,000 |

Everything is checked before a byte is written: a refused archive writes
nothing, and an admitted one is written only into a private work folder,
removed at the end.

| Code | The archive holds |
| --- | --- |
| `sources.archive_size` | More than 32 MiB. |
| `sources.too_large`, `sources.too_many_files` | More than 64 MiB or 2,000 files once uncompressed. |
| `sources.unsafe_name` | A name that could leave the widget folder (`../`, `/` first, `:`), or that some system cannot use: anything but printable ASCII, a final dot or space, `CON`, `NUL`, `COM1`… |
| `sources.backslash` | Folders separated by `\`, as Windows PowerShell 5.1 `Compress-Archive` writes them. Send the widget folder itself in the creator space, or use [`submit`](#submit), which makes a correct ZIP. |
| `sources.duplicate_name` | Two names that differ only by case, or a file that is also a folder. |
| `sources.link`, `sources.special_file` | A link, or a device, a FIFO or a socket. |
| `sources.bomb` | An entry that inflates far beyond its compressed size, or beyond its declared size. |
| `sources.read` | The file cannot be read (exit status 2). |
| `sources.encrypted` | An encrypted entry. |
| `sources.zip64` | ZIP64, which sources never need. |
| `sources.archive` | Anything else a ZIP should not hold: a comment above 1,024 bytes or holding an end record, bytes before, between or after the entries or after an entry's compressed data, another name in an extra field, sizes or checksums that disagree. |

## The code map

`--source-map FILE` writes a map from each position of the shipped
`logic.js`, bundled and minified, back to the file, line and column of
your sources: a [Source Map v3](https://tc39.es/ecma426/). The creator
space keeps it private and uses it to show you the errors of your widget
in your own code.

- `sources`: `logic.ts` (or `logic.js`), the files of `@overcrow/sdk`
  (listed in `ignoreList`) and `overcrow:view-table`, the expression table
  generated from `view.ocml`, whose text is in `sourcesContent`.
- `x_overcrow_functions`: the named functions of the sources,
  `{"source", "name", "start": [line, column], "end": [line, column]}`,
  zero-based, columns in UTF-16 units like `mappings`. The function of a
  position is the innermost one around it. The expressions of the view
  table are named `view expression <n>`, `<n>` being their index in
  `view.json`.

The same sources always give the same map. It is never part of the
package, and `logic.js` does not point to it.

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
| `sources` | A source archive | see [source archives](#source-archives) |
| `init`, `doctor`, `admission` | Those commands | listed above |
| `submit` | What `submit` checks before sending | `widget_not_submittable`, `agreement_required`, `limit_reached`, `version_too_low`, `justification_missing`, `archive_too_large`, `archive_mismatch`, `release_notes`, `justification`, `review_message` |

- Lines and columns start at 1; a column counts characters, not bytes.
- An unknown name comes with the closest name that exists.
- With `--format json`, each diagnostic is one JSON object on a line of the
  standard output:
  `{"severity","code","file","line","column","message","help"}`, with
  `null` for what is unknown. `package --format json` ends with one
  `{"package","bytes","sha256","logicBytes","sourceMap"}` object; `admit`
  and `diff` print one report ([machine-readable output](#machine-readable-output)).
- Texts that come from a widget (its logs, its names) are shown with
  terminal control characters neutralized.

Scripts should match the codes: messages and help texts may be reworded.

## Machine-readable output

With `--format json`, `admit`, `diff`, `submit` and `status` print one
JSON object on one line. Fields are only ever added; a `formatVersion`
change announces any other change.

`admit`:

| Field | Value |
| --- | --- |
| `formatVersion` | `1`. |
| `admitted` | Whether the sources are admitted. |
| `publisher` | The `--publisher` handle, or `third-party`. |
| `id`, `version`, `reservedId` | The widget; `null` when the sources were refused before the build. |
| `package` | `bytes`, `sha256` and each file's `bytes` and `sha256`. |
| `reproducible` | `viewJson` and `archive`, compared with `--package`, else `null`. |
| `listing` | `bytes`, `sha256`, `spdxLicense` and `preview` of `listing.json`. |
| `sources` | `kind` (`folder` or `archive`), `files`, `bytes`, `ignored` (`path`, `reason`) and, for a ZIP, `sha256` and `prefix` (the wrapping folder). |
| `review` | The authority to review, one object per item (`kind`, then its fields). |
| `permissions` | `keys`; with `--previous`, also `previous` (`id`, `version`), `added`, `changed`, `removed` and `reviewType` (`full` or `quick`), else `null`. |
| `listingPolicy` | `required` or `optional` (`--listing`). |
| `diagnostics` | The diagnostics, as above. |

`diff`:

| Field | Value |
| --- | --- |
| `formatVersion` | `1`. |
| `compared` | `false` when a version is refused; then only `diagnostics` follows. |
| `old`, `new` | `kind`, `files`, `bytes`, `sha256`, `prefix`, `ignored`, `id` and `version` of each version. |
| `files` | Changed files by path: `path`, `status` (`added`, `modified`, `removed`), `binary`, `tooLarge`, `oldSha256`, `newSha256`, `additions`, `deletions` and `hunks` (`oldStart`, `oldLines`, `newStart`, `newLines`, `lines`, each line starting with ` `, `-`, `+` or `\`). |
| `totals` | `added`, `modified`, `removed`, `additions`, `deletions`. |
| `permissions` | `added`, `changed`, `removed` and `reviewType`, or `null` without two valid manifests. |
| `diagnostics` | The diagnostics. |


`submit` and `status`:

| Field | Value |
| --- | --- |
| `formatVersion`, `command` | `1`; `submit` or `status`. |
| `outcome`, `exitCode` | How the run ended (below) and its [exit status](#exit-status). |
| `dryRun` | `submit`: whether nothing was to be sent. |
| `key` | `name`, `hint` (the four characters after `ocw_pub_`), `expiresAt`, `expiresSoon`. |
| `widget` | `id`; `submit`: `publisher`, `status`; `status`: `name`. |
| `archive` | `submit`: `kind` (`folder`, zipped by the tool, or `archive`), `bytes`, `sha256`, `files`, `uncompressedBytes`, `ignored`. |
| `local` | `submit`: `admitted`, `version`, `minimumVersion`, `previousVersion`, `permissions` (`keys`, `added`, `changed`, `removed`, `reviewType`), `diagnostics`. |
| `requirements` | `submit`: `justifications` (`required`, `given`, `missing`, `unused`), `privacyPolicy` (`required`, `present`), `reviewType`, `submissions` (`limit`, `remaining`, `nextSubmissionAt`), `review` (`available`, `blockedBy`), `agreement` (`version`, `accepted`), `blockers` (`code`). |
| `submission` | `submit`: `id`, `state`, `resumed`, `quota`. |
| `version` | The creator space's version, its fields in camelCase: `id`, `version`, `state`, `reviewType`, `checks` (`key`, `status`, `diagnostics`), `reviewBlockers`, `completeInPortal` (`message`, `url`), `permissions`, `remarks`, `deadline`, `history`… |
| `versions` | `status` without `--version`: every version. |
| `error` | `code`, `message` and, when known, `httpStatus`, `retryAfter`, `nextSubmissionAt`, `minimumVersion`, `expiredAt`, `fields`; else `null`. |

`outcome` is `ready_to_send` (`--dry-run`), `refused_locally`, `refused`
(the creator space refused the submission), `complete_in_portal`, `error`,
or the version's state; `status` without `--wait` has none. Error codes
are the creator space's (`version_not_newer`, `submission_limit_reached`,
`publish_key_expired`, `publish_key_revoked`…) or the tool's:
`publish_key_missing`, `invalid_publish_key`, `api_url_invalid`,
`submission_file`, `sources`, `sources.read`, `network`, `timeout`,
`server`, `response`, `redirect`, `upload_refused`, `build_failed`,
`not_found`. Problems found before sending are diagnostics: `sources.*`,
`admission.*` and `submit.*` (`widget_not_submittable`,
`agreement_required`, `limit_reached`, `version_too_low`,
`justification_missing`, `archive_too_large`, `archive_mismatch`,
`release_notes`, `justification`, `review_message`).

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | Success. Warnings are allowed unless `--deny-warnings`. `diff` read both versions, whether or not they differ. `submit`: the version is in review (with `--dry-run`, it would enter review). |
| 1 | Errors were found; `admit` refused the sources; `diff` refused a version; a scenario of `test` failed; the overlay ended a `dev` session. `submit`: something to fix (a check before sending, a refusal of the creator space, a failed check). |
| 2 | A usage or file error; no overlay for `dev`; no runtime for `test`. `submit`, `status`: the key (missing, invalid, expired, revoked), the network or the server. |
| 3 | `submit`, `status --wait`: the version passed its checks and waits in the creator space. |
| 4 | `submit`, `status --wait`: the version is still being checked (Ctrl+C, `--no-wait`, or 15 minutes). |

These meanings do not change from one version of the tool to the next.
