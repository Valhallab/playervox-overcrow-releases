// A daily goal of matches. Today's progress and the week's goals reached
// are the user's: they follow the accent colour the user chose in
// PlayerVox OverCrow, which the manifest asks for with "accent": "user".
import { draw, initState, onHost, userAccentColors, type DrawCommand } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    count: number;
    goal: number;
    week: boolean[];
  }
}

const state = initState({ count: 0, goal: 3, week: [true, false, true] as boolean[] });

/** One dot per day of the week: the user's accent when the goal was
 * reached, a light wash of it otherwise. */
function paint(): void {
  // A token follows the user's colour by itself; a wash needs the colour's
  // value, with an alpha added.
  const { fill } = userAccentColors();
  const dots: DrawCommand[] = [];
  state.week.forEach((reached, day) => {
    dots.push(["circle", 6 + day * 14, 6, 4]);
    dots.push(["fill", reached ? "var(--color-user-accent)" : `${fill}40`]);
  });
  draw("week", dots);
}

export function add(): void {
  state.count += 1;
}

// The user may choose another colour, or another theme, while the widget
// runs: draw the wash again. The style and the tokens follow by themselves.
onHost((changed) => {
  if (changed.includes("userAccent") || changed.includes("theme")) {
    paint();
  }
});

paint();
