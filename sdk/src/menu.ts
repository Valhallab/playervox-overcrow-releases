import { runtime } from "./runtime.js";

/**
 * Receives the `action` rows of the widget's `wrapper.menu`, by row ID.
 * A menu action is never a user gesture. Toggle, slider and choice rows
 * are stored by the host and read through `host.options` or `option()`.
 * A later call replaces the handler.
 */
export function onMenu(handler: (row: string) => void): void {
  runtime().onMenu(handler);
}
