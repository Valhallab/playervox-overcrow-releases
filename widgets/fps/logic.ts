// FPS: the game's presented frame rate. The host measures it outside the
// game, keeps the last value across short gaps and marks it stale 3 s after
// the last sample; the widget shows the value, "old" when stale, and a
// sentence for each measurement status.
import { fps, hasGrant, initState, onHost, option, t, type Fps } from "@overcrow/sdk";

type Status = Fps["status"];

declare module "@overcrow/sdk" {
  interface WidgetState {
    fps: number | null;
    stale: boolean;
    status: Status;
    showLabel: boolean;
  }
}

const state = initState({
  fps: null as number | null,
  stale: false,
  status: "waiting" as Status,
  showLabel: option("show-label", true),
});

/** The integer value, or an em dash without one. */
export function fpsValue(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

/** A value kept from before the last three seconds. */
export function isOld(value: number | null, stale: boolean): boolean {
  return value !== null && stale;
}

export function valueClass(value: number | null, stale: boolean): string {
  return value === null || stale ? "value muted" : "value";
}

export function oldMarker(): string {
  return ` · ${t("old")}`;
}

export function fpsLabel(value: number | null, stale: boolean): string {
  if (value === null) {
    return t("label-none");
  }
  return t(stale ? "label-old" : "label", { fps: fpsValue(value) });
}

/** The hover sentence: the stale reading first, else the status. */
export function fpsTooltip(value: number | null, stale: boolean, status: Status): string {
  return isOld(value, stale) ? t("hint-old") : t(`hint-${status}`);
}

/** The state an update, or a failure of the subscription, leaves. */
export function reading(update: { ok: true; value: Fps } | { ok: false }): Pick<
  Fps,
  "fps" | "stale" | "status"
> {
  return update.ok
    ? { fps: update.value.fps, stale: update.value.stale, status: update.value.status }
    : { fps: null, stale: false, status: "unavailable" };
}

onHost((changed) => {
  if (changed.includes("options")) {
    state.showLabel = option("show-label", true);
  }
});

if (hasGrant("fps.read")) {
  fps.subscribe((update) => {
    Object.assign(state, reading(update));
  });
} else {
  state.status = "unavailable";
}
