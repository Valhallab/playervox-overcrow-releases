# Public distribution maintenance

This repository owns OverCrow's public SDK, creator kit, examples, reference
widgets, package admission tools, and signed distribution. The web interface is
maintained separately in `Valhallab/playervox-overcrow-web`.

Tooling and documentation changes target `main`. Widget submissions target
`candidate`. Acceptance into `candidate` never publishes a widget. Publication
remains a separately authorized offline operation described in
[production operations](production-operations.md).

Protect `main` and `candidate` against deletion and force pushes. Require pull
requests, human review, and the base-specific admission check. On `main`, require
both portable creator-kit checks as well. Keep owner maintenance bypass available
for reviewed changes to `.github/`, `scripts/`, `tests/`, and `tools/`: static
admission deliberately rejects changes to its own trusted implementation.

CI uses pinned actions, disposable hosted runners, no persisted Git credentials,
and no signing or deployment secrets. Static admission uses the exact reviewed
base; proposed widget code is data and is never executed by admission. The
separate creator-kit workflow runs unprivileged tests on Linux and Windows.

Do not modify desktop GitHub Releases, the `v*` application tags, or
`docs/channels/` while changing creator tooling. SDK and creator-kit versions
must not create GitHub Releases: the desktop updater uses the latest stable
application release. Git tags without release entries do not enter that API.

Public distribution files under `published/marketplace/v1/` are mirrored by the
web repository without changing their bytes or public URLs. A website build does
not sign, revoke, replace, or publish a widget. Keep existing package versions
immutable and preserve all license notices.

The web repository vendors only an explicit allowlist of creator build inputs.
After a public change has merged, its maintainer imports the exact `main` commit,
reviews the file/hash inventory, regenerates the website, and runs integration
checks. There is no automatic deployment or cross-repository write credential.
