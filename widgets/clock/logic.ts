// Clock: the local time of day, 24-hour, and the date in the order the user
// chose in the widget menu. The VM's clock is UTC: the SDK formats from the
// host's UTC offset, and its timer wakes at each minute (or second) of local
// time.
import {
  formatDate,
  formatTime,
  initState,
  onHost,
  option,
  t,
  timers,
  type DateOrder,
  type Timer,
} from "@overcrow/sdk";

/** The `date-format` menu values and the date order each one means. */
export const DATE_ORDERS: Readonly<Record<string, DateOrder>> = {
  "day-month-year": "dmy",
  "year-month-day": "ymd",
  "month-day-year": "mdy",
};

declare module "@overcrow/sdk" {
  interface WidgetState {
    now: number;
    seconds: boolean;
    showDate: boolean;
    order: DateOrder;
  }
}

/** The menu values, with their defaults. */
export function menuValues(): { seconds: boolean; showDate: boolean; order: DateOrder } {
  return {
    seconds: option("show-seconds", false),
    showDate: option("show-date", true),
    order: DATE_ORDERS[option("date-format", "day-month-year")] ?? "dmy",
  };
}

const state = initState({ now: Date.now(), ...menuValues() });

export function clockTime(now: number, seconds: boolean): string {
  return formatTime(now, { seconds });
}

export function clockDate(now: number, order: DateOrder): string {
  return formatDate(now, { order });
}

export function clockLabel(now: number, seconds: boolean, showDate: boolean, order: DateOrder): string {
  const time = clockTime(now, seconds);
  return showDate ? t("label-date", { time, date: clockDate(now, order) }) : t("label", { time });
}

let clock: Timer | undefined;

function tick(): void {
  state.now = Date.now();
}

/** Ticks at each second or minute of local time, and shows the time now. */
function start(): void {
  clock?.cancel();
  clock = timers.atEach(state.seconds ? "second" : "minute", tick);
  tick();
}

onHost((changed) => {
  if (changed.includes("options")) {
    const values = menuValues();
    const unitChanged = values.seconds !== state.seconds;
    Object.assign(state, values);
    if (unitChanged) {
      start();
    }
  }
  // A new UTC offset (time zone or summer time) shows at once.
  if (changed.includes("region")) {
    tick();
  }
});

start();
