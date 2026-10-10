# Widget catalog format v2

The catalog v2 lists every widget OverCrow distributes: PlayerVox widgets and
the widgets of other publishers, open or closed source, under any licence.
It adds what the catalog v1 cannot carry: the publisher, a verified domain,
store categories and games, localized release notes, support and privacy
links.

This document is for implementers of a host, of the catalog tooling and of
the creator portal. The field tables and numeric bounds are generated from
the `overcrow-widget-schema` crate (`src/catalog_v2.rs`, `src/identifiers.rs`)
into the [widget schema reference](widget-schema-v1.md#catalog-v2), which wins
over this text if they ever disagree. The package format, the catalog v1 and
the offline seed are in [`widget-package-v1.md`](widget-package-v1.md).

## Beside the catalog v1

Released applications refuse a whole catalog v1 as soon as an entry has a
field they do not know or lacks one they expect, so the catalog v1 can never
change. Both catalogs are therefore published:

| | Catalog v1 | Catalog v2 |
| --- | --- | --- |
| Read by | applications released before v2 | applications that read v2, which read only v2 |
| Lists | PlayerVox widgets | every widget, PlayerVox widgets included |
| Format | frozen | this document |
| Signature domain | `OverCrow widget catalog v1\0` | `OverCrow widget catalog v2\0` |
| Keys | `overcrow-widgets-YYYY-NN` | the same keys |
| Anti-rollback sequence | its own | its own, from 1 |
| Lifetime | at most `MAX_CATALOG_LIFETIME_DAYS` | the same |

`\0` is one NUL byte. The offline seed shipped with an application keeps the
v1 seed format: it holds only PlayerVox built-ins, which v1 describes fully.

## Location

| Object | URL |
| --- | --- |
| Catalog | `https://overcrow.playervox.com/marketplace/widgets/v2/catalog.json` |
| Package | `<base>packages/<id>/<version>/<sha256>.ocpkg` |
| Preview | `<base>previews/<id>/<sha256>.png` |

`<base>` is `https://overcrow.playervox.com/marketplace/widgets/v2/`; a
development host uses `http://127.0.0.1:8787/marketplace/widgets/v2/`, which
production hosts refuse. Package and preview URLs are exact: a reader
derives them from the base, the ID, the version and the digest, and refuses
any other. Packages and previews are immutable; a PlayerVox package listed by
both catalogs is stored under both bases.

## Envelope and signature

```json
{"formatVersion":2,"keyId":"overcrow-widgets-2026-01","payload":"<base64url>","signature":"<base64url>"}
```

The envelope has exactly these four fields. `payload` and `signature` are
canonical unpadded Base64url; the signature is Ed25519 over
`OverCrow widget catalog v2`, one NUL byte, then the decoded payload. A host:

1. bounds the envelope to `MAX_CATALOG_V2_BYTES`, parses it strictly and
   requires `formatVersion` 2; a catalog v1 envelope fails here, and a v1
   reader refuses a v2 envelope the same way;
2. looks up `keyId` among the keys it trusts for the catalog v1; a production
   host trusts only `overcrow-widgets-YYYY-NN` IDs;
3. verifies the signature over the v2 domain string and the payload, so no
   catalog v1 or seed signature verifies as v2;
4. validates the payload (below), at most `MAX_CATALOG_V2_PAYLOAD_BYTES`;
5. accepts the sequence in its durable v2 store, apart from the v1 store: a
   lower sequence is a rollback, the same sequence with another payload is a
   conflict.

Parsing is strict everywhere: a byte-order mark, a duplicate key or trailing
data rejects the document, because two parsers must never read signed bytes
differently.

## Payload

```json
{
  "formatVersion": 2,
  "sequence": 1,
  "generatedAt": "2026-11-02T10:00:00Z",
  "expiresAt": "2027-01-31T10:00:00Z",
  "categories": [{ "id": "game-tools", "labels": { "en": "Game tools", "fr": "Outils de jeu" } }],
  "publishers": [{ "handle": "raidforge", "name": "Raidforge", "domains": ["raidforge.gg"], "verifiedDomain": "raidforge.gg" }],
  "widgets": [{ "id": "gg.raidforge.timers", "publisher": "raidforge", "listing": {} }],
  "targets": [{ "manifest": {}, "status": "verified", "package": {}, "releaseNotes": { "en": "…" } }]
}
```

`formatVersion` is 2. `sequence`, `generatedAt` and `expiresAt` follow the
catalog v1 rules: canonical UTC timestamps, `expiresAt` after `generatedAt`
and at most `MAX_CATALOG_LIFETIME_DAYS` later in production, `generatedAt`
at most `MAX_CATALOG_CLOCK_SKEW_MS` ahead of the host clock, not expired. The
[shared vectors](#shared-test-vectors) hold complete catalogs.

### Categories

`categories` lists the store categories in display order, unique by ID, each
with a label per locale (`en` required). It always contains `other`, where
the widgets of a removed category go. Readers take the list from each
catalog, so PlayerVox adds a category without a new application. A widget
naming a category absent from the list refuses the catalog. PlayerVox starts
with `game-tools`, `performance`, `communication`, `productivity`, `media`,
`streaming` and `other`.

### Publishers

A publisher has a `handle`, a displayed `name` and, optionally, `domains` and
a `verifiedDomain`:

- `domains` are the domains under which the publisher owns widget IDs; each
  was verified at least once. A domain stays listed after its verification
  lapses, because the IDs already published under it remain the publisher's.
- `verifiedDomain` is the domain verified now, one of `domains`, shown with
  the verified-domain badge. When verification lapses, it disappears and the
  badge with it.
- Handles are unique. No two publishers list equal or nested domains
  (`raidforge.gg` and `eu.raidforge.gg`); one publisher may list nested
  domains of its own. `playervox.com` and its subdomains belong to the
  publisher `playervox` only.
- The producer lists only publishers with at least one listed widget.

### Widget IDs and handles

A widget ID belongs to exactly one publisher:

- an ID of **two** segments, `<handle>.<name>`, belongs to the publisher with
  that handle (`raidforge.timers`);
- an ID of **three segments or more** belongs to the publisher owning the
  domain whose reverse is its prefix (`gg.raidforge.timers` and
  `gg.raidforge.raid.timers` belong to the owner of `raidforge.gg`);
- `com.playervox` and `com.playervox.*` belong only to the publisher
  `playervox` through `playervox.com`. The bare `com.playervox` belongs to
  nobody.

A domain has at least two labels and an ID keeps at least one name segment
after it, so the two forms never overlap. A reader refuses a widget whose ID
does not belong to its publisher.

A handle is 3 to 32 bytes of `[a-z0-9-]`, without a hyphen at either end or
two in a row. Catalog readers check only this grammar. The creator portal
also refuses, at registration, the historic generic domain extensions
(`com`, `net`, `org`…), reserved handles, the example handles of the
documentation (`nova`, `example`, `yourhandle`, `yourname`) and
look-alikes of PlayerVox, OverCrow and Valhallab; the generated reference
lists them, and a policy
that grows never makes an older application refuse a catalog. For the same
reason the portal, not the reader, refuses a displayed publisher name that
reads as PlayerVox, OverCrow or Valhallab (`Player Vox`, `0verCrow`, or
Cyrillic, Greek, fullwidth and accented look-alikes) for any publisher but
`playervox`, and any publisher name written with stylized letters
(mathematical, enclosed, small capitals…). Human review covers the
look-alikes no table lists. A publisher
domain is a lowercase DNS name of at least two labels whose last label is
not numeric, short enough for its reverse plus one name segment to fit a
widget ID.

### Widgets

A widget entry holds what applies to every version of an ID: its
`publisher`, optional `tags`, its `listing` and one optional `preview`. It
changes without a new version. Widget IDs are unique.

- `tags` is a set of the catalog v1 tags. `built-in` (default installation
  with default consent) is accepted only for the publisher `playervox` on a
  `com.playervox.*` ID, and applies to every version.
- `preview` is one PNG image (`image/png`, at most `MAX_PREVIEW_BYTES`) at its
  exact URL.

### Listing

| Field | Rule |
| --- | --- |
| `defaultLocale` | always `en`: the text shown when the player's locale has none |
| `description` | `{ locale: text }`, `en` required, at most `MAX_LISTING_LOCALIZATIONS` locales, each at most `MAX_LISTING_DESCRIPTION_CHARS` characters, line feeds allowed |
| `category` | the ID of a listed category |
| `games` | optional, at most `MAX_LISTING_GAMES` PlayerVox games `{ id, slug, name }`, distinct by ID: `id` keys the game filter, `slug` names the page `https://playervox.com/games/<slug>`, `name` is displayed |
| `spdxLicense` | a simple SPDX expression or exactly `LicenseRef-Proprietary` |
| `support` | exactly one of `{ "url": <link> }` and `{ "email": <address> }` |
| `privacyPolicyUrl` | a link, required when a listed version that is not skipped declares `permissions.network`, an older one included |
| `sourceUrl` | optional link to a public source repository |

The displayed name is the manifest's (`name.en`, `name.fr`); a listing locale
the manifest does not name shows `name.en`.

Locales are `xx` or `xx-YY`. Display text (publisher names, category labels,
game names, descriptions, release notes) is non-empty and counted in Unicode
scalar values, never bytes. It has no white space at either end, no `<` or
`>`, no control character except line feeds where allowed, and none of the
invisible or blank characters the generated reference lists (bidirectional
controls, zero-width characters, line and paragraph separators, Hangul and
braille fillers, tag characters…), so a name cannot be reversed, blanked or
carry hidden text. A variation selector (U+FE00 to U+FE0F) only follows a
character that is not one, as an emoji's presentation selector does.

A link is `https://`, a lowercase DNS host without port or user information,
a path (`/` at least; segments of `[A-Za-z0-9._~-]` and `%XX` with uppercase
hexadecimal digits; a final slash allowed; no empty, `.` or `..` segment), an
optional non-empty query of `[A-Za-z0-9._~=&+-]` and `%XX`, no fragment, at
most `MAX_CATALOG_URL_BYTES`. `%XX` never encodes an unreserved character
(written plain in the canonical form, so `%2E%2E` cannot hide `..`), `/`,
`\` or a control character. A support address is `local@domain`: the local
part of `[A-Za-z0-9._+-]` without a dot at either end or two in a row, the
domain a lowercase DNS name, at most `MAX_SUPPORT_EMAIL_BYTES`.

`spdxLicense` is checked by grammar only: short identifiers
`[A-Za-z0-9][A-Za-z0-9.-]*` with an optional final `+`, the operators `AND`,
`OR` and `WITH` (an exception after one identifier), parentheses, single
spaces between words and none inside parentheses (`MIT OR Apache-2.0`,
`(MIT OR Apache-2.0) AND CC-BY-4.0`,
`GPL-3.0-or-later WITH Classpath-exception-2.0`). `LicenseRef-Proprietary`
(closed source, all rights reserved) stands alone; no other `LicenseRef-`,
`DocumentRef-` or `AdditionRef-` is accepted, in any case. Applications never check identifiers against the
SPDX list, which grows every quarter: an older application would refuse a
whole catalog for a new identifier. The catalog producer checks them.

### Targets

A target is one package version: the manifest object, validated strictly as
a manifest v1 and naming a listed widget; a `status` (`verified`,
`security-suspended`, `revoked`, as in v1); the package reference with its
exact v2 URL; and optional `releaseNotes` of that version, with the
`description` rules and at most `MAX_RELEASE_NOTES_CHARS` characters per
locale. Targets are unique by ID and version. A security status stops an
installed copy as in v1.

A widget entry without a retained target (none listed, or all skipped) is
not shown.

## Forward compatibility

The catalog v2 must accept additions without a new application where that is
safe, and refuse what an application cannot safely ignore.

1. **Unknown keys are ignored** in the payload, a category, a publisher, a
   widget, a listing, a game, a support object, a preview, a target and a
   package reference, after strict parsing and within the byte bounds. A
   known key with an invalid value still refuses the catalog. The envelope
   (exactly four fields) and the manifest (hashed into the package and
   compared by equality) stay strict.
2. **Unknown values of a known key are refused**: an unknown status, tag,
   category, support kind or licence form refuses the catalog.
3. **A producer adds an optional key only if a reader that ignores it stays
   safe and correct**: display information, or information that only
   restricts, never grants. A key whose omission by an older reader would
   install, show or grant something it should not goes through `requires`,
   or into a new format.
4. **`requires`** (on a widget and on a target) names features a reader must
   support to use the entry. Unless `requires` is a list of features the
   reader supports (an empty list requires nothing), the reader skips the
   entry instead of refusing the catalog, a malformed `requires` included:
   for a widget it reads only the `id` and `requires`, and skips the widget
   with its targets, which it recognizes by their manifest's top-level `id`
   without validating the manifest; for a target it reads only `requires`. A
   skipped entry is never shown, installed or updated. Catalog v2 defines no
   feature name, so a v2 reader skips any entry with a non-empty `requires`.
   Producers name features `[a-z][a-z0-9-]*`. A producer puts `requires` on
   a widget only if no reader could have installed one of its versions;
   otherwise on the new targets only, so that older versions stay listed and
   can still be revoked. Every future manifest keeps its `id` as a top-level
   string; a target whose manifest would not carries its own `requires`.
5. Anything else is a new format version, at a new path, with a new domain
   string.

## Limits

| Limit | Value |
| --- | --- |
| `MAX_CATALOG_V2_BYTES` | 4 MiB |
| `MAX_CATALOG_V2_PAYLOAD_BYTES` | 3000 KiB |
| `MAX_CATALOG_V2_TARGETS` | 2000 |
| `MAX_CATALOG_V2_WIDGETS` | 1000 |
| `MAX_CATALOG_PUBLISHERS` | 1000 |
| `MAX_CATALOG_CATEGORIES` | 32 |
| `MAX_PUBLISHER_DOMAINS` | 8 |
| `MAX_LISTING_LOCALIZATIONS` | 16 |
| `MAX_LISTING_GAMES` | 5 |
| Publisher name, description, release notes, game name, category label | 64, 500, 500, 100, 32 characters |

An application in the field never changes its bounds, so they leave room for
the whole catalog. The [widget schema reference](widget-schema-v1.md#limits)
lists every bound.

## Shared test vectors

The crate holds the vectors that every implementation replays:

- [`crates/overcrow-widget-schema/fixtures/catalog-v2/`](../crates/overcrow-widget-schema/fixtures/catalog-v2/README.md):
  signed valid and invalid catalogs (an invalid one is named after its exact
  refusal code), and the listing field rules in `fields.json`;
- [`crates/overcrow-widget-schema/fixtures/identifiers/`](../crates/overcrow-widget-schema/fixtures/identifiers/README.md):
  handles, publisher domains and widget ID ownership.

The catalogs are signed with the public conformance key
`overcrow-widgets-conformance`, which no host trusts. Regenerate them after a
format change:

```sh
cargo run -p overcrow-widget-schema --example fixtures
```
