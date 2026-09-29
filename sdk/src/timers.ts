import { runtime } from "./runtime.js";
import { host } from "./host.js";
import { delayToNext, type TimeUnit } from "./format.js";
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
   * day. It re-arms from the current time after each call, so it keeps to
   * the boundaries after a hidden period and wakes up at
   * `region.nextChangeAt`, when the host sends the new UTC offset.
   */
  atEach(unit: TimeUnit, callback: () => void): Timer {
    let current: Timer | undefined;
    let stopped = false;
    const arm = () => {
      current = start(delayToNext(unit, Date.now(), host.region), false, () => {
        if (!stopped) {
          arm();
          callback();
        }
      });
    };
    arm();
    return {
      cancel() {
        stopped = true;
        current?.cancel();
      },
    };
  },
};
