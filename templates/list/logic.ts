// A checklist. Items live in the state; the view repeats a row per item
// and calls `setDone` and `remove` with the item's ID.
import { initState, t } from "@overcrow/sdk";

interface Item {
  id: number;
  text: string;
  done: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    items: Item[];
  }
}

const state = initState({
  items: [
    { id: 1, text: t("first"), done: false },
    { id: 2, text: t("second"), done: false },
    { id: 3, text: t("third"), done: true },
  ] as Item[],
});

export function setDone(id: number, done: unknown): void {
  state.items = state.items.map((item) => (item.id === id ? { ...item, done: done === true } : item));
}

export function remove(id: number): void {
  state.items = state.items.filter((item) => item.id !== id);
}

export function remaining(items: readonly Item[]): number {
  return items.filter((item) => !item.done).length;
}
