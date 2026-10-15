# Checks and the catalog

Widgets reach PlayerVox OverCrow users through the signed widget catalog:
OverCrow installs only what that catalog lists. You send a version from the
creator space ([publish a widget](publish-a-widget.md)), it is checked,
a person at PlayerVox reviews it ([review](widget-review.md)), then it is
published in the catalog. This page covers the checks you can run on your
computer, `listing.json`, and the catalog itself.

## Run the checks yourself

```sh
overcrow-widget admit --listing optional
overcrow-widget admit --package dist/<id>-<version>.ocpkg
overcrow-widget admit --format json
```

`admit` runs the static checks of the creator space on your computer. It
never runs your code or `tsc`:

1. it builds the folder as `package` does: every source, style, logic
   and package check, then PlayerVox OverCrow's own package reader;
2. with `--package`, your archive's compiled view must be byte for byte
   what `view.ocml` compiles to;
3. it checks the schema bounds, the reserved IDs, `listing.json`, the
   preview and, for PlayerVox widgets, the MIT license;
4. it lists the authority the widget requests, as the reviewer sees it:
   sensitive capabilities, every network route, clipboard writes, storage
   and game events.

`--listing optional` checks the folder as the creator space does, where
`listing.json` may be absent. The command ends with status 1 when the
version would be refused; its codes are listed with the
[`admit` command](cli.md#admit). To check also what only the creator space
knows (the version number, the justifications, the privacy policy), use
`overcrow-widget submit --dry-run` ([`submit`](cli.md#submit)).

## The listing

Players read the listing in the catalog. You write it in the creator space
([the listing](widget-listing.md)). `listing.json`, in the widget's folder,
is its file form: `admit` reads it, the creator space can import it, and it
is never packaged.

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

<!-- generated:listing-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `author` | text ≤ 128 bytes | yes | Plain text, trimmed, without `<` or `>`. |
| `spdxLicense` | text ≤ 64 bytes | yes | SPDX expression characters `[A-Za-z0-9.+-]`. |
| `sourceUrl` | text ≤ 2 KiB | yes | Canonical HTTPS URL of the reviewed source, without port, query or fragment. |
| `defaultLocale` | `locale` | yes | One of the localizations. |
| `localizations` | list of `Localization` ≤ 16 | yes | `{ locale, name, description }` with distinct `xx` or `xx-YY` locales; name ≤ 128 bytes, description ≤ 512 bytes. |
<!-- /generated:listing-fields -->

- `author`, names and descriptions are plain, trimmed text without `<` or
  `>`; locales are `xx` or `xx-YY`, one of them `defaultLocale`.
- `spdxLicense` is an SPDX expression, or `LicenseRef-Proprietary` for code
  that is not open source; the package's `LICENSE` holds its text. Any
  license is accepted, closed code included. PlayerVox's own widgets use
  MIT.
- `sourceUrl` is a canonical HTTPS URL of your public sources, without
  port, query or fragment. The file needs it; the creator space does not:
  if your code is not public, leave `listing.json` out and write the
  listing on screen.
- `preview` (optional) names a PNG packaged under `assets/`, at most
  256 KiB, for example `"preview": "assets/preview.png"`. The Control
  Center and the marketplace show a preview whole in a 4:3 box, centred on
  the colour `#1e242e`, at 1.5 pixels per screen point at most: render the
  widget at 150 % (`"scale": 1500` in a scenario) and give the image a 4:3
  shape, and it appears at its real size, never cropped or enlarged.

## The catalog

PlayerVox aims to publish an approved version within 24 business hours.
It signs each catalog away from its servers with the catalog key, whose
public half is in [`keys/`](../../../keys/). The catalog:

- lists each version with the SHA-256 and the size of its package; a
  published version never changes, and a change is a new version;
- carries a strictly increasing sequence number and expires after at most
  90 days: PlayerVox OverCrow refuses an older sequence and an expired
  catalog;
- tags PlayerVox reference widgets `built-in` (only `com.playervox.*` IDs):
  they are installed on a new profile with their declared permissions
  granted, except for an update that asks for more.

The package in the catalog is always the one PlayerVox rebuilt from the
reviewed sources. PlayerVox OverCrow verifies the signature, the package
digest, its ledger and its compiled view before installing, and again each
time it starts the widget. See
[the package](package.md#how-overcrow-checks-a-package).

## Updates

A new version of your widget is a new submission with a higher `version`:
a published version is never replaced. An update whose manifest asks for
more than the installed version (a network rule, a game event, a
capability, storage or the clipboard) needs the user's approval in the
Control Center before it runs.

## Version statuses

Each listed version has a status:

| Status | Meaning |
| --- | --- |
| `verified` | Installable. |
| `security-suspended` | Suspected of compromise; not installed or updated to, and an installed copy is stopped. Reversible in a later catalog. |
| `revoked` | Permanent: never installed again, and an installed copy is stopped. |

Omitting a version from a catalog never changes its status. A catalog
signature never bypasses package validation, the user's consent or the
sandbox. A suspension in the creator space is explained in
[review](widget-review.md#suspension).
