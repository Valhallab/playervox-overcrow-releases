# Development signing fixture

`development-ed25519.key` is an intentionally public deterministic test seed.
It signs only local development catalogs of widget API v1 (key ID
`overcrow-widgets-development`, loopback origin
`http://127.0.0.1:8787/marketplace/widgets/v1/`) and, for the retired Web
runtime, the legacy fixtures (`overcrow-development-2026`). Release builds of
OverCrow refuse this key and its key IDs.

The matching public key is `development-ed25519.pub`. Neither file is a
production secret or a trust anchor for the public marketplace.
