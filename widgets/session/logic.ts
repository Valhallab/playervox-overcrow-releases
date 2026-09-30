// Session: how long the game has been running. The host sends an anchor
// (`elapsedMs` at its monotonic `at`) and advances the `elapsed` element
// itself, so the widget has no timer and a clock change never moves it.
import { hasGrant, initState, session, type Session } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest anchor, or `null` while the duration is unknown. */
    session: Session | null;
  }
}

const state = initState({ session: null as Session | null });

/** The anchor to show: an update's value, or none after a failure. */
export function anchor(update: { ok: boolean; value?: Session | null }): Session | null {
  return update.ok ? (update.value ?? null) : null;
}

// Without the grant the host would refuse the subscription: show the
// unknown duration instead of asking.
if (hasGrant("session.read")) {
  session.subscribe((update) => {
    state.session = anchor(update);
  });
}
