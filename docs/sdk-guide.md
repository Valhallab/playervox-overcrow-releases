# Writing widget logic with `@overcrow/sdk`

A widget API v1 package holds a compiled view (`view.json`, from
`view.ocml`), an optional style sheet, messages and one script,
`logic.js`. The script owns the widget state; the host draws the view and
answers the services. This guide covers the script, written in TypeScript
against `@overcrow/sdk` 1.0; the [reference](sdk-reference.md) lists the
whole API and the [source formats](widget-source-formats.md) describe the
view and the style.

The widget CLI, `overcrow-widget`, creates a project, checks it and links
the logic module, the SDK and the view table into `logic.js`
([CLI guide](cli.md)):

```sh
overcrow-widget init my-clock --template counter
cd my-clock && npm install
overcrow-widget check
overcrow-widget package
```

`templates/` holds the starting points (`blank`, `counter`, `list`,
`chart`) and `sdk/test/e2e/clock/` a complete Clock.

## The runtime model

- `logic.js` runs once when the widget starts, in a sandboxed QuickJS VM
  with no network, file, clock zone or `Intl`: only the SDK reaches the
  host.
- The state is a plain object, `state`. Each turn (an event, a timer tick,
  a service answer, a host change) runs your code, then the VM evaluates
  the view again and sends only what changed.
- View expressions (`{clockTime(state.now)}`) and handlers
  (`on:change={setSeconds}`) call functions your logic module exports; the
  view cannot run anything else.
- Budgets are strict (`VM_TURN_BUDGET_MS` per turn, the heap, the number
  of timers and calls): exceeding one stops the widget.

## A clock

```xml
<!-- view.ocml -->
<box class="clock">
  <text class="time">{clockTime(state.now, state.seconds)}</text>
  <toggle label={t("seconds")} checked={state.seconds} on:change={setSeconds}/>
</box>
```

```ts
// logic.ts
import { formatTime, initState, option, timers, type Timer } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    now: number;
    seconds: boolean;
  }
}

const state = initState({ now: Date.now(), seconds: option("seconds", false) });

export function clockTime(now: number, seconds: boolean): string {
  return formatTime(now, { seconds });
}

export function setSeconds(detail: { value: unknown }): void {
  state.seconds = detail.value === true;
  restart();
}

let clock: Timer | undefined;
function restart(): void {
  clock?.cancel();
  clock = timers.atEach(state.seconds ? "second" : "minute", () => {
    state.now = Date.now();
  });
  state.now = Date.now();
}
restart();
```

`t` needs no export: a view calls the SDK's `t` unless the logic module
exports its own.

## Time and numbers

`Date` works in UTC inside the VM and never gives the user's time. Use the
SDK helpers, which read `host.region`: `formatTime`, `formatDate` (numeric,
in the user's date order), `formatNumber` (the user's separators, not the
interface language's), `formatDuration` and `localTime`. A service
timestamp carries its own `offsetMinutes`; pass it to the helper. For a
clock, `timers.atEach(unit, callback)` wakes at each local boundary and at
the next change of UTC offset.

## Services and permissions

Declare what the widget needs in `manifest.json` (`permissions`), then use
the typed namespaces: `storage`, `http`, `clipboard`, `gameEvents` and the
capability services (`fps`, `telemetry`, `session`, `media`, `stopwatch`,
`notes`, `playervox`, `journal`, `twitch`). Declaring a capability grants
nothing until the user consents; check `hasGrant(capability)` and show a
useful state when it is missing.

- Calls return promises that reject with a `ServiceError` whose `code` says
  why (`permission_denied`, `gesture_required`, `quota_exceeded`…).
- Subscriptions call your listener with the current value, then each
  update, until you `cancel()` them or a final error arrives. A host
  source can fail while the widget runs (the media player's session, for
  example): the subscription then ends with `unavailable`. Show it, and
  subscribe again after a few seconds with `timers.after`; the host
  restarts a source when a widget subscribes, and sends nothing until it
  answers. The [Media widget](../widgets/media/logic.ts) retries after 5 s.
- Actions that change user data (`notes.create`, `media.next`,
  `twitch.chat.join`…) need a user gesture: call them from an `activate`,
  `keydown`, `change`… handler, not from a timer or a menu action.
- Text written to notes, ratings and chat goes through a `form` with an
  `intent`: the host sends its own controls' values, never the script's.
  Leave `value` off the `field`, `textarea` and `slider` controls of such a
  form (`overcrow-widget check` reports it): the host fills them where the
  intent says so, keeps what the user entered, and tells the logic each
  value in the control's `input` event. The
  [PlayerVox rating widget](../widgets/playervox-rating/logic.ts) follows
  its three sliders and its review this way.
- A form keeps what the user entered for as long as it stays in the view:
  hide it with `display: none` to keep a draft, remove it to discard one.
  The [Notes widget](../widgets/notes/logic.ts) keeps one hidden form per
  note with a draft. Its `notes.save` form has one `item` field per
  checklist row: the logic adds and removes rows, and the host remembers
  which entry it filled each field with. In that form Enter moves to the
  next field; Ctrl+Enter or a `submit` button saves.

## Drawing, menus and messages

- `draw(ref, commands)` fills a `<canvas ref="…">` with typed commands
  (`["moveTo", x, y]`, `["stroke", "var(--color-accent)", 2]`…); the host
  checks and draws them.
- `wrapper.menu` rows declared in the manifest are stored by the host:
  read them with `option(id, fallback)`; `onMenu(handler)` receives the
  `action` rows. A toggle or choice row changes `host.options`:
  `onHost(listener)` runs your code when it does (and when the widget is
  shown again, the language, theme or region changes), for example to
  re-arm a timer.
- `t(key, { name })` reads `locales/en.json` or `locales/fr.json` for the
  active language and fills `{name}`.
- `log.info(text)` shows in development installs only. Never log user data.

## Checking and testing

- `overcrow-widget check` validates the manifest, the view, the style and
  the locales, lints the logic against what the VM runs (one module, no
  `eval`, no `Intl`, `setTimeout` or `console`…) and runs the project's
  `tsc`: the SDK types catch wrong service parameters, unknown icons, draw
  commands and capabilities.
- The helpers take their region values as options, so they run in a unit
  test outside the VM. The rest of the SDK needs the VM's runtime: in a unit
  test, `@overcrow/sdk/testing` installs a stand-in with virtual time
  (`installRuntime`, `advance`, `push`, `lastCall`…), and elsewhere the SDK
  throws a clear error.
- `overcrow-widget test` plays scenarios in OverCrow's headless runtime:
  the real VM and renderer, simulated services, reference images. See
  [Testing a widget](widget-testing.md).
- The host remains the authority: the SDK only helps you call it right.
