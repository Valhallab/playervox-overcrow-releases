# Identifier vectors

Hand-written cases of the publisher handle, publisher domain and widget ID
ownership rules of `overcrow-widget-schema` (`src/identifiers.rs`, documented
in [`docs/widget-catalog-v2.md`](../../../../docs/widget-catalog-v2.md)). The
crate's `tests/catalog_v2.rs` replays every case; other implementations (the
creator portal, the catalog tooling) replay the same files.

Each file is one JSON object; every string is compared exactly.

## `handles.json`

`cases`: `{ "handle", "registration", "catalog" }`.

- `registration`: the result of `validate_handle`, what a new publisher may
  register: `ok`, or `length`, `characters`, `hyphen`, `domain_extension`,
  `reserved`, checked in that order. `reserved` covers any handle whose
  skeleton equals the skeleton of a listed handle or contains `playervox`,
  `overcrow` or `valhallab`. The skeleton removes hyphens, replaces `vv`
  with `w`, then maps `0`→`o`, `1` and `i`→`l`, `3`→`e`, `4`→`a`, `5`→`s`,
  `7`→`t`, `8`→`b`; listed handles and words are folded the same way.
- `catalog`: the result of `handle_syntax`, the grammar a catalog reader
  checks; reserved names and domain extensions pass it.

## `domains.json`

- `cases`: `{ "domain", "handle", "expected" }`, the result of
  `validate_domain(domain, handle)`: `ok`, `syntax` or `reserved`
  (`playervox.com` and its subdomains for a publisher other than
  `playervox`).
- `overlaps`: `{ "a", "b", "overlap" }`, the result of `domains_overlap`:
  equal domains, or one a subdomain of the other. Two publishers never hold
  overlapping domains.

## `names.json`

`cases`: `{ "name", "handle", "expected" }`, the result of
`validate_publisher_name(name, handle)`, what the portal accepts as a
displayed publisher name: `ok`, `text` (not display text of at most 64
characters on one line), `stylized` (a character of `STYLIZED_LETTERS`:
IPA and modifier letters, Cherokee, small capitals, superscripts and
subscripts, letterlike symbols and number forms, enclosed and mathematical
alphanumerics, the trade mark sign `™` excepted) or `reserved` (for a
publisher other than
`playervox`, the skeleton of the letters and digits the name reads as
contains `playervox`, `overcrow` or `valhallab`). Each character folds to a
lowercase ASCII letter or digit: ASCII as is, fullwidth forms
(U+FF10–U+FF19, U+FF21–U+FF3A, U+FF41–U+FF5A) to their ASCII letter, and the
Latin, Cyrillic and Greek look-alikes of `CONFUSABLE_LETTERS`
(`src/identifiers.rs`, also in the schema reference) to theirs; any other
character is dropped. The skeleton rule of handles then applies. Catalog
readers check display text only.

## `widget-ids.json`

`cases`: `{ "id", "handle", "domains", "expected", "domain"? }`, the result of
`id_owner(id, handle, domains)` for the publisher `handle` owning `domains`:

- `handle`: a two-segment ID `<handle>.<name>`;
- `domain`: an ID of at least three segments under the reverse of a domain of
  the publisher, named by `domain` (the longest match);
- `not_owned` (a domain outside the grammar owns nothing), `reserved`
  (`com.playervox` or `com.playervox.*` for another publisher than
  `playervox`) or `invalid_id` (not a widget ID).
