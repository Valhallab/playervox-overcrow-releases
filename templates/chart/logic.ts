// A live chart. A host timer adds a sample every second and keeps the last
// POINTS values; the host draws the series.
import { formatNumber, initState, timers } from "@overcrow/sdk";

const POINTS = 30;

declare module "@overcrow/sdk" {
  interface WidgetState {
    values: number[];
  }
}

const state = initState({ values: [50] as number[] });

export function latest(values: readonly number[]): string {
  const last = values.at(-1);
  return last === undefined ? "" : formatNumber(last, { maximumFractionDigits: 0 });
}

function sample(previous: number): number {
  return Math.min(100, Math.max(0, previous + (Math.random() - 0.5) * 20));
}

timers.every(1000, () => {
  const previous = state.values.at(-1) ?? 50;
  state.values = [...state.values.slice(1 - POINTS), sample(previous)];
});
