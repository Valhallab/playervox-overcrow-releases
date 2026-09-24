import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  collect,
  packageProject,
} from "../../tools/creator-kit/lib/bundle.mjs";
import { REFERENCE_TEMPLATES } from "../../tools/creator-kit/lib/templates.mjs";
import { createServiceSimulator } from "../../tools/creator-kit/preview/services.mjs";
import { createStorageSimulator } from "../../tools/creator-kit/preview/storage.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));

test("every SDK-only reference initializes, validates and exports the shipped SDK", async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "overcrow-references-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of REFERENCE_TEMPLATES) {
    const project = path.join(folder, name);
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "tools/creator-kit/overcrow.mjs"),
        "init",
        project,
        "--template",
        name,
        "--json",
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
    const bundle = await collect(project);
    assert.equal(bundle.manifest.apiVersion, "2");
    assert.equal(
      bundle.manifest.permissions.network.length,
      name === "score" ? 1 : 0,
    );
    assert.ok(bundle.manifest.presentation.options.length > 0);
    assert.deepEqual(
      bundle.entries.get("overcrow.js"),
      await readFile(path.join(root, "content/sdk/overcrow.js")),
    );
    assert.deepEqual(
      bundle.entries.get("overcrow.d.ts"),
      await readFile(path.join(root, "content/sdk/overcrow.d.ts")),
    );
    assert.ok(bundle.entries.has("view.js"));
    assert.ok(bundle.entries.has("reference.js"));
    const packaged = await packageProject(project);
    assert.equal((await readFile(packaged.file)).length, packaged.bytes);
  }
});

test("references use system services or isolated local data and clear revoked media", async (t) => {
  const folder = await mkdtemp(
    path.join(os.tmpdir(), "overcrow-reference-views-"),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  class Element {
    constructor() {
      this.children = [];
      this.listeners = new Map();
      this.style = {};
      this.dataset = {};
      this.classList = { toggle() {} };
      this.scrollWidth = 240;
      this.scrollHeight = 120;
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    get textContent() {
      return (
        (this.text ?? "") +
        this.children.map((child) => child.textContent).join("")
      );
    }
    set innerHTML(_value) {
      throw new Error("Fixture content must never become HTML");
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.text = "";
      this.children = children;
    }
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }
  }
  const keys = [
    "document",
    "window",
    "ResizeObserver",
    "requestAnimationFrame",
    "__overcrowNative",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, globalThis[key]]),
  );
  try {
    for (const name of REFERENCE_TEMPLATES) {
      const project = path.join(folder, name);
      await cp(path.join(root, "content/references/common"), project, {
        recursive: true,
      });
      await cp(path.join(root, "content/references", name), project, {
        recursive: true,
      });
      await cp(path.join(root, "content/sdk"), project, { recursive: true });
      await writeFile(path.join(project, "package.json"), '{"type":"module"}');
      const nodes = Object.fromEntries(
          [
            "content",
            "fixture",
            "title",
            "primary",
            "artwork",
            "details",
            "actions",
            "status",
            "entry",
            "editor-label",
            "editor-title",
          ].map((id) => [id, new Element()]),
        ),
        events = new Map(),
        listeners = new Set(),
        calls = [];
      globalThis.document = {
        getElementById: (id) => nodes[id],
        createElement: () => new Element(),
        createTextNode: (text) => {
          const node = new Element();
          node.textContent = text;
          return node;
        },
        body: new Element(),
        documentElement: {},
      };
      globalThis.window = {
        addEventListener: (name, callback) => events.set(name, callback),
      };
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      globalThis.requestAnimationFrame = (callback) => queueMicrotask(callback);
      const manifest = JSON.parse(
        await readFile(path.join(project, "manifest.json"), "utf8"),
      );
      const sim = createServiceSimulator({
        manifest,
        onSnapshot: (snapshot) => {
          for (const listener of listeners)
            listener({ type: "gameSnapshot", payload: snapshot });
        },
      });
      sim.snapshot({
        running: true,
        selectedActive: true,
        sessionElapsedMs: 65000,
        overlayMode: "interactive",
      });
      const storage = createStorageSimulator();
      let storageWriteGate = null;
      let fetchRequest = null;
      globalThis.__overcrowNative = {
        role: "view",
        storage: { mode: "temporary", backend: "memory" },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async request(metadata) {
          calls.push(metadata);
          if (metadata.type === "storage") {
            if (metadata.operation === "set" && storageWriteGate)
              await storageWriteGate;
            return storage(metadata);
          }
          if (metadata.type === "fetch" && fetchRequest)
            return fetchRequest(metadata);
          return metadata.type === "gameSnapshot"
            ? {
                metadata: { ok: true, value: sim.snapshot() },
                body: new ArrayBuffer(0),
              }
            : metadata.type === "locale"
              ? {
                  metadata: { ok: true, value: "en" },
                  body: new ArrayBuffer(0),
                }
              : sim.request(metadata, { role: "view", interactive: true });
        },
      };
      try {
        await import(pathToFileURL(path.join(project, "view.js")).href);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(nodes.fixture.hidden, false, name);
        assert.ok(nodes.primary.textContent, name);
        assert.notEqual(nodes.primary.textContent, "Loading…", name);
        if (name === "fps")
          assert.equal(nodes.primary.textContent, "unsupported");
        if (name === "session")
          assert.equal(nodes.primary.textContent, "00:01:05");
        if (name === "notes" || name === "journal") {
          assert.equal(nodes.entry.disabled, false);
          nodes.entry.value = "Only this widget owns this text";
          const save = nodes.actions.children.find(
            (button) => button.textContent === "Save",
          );
          assert.ok(save);
          await save.listeners.get("click")();
          const saved = storage({
            type: "storage",
            operation: "get",
            key: name + ".v1",
          });
          assert.deepEqual(
            JSON.parse(saved.metadata.value),
            name === "notes"
              ? "Only this widget owns this text"
              : ["Only this widget owns this text"],
          );
          assert.equal(
            calls.some((call) =>
              /^(notes|journal|stopwatch|playervox|twitch)\./.test(
                call.action ?? "",
              ),
            ),
            false,
          );

          let releaseWrite;
          storageWriteGate = new Promise((resolve) => {
            releaseWrite = resolve;
          });
          nodes.entry.value = "Save through a snapshot update";
          const pendingSave = nodes.actions.children
            .find((button) => button.textContent === "Save")
            .listeners.get("click")();
          try {
            sim.setOption("details", false);
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(nodes.entry.disabled, true, `${name}: pending editor`);
            assert.equal(
              nodes.actions.children.find(
                (button) => button.textContent === "Save",
              ).disabled,
              true,
              `${name}: pending save after a snapshot rebuilds the controls`,
            );
          } finally {
            releaseWrite();
            await pendingSave;
            storageWriteGate = null;
          }
          assert.equal(nodes.entry.disabled, false);
          assert.equal(
            nodes.actions.children.find(
              (button) => button.textContent === "Save",
            ).disabled,
            false,
          );
          assert.deepEqual(
            JSON.parse(
              storage({ type: "storage", operation: "get", key: name + ".v1" })
                .metadata.value,
            ),
            name === "notes"
              ? "Save through a snapshot update"
              : [
                  "Only this widget owns this text",
                  "Save through a snapshot update",
                ],
          );

          let rejectWrite;
          storageWriteGate = new Promise((_, reject) => {
            rejectWrite = reject;
          });
          nodes.entry.value = "Keep this draft after a failed save";
          const failedSave = nodes.actions.children
            .find((button) => button.textContent === "Save")
            .listeners.get("click")();
          rejectWrite(new Error("Simulated storage failure"));
          await failedSave;
          storageWriteGate = null;
          assert.equal(nodes.entry.disabled, false);
          assert.equal(
            nodes.entry.value,
            "Keep this draft after a failed save",
          );
          assert.equal(nodes.status.textContent, "storage_unavailable");
        }
        if (name === "media") {
          assert.match(nodes.primary.textContent, /Preview track/);
          sim.setContext({
            manifest: {
              ...manifest,
              permissions: { ...manifest.permissions, capabilities: [] },
            },
          });
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(nodes.primary.textContent, "permissionDenied");
          assert.equal(nodes.details.textContent, "");
          assert.equal(nodes.actions.children.length, 0);
        }
        if (name === "score") {
          const pendingFetches = [];
          fetchRequest = () =>
            new Promise((resolve) => pendingFetches.push(resolve));
          const selectGame = (steamAppId) => {
            for (const listener of listeners)
              listener({
                type: "gameSnapshot",
                payload: {
                  ...sim.snapshot(),
                  fixture: false,
                  steamAppId,
                },
              });
          };
          const reply = (index, score) =>
            pendingFetches[index]({
              metadata: { ok: true, status: score === null ? 503 : 200 },
              body: new TextEncoder().encode(
                JSON.stringify({
                  game: { name: "Public game" },
                  score,
                  ratings_count: 1,
                  criteria: {},
                }),
              ).buffer,
            });
          selectGame(620);
          assert.equal(pendingFetches.length, 1);
          reply(0, null);
          await new Promise((resolve) => setImmediate(resolve));
          const retry = nodes.actions.children.find(
            (button) => button.textContent === "Retry",
          );
          assert.ok(retry, "failed public scores offer an explicit retry");
          selectGame(620);
          assert.equal(
            pendingFetches.length,
            1,
            "snapshot updates do not retry automatically",
          );
          retry.listeners.get("click")();
          retry.listeners.get("click")();
          assert.equal(
            pendingFetches.length,
            2,
            "only one retry may be in flight",
          );
          assert.equal(
            nodes.actions.children.length,
            0,
            "pending retries hide the retry control",
          );
          reply(1, 84);
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(nodes.primary.textContent, "84.0 / 100");

          selectGame(730);
          selectGame(440);
          selectGame(730);
          assert.equal(pendingFetches.length, 5);
          reply(2, 10);
          reply(3, 20);
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(
            nodes.primary.textContent,
            "Loading…",
            "late results cannot restore a previous context of the same game",
          );
          reply(4, 90);
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(nodes.primary.textContent, "90.0 / 100");
        }
        assert.ok(
          calls.some((call) => call.action === "presentation.reportSize"),
          name,
        );
      } finally {
        events.get("pagehide")?.();
        sim.dispose();
      }
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  }
});
