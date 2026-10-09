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
  `reserved`, checked in that order.
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

## `widget-ids.json`

`cases`: `{ "id", "handle", "domains", "expected", "domain"? }`, the result of
`id_owner(id, handle, domains)` for the publisher `handle` owning `domains`:

- `handle`: a two-segment ID `<handle>.<name>`;
- `domain`: an ID of at least three segments under the reverse of a domain of
  the publisher, named by `domain` (the longest match);
- `not_owned`, `reserved` (`com.playervox` or `com.playervox.*` for another
  publisher than `playervox`) or `invalid_id` (not a widget ID).
