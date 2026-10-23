// The player's latest Twitch goal, live: the widget lists the goal events
// in its manifest and PlayerVox OverCrow sends them as they happen, on the
// player's own channel. Twitch replays nothing a cut loses, so the widget
// reads the goals again whenever it may have missed an event, and every
// 20 seconds while the events are off. It never sees the token.
import { http, initState, ServiceError, timers, twitch } from "@overcrow/sdk";
import type { JsonValue } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    description: string;
    current: number;
    target: number;
    status: string;
  }
}

const state = initState({ description: "", current: 0, target: 0, status: "loading" });
let broadcaster = "";

type JsonObject = { readonly [key: string]: JsonValue };

function record(value: JsonValue): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** Shows a goal of Helix or of an event: both use Twitch's field names. */
function show(goal: JsonObject | null): void {
  if (goal === null) {
    state.description = "";
    state.current = 0;
    state.target = 0;
    return;
  }
  state.description = typeof goal["description"] === "string" ? goal["description"] : "";
  state.current = typeof goal["current_amount"] === "number" ? goal["current_amount"] : 0;
  state.target = typeof goal["target_amount"] === "number" ? goal["target_amount"] : 0;
}

async function readHelix(): Promise<void> {
  try {
    if (broadcaster === "") {
      const users = await http.fetch("https://api.twitch.tv/helix/users", { as: "json" });
      const user = record(users.body);
      const data = user?.["data"];
      const first = Array.isArray(data) ? record(data[0] ?? null) : null;
      broadcaster = typeof first?.["id"] === "string" ? first["id"] : "";
    }
    if (broadcaster === "") {
      state.status = "unavailable";
      return;
    }
    const url = `https://api.twitch.tv/helix/goals?broadcaster_id=${broadcaster}`;
    const goals = await http.fetch(url, { as: "json" });
    const data = record(goals.body)?.["data"];
    show(Array.isArray(data) ? record(data[0] ?? null) : null);
    state.status = goals.status === 200 ? "updated" : "unavailable";
  } catch (error) {
    // not_connected until the player connects Twitch: OverCrow shows its
    // own panel, the widget waits.
    state.status = error instanceof ServiceError && error.code === "not_connected" ? "not_connected" : "unavailable";
  }
}

function apply(type: string, data: JsonValue): void {
  if (type === "channel.goal.end") {
    show(null);
  } else {
    show(record(data));
  }
  state.status = "updated";
}

let lastSeq = 0; // the highest `seq` handled
let live = false;

twitch.events.subscribe({}, (update) => {
  if (!update.ok) return;
  const { state, events } = update.value;
  if (state === "live" && !live) readHelix(); // live again: catch up once
  live = state === "live";
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    if (event.seq > lastSeq + 1) readHelix(); // some were missed
    lastSeq = event.seq;
    apply(event.type, event.data);
  }
});

// While `off`, read Helix as before.
timers.every(20_000, () => {
  if (!live) readHelix();
});
void readHelix();
