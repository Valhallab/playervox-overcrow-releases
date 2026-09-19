# OverCrow releases

Public distribution repository for PlayerVox OverCrow on Windows and Linux.
Application source code and build history are maintained separately in a private
repository. This repository contains only public distribution metadata and
documentation; installers and packages belong in GitHub Release assets.

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
| Stable | Validated releases | [stable.json](https://valhallab.github.io/playervox-overcrow-releases/channels/stable.json) |
| Beta | Opt-in tester releases | [beta.json](https://valhallab.github.io/playervox-overcrow-releases/channels/beta.json) |

The feeds describe published downloads. They are not Tauri updater manifests and
do not enable automatic installation by themselves. SHA-256 checksums detect
content changes; they are not publisher signatures. Compatible Control Center
builds need their own supported verification and installation path.

Windows installers and Linux packages share these channels, while installation
and restart behavior remain specific to each platform.

## Distribution

OverCrow is proprietary software. Refer to the license and third-party notices
included with each package. The automatically generated GitHub "Source code"
archives contain this distribution repository, not the application source.

Maintainers: see [Publishing](PUBLISHING.md) for the release procedure.
