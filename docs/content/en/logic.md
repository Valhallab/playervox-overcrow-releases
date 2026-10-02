# The logic

`logic.ts` is the code of a PlayerVox OverCrow widget: it owns the widget's
state, exports the functions the view calls, and talks to OverCrow through
`@overcrow/sdk`. It is one TypeScript (or JavaScript) module, bundled with
the SDK into the package's only script, `logic.js`.

<!-- source: templates/counter/logic.ts -->
```ts
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
```

That is a complete logic module: a state with one member, and two handlers
that the view calls with `on:activate={increment}`.

## How the logic runs

- The module runs once, when the widget starts, in its own JavaScript VM
  inside a sandboxed process. It is not a browser and not Node.js: there is
  no DOM, `window`, `fetch`, `setTimeout`, `console`, `Intl` or
  `require`. The standard ECMAScript objects are there (`Math`, `JSON`,
  `Date`, `Map`, `Promise`…), and the SDK is the only way out.
- Everything after that happens in **turns**. OverCrow sends an event, a
  timer tick, a service answer or a change of its own data; your code runs;
  then the VM evaluates the view again and sends OverCrow only what
  changed. You never update the view by hand.
- A turn has a time budget, and the VM a memory ceiling. A widget that
  exceeds one is stopped and restarted by OverCrow, a few times; see
  [what happens on a failure](#what-happens-on-a-failure).

The only import a logic module may have is `@overcrow/sdk`. Everything else
it needs is in the module itself.

## The state

`state` is a plain object. Declare the type of its members once, by
extending the SDK's `WidgetState` interface, give it its first value with
`initState`, and assign to it from then on.

<!-- source: templates/list/logic.ts -->
```ts
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
```

After each turn the VM evaluates the whole view again and sends the
differences. There is nothing to subscribe to and no setter to call:
changing a member in place and replacing it both work.

<!-- source: templates/list/logic.ts -->
```ts
export function setDone(id: number, done: unknown): void {
  state.items = state.items.map((item) => (item.id === id ? { ...item, done: done === true } : item));
}
```

Keep in the state what the view shows, and in ordinary variables what only
the logic needs (a timer, a subscription). A value in the state must be
plain data: numbers, strings, booleans, `null`, arrays and objects of
those.

## Functions for the view

The view can call only what the logic module exports by name:

- in an **expression**, a function that returns what to show:
  `{remaining(state.items)}`;
- as a **handler**, a function that changes the state:
  `on:activate={remove(item.id)}`.

<!-- source: templates/list/logic.ts -->
```ts
export function remove(id: number): void {
  state.items = state.items.filter((item) => item.id !== id);
}
```

<!-- source: templates/list/logic.ts -->
```ts
export function remaining(items: readonly Item[]): number {
  return items.filter((item) => !item.done).length;
}
```

Expression functions run every time the view is evaluated: keep them cheap
and without side effects. A handler named without arguments
(`on:change={setRepeat}`) receives the event's detail:

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
export function setRepeat(event: { value: unknown }): void {
  state.repeat = event.value === true;
}
```

`export default` is refused: the view calls named exports. `t` needs no
export: a view that calls `t(…)` gets the SDK's, unless the logic exports
its own.

## Data from OverCrow: `host`

`host` holds what OverCrow knows about the user and the widget. Its members
always read the latest value.

| Member | Value |
| --- | --- |
| `host.locale` | Interface language, `"en"` or `"fr"`. |
| `host.theme` | `"dark"` or `"light"`. |
| `host.mode` | `"passive"` or `"interactive"`: the widget receives input only in Interactive mode. |
| `host.visible` | Whether the widget is shown. |
| `host.scale` | Content scale in thousandths: `1000` is 100 %. |
| `host.viewport` | `{ width, height }` of the widget's content, in logical pixels. |
| `host.region` | The user's regional formats and UTC offset; the formatting helpers read it. |
| `host.options` | Values of the options menu; read them with `option`. |
| `host.grants` | The capabilities the user granted; read it with `hasGrant`. |
| `host.messages` | The messages of the active language; read them with `t`. |

`onHost(listener)` calls your listener when OverCrow sends new values, with
the names of the members that changed, before the view is evaluated again.
Use it when a change needs more than showing the new value: re-arm a timer,
subscribe again, redraw a canvas. A member may be sent again with the same
value: compare it with the one you kept when that matters.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
});
```

Most widgets only show the buttons that work: in Passive mode a click goes
through the widget to the game, so the stopwatch hides its buttons unless
`host.mode` is `"interactive"`.

## The options menu

The rows declared in `wrapper.menu` of the [manifest](manifest.md#the-options-menu)
are drawn and stored by OverCrow. The logic reads them:

- `option(id, fallback)` returns the stored value of a toggle, slider or
  choice row, or `fallback` when there is none or it has another type;
- `onHost` reports `"options"` when the user changes a row;
- `onMenu(handler)` receives the ID of an `action` row when the user
  chooses it.

<!-- source: widgets/clock/logic.ts -->
```ts
export function menuValues(): { seconds: boolean; showDate: boolean; order: DateOrder } {
  return {
    seconds: option("show-seconds", false),
    showDate: option("show-date", true),
    order: DATE_ORDERS[option("date-format", "day-month-year")] ?? "dmy",
  };
}
```

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
onMenu((row) => {
  if (row === "reset-rounds") {
    resetRounds();
  }
});
```

Choosing a menu row is not a
[user action](services.md#calls-that-need-a-user-action) for a protected
service: an `action` row can change the state, not write to the clipboard.

## Timers

There is no `setTimeout`. Timers are OverCrow's, through `timers`:

| Function | Calls back |
| --- | --- |
| `timers.after(ms, callback)` | once, after `ms` |
| `timers.every(ms, callback)` | every `ms` |
| `timers.atEach(unit, callback)` | at each `"second"`, `"minute"`, `"hour"` or `"day"` of the user's local time |

Each returns a `Timer` with `cancel()`.

<!-- source: templates/chart/logic.ts -->
```ts
timers.every(1000, () => {
  const previous = state.values.at(-1) ?? 50;
  state.values = [...state.values.slice(1 - POINTS), sample(previous)];
});
```

Three rules follow from OverCrow owning the timers:

- **No timer shorter than 100 ms.** A shorter interval is raised to it.
  Motion belongs to the [style](style.md#transitions-and-animations), not to
  timers.
- **A hidden widget does not tick.** A repeating timer skips the ticks that
  fell while the widget was hidden; a one-shot timer that fell due while
  hidden ticks once when the widget is shown again. Compute elapsed time
  from `Date.now()`, never from a count of ticks:

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
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
```

- **At most 16 timers** at once.

For a clock, `timers.atEach` is the right tool: one repeating timer aligned
on the boundaries of local time, which also wakes when the UTC offset
changes (summer time) and once when the widget is shown again.

<!-- source: widgets/clock/logic.ts -->
```ts
/** Ticks at each second or minute of local time, and shows the time now. */
function start(): void {
  clock?.cancel();
  clock = timers.atEach(state.seconds ? "second" : "minute", tick);
  tick();
}
```

A duration that only has to advance on screen needs no timer at all: the
`elapsed` element is advanced by OverCrow from a starting point the logic
gives it. See the [`elapsed` element](elements.md#elapsed).

## Time, dates and numbers

Inside the VM, local time is UTC: `Date` never gives the user's time, and
there is no `Intl`. The SDK formats instead, from `host.region`:

| Helper | Gives |
| --- | --- |
| `formatTime(ms, { seconds })` | `14:08`, or `14:08:42`: 24-hour, in the user's time zone |
| `formatDate(ms, { order })` | `17/07/2026`, `07/17/2026` or `2026-07-17`, in the user's date order by default |
| `formatNumber(value, options)` | `1,234.5`, `1 234,5` or `1.234,5`: the user's separators, whatever the interface language |
| `formatDuration(ms, options)` | `04:05`, `1:02:03`, or `04:05.67` with hundredths |
| `localTime(ms)` | the fields of the instant in the user's time zone: `year`, `month`, `day`, `weekday`, `hour`… |

<!-- source: widgets/clock/logic.ts -->
```ts
export function clockTime(now: number, seconds: boolean): string {
  return formatTime(now, { seconds });
}
```

<!-- source: templates/chart/logic.ts -->
```ts
export function latest(values: readonly number[]): string {
  const last = values.at(-1);
  return last === undefined ? "" : formatNumber(last, { maximumFractionDigits: 0 });
}
```

A timestamp that comes from a service carries its own `offsetMinutes`: pass
it to the helper (`formatTime(at, { offsetMinutes })`), so that a session
recorded in another time zone shows the time it had there. Month and
weekday names and 12-hour clocks are not provided.

## Messages

Put the texts of the widget in `locales/en.json` and `locales/fr.json`:
two flat objects of strings with the same keys. Both files or neither.

<!-- source: templates/list/locales/en.json -->
```json
{
  "first": "Warm up",
  "remaining": "{count} left",
  "remove": "Remove",
  "second": "Play three matches",
  "third": "Update the drivers",
  "title": "Today"
}
```

`t(key, params)` returns the message of the user's language and replaces
each `{name}` by `params.name`; a missing key gives the key itself. It
works in the view and in the logic alike:

<!-- source: templates/list/view.ocml -->
```xml
  <text class="summary">{t("remaining", { count: remaining(state.items) })}</text>
```

<!-- source: widgets/stopwatch/logic.ts -->
```ts
export function toggleLabel(running: boolean): string {
  return t(running ? "pause" : "start");
}
```

When the user changes OverCrow's language, the view is evaluated again
with the new messages. A text that the logic computed and stored in the
state is not: compute texts in functions the view calls, or refresh them in
`onHost` when `"locale"` changes. The widget's name and its menu labels are
in the manifest, not in the locales.

`overcrow-widget check` warns when the view calls `t("key")` with a key
that has no message, and refuses two files whose keys differ.

## Drawing

For what the elements cannot show, a `canvas` element is a surface that
the logic paints with a list of commands: paths, fills, strokes, text and
images. `draw(ref, commands)` replaces the whole content of the canvas
named `ref`.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
/** One dot per finished round, on the `dots` canvas. */
function paint(): void {
  const dots: DrawCommand[] = [];
  for (let index = 0; index < Math.min(state.rounds, MAX_DOTS); index += 1) {
    dots.push(["circle", 6 + index * 14, 6, 4], ["fill", "var(--color-accent)"]);
  }
  draw("dots", dots);
}
```

Coordinates are logical pixels from the top-left corner of the canvas;
colours are literal (`#rrggbb`) or colour tokens. OverCrow checks every
command and draws them itself: there is no pixel access and no shader.
Draw again when what you show changes, and when `host.theme` changes if you
use literal colours.

<!-- generated:draw-commands -->
| Command | Arguments | Meaning |
| --- | --- | --- |
| `moveTo` | `x`: number -16384 to 16384; `y`: number -16384 to 16384 | Starts a subpath. |
| `lineTo` | `x`: number -16384 to 16384; `y`: number -16384 to 16384 | Straight segment. |
| `quadTo` | `cx`: number -16384 to 16384; `cy`: number -16384 to 16384; `x`: number -16384 to 16384; `y`: number -16384 to 16384 | Quadratic Bézier segment. |
| `cubicTo` | `c1x`: number -16384 to 16384; `c1y`: number -16384 to 16384; `c2x`: number -16384 to 16384; `c2y`: number -16384 to 16384; `x`: number -16384 to 16384; `y`: number -16384 to 16384 | Cubic Bézier segment. |
| `arc` | `cx`: number -16384 to 16384; `cy`: number -16384 to 16384; `r`: number -16384 to 16384; `start`: number -720 to 720; `end`: number -720 to 720 | Circular arc in degrees, clockwise. |
| `rect` | `x`: number -16384 to 16384; `y`: number -16384 to 16384; `w`: number -16384 to 16384; `h`: number -16384 to 16384; `radius`: number -16384 to 16384 | Closed rounded-rectangle subpath. |
| `circle` | `cx`: number -16384 to 16384; `cy`: number -16384 to 16384; `r`: number -16384 to 16384 | Closed circle subpath. |
| `close` | none | Closes the subpath. |
| `fill` | `color`: `<color>` | Fills and clears the current path. |
| `stroke` | `color`: `<color>`; `width`: number 0 to 256 | Strokes and clears the current path. |
| `text` | `x`: number -16384 to 16384; `y`: number -16384 to 16384; `text`: text ≤ `MAX_ATTRIBUTE_TEXT_BYTES`; `size`: number 6 to 96; `color`: `<color>`; `align`: `start` \| `center` \| `end`; `family`: `ui` \| `mono` \| `display`; `weight`: `400` \| `500` \| `600` \| `700` | One line of text on its baseline. |
| `image` | `src`: image source; `x`: number -16384 to 16384; `y`: number -16384 to 16384; `w`: number -16384 to 16384; `h`: number -16384 to 16384 | Draws an image scaled into the rectangle. |
| `save` | none | Pushes transform, clip and alpha, ≤ `MAX_DRAW_STATE_DEPTH`. |
| `restore` | none | Pops the state; a `restore` without a `save` is an error. |
| `clip` | `x`: number -16384 to 16384; `y`: number -16384 to 16384; `w`: number -16384 to 16384; `h`: number -16384 to 16384 | Intersects the clip rectangle with this one. |
| `translate` | `x`: number -16384 to 16384; `y`: number -16384 to 16384 | Translates. |
| `rotate` | `degrees`: number -360 to 360 | Rotates. |
| `scale` | `x`: number 0 to 8; `y`: number 0 to 8 | Scales. |
| `alpha` | `value`: number 0 to 1 | Multiplies opacity. |
<!-- /generated:draw-commands -->

A chart, a gauge or a progress bar needs no canvas: the `chart`, `gauge`
and `progress` elements draw them from values.

## Logging

`log.debug`, `log.info`, `log.warn` and `log.error` take one text. They
appear in the terminal of `overcrow-widget dev` and nowhere else: an
installed widget's logs are dropped. Never log user data.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
  log.info(`round ${state.rounds} finished`);
```

## What the logic cannot use

`overcrow-widget check` lints the logic against what the VM runs and names
the SDK replacement:

| Code | Rule |
| --- | --- |
| `logic.syntax` | The module parses as ES2023; TypeScript types are allowed. |
| `logic.import` | Its only import is `@overcrow/sdk`: no other module, file or package, no `export *`. |
| `logic.dynamic_import`, `logic.import_meta` | No `import()` and no `import.meta`. |
| `logic.eval`, `logic.function_constructor` | No `eval`, no `Function(…)` or `new Function(…)`. |
| `logic.unavailable_global` | Every global it reads exists in the VM. `Intl`, `setTimeout`, `console`, `fetch`, `WebAssembly`, `SharedArrayBuffer`, `performance`, `WeakRef`, browser and Node.js globals do not. |
| `logic.top_level_await`, `logic.top_level_this` | No top-level `await` or `for await`, no top-level `this`. |
| `logic.syntax_version` | Nothing newer than ES2023: decorators, `using`, the regular expression `v` flag, import attributes. |
| `logic.default_export` | The view calls named exports; `export default` is refused. |
| `logic.missing_export` | Every function the view calls is exported. |
| `logic.debugger` | `debugger` is a warning. |

The lint helps you; it is not what protects the user. The sandbox, the
VM's budgets and OverCrow's check of everything the widget sends do that.

## What happens on a failure

- An exception in a handler ends that turn; the widget keeps running, and
  `overcrow-widget dev` shows the fault.
- A turn longer than its budget (50 ms), a heap over its ceiling or too
  many messages in a turn stop the widget. OverCrow shows a fixed error in
  its frame and restarts it after 1, 5 and 15 seconds, at most three times.
- A rejected promise of a service call is an ordinary error of your code:
  catch it. See [errors](services.md#errors).

The numbers are in [limits](limits.md#logic). The whole API of the SDK is
in the [SDK reference](sdk.md).
