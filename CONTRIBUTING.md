# Contributing

Schema, SDK, CLI, tooling, documentation, and reference-widget contributions
are MIT-licensed, except `@overcrow/sdk`, which is MIT-0. Submit only material
you have authority to license and preserve third-party notices. Third-party
widgets keep their declared licenses; see [licensing scope](LICENSING.md).

Tooling and documentation pull requests target `main`. Widget submissions
target `candidate` and use the widget submission template: a widget API v1
source directory under `widgets/<dir>/` with its `listing.json`, admitted by
`overcrow-widget admit`; see [publishing and review](docs/content/en/publishing.md).
Never commit secrets, native executable code, build output or production
signing material. Admission and human review are required. Acceptance does
not publish anything.

The widget schema in `crates/overcrow-widget-schema/` and the source parsers
in `crates/overcrow-widget-format/` are the security validators of the OverCrow
host: changes to them or to their fuzz targets in `fuzz/` are reviewed by
their maintainers before the host pins them. Regenerate
`docs/widget-schema-v1.md`, the conformance fixtures, the compiled view
goldens and the SDK types in the same change (see the [README](README.md) and
[testing](docs/testing.md)).

Keep the documentation on the current widget API v1 contract:

- The creator documentation in `docs/content/` is what the website shows, in
  English and French; update both languages together, with the same code
  blocks, and the French catalog of the generated descriptions with them.
  Its tables are generated and its code blocks are excerpts of checked
  projects; see [its README](docs/content/README.md), which also holds the
  English–French glossary.
- Everything a creator needs is in `docs/content/`. The other documents of
  `docs/` are specifications and notes for implementers and maintainers, in
  English; they link to the website's page instead of repeating it.
- Every relative link, and every address of the documentation website,
  must resolve: `node scripts/check-links.mjs`.

```sh
cargo test -p overcrow-widget-cli --locked
cargo test -p overcrow-widget-schema --locked
cargo test -p overcrow-widget-format --locked
node scripts/build-docs-content.mjs --check
node --test --test-concurrency=2 tests/docs-content.test.mjs tests/check-links.test.mjs
node scripts/check-links.mjs
sh scripts/check-policy.sh
```

See [testing](docs/testing.md) for the full list, and the
[review policy](docs/review-policy.md). The website is maintained in a
separate private repository.
