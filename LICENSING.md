# Licensing scope

Copyright (c) 2026 Valhallab SASU.

This repository's public sources are open source under the
[MIT License](LICENSE): the widget contract crates (`crates/`), the widget
CLI (`cli/`), the templates, the documentation, the CI drivers, the
reference widgets (`widgets/`) and the sources they share
(`widgets-shared/`). The exception is `@overcrow/sdk` (`sdk/`),
which is under the [MIT No Attribution License](sdk/LICENSE) (MIT-0). These
licenses cover the public source files; they do not cover the separate
OverCrow application. OverCrow's Control Center, core, overlay, widget
runtime, native tools and desktop integrations remain private, proprietary
software.

## Widgets

PlayerVox widgets are open source under MIT, the built-ins included: each
directory of `widgets/` carries its own `LICENSE`, which its package ships.

`@overcrow/sdk` is MIT-0: the copy of it that the widget CLI links into
every `logic.js` requires no notice. The CLI still keeps a one-line courtesy
comment naming the SDK version at the top of the bundle. Preserve the
applicable notices when copying or distributing MIT components; include the
widget's `LICENSE` in its package so the widget's own notice travels with
it. The templates of `overcrow-widget init` start a new project with an MIT
`LICENSE` naming its authors; replace it with the license you choose.

Third-party creators' widgets are separate works. Their licensing policy
remains undecided. The marketplace's MIT license does not automatically apply
to them, and this project does not currently establish a requirement to use
MIT or any other specific license. Listing metadata records the declared
license. Existing validation of that metadata is a technical format check,
not legal approval or a promise of publication under any particular license.

## Third-party material and publication

Dependencies, fonts, icons, brand marks, and other third-party material retain
their own licenses and attribution. The marketplace license does not relicense
that material or grant trademark rights; see [TRADEMARKS.md](TRADEMARKS.md).

Signed catalogs and previously admitted artifacts are immutable release inputs.
Changing a source license or listing does not rewrite an existing signature or
artifact. Updated packages must go through the normal admission and authorized
publication process with a new version when replacing a released package; see
[publishing and review](docs/content/en/publishing.md).

Desktop application binaries attached to GitHub Releases are separate proprietary
works governed by their included license, not this repository's MIT license.
