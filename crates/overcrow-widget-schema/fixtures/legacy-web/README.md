# Legacy Web API v1 catalog

`payload.json` is the payload of a real Web API v1 development catalog, staged
by `marketplace-tool stage-development-catalog` for the Hello OverCrow example
(`fixtures/hello-web/` at the repository root). Its bytes are unchanged except
`listing.sourceUrl`, replaced with this repository's URL.

The fixture generator re-signs it with the repository's intentionally public
development key (`fixtures/keys/development-ed25519.key`, key ID
`overcrow-development-2026`) exactly as that command signs: Ed25519 over the
payload bytes, unpadded base64url, in the Web envelope. The result is
`catalog/invalid/format_version--legacy-web-catalog.json`.

It serves only to prove that a widget API v1 host rejects a Web catalog on its
format (`format_version`); a test checks that its signature is valid, so the
rejection never comes from a broken signature. It is test data, not
publication authority. Do not edit `payload.json` in place.
