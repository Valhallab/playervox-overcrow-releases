// The player's latest run on Run Log, a fictitious service, read with their
// own personal key. PlayerVox OverCrow keeps the key and adds it to the
// requests of the route that names the account: the widget never sees it.
import { account, http, initState, ServiceError, timers } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    game: string;
    time: string;
    status: string;
  }
}

const state = initState({ game: "", time: "", status: "loading" });

interface Latest {
  game?: unknown;
  time?: unknown;
}

async function load(): Promise<void> {
  try {
    const { status, body } = await http.fetch("https://api.runlog.example/v1/me/runs/latest", { as: "json" });
    const run = body as Latest | null;
    if (status !== 200 || run === null) {
      state.status = "unavailable";
      return;
    }
    state.game = typeof run.game === "string" ? run.game : "";
    state.time = typeof run.time === "string" ? run.time : "";
    state.status = "updated";
  } catch (error) {
    // not_connected until the player saves a key, account_refused when the
    // service refuses it: OverCrow shows its own panel, the widget waits.
    const code = error instanceof ServiceError ? error.code : "";
    state.status = code === "not_connected" || code === "account_refused" ? code : "unavailable";
  }
}

export function refresh(): void {
  void load();
}

// Read again as soon as the key is saved or replaced.
account.subscribe({ id: "runlog" }, (update) => {
  if (update.ok && update.value.state === "connected") {
    void load();
  }
});
void load();
timers.every(5 * 60 * 1000, refresh);
