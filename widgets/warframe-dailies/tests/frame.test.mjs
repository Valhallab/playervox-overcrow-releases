// The frame never cuts the panel. Read from the reference captures, as
// each scenario takes them (its mode, scale and layout): the panel's
// bottom margin stays empty, so nothing passes the frame's edge; a capture
// at the frame's largest height in Interactive shows the host's scrollbar,
// so what does not fit scrolls; none in Passive reaches that height, its
// end folds into "+ N challenges" instead.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

const read = (path) => readFileSync(new URL(path, import.meta.url));
const MANIFEST = JSON.parse(read("../manifest.json"));
const MAX_HEIGHT = MANIFEST.sizing.max.height;
/** The panel's padding, logical px, less 2 for the antialiasing of a last line that just fits. */
const MARGIN = 8;

/** An 8-bit RGB or RGBA PNG, as RGBA pixels. */
function png(bytes) {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const depth = bytes[24];
  const color = bytes[25];
  assert.equal(depth, 8, "8-bit");
  const channels = color === 6 ? 4 : color === 2 ? 3 : 0;
  assert.ok(channels > 0, `colour type ${color}`);
  const data = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") data.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value += a <= b && a <= c ? left : b <= c ? up : corner;
      }
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) out[(y * width + x) * 4 + c] = row[x * channels + c];
      out[(y * width + x) * 4 + 3] = channels === 4 ? row[x * 4 + 3] : 255;
    }
    previous = row;
  }
  return { width, height, at: (x, y) => out.subarray((y * width + x) * 4, (y * width + x) * 4 + 3) };
}

const far = (a, b, by) => Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c]))) > by;

/** Every capture of every scenario, with the mode, scale and layout it is taken in. */
function captures() {
  const out = [];
  for (const file of readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".scenario.json"))) {
    const scenario = JSON.parse(read(`./${file}`));
    let mode = scenario.host?.mode ?? "passive";
    let scale = (scenario.host?.scale ?? 1000) / 1000;
    let layout = "full";
    for (const step of scenario.steps) {
      if (step.host?.mode !== undefined) mode = step.host.mode;
      if (step.host?.scale !== undefined) scale = step.host.scale / 1000;
      if (step.menu?.id === "layout") layout = step.menu.value;
      if (step.expect?.image !== undefined) out.push({ scenario: scenario.name, image: step.expect.image, mode, scale, layout });
    }
  }
  return out;
}

test("the frame never cuts the panel: a bottom margin, a scrollbar in Interactive at the largest height, a fold in Passive", () => {
  const faults = [];
  const shots = captures().filter((shot) => shot.layout !== "line");
  assert.ok(shots.length > 20, `${shots.length} captures`);
  for (const shot of shots) {
    const name = `${shot.scenario}/${shot.image}`;
    const image = png(read(`./reference/${name}.png`));
    const background = image.at(1, image.height - 1);
    const band = Math.floor(MARGIN * shot.scale);
    let crossing = 0;
    for (let y = image.height - band; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) if (far(image.at(x, y), background, 8)) crossing += 1;
    }
    if (crossing > 0) faults.push(`${name}: ${crossing} pixels of content in the bottom margin`);
    const capped = image.height >= Math.round(MAX_HEIGHT * shot.scale);
    if (capped && shot.mode === "passive") faults.push(`${name}: Passive at the largest height, nothing folded`);
    if (capped && shot.mode === "interactive") {
      let bar = false;
      for (let y = Math.floor(40 * shot.scale); y < image.height - Math.floor(80 * shot.scale) && !bar; y += 1) {
        for (let x = image.width - 8; x < image.width; x += 1) if (far(image.at(x, y), background, 30)) bar = true;
      }
      if (!bar) faults.push(`${name}: Interactive at the largest height without the host's scrollbar`);
    }
  }
  assert.deepEqual(faults, []);
});

test("the typical day fits whole under 680 points, its note and margin included: Interactive and Passive, French and English, 100 % and 150 %", () => {
  const shots = captures().filter((shot) => shot.scenario === "typical-day" && shot.layout !== "line");
  const modes = new Set(shots.map((shot) => `${shot.mode} ${shot.scale}`));
  for (const each of ["passive 1", "interactive 1", "passive 1.5", "interactive 1.5"]) assert.ok(modes.has(each), each);
  for (const shot of shots) {
    const image = png(read(`./reference/${shot.scenario}/${shot.image}.png`));
    assert.ok(image.height < Math.round(MAX_HEIGHT * shot.scale), `${shot.image}: ${image.height} px, nothing scrolls`);
  }
});
