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

| Source | Purpose |
| --- | --- |
| `content/sdk/` | Public JavaScript SDK and TypeScript definitions |
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

The public sources are MIT-licensed, with the scopes in [LICENSING.md](LICENSING.md).
Desktop installers remain proprietary under their own included license; the MIT
license does not grant rights to OverCrow's private application source or branding.
