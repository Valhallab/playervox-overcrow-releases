// A counter. The view reads `state.count` and calls `increment` and
// `decrement` on activation; after each handler the VM renders the view
// again and sends only what changed.
import { initState } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    count: number;
  }
}

const state = initState({ count: 0 });

export function increment(): void {
  state.count += 1;
}

export function decrement(): void {
  state.count -= 1;
}
