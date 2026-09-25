import test from "node:test";
import assert from "node:assert/strict";
import { createServiceSimulator } from "../../tools/creator-kit/preview/services.mjs";
import { WEB_CAPABILITIES } from "../../tools/creator-kit/lib/manifest.mjs";

const manifest = (capabilities = WEB_CAPABILITIES) => ({
  apiVersion: "1",
  permissions: { capabilities, network: [], clipboardWrite: false },
  presentation: {
    sizing: {
      fitToContent: "height",
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

test("direct requests cannot reach retired built-in services", () => {
  const sim = createServiceSimulator({ manifest: manifest() });
  for (const action of [
    "stopwatch.start",
    "notes.requestCreate",
    "playervox.requestConnect",
    "journal.page",
    "twitch.chat.requestConnect",
  ]) {
    assert.equal(
      request(
        sim,
        action,
        action === "notes.requestCreate"
          ? { expectedRevision: 1 }
          : action === "journal.page"
            ? { cursor: null }
            : {},
      ).metadata.error?.code,
      "invalid_request",
      action,
    );
  }
  for (const name of [
    "stopwatch",
    "notes",
    "playervox.score",
    "journal",
    "twitch.chat",
  ]) {
    assert.equal(sim.snapshot().services.snapshots[name], undefined, name);
  }
});

test("simulator returns explicit fake service DTOs, capability grants and honest unavailable FPS", () => {
  const sim = createServiceSimulator({
    manifest: manifest(["telemetry.read"]),
  });
  const snapshot = sim.snapshot({ running: true, residentBytes: 123, notes: ["private"] });
  assert.equal(snapshot.fixture, true);
  assert.equal(snapshot.residentBytes, undefined);
  assert.equal(snapshot.notes, undefined);
  assert.equal(snapshot.services.apiVersion, 1);
  assert.deepEqual(snapshot.services.capabilities["telemetry.read"], {
    supported: true,
    granted: true,
  });
  assert.equal(
    snapshot.services.snapshots.telemetry.data.normalizedCpuPercentHundredths,
    1250,
  );
  assert.equal(snapshot.services.snapshots.media.status, "permissionDenied");
  assert.equal(snapshot.services.snapshots.media.data, null);
  assert.equal(snapshot.services.snapshots.fps.status, "permissionDenied");
  const withFps = createServiceSimulator({ manifest: manifest(["fps.read"]) });
  assert.deepEqual(withFps.snapshot().services.snapshots.fps, {
    status: "unsupported",
    data: null,
  });
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
  for (const name of ["telemetry", "fps", "media", "presentation"]) {
    const service = name
      .split(".")
      .reduce((object, key) => object[key], overcrow);
    assert.equal(typeof service?.snapshot, "function", name);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.contextId, sim.snapshot().services.contextId);
  }
  assert.deepEqual(await overcrow.media.playPause(), {
    status: "accepted",
  });
  delete globalThis.__overcrowNative;
});

test("media simulation publishes a revision after an authorized command", () => {
  const events = [];
  const sim = createServiceSimulator({
    manifest: manifest(),
    onSnapshot: (value) => events.push(value),
  });
  const before = sim.snapshot().services.revision;
  assert.equal(
    request(sim, "media.playPause").metadata.value.status,
    "accepted",
  );
  assert.equal(
    sim.snapshot().services.snapshots.media.data.playbackState,
    "playing",
  );
  assert.equal(events.length, 1);
  assert.ok(events[0].services.revision > before);
});

test("simulator rejects denied grants, forged bodies, stale contexts, passive mutations and unsafe args", () => {
  const sim = createServiceSimulator({
    manifest: manifest(["media.read"]),
  });
  assert.equal(
    request(sim, "media.playPause").metadata.error.code,
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
    request(all, "media.playPause", {}, { role: "view", interactive: false })
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
        action: "media.playPause",
        contextId: old.contextId,
        parameters: {},
      },
      { role: "view", interactive: true },
    ).metadata.error.code,
    "stale_context",
  );
  all.dispose();
  assert.equal(
    request(all, "media.playPause").metadata.error.code,
    "stale_context",
  );
  assert.equal(all.snapshot().services.snapshots.media.data, null);
});

test("sensitive media fixtures cannot escape through network or clipboard", () => {
  for (const egress of [
    {
      network: [
        { origin: "https://example.test", method: "GET", path: "/items" },
      ],
    },
    { clipboardWrite: true },
  ]) {
    const unsafe = manifest(["media.read", "media.control"]);
    Object.assign(unsafe.permissions, egress);
    const sim = createServiceSimulator({ manifest: unsafe });
    assert.equal(
      sim.snapshot().services.capabilities["media.read"].granted,
      false,
    );
    assert.equal(sim.snapshot().services.snapshots.media.data, null);
    assert.equal(
      request(sim, "media.playPause").metadata.error.code,
      "capability_denied",
    );
  }
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
  assert.deepEqual(sim.snapshot().services.snapshots.media, {
    status: "unavailable",
    data: null,
  });
  assert.equal(
    request(sim, "media.playPause").metadata.error.code,
    "unavailable",
  );
  assert.equal(sim.snapshot().services.snapshots.presentation.status, "ready");
});


test("presentation fixtures start from supported fit defaults and cannot override host geometry", () => {
  for (const [fitToContent, defaultMode, sizingMode] of [
    [false, undefined, "manual"], ["both", undefined, "intrinsic"],
    ["height", undefined, "autoHeight"], ["both", "manual", "manual"],
    ["height", "manual", "manual"],
  ]) {
    const declared = manifest();
    Object.assign(declared.presentation.sizing, {fitToContent, defaultMode});
    const sim = createServiceSimulator({manifest:declared,fixture:{snapshots:{presentation:{status:"ready",data:{sizingMode:"intrinsic",width:99999,height:1,options:{details:false}}}}}});
    assert.deepEqual(sim.snapshot().services.snapshots.presentation.data, {sizingMode,width:280,height:180,options:{details:false}});
    sim.dispose();
  }
});

test("host-only geometry changes publish once and reject unsupported modes or dimensions", () => {
  const events = [];
  const sim = createServiceSimulator({manifest:manifest(),onSnapshot:next=>events.push(next)});
  assert.equal(sim.setPresentation({sizingMode:"manual",width:320,height:200}), true);
  assert.equal(events.length, 1);
  assert.equal(sim.setPresentation({sizingMode:"manual",width:320,height:200}), false);
  assert.equal(events.length, 1);
  for (const invalid of [
    {sizingMode:"intrinsic",width:320,height:200},
    {sizingMode:"fit",width:320,height:200},
    {sizingMode:"manual",width:Infinity,height:200},
    {sizingMode:"manual",width:320.5,height:200},
    {sizingMode:"manual",width:0,height:200},
    {sizingMode:"manual",width:320,height:8193},
  ]) assert.equal(sim.setPresentation(invalid), false);
  assert.equal(events.length, 1);
  assert.equal(request(sim,"presentation.setMode",{mode:"fit"}).metadata.error.code,"invalid_request");
  const disabled = manifest();disabled.presentation.sizing.fitToContent=false;
  sim.setContext({manifest:disabled});
  assert.equal(sim.snapshot().services.snapshots.presentation.data.sizingMode,"manual");
  assert.equal(sim.setPresentation({sizingMode:"autoHeight",width:320,height:200}),false);
  assert.equal(sim.setPresentation({sizingMode:"manual",width:330,height:200}),true);
  sim.dispose();
  assert.equal(sim.setPresentation({sizingMode:"manual",width:320,height:200}),false);
});

test("game context changes preserve host sizing for an unchanged declaration", () => {
  const sim = createServiceSimulator({manifest:manifest()});
  sim.setPresentation({sizingMode:"manual",width:320,height:200});
  sim.snapshot({selectedActive:false});
  sim.setContext();
  assert.deepEqual(sim.snapshot().services.snapshots.presentation.data, {sizingMode:"manual",width:320,height:200,options:{details:true}});
  sim.dispose();
});


test("declaration edits preserve host choices and revoke incompatible fit axes", () => {
  const declared = manifest();
  const sim = createServiceSimulator({manifest:declared});
  sim.setPresentation({sizingMode:"manual",width:320,height:200});
  declared.presentation.sizing.defaultMode = "fit";
  declared.presentation.options[0].default = false;
  sim.setContext({manifest:declared});
  assert.deepEqual(sim.snapshot().services.snapshots.presentation.data, {sizingMode:"manual",width:320,height:200,options:{details:false}});
  sim.setPresentation({sizingMode:"autoHeight",width:320,height:220});
  declared.presentation.sizing.fitToContent = "both";
  sim.setContext({manifest:declared});
  assert.deepEqual(sim.snapshot().services.snapshots.presentation.data, {sizingMode:"manual",width:320,height:220,options:{details:false}});
  sim.setContext({manifest:{...declared,id:"com.example.other"}});
  assert.deepEqual(sim.snapshot().services.snapshots.presentation.data, {sizingMode:"intrinsic",width:280,height:180,options:{details:false}});
  sim.dispose();
});


test("host CSS viewport snapshots allow zoomed-out dimensions through 8192", () => {
  const sim=createServiceSimulator({manifest:manifest()});
  assert.equal(sim.setPresentation({sizingMode:"manual",width:8192,height:8192}),true);
  assert.equal(sim.snapshot().services.snapshots.presentation.data.width,8192);
  assert.equal(sim.setPresentation({sizingMode:"manual",width:8193,height:8192}),false);
  assert.equal(request(sim,"presentation.reportSize",{width:4097,height:100}).metadata.error.code,"invalid_request");
  sim.dispose();
});

test("context changes preserve CSS dimensions without applying frame bounds to them", () => {
  const declared=manifest();
  const sim=createServiceSimulator({manifest:declared});
  for(const [width,height] of [[100,30],[1500,1500]]) {
    sim.setPresentation({sizingMode:"manual",width,height});
    declared.presentation.options[0].default=!declared.presentation.options[0].default;
    sim.setContext({manifest:declared});
    const data=sim.snapshot().services.snapshots.presentation.data;
    assert.equal(data.width,width);assert.equal(data.height,height);
  }
  sim.dispose();
});
