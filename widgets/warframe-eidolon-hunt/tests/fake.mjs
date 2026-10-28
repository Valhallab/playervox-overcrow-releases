// A small stand-in for the host of the unit tests: the widget's storage in a
// map, and whole values of `gameEvents.warframe.subscribe` built from a few
// facts of the hunt.
import { readFileSync } from "node:fs";

export const SERVICE = "gameEvents.warframe.subscribe";
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

/** 2026-10-28 20:00 UTC: the night at Cetus began at 19:40 and ends at 20:30. */
export const START = Date.UTC(2026, 9, 28, 20, 0, 0);
export const NIGHT_END = Date.UTC(2026, 9, 28, 20, 30, 0);

export const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const PLAINS = { kind: "open_world", place: { id: "plains_of_eidolon", name: "Plains of Eidolon" } };
const CETUS = { kind: "hub", place: { id: "cetus", name: "Cetus" } };

/** One Eidolon of the night. */
export function eidolon(id, spawnedAt, { captured = null, killed = null, fled = null, weakpoints = 3 } = {}) {
  return {
    eidolon: id === null ? null : { id, name: id[0].toUpperCase() + id.slice(1) },
    spawnedAt,
    weakpoints,
    capturedAt: captured,
    killedAt: killed,
    fledAt: fled,
  };
}

/** A whole value of the subscription. */
export function value({
  playing = true,
  session = START - 30 * MINUTE,
  eidolons = "available",
  at = "plains",
  since = START - 20 * MINUTE,
  hunts = [],
  night = true,
  cetus = { state: { id: "night", name: "Night" }, endsAt: NIGHT_END },
  events = [],
} = {}) {
  const place = at === "plains" ? PLAINS : at === "cetus" ? CETUS : null;
  return {
    playing,
    session: session === null ? null : { startedAt: session },
    features: {
      location: "available",
      mission: "undeclared",
      progress: "undeclared",
      squad: "undeclared",
      eidolons,
      world: cetus === undefined ? "unavailable" : "available",
      rewards: "undeclared",
    },
    info: {
      location: playing && place !== null ? { ...place, since } : null,
      mission: null,
      progress: null,
      squad: null,
      eidolons: eidolons === "available" ? { night, hunts } : null,
      world:
        cetus === undefined
          ? null
          : {
              updatedAt: START,
              sortie: null,
              archonHunt: null,
              fissures: [],
              cycles: { cetus, vallis: null, cambion: null },
              resets: { daily: Date.UTC(2026, 9, 29), weekly: Date.UTC(2026, 10, 2) },
              voidTrader: null,
              circuit: null,
            },
    },
    events,
  };
}

/** A storage that answers as the host does. */
export function fakeStorage(initial = {}) {
  return new Map(Object.entries(initial));
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Answers every waiting storage call, until none is left. */
export async function settle(vm, store) {
  for (let round = 0; round < 50; round += 1) {
    await flush();
    const open = vm.calls.filter((call) => !call.settled && call.service.startsWith("storage."));
    if (open.length === 0) {
      await flush();
      return;
    }
    for (const call of open) {
      if (call.service === "storage.get") call.resolve(structuredClone(store.get(call.params.key) ?? null));
      else if (call.service === "storage.set") {
        store.set(call.params.key, structuredClone(call.params.value));
        call.resolve(null);
      } else call.resolve(null);
    }
  }
  throw new Error("storage calls never settle");
}

/** Moves the virtual time and settles. */
export async function advance(vm, store, ms) {
  vm.advance(ms);
  await settle(vm, store);
}

/** Sends a value and settles. */
export async function send(vm, store, update) {
  vm.push(SERVICE, update);
  await settle(vm, store);
}

/** The texts the view shows of the screen, in order, for short assertions. */
export function texts(view) {
  return {
    label: view.label,
    big: view.big,
    hint: view.hint,
    chip: view.chip,
    rows: view.rows.map((row) => [row.name, row.delta, row.time].filter((text) => text !== "").join(" ")),
    line: [...view.line.map((segment) => segment.text), view.lineSub].filter((text) => text !== "").join(" "),
  };
}
