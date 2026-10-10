# `overcrow-widget`: internals

The widget CLI is documented for creators on the website:
[the command-line tool](https://overcrow.playervox.com/docs/en/cli/)
([français](https://overcrow.playervox.com/docs/cli/)). Its source page is
[`docs/content/en/cli.md`](content/en/cli.md). This file keeps what only
concerns those who work on the CLI itself (`cli/`, MIT): how `logic.js` is
built, the calling convention of the view table, and maintenance.

The CLI compiles the same public validators the OverCrow host runs at
admission and at every activation (`crates/overcrow-widget-schema` and
`crates/overcrow-widget-format`), so a package it accepts is a package the
host reads.

## How `logic.js` is built

1. The logic module, the SDK and a generated view module are parsed and
   their TypeScript is stripped (oxc, target ES2023).
2. The view module is the expression table of `view.json` in the
   [calling convention of `registerView`](#calling-convention-of-the-view-table).
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

For the SDK's end-to-end Clock, `logic.js` is 4.3 KB and the VM's start-up
cost over a hand-written script is about 0.4 ms.

### The code map

With `--source-map`, each of the three prints (types stripped, module
linked, script minified) also gives a source map (oxc's codegen), and
`oxc_sourcemap` composes them: the linked module's map with its stripped
module's map, the modules placed at their line in the script, the
minified script's map over that, shifted by the notice's line. The result
is a Source Map v3 of `logic.js` (`cli/src/sourcemap.rs` adds `ignoreList`
for the SDK, the view table's text and the `x_overcrow_functions` table).
Asking for the map never changes `logic.js`; the bundle tests check it,
and that an error thrown at a known line of `logic.ts` maps back to it.

## Source archives and `diff`

`cli/src/zipread.rs` reads two kinds of ZIP with one parser: the creator
tools ZIP the runtime is downloaded from (`Rules::CREATOR_TOOLS`), and
creators' source archives (`Rules::SOURCES`, stricter: folder entries,
attributes, layout, portable names, compression ratio). The `source_zip`
and `creator_tools_zip` fuzz targets include that file.
`cli/src/sourcetree.rs` turns a folder or a ZIP into the same sorted tree
of files, inflated in memory; `admit` writes it into a private temporary
folder and builds from there, and `diff` compares two trees (Myers line
diff, a whole rewrite past 2,048 edits). Under `Rules::SOURCES` an archive
comment of at most 1,024 bytes is accepted (the commit ID of `git archive`
and GitHub's "Download ZIP"), only when exactly one end record reaches the
end of the file and the comment holds no end record signature; a `\` in a
name has its own refusal (`sources.backslash`, PowerShell 5.1).
`cli/src/zipwrite.rs` writes a tree back as the ZIP `submit` sends:
sorted entries, no folder entry, extra field, comment, descriptor or
ZIP64, a fixed date, deflate only when it shrinks the file within the
ratio the reader allows (stored otherwise). `submit` reads its own ZIP back
before sending it, and a test admits the bytes a stand-in server received
like the folder.

## `submit` and `status`

`cli/src/publish/` talks to the creator space's publish API
(`/api/v1/publish/*` on `https://api.playervox.com`):

- `secret.rs`: `main` takes `OVERCROW_PUBLISH_KEY` out of the process
  environment before anything else, for every command (each `Command` also
  removes it). `PublishKey` never displays itself; `redact` masks every
  `ocw_pub_[A-Za-z0-9_-]+` and the variable's exact value in all that
  `submit` and `status` print, their panic hook included.
- `client.rs`: `ureq` through rustls, no redirect ever followed (the
  `Authorization` header never leaves the API), bounded times and answers,
  idempotent requests tried again on a cut or a 502–504, one wait on a
  short `rate_limited`. The signed upload gets exactly the API's headers
  and never the key. `OVERCROW_API_URL` (tests only, in release builds
  too: the MCP server's tests run the pinned CLI against a local API)
  takes `https://` anywhere or `http://` to the loop only, and warns.
- `api.rs`: the answers read into what the commands decide on; it depends
  only on `serde_json`, and the `publish_responses` fuzz target includes
  it. `camelize` renames the API's version for the CLI's JSON.
- `state.rs`: the `Idempotency-Key` of a submission in progress, in
  `<cache>/overcrow-widget/submit/` (0700, files 0600), named after a hash
  of the API, the key and the request, never holding the key; removed
  once the submission ends, and after a day.
- `texts.rs`: the `--submission` file (camelCase) and the API's text rules
  (`catalog_v2::display_text` for release notes).
- `submit.rs`, `follow.rs`, `status.rs`, `render.rs`: the flow, the
  following of the checks (15 minutes at most, Ctrl+C through
  `interrupt.rs`), the human output.

`submit` admits locally with `admit::Publisher::Key` (the manifest must
carry the key's widget ID: `GET /publish/key` gives no verified domain, and
the creator space checks ownership again on every build) and
`--listing optional`. The creator space's builder runs
`admit sources.zip --publisher <handle> --domain … --previous previous.zip
--listing optional --source-map … --out … --format json`.

`cli/tests/submit.rs` runs both commands against `cli/tests/support/fake_api.rs`,
a local stand-in for the publish API and the signed upload whose answers
follow the API's OpenAPI document; it records every request and every
violation (no user agent, no key on the API, a key or wrong signed headers
on the upload). A debug build only reads `OVERCROW_WIDGET_TEST_PANIC`, which
makes `submit` and `status` panic with the key in the message, to test the
mask.

## Calling convention of the view table

The SDK runs inside the widget VM, bundled into `logic.js`. It wraps the
VM's runtime surface 0.1 (the frozen global `overcrow`, reported as `sdk`
in the VM's `Ready` message): SDK 1.x needs runtime surface 0.1.

`view.json` numbers every expression and handler of `view.ocml`
([compiled output](widget-source-formats.md#compiled-output)). The CLI turns
the compiler's table into a module that runs after the logic module and
registers one function per index:

```js
import * as logic from "./logic.js";
import { registerView, t as sdkT } from "@overcrow/sdk";

const { clockTime, setSeconds } = logic;   // every called name but `t`
const t = "t" in logic ? logic.t : sdkT;   // when `t` is called

registerView([
  function (state, scope) {                // an expression
    const zone = scope.zone;               // each name in scope
    return clockTime(state.now, zone.offset);
  },
  function (state, scope, raw) {           // a handler
    const event = raw.detail;              // `event` is the event detail
    return setSeconds(event);
  },
]);
```

- An expression is `function (state, scope)`, a handler
  `function (state, scope, raw)`; the VM passes `raw = { type, detail }`.
- Its body binds, in order, each name of the expression's scope from
  `scope` (`const zone = scope.zone;`), and in a handler `event` from
  `raw.detail`, then returns the canonical JavaScript text of the
  expression.
- A called name is an export of the logic module; `t` is the SDK's unless
  the logic module exports its own.
- The table has exactly the `expressions` count of `view.json`; the VM
  refuses the bundle otherwise.

The CLI names the second and third parameters `__scope` and `__raw`, which
no view name can be, so they never shadow a called function or a name in
scope. `sdk/test/e2e/clock/` is a complete widget packaged this way by the
SDK's tests.

## The marketplace CI command

`snapshot-plan --repository PATH --revision SHA` is a maintenance command of
the marketplace CI: the validated file list of a Git revision
(`scripts/materialize-git-snapshot.sh`). Creators do not need it.
`admit --publisher playervox` is passed by the marketplace CI only for this
repository's own revisions ([review policy](review-policy.md)). It is the
only publisher that may use `com.playervox.*`, and it admits every widget
of the repository without the ownership check other publishers get.

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
- The messages of the CLI that name a documentation page give its English
  address on the website, under `overcrow.playervox.com/docs/en/`;
  `scripts/check-links.mjs` fails when one of them names no page or
  heading of `docs/content/`.
- The runtime that `test` runs is found by `--runtime <path>`, or by the
  version the CLI pins, in the cache (`$XDG_CACHE_HOME` or `~/.cache`,
  `%LOCALAPPDATA%` on Windows, under `overcrow-widget/runtime/<version>/`),
  checked against its pinned SHA-256 before every run: `--runtime` is
  optional. The pin is the runtime of OverCrow 0.6.0-beta.2, from that
  release's `runtimes.json`. A pinned runtime missing from the cache is
  downloaded (`src/download.rs`) from the creator tools ZIP of its release,
  bounded and checked as its module documentation says, unless
  `--offline` is given. The CLI never builds the runtime
  ([headless runtime interface](widget-testing.md)).

## Release files

The CLI is released inside OverCrow's GitHub release, in the creator
tools ZIPs `overcrow-creator-tools-OVERCROW_VERSION-PLATFORM.zip`
(`linux-x86_64`, `windows-x86_64`), beside the headless runtime of the
same OverCrow version and platform; there is no separate
GitHub release for the CLI. The `cli-dist` workflow builds both platforms
with the `dist` profile on hosted runners (Ubuntu 24.04; Windows with a
static C runtime) and `scripts/package-cli.sh` assembles them, for CLI
version `VERSION`:

| File | Content |
| --- | --- |
| `overcrow-widget-VERSION-linux-x86_64` | The Linux executable. |
| `overcrow-widget-VERSION-windows-x86_64.exe` | The Windows executable. |
| `overcrow-widget-VERSION-LICENSE.txt` | The CLI's MIT license. |
| `overcrow-widget-VERSION-THIRD-PARTY-NOTICES.md` | The licenses of its dependencies on both targets (cargo-about 0.9.1, `about.toml`, `cli/third-party.hbs`). |
| `cli.json` | The version, the source commit, the pinned headless runtime (`runtime`: its version and the SHA-256 of each platform's executable, as the Linux binary reports them with `--version --format json`), and each file's name, size and SHA-256. |
| `SHA256SUMS` | The checksums of the five files above. |

OverCrow's release publisher puts, into each platform's ZIP, under one
directory `overcrow-creator-tools-OVERCROW_VERSION-PLATFORM/`: that
platform's executable, the CLI's license, notices and `cli.json`, the
platform's headless runtime, its license and `runtimes.json`, a
`README.txt` and one `SHA256SUMS` over every other file. It refuses a CLI
whose `runtime` is not the runtime of those ZIPs: `overcrow-widget test`
downloads the ZIP of its platform in the release named by its pin, so the
pin must be updated to the runtime of the release the CLI ships in before
`cli-dist` runs. The release itself keeps eight files: the four packages,
`release.json` (which lists both ZIPs and every file in them), the two
ZIPs and `SHA256SUMS`.

The workflow creates no tag and no release. The changes of each version
are in [`cli/CHANGELOG.md`](../cli/CHANGELOG.md), those of the SDK in
[`sdk/CHANGELOG.md`](../sdk/CHANGELOG.md).
