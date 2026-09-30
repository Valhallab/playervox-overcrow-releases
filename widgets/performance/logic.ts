// Performance: the attached game's CPU share and resident memory, the host's
// CPU and GPU temperatures and the game's frame rate. A row shows when its
// menu toggle is on and the host has a reading; nothing is ever shown as
// "—". The host normalizes the CPU share, drops the rows of the sensors it
// lacks from the menu (`requires`) and marks a frame rate stale: the widget
// only formats, colours and lays out.
import {
  formatNumber,
  fps,
  hasGrant,
  initState,
  onHost,
  option,
  t,
  telemetry,
  type Subscription,
  type Telemetry,
} from "@overcrow/sdk";

/** The menu values the rows depend on. */
export interface Shown {
  cpu: boolean;
  ram: boolean;
  cpuTemperature: boolean;
  gpuTemperature: boolean;
  fps: boolean;
  fahrenheit: boolean;
}

/** The frame rate part the rows use. */
export interface Rate {
  fps: number | null;
  stale: boolean;
}

/** One metric as the view draws it. */
export interface Row {
  key: string;
  label: string;
  value: string;
  /** `value`, `value warning` or `value critical`. */
  valueClass: string;
  /** The unit after a thin space, or nothing. */
  unit: string;
  hint: string;
  /** The accessible name, which also tells the two "CPU" rows apart. */
  name: string;
  /** The first row has no separator in the horizontal layout. */
  first: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    telemetry: Telemetry | null;
    rate: Rate | null;
    layout: string;
    shown: Shown;
  }
}

/** Binary gigabytes, as Windows Task Manager counts memory. */
const GIGABYTE = 1024 ** 3;
const CPU_WARNING = 80;
const CPU_CRITICAL = 95;
/** Temperature thresholds, compared in °C whatever the unit shown. */
const TEMPERATURE_WARNING = 80;
const TEMPERATURE_CRITICAL = 90;

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function shown(): Shown {
  return {
    cpu: option("show-cpu", true),
    ram: option("show-ram", true),
    cpuTemperature: option("show-cpu-temperature", true),
    gpuTemperature: option("show-gpu-temperature", true),
    fps: option("show-fps", true),
    fahrenheit: option("temperature-unit", "celsius") === "fahrenheit",
  };
}

const state = initState({
  telemetry: null as Telemetry | null,
  rate: null as Rate | null,
  layout: option("layout", "vertical"),
  shown: shown(),
});

/** The colour class of a value past its warning or critical threshold. */
export function severity(value: number, warning: number, critical: number): string {
  if (value >= critical) {
    return "value critical";
  }
  return value >= warning ? "value warning" : "value";
}

/** A temperature in the chosen unit, converted before rounding. */
export function temperature(celsius: number, fahrenheit: boolean): { value: string; unit: string } {
  return fahrenheit
    ? { value: formatNumber(celsius * 1.8 + 32, ONE_DECIMAL), unit: "°F" }
    : { value: formatNumber(celsius, ONE_DECIMAL), unit: "°C" };
}

/** A unit keeps a thin space from its number, as the built-in's 2 px gap. */
const spaced = (unit: string): string => (unit === "" ? "" : `\u2009${unit}`);

/** The rows to draw, in the fixed order CPU, RAM, CPU and GPU temperatures, FPS. */
export function rows(sample: Telemetry | null, rate: Rate | null, show: Shown): Row[] {
  const list: Omit<Row, "first">[] = [];
  const metric = (key: string, value: string, unit: string, valueClass: string): void => {
    list.push({
      key,
      label: t(key),
      value,
      valueClass,
      unit: spaced(unit),
      hint: t(`hint-${key}`),
      name: t(`name-${key}`, { value, unit }),
    });
  };
  if (show.cpu && sample?.cpu != null) {
    metric("cpu", formatNumber(sample.cpu, ONE_DECIMAL), "%", severity(sample.cpu, CPU_WARNING, CPU_CRITICAL));
  }
  if (show.ram && sample?.ram != null) {
    metric("ram", formatNumber(sample.ram / GIGABYTE, ONE_DECIMAL), "GB", "value");
  }
  for (const key of ["cpu-temperature", "gpu-temperature"] as const) {
    const celsius = key === "cpu-temperature" ? sample?.cpuTemperature : sample?.gpuTemperature;
    const wanted = key === "cpu-temperature" ? show.cpuTemperature : show.gpuTemperature;
    if (wanted && celsius != null) {
      const { value, unit } = temperature(celsius, show.fahrenheit);
      metric(key, value, unit, severity(celsius, TEMPERATURE_WARNING, TEMPERATURE_CRITICAL));
    }
  }
  if (show.fps && rate !== null && rate.fps !== null) {
    const value = formatNumber(Math.round(rate.fps), { maximumFractionDigits: 0 });
    list.push({
      key: "fps",
      label: t("fps"),
      value,
      valueClass: "value",
      unit: rate.stale ? spaced(t("old")) : "",
      hint: t(rate.stale ? "hint-fps-old" : "hint-fps"),
      name: t(rate.stale ? "name-fps-old" : "name-fps", { value }),
    });
  }
  return list.map((row, index) => ({ ...row, first: index === 0 }));
}

/** Why no row shows: every metric switched off, or no reading yet. */
export function emptyMessage(show: Shown): string {
  const any = show.cpu || show.ram || show.cpuTemperature || show.gpuTemperature || show.fps;
  return t(any ? "waiting" : "no-metric");
}

export function rootClass(layout: string): string {
  return layout === "horizontal" ? "performance horizontal" : "performance vertical";
}

/** The telemetry an update leaves: none after a failure. */
export function sampleOf(update: { ok: true; value: Telemetry | null } | { ok: false }): Telemetry | null {
  return update.ok ? update.value : null;
}

/** The frame rate an update leaves: none after a failure. */
export function rateOf(
  update: { ok: true; value: { fps: number | null; stale: boolean } } | { ok: false },
): Rate | null {
  return update.ok ? { fps: update.value.fps, stale: update.value.stale } : null;
}

// The host measures the frame rate only while a widget subscribes to it:
// the subscription follows the FPS row's toggle, so no capture runs for a
// hidden row.
const canReadFps = hasGrant("fps.read");
let rateSubscription: Subscription | null = null;

function followFpsToggle(): void {
  const wanted = canReadFps && state.shown.fps;
  if (wanted && rateSubscription === null) {
    rateSubscription = fps.subscribe((update) => {
      state.rate = rateOf(update);
      if (!update.ok) {
        // The subscription ended: switching the row off and on retries.
        rateSubscription = null;
      }
    });
  } else if (!wanted && rateSubscription !== null) {
    rateSubscription.cancel();
    rateSubscription = null;
    state.rate = null;
  }
}

onHost((changed) => {
  if (changed.includes("options")) {
    state.layout = option("layout", "vertical");
    state.shown = shown();
    followFpsToggle();
  }
});

if (hasGrant("telemetry.read")) {
  telemetry.subscribe((update) => {
    state.telemetry = sampleOf(update);
  });
}
followFpsToggle();
