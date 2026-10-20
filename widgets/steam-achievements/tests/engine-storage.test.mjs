// Storage stays within the host's quotas (64 KiB a value, 256 KiB in all)
// whatever the games: the profile, the tracked achievement and the last view
// are always kept; achievement lists only as room allows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";
import { ID, achievementsOf, fakeSteam, minutes, settle } from "./steam-fake.mjs";

const EN = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "connected" } });
const steam = fakeSteam();
steam.storage.set("profile", { steamid: ID, input: ID });
// Accented French descriptions weigh more in UTF-8 than characters.
for (const appid of [1, 2, 3, 4, 5]) {
  const schema = achievementsOf(240, `G${appid}`).map((a) => ({ ...a, description: `Réussir l'épreuve « éclat » numéro ${a.name} sans être vu, même à l'aube ${"é".repeat(120)}` }));
  steam.games[appid] = { name: `Game ${appid}`, schema, unlocked: {} };
}
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
await settle(vm, steam);

test("five large games in a row: every write fits, the essentials are kept", async () => {
  for (const appid of [1, 2, 3, 4, 5]) {
    steam.playing = appid;
    await minutes(vm, steam, 1);
    // Large answers are read in slices, 100 ms apart.
    for (let slice = 0; slice < 40; slice += 1) {
      vm.advance(100);
      await settle(vm, steam);
    }
    assert.equal(state.game?.name, `Game ${appid}`, `${state.phase} ${state.stale} ${steam.requests.slice(-3).join(" ")}`);
  }
  assert.equal(steam.refusedWrites, 0, "no write over the quota");
  assert.equal(steam.storage.get("snapshot").appid, 5);
  assert.deepEqual(steam.storage.get("profile"), { steamid: ID, input: ID });
  // Every stored part is in the index, nothing orphaned.
  const index = steam.storage.get("schemas") ?? [];
  const parts = [...steam.storage.keys()].filter((key) => key.startsWith("schema:"));
  assert.equal(parts.length, index.reduce((sum, entry) => sum + entry.chunks, 0));
  logic.pick(logic.pickList(state)[0]?.id ?? "");
  await settle(vm, steam);
  assert.equal(steam.refusedWrites, 0);
});
