// The player's latest run on Run Log, a fictitious service, read with their
// own personal key. PlayerVox OverCrow keeps the key and adds it to the
// requests of the route that names the account: the widget never sees it.
import { account, http, initState, links, ServiceError, timers } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    game: string;
    time: string;
    status: string;
    /** The run's ID on Run Log, or `""`. */
    run: string;
  }
}

const state = initState({ game: "", time: "", status: "loading", run: "" });

interface Latest {
  id?: unknown;
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
    // Only an ID that stays one path segment goes into an address.
    state.run = typeof run.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(run.id) ? run.id : "";
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

// The button's click: OverCrow shows the address, asks the player the first
// time for runlog.example, then opens it in their browser.
export function openRun(): void {
  if (state.run === "") return;
  links.open({ url: `https://runlog.example/runs/${state.run}` }).catch(() => {
    // cancelled when the player declines: nothing to show.
  });
}

// Read again as soon as the key is saved or replaced.
account.subscribe({ id: "runlog" }, (update) => {
  if (update.ok && update.value.state === "connected") {
    void load();
  }
});
void load();
timers.every(5 * 60 * 1000, refresh);
