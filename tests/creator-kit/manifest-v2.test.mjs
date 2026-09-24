import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../../tools/creator-kit/lib/manifest.mjs";

const publicCapabilities = [
  "telemetry.read",
  "fps.read",
  "stopwatch.read",
  "stopwatch.control",
  "playervox.score.read",
];
const sensitiveCapabilities = [
  "media.read",
  "media.control",
  "notes.read",
  "notes.write",
  "playervox.rating.read",
  "playervox.rating.write",
  "playervox.reviews.read",
  "playervox.followed.read",
  "journal.local.read",
  "journal.cloud.read",
  "journal.notes.read",
  "journal.notes.write",
  "journal.delete",
  "twitch.chat.read",
  "twitch.chat.compose",
];
const network = [
  { origin: "https://api.example.test", method: "GET", pathPrefix: "/v2/" },
];
const presentation = () => ({
  sizing: {
    mode: "autoHeight",
    preferred: { width: 360, height: 240 },
    min: { width: 80, height: 24 },
    max: { width: 1600, height: 1200 },
  },
  options: [
    {
      id: "showArtist",
      type: "boolean",
      label: { en: "Show artist", fr: "Afficher l’artiste" },
      default: true,
    },
    {
      id: "theme",
      type: "enum",
      label: { en: "Theme", fr: "Thème" },
      default: "dark",
      choices: [
        { value: "dark", label: { en: "Dark", fr: "Sombre" } },
        { value: "light", label: { en: "Light", fr: "Clair" } },
      ],
    },
    {
      id: "fontSize",
      type: "number",
      label: { en: "Font size", fr: "Taille du texte" },
      default: 14.5,
      min: 8,
      max: 48,
      step: 0.5,
    },
  ],
});
const fixture = () => ({
  schemaVersion: 1,
  id: "com.example.v2",
  version: "1.0.0",
  apiVersion: "2",
  entrypoints: { view: "index.html" },
  permissions: {},
});
const validate = (value) => validateManifest(value, new Set(["index.html"]));

test("v2 accepts the closed capability set and refuses private-data egress", () => {
  for (const capability of [...publicCapabilities, ...sensitiveCapabilities]) {
    const manifest = fixture();
    manifest.permissions = { capabilities: [capability], storage: true };
    assert.doesNotThrow(() => validate(manifest), capability);
    for (const egress of [{ network }, { clipboardWrite: true }]) {
      manifest.permissions = { capabilities: [capability], ...egress };
      if (sensitiveCapabilities.includes(capability))
        assert.throws(() => validate(manifest), capability);
      else assert.doesNotThrow(() => validate(manifest), capability);
    }
  }
  for (const capabilities of [
    ["notes.read", "notes.read"],
    ["native.shell"],
    ["Notes.Read"],
    null,
    "notes.read",
    [1],
  ]) {
    const manifest = fixture();
    manifest.permissions.capabilities = capabilities;
    assert.throws(() => validate(manifest));
  }
});

test("v1 retains its existing shape and rejects even empty v2 declarations", () => {
  const manifest = fixture();
  manifest.apiVersion = "1";
  manifest.permissions = { network, clipboardWrite: true };
  assert.doesNotThrow(() => validate(manifest));
  for (const capabilities of [[], ["fps.read"], null]) {
    const changed = structuredClone(manifest);
    changed.permissions.capabilities = capabilities;
    assert.throws(() => validate(changed));
  }
  manifest.presentation = presentation();
  assert.throws(() => validate(manifest));
});

test("v2 validates all native sizing modes and typed bilingual options", () => {
  for (const mode of ["intrinsic", "autoHeight", "manual"]) {
    const manifest = fixture();
    manifest.presentation = presentation();
    manifest.presentation.sizing.mode = mode;
    assert.doesNotThrow(() => validate(manifest));
  }
  const manifest = fixture();
  manifest.presentation = presentation();
  delete manifest.presentation.options;
  assert.doesNotThrow(() => validate(manifest));
});

test("v2 refuses malformed dimensions, native option writers, and unbounded options", () => {
  const invalid = [
    (value) => (value.sizing.mode = "free"),
    (value) => (value.sizing.preferred.width = 0),
    (value) => (value.sizing.preferred.width = 360.5),
    (value) => (value.sizing.min.width = 361),
    (value) => (value.sizing.max.height = 239),
    (value) => (value.sizing.max.width = 4097),
    (value) => (value.sizing.max.width = Infinity),
    (value) => (value.sizing.preferred.height = NaN),
    (value) => (value.sizing.width = 10),
    (value) => (value.options[0].id = "__proto__"),
    (value) => (value.options[0].label.en = " "),
    (value) => (value.options[0].label.en = "line\nbreak"),
    (value) => (value.options[0].label.fr = "x".repeat(81)),
    (value) => delete value.options[0].label.fr,
    (value) => (value.options[0].label.de = "Anzeigen"),
    (value) => (value.options[0].default = 1),
    (value) => (value.options[0].setValue = true),
    (value) => (value.options[1].default = "missing"),
    (value) => (value.options[1].choices[1].value = "dark"),
    (value) => (value.options[1].choices = []),
    (value) => (value.options[1].choices[0].nativeCommand = "id"),
    (value) => (value.options[2].default = 49),
    (value) => (value.options[2].min = -1000001),
    (value) => (value.options[2].max = 1000001),
    (value) => (value.options[2].default = NaN),
    (value) => (value.options[2].step = 0),
    (value) => (value.options[2].step = 41),
    (value) => (value.options[2].min = 48),
    (value) => value.options.push(structuredClone(value.options[0])),
    (value) =>
      (value.options = Array.from({ length: 17 }, (_, i) => ({
        ...value.options[0],
        id: `setting${i}`,
      }))),
    (value) => (value.setValue = true),
  ];
  for (const mutate of invalid) {
    const manifest = fixture();
    manifest.presentation = presentation();
    mutate(manifest.presentation);
    assert.throws(() => validate(manifest), String(mutate));
  }
  for (const value of [
    null,
    [],
    {},
    { sizing: null },
    { sizing: presentation().sizing, options: null },
  ]) {
    const manifest = fixture();
    manifest.presentation = value;
    assert.throws(() => validate(manifest));
  }
});
