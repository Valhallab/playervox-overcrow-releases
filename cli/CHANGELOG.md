# Changelog of `overcrow-widget`

The CLI's major version follows the packages it writes (`.ocpkg` v1, widget
API v1) and the `@overcrow/sdk` major it embeds. While the version carries a
`-beta.N` suffix, its options, JSON output and exit statuses may still
change between betas; 1.0.0 will freeze them under semantic versioning.
The CLI's version enters no package: a package depends only on the
widget's sources and the embedded SDK.

## Unreleased

- `submit [dir | sources.zip]` sends a version to the OverCrow creator
  space with a publish key, read from `OVERCROW_PUBLISH_KEY` only, and
  follows its six checks until it enters review, fails a check (shown on
  the lines of the files sent) or waits in the creator space. Before
  sending, it checks the very archive it will upload: the folder is zipped,
  read back and admitted as the creator space admits it; the version must
  be newer, and each new or widened permission needs a justification.
  `--dry-run` sends nothing and says what the creator space will ask for.
  `--submission FILE` holds the texts (`releaseNotes`, `justifications`,
  `reviewMessage`), `--expect-sha256` binds the upload to the archive that
  was checked, `--no-wait` stops after the upload. A run cut short resumes
  the same submission. The key never appears in any output, and no child
  process of any command inherits it.
- `status [--version VERSION|ID] [--wait]` shows the versions of the key's
  widget, or one version with its checks, what keeps it out of review, its
  remarks and its review delay.
- New exit statuses for `submit` and `status --wait`: 3 (waiting in the
  creator space) and 4 (still being checked); `--format json` prints one
  object, `formatVersion` 1.
- `admit --listing optional`, for sources: `listing.json` may be absent,
  and one with a problem is left out with warnings (the creator space
  edits the listing itself). `required` stays the default; the report
  gains `listingPolicy`, and `--out` no longer writes an empty
  `listing.json`.
- Source ZIPs may carry a short comment (GitHub's "Download ZIP", `git
  archive`); a name with `\`, as PowerShell 5.1 `Compress-Archive` writes
  it, is refused with `sources.backslash`, which points to the creator
  space or `submit`.
- `admit` takes a ZIP of the widget folder (`admit lol-timers.zip`), as the
  creator space receives it, and admits it to the same package as the
  folder; a folder is read the same way, leaving out what the creator
  tools never send. `package`, `check`, `dev` and `test` skip the same
  files under `assets/` (`.DS_Store`, `dist/`…). The archive is read and inflated in memory under strict rules
  (32 MiB, 64 MiB and 2,000 files uncompressed; no link, special file,
  unsafe or non-portable name, duplicate, encryption, ZIP64, comment,
  hidden byte, alternate name or abnormal compression ratio; every entry
  is inflated and checked, even the ones left out), then only its
  validated files are written into a private work folder. Hidden files,
  `node_modules/`, `dist/` and the like are left out; one wrapping folder
  is accepted. New diagnostics: `sources.*`.
- `package --source-map FILE` and `admit --source-map FILE` write the
  code map of `logic.js`: a Source Map v3 back to the sources, with their
  functions (`x_overcrow_functions`). It never enters the package.
- `diff <old> <new>`: the changes between two versions of a widget's
  sources (folders or ZIPs), unified, with line counts and the permission
  keys added, widened and removed. Texts above 1 MiB or 20,000 lines are
  compared by digest only.
- `admit --previous FILE` compares with the last approved version: same
  ID, higher version, and the permission keys
  (`network:GET https://…`, `storage`, `clipboardWrite`, `capability:…`,
  `gameEvent:…`) added, widened and removed, with the review type.
- Widget IDs follow the creator space: `admit --publisher HANDLE
  [--domain DOMAIN]…` checks that the ID belongs to the publisher
  (`playervox` stays trusted for the repository's widgets); without a
  publisher, example IDs (`nova.*`, `yourhandle.*`, `gg.nova.*`…) and IDs
  under a handle nobody can register are refused. `init` without `--id` writes `yourhandle.<dir>` and says to
  replace it. Messages give `nova.lol-timers` and `gg.nova.lol-timers` as
  examples.
- The JSON reports of `admit` and `diff` and the exit status of every
  command are documented as stable.

## 1.0.0-beta.2

Released in the creator tools ZIPs of OverCrow 0.6.0-beta.2's GitHub
release, `overcrow-creator-tools-0.6.0-beta.2-<platform>.zip`, beside the
headless runtime it pins.

- It pins the headless runtime 0.6.0-beta.2, from the same release.
- `test` downloads the pinned headless runtime when the cache does not
  hold it and `--runtime` is not given: from the creator tools ZIP of this
  platform in the OverCrow release that published it, keeping only the
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
