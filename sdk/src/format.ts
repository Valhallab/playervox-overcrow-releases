import { host } from "./host.js";
import type { DateOrder, NumberFormat, Region } from "./generated/schema.js";

// The widget VM has no `Intl` and its local time is UTC: these helpers
// format from `host.region` instead, with no locale data. Dates and times
// are numeric (the order is the user's `dateOrder`), times are 24-hour and
// numbers follow the user's `numberFormat`, independent of the interface
// language. Every helper takes its region values as options, so it runs
// the same outside the VM (tests, the Studio).

const MINUTE = 60_000;
const PERIODS = { second: 1000, minute: MINUTE, hour: 60 * MINUTE, day: 24 * 60 * MINUTE };

/** A boundary of local time. */
export type TimeUnit = keyof typeof PERIODS;

/** The fields of an instant in a UTC offset. */
export interface LocalTime {
  /** Full year. */
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  /** 1 to 31. */
  readonly day: number;
  /** 0 (Sunday) to 6. */
  readonly weekday: number;
  /** 0 to 23. */
  readonly hour: number;
  /** 0 to 59. */
  readonly minute: number;
  /** 0 to 59. */
  readonly second: number;
  /** 0 to 999. */
  readonly millisecond: number;
}

/**
 * The fields of `unixMs` in the user's local time, or in `offsetMinutes`
 * (a service timestamp carries its own offset: pass it).
 *
 * The host sends a new `Region` when the offset changes
 * (`region.nextChangeAt`); until then the current offset applies.
 */
export function localTime(unixMs: number, offsetMinutes?: number): LocalTime {
  const date = new Date(unixMs + (offsetMinutes ?? host.region.offsetMinutes) * MINUTE);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

/**
 * Milliseconds from `nowMs` to the next boundary of `unit` in local time,
 * and never past `region.nextChangeAt`: at that instant the offset changes,
 * so a timer armed with this delay wakes up to use the new one. Always at
 * least 1.
 */
export function delayToNext(
  unit: TimeUnit,
  nowMs: number,
  region: Pick<Region, "offsetMinutes" | "nextChangeAt"> = host.region,
): number {
  const period = PERIODS[unit];
  const local = nowMs + region.offsetMinutes * MINUTE;
  const delay = period - (((local % period) + period) % period);
  const change = region.nextChangeAt;
  return change !== undefined && change > nowMs ? Math.min(delay, change - nowMs) : delay;
}

const SEPARATORS: { readonly [F in NumberFormat]: { group: string; decimal: string } } = {
  us: { group: ",", decimal: "." },
  // A no-break space, so that a number never wraps.
  fr: { group: " ", decimal: "," },
  de: { group: ".", decimal: "," },
};

/** Options of {@link formatNumber}. */
export interface NumberOptions {
  /** Fraction digits always shown; default 0. */
  readonly minimumFractionDigits?: number;
  /** Fraction digits at most, 0 to 20; default the larger of 3 and the minimum. */
  readonly maximumFractionDigits?: number;
  /** Group thousands; default `true`. */
  readonly grouping?: boolean;
  /** Separators; default `host.region.numberFormat`. */
  readonly format?: NumberFormat;
}

const digits = (value: number | undefined, fallback: number): number =>
  Math.min(20, Math.max(0, Math.trunc(value ?? fallback)));

/**
 * `value` with the user's separators: `us` 1,234.5, `fr` 1 234,5 (no-break
 * space), `de` 1.234,5. Rounds like `Number.prototype.toFixed`; a
 * non-finite value, or one of 10^21 or more, is written as JavaScript does.
 */
export function formatNumber(value: number, options: NumberOptions = {}): string {
  const minimum = digits(options.minimumFractionDigits, 0);
  const maximum = Math.max(minimum, digits(options.maximumFractionDigits, Math.max(3, minimum)));
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) {
    return String(value);
  }
  const { group, decimal } = SEPARATORS[options.format ?? host.region.numberFormat];
  const fixed = Math.abs(value).toFixed(maximum);
  let [whole = "0", fraction = ""] = fixed.split(".");
  let end = fraction.length;
  while (end > minimum && fraction[end - 1] === "0") {
    end -= 1;
  }
  fraction = fraction.slice(0, end);
  if (options.grouping ?? true) {
    whole = whole.replace(/\B(?=(\d{3})+$)/g, group);
  }
  const negative = value < 0 && /[1-9]/.test(fixed);
  return (negative ? "-" : "") + whole + (fraction === "" ? "" : decimal + fraction);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** Options of {@link formatDate} and {@link formatTime}. */
export interface TimeOptions {
  /** UTC offset; default `host.region.offsetMinutes`. */
  readonly offsetMinutes?: number;
}

/** Options of {@link formatDate}. */
export interface DateOptions extends TimeOptions {
  /** Field order; default `host.region.dateOrder`. */
  readonly order?: DateOrder;
}

/**
 * The local date of `unixMs`, numeric: `dmy` 17/07/2026, `mdy` 07/17/2026,
 * `ymd` 2026-07-17.
 */
export function formatDate(unixMs: number, options: DateOptions = {}): string {
  const { year, month, day } = localTime(unixMs, options.offsetMinutes);
  const y = pad(year, 4);
  switch (options.order ?? host.region.dateOrder) {
    case "ymd":
      return `${y}-${pad(month)}-${pad(day)}`;
    case "mdy":
      return `${pad(month)}/${pad(day)}/${y}`;
    default:
      return `${pad(day)}/${pad(month)}/${y}`;
  }
}

/** Options of {@link formatTime}. */
export interface ClockOptions extends TimeOptions {
  /** Show seconds; default `false`. */
  readonly seconds?: boolean;
}

/** The local time of day of `unixMs`, 24-hour: 14:08 or 14:08:42. */
export function formatTime(unixMs: number, options: ClockOptions = {}): string {
  const { hour, minute, second } = localTime(unixMs, options.offsetMinutes);
  const time = `${pad(hour)}:${pad(minute)}`;
  return options.seconds === true ? `${time}:${pad(second)}` : time;
}

/** Options of {@link formatDuration}. */
export interface DurationOptions {
  /** Always show hours; by default only from one hour. */
  readonly hours?: boolean;
  /** Add hundredths after the decimal separator of `format`. */
  readonly hundredths?: boolean;
  /** Decimal separator of the hundredths; default `host.region.numberFormat`. */
  readonly format?: NumberFormat;
}

/**
 * A duration, truncated like a stopwatch: 04:05, 1:02:03, or with
 * hundredths 04:05.67 (04:05,67 for `fr` and `de`). Negative durations
 * start with `-`.
 */
export function formatDuration(durationMs: number, options: DurationOptions = {}): string {
  const negative = durationMs < 0;
  const total = Math.floor(Math.abs(Number.isFinite(durationMs) ? durationMs : 0) / 10);
  const centis = total % 100;
  const seconds = Math.floor(total / 100) % 60;
  const minutes = Math.floor(total / 6000) % 60;
  const hours = Math.floor(total / 360_000);
  let text =
    hours > 0 || options.hours === true
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  if (options.hundredths === true) {
    text += SEPARATORS[options.format ?? host.region.numberFormat].decimal + pad(centis);
  }
  return (negative && total > 0 ? "-" : "") + text;
}
