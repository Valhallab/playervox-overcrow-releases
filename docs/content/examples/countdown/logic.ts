// A countdown of a few minutes. It counts the rounds the user finished,
// keeps that count in the widget's storage and draws one dot per round.
import {
  draw,
  formatDuration,
  initState,
  log,
  onHost,
  onMenu,
  option,
  storage,
  t,
  timers,
  type DrawCommand,
  type Timer,
} from "@overcrow/sdk";

const MINUTE = 60_000;
/** Dots drawn at most; the count itself goes on. */
const MAX_DOTS = 12;

declare module "@overcrow/sdk" {
  interface WidgetState {
    durations: number[];
    minutes: number;
    remainingMs: number;
    running: boolean;
    repeat: boolean;
    rounds: number;
    showRounds: boolean;
    menu: boolean;
  }
}

const state = initState({
  durations: [5, 15, 25, 50],
  minutes: 25,
  remainingMs: 25 * MINUTE,
  running: false,
  repeat: false,
  rounds: 0,
  showRounds: option("show-rounds", true),
  menu: false,
});

export function total(minutes: number): number {
  return minutes * MINUTE;
}

/** `24:59`, counted down to the second. */
export function timeLeft(ms: number): string {
  return formatDuration(Math.ceil(ms / 1000) * 1000);
}

/** The value of an `option` is text. */
export function minutesValue(minutes: number): string {
  return String(minutes);
}

export function ringClass(ms: number): string {
  return ms === 0 ? "ring done" : "ring";
}

export function startLabel(running: boolean): string {
  return t(running ? "pause" : "start");
}

export function stateText(running: boolean, ms: number): string {
  return t(running ? "state-running" : ms === 0 ? "state-done" : "state-paused");
}

/** One dot per finished round, on the `dots` canvas. */
function paint(): void {
  const dots: DrawCommand[] = [];
  for (let index = 0; index < Math.min(state.rounds, MAX_DOTS); index += 1) {
    dots.push(["circle", 6 + index * 14, 6, 4], ["fill", "var(--color-accent)"]);
  }
  draw("dots", dots);
}

function setRounds(rounds: number): void {
  state.rounds = rounds;
  paint();
  // Storage needs the user's consent: without it the count lasts as long
  // as the widget runs.
  storage.set({ key: "rounds", value: rounds }).catch(() => {});
}

let ticker: Timer | undefined;
/** When the running countdown ends, in `Date.now()` time. */
let endsAt = 0;

function stop(): void {
  ticker?.cancel();
  ticker = undefined;
  state.running = false;
}

function start(): void {
  if (state.remainingMs === 0) {
    state.remainingMs = total(state.minutes);
  }
  endsAt = Date.now() + state.remainingMs;
  state.running = true;
  ticker = timers.every(250, tick);
}

// A timer does not tick while the widget is hidden: the time left comes
// from the clock, not from the number of ticks.
function tick(): void {
  state.remainingMs = Math.max(0, endsAt - Date.now());
  if (state.remainingMs > 0) {
    return;
  }
  stop();
  setRounds(state.rounds + 1);
  log.info(`round ${state.rounds} finished`);
  if (state.repeat) {
    start();
  }
}

export function toggle(): void {
  if (state.running) {
    stop();
  } else {
    start();
  }
}

export function setMinutes(event: { value: unknown }): void {
  const minutes = Number(event.value);
  if (state.durations.includes(minutes)) {
    state.minutes = minutes;
    state.remainingMs = total(minutes);
  }
}

export function setRepeat(event: { value: unknown }): void {
  state.repeat = event.value === true;
}

export function openMenu(): void {
  state.menu = true;
}

export function closeMenu(): void {
  state.menu = false;
}

export function resetRounds(): void {
  state.menu = false;
  setRounds(0);
}

// The `reset-rounds` row of the options menu does the same as the button
// of the context menu.
onMenu((row) => {
  if (row === "reset-rounds") {
    resetRounds();
  }
});

onHost((changed) => {
  if (changed.includes("options")) {
    state.showRounds = option("show-rounds", true);
    paint();
  }
});

storage.get({ key: "rounds" }).then(
  (stored) => {
    if (typeof stored === "number" && Number.isInteger(stored) && stored > 0) {
      state.rounds = stored;
      paint();
    }
  },
  () => {},
);
