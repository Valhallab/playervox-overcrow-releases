import test from "node:test";
import assert from "node:assert/strict";
import { createServiceSimulator } from "../../tools/creator-kit/preview/services.mjs";
import { WEB_CAPABILITIES } from "../../tools/creator-kit/lib/manifest.mjs";

const manifest = (capabilities = WEB_CAPABILITIES) => ({
  apiVersion: "2",
  permissions: { capabilities, network: [], clipboardWrite: false },
  presentation: {
    sizing: {
      mode: "autoHeight",
      preferred: { width: 280, height: 180 },
      min: { width: 120, height: 40 },
      max: { width: 1000, height: 1000 },
    },
    options: [{ id: "details", type: "boolean", default: true }],
  },
});
const request = (
  sim,
  action,
  parameters = {},
  options = { role: "view", interactive: true },
) =>
  sim.request(
    {
      type: "serviceAction",
      action,
      contextId: sim.snapshot().services.contextId,
      parameters,
    },
    options,
  );

test("simulator returns explicit fake v2 DTOs, capability grants and honest unavailable FPS", () => {
  const sim = createServiceSimulator({
    manifest: manifest(["telemetry.read"]),
  });
  const snapshot = sim.snapshot({ running: true });
  assert.equal(snapshot.fixture, true);
  assert.equal(snapshot.services.apiVersion, 2);
  assert.deepEqual(snapshot.services.capabilities["telemetry.read"], {
    supported: true,
    granted: true,
  });
  assert.equal(
    snapshot.services.snapshots.telemetry.data.normalizedCpuPercentHundredths,
    1250,
  );
  assert.equal(snapshot.services.snapshots.notes.status, "permissionDenied");
  assert.equal(snapshot.services.snapshots.notes.data, null);
  assert.equal(snapshot.services.snapshots.fps.status, "permissionDenied");
  const withFps = createServiceSimulator({ manifest: manifest(["fps.read"]) });
  assert.deepEqual(withFps.snapshot().services.snapshots.fps, {
    status: "unsupported",
    data: null,
  });
  assert.equal(
    createServiceSimulator({
      manifest: { apiVersion: "1", permissions: {} },
    }).snapshot().services,
    undefined,
  );
});

test("the shipped SDK consumes every simulator DTO and rejects ungranted actions", async () => {
  const sim = createServiceSimulator({ manifest: manifest() });
  const listeners = new Set();
  globalThis.__overcrowNative = {
    role: "view",
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(metadata) {
      return metadata.type === "gameSnapshot"
        ? {
            metadata: { ok: true, value: sim.snapshot() },
            body: new ArrayBuffer(0),
          }
        : sim.request(metadata, { role: "view", interactive: true });
    },
  };
  const { overcrow } =
    await import("../../content/sdk/overcrow.js?simulator-contract");
  for (const name of [
    "telemetry",
    "fps",
    "stopwatch",
    "media",
    "notes",
    "playervox.score",
    "playervox.rating",
    "playervox.reviews",
    "journal",
    "twitch.chat",
    "presentation",
  ]) {
    const service = name
      .split(".")
      .reduce((object, key) => object[key], overcrow);
    assert.equal(typeof service?.snapshot, "function", name);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.contextId, sim.snapshot().services.contextId);
  }
  assert.deepEqual(await overcrow.twitch.chat.requestCompose(), {
    status: "cancelled",
  });
  delete globalThis.__overcrowNative;
});

test("safe fake state changes publish revisions while native UI stays cancelled", () => {
  let time = 0;
  const events = [];
  const sim = createServiceSimulator({
    manifest: manifest(),
    now: () => time,
    onSnapshot: (snapshot) => events.push(snapshot),
  });
  const before = sim.snapshot().services.revision;
  assert.equal(
    request(sim, "stopwatch.start").metadata.value.status,
    "accepted",
  );
  time = 1500;
  assert.equal(
    request(sim, "stopwatch.pause").metadata.value.status,
    "accepted",
  );
  assert.equal(
    sim.snapshot().services.snapshots.stopwatch.data.elapsedMs,
    1500,
  );
  assert.equal(
    request(sim, "stopwatch.reset").metadata.value.status,
    "accepted",
  );
  assert.equal(sim.snapshot().services.snapshots.stopwatch.data.elapsedMs, 0);
  assert.ok(events.length >= 3);
  assert.ok(events[0].services.revision > before);
  const note = sim.snapshot().services.snapshots.notes.data;
  assert.equal(
    request(sim, "notes.setChecked", {
      noteId: "note-1",
      itemId: "item-1",
      checked: true,
      expectedRevision: note.documentRevision,
    }).metadata.value.status,
    "persisted",
  );
  assert.equal(
    sim.snapshot().services.snapshots.notes.data.notes[0].items[0].checked,
    true,
  );
  assert.equal(
    request(sim, "notes.setChecked", {
      noteId: "note-1",
      itemId: "item-1",
      checked: false,
      expectedRevision: note.documentRevision,
    }).metadata.value.status,
    "conflict",
  );
  for (const action of [
    "playervox.requestConnect",
    "twitch.chat.requestConnect",
    "twitch.chat.requestChooseChannel",
    "twitch.chat.requestCompose",
  ])
    assert.equal(request(sim, action).metadata.value.status, "cancelled");
});

test("simulator rejects denied grants, forged bodies, stale contexts, passive mutations and unsafe args", () => {
  const sim = createServiceSimulator({
    manifest: manifest(["stopwatch.read"]),
  });
  assert.equal(
    request(sim, "stopwatch.start").metadata.error.code,
    "capability_denied",
  );
  const all = createServiceSimulator({ manifest: manifest() });
  for (const [action, parameters] of [
    ["twitch.chat.requestCompose", { body: "silent message" }],
    ["presentation.reportSize", { width: 1.5, height: 20 }],
    ["playervox.reviews.page", { page: 1001 }],
    ["journal.page", { cursor: "bad\nvalue" }],
    ["shell.execute", {}],
    ["constructor", {}],
  ])
    assert.equal(
      request(all, action, parameters).metadata.error.code,
      "invalid_request",
    );
  assert.equal(
    request(all, "stopwatch.start", {}, { role: "view", interactive: false })
      .metadata.error.code,
    "permission_denied",
  );
  assert.equal(
    request(
      all,
      "presentation.reportSize",
      { width: 100, height: 100 },
      { role: "controller", interactive: true },
    ).metadata.error.code,
    "role_denied",
  );
  const old = all.snapshot().services;
  all.setContext({ fixture: {} });
  assert.ok(all.snapshot().services.revision > old.revision);
  assert.notEqual(all.snapshot().services.contextId, old.contextId);
  assert.equal(
    all.request(
      {
        type: "serviceAction",
        action: "stopwatch.start",
        contextId: old.contextId,
        parameters: {},
      },
      { role: "view", interactive: true },
    ).metadata.error.code,
    "stale_context",
  );
  all.dispose();
  assert.equal(
    request(all, "stopwatch.start").metadata.error.code,
    "stale_context",
  );
  assert.equal(all.snapshot().services.snapshots.notes.data, null);
});

test("sensitive fixture payloads are filtered by grant and relationship/note access", () => {
  const sim = createServiceSimulator({
    manifest: manifest(["journal.local.read", "playervox.reviews.read"]),
  });
  const frame = sim.snapshot().services;
  assert.equal(
    frame.snapshots.journal.data.sessions.every(
      (session) => session.source === "local" && session.note === null,
    ),
    true,
  );
  assert.equal(
    request(sim, "playervox.reviews.page", { page: 1, followedOnly: true })
      .metadata.error.code,
    "capability_denied",
  );
  const unsafe = manifest(["notes.read"]);
  unsafe.permissions.network = [
    { origin: "https://example.test", method: "GET", pathPrefix: "/" },
  ];
  assert.equal(
    createServiceSimulator({ manifest: unsafe }).snapshot().services
      .capabilities["notes.read"].granted,
    false,
  );
});

test("host-only options and content hints use raw layout units and notify the wrapper", () => {
  const hints = [];
  const sim = createServiceSimulator({
    manifest: manifest(),
    onSize: (size) => hints.push(size),
  });
  assert.equal(
    request(sim, "presentation.reportSize", { width: 240, height: 70 }).metadata
      .value.status,
    "accepted",
  );
  assert.deepEqual(hints, [{ width: 240, height: 70 }]);
  assert.equal(sim.setOption("details", false), true);
  assert.equal(
    sim.snapshot().services.snapshots.presentation.data.options.details,
    false,
  );
  assert.equal(sim.setOption("details", "no"), false);
  assert.equal(
    request(sim, "presentation.setOption", { id: "details", value: true })
      .metadata.error.code,
    "invalid_request",
  );
});

test("inactive sessions hide fake private data and deny controls until a new context", () => {
  const sim = createServiceSimulator({ manifest: manifest() });
  sim.snapshot({ running: false, selectedActive: false });
  sim.setContext();
  assert.deepEqual(sim.snapshot().services.snapshots.notes, {
    status: "unavailable",
    data: null,
  });
  assert.equal(
    request(sim, "stopwatch.start").metadata.error.code,
    "unavailable",
  );
  assert.equal(sim.snapshot().services.snapshots.presentation.status, "ready");
});

test("running stopwatch reads advance revision when elapsed data changes", () => {
  let time = 0;
  const sim = createServiceSimulator({ manifest: manifest(), now: () => time });
  request(sim, "stopwatch.start");
  time = 100;
  const first = sim.snapshot().services;
  time = 200;
  const next = sim.snapshot().services;
  assert.equal(next.snapshots.stopwatch.data.elapsedMs, 200);
  assert.ok(next.revision > first.revision);
  request(sim, "stopwatch.start");
  time = 300;
  assert.equal(sim.snapshot().services.snapshots.stopwatch.data.elapsedMs, 300);
});
