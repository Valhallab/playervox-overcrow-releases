# Review policy

Reviewers admit widget API v1 source directories. Web API widgets are no
longer admitted: any directory of `widgets/` that is not a v1 source
project fails admission.

## Static admission (CI)

Widgets are no longer proposed by pull request: creators submit them in the
PlayerVox OverCrow creator space, and PlayerVox's own widgets are sent there by
the `overcrow-submit` workflow after each merge. The `marketplace-ci` workflow
stays the static admission of `main`; it runs on pull requests to `main`
(`pull_request_target`) and on pushes to it:

- the admission tool, `overcrow-widget`, is built offline from the reviewed
  base revision, never from the proposed one;
- the proposed tree is fetched as a Git object and materialized as data; a
  base-built plan compares every file with the tree (mode, size, object ID,
  portable path), so archive attributes cannot hide or rewrite bytes;
- a pull request may not change the admission's own implementation:
  `.github/`, `scripts/`, `tests/`, `cli/`, `sdk/`, `mcp/`, `crates/`,
  `fuzz/`, the Cargo workspace and toolchain files, `.gitattributes`,
  `.gitignore`, `docs/widget-schema-v1.md`, `keys/` and `fixtures/keys/`;
- each `widgets/<dir>` goes through `overcrow-widget admit` (see
  [checks and the catalog](content/en/publishing.md#run-the-checks-yourself)),
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

The review creators go through is described in
[review](content/en/widget-review.md), and the version statuses of the
catalog (`verified`, `security-suspended`, `revoked`) in [checks and the
catalog](content/en/publishing.md#version-statuses), the pages creators
read. A catalog signature never bypasses package validation, the user's
consent or the widget sandbox.
