// The player's Steam name and the game they are playing, read with the
// integrated Steam service: the player connects Steam once in PlayerVox
// OverCrow, which adds the key to the requests of the route that names the
// service. The widget never sees the key.
import { account, http, initState, ServiceError, storage, timers } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    steamId: string;
    name: string;
    game: string;
    status: string;
  }
}

const state = initState({ steamId: "", name: "", game: "", status: "loading" });

interface Summaries {
  response?: { players?: { personaname?: unknown; gameextrainfo?: unknown }[] };
}

async function load(): Promise<void> {
  if (!/^\d{17}$/.test(state.steamId)) {
    state.status = "no-id";
    return;
  }
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?steamids=${state.steamId}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const player = (body as Summaries | null)?.response?.players?.[0];
    if (status !== 200 || player === undefined) {
      state.status = "unavailable";
      return;
    }
    state.name = typeof player.personaname === "string" ? player.personaname : "";
    state.game = typeof player.gameextrainfo === "string" ? player.gameextrainfo : "";
    state.status = "updated";
  } catch (error) {
    // not_connected until the player connects Steam, account_refused when
    // Steam refuses the key: OverCrow shows its own panel, the widget waits.
    const code = error instanceof ServiceError ? error.code : "";
    state.status = code === "not_connected" || code === "account_refused" ? code : "unavailable";
  }
}

export function steamIdTyped(value: string): void {
  state.steamId = value.trim();
  void storage.set({ key: "steamId", value: state.steamId });
  void load();
}

export function refresh(): void {
  void load();
}

// Read again as soon as Steam is connected, or its key replaced.
account.subscribe({ id: "steam" }, (update) => {
  if (update.ok && update.value.state === "connected") {
    void load();
  }
});
storage.get({ key: "steamId" }).then((saved) => {
  state.steamId = typeof saved === "string" ? saved : "";
  void load();
});
timers.every(5 * 60 * 1000, refresh);
