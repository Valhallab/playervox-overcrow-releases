# Testing

Build portable downloads with `python3 scripts/package-docs-examples.py
published/docs/downloads`, then run `npm test`. Creator-kit tests run on Windows
and Linux; native-host tests use controlled test executables, not the live overlay.
Website rendering and browser isolation tests belong to the separate web repository.

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

Run the admission checks: the CLI's `admit` tests, the marketplace CI driver
end to end on a throwaway clone (it builds the admission tool once into a
private cache; set `TMPDIR` to a large disk), and the local driver mode, which
admits every v1 widget of `widgets/`:

```sh
cargo test -p overcrow-widget-cli --test admit --locked
tests/ci-admission-smoke.sh
sh scripts/ci-verify.sh
node --test tests/warframe-market/market.test.mjs
```

`admit` requires MIT for PlayerVox widgets (`com.playervox.*` IDs) and a
`LICENSE` inside every package.

These prove strict manifest/listing validation, inventory, native executable
rejection, optional browser-WASM admission, deterministic ZIP bytes, durable
receipt-last ingestion with exclusive admission, bounded reads that reject
special files, catalog search over 3840 structured items, and controller/query
state across view and controller restart. Warframe tests also cover reversed
response order, failed refresh with a valid cache, messages during startup,
and IndexedDB transaction aborts after a successful request. They do not prove
live compositor or game behavior.

The catalog-stage smoke removes the temporary build outputs after admission,
then proves that the CLI can produce a signed development catalog and the exact
content-addressed `.ocpkg` from the independently verified private store. Rust
tests verify the Ed25519 signature against the compiled development public key,
reject another seed, and cover the envelope, listing, manifest, URL, size, and
digest contract.

The admission smoke uses real temporary Git revisions. It proves that an
undeclared file present only in the proposed revision is rejected, that a
proposal changing the widget schema crate is rejected by the trusted-path
policy, that a valid
proposal emits a receipt v2 bound to its revision, tree, identity, version, and
the SHA-256 and byte length of its package and listing, and that tests from an
exact trusted push cannot be silently skipped. Pull-request admission never
executes proposed JavaScript or build scripts; it validates and packages those
bytes with the tool compiled from the target-base commit. Push admission runs
the now-trusted revision's
Rust and Warframe Market tests once. The Ubuntu CI runner installs
the distribution's Node package before these checks: the runner's preinstalled
Node lives under a writable directory and is intentionally rejected by the
system-Node resolver. The smoke is repeated only
on trusted pushes because pull requests cannot modify the CI trust boundary.
When a private accepted store is explicitly supplied, the smoke also proves
that the exact package and listing remain independently verifiable after the
driver's temporary artifact directory has been removed. Package or same-size
listing tampering, unreceipted files, same-version replacement, and downgrade
are covered by the Rust admission tests.

Production retirement tests cover explicit removal of a superseded verified
version, the resulting signed inventory, and rejection of unknown, duplicate,
current, unreplaced, suspended, revoked, or conflicting removals without state
mutation.

Production tests cover offline preparation, detached signature verification,
sequence reservations, interrupted finalization, and retained version statuses.
The public CLI smoke rejects untrusted signatures against the compiled production
key. Private signing remains external; the generic maintainer sandbox is still
pending. Catalog publication and OverCrow runtime reuse admitted bytes and never
rerun their tests.
