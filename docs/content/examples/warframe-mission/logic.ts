// A Warframe mission companion: the node and the type of the current
// mission, its wave, the rotation of the next reward and how the last
// mission ended. It follows two features of Warframe's game events,
// `warframe.mission` and `warframe.progress`, and needs nothing else: no
// network, no storage.
import { gameEvents, initState, t, type WarframeMission } from "@overcrow/sdk";

/** How a mission ended; `ended` when Warframe did not say. */
type Result = NonNullable<WarframeMission["result"]> | "ended";

declare module "@overcrow/sdk" {
  interface WidgetState {
    ready: boolean;
    node: string;
    type: string;
    wave: number | null;
    rotation: string | null;
    lastResult: Result | null;
  }
}

const state = initState({
  ready: false,
  node: "",
  type: "",
  wave: null as number | null,
  rotation: null as string | null,
  lastResult: null as Result | null,
});

let lastSeq = 0;
gameEvents.warframe.subscribe((update) => {
  if (!update.ok) return; // not declared or not granted
  const { features, info, events } = update.value;
  state.ready = features.mission === "available";
  state.node = info.mission?.node.name ?? info.mission?.node.id ?? "";
  state.type = info.mission?.type?.name ?? info.mission?.type?.id ?? "";
  state.wave = info.progress?.wave ?? null;
  state.rotation = info.progress?.rotation ?? null;
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    lastSeq = event.seq;
    if (event.type === "mission_ended") state.lastResult = event.mission.result ?? "ended";
  }
});

/** "Wave 5", or nothing for a mission without waves. */
export function waveText(wave: number | null): string {
  return wave === null ? "" : t("wave", { wave });
}

/** "Rotation A", or nothing for a mission without rotations. */
export function rotationText(rotation: string | null): string {
  return rotation === null ? "" : t("rotation", { rotation });
}

export function resultText(result: Result | null): string {
  return result === null ? "" : t(`last-${result}`);
}

/** Success in green, failure in red, an abort in amber. */
export function resultClass(result: Result | null): string {
  return result === null || result === "ended" ? "result" : `result ${result}`;
}
