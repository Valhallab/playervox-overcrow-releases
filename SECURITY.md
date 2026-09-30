# Security Policy

## Reporting a vulnerability

Do not open a public issue or publish a proof-of-concept exploit for an
unresolved vulnerability. Use
[GitHub Private Vulnerability Reporting](https://github.com/Valhallab/playervox-overcrow-releases/security/advisories/new)
to contact Valhallab SASU privately and identify this marketplace as the
affected project. Include the affected revision, impact, environment, and the
smallest safe reproduction. Never include user data, credentials, production
keys, or extension private storage.

Coordinated disclosure is appreciated. The project does not currently offer a
bug bounty or guarantee a response deadline.

## Submission and publication boundary

Community pull requests run in CI with split, minimal permissions. The
verification job has only `contents: read`; its automatic `GITHUB_TOKEN` is not
persisted by checkout. Two separate jobs have no checkout or content access and
receive only `statuses: write` to report the base-specific admission context on
the exact reviewed pull-request head. No repository or organization secret,
signing key, deployment credential, production sequence state, or other
publication authority is passed to a job step. Creators never receive signing
authority. Automation is evidence for a separate human review, and acceptance
into `candidate` does not publish a package. Production signing and promotion
remain offline maintainer operations against an exact reviewed revision.

The hosted `pull_request_target` job definition comes from the default branch,
not from the proposed revision. It fetches the exact pull-request head through
the fixed public repository URL as a Git object, verifies its expected digest,
and prepares its validator and drivers from the exact target-base commit. A
base-built planner compares every materialized regular file with the proposed
Git tree's mode, size, object ID, and portable path, so archive attributes
cannot omit or rewrite proposed bytes. The proposed tree is treated only as
data and is never selected as the Actions checkout or a shell-script source.

Admission builds `overcrow-widget` offline from the reviewed base and runs
`overcrow-widget admit` on every widget directory of the proposed tree: the
package pipeline and the host's own package reader, the reproducible compiled
view, the schema bounds, the reserved `com.playervox.*` IDs, the listing, the
license and a review list of the requested authority. A machine-readable
receipt (version 3) binds the trust revision, proposed revision, proposed
tree, source directory, publisher, widget identity, version, and the SHA-256
and byte length of the package, listing and admission report. No proposed
JavaScript, TypeScript, build command, test, Cargo manifest, or shell script
is executed by `pull_request_target`. Push CI executes the exact now-trusted
revision's checks once; only that trusted-push mode may write admission
bundles to an explicit private output for the maintainers. Publication copies
admitted bytes without rebuilding or retesting them.

The deterministic development key in `fixtures/keys` is intentionally public
and grants no production trust; release builds of OverCrow refuse it. No
production private key, sequence state, deployment credential, or signing
path exists in this repository: the catalog is signed offline.

The marketplace website cannot install software. OverCrow installs widgets
from the signed catalog and validates every package in full before it runs,
with the user's consent to its permissions. A development package
(`overcrow-widget dev`) is accepted only by a debug build or by an OverCrow
started with development installs allowed; it runs marked as unverified, with
its declared permissions for that session only, and nothing of it persists.

The website and its isolated Studio are maintained separately. Report website or
SDK vulnerabilities through this repository's private vulnerability reporting
entry point, identifying the affected component. Never include widget drafts,
account data, signing keys, or credentials in a report.

Widgets run in a sandboxed VM process per widget, with no direct access to
files, the network, other widgets or the game. Their permissions and
capabilities are declared in the manifest, granted only with the user's
consent and checked by OverCrow at each call; a sensitive capability
excludes network and clipboard writes and keeps storage for the process
lifetime only. The creator documentation describes the model:
[security](docs/content/en/security.md).

If a listed package is suspected of compromise, maintainers may publish a
signed suspension or revocation in a newer monotonic catalog. Clients must
reject that package for new installation or update, immediately disable an
installed copy, and offer its removal. An absent or stale catalog never invents
a revocation. A catalog signature never bypasses package validation, user
consent, or runtime sandboxing. Key recovery, loss and compromise follow the
maintainers' private catalog procedure; a compromised catalog key is removed
from OverCrow's trust anchors by an application update.
