# Widget package and catalog format v1

This document specifies how a widget is packaged, signed, listed, shipped
offline and admitted by the host. The decisions and their reasons are
recorded in the OverCrow design record ADR 0005; every field table and
numeric bound is generated from the `overcrow-widget-schema` crate into the
[widget schema reference](widget-schema-v1.md) (sections Manifest, Package and
Catalog), which wins over this text if they ever disagree.

Nothing here is implemented in the host yet: the validators exist in the
schema crate with conformance fixtures, and the host adopts them in P1.8.

## Manifest

`manifest.json` is written by the creator and is one strict JSON object: a
byte-order mark, a duplicate key, trailing data or an unknown field rejects
it. Its fields are in the reference (Manifest). A minimal manifest:

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "com.example.minimal",
  "version": "0.1.0",
  "name": { "en": "Minimal", "fr": "Minimal" },
  "sizing": {
    "fit": "none",
    "preferred": { "width": 200, "height": 100 },
    "min": { "width": 200, "height": 100 },
    "max": { "width": 200, "height": 100 }
  }
}
```

A widget that needs a larger QuickJS heap adds `"vm": { "heapMiB": 32 }`: any
whole number of MiB from 16 (the default) to 48. The VM process ceiling stays
64 MiB, so the extra heap comes out of the same per-widget budget.

A Web API manifest is rejected like any invalid manifest (`api_version`).

## Package `.ocpkg` v1

### Files

| Path | Required | Content |
| --- | --- | --- |
| `manifest.json` | yes | The manifest, as authored. |
| `ledger.json` | yes | SHA-256 and size of every other entry, written by the CLI. |
| `logic.js` | yes | The widget logic and the compiled template expressions; the only executable content. |
| `view.json` | yes | The compiled view. |
| `LICENSE` | yes | License text. |
| `style.ocss` | no | Style sheet source, parsed by the host at activation. |
| `locales/en.json`, `locales/fr.json` | both or neither | Flat `{ "key": "text" }` messages with the same keys. |
| `assets/…` | no | PNG, JPEG or WebP images whose signature matches the extension; lowercase `[a-z0-9_-]` segments. |

Any other entry rejects the package: `view.ocml`, `.html`, `.wasm`, a second
script, native code, hidden files, other locales. Text files are UTF-8
without byte-order mark or NUL.

### Archive layout

The archive is a stored zip in exactly one layout, the one the Web package
writer already produces, so identical files always give identical bytes:

- one local record per file, in increasing byte order of the path, followed
  by the central directory in the same order and the end record;
- PKZIP 2.0 (`version needed` 20, `made by` Unix 2.0), general-purpose flags
  equal to the UTF-8 flag only, method 0 (stored), time 00:00 and date
  1980-01-01, external attributes of a regular file with mode 0644;
- no extra field, file comment, archive comment, data descriptor, ZIP64
  record, directory entry, encryption or prefix data; the CRC-32 of every
  entry is checked;
- at most `MAX_PACKAGE_FILES` entries and `MAX_PACKAGE_BYTES` in total.

### Ledger

`ledger.json` has one exact byte form, without whitespace or trailing newline:

```text
{"ledgerVersion":1,"files":{"LICENSE":{"bytes":1071,"sha256":"…"},"logic.js":{"bytes":325,"sha256":"…"},…}}
```

It lists every entry except itself, in byte order of the path, with the
lowercase hexadecimal SHA-256. The reader recomputes it from the archive and
requires the same bytes. The ledger keeps the authored manifest unchanged
between the source tree, the package and the catalog.

### Compiled view

The CLI compiles `view.ocml` ([source format](widget-source-formats.md)) into
`view.json`, a JSON tree, and compiles each
template expression and event handler into a function of `logic.js`. The tree
refers to these functions by index in a table that `logic.js` registers with
the SDK before the widget code runs (the call is defined by P2.1). For
example, `<box class="clock"><text class="time">{time()}</text></box>`
becomes:

```json
{
  "viewFormat": 1,
  "expressions": 1,
  "children": [
    {
      "element": "box",
      "attrs": { "class": "clock" },
      "children": [
        { "element": "text", "attrs": { "class": "time" }, "text": [{ "expr": 0 }] }
      ]
    }
  ]
}
```

Node kinds are `element`, `if`, `for`, `component` (a use) and `slot`; their
fields are in the reference. At activation the host checks, before starting
the VM: known elements and the parent rules of the scene, known attributes
with static values of the right type, required attributes present statically
or bound, events of the element, expression indices below `expressions`,
components declared once, used with declared props and never recursive, at
most one `slot` per component, the element, children and depth bounds, and
that every static `assets/…` image is in the package. The host then sends the
tree to the VM in `Init` and still validates every scene patch.

### Admission and activation

The host validates a package in this order, and any failure rejects it with
the fixed category `invalid_bundle`:

1. archive size, then the pinned zip layout and CRCs;
2. every path against the file classes and their size limits; required files
   present;
3. the ledger, byte for byte;
4. the manifest, `logic.js`, `style.ocss` (UTF-8 here; its grammar is
   checked right after by `overcrow_widget_format::validate_package_style`,
   see [widget source formats](widget-source-formats.md)), the locale pair,
   `LICENSE`, each asset signature, and the compiled view against the
   package's assets.

For a catalog or seed package, the archive size and SHA-256 must first equal
the signed target, and the package manifest must equal the target's manifest
object. A local (sideloaded) package cannot use a `com.playervox` or
`com.playervox.*` ID. The host keeps the admitted archive immutable and
repeats the whole validation at every activation.

## Catalog

### Signing

The catalog is `https://overcrow.playervox.com/marketplace/widgets/v1/catalog.json`,
a signed envelope:

```json
{"formatVersion":1,"keyId":"overcrow-widgets-2026-01","payload":"<base64url>","signature":"<base64url>"}
```

`payload` and `signature` are canonical unpadded Base64url. The signature is
Ed25519 over the bytes `OverCrow widget catalog v1`, one NUL byte, then the
decoded payload. The host:

1. bounds the envelope, parses it strictly and requires `formatVersion` 1 (a
   Web catalog fails here);
2. looks up `keyId` among its trusted keys, at most `MAX_TRUST_KEYS`; a
   production host trusts only `overcrow-widgets-YYYY-NN` IDs;
3. verifies the signature over the domain string and the payload;
4. validates the payload: `formatVersion` 1, `sequence` ≥ 1, canonical UTC
   timestamps, `expiresAt` after `generatedAt` and at most
   `MAX_CATALOG_LIFETIME_DAYS` later, `generatedAt` at most
   `MAX_CATALOG_CLOCK_SKEW_MS` ahead of the host clock, not expired, and every
   target;
5. accepts the sequence in its durable v1 store: a lower sequence is a
   rollback, the same sequence with another payload is a conflict. The v1
   store is separate from the Web catalog's and starts at 1.

A target holds the manifest object, optional `tags`, a `status`, the immutable
package reference, the listing and an optional preview. Package and preview
URLs are exactly `<base>packages/<id>/<version>/<sha256>.ocpkg` and
`<base>previews/<id>/<version>/<sha256>.png`. Targets are unique by ID and
version.

### Status

`verified` targets may be installed or updated. `security-suspended` and
`revoked` targets may not, and an installed copy of that version is stopped.

### The `built-in` tag

`built-in` is the only tag. It is valid only on `com.playervox` or
`com.playervox.*` IDs and must be carried by every listed version of the ID,
or by none. It is never a manifest field: a manifest with `tags` is invalid.
Its effect is default installation with default consent (ADR 0001, Q2); see
[Built-in lifecycle](#built-in-lifecycle).

### Keys

- Production keys (`overcrow-widgets-YYYY-NN`) are generated offline by the
  release owner in P4.2. Their private halves never enter a repository, a
  release asset, CI or a log. The public keys ship with the application, at
  most `MAX_TRUST_KEYS` at once for rotation.
- `overcrow-widgets-development` signs local development marketplaces
  (`http://127.0.0.1:8787/marketplace/widgets/v1/`) and is refused by
  production hosts.
- `overcrow-widgets-conformance` signs the fixtures. Its private seed is the
  SHA-256 of the public string `OverCrow widget conformance key; never
  trusted`; no host trusts it.

## Offline seed

The application ships a seed so that the built-ins install without network:

```text
widgets-seed/
  seed.json                  signed envelope
  packages/<sha256>.ocpkg    one archive per target, nothing else
```

`seed.json` has the catalog envelope shape and is signed over
`OverCrow widget seed v1`, one NUL byte, then the payload. The payload holds
`formatVersion` 1, `catalogSequence` (the published live catalog it was cut
from), `generatedAt`, `expiresAt` and targets that are all `built-in` and
`verified`, copied from that catalog.

The host uses the seed at startup, before or without network:

1. verify the envelope with the catalog keys and the seed domain;
2. require `generatedAt` ≤ now + `MAX_CATALOG_CLOCK_SKEW_MS`,
   now < `expiresAt`, and a lifetime of at most `MAX_SEED_LIFETIME_DAYS`.
   Otherwise the seed is ignored entirely and the built-ins wait for the live
   catalog;
3. ignore the seed if the host already accepted a live catalog with a
   sequence ≥ `catalogSequence`;
4. otherwise require the directory to hold exactly the listed archives, verify
   each against its target like a download, plan the targets with the
   built-in lifecycle, and raise the rollback floor: from then on a live
   catalog below `catalogSequence` is refused.

Expiry only governs installation from the seed; installed packages keep
running. The release pipeline cuts the seed from a published catalog when it
builds the application (P4.2).

## Built-in lifecycle

For each `built-in` ID, the host takes the highest `verified` version listed
by the live catalog or an applicable seed and compares it with its record:

| Host record | Action |
| --- | --- |
| absent, during the default installation | install with default consent to the declared permissions |
| absent, afterwards | nothing: the widget is offered in the marketplace under the tag |
| removed by the user | nothing |
| installed, same or newer version | nothing (never downgrade) |
| installed, older, permissions not widened | update |
| installed, older, permissions widened | stage; activate after explicit consent |

The default installation runs once per profile, when no v1 widget state
exists yet (a fresh install, or the first launch of the first v1 version), and
its completion is recorded so it never runs again (ADR 0001, D11). A widget
added to the built-in set by a later version is therefore not installed on
existing profiles.

Permissions widen when the new manifest adds a network rule, a game event or
a capability, or turns `storage` or `clipboardWrite` on. Uninstalling a
built-in records "removed by the user" in the host's private transactional
store. Catalog refreshes, new seeds and application updates never clear the
record; installing the widget from the marketplace does, with the same
default consent.

## Conformance fixtures

[`crates/overcrow-widget-schema/fixtures/`](../crates/overcrow-widget-schema/fixtures/)
holds valid and invalid cases; an invalid case is named
`<expected error>--<case>`, and the crate's `tests/package_format.rs` requires
that exact error:

| Directory | Content | Source |
| --- | --- | --- |
| `manifest/` | manifests | hand-written |
| `view/` | compiled views | hand-written |
| `package-src/` | source files of the valid packages | hand-written |
| `package/` | archives | generated |
| `legacy-web/` | payload of a real Web API v1 catalog | hand-kept |
| `catalog/` | signed catalogs, including that Web catalog | generated |
| `seed/` | seed directories | generated |
| `conformance-key.pub` | public conformance key | generated |

Regenerate the generated fixtures after changing the format or the sources:

```sh
cargo run -p overcrow-widget-schema --example fixtures
```

The test regenerates them in memory and fails if a committed file differs, so
the fixtures, the signatures and the deterministic writer stay in step.
