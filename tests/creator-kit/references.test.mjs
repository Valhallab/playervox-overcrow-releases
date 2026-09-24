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
    assert.deepEqual(bundle.manifest.permissions.network, []);
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

test("reference views consume the real SDK, render text, expose native intents and clear revoked data", async (t) => {
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
      globalThis.__overcrowNative = {
        role: "view",
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async request(metadata) {
          calls.push(metadata);
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
        if (name === "twitch") {
          const composer = nodes.actions.children.find(
            (button) => button.textContent === "Compose in OverCrow",
          );
          assert.ok(composer);
          await composer.listeners.get("click")();
          assert.equal(calls.at(-1).action, "twitch.chat.requestCompose");
          assert.deepEqual(calls.at(-1).parameters, {});
          assert.match(nodes.status.textContent, /Native UI/);
        }
        if (name === "notes") {
          assert.match(nodes.details.textContent, /Fictional native note/);
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
