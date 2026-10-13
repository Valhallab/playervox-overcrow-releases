# Public catalog keys

- `overcrow-widgets-YYYY-NN.pub`: the keys of the signed widget catalog v1
  and of the offline seed (lowercase hex Ed25519 public keys). OverCrow
  release builds trust exactly these keys; its trust anchors equal these
  files byte for byte. The current key is `overcrow-widgets-2026-01`;
  `overcrow-widgets-2026-02` is a spare key kept offline: it signs only
  if the current key is lost or retired, and continues the same catalog
  sequence.
- `overcrow-production-2026-01.pub`: the key of the retired Web runtime
  catalog (`published/marketplace/v1/`). OverCrow never accepts it for the
  widget catalog v1.

Private keys never enter this repository. The development key of
[`fixtures/keys/`](../fixtures/keys/) is public and trusted by debug builds
only.
