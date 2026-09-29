# Writing widget logic with `@overcrow/sdk`

A widget API v1 package holds a compiled view (`view.json`, from
`view.ocml`), an optional style sheet, messages and one script,
`logic.js`. The script owns the widget state; the host draws the view and
answers the services. This guide covers the script, written in TypeScript
against `@overcrow/sdk` 1.0; the [reference](sdk-reference.md) lists the
whole API and the [source formats](widget-source-formats.md) describe the
view and the style.

The widget CLI (P2.2) bundles the logic module and the SDK into
`logic.js`. Until it ships, `sdk/test/e2e/` shows the complete shape of a
widget: `clock.ocml`, its compiled `clock.view.json`, the logic
`clock.ts` and the generated table `clock.view.js`.

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
  update, until you `cancel()` them or a final error arrives.
- Actions that change user data (`notes.create`, `media.next`,
  `twitch.chat.join`…) need a user gesture: call them from an `activate`,
  `keydown`, `change`… handler, not from a timer or a menu action.
- Text written to notes, ratings and chat goes through a `form` with an
  `intent`: the host sends its own controls' text, never the script's.

## Drawing, menus and messages

- `draw(ref, commands)` fills a `<canvas ref="…">` with typed commands
  (`["moveTo", x, y]`, `["stroke", "var(--color-accent)", 2]`…); the host
  checks and draws them.
- `wrapper.menu` rows declared in the manifest are stored by the host:
  read them with `option(id, fallback)`; `onMenu(handler)` receives the
  `action` rows.
- `t(key, { name })` reads `locales/en.json` or `locales/fr.json` for the
  active language and fills `{name}`.
- `log.info(text)` shows in development installs only. Never log user data.

## Checking and testing

- Type your logic with the SDK: `tsc --noEmit` catches wrong service
  parameters, unknown icons, draw commands and capabilities.
- The helpers take their region values as options, so they run in a unit
  test outside the VM; the rest of the SDK needs the VM and throws a clear
  error elsewhere.
- The host remains the authority: the SDK only helps you call it right.
