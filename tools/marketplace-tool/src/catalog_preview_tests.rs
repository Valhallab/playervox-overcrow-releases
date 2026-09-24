use super::*;

fn preview_relative(bytes: &[u8], version: &str) -> String {
    format!(
        "previews/com.playervox.overcrow.hello/{version}/{}.png",
        hash(bytes)
    )
}

#[test]
fn development_and_production_sign_exact_packaged_preview_descriptors() {
    for path in ["preview.png", "images/screenshot.png"] {
        let png = crate::test_png::png(2, 1);
        let fixture = Fixture::with_preview(Some((path, &png)));
        let relative = preview_relative(&png, "1.0.0");
        let development = directory(fixture.scratch.path(), "development");
        let key = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/keys/development-ed25519.key");
        crate::catalog::stage_development(&crate::catalog::CatalogStageOptions {
            store: &fixture.store,
            review_tree: TREE,
            output: &development,
            sequence: 1,
            generated_at: "2026-09-05T12:00:00Z",
            expires_at: "2026-10-05T12:00:00Z",
            signing_key: &key,
        })
        .unwrap();
        let envelope: Value = read_json(&development.join("catalog.json"), MAX_ENVELOPE).unwrap();
        let payload = URL_SAFE_NO_PAD
            .decode(envelope["payload"].as_str().unwrap())
            .unwrap();
        let parsed: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(
            parsed["targets"][0]["preview"],
            json!({"url":format!("http://127.0.0.1:8787/marketplace/v1/{relative}"),"size":png.len(),"sha256":hash(&png),"mediaType":"image/png"})
        );
        assert!(parsed["targets"][0]["listing"].get("preview").is_none());
        assert_eq!(fs::read(development.join(&relative)).unwrap(), png);

        fixture.prepare();
        let prepared: Value =
            read_json(&fixture.prepared.join("payload.json"), MAX_PAYLOAD).unwrap();
        assert_eq!(
            prepared["targets"][0]["preview"],
            json!({"url":format!("{BASE_URL}{relative}"),"size":png.len(),"sha256":hash(&png),"mediaType":"image/png"})
        );
        assert!(prepared["targets"][0]["listing"].get("preview").is_none());
        let signature = fixture.sign();
        finalize_inner(
            &fixture.finalize_options(&signature),
            fixture.key.public_key().as_ref(),
            now(),
        )
        .unwrap();
        assert_eq!(fs::read(fixture.prepared.join(&relative)).unwrap(), png);
        assert_eq!(fs::read(fixture.output.join(&relative)).unwrap(), png);
        assert_eq!(fixture.prepare(), 1);
    }
}

#[test]
fn finalization_rejects_missing_tampered_symlinked_and_extra_previews() {
    for kind in ["missing", "tampered", "symlink", "extra"] {
        let png = crate::test_png::png(2, 1);
        let fixture = Fixture::with_preview(Some(("preview.png", &png)));
        fixture.prepare();
        let signature = fixture.sign();
        let path = fixture.prepared.join(preview_relative(&png, "1.0.0"));
        match kind {
            "missing" => fs::remove_file(&path).unwrap(),
            "tampered" => fs::write(&path, crate::test_png::png(1, 2)).unwrap(),
            "symlink" => {
                let outside = fixture.scratch.path().join("outside.png");
                fs::rename(&path, &outside).unwrap();
                std::os::unix::fs::symlink(outside, &path).unwrap();
            }
            _ => fs::write(path.parent().unwrap().join("extra.png"), &png).unwrap(),
        }
        assert!(
            finalize_inner(
                &fixture.finalize_options(&signature),
                fixture.key.public_key().as_ref(),
                now()
            )
            .is_err(),
            "{kind}"
        );
        assert!(!fixture.output.join("catalog.json").exists(), "{kind}");
    }
}

#[test]
fn production_retains_preview_history_until_explicit_retirement() {
    for retire in [false, true] {
        let old_png = crate::test_png::png(2, 1);
        let new_png = crate::test_png::png(1, 2);
        let fixture = Fixture::with_preview(Some(("preview.png", &old_png)));
        fixture.prepare();
        let signature = fixture.sign();
        finalize_inner(
            &fixture.finalize_options(&signature),
            fixture.key.public_key().as_ref(),
            now(),
        )
        .unwrap();
        let tree = "4444444444444444444444444444444444444444";
        admit_version_with_preview(
            fixture.scratch.path(),
            &fixture.store,
            tree,
            "2.0.0",
            b"<p>new preview</p>",
            Some(("images/new.png", &new_png)),
        );
        let next = directory(fixture.scratch.path(), "next");
        let output = directory(fixture.scratch.path(), "next-output");
        let mut request: Value = read_json(&fixture.request, MAX_REQUEST).unwrap();
        request["sequence"] = json!(44);
        request["previousSequence"] = json!(43);
        if retire {
            request["removeVersions"] =
                json!([{"id":"com.playervox.overcrow.hello","version":"1.0.0"}]);
        } else {
            request["statuses"] =
                json!([{"id":"com.playervox.overcrow.hello","version":"1.0.0","status":"revoked"}]);
        }
        write_json(&fixture.request, &request);
        let options = PrepareOptions {
            review_tree: tree,
            output: &next,
            previous_output: Some(&fixture.output),
            ..fixture.options()
        };
        assert_eq!(
            prepare_inner(&options, fixture.key.public_key().as_ref(), now()).unwrap(),
            if retire { 1 } else { 2 }
        );
        assert_eq!(
            next.join(preview_relative(&old_png, "1.0.0")).exists(),
            !retire
        );
        assert_eq!(
            fs::read(next.join(preview_relative(&new_png, "2.0.0"))).unwrap(),
            new_png
        );
        fs::write(
            &signature,
            fixture
                .key
                .sign(&fs::read(next.join("payload.json")).unwrap())
                .as_ref(),
        )
        .unwrap();
        finalize_inner(
            &FinalizeOptions {
                prepared: &next,
                state: &fixture.state,
                signature: &signature,
                output: &output,
            },
            fixture.key.public_key().as_ref(),
            now(),
        )
        .unwrap();
        if !retire {
            assert_eq!(
                fs::read(output.join(preview_relative(&old_png, "1.0.0"))).unwrap(),
                old_png
            );
        } else {
            assert!(
                !output
                    .join("previews/com.playervox.overcrow.hello/1.0.0")
                    .exists()
            );
        }
        assert_eq!(
            fs::read(output.join(preview_relative(&new_png, "2.0.0"))).unwrap(),
            new_png
        );
        assert_eq!(
            fs::read(fixture.output.join(preview_relative(&old_png, "1.0.0"))).unwrap(),
            old_png
        );
    }
}

#[test]
fn production_rejects_same_package_version_preview_substitution_from_another_store() {
    let png = crate::test_png::png(2, 1);
    let fixture = Fixture::with_preview(Some(("preview.png", &png)));
    fixture.prepare();
    let signature = fixture.sign();
    finalize_inner(
        &fixture.finalize_options(&signature),
        fixture.key.public_key().as_ref(),
        now(),
    )
    .unwrap();
    let store = directory(fixture.scratch.path(), "another-store");
    let artifacts = directory(fixture.scratch.path(), "another-artifacts");
    fs::write(artifacts.join("1.ocpkg"), &fixture.package_bytes).unwrap();
    let mut listing: Value = read_json(
        &fixture.scratch.path().join("source/listing.json"),
        64 * 1024,
    )
    .unwrap();
    listing.as_object_mut().unwrap().remove("preview");
    let listing = serde_json::to_vec(&listing).unwrap();
    fs::write(artifacts.join("1.listing.json"), &listing).unwrap();
    let receipt = fixture.scratch.path().join("another-receipt.tsv");
    fs::write(&receipt, format!("admission\t2\t{TRUST}\t{REVIEW}\t{TREE}\nartifact\twidgets/hello-web\tcom.playervox.overcrow.hello\t1.0.0\t{}\t{}\t{}\t{}\n",hash(&fixture.package_bytes),fixture.package_bytes.len(),hash(&listing),listing.len())).unwrap();
    admission::ingest(
        &receipt,
        &artifacts,
        &store,
        &admission::ExpectedAdmission {
            trust_sha: TRUST,
            review_sha: REVIEW,
            review_tree: TREE,
        },
    )
    .unwrap();
    let next = directory(fixture.scratch.path(), "next");
    let mut request: Value = read_json(&fixture.request, MAX_REQUEST).unwrap();
    request["sequence"] = json!(44);
    request["previousSequence"] = json!(43);
    write_json(&fixture.request, &request);
    assert!(
        prepare_inner(
            &PrepareOptions {
                store: &store,
                output: &next,
                previous_output: Some(&fixture.output),
                ..fixture.options()
            },
            fixture.key.public_key().as_ref(),
            now()
        )
        .is_err()
    );
    assert!(!next.join("preparation.json").exists());
    assert_eq!(
        read_reservation(&fixture.state).unwrap().unwrap().sequence,
        43
    );
}

#[test]
fn inventory_accepts_both_content_trees_for_the_maximum_target_count() {
    let root = tempfile::tempdir().unwrap();
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let mut expected = BTreeSet::new();
    for kind in ["packages", "previews"] {
        let tree = directory(root.path(), kind);
        for index in 0..500 {
            let id = format!("com.example.widget-{index}");
            let identity = directory(&tree, &id);
            let version = directory(&identity, "1.0.0");
            fs::write(version.join("asset"), b"inventory fixture").unwrap();
            expected.insert(format!("{kind}/{id}/1.0.0/asset"));
        }
    }
    verify_inventory(root.path(), &expected, false)
        .expect("500 packages and 500 previews fit the bounded inventory");
}

#[test]
fn signed_preview_metadata_must_match_fixed_urls_and_packaged_png_bytes() {
    for kind in [
        "external-url",
        "traversal",
        "media-type",
        "zero-size",
        "oversize",
        "wrong-size",
        "uppercase-hash",
        "unpackaged",
        "source-listing-leak",
    ] {
        let png = crate::test_png::png(2, 1);
        let fixture = Fixture::with_preview(Some(("preview.png", &png)));
        fixture.prepare();
        let mut payload: Value =
            read_json(&fixture.prepared.join("payload.json"), MAX_PAYLOAD).unwrap();
        let descriptor = &mut payload["targets"][0]["preview"];
        match kind {
            "external-url" => descriptor["url"] = json!("https://example.test/preview.png"),
            "traversal" => descriptor["url"] = json!(format!("{BASE_URL}previews/../preview.png")),
            "media-type" => descriptor["mediaType"] = json!("image/svg+xml"),
            "zero-size" => descriptor["size"] = json!(0),
            "oversize" => descriptor["size"] = json!(256 * 1024 + 1),
            "wrong-size" => descriptor["size"] = json!(png.len() + 1),
            "uppercase-hash" => descriptor["sha256"] = json!(hash(&png).to_ascii_uppercase()),
            "unpackaged" => {
                let another_png = crate::test_png::png(1, 2);
                fs::remove_file(fixture.prepared.join(preview_relative(&png, "1.0.0"))).unwrap();
                fs::write(
                    fixture
                        .prepared
                        .join(preview_relative(&another_png, "1.0.0")),
                    &another_png,
                )
                .unwrap();
                *descriptor = json!({"url":format!("{BASE_URL}{}", preview_relative(&another_png, "1.0.0")),"sha256":hash(&another_png),"size":another_png.len(),"mediaType":"image/png"});
            }
            _ => payload["targets"][0]["listing"]["preview"] = json!("preview.png"),
        }
        let bytes = serde_json::to_vec(&payload).unwrap();
        fs::write(fixture.prepared.join("payload.json"), &bytes).unwrap();
        let mut marker: Value =
            read_json(&fixture.prepared.join("preparation.json"), 1024).unwrap();
        marker["payloadSha256"] = json!(hash(&bytes));
        write_json(&fixture.prepared.join("preparation.json"), &marker);
        let mut state = read_reservation(&fixture.state).unwrap().unwrap();
        state.payload_sha256 = hash(&bytes);
        write_reservation(&fixture.state, &state).unwrap();
        let signature = fixture.sign();
        assert!(
            finalize_inner(
                &fixture.finalize_options(&signature),
                fixture.key.public_key().as_ref(),
                now()
            )
            .is_err(),
            "{kind}"
        );
        assert!(!fixture.output.join("catalog.json").exists(), "{kind}");
    }
}

#[test]
fn preparation_rejects_corrupt_retained_preview_even_when_version_is_readmitted() {
    let png = crate::test_png::png(2, 1);
    let fixture = Fixture::with_preview(Some(("preview.png", &png)));
    fixture.prepare();
    let signature = fixture.sign();
    finalize_inner(
        &fixture.finalize_options(&signature),
        fixture.key.public_key().as_ref(),
        now(),
    )
    .unwrap();
    fs::write(
        fixture.output.join(preview_relative(&png, "1.0.0")),
        b"corrupt retained image",
    )
    .unwrap();
    let next = directory(fixture.scratch.path(), "next");
    let mut request: Value = read_json(&fixture.request, MAX_REQUEST).unwrap();
    request["sequence"] = json!(44);
    request["previousSequence"] = json!(43);
    write_json(&fixture.request, &request);
    assert!(
        prepare_inner(
            &PrepareOptions {
                output: &next,
                previous_output: Some(&fixture.output),
                ..fixture.options()
            },
            fixture.key.public_key().as_ref(),
            now()
        )
        .is_err()
    );
    assert!(!next.join("preparation.json").exists());
}

#[test]
fn legacy_catalog_null_previews_keep_the_existing_payload_bytes() {
    let fixture = Fixture::new();
    fixture.prepare();
    let bytes = fs::read(fixture.prepared.join("payload.json")).unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["targets"][0]["preview"], Value::Null);
    assert_eq!(value["targets"][0]["listing"].as_object().unwrap().len(), 5);
    assert!(!fixture.prepared.join("previews").exists());
    let signature = fixture.sign();
    finalize_inner(
        &fixture.finalize_options(&signature),
        fixture.key.public_key().as_ref(),
        now(),
    )
    .unwrap();
    let (previous, _) = load_previous(Some(&fixture.output), fixture.key.public_key().as_ref())
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::to_vec(&previous).unwrap(), bytes);
}
