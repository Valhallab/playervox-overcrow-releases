//! Measures the activation-time revalidation of a package (`read_package`:
//! zip layout, CRC, ledger SHA-256, manifest, compiled view, assets):
//! `cargo run --release -p overcrow-widget-schema --example package_bench`.
//! Results are recorded in `docs/testing/package-format.md`.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use overcrow_widget_schema::limits::{MAX_IMAGE_ENCODED_BYTES, MAX_PACKAGE_BYTES};
use overcrow_widget_schema::package::{read_package, write_package};

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

fn measure(name: &str, archive: &[u8]) {
    read_package(archive).expect("valid package");
    let runs = if archive.len() > 1 << 20 { 21 } else { 1001 };
    let samples = (0..runs)
        .map(|_| {
            let start = Instant::now();
            std::hint::black_box(read_package(std::hint::black_box(archive)).expect("valid"));
            start.elapsed()
        })
        .collect();
    let median = median(samples);
    let rate = archive.len() as f64 / median.as_secs_f64() / f64::from(1 << 20);
    println!(
        "{name}: {} bytes, median {:.1} µs over {runs} runs, {rate:.0} MiB/s",
        archive.len(),
        median.as_secs_f64() * 1e6
    );
}

fn main() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/package/valid");
    for name in ["minimal", "clock", "weather"] {
        let archive = fs::read(fixtures.join(format!("{name}.ocpkg"))).expect("fixture");
        measure(name, &archive);
    }

    // The largest admissible package: assets at their size limit up to the
    // package limit.
    let clock =
        read_package(&fs::read(fixtures.join("clock.ocpkg")).expect("fixture")).expect("clock");
    let mut files: BTreeMap<String, Vec<u8>> = clock
        .paths()
        .filter(|path| *path != "ledger.json")
        .map(|path| (path.to_owned(), clock.file(path).expect("listed").to_vec()))
        .collect();
    let asset_bytes = MAX_IMAGE_ENCODED_BYTES.value as usize - 64 * 1024;
    let mut index = 0;
    while files.values().map(Vec::len).sum::<usize>() + asset_bytes
        < MAX_PACKAGE_BYTES.value as usize - 64 * 1024
    {
        let mut image = b"\x89PNG\r\n\x1a\n".to_vec();
        image.resize(asset_bytes, (index % 251) as u8);
        files.insert(format!("assets/filler-{index}.png"), image);
        index += 1;
    }
    let archive = write_package(&files).expect("largest package is valid");
    measure("largest", &archive);
}
