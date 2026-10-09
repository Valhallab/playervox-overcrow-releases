# Review policy

Reviewers admit widget API v1 source directories. Web API widgets are no
longer admitted: any directory of `widgets/` that is not a v1 source
project fails admission.

## Static admission (CI)

The `marketplace-ci` workflow runs on pull requests to `main` and
`candidate` (`pull_request_target`) and on pushes to them:

- the admission tool, `overcrow-widget`, is built offline from the reviewed
  base revision, never from the proposed one;
- the proposed tree is fetched as a Git object and materialized as data; a
  base-built plan compares every file with the tree (mode, size, object ID,
  portable path), so archive attributes cannot hide or rewrite bytes;
- a pull request may not change the admission's own implementation:
  `.github/`, `scripts/`, `tests/`, `cli/`, `sdk/`, `mcp/`, `crates/`,
  `fuzz/`, the Cargo workspace and toolchain files, `.gitattributes`,
  `.gitignore`, `docs/widget-schema-v1.md`, `keys/` and `fixtures/keys/`;
  `candidate` may not change `published/`;
- each `widgets/<dir>` goes through `overcrow-widget admit` (see
  [publishing and review](content/en/publishing.md#admission-run-it-yourself)),
  with warnings denied. Proposed JavaScript,
  TypeScript, build commands, tests and scripts are never executed;
- reserved `com.playervox.*` IDs are admitted only on a trusted push, on a
  pull request from this repository itself, or in a directory a fork's pull
  request leaves unchanged;
- the receipt (version 3) binds the trusted and proposed commits and the
  proposed tree to each widget's directory, publisher, ID, version, and the
  SHA-256 and size of its package, listing and admission report.

A trusted push also runs the repository's checks, then may write the
admission bundles for the maintainers. Nothing in CI signs or publishes.

## Human review and security decisions

What reviewers check (identity, reproducibility, authority, listing,
license) and the version statuses of the catalog (`verified`,
`security-suspended`, `revoked`) are described in
[publishing and review](content/en/publishing.md#review), the page creators
read. A catalog signature never bypasses package validation, the user's
consent or the widget sandbox.
