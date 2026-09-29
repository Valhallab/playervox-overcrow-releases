# Public catalog keys

- `overcrow-widgets-YYYY-NN.pub`: the keys of the signed widget catalog v1
  and of the offline seed (lowercase hex Ed25519 public keys). OverCrow
  release builds trust exactly these keys; its trust anchors equal these
  files byte for byte. None exists yet: the first key is generated offline
  by the catalog custodian.
- `overcrow-production-2026-01.pub`: the key of the retired Web runtime
  catalog (`published/marketplace/v1/`). OverCrow never accepts it for the
  widget catalog v1.

Private keys never enter this repository. The development key of
[`fixtures/keys/`](../fixtures/keys/) is public and trusted by debug builds
only.
