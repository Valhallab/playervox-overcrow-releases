# OverCrow releases

Public distribution repository for PlayerVox OverCrow on Windows and Linux.
Application source code and build history are maintained separately in a private
repository. This repository contains only public distribution metadata and
documentation; installers and packages belong in GitHub Release assets.

## Downloads

[Published releases](https://github.com/Valhallab/playervox-overcrow-releases/releases)

No builds have been published in this repository yet. The update channels are
initialized but do not currently advertise an installable version. Compatible
Control Center builds will need to be connected to this distribution service.

## Update channels

| Channel | Purpose | Feed |
| --- | --- | --- |
| Stable | Validated releases | [stable.json](https://valhallab.github.io/playervox-overcrow-releases/channels/stable.json) |
| Beta | Opt-in tester releases | [beta.json](https://valhallab.github.io/playervox-overcrow-releases/channels/beta.json) |

The current bootstrap documents use `release: null` to indicate that no version
is available. They are channel placeholders, not Tauri updater manifests.
The populated release format and signature verification must be implemented
and validated with the Control Center before either feed advertises a build.

Windows installers and Linux packages share these channels, while installation
and restart behavior remain specific to each platform.

## Distribution

OverCrow is proprietary software. Refer to the license and third-party notices
included with each package. The automatically generated GitHub "Source code"
archives contain this distribution repository, not the application source.

Maintainers: see [Publishing](PUBLISHING.md) for the release procedure.
