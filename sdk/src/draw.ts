import { runtime } from "./runtime.js";
import type { DrawCommand } from "./generated/schema.js";

/**
 * Replaces the command list of the `canvas` whose `ref` is `ref`. The
 * host keeps the latest list of each canvas and draws it inside the canvas
 * rectangle, in logical px from its origin; it checks every command. A
 * list is sent once, after the scene patch of its turn, whether that canvas
 * is in the scene or not.
 *
 * @throws TypeError when no canvas of the view has this `ref`, or for an
 * unknown command; a list over `MAX_DRAW_COMMANDS` or `MAX_PATCH_BYTES`
 * ends the widget (`resource_limit`).
 *
 * @example
 * ```ts
 * draw("spark", [
 *   ["moveTo", 0, 20],
 *   ["lineTo", 40, 4],
 *   ["stroke", "var(--color-accent)", 2],
 * ]);
 * ```
 */
export function draw(ref: string, commands: readonly DrawCommand[]): void {
  runtime().draw(ref, commands);
}
