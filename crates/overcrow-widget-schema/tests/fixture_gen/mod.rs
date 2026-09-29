//! Deterministic generator of the package, catalog and seed conformance
//! fixtures. `cargo run -p overcrow-widget-schema --example fixtures` writes
//! them; the `package_format` test regenerates them in memory and requires
//! the committed files to be identical.
//!
//! Every signature is made with the conformance key, whose private seed is
//! derived from a public string, except the legacy Web catalog, signed with
//! the public development key. No production key is generated or used.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use overcrow_widget_schema::catalog::{
    CATALOG_DOMAIN, CONFORMANCE_KEY_ID, PRODUCTION_BASE_URL, SEED_DOMAIN, encode_envelope,
};
use overcrow_widget_schema::package::{hex, ledger, sha256, stored_zip, write_package};
use ring::signature::{Ed25519KeyPair, KeyPair as _};
use serde_json::{Value, json};

/// Directories owned by this generator; the example rewrites them entirely.
pub const GENERATED_DIRS: &[&str] = &["package", "catalog", "seed"];
pub const CONFORMANCE_KEY_FILE: &str = "conformance-key.pub";
/// 2026-10-01T00:00:00Z, the clock of every catalog and seed fixture.
pub const NOW: i64 = 1_790_812_800;
const SEED_TEXT: &[u8] = b"OverCrow widget conformance key; never trusted";
/// Hand-kept input of the legacy Web catalog fixture.
pub const LEGACY_WEB_PAYLOAD: &str = "legacy-web/payload.json";

pub fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

pub fn conformance_key() -> Ed25519KeyPair {
    Ed25519KeyPair::from_seed_unchecked(&sha256(SEED_TEXT)).expect("conformance seed is 32 bytes")
}

/// The repository's public development key (`fixtures/keys/`), which signed
/// Web API v1 catalogs as `overcrow-development-2026`.
pub fn legacy_development_key() -> Ed25519KeyPair {
    let seed: [u8; 32] = std::array::from_fn(|index| index as u8);
    Ed25519KeyPair::from_seed_unchecked(&seed).expect("development seed is 32 bytes")
}

/// A Web API v1 catalog in its original envelope, signed the way
/// `marketplace-tool stage-development-catalog` signs (see
/// `fixtures/legacy-web/README.md`).
pub fn legacy_web_catalog() -> Vec<u8> {
    let payload =
        fs::read(fixtures_root().join(LEGACY_WEB_PAYLOAD)).expect("legacy Web catalog payload");
    let signature = legacy_development_key().sign(&payload);
    format!(
        "{{\"schemaVersion\":1,\"keyId\":\"overcrow-development-2026\",\"payload\":\"{}\",\"signature\":\"{}\"}}",
        URL_SAFE_NO_PAD.encode(&payload),
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    )
    .into_bytes()
}

/// Relative path → bytes of every generated fixture.
pub fn generate() -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    out.insert(
        CONFORMANCE_KEY_FILE.to_owned(),
        format!("{}\n", hex(conformance_key().public_key().as_ref())).into_bytes(),
    );
    let sources: BTreeMap<&str, BTreeMap<String, Vec<u8>>> = ["clock", "weather", "minimal"]
        .into_iter()
        .map(|name| {
            (
                name,
                read_tree(&fixtures_root().join("package-src").join(name)),
            )
        })
        .collect();
    let mut packages = BTreeMap::new();
    for (name, files) in &sources {
        let archive = write_package(files).expect("package sources are valid");
        out.insert(format!("package/valid/{name}.ocpkg"), archive.clone());
        packages.insert(*name, (files.clone(), archive));
    }
    invalid_packages(&mut out, &sources["clock"]);
    catalogs(&mut out, &packages);
    seeds(&mut out, &packages);
    out
}

fn read_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).expect("fixture source directory") {
            let path = entry.expect("fixture source entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .expect("inside the source tree")
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(relative, fs::read(&path).expect("fixture source file"));
            }
        }
    }
    files
}

/// Archive of `files` with a correct ledger and the pinned layout, without
/// validating the content.
fn archive_with_ledger(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let entries: Vec<(&str, &[u8])> = files
        .iter()
        .filter(|(path, _)| path.as_str() != "ledger.json")
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect();
    let ledger = ledger(&entries);
    let mut all = entries;
    all.push(("ledger.json", &ledger));
    all.sort_by(|a, b| a.0.cmp(b.0));
    stored_zip(&all)
}

fn with(
    base: &BTreeMap<String, Vec<u8>>,
    edit: impl FnOnce(&mut BTreeMap<String, Vec<u8>>),
) -> BTreeMap<String, Vec<u8>> {
    let mut files = base.clone();
    edit(&mut files);
    files
}

/// Offset of the `n`th occurrence of a little-endian record signature.
fn record(archive: &[u8], signature: u32, n: usize) -> usize {
    archive
        .windows(4)
        .enumerate()
        .filter(|(_, window)| *window == signature.to_le_bytes())
        .nth(n)
        .map(|(offset, _)| offset)
        .expect("record present")
}

fn invalid_packages(out: &mut BTreeMap<String, Vec<u8>>, clock: &BTreeMap<String, Vec<u8>>) {
    let mut put = |name: &str, bytes: Vec<u8>| {
        out.insert(format!("package/invalid/{name}.ocpkg"), bytes);
    };
    let valid = archive_with_ledger(clock);
    const LOCAL: u32 = 0x0403_4b50;
    const CENTRAL: u32 = 0x0201_4b50;
    let patch16 = |archive: &[u8], offsets: &[usize], value: u16| {
        let mut archive = archive.to_vec();
        for offset in offsets {
            archive[*offset..*offset + 2].copy_from_slice(&value.to_le_bytes());
        }
        archive
    };

    // Container.
    put(
        "archive_format--truncated",
        valid[..valid.len() - 1].to_vec(),
    );
    let mut comment = valid.clone();
    let end = comment.len() - 2;
    comment[end..].copy_from_slice(&4u16.to_le_bytes());
    comment.extend_from_slice(b"note");
    put("archive_format--trailing-comment", comment);
    let mut prefixed = b"#!/bin/sh\n".to_vec();
    prefixed.extend_from_slice(&valid);
    put("archive_format--prefixed-data", prefixed);
    let (first_local, first_central) = (record(&valid, LOCAL, 0), record(&valid, CENTRAL, 0));
    put(
        "compression--deflate-method",
        patch16(&valid, &[first_local + 8, first_central + 10], 8),
    );
    put(
        "encryption--encrypted-flag",
        patch16(&valid, &[first_local + 6, first_central + 8], (1 << 11) | 1),
    );
    put(
        "entry_metadata--modification-date",
        patch16(&valid, &[first_local + 12, first_central + 14], 0x5b3e),
    );
    put("entry_metadata--executable-mode", {
        let mut archive = valid.clone();
        archive[first_central + 38..first_central + 42]
            .copy_from_slice(&(0o100_755u32 << 16).to_le_bytes());
        archive
    });
    put("entry_metadata--crc-mismatch", {
        let mut archive = valid.clone();
        let data = first_local
            + 30
            + usize::from(u16::from_le_bytes([
                archive[first_local + 26],
                archive[first_local + 27],
            ]));
        archive[data] ^= 0x20;
        archive
    });
    let mut reversed: Vec<(&str, Vec<u8>)> = Vec::new();
    {
        let entries: Vec<(&str, &[u8])> = clock
            .iter()
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
            .collect();
        let ledger = ledger(&entries);
        for (path, bytes) in entries.iter().rev() {
            reversed.push((path, bytes.to_vec()));
        }
        reversed.push(("ledger.json", ledger));
    }
    let reversed: Vec<(&str, &[u8])> = reversed
        .iter()
        .map(|(path, bytes)| (*path, bytes.as_slice()))
        .collect();
    put("entry_order--reversed", stored_zip(&reversed));
    let many: Vec<(String, Vec<u8>)> = (0..257)
        .map(|index| {
            (
                format!("assets/{index:03}.png"),
                b"\x89PNG\r\n\x1a\n".to_vec(),
            )
        })
        .collect();
    let many: Vec<(&str, &[u8])> = many
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect();
    put("entry_limit--257-entries", stored_zip(&many));
    put(
        "unsafe_path--parent-segment",
        archive_with_ledger(&with(clock, |files| {
            files.insert("../logic.js".into(), b"\"use strict\";\n".to_vec());
        })),
    );
    put(
        "unsafe_path--absolute",
        archive_with_ledger(&with(clock, |files| {
            files.insert("/logic.js".into(), b"\"use strict\";\n".to_vec());
        })),
    );
    put(
        "unsafe_path--backslash",
        archive_with_ledger(&with(clock, |files| {
            files.insert("assets\\x.png".into(), b"\x89PNG\r\n\x1a\n".to_vec());
        })),
    );

    // Inventory.
    for (name, path, bytes) in [
        ("view-source", "view.ocml", b"<box/>".to_vec()),
        ("html", "index.html", b"<!doctype html>".to_vec()),
        ("wasm", "logic.wasm", b"\0asm\x01\0\0\0".to_vec()),
        ("second-script", "worker.js", b"\"use strict\";\n".to_vec()),
        ("svg-asset", "assets/icon.svg", b"<svg/>".to_vec()),
        (
            "uppercase-asset",
            "assets/Icon.png",
            b"\x89PNG\r\n\x1a\n".to_vec(),
        ),
        ("hidden-file", ".DS_Store", b"\0".to_vec()),
        ("native-library", "assets/lib.so", b"\x7fELF".to_vec()),
        (
            "nested-too-deep",
            "assets/a/b/c/d/e.png",
            b"\x89PNG\r\n\x1a\n".to_vec(),
        ),
        ("third-locale", "locales/de.json", b"{}".to_vec()),
    ] {
        put(
            &format!("unexpected_file--{name}"),
            archive_with_ledger(&with(clock, |files| {
                files.insert(path.into(), bytes);
            })),
        );
    }
    for (name, path) in [
        ("license", "LICENSE"),
        ("view", "view.json"),
        ("logic", "logic.js"),
    ] {
        put(
            &format!("missing_file--{name}"),
            archive_with_ledger(&with(clock, |files| {
                files.remove(path);
            })),
        );
    }
    put(
        "missing_file--ledger",
        stored_zip(
            &clock
                .iter()
                .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
                .collect::<Vec<_>>(),
        ),
    );

    // Ledger.
    let ledger_entries = |files: &BTreeMap<String, Vec<u8>>, ledger: Vec<u8>| {
        let mut all: Vec<(String, Vec<u8>)> = files
            .iter()
            .map(|(path, bytes)| (path.clone(), bytes.clone()))
            .collect();
        all.push(("ledger.json".into(), ledger));
        all.sort();
        let entries: Vec<(&str, &[u8])> = all
            .iter()
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
            .collect();
        stored_zip(&entries)
    };
    let honest: Vec<(&str, &[u8])> = clock
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect();
    let honest_ledger = String::from_utf8(ledger(&honest)).expect("ledger is ASCII");
    let value: Value = serde_json::from_str(&honest_ledger).expect("ledger is JSON");
    put(
        "ledger--pretty-printed",
        ledger_entries(clock, serde_json::to_vec_pretty(&value).expect("JSON")),
    );
    put(
        "ledger--missing-entry",
        ledger_entries(clock, {
            let without: Vec<(&str, &[u8])> = honest
                .iter()
                .copied()
                .filter(|(path, _)| *path != "style.ocss")
                .collect();
            ledger(&without)
        }),
    );
    put(
        "ledger--stale-digest",
        ledger_entries(
            &with(clock, |files| {
                files.insert("logic.js".into(), b"\"use strict\";\nthrow 1;\n".to_vec());
            }),
            honest_ledger.clone().into_bytes(),
        ),
    );

    // Content.
    let legacy = br#"{"schemaVersion":1,"id":"com.playervox.clock","version":"1.0.0","apiVersion":"1","entrypoints":{"view":"index.html"},"permissions":{},"files":{}}"#;
    put(
        "manifest--legacy-web-manifest",
        archive_with_ledger(&with(clock, |files| {
            files.insert("manifest.json".into(), legacy.to_vec());
        })),
    );
    put(
        "view--missing-asset",
        archive_with_ledger(&with(clock, |files| {
            files.insert(
                "view.json".into(),
                br#"{"viewFormat":1,"expressions":0,"children":[{"element":"image","attrs":{"src":"assets/logo.png"}}]}"#.to_vec(),
            );
        })),
    );
    put(
        "view--view-source-instead-of-compiled",
        archive_with_ledger(&with(clock, |files| {
            files.insert(
                "view.json".into(),
                b"<box><text>{now}</text></box>".to_vec(),
            );
        })),
    );
    put(
        "logic--empty",
        archive_with_ledger(&with(clock, |files| {
            files.insert("logic.js".into(), Vec::new());
        })),
    );
    put(
        "logic--invalid-utf8",
        archive_with_ledger(&with(clock, |files| {
            files.insert("logic.js".into(), b"\"use strict\";\n\xff\n".to_vec());
        })),
    );
    put(
        "logic--byte-order-mark",
        archive_with_ledger(&with(clock, |files| {
            files.insert("logic.js".into(), b"\xef\xbb\xbf\"use strict\";\n".to_vec());
        })),
    );
    put(
        "style--nul-byte",
        archive_with_ledger(&with(clock, |files| {
            files.insert("style.ocss".into(), b".clock {}\0".to_vec());
        })),
    );
    put(
        "locales--english-only",
        archive_with_ledger(&with(clock, |files| {
            files.remove("locales/fr.json");
        })),
    );
    put(
        "locales--different-keys",
        archive_with_ledger(&with(clock, |files| {
            files.insert(
                "locales/fr.json".into(),
                br#"{"secondes":"Afficher"}"#.to_vec(),
            );
        })),
    );
    put(
        "locales--nested-value",
        archive_with_ledger(&with(clock, |files| {
            files.insert(
                "locales/en.json".into(),
                br#"{"seconds":{"one":"x"}}"#.to_vec(),
            );
            files.insert(
                "locales/fr.json".into(),
                br#"{"seconds":{"one":"x"}}"#.to_vec(),
            );
        })),
    );
    put(
        "license--empty",
        archive_with_ledger(&with(clock, |files| {
            files.insert("LICENSE".into(), Vec::new());
        })),
    );
    put(
        "asset--jpeg-named-png",
        archive_with_ledger(&with(clock, |files| {
            files.insert("assets/photo.png".into(), vec![0xff, 0xd8, 0xff, 0xe0]);
        })),
    );
    put(
        "asset--elf-named-png",
        archive_with_ledger(&with(clock, |files| {
            files.insert("assets/tool.png".into(), b"\x7fELF\x02\x01\x01".to_vec());
        })),
    );
}

type Built = (BTreeMap<String, Vec<u8>>, Vec<u8>);

fn manifest_value(files: &BTreeMap<String, Vec<u8>>) -> Value {
    serde_json::from_slice(&files["manifest.json"]).expect("manifest source is JSON")
}

fn target(built: &Built, tags: &[&str], status: &str) -> Value {
    let (files, archive) = built;
    let manifest = manifest_value(files);
    let id = manifest["id"].as_str().expect("id").to_owned();
    let version = manifest["version"].as_str().expect("version").to_owned();
    let digest = hex(&sha256(archive));
    let mut target = json!({
        "manifest": manifest,
        "status": status,
        "package": {
            "url": format!("{PRODUCTION_BASE_URL}packages/{id}/{version}/{digest}.ocpkg"),
            "size": archive.len(),
            "sha256": digest,
        },
        "listing": {
            "author": "PlayerVox",
            "spdxLicense": "MIT",
            "sourceUrl": format!("https://github.com/valhallab/playervox-overcrow-releases/tree/main/widgets/{id}"),
            "defaultLocale": "en",
            "localizations": [
                { "locale": "en", "name": id, "description": "Conformance fixture." },
                { "locale": "fr", "name": id, "description": "Fixture de conformité." }
            ]
        }
    });
    if !tags.is_empty() {
        target["tags"] = json!(tags);
    }
    target
}

fn catalog_payload(targets: Vec<Value>) -> Value {
    json!({
        "formatVersion": 1,
        "sequence": 1,
        "generatedAt": "2026-09-30T00:00:00Z",
        "expiresAt": "2026-10-30T00:00:00Z",
        "targets": targets,
    })
}

fn seed_payload(targets: Vec<Value>) -> Value {
    json!({
        "formatVersion": 1,
        "catalogSequence": 1,
        "generatedAt": "2026-09-30T00:00:00Z",
        "expiresAt": "2027-09-30T00:00:00Z",
        "targets": targets,
    })
}

fn sign(domain: &[u8], payload: &[u8]) -> [u8; 64] {
    let message = [domain, payload].concat();
    conformance_key()
        .sign(&message)
        .as_ref()
        .try_into()
        .expect("Ed25519 signatures are 64 bytes")
}

fn envelope(domain: &[u8], payload: &Value) -> Vec<u8> {
    let bytes = serde_json::to_vec(payload).expect("payload serializes");
    encode_envelope(CONFORMANCE_KEY_ID, &bytes, &sign(domain, &bytes))
}

fn edit(value: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut value = value.clone();
    change(&mut value);
    value
}

fn catalogs(out: &mut BTreeMap<String, Vec<u8>>, packages: &BTreeMap<&str, Built>) {
    let clock = target(&packages["clock"], &["built-in"], "verified");
    let weather = target(&packages["weather"], &[], "verified");
    let minimal = target(&packages["minimal"], &[], "revoked");
    let full = catalog_payload(vec![clock.clone(), weather.clone(), minimal]);
    let mut put = |name: &str, bytes: Vec<u8>| {
        out.insert(format!("catalog/{name}.json"), bytes);
    };
    put(
        "valid/built-in-and-third-party",
        envelope(CATALOG_DOMAIN, &full),
    );
    put(
        "valid/empty",
        envelope(CATALOG_DOMAIN, &catalog_payload(Vec::new())),
    );
    let suspended = edit(&clock, |target| {
        target["status"] = json!("security-suspended")
    });
    put(
        "valid/suspended-built-in",
        envelope(CATALOG_DOMAIN, &catalog_payload(vec![suspended])),
    );
    let previewed = edit(&weather, |target| {
        let digest = "ab".repeat(32);
        target["preview"] = json!({
            "url": format!("{PRODUCTION_BASE_URL}previews/com.example.weather/2.3.0-beta.1/{digest}.png"),
            "mediaType": "image/png",
            "size": 4096,
            "sha256": digest,
        });
    });
    put(
        "valid/preview",
        envelope(CATALOG_DOMAIN, &catalog_payload(vec![previewed])),
    );

    // Envelope and signature.
    put(
        "invalid/format_version--legacy-web-catalog",
        legacy_web_catalog(),
    );
    let payload = serde_json::to_vec(&full).expect("payload");
    let bare: [u8; 64] = conformance_key()
        .sign(&payload)
        .as_ref()
        .try_into()
        .expect("64 bytes");
    put(
        "invalid/signature--bare-payload-as-web-signer",
        encode_envelope(CONFORMANCE_KEY_ID, &payload, &bare),
    );
    put(
        "invalid/signature--seed-domain",
        encode_envelope(CONFORMANCE_KEY_ID, &payload, &sign(SEED_DOMAIN, &payload)),
    );
    let tampered = serde_json::to_vec(&edit(&full, |catalog| catalog["sequence"] = json!(2)))
        .expect("payload");
    put(
        "invalid/signature--tampered-payload",
        encode_envelope(
            CONFORMANCE_KEY_ID,
            &tampered,
            &sign(CATALOG_DOMAIN, &payload),
        ),
    );
    put(
        "invalid/key_unknown--legacy-production-key",
        encode_envelope(
            "overcrow-production-2026-01",
            &payload,
            &sign(CATALOG_DOMAIN, &payload),
        ),
    );
    let signed = envelope(CATALOG_DOMAIN, &full);
    let text = String::from_utf8(signed).expect("envelope is ASCII");
    put(
        "invalid/envelope--unknown-field",
        text.replacen(
            "{\"formatVersion\"",
            "{\"schemaVersion\":1,\"formatVersion\"",
            1,
        )
        .into_bytes(),
    );
    put(
        "invalid/envelope--duplicate-key",
        text.replacen(
            "\"keyId\"",
            "\"keyId\":\"overcrow-widgets-2026-01\",\"keyId\"",
            1,
        )
        .into_bytes(),
    );
    put(
        "invalid/envelope--padded-base64",
        text.replacen("\",\"signature\"", "=\",\"signature\"", 1)
            .into_bytes(),
    );
    put(
        "invalid/key_id--uppercase",
        text.replacen(CONFORMANCE_KEY_ID, "OverCrow-Widgets", 1)
            .into_bytes(),
    );
    put(
        "invalid/signature--short",
        text.replacen("\"signature\":\"", "\"signature\":\"AAAA", 1)
            .split("\"signature\":\"")
            .next()
            .map(|head| format!("{head}\"signature\":\"AAAA\"}}"))
            .expect("head")
            .into_bytes(),
    );

    // Payload.
    let mut signed_invalid = |name: &str, payload: Value| {
        out.insert(
            format!("catalog/invalid/{name}.json"),
            envelope(CATALOG_DOMAIN, &payload),
        );
    };
    signed_invalid(
        "format_version--payload-v2",
        edit(&full, |c| c["formatVersion"] = json!(2)),
    );
    signed_invalid(
        "payload--legacy-schema-version",
        edit(&full, |c| {
            c["schemaVersion"] = json!(1);
        }),
    );
    signed_invalid("sequence--zero", edit(&full, |c| c["sequence"] = json!(0)));
    signed_invalid(
        "time--fractional-seconds",
        edit(&full, |c| {
            c["generatedAt"] = json!("2026-09-30T00:00:00.000Z");
        }),
    );
    signed_invalid(
        "time--expires-before-generated",
        edit(&full, |c| {
            c["expiresAt"] = json!("2026-09-29T00:00:00Z");
        }),
    );
    signed_invalid(
        "time--lifetime-over-90-days",
        edit(&full, |c| {
            c["expiresAt"] = json!("2026-12-30T00:00:00Z");
        }),
    );
    signed_invalid(
        "not_yet_valid--generated-tomorrow",
        edit(&full, |c| {
            c["generatedAt"] = json!("2026-10-02T00:00:00Z");
            c["expiresAt"] = json!("2026-10-30T00:00:00Z");
        }),
    );
    signed_invalid(
        "expired--past-catalog",
        edit(&full, |c| {
            c["generatedAt"] = json!("2026-08-01T00:00:00Z");
            c["expiresAt"] = json!("2026-09-01T00:00:00Z");
        }),
    );
    signed_invalid(
        "manifest--legacy-web-manifest",
        catalog_payload(vec![edit(&weather, |t| {
            t["manifest"] = json!({
                "schemaVersion": 1, "id": "com.example.weather", "version": "2.3.0-beta.1",
                "apiVersion": "1", "entrypoints": { "view": "index.html" },
                "permissions": {}, "files": {}
            });
        })]),
    );
    signed_invalid(
        "duplicate_target--same-version",
        catalog_payload(vec![weather.clone(), weather.clone()]),
    );
    signed_invalid(
        "tag--unknown",
        catalog_payload(vec![edit(&clock, |t| {
            t["tags"] = json!(["built-in", "featured"])
        })]),
    );
    signed_invalid(
        "tag--duplicate",
        catalog_payload(vec![edit(&clock, |t| {
            t["tags"] = json!(["built-in", "built-in"])
        })]),
    );
    signed_invalid(
        "manifest--manifest-claims-built-in-tag",
        catalog_payload(vec![edit(&clock, |t| {
            t["manifest"]["tags"] = json!(["built-in"]);
        })]),
    );
    signed_invalid(
        "built_in_id--third-party",
        catalog_payload(vec![edit(&weather, |t| t["tags"] = json!(["built-in"]))]),
    );
    signed_invalid(
        "built_in_id--lookalike-prefix",
        catalog_payload(vec![edit(&clock, |t| {
            t["manifest"]["id"] = json!("com.playervoxx.clock");
            let url = t["package"]["url"]
                .as_str()
                .expect("url")
                .replace("/com.playervox.clock/", "/com.playervoxx.clock/");
            t["package"]["url"] = json!(url);
        })]),
    );
    signed_invalid(
        "tag_consistency--untagged-older-version",
        catalog_payload(vec![
            clock.clone(),
            edit(&clock, |t| {
                t.as_object_mut().expect("target").remove("tags");
                t["manifest"]["version"] = json!("0.9.0");
                let url = t["package"]["url"]
                    .as_str()
                    .expect("url")
                    .replace("/1.0.0/", "/0.9.0/");
                t["package"]["url"] = json!(url);
            }),
        ]),
    );
    signed_invalid(
        "status--unknown",
        catalog_payload(vec![edit(&weather, |t| t["status"] = json!("pending"))]),
    );
    signed_invalid(
        "url--legacy-web-path",
        catalog_payload(vec![edit(&weather, |t| {
            let url = t["package"]["url"]
                .as_str()
                .expect("url")
                .replace("/marketplace/widgets/v1/", "/marketplace/v1/");
            t["package"]["url"] = json!(url);
        })]),
    );
    signed_invalid(
        "url--other-host",
        catalog_payload(vec![edit(&weather, |t| {
            let url = t["package"]["url"]
                .as_str()
                .expect("url")
                .replace("overcrow.playervox.com", "cdn.example.com");
            t["package"]["url"] = json!(url);
        })]),
    );
    signed_invalid(
        "package_ref--uppercase-digest",
        catalog_payload(vec![edit(&weather, |t| {
            let digest = t["package"]["sha256"]
                .as_str()
                .expect("digest")
                .to_uppercase();
            t["package"]["sha256"] = json!(digest);
        })]),
    );
    signed_invalid(
        "package_ref--oversized",
        catalog_payload(vec![edit(&weather, |t| {
            t["package"]["size"] = json!(16 * 1024 * 1024 + 1)
        })]),
    );
    signed_invalid(
        "listing--markup-in-name",
        catalog_payload(vec![edit(&weather, |t| {
            t["listing"]["localizations"][0]["name"] = json!("<b>Weather</b>");
        })]),
    );
    signed_invalid(
        "listing--default-locale-missing",
        catalog_payload(vec![edit(&weather, |t| {
            t["listing"]["defaultLocale"] = json!("de")
        })]),
    );
    signed_invalid(
        "listing--http-source",
        catalog_payload(vec![edit(&weather, |t| {
            t["listing"]["sourceUrl"] = json!("http://example.com/weather");
        })]),
    );
    signed_invalid(
        "preview--svg",
        catalog_payload(vec![edit(&weather, |t| {
            let digest = "0".repeat(64);
            t["preview"] = json!({
                "url": format!("{PRODUCTION_BASE_URL}previews/com.example.weather/2.3.0-beta.1/{digest}.svg"),
                "mediaType": "image/svg+xml",
                "size": 100,
                "sha256": digest,
            });
        })]),
    );
}

fn seeds(out: &mut BTreeMap<String, Vec<u8>>, packages: &BTreeMap<&str, Built>) {
    let clock = target(&packages["clock"], &["built-in"], "verified");
    let clock_archive = packages["clock"].1.clone();
    let clock_path = format!("packages/{}.ocpkg", hex(&sha256(&clock_archive)));
    let mut put_case = |kind: &str, name: &str, seed: Vec<u8>, files: Vec<(String, Vec<u8>)>| {
        out.insert(format!("seed/{kind}/{name}/seed.json"), seed);
        for (path, bytes) in files {
            out.insert(format!("seed/{kind}/{name}/{path}"), bytes);
        }
    };
    let payload = seed_payload(vec![clock.clone()]);
    let with_clock = || vec![(clock_path.clone(), clock_archive.clone())];
    put_case(
        "valid",
        "built-in-clock",
        envelope(SEED_DOMAIN, &payload),
        with_clock(),
    );
    put_case(
        "valid",
        "empty",
        envelope(SEED_DOMAIN, &seed_payload(Vec::new())),
        Vec::new(),
    );

    let invalid = |name: &str, payload: &Value| (name.to_owned(), envelope(SEED_DOMAIN, payload));
    for (name, seed) in [
        invalid(
            "expired--past-seed",
            &edit(&payload, |s| {
                s["generatedAt"] = json!("2025-09-01T00:00:00Z");
                s["expiresAt"] = json!("2026-09-01T00:00:00Z");
            }),
        ),
        invalid(
            "not_yet_valid--generated-tomorrow",
            &edit(&payload, |s| {
                s["generatedAt"] = json!("2026-10-02T00:00:00Z")
            }),
        ),
        invalid(
            "time--lifetime-over-365-days",
            &edit(&payload, |s| s["expiresAt"] = json!("2027-10-01T00:00:00Z")),
        ),
        invalid(
            "sequence--zero",
            &edit(&payload, |s| s["catalogSequence"] = json!(0)),
        ),
        invalid(
            "payload--catalog-payload-as-seed",
            &catalog_payload(vec![clock.clone()]),
        ),
        invalid(
            "seed_target--untagged",
            &seed_payload(vec![edit(&clock, |t| {
                t.as_object_mut().expect("target").remove("tags");
            })]),
        ),
        invalid(
            "seed_target--revoked",
            &seed_payload(vec![edit(&clock, |t| t["status"] = json!("revoked"))]),
        ),
        (
            "signature--catalog-domain".to_owned(),
            envelope(CATALOG_DOMAIN, &payload),
        ),
    ] {
        put_case("invalid", &name, seed, with_clock());
    }
    let weather = target(&packages["weather"], &["built-in"], "verified");
    put_case(
        "invalid",
        "built_in_id--third-party",
        envelope(SEED_DOMAIN, &seed_payload(vec![weather])),
        vec![(
            format!("packages/{}.ocpkg", hex(&sha256(&packages["weather"].1))),
            packages["weather"].1.clone(),
        )],
    );

    // Package bytes that do not match their signed target.
    let mut tampered = clock_archive.clone();
    let last = tampered.len() - 30;
    tampered[last] ^= 1;
    put_case(
        "invalid",
        "package_digest--tampered-package",
        envelope(SEED_DOMAIN, &payload),
        vec![(clock_path.clone(), tampered)],
    );
    let (clock_files, _) = &packages["clock"];
    let renamed = with(clock_files, |files| {
        let mut manifest = manifest_value(files);
        manifest["name"]["en"] = json!("Wall clock");
        files.insert(
            "manifest.json".into(),
            serde_json::to_vec_pretty(&manifest).expect("manifest"),
        );
    });
    let other = write_package(&renamed).expect("renamed package is valid");
    let mismatched = edit(&clock, |t| {
        let digest = hex(&sha256(&other));
        t["package"]["sha256"] = json!(digest);
        t["package"]["size"] = json!(other.len());
        t["package"]["url"] = json!(format!(
            "{PRODUCTION_BASE_URL}packages/com.playervox.clock/1.0.0/{digest}.ocpkg"
        ));
    });
    put_case(
        "invalid",
        "manifest_mismatch--package-manifest-differs",
        envelope(SEED_DOMAIN, &seed_payload(vec![mismatched])),
        vec![(format!("packages/{}.ocpkg", hex(&sha256(&other))), other)],
    );
    put_case(
        "invalid",
        "seed_inventory--missing-package",
        envelope(SEED_DOMAIN, &payload),
        Vec::new(),
    );
    put_case(
        "invalid",
        "seed_inventory--extra-file",
        envelope(SEED_DOMAIN, &payload),
        vec![
            (clock_path.clone(), clock_archive.clone()),
            ("packages/readme.txt".into(), b"unexpected\n".to_vec()),
        ],
    );
}
