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
const basic = new Set([
  "telemetry.read",
  "fps.read",
  "stopwatch.read",
  "stopwatch.control",
  "playervox.score.read",
]);
const safeActions = new Set([
  "presentation.reportSize",
  "journal.page",
  "playervox.reviews.page",
  "assets.read",
]);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const id = (value, max = 128) =>
  typeof value === "string" &&
  value.length <= max &&
  /^[A-Za-z0-9_-]+$/.test(value);
const cursor = (value) =>
  value === null ||
  (typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 2048 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const definitions = {
  "stopwatch.start": [{}, ["stopwatch.control"]],
  "stopwatch.pause": [{}, ["stopwatch.control"]],
  "stopwatch.reset": [{}, ["stopwatch.control"]],
  "media.previous": [{}, ["media.control"]],
  "media.playPause": [{}, ["media.control"]],
  "media.next": [{}, ["media.control"]],
  "notes.requestCreate": [{ expectedRevision: integer }, ["notes.write"]],
  "notes.requestEdit": [
    { noteId: (value) => id(value, 64), expectedRevision: integer },
    ["notes.write"],
  ],
  "notes.requestDelete": [
    { noteId: (value) => id(value, 64), expectedRevision: integer },
    ["notes.write"],
  ],
  "notes.select": [
    { noteId: (value) => id(value, 64), expectedRevision: integer },
    ["notes.read"],
  ],
  "notes.setChecked": [
    {
      noteId: (value) => id(value, 64),
      itemId: (value) => id(value, 64),
      expectedRevision: integer,
      checked: (value) => typeof value === "boolean",
    },
    ["notes.write"],
  ],
  "playervox.requestConnect": [
    {},
    [
      "playervox.rating.read",
      "playervox.rating.write",
      "playervox.reviews.read",
      "journal.cloud.read",
    ],
  ],
  "playervox.rating.requestEdit": [
    { expectedRevision: integer },
    ["playervox.rating.write"],
  ],
  "playervox.reviews.page": [
    {
      page: (value) => integer(value, 1, 1000),
      followedOnly: (value) =>
        value === undefined || typeof value === "boolean",
    },
    ["playervox.reviews.read"],
  ],
  "journal.page": [{ cursor }, ["journal.local.read", "journal.cloud.read"]],
  "journal.requestEditNote": [
    { sessionId: id, expectedRevision: integer },
    ["journal.notes.write"],
  ],
  "journal.requestDelete": [
    { sessionId: id, expectedRevision: integer },
    ["journal.delete"],
  ],
  "twitch.chat.requestConnect": [{}, ["twitch.chat.read"]],
  "twitch.chat.requestChooseChannel": [{}, ["twitch.chat.read"]],
  "twitch.chat.requestCompose": [
    { replyTo: (value) => value === undefined || id(value) },
    ["twitch.chat.compose"],
  ],
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
  now = () => performance.now(),
}) {
  let disposed = false,
    contextId,
    frameRevision,
    base = {},
    snapshots,
    capabilities,
    startedAt = null,
    lastElapsed = 0;
  function reset(nextManifest, nextFixture) {
    manifest = copy(nextManifest);
    fixture = copy(nextFixture ?? {});
    contextId = `preview-${++contextSequence}`;
    frameRevision = ++revision;
    startedAt = null;
    snapshots = serviceFixtures(manifest.presentation);
    const supplied = fixture.snapshots ?? {};
    if (supplied && typeof supplied === "object" && !Array.isArray(supplied))
      for (const name of Object.keys(snapshots)) {
        if (Object.hasOwn(supplied, name))
          snapshots[name] = copy(supplied[name]);
      }
    const declared =
      manifest.apiVersion === "2"
        ? (manifest.permissions?.capabilities ?? [])
        : [];
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
    if (snapshots.stopwatch?.data?.running) startedAt = now();
    lastElapsed = snapshots.stopwatch?.data?.elapsedMs ?? 0;
  }
  reset(manifest, fixture);
  const granted = (names) =>
    names.length === 0 || names.some((name) => capabilities[name]?.granted);
  function elapsed() {
    const data = snapshots.stopwatch?.data;
    return data
      ? data.elapsedMs +
          (data.running && startedAt !== null
            ? Math.max(0, Math.floor(now() - startedAt))
            : 0)
      : 0;
  }
  function snapshot(nextBase) {
    if (nextBase !== undefined) {
      base = copy(nextBase);
      delete base.services;
    }
    const result = { ...copy(base), fixture: true };
    if (manifest.apiVersion !== "2") return result;
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
    if (visible.stopwatch?.data) {
      const value = elapsed();
      if (value !== lastElapsed) {
        lastElapsed = value;
        frameRevision = ++revision;
      }
      visible.stopwatch.data.elapsedMs = value;
    }
    if (visible.journal?.data)
      visible.journal.data.sessions = visible.journal.data.sessions
        .filter(
          (session) => capabilities[`journal.${session.source}.read`]?.granted,
        )
        .map((session) => ({
          ...session,
          note: capabilities["journal.notes.read"].granted
            ? session.note
            : null,
        }));
    if (
      visible["playervox.reviews"]?.data?.followedOnly &&
      !capabilities["playervox.followed.read"].granted
    )
      visible["playervox.reviews"] = { status: "permissionDenied", data: null };
    result.services = {
      apiVersion: 2,
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
    if (manifest.apiVersion !== "2") return failure("unsupported_operation");
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
    if (action.startsWith("stopwatch.")) {
      const data = snapshots.stopwatch?.data;
      if (!data) return failure("unavailable");
      data.elapsedMs = elapsed();
      if (action === "stopwatch.start") {
        data.running = true;
        startedAt = now();
      } else {
        data.running = false;
        startedAt = null;
        if (action === "stopwatch.reset") data.elapsedMs = 0;
      }
      publish();
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
    if (action.startsWith("notes.")) {
      const data = snapshots.notes?.data;
      if (!data) return failure("unavailable");
      if (parameters.expectedRevision !== data.documentRevision)
        return success({ status: "conflict", revision: data.documentRevision });
      const note = data.notes.find((note) => note.id === parameters.noteId);
      if (action !== "notes.requestCreate" && !note)
        return failure("invalid_request");
      if (action === "notes.select") data.activeNoteId = parameters.noteId;
      else if (action === "notes.setChecked") {
        const item = note.items.find((item) => item.id === parameters.itemId);
        if (!item) return failure("invalid_request");
        item.checked = parameters.checked;
      } else return success({ status: "cancelled" });
      data.documentRevision++;
      data.saveState = "persisted";
      publish();
      return success({ status: "persisted", revision: data.documentRevision });
    }
    if (action === "playervox.reviews.page") {
      if (
        parameters.followedOnly &&
        !capabilities["playervox.followed.read"].granted
      )
        return failure("capability_denied");
      const data = snapshots["playervox.reviews"]?.data;
      if (!data) return failure("unavailable");
      data.page = parameters.page;
      data.followedOnly = parameters.followedOnly ?? false;
      data.reviews =
        parameters.page === 1
          ? serviceFixtures()["playervox.reviews"].data.reviews
          : [];
      publish();
      return success({ status: "accepted" });
    }
    if (action === "journal.page") {
      const data = snapshots.journal?.data;
      if (!data) return failure("unavailable");
      if (parameters.cursor !== null) return failure("invalid_request");
      data.page = 1;
      publish();
      return success({ status: "accepted" });
    }
    // Browser previews cannot open native editors, authenticate, delete or publish.
    if (
      parameters.expectedRevision !== undefined &&
      parameters.expectedRevision !== frameRevision
    )
      return success({ status: "conflict" });
    return success({ status: "cancelled" });
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
      startedAt = null;
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
