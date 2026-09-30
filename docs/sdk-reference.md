# `@overcrow/sdk` 1.0 reference

The API of widget logic for widget API v1. Every export of the package is
listed here; `sdk/test/reference.test.mjs` fails when an export is missing
from this page or lacks its TSDoc, and the TypeScript declarations
(`dist/index.d.ts`) carry the detail of each member. Start with the
[guide](sdk-guide.md).

```ts
import * as overcrow from "@overcrow/sdk";
```

The SDK runs inside the widget VM, bundled into `logic.js`. It wraps the
VM's runtime surface 0.1 (the frozen global `overcrow`, reported as `sdk`
in the VM's `Ready` message): SDK 1.x needs runtime surface 0.1. Loading it
anywhere else throws an error naming that requirement. It is a convenience
layer, not a security boundary: the host checks every call, parameter,
gesture and value that leaves the VM.

| Export | Kind | Summary |
| --- | --- | --- |
| `SDK_VERSION` | constant | `"1.0.0"`. |
| `RUNTIME_SURFACE` | constant | `"0.1"`, the runtime surface this SDK needs. |

## State and view

| Export | Kind | Summary |
| --- | --- | --- |
| `state` | constant | The widget state object. Mutate it; after each turn the VM evaluates the view again and sends only the differences. |
| `WidgetState` | interface | Type of `state`; declare its members by module augmentation. Undeclared members are `unknown`. |
| `initState(initial)` | function | Copies `initial` into `state` and returns `state` typed as `initial`. |
| `registerView(table)` | function | Registers the expression and handler table of `view.json`, once, while `logic.js` loads. The widget CLI generates this call. |
| `ViewTable` | type | `ReadonlyArray<Expression \| Handler>`, one entry per expression index. |
| `Expression` | type | `(state, scope) => value`. |
| `Handler` | type | `(state, scope, event) => void`, with `event` a `NodeEvent`. |
| `NodeEvent<E>` | interface | `{ type, detail }` of an event; `detail` is `EventDetailMap[E]`. |
| `Scope` | interface | Names in scope: `for` items, component props. |

```ts
declare module "@overcrow/sdk" {
  interface WidgetState {
    now: number;
  }
}
const s = overcrow.initState({ now: Date.now() });
```

### Calling convention of the view table

`view.json` numbers every expression and handler of `view.ocml`
([source formats](widget-source-formats.md#compiled-output)). The widget
CLI turns the compiler's table into a module that runs after the logic
module and registers one function per index:

```js
import * as logic from "./logic.js";
import { registerView, t as sdkT } from "@overcrow/sdk";

const { clockTime, setSeconds } = logic;   // every called name but `t`
const t = "t" in logic ? logic.t : sdkT;   // when `t` is called

registerView([
  function (state, scope) {                // an expression
    const zone = scope.zone;               // each name in scope
    return clockTime(state.now, zone.offset);
  },
  function (state, scope, raw) {           // a handler
    const event = raw.detail;              // `event` is the event detail
    return setSeconds(event);
  },
]);
```

- An expression is `function (state, scope)`, a handler
  `function (state, scope, raw)`; the VM passes `raw = { type, detail }`.
- Its body binds, in order, each name of the expression's scope from
  `scope` (`const zone = scope.zone;`), and in a handler `event` from
  `raw.detail`, then returns the canonical JavaScript text of the
  expression.
- A called name is an export of the logic module; `t` is the SDK's unless
  the logic module exports its own.
- The table has exactly the `expressions` count of `view.json`; the VM
  refuses the bundle otherwise.

The widget CLI writes this module and links it after the logic module
([CLI guide](cli.md#how-logicjs-is-built)). It names the second and third
parameters `__scope` and `__raw`, which no view name can be, so they never
shadow a called function or a name in scope. `sdk/test/e2e/clock/` is a
complete widget packaged this way by the SDK's tests.

## Host data

| Export | Kind | Summary |
| --- | --- | --- |
| `host` | constant | Frozen object whose members always read the latest host values. |
| `HostData` | interface | `locale`, `messages`, `theme`, `region`, `scale` (‰), `viewport`, `mode`, `visible`, `options`, `grants`. |
| `onHost(listener)` | function | Calls `listener` with the names of the `host` members each host message sent (`options` after a menu change, `visible` when shown or hidden, `region`…), before the view is evaluated again; returns `{ cancel() }`. |
| `HostKey`, `HostListener` | types | A member name of `HostData`, and an `onHost` listener. |
| `Viewport` | interface | `{ width, height }`, logical px. |
| `hasGrant(capability)` | function | Whether the user granted a capability. |
| `option(id, fallback)` | function | Stored value of a `wrapper.menu` row, or `fallback` when missing or of another type. |
| `MenuValue` | type | `boolean \| number \| string`. |
| `Widened<T>` | type | The result type of `option`: `false` gives `boolean`. |

## Services

Every service answers through the host, which checks its permission or
capability, parameters and gesture at each call. Declaring a capability
grants nothing: the user consents, and `hasGrant` tells what was granted.

| Export | Kind | Summary |
| --- | --- | --- |
| `storage` | namespace | `get({ key })`, `set({ key, value })`, `remove({ key })`, `keys()`. Permission `storage`. |
| `http` | namespace | `fetch(url, { as, method?, body?, contentType? })`. Permission `network`. |
| `clipboard` | namespace | `writeText({ text })` on a gesture. Permission `clipboardWrite`. |
| `gameEvents` | namespace | `subscribe(listener)`. Permission `gameEvents`. |
| `session` | namespace | `subscribe(listener)`. Capability `session.read`. |
| `telemetry` | namespace | `subscribe(listener)`. Capability `telemetry.read`. |
| `fps` | namespace | `subscribe(listener)`. Capability `fps.read`. |
| `media` | namespace | `subscribe({ cover? }, listener)`; `previous`, `playPause`, `next({ player? })` on a gesture. |
| `stopwatch` | namespace | `subscribe(listener)`; `toggle()`, `reset()` on a gesture. |
| `notes` | namespace | `subscribe(listener)`; `create()`, `select({ note })`, `setItem({ note, item, checked })`, `delete({ note })` on a gesture. |
| `playervox` | namespace | `score.subscribe`, `rating.subscribe`, `reviews.page({ page?, followedOnly? })`. |
| `journal` | namespace | `page({ cursor? })`; `delete({ session })` on a gesture, after the host's confirmation. |
| `twitch` | namespace | `chat.subscribe(listener)`; `chat.join({ channel })`, `chat.leave()`, `chat.favorite({ channel, favorite })` on a gesture. |
| `call(service, params?)` | function | Calls any answered-once service by name. |
| `subscribe(service, params, listener)` | function | Subscribes to any subscription service by name. |
| `ServiceError` | class | Rejection of a failed call: `code` is a `ServiceErrorCode`. |
| `Listener<T>` | type | `(update: SubscriptionUpdate<T>) => void`. |
| `SubscriptionUpdate<T>` | type | `{ ok: true, value, final }` or `{ ok: false, error, final: true }`. |
| `Subscription` | interface | `cancel()`, idempotent. |
| `ServiceParams<N>` | type | Parameters of service `N`. |
| `ServiceResult<N>` | type | Result, or update, of service `N`. |
| `FetchOptions<A>` | interface | Options of `http.fetch`. |
| `FetchResponse<A>` | type | `{ status, contentType, body }`, or `{ status, asset }` for `as: "image"`. |
| `BodyType` | type | `"json" \| "text" \| "bytes" \| "image"`. |
| `BodyTypes` | interface | Decoded body of each body type. |
| `HttpMethod` | type | Methods of network rules. |
| `HttpServices` | interface | Type of `http`. |

The listener always comes last, and a service without parameters takes
none:

```ts
overcrow.fps.subscribe((update) => {
  if (update.ok) overcrow.state.fps = update.value.fps;
});
overcrow.media.subscribe({ cover: false }, (update) => { /* … */ });
const note = await overcrow.notes.create(); // in a gesture handler
```

A gesture-bound service must be called while an `activate`, `keydown`,
`input`, `change`, `submit` or `contextmenu` handler runs; the VM attaches
that gesture to the call, and the host refuses it otherwise
(`gesture_required`). Text written to notes, ratings and chat never goes
through a call: a `form` with an `intent` sends its host-owned controls.

`http.fetch` sends a string body as `text/plain` and any other body as JSON,
unless `contentType` says otherwise, and decodes the answer as `as` asks; a
response without a body gives `null`, `""` or an empty `ArrayBuffer`.

The namespace types are generated: `ClipboardServices`, `FpsServices`,
`GameEventsServices`, `JournalServices`, `MediaServices`, `NotesServices`,
`PlayervoxServices`, `SessionServices`, `StopwatchServices`,
`StorageServices`, `TelemetryServices` and `TwitchServices`.

## Timers

| Export | Kind | Summary |
| --- | --- | --- |
| `timers` | namespace | `after(ms, callback)`, `every(ms, callback)`, `atEach(unit, callback)`. |
| `Timer` | interface | `cancel()`, idempotent. |

Timers are host timers: at most `MAX_TIMERS`, never shorter than
`MIN_TIMER_INTERVAL_MS` (a shorter interval is raised to it), and none
ticks while the widget is hidden. A repeating timer skips hidden ticks; a
one-shot timer that fell due while hidden ticks once when the widget is
shown again. `atEach("second" | "minute" | "hour" | "day", callback)` calls
`callback` at each boundary of local time, and once when the widget is
shown again. Seconds and minutes run on one repeating host timer aligned on
the boundaries (a UTC offset is a whole number of minutes): one VM turn per
tick; a tick more than `MIN_TIMER_INTERVAL_MS` late or early re-aligns it.
Hours and days re-arm from the current time after each call and also wake
at `host.region.nextChangeAt`, when the host sends the new UTC offset.

## Drawing, menu, messages and log

| Export | Kind | Summary |
| --- | --- | --- |
| `draw(ref, commands)` | function | Replaces the command list of the `canvas` named `ref`. |
| `onMenu(handler)` | function | Receives the ID of each `action` row of `wrapper.menu`. |
| `t(key, params?)` | function | Message of the active locale, `{name}` replaced by `params.name`; the key when missing. |
| `MessageParams` | type | `Record<string, string \| number>`. |
| `log` | namespace | `debug`, `info`, `warn`, `error(text)`: development log, dropped in production. |

Draw commands are typed tuples, checked by the host:

```ts
overcrow.draw("spark", [
  ["moveTo", 0, 20],
  ["lineTo", 40, 4],
  ["stroke", "var(--color-accent)", 2],
]);
```

## Time, dates and numbers

The VM has no `Intl`, and its local time is UTC: `Date` never gives the
user's time. These helpers format from `host.region`, with no locale data:
numbers follow the user's `numberFormat` (`us` 1,234.5 by default, `fr`
1 234,5 with a no-break space, `de` 1.234,5), whatever the interface
language; dates are numeric in the user's `dateOrder`; times are 24-hour.
Each helper accepts its region values as options, so it also runs outside
the VM.

| Export | Kind | Summary |
| --- | --- | --- |
| `localTime(ms, offsetMinutes?)` | function | `LocalTime` fields of an instant in the user's offset, or in a service timestamp's own `offsetMinutes`. |
| `formatTime(ms, options?)` | function | `14:08`, or `14:08:42` with `seconds: true`. |
| `formatDate(ms, options?)` | function | `17/07/2026` (`dmy`), `07/17/2026` (`mdy`), `2026-07-17` (`ymd`). |
| `formatNumber(value, options?)` | function | Separators of `numberFormat`; `minimumFractionDigits`, `maximumFractionDigits` (default 3), `grouping`. |
| `formatDuration(ms, options?)` | function | `04:05`, `1:02:03`, `04:05.67` with `hundredths: true`; truncated like a stopwatch. |
| `delayToNext(unit, nowMs, region?)` | function | Milliseconds to the next local boundary, never past `nextChangeAt`. |
| `LocalTime` | interface | `year`, `month` (1–12), `day`, `weekday` (0 is Sunday), `hour`, `minute`, `second`, `millisecond`. |
| `TimeUnit` | type | `"second" \| "minute" \| "hour" \| "day"`. |
| `TimeOptions` | interface | `offsetMinutes`. |
| `DateOptions` | interface | `offsetMinutes`, `order`. |
| `ClockOptions` | interface | `offsetMinutes`, `seconds`. |
| `NumberOptions` | interface | Options of `formatNumber`. |
| `DurationOptions` | interface | `hours`, `hundredths`, `format`. |

Month and weekday names, 12-hour clocks and plural rules are not part of
1.0.

## Generated types and limits

`sdk/src/generated/` is written from the widget schema by
`cargo run -p overcrow-widget-schema --example sdk-types`; the contract CI
job fails when it differs from the schema. The [schema
reference](widget-schema-v1.md) documents each value.

| Export | Summary |
| --- | --- |
| `ServiceName`, `CallServiceName`, `SubscribeServiceName`, `GestureServiceName` | Service names by kind. |
| `ServiceParamsMap`, `ServiceResultMap` | Parameters and result of each service. |
| `ServiceErrorCode`, `ServiceErrorPayload` | Failure codes, and the `{ code }` value the host sends. |
| `Session`, `Telemetry`, `Fps`, `Stopwatch`, `Media`, `Notes`, `Note`, `NoteItem`, `CreatedNote`, `Score`, `Rating`, `Review`, `ReviewsPage`, `JournalPage`, `JournalSession`, `TwitchChat`, `ChatMessage`, `ChatFragment`, `GameEvent`, `HttpResponse` | Result shapes. |
| `Permission`, `Capability`, `SensitiveCapability`, `CapabilityServices`, `PermissionServices` | Manifest permissions and capabilities, and the services each authorizes. |
| `Locale`, `Theme`, `Mode`, `Region`, `NumberFormat`, `DateOrder` | Host values. |
| `EventName`, `GestureEventName`, `EventDetailMap`, `NamedKey` | View events and their details. |
| `DrawCommand`, `DrawCommandName`, `Color` | Canvas commands and colours. |
| `TokenName`, `ColorToken`, `LengthToken`, `FontSizeToken`, `FontFamilyToken`, `TimeToken`, `ShadowToken` | Design tokens. |
| `IconName` | The Lucide icons the host draws. |
| `MenuRowType`, `HostFeature` | `wrapper.menu` row types and data sources. |
| `JsonValue`, `AssetHandle`, `ImageSource` | JSON values and image sources. |

The limits a widget works against are constants: `MAX_TIMERS`,
`MIN_TIMER_INTERVAL_MS`, `MAX_SERVICE_CALLS_IN_FLIGHT`,
`MAX_SUBSCRIPTIONS`, `MAX_STORAGE_KEYS`, `MAX_STORAGE_KEY_BYTES`,
`MAX_STORAGE_VALUE_BYTES`, `STORAGE_QUOTA_BYTES`, `MAX_REQUEST_URL_BYTES`,
`MAX_HTTP_REQUEST_BYTES`, `MAX_HTTP_RESPONSE_BYTES`, `MAX_CLIPBOARD_BYTES`,
`MAX_OBJECT_ID_BYTES`, `MAX_NOTES`, `MAX_NOTE_ITEMS`,
`MAX_NOTE_TITLE_BYTES`, `MAX_NOTE_BODY_BYTES`, `MAX_NOTE_ITEM_BYTES`,
`MAX_REVIEW_CHARS`, `MAX_CHAT_CHANNEL_BYTES`, `MAX_CHAT_MESSAGE_CHARS`,
`MAX_CHAT_FRAGMENTS`, `MAX_CHAT_FAVORITES`, `MAX_DRAW_COMMANDS`,
`MAX_DRAW_STATE_DEPTH`, `MAX_PATH_POINTS`, `MAX_PATCH_BYTES`,
`MAX_SCENE_NODES`, `MAX_CHILDREN`, `MAX_NODE_TEXT_BYTES`,
`MAX_ATTRIBUTE_TEXT_BYTES`, `MAX_LABEL_BYTES`, `MAX_FIELD_TEXT_BYTES`,
`MAX_LOCALE_ENTRIES`, `MAX_LOG_BYTES`, `VM_HEAP_BYTES`,
`VM_MAX_HEAP_BYTES`, `VM_TURN_BUDGET_MS`, `VM_JOBS_PER_TURN` and
`VM_MESSAGES_PER_TURN`.
