import { runtime } from "./runtime.js";
import { host, onHost } from "./host.js";
import { delayToNext, PERIODS, type TimeUnit } from "./format.js";
import { MIN_TIMER_INTERVAL_MS } from "./generated/limits.js";

/** A host timer. */
export interface Timer {
  /** Stops the timer; idempotent. */
  cancel(): void;
}

function start(intervalMs: number, repeat: boolean, callback: () => void): Timer {
  const interval = Math.max(MIN_TIMER_INTERVAL_MS, Math.ceil(intervalMs));
  const id = runtime().timer(interval, repeat, callback);
  return { cancel: () => runtime().cancelTimer(id) };
}

/** A boundary tick this much past its boundary, or early, is re-aligned. */
const ALIGNMENT_MS = MIN_TIMER_INTERVAL_MS;

/**
 * Host-managed timers (`timer.start`). A timer never ticks while the widget
 * is hidden; at most `MAX_TIMERS` run at once, and an interval shorter than
 * `MIN_TIMER_INTERVAL_MS` is raised to it.
 */
export const timers = {
  /** Calls `callback` once after `delayMs`. */
  after(delayMs: number, callback: () => void): Timer {
    return start(delayMs, false, callback);
  },

  /** Calls `callback` every `intervalMs`, without drift. */
  every(intervalMs: number, callback: () => void): Timer {
    return start(intervalMs, true, callback);
  },

  /**
   * Calls `callback` at each boundary of `unit` in the user's local time
   * (`host.region`), for a clock that changes on the second, minute, hour or
   * day, and once when the widget is shown again. Seconds and minutes use
   * one repeating host timer aligned on the boundaries (a UTC offset is a
   * whole number of minutes, so they never move); a tick that drifted more
   * than `MIN_TIMER_INTERVAL_MS` from its boundary re-aligns it. Hours and
   * days re-arm at each boundary and wake up at `region.nextChangeAt`, when
   * the host sends the new UTC offset.
   */
  atEach(unit: TimeUnit, callback: () => void): Timer {
    const period = PERIODS[unit];
    const steady = period <= PERIODS.minute;
    let current: Timer | undefined;
    let stopped = false;
    let visible = host.visible;
    // A tick of the repeating timer (seconds and minutes).
    const tick = () => {
      if (stopped) {
        return;
      }
      const late = period - delayToNext(unit, Date.now(), host.region);
      if (late >= ALIGNMENT_MS) {
        arm();
      }
      callback();
    };
    const arm = () => {
      current?.cancel();
      current = start(delayToNext(unit, Date.now(), host.region), false, () => {
        if (stopped) {
          return;
        }
        current = steady ? start(period, true, tick) : undefined;
        if (!steady) {
          arm();
        }
        callback();
      });
    };
    // Hidden, a repeating timer skips its ticks but keeps its phase:
    // refresh once when shown, then the next boundary ticks as usual.
    const shown = onHost((changed) => {
      if (changed.includes("visible")) {
        const now = host.visible;
        if (now && !visible && !stopped) {
          callback();
        }
        visible = now;
      }
    });
    arm();
    return {
      cancel() {
        stopped = true;
        shown.cancel();
        current?.cancel();
      },
    };
  },
};
