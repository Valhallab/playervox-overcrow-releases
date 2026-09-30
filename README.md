# OverCrow releases

Public distribution repository for PlayerVox OverCrow on Windows and Linux.
Application source code and build history are maintained separately in a
private repository. This repository also owns the public widget contract,
SDK, CLI, templates, documentation content, reference widgets, and signed
marketplace distribution. Installers and packages for the desktop
application belong in GitHub Release assets.

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

Widgets are small packages that OverCrow draws over the game: a view in
markup (`view.ocml`), a bounded style sheet (`style.ocss`) and logic in
TypeScript against `@overcrow/sdk`, run in a sandboxed VM. Start with the
[creator documentation](docs/content/en/index.md)
([français](docs/content/fr/index.md)): the [creator guide](docs/content/en/guide.md)
goes from `overcrow-widget init` to a submission, and the
[reference widgets](docs/content/en/widgets.md) are OverCrow's own built-ins.

Widget API v1 replaces the Web runtime: the JavaScript SDK 1.3, the Web
creator kit, its templates, references and downloads were removed. The
website's documentation is realigned on this content separately.

## Repository map

| Path | Content |
| --- | --- |
| `crates/` | The public widget contract, shared with OverCrow at a pinned revision: `overcrow-widget-schema` (schema and validators), `overcrow-widget-format` (`view.ocml` compiler, `style.ocss` parser), `overcrow-widget-devchannel` ([development channel](docs/dev-channel.md)), `overcrow-widget-scenario` ([test scenarios](docs/widget-testing.md)) |
| `sdk/` | `@overcrow/sdk` 1.0, the TypeScript API of widget logic, with types generated from the schema ([guide](docs/sdk-guide.md), [reference](docs/sdk-reference.md)) |
| `cli/` | `overcrow-widget`: `init`, `check`, `package`, `inspect`, `dev`, `doctor`, `test`, `admit` ([guide](docs/cli.md)) |
| `templates/` | The templates of `overcrow-widget init`: blank, counter, list, chart |
| `docs/content/` | The creator documentation, in English and French: guide, reference, security, publishing |
| `docs/` | The technical manuals and specifications: [CLI](docs/cli.md), SDK, [schema reference](docs/widget-schema-v1.md) (generated), [source formats](docs/widget-source-formats.md), [package and catalog format](docs/widget-package-v1.md), [review policy](docs/review-policy.md), [testing](docs/testing.md) |
| `widgets/` | The built-in widgets on the public SDK, each with its tests and reference page ([list](docs/content/en/widgets.md)), and Warframe Market, a PlayerVox catalog widget |
| `scripts/`, `tests/` | Public CI drivers and their smoke tests |
| `fuzz/` | Fuzz targets of every parser and package verifier |
| `keys/` | Public catalog keys |
| `published/` | Signed catalogs and immutable packages; `marketplace/v1/` is the existing catalog of the Web runtime |
| `fixtures/` | The public development key pair |

## Build and test

The widget API v1 contract lives in `crates/overcrow-widget-schema/`: elements,
style, tokens, icons, permissions, services, IPC, bounds, and the manifest,
package, compiled-view and catalog validators. OverCrow compiles this crate at a
pinned revision. The [schema reference](docs/widget-schema-v1.md) is generated
from it, and the [package and catalog format](docs/widget-package-v1.md)
specifies the `.ocpkg` v1 container. `crates/overcrow-widget-format/` parses
the [view and style sources](docs/widget-source-formats.md) against the same
tables. After a change, regenerate the reference, the conformance fixtures
and the SDK types:

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
cargo test -p overcrow-widget-scenario --locked
cargo build -p overcrow-widget-cli --locked
cargo deny --locked check advisories bans sources licenses
```

The creator documentation's tables are generated with
`node scripts/build-docs-content.mjs`; [testing](docs/testing.md) lists every
check, including the documentation examples and the link check. Use Node.js
22.18 or later.

The website consumes a reviewed, revision-pinned snapshot of this repository.
Do not publish SDK or CLI releases as GitHub Releases: the desktop updater
uses this repository's stable-release API.

Widget submissions target `candidate`; tooling and documentation target `main`.
Neither a pull request nor a merge signs or publishes a widget. See
[contributing](CONTRIBUTING.md), [security](SECURITY.md) and
[publishing and review](docs/content/en/publishing.md).

The public sources are MIT-licensed, except `@overcrow/sdk` (MIT-0, no
attribution required), with the scopes in [LICENSING.md](LICENSING.md).
Desktop installers remain proprietary under their own included license; the MIT
license does not grant rights to OverCrow's private application source or branding.
