# Changelog of `overcrow-widget`

The CLI's major version follows the packages it writes (`.ocpkg` v1, widget
API v1) and the `@overcrow/sdk` major it embeds. While the version carries a
`-beta.N` suffix, its options, JSON output and exit statuses may still
change between betas; 1.0.0 will freeze them under semantic versioning.
The CLI's version enters no package: a package depends only on the
widget's sources and the embedded SDK.

## 1.0.0-beta.2

Released in the creator tools ZIP of OverCrow's next GitHub release,
`overcrow-creator-tools-<version>.zip`, beside the headless runtime it
pins.

- `test` downloads the pinned headless runtime when the cache does not
  hold it and `--runtime` is not given: from the creator tools ZIP of the
  OverCrow release that published it, keeping only this platform's
  runtime once its SHA-256 is the pinned one. The ZIP is not kept.
  `--offline` never downloads. HTTPS only, redirects only to GitHub's
  hosts, size and time bounds; an `HTTPS_PROXY` is used.
- `--version --format json` gives the CLI, widget API and SDK versions
  and the pinned runtime; `cli.json` records that runtime.
- `init` gives `cd <dir> && npm install && overcrow-widget check`:
  `@overcrow/sdk` 1.0.0 is on npm, so `npm install` brings TypeScript and
  the SDK types. `doctor` and the type check advise `npm install`, and
  `doctor` names the exact SDK version to install when `node_modules` holds
  another one.

## 1.0.0-beta.1

First release, as binaries for Linux and Windows x86-64 attached to
OverCrow 0.6.0-beta.1's GitHub release, with their SHA-256 checksums, MIT
license and third-party notices. It embeds `@overcrow/sdk` 1.0.0.

- `init`: a project from the blank, counter, list or chart template, with
  an example test scenario and its reference images.
- `check`: validates the manifest, view, style, logic, messages and assets
  with the same validators OverCrow runs at installation and at every
  start, and type-checks the logic with the project's TypeScript.
- `package`: a deterministic `.ocpkg` v1; the same sources and CLI version
  give the same bytes. `inspect` shows what a package holds and asks for.
- `dev` and `doctor`: run the widget in the local OverCrow over the
  development channel and reload it on save; report what the setup has
  and lacks.
- `test`: plays the project's scenarios in OverCrow's headless runtime and
  compares their images. It pins the headless runtime 0.6.0-beta.1, attached
  to the same release: put it in the CLI's cache and `--runtime` is
  optional. The CLI does not download it.
- `admit`: the marketplace's static admission of a submission.
- Diagnostics with stable codes, `--format json`, and the website page that
  explains each one.

Documentation: [the command-line tool](https://overcrow.playervox.com/docs/en/cli/).
