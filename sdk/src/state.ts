import { runtime } from "./runtime.js";

/**
 * The widget state. Declare its members by module augmentation:
 *
 * ```ts
 * declare module "@overcrow/sdk" {
 *   interface WidgetState { now: number }
 * }
 * ```
 *
 * Members that are not declared are `unknown`.
 */
export interface WidgetState {
  [key: string]: unknown;
}

/**
 * The widget state object. Mutate it from handlers, timers and service
 * callbacks; after every turn the VM evaluates the view again and sends
 * only what changed. View expressions receive the same object as `state`.
 */
export const state: WidgetState = /* @__PURE__ */ runtimeState();

function runtimeState(): WidgetState {
  return runtime().state as WidgetState;
}

/**
 * Copies the members of `initial` into the widget state and returns the
 * state, typed as `initial`. Call it once while `logic.js` loads.
 *
 * @example
 * ```ts
 * const s = initState({ now: Date.now(), showDate: true });
 * s.now += 1000;
 * ```
 */
export function initState<T extends object>(initial: T): T & WidgetState {
  return Object.assign(runtime().state, initial) as T & WidgetState;
}
