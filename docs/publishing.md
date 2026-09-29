# Publishing a widget

Widgets reach OverCrow users through the signed widget catalog v1
(`https://overcrow.playervox.com/marketplace/widgets/v1/catalog.json`). This
page is the path from a widget source directory to a listed version. Neither a
pull request nor a merge publishes anything: publication is a separate,
offline step of the maintainers.

## 1. The submission

A submission is a widget source directory under `widgets/<dir>/` of this
repository, in a pull request to `candidate`:

```text
widgets/<dir>/
  manifest.json   view.ocml   style.ocss?   logic.ts | logic.js
  locales/en.json + locales/fr.json?   assets/**?   LICENSE
  listing.json    (marketplace text, never packaged)
```

`listing.json` holds what the marketplace shows, with the Listing rules of the
catalog ([schema reference](widget-schema-v1.md), Catalog):

```json
{
  "author": "Example Studio",
  "spdxLicense": "MIT",
  "sourceUrl": "https://github.com/example/weather-widget",
  "defaultLocale": "en",
  "localizations": [
    {"locale": "en", "name": "Weather", "description": "Today's forecast."},
    {"locale": "fr", "name": "Météo", "description": "Les prévisions du jour."}
  ],
  "preview": "assets/preview.png"
}
```

- `author`, names and descriptions are plain, trimmed text without `<` or
  `>`; locales are `xx` or `xx-YY`, one of them `defaultLocale`.
- `spdxLicense` is an SPDX expression; the package's `LICENSE` holds its
  text. PlayerVox widgets use MIT. The policy for third-party licenses is
  not decided yet: a valid expression is reviewed, not approved by the
  metadata.
- `sourceUrl` is a canonical HTTPS URL of the reviewed source (no port,
  query or fragment).
- `preview` (optional) names a PNG packaged under `assets/`, at most
  256 KiB.

IDs under `com.playervox` are reserved for widgets published by PlayerVox.

## 2. Admission: what CI checks, and how to run it yourself

```sh
overcrow-widget admit widgets/<dir>
overcrow-widget admit widgets/<dir> --package dist/<id>-<version>.ocpkg
overcrow-widget admit widgets/<dir> --format json
```

`admit` is exactly the static admission of the marketplace CI
([review policy](review-policy.md)). It never runs your code or `tsc`:

1. it builds the directory with the `package` pipeline: every source, style,
   logic and package check, then the host's own package reader;
2. with `--package`, your archive's `view.json` must be byte for byte what
   `view.ocml` compiles to (the catalog always ships the rebuild from the
   reviewed sources; other differences are reported as a warning);
3. the bounds of the schema, a non-reserved ID, `listing.json`, the preview
   and, for PlayerVox widgets, the MIT license;
4. a review list of the authority the widget requests: sensitive
   capabilities, every network route, clipboard writes, storage and game
   events.

The report is readable or JSON (`--format json`); text from the package is
shown with terminal controls neutralized. It ends with 1 when the submission
would be refused. `admit <file.ocpkg> --listing FILE` checks a bare archive
but cannot recompile its view; CI always admits the sources.

## 3. Review and acceptance

A maintainer reviews the admission report and the source, then merges into
`candidate`. On that trusted push, CI admits the exact revision again and
produces the admission bundles (package, listing, report) and a receipt that
binds them to the reviewed commit and tree. Accepting a submission never
changes `published/` and never signs anything.

## 4. Publication

The maintainers ingest admitted revisions into private storage, prepare the
next catalog and sign it offline with the catalog key
(`overcrow-widgets-YYYY-NN`, public key in [`keys/`](../keys/)). The catalog:

- lists each version at
  `…/widgets/v1/packages/<id>/<version>/<sha256>.ocpkg`, with its preview at
  `…/widgets/v1/previews/<id>/<version>/<sha256>.png`; published versions are
  immutable, a change is a new version;
- carries a strictly increasing sequence and expires after at most 90 days;
  OverCrow refuses an older sequence and an expired catalog;
- gives each version a status: `verified`, `security-suspended` or `revoked`
  (permanent). A suspended or revoked version is not installed, and OverCrow
  stops an installed copy;
- tags PlayerVox reference widgets `built-in` (only `com.playervox.*` IDs,
  on every version of the ID): installed by default on a new profile, with
  consent to their declared permissions, except for an update that asks for
  more.

The signature covers the domain string `OverCrow widget catalog v1\0` then the
payload, so no other signed document of OverCrow verifies as a catalog. The
application also ships an offline seed of the built-ins, cut from a published
catalog.

`fixtures/keys/development-ed25519.key` is a deliberately public development
key: it signs local development catalogs only, and release builds of OverCrow
refuse it.
