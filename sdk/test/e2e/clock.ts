// The logic module of the end-to-end Clock: written against the public SDK
// only. It shows the local time (seconds on demand), the date in the user's
// order, extra zones and a dial drawn on a canvas.
import {
  draw,
  formatDate,
  formatNumber,
  formatTime,
  initState,
  localTime,
  log,
  onMenu,
  option,
  timers,
  type DrawCommand,
  type Timer,
} from "@overcrow/sdk";

interface Zone {
  id: string;
  offset: number;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    now: number;
    seconds: boolean;
    showDate: boolean;
    zones: Zone[];
  }
}

const state = initState({
  now: Date.now(),
  seconds: option("seconds", false),
  showDate: option("show-date", true),
  zones: [{ id: "utc", offset: 0 }] as Zone[],
});

export function clockTime(now: number, seconds: boolean): string {
  return formatTime(now, { seconds });
}

export function clockDate(now: number): string {
  return formatDate(now);
}

export function zoneTime(now: number, offset: number): string {
  return `${formatTime(now, { offsetMinutes: offset })} UTC${offset < 0 ? "-" : "+"}${formatNumber(Math.abs(offset) / 60, { maximumFractionDigits: 2 })}`;
}

export function setSeconds(detail: { value: unknown }): void {
  state.seconds = detail.value === true;
  restart();
}

function paint(): void {
  const { hour, minute } = localTime(state.now);
  const angle = ((hour % 12) * 30 + minute / 2) * (Math.PI / 180);
  const hand: DrawCommand[] = [
    ["circle", 16, 16, 14],
    ["stroke", "var(--color-border-strong)", 1],
    ["moveTo", 16, 16],
    ["lineTo", 16 + 9 * Math.sin(angle), 16 - 9 * Math.cos(angle)],
    ["stroke", "var(--color-accent)", 2],
  ];
  draw("dial", hand);
}

function tick(): void {
  state.now = Date.now();
  paint();
}

let clock: Timer | undefined;

function restart(): void {
  clock?.cancel();
  clock = timers.atEach(state.seconds ? "second" : "minute", tick);
  tick();
}

onMenu((row) => {
  if (row === "add-zone") {
    state.zones = [...state.zones, { id: `z${state.zones.length}`, offset: -300 }];
  }
});

restart();
log.debug("clock started");
