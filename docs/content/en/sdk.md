# SDK reference

`@overcrow/sdk` 1.0 is the API of the logic of a PlayerVox OverCrow
widget: the state, the data of the host, services, timers, drawing, the
options menu, messages, logs and formatting. This page lists every export
of the package. [The logic](logic.md) and
[services and permissions](services.md) explain how to use them.

<!-- source: widgets/clock/logic.ts -->
```ts
import {
  formatDate,
  formatTime,
  initState,
  onHost,
  option,
  t,
  timers,
  type DateOrder,
  type Timer,
} from "@overcrow/sdk";
```

The SDK is bundled into the widget's `logic.js` when it is packaged, and
runs inside the widget's VM; loading it anywhere else throws an error.
Unused parts are removed from the bundle. It is a convenience, not a
security boundary: OverCrow checks every call, parameter and value that
leaves the VM.

| Export | Kind | Summary |
| --- | --- | --- |
| `SDK_VERSION` | constant | `"1.0.0"`. |
| `RUNTIME_SURFACE` | constant | `"0.1"`, the version of the VM's built-in interface that this SDK needs. |

## State and view

| Export | Kind | Summary |
| --- | --- | --- |
| `state` | constant | The widget state object. Change it; after each turn the VM evaluates the view again and sends only the differences. |
| `WidgetState` | interface | Type of `state`; declare its members by module augmentation. Undeclared members are `unknown`. |
| `initState(initial)` | function | Copies `initial` into `state` and returns `state` typed as `initial`. Call it once, while the module loads. |
| `registerView(table)` | function | Registers the compiled expressions and handlers of the view. The command-line tool generates this call: a widget never writes it. |
| `ViewTable` | type | The table that `registerView` takes. |
| `Expression` | type | `(state, scope) => value`: a compiled expression of the view. |
| `Handler` | type | `(state, scope, event) => void`: a compiled handler of the view. |
| `NodeEvent<E>` | interface | `{ type, detail }` of an event; `detail` is `EventDetailMap[E]`. |
| `Scope` | interface | The names in scope of an expression: `for` items, component properties. |

<!-- source: templates/chart/logic.ts -->
```ts
declare module "@overcrow/sdk" {
  interface WidgetState {
    values: number[];
  }
}

const state = initState({ values: [50] as number[] });
```

## Host data

| Export | Kind | Summary |
| --- | --- | --- |
| `host` | constant | Frozen object whose members always read the latest values sent by OverCrow. |
| `HostData` | interface | Type of `host`: `locale`, `messages`, `theme`, `region`, `scale` (in thousandths), `viewport`, `mode`, `visible`, `options`, `grants`. |
| `onHost(listener)` | function | Calls `listener` with the names of the `host` members that OverCrow just sent (`options` after a menu change, `visible` when shown or hidden, `region`…), before the view is evaluated again. Returns `{ cancel() }`. |
| `HostKey` | type | The name of a member of `HostData`. |
| `HostListener` | type | A listener of `onHost`. |
| `Viewport` | interface | `{ width, height }`, in logical pixels. |
| `hasGrant(capability)` | function | Whether the user granted a capability. |
| `option(id, fallback)` | function | The stored value of a row of the options menu, or `fallback` when there is none or it has another type. |
| `MenuValue` | type | `boolean \| number \| string`. |
| `Widened<T>` | type | The result type of `option`: a `false` fallback gives `boolean`. |

<!-- source: widgets/clock/logic.ts -->
```ts
onHost((changed) => {
  if (changed.includes("options")) {
    const values = menuValues();
    const unitChanged = values.seconds !== state.seconds;
    Object.assign(state, values);
    if (unitChanged) {
      start();
    }
  }
  // A new UTC offset (time zone or summer time) shows at once.
  if (changed.includes("region")) {
    tick();
  }
});
```

## Services

Every service answers through OverCrow, which checks its permission or
capability, its parameters and the user action at each call.

| Export | Kind | Summary |
| --- | --- | --- |
| `storage` | namespace | `get({ key })`, `set({ key, value })`, `remove({ key })`, `keys()`. Permission `storage`. |
| `http` | namespace | `fetch(url, { as, method?, body?, contentType? })`. Permission `network`. |
| `clipboard` | namespace | `writeText({ text })`, during a user action. Permission `clipboardWrite`. |
| `gameEvents` | namespace | `subscribe(listener)`. Permission `gameEvents`. |
| `session` | namespace | `subscribe(listener)`. Capability `session.read`. |
| `telemetry` | namespace | `subscribe(listener)`. Capability `telemetry.read`. |
| `fps` | namespace | `subscribe(listener)`. Capability `fps.read`. |
| `media` | namespace | `subscribe({ cover? }, listener)`; `previous`, `playPause`, `next({ player? })` during a user action. |
| `stopwatch` | namespace | `subscribe(listener)`; `toggle()`, `reset()` during a user action. |
| `notes` | namespace | `subscribe(listener)`; `create()`, `select({ note })`, `setItem({ note, item, checked })`, `delete({ note })` during a user action. |
| `playervox` | namespace | `score.subscribe`, `rating.subscribe`, `reviews.subscribe`, `reviews.page({ page?, followedOnly? })`. |
| `journal` | namespace | `subscribe(listener)`; `page({ cursor? })`; `delete({ session })` during a user action, after the user's confirmation. |
| `twitch` | namespace | `chat.subscribe(listener)`; `chat.join({ channel })`, `chat.leave()`, `chat.favorite({ channel, favorite })` during a user action. |
| `call(service, params?)` | function | Calls any service that answers once, by its name. |
| `subscribe(service, params, listener)` | function | Subscribes to any subscription service, by its name. |
| `ServiceError` | class | The rejection of a failed call: `code` is a `ServiceErrorCode`. |
| `Listener<T>` | type | `(update: SubscriptionUpdate<T>) => void`. |
| `SubscriptionUpdate<T>` | type | `{ ok: true, value, final }` or `{ ok: false, error, final: true }`. |
| `Subscription` | interface | `cancel()`; calling it again does nothing. |
| `ServiceParams<N>` | type | The parameters of service `N`. |
| `ServiceResult<N>` | type | The result, or the update, of service `N`. |
| `FetchOptions<A>` | interface | The options of `http.fetch`. |
| `FetchResponse<A>` | type | `{ status, contentType, body }`, or `{ status, asset }` for `as: "image"`. |
| `BodyType` | type | `"json" \| "text" \| "bytes" \| "image"`. |
| `BodyTypes` | interface | The decoded body of each body type. |
| `HttpMethod` | type | The methods of network rules. |
| `HttpServices` | interface | Type of `http`. |

The listener always comes last, and a service without parameters takes
none:

<!-- source: widgets/fps/logic.ts -->
```ts
  fps.subscribe((update) => {
    Object.assign(state, reading(update));
  });
```

<!-- source: widgets/media/logic.ts -->
```ts
  const current = media.subscribe({ cover: state.showCover }, (update) => {
    if (update.ok) {
      state.media = update.value;
      state.unavailable = false;
      return;
    }
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.media = null;
      state.unavailable = true;
      retry = timers.after(RETRY_MS, subscribe);
    }
  });
```

`http.fetch` sends a string body as `text/plain` and any other body as
JSON, unless `contentType` says otherwise, and decodes the answer as `as`
asks. A response without a body gives `null`, `""` or an empty
`ArrayBuffer`.

The types of the other namespaces are generated from the schema:
`ClipboardServices`, `FpsServices`, `GameEventsServices`,
`JournalServices`, `MediaServices`, `NotesServices`, `PlayervoxServices`,
`SessionServices`, `StopwatchServices`, `StorageServices`,
`TelemetryServices` and `TwitchServices`. Each service is described in the
[service reference](service-reference.md).

## Timers

| Export | Kind | Summary |
| --- | --- | --- |
| `timers` | namespace | `after(ms, callback)`, `every(ms, callback)`, `atEach(unit, callback)`. |
| `Timer` | interface | `cancel()`; calling it again does nothing. |

- At most `MAX_TIMERS` timers, never shorter than `MIN_TIMER_INTERVAL_MS`:
  a shorter interval is raised to it.
- No timer ticks while the widget is hidden. A repeating timer skips the
  hidden ticks; a one-shot timer that fell due while hidden ticks once when
  the widget is shown again.
- `atEach("second" | "minute" | "hour" | "day", callback)` calls `callback`
  at each boundary of the user's local time, and once when the widget is
  shown again. It also wakes when the user's UTC offset changes.

<!-- source: widgets/media/logic.ts -->
```ts
      retry = timers.after(RETRY_MS, subscribe);
```

## Drawing, menu, messages and log

| Export | Kind | Summary |
| --- | --- | --- |
| `draw(ref, commands)` | function | Replaces the commands of the `canvas` whose `ref` is given. |
| `onMenu(handler)` | function | Receives the ID of each `action` row of the options menu that the user chooses. |
| `t(key, params?)` | function | The message of the active language, with each `{name}` replaced by `params.name`; the key itself when there is no message. |
| `MessageParams` | type | `Record<string, string \| number>`. |
| `log` | namespace | `debug`, `info`, `warn`, `error(text)`: shown by `overcrow-widget dev`, dropped for an installed widget. |

The draw commands are typed tuples, listed in
[drawing](logic.md#drawing).

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
    dots.push(["circle", 6 + index * 14, 6, 4], ["fill", "var(--color-accent)"]);
```

## Time, dates and numbers

The VM has no `Intl`, and its local time is UTC: `Date` never gives the
user's time. These helpers format from `host.region`. Numbers follow the
user's number format (`1,234.5`, `1 234,5` or `1.234,5`), whatever the
interface language; dates are numeric, in the user's date order; times are
24-hour. Each helper also accepts its region values as options, so it runs
in a unit test outside the VM.

| Export | Kind | Summary |
| --- | --- | --- |
| `localTime(ms, offsetMinutes?)` | function | The `LocalTime` fields of an instant in the user's UTC offset, or in the `offsetMinutes` of a service timestamp. |
| `formatTime(ms, options?)` | function | `14:08`, or `14:08:42` with `seconds: true`. |
| `formatDate(ms, options?)` | function | `17/07/2026` (`dmy`), `07/17/2026` (`mdy`), `2026-07-17` (`ymd`). |
| `formatNumber(value, options?)` | function | The separators of the user's number format; `minimumFractionDigits`, `maximumFractionDigits` (3 by default), `grouping`. |
| `formatDuration(ms, options?)` | function | `04:05`, `1:02:03`, `04:05.67` with `hundredths: true`; truncated, as a stopwatch shows it. |
| `delayToNext(unit, nowMs, region?)` | function | The milliseconds to the next boundary of local time, never past the next change of UTC offset. |
| `LocalTime` | interface | `year`, `month` (1 to 12), `day`, `weekday` (0 is Sunday), `hour`, `minute`, `second`, `millisecond`. |
| `TimeUnit` | type | `"second" \| "minute" \| "hour" \| "day"`. |
| `TimeOptions` | interface | `offsetMinutes`. |
| `DateOptions` | interface | `offsetMinutes`, `order`. |
| `ClockOptions` | interface | `offsetMinutes`, `seconds`. |
| `NumberOptions` | interface | The options of `formatNumber`. |
| `DurationOptions` | interface | `hours`, `hundredths`, `format`. |

<!-- source: widgets/clock/logic.ts -->
```ts
export function clockDate(now: number, order: DateOrder): string {
  return formatDate(now, { order });
}
```

Month and weekday names, 12-hour clocks and plural rules are not part of
1.0.

## Generated types

These types are generated from the widget schema, so they always match
what OverCrow accepts.

| Export | Summary |
| --- | --- |
| `ServiceName`, `CallServiceName`, `SubscribeServiceName`, `GestureServiceName` | The service names: all of them, those that answer once, the subscriptions, and those that need a user action. |
| `ServiceParamsMap`, `ServiceResultMap` | The parameters and the result of each service. |
| `ServiceErrorCode`, `ServiceErrorPayload` | The [error codes](services.md#errors), and the `{ code }` value that carries one. |
| `Session`, `Telemetry`, `Fps`, `Stopwatch`, `Media`, `Notes`, `Note`, `NoteItem`, `CreatedNote`, `Score`, `Rating`, `RatingState`, `Review`, `ReviewsState`, `ReviewsPage`, `JournalState`, `JournalPage`, `JournalSession`, `TwitchChat`, `ChatMessage`, `ChatFragment`, `GameEvent`, `HttpResponse` | The [result shapes](result-shapes.md). |
| `Permission`, `Capability`, `SensitiveCapability`, `CapabilityServices`, `PermissionServices` | The permissions and capabilities of the manifest, and the services each one allows. |
| `Locale`, `Theme`, `Mode`, `Region`, `NumberFormat`, `DateOrder` | The values of `host`. |
| `EventName`, `GestureEventName`, `EventDetailMap`, `NamedKey` | The events of the view, those that are user actions, their details, and the named keys of `keydown`. |
| `DrawCommand`, `DrawCommandName`, `Color` | The canvas commands and colours. |
| `TokenName`, `ColorToken`, `LengthToken`, `FontSizeToken`, `FontFamilyToken`, `TimeToken`, `ShadowToken` | The [design tokens](style-properties.md#design-tokens). |
| `IconName` | The names of the [icons](style-properties.md#icons). |
| `MenuRowType`, `HostFeature` | The row types of the options menu, and the data sources of `requires`. |
| `JsonValue`, `AssetHandle`, `ImageSource` | Any JSON value; an image handle given by a service; an image of the package or such a handle. |

## Limit constants

The [limits](limits.md) a widget's logic works against are exported as
constants, so the code never repeats a number: `MAX_TIMERS`,
`MIN_TIMER_INTERVAL_MS`, `MAX_SERVICE_CALLS_IN_FLIGHT`,
`MAX_SUBSCRIPTIONS`, `MAX_STORAGE_KEYS`, `MAX_STORAGE_KEY_BYTES`,
`MAX_STORAGE_VALUE_BYTES`, `STORAGE_QUOTA_BYTES`, `MAX_REQUEST_URL_BYTES`,
`MAX_HTTP_REQUEST_BYTES`, `MAX_HTTP_RESPONSE_BYTES`,
`MAX_HTTP_DECLARED_RESPONSE_BYTES`, `MAX_CLIPBOARD_BYTES`,
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

## Unit tests: `@overcrow/sdk/testing`

A second entry point, never bundled into a widget, replaces OverCrow in a
unit test of the logic: `installRuntime()` gives virtual time, settles the
service calls and pushes the subscription values. See
[unit tests](testing.md#unit-tests).
