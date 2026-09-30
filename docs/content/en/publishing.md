# Publishing and review

Widgets reach OverCrow users through the signed widget catalog v1
(`https://overcrow.playervox.com/marketplace/widgets/v1/catalog.json`). This
page goes from a widget source directory to a listed version. Neither a
pull request nor a merge publishes anything: publication is a separate,
offline step of the maintainers.

## The submission

A submission is a widget source directory under `widgets/<dir>/` of this
repository, in a pull request to the `candidate` branch:

```text
widgets/<dir>/
  manifest.json   view.ocml   style.ocss?   logic.ts | logic.js
  locales/en.json + locales/fr.json?   assets/**?   LICENSE
  listing.json    (marketplace text, never packaged)
```

Package IDs under `com.playervox` are reserved for widgets published by
PlayerVox. Use a reverse-DNS ID under a domain you control, and keep it:
the ID is the widget's identity in the catalog.

## The listing

`listing.json` holds what the marketplace shows:

<!-- source: docs/content/examples/weather/listing.json -->
```json
{
  "author": "Example Studio",
  "spdxLicense": "MIT",
  "sourceUrl": "https://github.com/example/weather-widget",
  "defaultLocale": "en",
  "localizations": [
    { "locale": "en", "name": "Weather", "description": "The temperature of a city, refreshed every 30 minutes." },
    { "locale": "fr", "name": "Météo", "description": "La température d’une ville, actualisée toutes les 30 minutes." }
  ]
}
```

- `author`, names and descriptions are plain, trimmed text without `<` or
  `>`; locales are `xx` or `xx-YY`, one of them `defaultLocale`.
- `spdxLicense` is an SPDX expression; the package's `LICENSE` holds its
  text. PlayerVox widgets use MIT. The policy for third-party licenses is
  not decided yet: a valid expression is reviewed, not approved by the
  metadata ([licensing](../../../LICENSING.md)).
- `sourceUrl` is a canonical HTTPS URL of the reviewed source, without
  port, query or fragment.
- `preview` (optional) names a PNG packaged under `assets/`, at most
  256 KiB, for example `"preview": "assets/preview.png"`.

The exact rules are the Listing rules of the
[schema reference](../../widget-schema-v1.md#listing).

## Admission: run it yourself

```sh
overcrow-widget admit widgets/<dir>
overcrow-widget admit widgets/<dir> --package dist/<id>-<version>.ocpkg
overcrow-widget admit widgets/<dir> --format json
```

`admit` is exactly the static admission of the marketplace CI. It never runs
your code or `tsc`:

1. it builds the directory with the `package` pipeline: every source, style,
   logic and package check, then OverCrow's own package reader;
2. with `--package`, your archive's `view.json` must be byte for byte what
   `view.ocml` compiles to (the catalog always ships the rebuild from the
   reviewed sources);
3. it checks the schema bounds, the reserved IDs, `listing.json`, the
   preview and, for PlayerVox widgets, the MIT license;
4. it lists the authority the widget requests for the reviewer: sensitive
   capabilities, every network route, clipboard writes, storage and game
   events.

The report ends with status 1 when the submission would be refused. The
codes are listed with the [`admit` command](../../cli.md#admit-dir). On a
pull request, the CI builds `overcrow-widget` from the reviewed base branch,
never from your revision, and runs the same admission on your files as data;
see the [review policy](../../review-policy.md).

## Review

A maintainer reads the admission report and the source, then merges into
`candidate`. Reviewers check:

- **Identity.** A new ID under a domain the author controls. A new version
  for any change: published versions are immutable, and a version lower
  than a listed one is refused.
- **Reproducibility.** The package is rebuilt from the reviewed sources.
- **Authority.** Every capability, above all the sensitive ones; every
  network route, which must serve the widget's stated purpose; clipboard
  writes, storage and game events. See [security](security.md).
- **Listing.** Exact, plain text in every locale; a canonical source URL; a
  preview that shows the widget.
- **License.** `LICENSE` matches `spdxLicense`, and every bundled asset,
  font or third-party code keeps its notice.

On the merge, CI admits the exact revision again and records a receipt that
binds the admitted package to the reviewed commit. Accepting a submission
signs and publishes nothing.

## The catalog

The maintainers prepare the next catalog from admitted revisions and sign it
offline with the catalog key, whose public half is in
[`keys/`](../../../keys/). The catalog:

- lists each version at
  `…/widgets/v1/packages/<id>/<version>/<sha256>.ocpkg`, with its preview at
  `…/widgets/v1/previews/<id>/<version>/<sha256>.png`; a published version
  never changes, and a change is a new version;
- carries a strictly increasing sequence and expires after at most 90 days:
  OverCrow refuses an older sequence and an expired catalog;
- tags PlayerVox reference widgets `built-in` (only `com.playervox.*` IDs):
  they are installed on a new profile with their declared permissions
  granted, except for an update that asks for more.

OverCrow verifies the signature, the package digest, its file ledger and its
compiled view before installing, and again each time it starts the widget.
The format is specified in [package and catalog format](../../widget-package-v1.md).

## Version statuses

Each listed version has a status:

| Status | Meaning |
| --- | --- |
| `verified` | Installable. |
| `security-suspended` | Suspected of compromise; not installed or updated to, and an installed copy is stopped. Reversible in a later catalog. |
| `revoked` | Permanent: never installed again, and an installed copy is stopped. |

Omitting a version from a catalog never changes its status. A catalog
signature never bypasses package validation, the user's consent or the
sandbox.
