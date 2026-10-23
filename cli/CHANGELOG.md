# Changelog of `overcrow-widget`

The CLI's major version follows the packages it writes (`.ocpkg` v1, widget
API v1) and the `@overcrow/sdk` major it embeds. While the version carries a
`-beta.N` suffix, its options, JSON output and exit statuses may still
change between betas; 1.0.0 will freeze them under semantic versioning.
The CLI's version enters no package: a package depends only on the
widget's sources and the embedded SDK.

## Unreleased

- A `toggle`, `choice` or `action` row of `wrapper.menu` may set
  `"closesMenu": true`: the host closes its options menu after a click on
  that row (it stays open by default). `check` and `admit` accept it;
  PlayerVox OverCrow reads it from 0.8.1-beta.1, and the headless runtime
  this CLI pins must be of that version or later to run such a widget. A
  manifest that names it needs the catalog feature `menu-closes`, so the
  catalog offers that version to such hosts only.

## 1.0.0-beta.7

Released in the creator tools ZIPs of PlayerVox OverCrow 0.8.0-beta.1's
GitHub release, `overcrow-creator-tools-0.8.0-beta.1-<platform>.zip`,
beside the headless runtime it pins.

- It pins the headless runtime 0.8.0-beta.1, from the same release.
- It embeds `@overcrow/sdk` 1.1.0, which adds `account.subscribe` and
  `account.connect`; `init` names that version in a new project's
  `package.json`, and `check` and `doctor` expect it in `node_modules`.
- Third-party accounts: a manifest may declare an account in
  `permissions.accounts` (a key, or OAuth with the publisher's public
  client) or name an integrated service (`{ "service": "steam" }`,
  `{ "service": "twitch", "scopes": […] }`), and a network rule names the
  account it is sent with (`account`). `check` and `admit` explain each new
  manifest error; `check` warns about an origin of the account that no rule
  or OAuth endpoint uses (`manifest.unused_origin`).
- A path or query parameter may be of type `file`: one file name with one
  of the declared extensions (`<hash>.jpg`), for image hosts.
- `admit` lists the account first in the review (kind `account`): how it
  connects, its origins, the key page or the OAuth client, sign-in pages
  and scopes, whether it is required, and the routes that name it; an
  integrated service shows with its scopes. Each path and query parameter
  shows with its constraint, and an item of an unknown kind shows as
  `other` instead of being skipped.
- The permission key `account:<id>` (`account:steam` for a service) holds
  the whole declaration: adding it, changing the declaration or giving a
  route an account needs a full review.
- `admit` adds review hints, warnings that refuse nothing, each with a JSON
  pointer to its permission in `manifest.json`: `review.oauth_pages`,
  `review.read_scope_writes`, `review.secret_route` (its review item gets
  `secretHint`), `review.service_key_format`,
  `review.service_name_in_host`, `review.service_name_in_id`,
  `review.service_label_name`, `review.address_in_key_page`,
  `review.same_route` and `review.path_and_query_name`.
- `admit --deny-warnings` never refuses `review.oauth_pages`, a step of the
  review for every OAuth account: it is still reported and counted, and
  every other warning still refuses.
- `test`: a scenario sets the state of each account in `host.accounts`,
  grants `account:<id>`, and an HTTP fixture answers only a request sent
  with the account it names (`request.account`).

## 1.0.0-beta.6

Released in the creator tools ZIPs of PlayerVox OverCrow 0.7.3-beta.1's
GitHub release, `overcrow-creator-tools-0.7.3-beta.1-<platform>.zip`,
beside the headless runtime it pins.

- It pins the headless runtime 0.7.3-beta.1, from the same release.
- `package`, `test` and the update of reference images write each output
  through a temporary file with a random name, and refuse an output folder
  or file that is a link.
- `submit` explains a publish key paused because the member who created it
  is suspended (`publish_key_owner_suspended`).

## 1.0.0-beta.5

Released in the creator tools ZIPs of PlayerVox OverCrow 0.7.2-beta.1's
GitHub release, `overcrow-creator-tools-0.7.2-beta.1-<platform>.zip`,
beside the headless runtime it pins.

- It pins the headless runtime 0.7.2-beta.1, from the same release.
  Since 1.0.0-beta.4, its messages also name the product PlayerVox
  OverCrow; nothing else changes.

## 1.0.0-beta.4

Released in the creator tools ZIPs of OverCrow 0.7.1-beta.1's GitHub
release, `overcrow-creator-tools-0.7.1-beta.1-<platform>.zip`, beside the
headless runtime it pins.

- It pins the headless runtime 0.7.1-beta.1, from the same release.
  Nothing else changes since 1.0.0-beta.3.

## 1.0.0-beta.3

Released in the creator tools ZIPs of OverCrow 0.7.0-beta.1's GitHub
release, `overcrow-creator-tools-0.7.0-beta.1-<platform>.zip`, beside the
headless runtime it pins.

- It pins the headless runtime 0.7.0-beta.1, from the same release.
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
- `submit` sends nothing for a version the creator space already has with
  the same sources, or the same package once admitted: the run ends on that
  version's state (`outcome` `already_known`, field `known`; status 0, 3 or
  1 by state; a version still being checked is followed). The same number
  with another package is refused (`submit.version_known_differs`). A CI job
  may thus run `submit` on every push.
- `submit` and `status` name their widget in every request (header
  `Overcrow-Widget`): `submit` the id of the sources' `manifest.json`,
  `status` the one given with `--widget ID`, needed for a key that covers
  several widgets. The JSON `key` lists the widgets it covers.
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
- The creator space is at `creators.playervox.com`: `submit` names it
  when the API gives no link to the version.
- A widget name or menu label that holds an invisible or text-direction
  character (U+202E, U+200B, U+00AD…) is refused, by `init --name` too;
  the message names the field, the character and its position.
- A source folder with a file or folder name that holds `\ : * ? " < >
  |` is refused (`sources.unsafe_name`), as the creator space refuses it:
  such names do not work on Windows. The message names the character and
  the file, for an archive too. Names left out (hidden files,
  `node_modules/`, reserved names such as `CON`) stay left out.

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
