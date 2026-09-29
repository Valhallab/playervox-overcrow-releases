# OverCrow releases

Public distribution repository for PlayerVox OverCrow on Windows and Linux.
Application source code and build history are maintained separately in a private
repository. This repository also owns the public SDK, creator tools, templates, documentation
content, reference widgets, and signed marketplace distribution. Installers and
packages for the desktop application belong in GitHub Release assets.

## Downloads

[Published releases](https://github.com/Valhallab/playervox-overcrow-releases/releases)

Each release contains the Windows x64 installer and the Linux x64 Arch, DEB and
RPM packages, with a release manifest and SHA-256 checksums. A channel containing
`release: null` has no published version yet.

Versions follow `MAJOR.MINOR.PATCH`: incompatible changes increment MAJOR,
compatible features increment MINOR, and compatible fixes increment PATCH.
Tester versions use `MAJOR.MINOR.PATCH-beta.N`. Published versions are retained;
changed binaries always require a new version.

## Update channels

| Channel | Purpose | Feed |
| --- | --- | --- |
| Stable | Validated releases | [stable.json](https://raw.githubusercontent.com/Valhallab/playervox-overcrow-releases/main/docs/channels/stable.json) |
| Beta | Opt-in tester releases | [beta.json](https://raw.githubusercontent.com/Valhallab/playervox-overcrow-releases/main/docs/channels/beta.json) |

The feeds describe published downloads. They are not Tauri updater manifests and
do not enable automatic installation by themselves. SHA-256 checksums detect
content changes; they are not publisher signatures. Compatible Control Center
builds need their own supported verification and installation path.

Downloads are hosted directly in GitHub Releases. The Control Center currently
checks GitHub's stable-release API; no GitHub Pages website is required.

Windows installers and Linux packages share these channels, while installation
and restart behavior remain specific to each platform.

## Distribution

OverCrow is proprietary software. Refer to the license and third-party notices
included with each package. The automatically generated GitHub "Source code"
archives contain this distribution repository, not the application source.

## Create widgets

Start with the [SDK documentation](https://overcrow.playervox.com/docs/en/),
[Widget Studio](https://overcrow.playervox.com/studio/en/), or
[portable creator kit](https://overcrow.playervox.com/docs/downloads/creator-kit.zip).
The Studio runs without an account; export your work locally.

SDK 1.3.0 uses Web API v1. Host services expose telemetry, FPS and system media.
Widgets keep their own data in isolated storage and cannot access built-in notes,
stopwatch state, journals or connected accounts.

| Source | Purpose |
| --- | --- |
| `crates/overcrow-widget-schema/` | Widget API v1 schema and validators, shared with OverCrow |
| `crates/overcrow-widget-format/` | `view.ocml` compiler and `style.ocss` parser, shared with OverCrow |
| `fuzz/` | Fuzz targets of every parser and package verifier |
| `sdk/` | `@overcrow/sdk` 1.0, the TypeScript API of widget API v1 logic ([guide](docs/sdk-guide.md), [reference](docs/sdk-reference.md)) |
| `cli/` | `overcrow-widget`, the widget API v1 CLI: `init`, `check`, `package`, `inspect` ([guide](docs/cli.md)) |
| `templates/` | Widget API v1 templates of `overcrow-widget init`: blank, counter, list, chart |
| `content/sdk/` | Web runtime JavaScript SDK 1.3 and TypeScript definitions |
| `content/templates/` | Blank, Counter, and Checklist examples |
| `content/docs/` | English and French SDK articles |
| `tools/creator-kit/` | Portable CLI, packaging, and preview |
| `tools/marketplace-tool/` | Rust package validation and static admission |
| `widgets/` | Public reference widgets |
| `published/marketplace/v1/` | Existing signed catalog and immutable packages |

Use Node.js 22.18+ and Python 3. Downloaded creator projects need only Node.js.

```sh
python3 scripts/package-docs-examples.py published/docs/downloads
node --test tests/creator-kit/*.test.mjs tests/warframe-market/*.test.mjs
cargo test -p marketplace-tool --locked
```

The widget API v1 contract lives in `crates/overcrow-widget-schema/`: elements,
style, tokens, icons, permissions, services, IPC, bounds, and the manifest,
package, compiled-view and catalog validators. OverCrow compiles this crate at a
pinned revision. The [schema reference](docs/widget-schema-v1.md) is generated
from it, and the [package and catalog format](docs/widget-package-v1.md)
specifies the `.ocpkg` v1 container. `crates/overcrow-widget-format/` parses
the [view and style sources](docs/widget-source-formats.md) against the same
tables. After a change, regenerate the reference
and the conformance fixtures:

```sh
cargo run -p overcrow-widget-schema --example reference > docs/widget-schema-v1.md
cargo run -p overcrow-widget-schema --example fixtures
cargo test -p overcrow-widget-schema --locked
cargo run -p overcrow-widget-format --example fixtures
cargo test -p overcrow-widget-format --locked
cargo run -p overcrow-widget-schema --example sdk-types
```

The last command writes the SDK types of `sdk/src/generated/`; the SDK
itself is built and tested with npm in `sdk/` (see [its README](sdk/README.md)).
The widget CLI builds and tests with Cargo; the SDK's end-to-end test uses
it, so build it first:

```sh
cargo test -p overcrow-widget-cli --locked
cargo build -p overcrow-widget-cli --locked
cargo deny --locked check advisories bans sources licenses
```

The website consumes a reviewed, revision-pinned snapshot from this repository.
Edit creator sources here, then update that snapshot in the private web repository.
Do not publish SDK or creator-kit releases as GitHub Releases: the desktop updater
uses this repository's stable-release API. Creator downloads stay under
`https://overcrow.playervox.com/docs/downloads/` and can be versioned with Git tags
that have no associated GitHub Release.

Widget submissions target `candidate`; tooling and documentation target `main`.
Neither a pull request nor a merge signs or publishes a widget. See
[contributing](CONTRIBUTING.md), [security](SECURITY.md), and
[maintenance](docs/github-maintenance.md).

The public sources are MIT-licensed, except `@overcrow/sdk` (MIT-0, no
attribution required), with the scopes in [LICENSING.md](LICENSING.md).
Desktop installers remain proprietary under their own included license; the MIT
license does not grant rights to OverCrow's private application source or branding.
