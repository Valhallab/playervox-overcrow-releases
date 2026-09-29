//! Conformance fixtures of the P0.5 package format: manifest v1, compiled
//! view, `.ocpkg` v1, signed catalog, offline seed and built-in lifecycle. An
//! invalid fixture is named `<expected error>--<case>`.

mod fixture_gen;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use overcrow_widget_schema::catalog::{
    BuiltInAction, CONFORMANCE_KEY_ID, Document, Installed, Origin, Seed, SeedUse, Target,
    TargetStatus, built_in_offers, is_production_key_id, open_envelope, plan_built_in, seed_use,
    validate_catalog, validate_seed, verify_target_package,
};
use overcrow_widget_schema::compiled_view::{ViewError, validate_compiled_view};
use overcrow_widget_schema::limits::{
    MAX_DNS_LABEL_BYTES, MAX_PACKAGE_BYTES, MAX_PARAMETER_NAME_BYTES, MAX_SLUG_PARAMETER_BYTES,
    VM_HEAP_BYTES,
};
use overcrow_widget_schema::manifest::{ManifestError, is_reserved_id, validate_manifest};
use overcrow_widget_schema::package::{
    FILE_CLASSES, PackageError, hex, read_package, sha256, stored_zip, write_package,
};
use overcrow_widget_schema::version::Version;
use ring::signature::{ED25519, KeyPair as _, UnparsedPublicKey};

use fixture_gen::{NOW, conformance_key, fixtures_root};

/// `(case name, path)` of every entry of `fixtures/<area>/<kind>`, sorted.
fn cases(area: &str, kind: &str) -> Vec<(String, PathBuf)> {
    let directory = fixtures_root().join(area).join(kind);
    let mut cases: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|_| panic!("{} exists", directory.display()))
        .map(|entry| {
            let path = entry.expect("fixture entry").path();
            let name = path
                .file_stem()
                .expect("fixture has a name")
                .to_string_lossy()
                .into_owned();
            (name, path)
        })
        .collect();
    cases.sort();
    assert!(!cases.is_empty(), "no {area}/{kind} fixtures");
    cases
}

fn expected_error(name: &str) -> &str {
    name.split_once("--")
        .map(|(error, _)| error)
        .unwrap_or_else(|| panic!("{name} names its error"))
}

fn read(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap_or_else(|_| panic!("{} is readable", path.display()))
}

#[test]
fn generated_fixtures_are_current_and_deterministic() {
    let generated = fixture_gen::generate();
    let mut committed = BTreeMap::new();
    let root = fixtures_root();
    let mut stack: Vec<PathBuf> = fixture_gen::GENERATED_DIRS
        .iter()
        .map(|directory| root.join(directory))
        .collect();
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).expect("generated directory") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let relative = path.strip_prefix(&root).expect("inside fixtures");
                committed.insert(relative.to_string_lossy().replace('\\', "/"), read(&path));
            }
        }
    }
    let key = fixture_gen::CONFORMANCE_KEY_FILE;
    committed.insert(key.to_owned(), read(&root.join(key)));
    let names = |map: &BTreeMap<String, Vec<u8>>| map.keys().cloned().collect::<Vec<_>>();
    assert_eq!(
        names(&committed),
        names(&generated),
        "run `cargo run -p overcrow-widget-schema --example fixtures`"
    );
    for (path, bytes) in &generated {
        assert!(committed[path] == *bytes, "{path} is stale");
    }
    assert_eq!(
        fixture_gen::generate(),
        generated,
        "generation is deterministic"
    );
}

#[test]
fn manifest_fixtures() {
    for (name, path) in cases("manifest", "valid") {
        let manifest = validate_manifest(&read(&path)).unwrap_or_else(|error| {
            panic!("{name}: {}", error.as_str());
        });
        assert!(manifest.heap_bytes >= VM_HEAP_BYTES.value, "{name}");
    }
    for (name, path) in cases("manifest", "invalid") {
        let error = validate_manifest(&read(&path)).expect_err(&name);
        assert_eq!(error.as_str(), expected_error(&name), "{name}");
    }
}

#[test]
fn manifest_requires_lists_the_host_features_the_widget_needs() {
    let requires = |name: &str| {
        let path = fixtures_root().join("manifest/valid").join(name);
        validate_manifest(&read(&path)).expect(name).requires
    };
    assert!(requires("minimal.json").is_empty(), "absent: nothing");
    assert_eq!(
        requires("requires-fps.json")
            .into_iter()
            .collect::<Vec<_>>(),
        ["fps"]
    );
}

#[test]
fn manifest_heap_request_is_whole_mib_between_16_and_48() {
    let heap = |name: &str| {
        let path = fixtures_root().join("manifest/valid").join(name);
        validate_manifest(&read(&path)).expect(name).heap_bytes
    };
    assert_eq!(heap("minimal.json"), 16 << 20, "default heap");
    assert_eq!(heap("heap-16-mib.json"), 16 << 20);
    assert_eq!(heap("third-party-network.json"), 32 << 20);
    assert_eq!(heap("heap-48-mib.json"), 48 << 20);
}

/// The grammar bounds of the manifest come from `limits`: each edge case is
/// accepted at the bound and rejected one past it.
#[test]
fn manifest_grammar_bounds_come_from_the_limits() {
    let base: serde_json::Value =
        serde_json::from_slice(&read(&fixtures_root().join("manifest/valid/minimal.json")))
            .expect("minimal manifest");
    let check = |edit: &dyn Fn(&mut serde_json::Value)| {
        let mut manifest = base.clone();
        edit(&mut manifest);
        validate_manifest(manifest.to_string().as_bytes())
            .map(|_| ())
            .map_err(|error| error.as_str())
    };
    let label = |bytes: u64| "a".repeat(bytes as usize);
    let at = MAX_DNS_LABEL_BYTES.value;
    assert_eq!(
        check(&|m| m["id"] = format!("com.{}", label(at)).into()),
        Ok(())
    );
    assert_eq!(
        check(&|m| m["id"] = format!("com.{}", label(at + 1)).into()),
        Err("id")
    );
    let rule = |origin: String, name: u64, slug: u64| {
        serde_json::json!({"network": [{
            "origin": origin,
            "method": "GET",
            "path": "/v1/items",
            "queryParams": {label(name): {"type": "slug", "maxLength": slug}},
        }]})
    };
    let host = format!("https://{}.example", label(at));
    let (name, slug) = (
        MAX_PARAMETER_NAME_BYTES.value,
        MAX_SLUG_PARAMETER_BYTES.value,
    );
    assert_eq!(
        check(&|m| m["permissions"] = rule(host.clone(), name, slug)),
        Ok(())
    );
    for permissions in [
        rule(format!("https://{}.example", label(at + 1)), name, slug),
        rule(host.clone(), name + 1, slug),
        rule(host.clone(), name, slug + 1),
    ] {
        assert_eq!(
            check(&|m| m["permissions"] = permissions.clone()),
            Err("network_rule")
        );
    }
    assert_eq!(
        check(&|m| m["sizing"]["fit"] = "width".into()),
        Err("sizing")
    );
}

#[test]
fn manifest_size_is_bounded() {
    let mut bytes = read(&fixtures_root().join("manifest/valid/minimal.json"));
    bytes.resize(64 * 1024 + 1, b' ');
    assert_eq!(
        validate_manifest(&bytes).map(|_| ()).unwrap_err().as_str(),
        "size"
    );
}

#[test]
fn compiled_view_fixtures() {
    let assets = BTreeSet::from(["assets/logo.png".to_owned()]);
    for (name, path) in cases("view", "valid") {
        if let Err(error) = validate_compiled_view(&read(&path), &assets) {
            panic!("{name}: {}", error.as_str());
        }
    }
    for (name, path) in cases("view", "invalid") {
        let error = validate_compiled_view(&read(&path), &assets).expect_err(&name);
        assert_eq!(error.as_str(), expected_error(&name), "{name}");
    }
}

#[test]
fn package_fixtures() {
    for (name, path) in cases("package", "valid") {
        let bytes = read(&path);
        let package = read_package(&bytes).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(package.digest, sha256(&bytes), "{name}");
        // Determinism: the writer reproduces the exact archive from its files.
        let files: BTreeMap<String, Vec<u8>> = package
            .paths()
            .filter(|path| *path != "ledger.json")
            .map(|path| {
                (
                    path.to_owned(),
                    package.file(path).expect("listed").to_vec(),
                )
            })
            .collect();
        assert_eq!(write_package(&files).expect(&name), bytes, "{name}");
    }
    for (name, path) in cases("package", "invalid") {
        let error = read_package(&read(&path)).expect_err(&name);
        assert_eq!(error.as_str(), expected_error(&name), "{name}: {error:?}");
    }
}

#[test]
fn package_errors_keep_the_inner_reason() {
    let reason = |name: &str| {
        let path = fixtures_root().join(format!("package/invalid/{name}.ocpkg"));
        read_package(&read(&path)).expect_err(name)
    };
    assert_eq!(
        reason("view--missing-asset"),
        PackageError::View(ViewError::MissingAsset)
    );
    assert_eq!(
        reason("manifest--legacy-web-manifest"),
        PackageError::Manifest(ManifestError::ApiVersion)
    );
}

#[test]
fn package_size_and_file_size_are_bounded() {
    let oversized = vec![0u8; MAX_PACKAGE_BYTES.value as usize + 1];
    assert_eq!(
        read_package(&oversized).unwrap_err(),
        PackageError::ArchiveSize
    );

    let license = vec![b'x'; 64 * 1024 + 1];
    let archive = stored_zip(&[("LICENSE", &license)]);
    assert_eq!(read_package(&archive).unwrap_err(), PackageError::FileSize);
}

#[test]
fn only_logic_js_is_executable_content() {
    let executable: Vec<&str> = FILE_CLASSES
        .iter()
        .map(|class| class.path)
        .filter(|path| path.ends_with(".js"))
        .collect();
    assert_eq!(executable, ["logic.js"]);
    assert!(FILE_CLASSES.iter().all(|class| class.path != "view.ocml"));
}

/// Verifies an envelope's signature with the trusted keys, as the host does.
fn verify(bytes: &[u8], document: Document) -> Result<Vec<u8>, String> {
    let envelope = open_envelope(bytes, document).map_err(|error| error.as_str().to_owned())?;
    if envelope.key_id != CONFORMANCE_KEY_ID {
        return Err("key_unknown".into());
    }
    let key = conformance_key();
    UnparsedPublicKey::new(&ED25519, key.public_key().as_ref())
        .verify(&envelope.signed_message(), &envelope.signature)
        .map_err(|_| "signature".to_owned())?;
    Ok(envelope.payload)
}

fn catalog(bytes: &[u8]) -> Result<Vec<Target>, String> {
    let payload = verify(bytes, Document::Catalog)?;
    validate_catalog(&payload, NOW, Origin::Production)
        .map(|catalog| catalog.targets)
        .map_err(|error| error.as_str().to_owned())
}

#[test]
fn conformance_key_is_public_and_never_production() {
    let committed = fs::read_to_string(fixtures_root().join(fixture_gen::CONFORMANCE_KEY_FILE))
        .expect("conformance key file");
    assert_eq!(
        committed.trim(),
        hex(conformance_key().public_key().as_ref())
    );
    assert!(!is_production_key_id(CONFORMANCE_KEY_ID));
}

/// The legacy Web catalog must fail on its format, not on a broken
/// signature: it verifies under the repository's public development key.
#[test]
fn legacy_web_catalog_is_validly_signed_by_the_development_key() {
    let path = fixtures_root().join("catalog/invalid/format_version--legacy-web-catalog.json");
    let envelope: serde_json::Value =
        serde_json::from_slice(&read(&path)).expect("legacy envelope is JSON");
    assert_eq!(envelope["keyId"], "overcrow-development-2026");
    let decode = |field: &str| {
        URL_SAFE_NO_PAD
            .decode(envelope[field].as_str().expect("base64url field"))
            .expect("unpadded base64url")
    };
    let public_key = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/keys/development-ed25519.pub"),
    )
    .expect("public development key");
    let public_key: Vec<u8> = (0..64)
        .step_by(2)
        .map(|index| u8::from_str_radix(&public_key.trim()[index..index + 2], 16).expect("hex"))
        .collect();
    assert_eq!(
        public_key,
        fixture_gen::legacy_development_key().public_key().as_ref()
    );
    UnparsedPublicKey::new(&ED25519, &public_key)
        .verify(&decode("payload"), &decode("signature"))
        .expect("legacy Web catalog signature");
}

#[test]
fn catalog_fixtures() {
    for (name, path) in cases("catalog", "valid") {
        catalog(&read(&path)).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    for (name, path) in cases("catalog", "invalid") {
        let error = catalog(&read(&path)).expect_err(&name);
        assert_eq!(error, expected_error(&name), "{name}");
    }
}

#[test]
fn catalog_targets_bind_the_package_fixtures() {
    let targets = catalog(&read(
        &fixtures_root().join("catalog/valid/built-in-and-third-party.json"),
    ))
    .expect("valid catalog");
    for target in &targets {
        let name = target.manifest.id.rsplit('.').next().expect("id");
        let bytes = read(&fixtures_root().join(format!("package/valid/{name}.ocpkg")));
        verify_target_package(&bytes, target).expect(name);
    }
    let offers = built_in_offers(&targets);
    assert_eq!(
        offers.keys().copied().collect::<Vec<_>>(),
        ["com.playervox.clock"]
    );
    // A package fixture checked against another target fails closed.
    let other = read(&fixtures_root().join("package/valid/minimal.ocpkg"));
    assert_eq!(
        verify_target_package(&other, &targets[0])
            .unwrap_err()
            .as_str(),
        "package_size"
    );
}

#[test]
fn catalog_targets_keep_their_signed_preview() {
    let targets =
        catalog(&read(&fixtures_root().join("catalog/valid/preview.json"))).expect("valid catalog");
    let preview = targets[0].preview.as_ref().expect("preview kept");
    assert_eq!(preview.size, 4096);
    assert_eq!(preview.sha256, [0xab; 32]);
    assert!(preview.url.ends_with(&format!("/{}.png", "ab".repeat(32))));
    let targets = catalog(&read(
        &fixtures_root().join("catalog/valid/built-in-and-third-party.json"),
    ))
    .expect("valid catalog");
    assert!(targets.iter().all(|target| target.preview.is_none()));
}

#[test]
fn a_seed_never_verifies_as_a_catalog() {
    let seed = read(&fixtures_root().join("seed/valid/built-in-clock/seed.json"));
    assert_eq!(catalog(&seed).unwrap_err(), "signature");
}

/// Full offline-seed admission: signature, validity, exact directory
/// inventory and every package against its target.
fn admit_seed(directory: &Path) -> Result<Seed, String> {
    let payload = verify(&read(&directory.join("seed.json")), Document::Seed)?;
    let seed = validate_seed(&payload, NOW, Origin::Production)
        .map_err(|error| error.as_str().to_owned())?;
    let mut present = BTreeSet::new();
    let packages = directory.join("packages");
    if packages.is_dir() {
        for entry in fs::read_dir(&packages).expect("packages directory") {
            let name = entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned();
            present.insert(format!("packages/{name}"));
        }
    }
    let expected: BTreeSet<String> = seed.targets.iter().map(Seed::package_path).collect();
    if present != expected {
        return Err("seed_inventory".into());
    }
    for target in &seed.targets {
        let bytes = read(&directory.join(Seed::package_path(target)));
        verify_target_package(&bytes, target).map_err(|error| error.as_str().to_owned())?;
    }
    Ok(seed)
}

#[test]
fn seed_fixtures() {
    for (name, path) in cases("seed", "valid") {
        admit_seed(&path).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    for (name, path) in cases("seed", "invalid") {
        let error = admit_seed(&path).expect_err(&name);
        assert_eq!(error, expected_error(&name), "{name}");
    }
}

#[test]
fn seed_expiry_is_checked_against_the_host_clock() {
    let directory = fixtures_root().join("seed/valid/built-in-clock");
    let payload = verify(&read(&directory.join("seed.json")), Document::Seed).expect("signed");
    // Valid from its generation (with the clock-skew allowance) to its expiry.
    let generated = 1_790_726_400; // 2026-09-30T00:00:00Z
    let expires = 1_822_262_400; // 2027-09-30T00:00:00Z
    let at = |now| validate_seed(&payload, now, Origin::Production).map(|_| ());
    assert!(at(generated - 300).is_ok());
    assert_eq!(at(generated - 301).unwrap_err().as_str(), "not_yet_valid");
    assert!(at(expires - 1).is_ok());
    assert_eq!(at(expires).unwrap_err().as_str(), "expired");
}

#[test]
fn seed_never_replaces_a_newer_catalog_state() {
    let seed = admit_seed(&fixtures_root().join("seed/valid/built-in-clock")).expect("seed");
    assert_eq!(seed.catalog_sequence, 1);
    assert_eq!(seed_use(&seed, None), SeedUse::Apply);
    assert_eq!(seed_use(&seed, Some(1)), SeedUse::Superseded);
    assert_eq!(seed_use(&seed, Some(7)), SeedUse::Superseded);
}

#[test]
fn built_in_lifecycle_keeps_the_user_choice() {
    let seed = admit_seed(&fixtures_root().join("seed/valid/built-in-clock")).expect("seed");
    let target = &seed.targets[0];
    let permissions = target.manifest.permissions.clone();
    let older = Version::parse("0.9.0").expect("version");
    let same = target.manifest.version.clone();
    let newer = Version::parse("1.1.0").expect("version");
    let present = |version| Installed::Present {
        version,
        permissions: &permissions,
    };

    assert_eq!(
        plan_built_in(target, Installed::Absent),
        BuiltInAction::Install
    );
    assert_eq!(
        plan_built_in(target, Installed::RemovedByUser),
        BuiltInAction::SkipRemovedByUser,
        "an uninstalled built-in is never reinstalled by a seed, a catalog or an update"
    );
    assert_eq!(
        plan_built_in(target, present(&older)),
        BuiltInAction::Update
    );
    assert_eq!(plan_built_in(target, present(&same)), BuiltInAction::Keep);
    assert_eq!(
        plan_built_in(target, present(&newer)),
        BuiltInAction::Keep,
        "never downgrade"
    );

    let mut narrower = permissions.clone();
    narrower.capabilities.clear();
    let mut widened = target.clone();
    widened.manifest.permissions.capabilities.insert("fps.read");
    assert_eq!(
        plan_built_in(
            &widened,
            Installed::Present {
                version: &older,
                permissions: &narrower,
            }
        ),
        BuiltInAction::UpdateAfterConsent
    );

    let mut suspended = target.clone();
    suspended.status = TargetStatus::SecuritySuspended;
    assert_eq!(
        plan_built_in(&suspended, Installed::Absent),
        BuiltInAction::NotOffered
    );
    let mut untagged = target.clone();
    untagged.built_in = false;
    assert_eq!(
        plan_built_in(&untagged, Installed::Absent),
        BuiltInAction::NotOffered
    );
}

#[test]
fn reserved_ids_are_playervox_only() {
    for id in ["com.playervox", "com.playervox.clock", "com.playervox.a.b"] {
        assert!(is_reserved_id(id), "{id}");
    }
    for id in [
        "com.playervoxx.clock",
        "com.example.playervox",
        "org.playervox.clock",
    ] {
        assert!(!is_reserved_id(id), "{id}");
    }
    // Local installs refuse reserved IDs: the built-in clock cannot be sideloaded.
    let clock = read_package(&read(&fixtures_root().join("package/valid/clock.ocpkg")))
        .expect("clock package");
    assert!(clock.manifest.has_reserved_id());
}
