# Testing

How this repository is tested. Testing a widget of your own is described in
[testing a widget](widget-testing.md). Website rendering and browser tests
belong to the separate web repository.

## Widget contract

Run the widget schema checks; the tests fail if the committed reference or a
generated conformance fixture is stale:

```sh
cargo test -p overcrow-widget-schema --locked
cargo run -p overcrow-widget-schema --example fixtures
cargo run --release -p overcrow-widget-schema --example package_bench
```

The last command measures package revalidation; results are in
[package format measurements](testing/package-format.md).

Run the source format checks; the tests fail if a committed compiled view or
expression table under `fixtures/ocml/compiled/` is stale:

```sh
cargo test -p overcrow-widget-format --locked
cargo run -p overcrow-widget-format --example fixtures
```

## Fuzzing

The fuzz targets cover every parser and package verifier of the widget
contract: `ocml`, `ocss`, `expression`, `validate_manifest`, `read_package`,
`validate_compiled_view` and `open_envelope`. They need a nightly toolchain
and `cargo-fuzz` 0.13.2; the `fuzz` workflow runs each for 60 seconds on
pull requests and pushes to `main`, and 45 minutes weekly. Seed the corpus
from the conformance fixtures, then run a target, from the repository root:

```sh
sh fuzz/seed-corpus.sh
ASAN_OPTIONS=quarantine_size_mb=16:malloc_context_size=0 \
  cargo +nightly fuzz run -O ocml -- -max_total_time=600 \
  -rss_limit_mb=2048 -malloc_limit_mb=64 -max_len=16384
```

Without the `ASAN_OPTIONS` above, ASan keeps every allocation stack and a
long run outgrows the RSS limit with an `oom` artifact that replays cleanly.
A crash leaves its input under `fuzz/artifacts/<target>/`; fix it with a
regression test in the crate's test suite before rerunning. Besides "no
panic", the targets check that an accepted view is accepted by the host's
compiled-view validator and recompiles identically, that the canonical
JavaScript of an expression parses back to the same tree, that an accepted
manifest revalidates from its own value, and that `write_package` reproduces
any accepted archive byte for byte.

## SDK, CLI and reference widgets

The `sdk-cli` workflow builds and tests the CLI, type-checks, builds and
tests the SDK, requires a reproducible npm package and `.ocpkg`, and checks,
packages and unit-tests the reference widgets of `widgets/`; see the
[SDK README](../sdk/README.md) and the [CLI guide](cli.md):

```sh
cargo test -p overcrow-widget-cli --all-targets --locked
(cd sdk && npm ci --ignore-scripts && npm run typecheck && npm run build && npm test)
node scripts/prepare-widgets.mjs
node --test --test-concurrency=2 widgets/*/tests/*.test.mjs
```

## Creator documentation

The creator documentation (`docs/content/`) is checked by the `sdk-cli`
workflow, after the CLI and the SDK are built: its generated tables are
current, both languages have the same code blocks, each code block is an
excerpt of a project that the CLI checks, packages and admits, and each
`overcrow-widget` command it shows exists. The `policy` workflow checks the
links of every Markdown file:

```sh
node scripts/build-docs-content.mjs --check
node --test --test-concurrency=2 tests/docs-content.test.mjs tests/check-links.test.mjs
node scripts/check-links.mjs
```

See the [documentation content README](content/README.md).

## Admission

Run the admission checks: the CLI's `admit` tests, the marketplace CI driver
end to end on a throwaway clone (it builds the admission tool once into a
private cache; set `TMPDIR` to a large disk), and the local driver mode, which
admits every v1 widget of `widgets/`:

```sh
cargo test -p overcrow-widget-cli --test admit --locked
tests/ci-admission-smoke.sh
sh scripts/ci-verify.sh
```

`admit` requires MIT for PlayerVox widgets (`com.playervox.*` IDs) and a
`LICENSE` inside every package.

The admission smoke uses real temporary Git revisions. It proves that an
undeclared file present only in the proposed revision is rejected, that a
proposal changing a trusted path (the widget schema crate, the CLI, the CI
drivers) is rejected by the trusted-path policy, that a valid proposal emits
a version 3 receipt bound to its revision, tree, identity, version, and the
SHA-256 and byte length of its package, listing and admission report, and
that tests from an exact trusted push cannot be silently skipped.
Pull-request admission never executes proposed JavaScript or build scripts;
it validates and packages those bytes with the tool compiled from the
target-base commit. Push admission runs the now-trusted revision's checks
once. The Ubuntu CI runner installs the distribution's Node package before
these checks: the runner's preinstalled Node lives under a writable
directory and is intentionally rejected by the system-Node resolver.

## Repository policy

The `policy` workflow runs the secret scanner and its regression smoke:

```sh
sh scripts/check-policy.sh
sh tests/check-policy-smoke.sh
```

Catalog preparation, signing and publication are maintainer operations
outside this repository; their tests are not run here.
