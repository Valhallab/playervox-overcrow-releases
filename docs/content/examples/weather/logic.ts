// The temperature of a city from a forecast API. The last answer is kept in
// the widget's storage, so the widget shows it at once on the next start.
import { formatNumber, http, initState, onHost, option, ServiceError, storage, timers } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    city: string;
    units: string;
    temperature: number | null;
    status: string;
  }
}

const state = initState({
  city: option("city", "paris"),
  units: option("units", "metric"),
  temperature: null as number | null,
  status: "loading",
});

export function temperatureText(value: number | null, units: string): string {
  if (value === null) {
    return "–";
  }
  const unit = units === "imperial" ? "°F" : "°C";
  return `${formatNumber(value, { maximumFractionDigits: 1 })} ${unit}`;
}

async function load(): Promise<void> {
  const key = `${state.city}:${state.units}`;
  const cached = await storage.get({ key });
  state.temperature = typeof cached === "number" ? cached : null;
  try {
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const value = (body as { temperature?: unknown } | null)?.temperature;
    if (status !== 200 || typeof value !== "number") {
      state.status = "unavailable";
      return;
    }
    state.temperature = value;
    state.status = "updated";
    await storage.set({ key, value });
  } catch (error) {
    // permission_denied until the user consents, network_error offline…
    state.status = error instanceof ServiceError ? "unavailable" : "failed";
  }
}

export function refresh(): void {
  void load();
}

onHost((changed) => {
  if (changed.includes("options")) {
    state.city = option("city", "paris");
    state.units = option("units", "metric");
    void load();
  }
});
timers.every(30 * 60 * 1000, refresh);
void load();
