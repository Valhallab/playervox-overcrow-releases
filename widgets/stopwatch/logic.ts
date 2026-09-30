// Manual stopwatch: the host keeps one stopwatch, which its global shortcuts
// also drive. The widget shows it and commands it on a gesture. The host
// sends an anchor (`elapsedMs` at its monotonic `at`) and advances the
// `elapsed` element itself, hundredths included: the widget has no timer.
import {
  hasGrant,
  host,
  initState,
  onHost,
  stopwatch,
  t,
  type Stopwatch,
} from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest state, or `null` while it is unknown. */
    stopwatch: Stopwatch | null;
    /** The buttons take input only in Interactive mode. */
    interactive: boolean;
  }
}

const canRead = hasGrant("stopwatch.read");
const canControl = hasGrant("stopwatch.control");

const state = initState({
  stopwatch: null as Stopwatch | null,
  interactive: host.mode === "interactive",
});

/** The state a subscription update leaves: none after a failure. */
export function current(update: { ok: boolean; value?: Stopwatch | null }): Stopwatch | null {
  return update.ok ? (update.value ?? null) : null;
}

/** The buttons: Interactive mode, the control grant and a known state. */
export function showControls(interactive: boolean, known: Stopwatch | null): boolean {
  return interactive && canControl && known !== null;
}

/** The label of the start/pause button. */
export function toggleLabel(running: boolean): string {
  return t(running ? "pause" : "start");
}

/** A button's tooltip: its label and the host's chord. */
export function withChord(label: string, chord: string): string {
  return t("with-chord", { label, chord });
}

/** The reminder of the host's two shortcuts. */
export function reminder(shortcuts: Stopwatch["shortcuts"]): string {
  return t("reminder", { toggle: shortcuts.toggle, reset: shortcuts.reset });
}

/**
 * Applies the state a command returned, at once: the next subscription
 * update carries the same state. A failure (`unavailable` when the host
 * cannot act) changes nothing, as the host did not act.
 */
function command(call: () => Promise<Stopwatch | null>): void {
  call().then(
    (next) => {
      if (canRead) {
        state.stopwatch = next;
      }
    },
    () => {},
  );
}

export function toggle(): void {
  command(() => stopwatch.toggle());
}

export function reset(): void {
  command(() => stopwatch.reset());
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
});

// Without the grant the host would refuse the subscription: show the
// unknown time instead of asking.
if (canRead) {
  stopwatch.subscribe((update) => {
    state.stopwatch = current(update);
  });
}
