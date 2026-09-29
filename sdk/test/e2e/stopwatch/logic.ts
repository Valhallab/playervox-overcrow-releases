// A stopwatch written against the public SDK: `stopwatch.toggle` on a
// gesture, the state from `stopwatch.subscribe`, and the failure code shown
// as it is. Its scenarios answer the services from fixtures.
import { ServiceError, initState, onMenu, stopwatch } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    status: string;
    elapsed: string;
  }
}

const state = initState({ status: "idle", elapsed: "-" });

stopwatch.subscribe((update) => {
  if (update.ok) {
    state.elapsed = update.value === null ? "no game" : `${update.value.elapsedMs} ms`;
  } else {
    state.status = update.error.code;
  }
});

export function toggle(): void {
  stopwatch.toggle().then(
    (next) => {
      state.status = next === null ? "no game" : next.running ? "running" : "stopped";
    },
    (error: unknown) => {
      state.status = error instanceof ServiceError ? error.code : "error";
    },
  );
}

// A menu row is never a gesture: the host refuses the call.
onMenu((row) => {
  if (row === "toggle") {
    toggle();
  }
});
