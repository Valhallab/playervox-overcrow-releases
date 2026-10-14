// The number of active quests of the player's Quest Log account. The account
// is not `required`: the widget works without it and shows its own button,
// which opens PlayerVox OverCrow's sign-in panel.
import { account, http, initState, ServiceError, t, timers } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    signedIn: boolean;
    active: number | null;
    status: string;
  }
}

const state = initState({ signedIn: false, active: null as number | null, status: "signed_out" });

async function load(): Promise<void> {
  if (!state.signedIn) {
    return;
  }
  try {
    const { status, body } = await http.fetch("https://api.quests.example/v1/me/quests?status=active", {
      as: "json",
    });
    const quests = (body as { quests?: unknown } | null)?.quests;
    state.active = status === 200 && Array.isArray(quests) ? quests.length : null;
    state.status = state.active === null ? "unavailable" : "connected";
  } catch (error) {
    state.status = error instanceof ServiceError && error.code === "account_refused" ? "expired" : "unavailable";
  }
}

export function activeText(active: number | null): string {
  return active === null ? "–" : t("active", { n: active });
}

// Called on a click: OverCrow opens its panel for the account.
export function connect(): void {
  void account.connect({ id: "quests" });
}

account.subscribe({ id: "quests" }, (update) => {
  if (!update.ok) {
    return;
  }
  state.signedIn = update.value.state === "connected";
  state.status = update.value.state;
  void load();
});
timers.every(10 * 60 * 1000, () => void load());
