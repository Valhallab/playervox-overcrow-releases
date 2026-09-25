// MIT License. Copyright (c) 2026 Valhallab SASU.
import {
  CAPABILITIES,
  READ_CAPABILITIES,
  serviceFixtures,
} from "./service-fixtures.mjs";
let revision = 0,
  contextSequence = 0;
const copy = (value) => structuredClone(value);
const empty = () => new ArrayBuffer(0);
const success = (value) => ({ metadata: { ok: true, value }, body: empty() });
const failure = (code) => ({
  metadata: { ok: false, error: { code, message: `Preview service: ${code}` } },
  body: empty(),
});
const basic = new Set(["telemetry.read", "fps.read"]);
const safeActions = new Set(["presentation.reportSize", "assets.read"]);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const id = (value, max = 128) =>
  typeof value === "string" &&
  value.length <= max &&
  /^[A-Za-z0-9_-]+$/.test(value);
const definitions = {
  "media.previous": [{}, ["media.control"]],
  "media.playPause": [{}, ["media.control"]],
  "media.next": [{}, ["media.control"]],
  "presentation.reportSize": [
    {
      width: (value) => integer(value, 1, 4096),
      height: (value) => integer(value, 1, 4096),
    },
    [],
  ],
  "assets.read": [{ handle: id }, []],
};

export function createServiceSimulator({
  manifest,
  fixture = {},
  onSnapshot = () => {},
  onSize = () => {},
}) {
  let disposed = false,
    contextId,
    frameRevision,
    base = {},
    snapshots,
    capabilities,
    hostPresentation,
    presentationKey;
  function reset(nextManifest, nextFixture) {
    const nextKey = JSON.stringify([nextManifest.id, nextManifest.presentation ?? null]);
    const presentationChanged = nextKey !== presentationKey;
    const initializePresentation = !hostPresentation || manifest.id !== nextManifest.id;
    presentationKey = nextKey;
    manifest = copy(nextManifest);
    fixture = copy(nextFixture ?? {});
    contextId = `preview-${++contextSequence}`;
    frameRevision = ++revision;
    snapshots = serviceFixtures(manifest.presentation);
    const initialPresentation = snapshots.presentation;
    if (initializePresentation) {
      const { sizingMode, width, height } = initialPresentation.data;
      hostPresentation = { sizingMode, width, height };
    } else if (presentationChanged) {
      const sizing = manifest.presentation?.sizing;
      if (!(hostPresentation.sizingMode === "intrinsic" && sizing?.fitToContent === "both")
          && !(hostPresentation.sizingMode === "autoHeight" && sizing?.fitToContent === "height")) hostPresentation.sizingMode = "manual";
      for (const axis of ["width", "height"]) hostPresentation[axis] = Math.max(sizing?.min[axis] ?? 1, Math.min(sizing?.max[axis] ?? 4096, hostPresentation[axis]));
    }
    const supplied = fixture.snapshots ?? {};
    if (supplied && typeof supplied === "object" && !Array.isArray(supplied))
      for (const name of Object.keys(snapshots)) {
        if (Object.hasOwn(supplied, name))
          snapshots[name] = copy(supplied[name]);
      }
    // Effective mode and dimensions belong to the host, including when fixtures supply options.
    snapshots.presentation = {
      ...initialPresentation,
      data: {
        ...initialPresentation.data,
        options: snapshots.presentation?.data?.options ?? initialPresentation.data.options,
        ...hostPresentation,
      },
    };
    const declared = manifest.permissions?.capabilities ?? [];
    const outbound = Boolean(
      manifest.permissions?.network?.length ||
      manifest.permissions?.clipboardWrite,
    );
    capabilities = Object.fromEntries(
      CAPABILITIES.map((name) => {
        const supported = fixture.capabilities?.[name]?.supported !== false;
        return [
          name,
          {
            supported,
            granted:
              supported &&
              declared.includes(name) &&
              fixture.capabilities?.[name]?.granted !== false &&
              (!outbound || basic.has(name)),
          },
        ];
      }),
    );
  }
  reset(manifest, fixture);
  const granted = (names) =>
    names.length === 0 || names.some((name) => capabilities[name]?.granted);
  function snapshot(nextBase) {
    if (nextBase !== undefined) {
      base = Object.fromEntries(
        ["running", "selectedActive", "steamAppId", "sessionElapsedMs", "overlayMode"]
          .filter((key) => Object.hasOwn(nextBase, key))
          .map((key) => [key, copy(nextBase[key])]),
      );
    }
    const result = { ...copy(base), fixture: true };
    const visible = {};
    for (const [name, required] of Object.entries(READ_CAPABILITIES)) {
      if (!granted(required)) {
        visible[name] = {
          status: required.some((cap) => capabilities[cap].supported)
            ? "permissionDenied"
            : "unsupported",
          data: null,
        };
        continue;
      }
      if (name !== "presentation" && base.selectedActive === false) {
        visible[name] = { status: "unavailable", data: null };
        continue;
      }
      visible[name] = copy(snapshots[name]);
    }
    result.services = {
      apiVersion: 1,
      contextId,
      revision: frameRevision,
      capabilities: copy(capabilities),
      snapshots: visible,
    };
    return result;
  }
  const publish = () => {
    frameRevision = ++revision;
    if (!disposed) onSnapshot(snapshot());
  };
  function request(metadata, { role, interactive } = {}) {
    if (disposed || metadata?.contextId !== contextId)
      return failure("stale_context");
    const definition = Object.hasOwn(definitions, metadata?.action)
        ? definitions[metadata.action]
        : null,
      parameters = metadata?.parameters;
    if (
      metadata.type !== "serviceAction" ||
      !definition ||
      !parameters ||
      typeof parameters !== "object" ||
      Array.isArray(parameters) ||
      Object.keys(metadata).some(
        (key) => !["type", "action", "contextId", "parameters"].includes(key),
      )
    )
      return failure("invalid_request");
    const [fields, required] = definition;
    if (
      Object.keys(parameters).some((key) => !Object.hasOwn(fields, key)) ||
      Object.entries(fields).some(([key, check]) => !check(parameters[key]))
    )
      return failure("invalid_request");
    if (!granted(required)) return failure("capability_denied");
    const action = metadata.action;
    if (base.selectedActive === false && action !== "presentation.reportSize")
      return failure("unavailable");
    if (!safeActions.has(action) && interactive !== true)
      return failure("permission_denied");
    if (action === "assets.read") return failure("unsupported_operation");
    if (action === "presentation.reportSize") {
      if (role !== "view") return failure("role_denied");
      onSize(copy(parameters));
      return success({ status: "accepted" });
    }
    if (action.startsWith("media.")) {
      const data = snapshots.media?.data;
      if (!data) return failure("unavailable");
      if (action === "media.playPause")
        data.playbackState =
          data.playbackState === "playing" ? "paused" : "playing";
      else
        data.title =
          action === "media.next"
            ? "Next preview track"
            : "Previous preview track";
      publish();
      return success({ status: "accepted" });
    }
    return failure("unsupported_operation");
  }
  return {
    snapshot,
    request,
    setContext({
      manifest: nextManifest = manifest,
      fixture: nextFixture = fixture,
    } = {}) {
      if (disposed) return snapshot();
      reset(nextManifest, nextFixture);
      onSnapshot(snapshot());
      return snapshot();
    },
    setPresentation(next) {
      if (disposed || !next || typeof next !== "object") return false;
      const { sizingMode, width, height } = next;
      const fit = manifest.presentation?.sizing.fitToContent;
      if (
        !(sizingMode === "manual" || (sizingMode === "intrinsic" && fit === "both") || (sizingMode === "autoHeight" && fit === "height")) ||
        ![width, height].every(value => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 4096)
      ) return false;
      if (hostPresentation.sizingMode === sizingMode && hostPresentation.width === width && hostPresentation.height === height) return false;
      hostPresentation = { sizingMode, width, height };
      Object.assign(snapshots.presentation.data, hostPresentation);
      publish();
      return true;
    },
    setOption(key, value) {
      if (disposed) return false;
      const option = manifest.presentation?.options?.find(
        (option) => option.id === key,
      );
      if (!option) return false;
      const valid =
        option.type === "boolean"
          ? typeof value === "boolean"
          : option.type === "enum"
            ? option.choices.some((choice) => choice.value === value)
            : typeof value === "number" &&
              Number.isFinite(value) &&
              value >= option.min &&
              value <= option.max;
      if (!valid) return false;
      snapshots.presentation.data.options[key] = value;
      publish();
      return true;
    },
    dispose() {
      disposed = true;
      contextId = `disposed-${++contextSequence}`;
      frameRevision = ++revision;
      fixture = {};
      base = {};
      snapshots = Object.fromEntries(
        Object.keys(READ_CAPABILITIES).map((name) => [
          name,
          { status: "unavailable", data: null },
        ]),
      );
      capabilities = Object.fromEntries(
        CAPABILITIES.map((name) => [
          name,
          { supported: false, granted: false },
        ]),
      );
    },
  };
}
