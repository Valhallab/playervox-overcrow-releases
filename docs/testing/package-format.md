# Package format measurements (P0.5)

Cost of the [`.ocpkg` v1 format](../widget-package-v1.md) (OverCrow design
record ADR 0005): what the container adds
to a widget, and what the host pays to revalidate a package at every
activation. The format adds no process or resident memory of its own, so
private memory, PSS and CPU at rest are not affected by this lot; the runtime
cost per widget is measured from P2.4.

## Machine and build

- AMD Ryzen 7 5800X3D, Arch Linux, rustc 1.98.1.
- `overcrow-widget-schema` in the release profile of the workspace.
- Command: `cargo run --release -p overcrow-widget-schema --example package_bench`.

## Revalidation time

`read_package` performs the complete admission check: zip layout and CRC-32 of
every entry, the canonical ledger with the SHA-256 of every file, the manifest,
text files, locale pair, asset signatures and the compiled view. The median
wall time of repeated runs on one core:

| Package | Archive | Runs | Median | Throughput |
| --- | --- | --- | --- | --- |
| `minimal` fixture | 1,404 bytes | 1001 | 6.9 µs | 193 MiB/s |
| `clock` fixture | 4,153 bytes | 1001 | 17.1 µs | 232 MiB/s |
| `weather` fixture | 3,109 bytes | 1001 | 18.0 µs | 165 MiB/s |
| largest admissible (clock plus eight 1.94 MiB images) | 16,258,921 bytes | 21 | 16.4 ms | 947 MiB/s |

The worst case is about a tenth of the 150 ms warm-start target and is
dominated by hashing; a widget of a few kilobytes costs a few tens of
microseconds. Signature verification happens once per catalog or seed, not per
activation.

## Container overhead

| Package | Archive | Files | Content, ledger included | Ledger | Zip records |
| --- | --- | --- | --- | --- | --- |
| `minimal` | 1,404 bytes | 5 | 906 bytes | 435 bytes | 498 bytes |
| `clock` | 4,153 bytes | 8 | 3,347 bytes | 756 bytes | 806 bytes |
| `weather` | 3,109 bytes | 7 | 2,387 bytes | 658 bytes | 722 bytes |

Entries are stored uncompressed, as decided by ADR 0001 (D9); the zip records
cost about 100 bytes per file and the ledger about 90 bytes per file.

## Interoperability

The archives are ordinary zip files: Python `zipfile.testzip()`, `unzip -t`
and `bsdtar -t` read all three fixtures without error, so reviewers can
inspect a package with standard tools.
