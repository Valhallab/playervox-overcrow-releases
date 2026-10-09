//! Deterministic generator of the catalog v2 vectors under
//! `fixtures/catalog-v2/`. `cargo run -p overcrow-widget-schema --example
//! fixtures` writes them; `tests/catalog_v2.rs` regenerates them in memory
//! and requires the committed files to be identical.
//!
//! Every catalog is signed with the public conformance key. The package
//! archives are built in memory from `fixtures/package-src/`, so the listed
//! sizes and digests are those of real packages, but only the catalogs are
//! written.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use overcrow_widget_schema::catalog::{CATALOG_DOMAIN, CONFORMANCE_KEY_ID, SEED_DOMAIN};
use overcrow_widget_schema::catalog_v2::{
    CATALOG_V2_DOMAIN, INITIAL_CATEGORIES, PRODUCTION_BASE_URL, encode_envelope,
};
use overcrow_widget_schema::package::{hex, sha256, write_package};
use serde_json::{Value, json};

use crate::fixture_gen::{conformance_key, fixtures_root};

/// Directories owned by this generator; the example rewrites them entirely.
pub const GENERATED_DIRS: &[&str] = &["catalog-v2/valid", "catalog-v2/invalid"];

const BASE: &str = PRODUCTION_BASE_URL;
/// Index of the weather widget in `widgets` and of its newest version in
/// `targets` of the full catalog.
const WEATHER: usize = 1;
const WEATHER_NEW: usize = 2;

struct Built {
    manifest: Value,
    archive: Vec<u8>,
}

fn read_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).expect("package source directory") {
            let path = entry.expect("package source entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .expect("inside the source tree")
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(relative, fs::read(&path).expect("package source file"));
            }
        }
    }
    files
}

/// The package of `fixtures/package-src/<source>` with its manifest edited.
fn package(source: &str, edit: impl FnOnce(&mut Value)) -> Built {
    let mut files = read_tree(&fixtures_root().join("package-src").join(source));
    let mut manifest: Value =
        serde_json::from_slice(&files["manifest.json"]).expect("manifest source is JSON");
    edit(&mut manifest);
    files.insert(
        "manifest.json".into(),
        serde_json::to_vec_pretty(&manifest).expect("manifest"),
    );
    let archive = write_package(&files).expect("package sources are valid");
    Built { manifest, archive }
}

fn target(built: &Built, status: &str) -> Value {
    let id = built.manifest["id"].as_str().expect("id");
    let version = built.manifest["version"].as_str().expect("version");
    let digest = hex(&sha256(&built.archive));
    json!({
        "manifest": built.manifest,
        "status": status,
        "package": {
            "url": format!("{BASE}packages/{id}/{version}/{digest}.ocpkg"),
            "size": built.archive.len(),
            "sha256": digest,
        }
    })
}

fn sign(domain: &[u8], payload: &[u8]) -> [u8; 64] {
    conformance_key()
        .sign(&[domain, payload].concat())
        .as_ref()
        .try_into()
        .expect("Ed25519 signatures are 64 bytes")
}

fn envelope(payload: &Value) -> Vec<u8> {
    let bytes = serde_json::to_vec(payload).expect("payload serializes");
    encode_envelope(CONFORMANCE_KEY_ID, &bytes, &sign(CATALOG_V2_DOMAIN, &bytes))
}

fn edit(value: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut value = value.clone();
    change(&mut value);
    value
}

fn object(value: &mut Value) -> &mut serde_json::Map<String, Value> {
    value.as_object_mut().expect("an object")
}

fn list(value: &mut Value) -> &mut Vec<Value> {
    value.as_array_mut().expect("a list")
}

struct Packages {
    clock: Built,
    weather_old: Built,
    weather: Built,
    weather_quiet: Built,
    focus: Built,
}

fn packages() -> Packages {
    Packages {
        clock: package("clock", |_| {}),
        weather_old: package("weather", |manifest| manifest["version"] = json!("2.2.0")),
        weather: package("weather", |_| {}),
        weather_quiet: package("weather", |manifest| {
            manifest["version"] = json!("2.4.0");
            object(&mut manifest["permissions"]).remove("network");
        }),
        focus: package("minimal", |manifest| {
            manifest["id"] = json!("nightowl.focus")
        }),
    }
}

fn full(packages: &Packages) -> Value {
    let preview = "ab".repeat(32);
    let mut weather = target(&packages.weather, "verified");
    weather["releaseNotes"] = json!({
        "en": "Seven-day forecast.\nFaster refresh after a match.",
        "fr": "Prévisions sur sept jours.\nActualisation plus rapide après un match."
    });
    json!({
        "formatVersion": 2,
        "sequence": 1,
        "generatedAt": "2026-09-30T00:00:00Z",
        "expiresAt": "2026-10-30T00:00:00Z",
        "categories": INITIAL_CATEGORIES
            .iter()
            .map(|(id, en, fr)| json!({"id": id, "labels": {"en": en, "fr": fr}}))
            .collect::<Vec<_>>(),
        "publishers": [
            {"handle": "playervox", "name": "PlayerVox", "domains": ["playervox.com"], "verifiedDomain": "playervox.com"},
            {"handle": "example-labs", "name": "Example Labs", "domains": ["example.com"], "verifiedDomain": "example.com"},
            {"handle": "nightowl", "name": "Night Owl Studio"}
        ],
        "widgets": [
            {
                "id": "com.playervox.clock",
                "publisher": "playervox",
                "tags": ["built-in"],
                "listing": {
                    "defaultLocale": "en",
                    "description": {
                        "en": "Shows the local time of day.",
                        "fr": "Affiche l’heure locale."
                    },
                    "category": "productivity",
                    "spdxLicense": "MIT",
                    "support": {"url": "https://github.com/Valhallab/playervox-overcrow-releases/issues"},
                    "sourceUrl": "https://github.com/Valhallab/playervox-overcrow-releases/tree/main/widgets/clock"
                },
                "preview": {
                    "url": format!("{BASE}previews/com.playervox.clock/{preview}.png"),
                    "mediaType": "image/png",
                    "size": 4096,
                    "sha256": preview
                }
            },
            {
                "id": "com.example.weather",
                "publisher": "example-labs",
                "listing": {
                    "defaultLocale": "en",
                    "description": {
                        "en": "Weather of your city between matches.\nMetric or imperial units.",
                        "fr": "La météo de votre ville entre deux parties.",
                        "de": "Das Wetter Ihrer Stadt zwischen zwei Spielen."
                    },
                    "category": "game-tools",
                    "games": [
                        {"id": 1942, "slug": "the-witcher-3-wild-hunt", "name": "The Witcher 3: Wild Hunt"},
                        {"id": 115, "slug": "league-of-legends", "name": "League of Legends"}
                    ],
                    "spdxLicense": "LicenseRef-Proprietary",
                    "support": {"email": "support@example.com"},
                    "privacyPolicyUrl": "https://example.com/privacy"
                }
            },
            {
                "id": "nightowl.focus",
                "publisher": "nightowl",
                "listing": {
                    "defaultLocale": "en",
                    "description": {"en": "A quiet focus timer for long sessions."},
                    "category": "other",
                    "spdxLicense": "MIT OR Apache-2.0",
                    "support": {"url": "https://nightowl.example/support/"},
                    "sourceUrl": "https://codeberg.org/nightowl/focus"
                }
            }
        ],
        "targets": [
            target(&packages.clock, "verified"),
            target(&packages.weather_old, "revoked"),
            weather,
            target(&packages.focus, "verified")
        ]
    })
}

/// `<id>/<version>` → archive of every package the vectors list.
pub fn archives() -> BTreeMap<String, Vec<u8>> {
    let packages = packages();
    [
        &packages.clock,
        &packages.weather_old,
        &packages.weather,
        &packages.weather_quiet,
        &packages.focus,
    ]
    .into_iter()
    .map(|built| {
        let id = built.manifest["id"].as_str().expect("id");
        let version = built.manifest["version"].as_str().expect("version");
        (format!("{id}/{version}"), built.archive.clone())
    })
    .collect()
}

/// Relative path → bytes of every generated vector.
pub fn generate() -> BTreeMap<String, Vec<u8>> {
    let packages = packages();
    let full = full(&packages);
    let mut out = BTreeMap::new();
    let mut put = |name: &str, bytes: Vec<u8>| {
        out.insert(format!("catalog-v2/{name}.json"), bytes);
    };

    // Valid catalogs.
    put("valid/full", envelope(&full));
    put(
        "valid/empty",
        envelope(&edit(&full, |c| {
            c["publishers"] = json!([]);
            c["widgets"] = json!([]);
            c["targets"] = json!([]);
        })),
    );
    put(
        "valid/suspended-built-in",
        envelope(&edit(&full, |c| {
            c["targets"][0]["status"] = json!("security-suspended")
        })),
    );
    put(
        "valid/new-category",
        envelope(&edit(&full, |c| {
            list(&mut c["categories"]).insert(
                0,
                json!({"id": "racing", "labels": {"en": "Racing", "fr": "Course"}}),
            );
            c["widgets"][WEATHER]["listing"]["category"] = json!("racing");
        })),
    );
    put(
        "valid/spdx-expression",
        envelope(&edit(&full, |c| {
            c["widgets"][2]["listing"]["spdxLicense"] =
                json!("GPL-3.0-or-later WITH Classpath-exception-2.0");
        })),
    );
    put(
        "valid/unknown-members",
        envelope(&edit(&full, |c| {
            c["collections"] = json!([{"id": "featured", "widgets": ["nightowl.focus"]}]);
            c["categories"][0]["icon"] = json!("swords");
            c["publishers"][1]["logo"] = json!({"url": "https://example.com/logo.png"});
            c["widgets"][WEATHER]["price"] = json!({"amount": 0, "currency": "EUR"});
            c["widgets"][WEATHER]["listing"]["trailerUrl"] = json!("https://example.com/trailer");
            c["widgets"][WEATHER]["listing"]["support"]["hours"] = json!("9:00-17:00");
            c["widgets"][WEATHER]["listing"]["games"][0]["cover"] = json!("cover.png");
            c["widgets"][0]["preview"]["width"] = json!(800);
            c["targets"][3]["minimumApp"] = json!("0.7.0");
            c["targets"][3]["package"]["mirror"] = json!("https://mirror.example/focus.ocpkg");
        })),
    );
    put(
        "valid/requires-widget",
        envelope(&edit(&full, |c| {
            list(&mut c["widgets"]).push(json!({
                "id": "nightowl.premium",
                "requires": ["entitlement"],
                "publisher": "nightowl",
                "listing": {"price": {"amount": 299, "currency": "EUR"}}
            }));
            // Its version is skipped by ID, unread: a newer manifest.
            list(&mut c["targets"]).push(json!({
                "manifest": {"schemaVersion": 2, "apiVersion": 2, "id": "nightowl.premium", "version": "1.0.0"},
                "status": "verified",
                "package": {"url": "https://overcrow.playervox.com/marketplace/widgets/v2/paid/nightowl.premium"}
            }));
        })),
    );
    put(
        "valid/requires-malformed",
        envelope(&edit(&full, |c| {
            // A malformed requirement skips the entry, never the catalog.
            c["widgets"][2]["requires"] = json!(["Paid Widgets", "catalog.entitlement"]);
        })),
    );
    put(
        "valid/requires-target",
        envelope(&edit(&full, |c| {
            list(&mut c["targets"]).push(json!({
                "requires": ["api-v2"],
                "manifest": {"schemaVersion": 2, "apiVersion": 2, "id": "nightowl.focus", "version": "1.0.0"},
                "status": "verified"
            }));
        })),
    );

    // Envelope and signature.
    let payload = serde_json::to_vec(&full).expect("payload");
    put(
        "invalid/signature--v1-domain",
        encode_envelope(
            CONFORMANCE_KEY_ID,
            &payload,
            &sign(CATALOG_DOMAIN, &payload),
        ),
    );
    put(
        "invalid/signature--seed-domain",
        encode_envelope(CONFORMANCE_KEY_ID, &payload, &sign(SEED_DOMAIN, &payload)),
    );
    let tampered = serde_json::to_vec(&edit(&full, |c| c["sequence"] = json!(2))).expect("payload");
    put(
        "invalid/signature--tampered-payload",
        encode_envelope(
            CONFORMANCE_KEY_ID,
            &tampered,
            &sign(CATALOG_V2_DOMAIN, &payload),
        ),
    );
    put(
        "invalid/format_version--v1-envelope",
        overcrow_widget_schema::catalog::encode_envelope(
            CONFORMANCE_KEY_ID,
            &payload,
            &sign(CATALOG_V2_DOMAIN, &payload),
        ),
    );
    put(
        "invalid/key_unknown--production-key-id",
        encode_envelope(
            "overcrow-widgets-2026-01",
            &payload,
            &sign(CATALOG_V2_DOMAIN, &payload),
        ),
    );
    let text = String::from_utf8(envelope(&full)).expect("envelope is ASCII");
    put(
        "invalid/envelope--unknown-field",
        text.replacen(
            "{\"formatVersion\"",
            "{\"requires\":[],\"formatVersion\"",
            1,
        )
        .into_bytes(),
    );

    // Payload.
    let mut signed = |name: &str, change: &dyn Fn(&mut Value)| {
        out.insert(
            format!("catalog-v2/invalid/{name}.json"),
            envelope(&edit(&full, change)),
        );
    };
    signed("format_version--payload-v1", &|c| {
        c["formatVersion"] = json!(1)
    });
    signed("sequence--zero", &|c| c["sequence"] = json!(0));
    signed("time--lifetime-over-90-days", &|c| {
        c["expiresAt"] = json!("2026-12-30T00:00:00Z")
    });
    signed("not_yet_valid--generated-tomorrow", &|c| {
        c["generatedAt"] = json!("2026-10-02T00:00:00Z")
    });
    signed("expired--past-catalog", &|c| {
        c["generatedAt"] = json!("2026-08-01T00:00:00Z");
        c["expiresAt"] = json!("2026-09-01T00:00:00Z");
    });
    signed("payload--targets-missing", &|c| {
        object(c).remove("targets");
    });

    // Categories.
    signed("category--missing-other", &|c| {
        list(&mut c["categories"]).pop();
    });
    signed("category--label-without-english", &|c| {
        c["categories"][0]["labels"] = json!({"fr": "Outils de jeu"})
    });
    signed("category_ref--unknown", &|c| {
        c["widgets"][WEATHER]["listing"]["category"] = json!("racing")
    });

    // Publishers and domains.
    signed("publisher--bidi-override-in-name", &|c| {
        c["publishers"][2]["name"] = json!("Night Owl \u{202e}oiduts")
    });
    signed("publisher--duplicate-handle", &|c| {
        let first = c["publishers"][2].clone();
        list(&mut c["publishers"]).push(first);
    });
    signed("publisher--verified-domain-not-owned", &|c| {
        c["publishers"][1]["verifiedDomain"] = json!("example.org")
    });
    signed("domain--shared-across-publishers", &|c| {
        c["publishers"][2]["domains"] = json!(["example.com"])
    });
    signed("domain--nested-across-publishers", &|c| {
        c["publishers"][2]["domains"] = json!(["labs.example.com"])
    });
    signed("domain--playervox-for-another", &|c| {
        c["publishers"][2]["domains"] = json!(["playervox.com"])
    });

    // Widgets.
    signed("publisher_ref--unknown-publisher", &|c| {
        c["widgets"][2]["publisher"] = json!("ghost")
    });
    signed("duplicate_widget--same-id", &|c| {
        let first = c["widgets"][2].clone();
        list(&mut c["widgets"]).push(first);
    });
    signed("ownership--other-handle", &|c| {
        c["widgets"][2]["publisher"] = json!("example-labs")
    });
    signed("ownership--reserved-prefix", &|c| {
        c["widgets"][0]["publisher"] = json!("example-labs");
        object(&mut c["widgets"][0]).remove("tags");
    });
    signed("built_in_id--playervox-handle-id", &|c| {
        c["widgets"][0]["id"] = json!("playervox.clock");
        object(&mut c["widgets"][0]).remove("preview");
        c["targets"][0]["manifest"]["id"] = json!("playervox.clock");
    });
    signed("built_in_id--third-party", &|c| {
        c["widgets"][2]["tags"] = json!(["built-in"])
    });
    signed("tag--unknown", &|c| {
        c["widgets"][0]["tags"] = json!(["built-in", "featured"])
    });
    signed("preview--v1-path", &|c| {
        let url = c["widgets"][0]["preview"]["url"]
            .as_str()
            .expect("url")
            .replace("/widgets/v2/", "/widgets/v1/");
        c["widgets"][0]["preview"]["url"] = json!(url);
    });

    // Listings.
    signed("default_locale--french", &|c| {
        c["widgets"][WEATHER]["listing"]["defaultLocale"] = json!("fr")
    });
    signed("description--17-locales", &|c| {
        let description = object(&mut c["widgets"][WEATHER]["listing"]["description"]);
        for locale in [
            "es", "it", "pt", "nl", "pl", "sv", "da", "fi", "nb", "cs", "hu", "ro", "tr", "el",
        ] {
            description.insert(locale.into(), json!("Météo."));
        }
    });
    signed("description--501-characters", &|c| {
        c["widgets"][WEATHER]["listing"]["description"]["en"] = json!("é".repeat(501))
    });
    signed("description--markup", &|c| {
        c["widgets"][WEATHER]["listing"]["description"]["en"] = json!("<b>Weather</b>")
    });
    signed("games--six-games", &|c| {
        c["widgets"][WEATHER]["listing"]["games"] = json!(
            (1..=6)
                .map(|id| json!({"id": id, "slug": format!("game-{id}"), "name": "Game"}))
                .collect::<Vec<_>>()
        );
    });
    signed("license--other-license-ref", &|c| {
        c["widgets"][WEATHER]["listing"]["spdxLicense"] = json!("LicenseRef-Autre")
    });
    signed("license--proprietary-in-expression", &|c| {
        c["widgets"][WEATHER]["listing"]["spdxLicense"] = json!("MIT OR LicenseRef-Proprietary")
    });
    signed("support--missing", &|c| {
        object(&mut c["widgets"][WEATHER]["listing"]).remove("support");
    });
    signed("support--url-and-email", &|c| {
        c["widgets"][WEATHER]["listing"]["support"] =
            json!({"url": "https://example.com/help", "email": "support@example.com"});
    });
    signed("privacy_policy--network-without-policy", &|c| {
        object(&mut c["widgets"][WEATHER]["listing"]).remove("privacyPolicyUrl");
    });
    let quiet = target(&packages.weather_quiet, "verified");
    signed("privacy_policy--only-old-version-uses-network", &|c| {
        object(&mut c["widgets"][WEATHER]["listing"]).remove("privacyPolicyUrl");
        c["targets"][WEATHER_NEW] = quiet.clone();
    });
    signed("source_url--http", &|c| {
        c["widgets"][2]["listing"]["sourceUrl"] = json!("http://codeberg.org/nightowl/focus")
    });

    // Targets.
    signed("status--unknown", &|c| {
        c["targets"][3]["status"] = json!("deprecated")
    });
    signed("url--v1-package-path", &|c| {
        let url = c["targets"][3]["package"]["url"]
            .as_str()
            .expect("url")
            .replace("/widgets/v2/", "/widgets/v1/");
        c["targets"][3]["package"]["url"] = json!(url);
    });
    signed("package_ref--uppercase-digest", &|c| {
        let digest = c["targets"][3]["package"]["sha256"]
            .as_str()
            .expect("digest")
            .to_uppercase();
        c["targets"][3]["package"]["sha256"] = json!(digest);
    });
    signed("release_notes--no-english", &|c| {
        c["targets"][WEATHER_NEW]["releaseNotes"] = json!({"fr": "Corrections."})
    });
    signed("manifest--legacy-web-manifest", &|c| {
        c["targets"][3]["manifest"] = json!({
            "schemaVersion": 1, "id": "nightowl.focus", "version": "0.1.0",
            "apiVersion": "1", "entrypoints": {"view": "index.html"},
            "permissions": {}, "files": {}
        });
    });
    signed("unknown_widget--orphan-target", &|c| {
        c["targets"][3]["manifest"]["id"] = json!("nightowl.other")
    });
    signed("duplicate_target--same-version", &|c| {
        let first = c["targets"][3].clone();
        list(&mut c["targets"]).push(first);
    });
    out
}
