# Review policy

Reviewers admit widget API v1 source directories. Web API widgets are no
longer admitted: `widgets/warframe-market` is kept as a legacy Web widget,
recorded but never admitted to the v1 catalog.

## Static admission (CI)

The `marketplace-ci` workflow runs on pull requests to `main` and
`candidate` (`pull_request_target`) and on pushes to them:

- the admission tool, `overcrow-widget`, is built offline from the reviewed
  base revision, never from the proposed one;
- the proposed tree is fetched as a Git object and materialized as data; a
  base-built plan compares every file with the tree (mode, size, object ID,
  portable path), so archive attributes cannot hide or rewrite bytes;
- a pull request may not change the admission's own implementation:
  `.github/`, `scripts/`, `tests/`, `cli/`, `sdk/`, `crates/`,
  `fuzz/`, the Cargo workspace and toolchain files, `.gitattributes`,
  `.gitignore`, `docs/widget-schema-v1.md`, `keys/` and `fixtures/keys/`;
  `candidate` may not change `published/`;
- each `widgets/<dir>` goes through `overcrow-widget admit` (see
  [publishing](publishing.md)), with warnings denied. Proposed JavaScript,
  TypeScript, build commands, tests and scripts are never executed;
- reserved `com.playervox.*` IDs are admitted only on a trusted push, on a
  pull request from this repository itself, or in a directory a fork's pull
  request leaves unchanged;
- the receipt (version 3) binds the trusted and proposed commits and the
  proposed tree to each widget's directory, publisher, ID, version, and the
  SHA-256 and size of its package, listing and admission report.

A trusted push also runs the repository's checks, then may write the
admission bundles for the maintainers. Nothing in CI signs or publishes.

## What reviewers check

- **Identity.** A new ID under a domain the author controls; never
  `com.playervox.*` for a third party. A new version for any change:
  published versions are immutable, and a lower version than a listed one is
  refused.
- **Reproducibility.** The package is rebuilt from the reviewed sources;
  a submitted archive's `view.json` must be what `view.ocml` compiles to.
- **Authority.** Read the admission report's review list:
  - capabilities, and above all the sensitive ones (marked in the report):
    a sensitive capability excludes network and clipboard writes, and its
    storage lasts the VM process only;
  - every network route (method, origin, path, parameter constraints): each
    must serve the widget's stated purpose; OverCrow's broker enforces them
    exactly, over HTTPS, without redirects or credentials;
  - clipboard writes, storage and game events.
- **Listing.** Exact, plain text in every locale; a canonical source URL;
  a preview that shows the widget.
- **License.** The `LICENSE` file matches `spdxLicense`, and every bundled
  asset, font or third-party code keeps its notice. PlayerVox widgets use
  MIT. The policy for third-party creators' licenses is not decided: do not
  infer an MIT requirement from this repository's own license
  ([licensing](../LICENSING.md)).

## Security decisions

A listed version suspected of compromise is suspended (`security-suspended`,
reversible) or revoked (`revoked`, permanent) in a newer signed catalog.
OverCrow then refuses it for installation and update and stops an installed
copy. Omitting a version from a catalog never changes its status. A catalog
signature never bypasses package validation, the user's consent or the
widget sandbox.
