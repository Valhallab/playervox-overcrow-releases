# Contributing

SDK, tooling, documentation, and reference-widget contributions are MIT-licensed.
Submit only material you have authority to license and preserve third-party
notices. Third-party widgets keep their declared licenses; see
[licensing scope](LICENSING.md).

Tooling and documentation pull requests target `main`. Widget submissions target
`candidate` and use the widget submission template. Include built Web API v1
files, a complete `manifest.json` ledger, and `listing.json`; never commit secrets,
native executable code, or production signing material. Package validation and
human review are required. Acceptance does not publish anything.

```sh
python3 scripts/package-docs-examples.py published/docs/downloads
node --test tests/creator-kit/*.test.mjs tests/warframe-market/*.test.mjs
cargo test -p marketplace-tool --locked
sh scripts/check-policy.sh
```

See [creator guidance](docs/creator-guide.md), [testing](docs/testing.md),
[review policy](docs/review-policy.md), and [maintenance](docs/github-maintenance.md).
The website is maintained in a separate private repository.
