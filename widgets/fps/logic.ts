// FPS: the game's presented frame rate. The host measures it outside the
// game and keeps the last value through a gap until the next one; the
// widget shows it as it is, with no sign of its age (a value shown never
// disappears or changes look while the game runs), and a sentence for each
// measurement status.
import { fps, hasGrant, initState, onHost, option, t, type Fps } from "@overcrow/sdk";

type Status = Fps["status"];

declare module "@overcrow/sdk" {
  interface WidgetState {
    fps: number | null;
    status: Status;
    showLabel: boolean;
  }
}

const state = initState({
  fps: null as number | null,
  status: "waiting" as Status,
  showLabel: option("show-label", true),
});

/** The integer value, or an em dash without one. */
export function fpsValue(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

/** A value is primary, fresh or kept through a gap; no value is muted. */
export function valueClass(value: number | null): string {
  return value === null ? "value muted" : "value";
}

export function fpsLabel(value: number | null): string {
  return value === null ? t("label-none") : t("label", { fps: fpsValue(value) });
}

/** The hover sentence of the measurement status. */
export function fpsTooltip(status: Status): string {
  return t(`hint-${status}`);
}

/** The state an update, or a failure of the subscription, leaves. */
export function reading(
  update: { ok: true; value: Fps } | { ok: false },
): Pick<Fps, "fps" | "status"> {
  return update.ok
    ? { fps: update.value.fps, status: update.value.status }
    : { fps: null, status: "unavailable" };
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
