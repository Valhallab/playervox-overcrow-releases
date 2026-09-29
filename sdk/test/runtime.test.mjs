import assert from "node:assert/strict";
import { test } from "node:test";

import { runtime } from "../dist/runtime.js";

const MESSAGE = /needs the OverCrow widget runtime surface 0\.1/;

test("outside the widget VM the SDK fails with a clear error", () => {
  delete globalThis.overcrow;
  assert.throws(() => runtime(), MESSAGE);
  globalThis.overcrow = { state: {}, host: {}, view() {} };
  assert.throws(() => runtime(), MESSAGE, "an incomplete surface is refused");
  globalThis.overcrow = null;
  assert.throws(() => runtime(), MESSAGE);
  delete globalThis.overcrow;
});

test("the index cannot load without the runtime", async () => {
  delete globalThis.overcrow;
  await assert.rejects(import("../dist/index.js"), MESSAGE);
});
