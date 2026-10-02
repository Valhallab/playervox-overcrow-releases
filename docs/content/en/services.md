# Services and permissions

A PlayerVox OverCrow widget has no access of its own: no network, no file,
no clipboard, no data about the game. Everything outside its own state
comes from a **service** of OverCrow, which the logic calls through
`@overcrow/sdk`. A service answers only when the widget declared the
matching permission in its manifest and the user granted it.

<!-- source: widgets/session/logic.ts -->
```ts
// Without the grant the host would refuse the subscription: show the
// unknown duration instead of asking.
if (hasGrant("session.read")) {
  session.subscribe((update) => {
    state.session = anchor(update);
  });
}
```

That is the whole use of a service in the Session widget: it declares the
`session.read` capability, checks that the user granted it, and subscribes.

## Declare, then ask the user

Two kinds of authority exist, both declared in `permissions` of
[the manifest](manifest.md#permissions):

- four **permissions** for general services: `network`, `storage`,
  `clipboardWrite` and `gameEvents`;
- **capabilities**, listed under `permissions.capabilities`, for the data
  and actions of OverCrow itself and of the user's accounts: the frame
  rate, the media player, notes, PlayerVox ratings, Twitch chat…

<!-- source: docs/content/examples/weather/manifest.json -->
```json
  "permissions": {
    "network": [
      {
        "origin": "https://api.example.com",
        "method": "GET",
        "path": "/v1/forecast/{city}",
        "pathParams": { "city": { "type": "slug", "maxLength": 32 } },
        "queryParams": {
          "units": { "type": "enum", "values": ["metric", "imperial"], "required": true }
        }
      }
    ],
    "storage": true
  },
```

A declaration grants nothing by itself. OverCrow shows the user what the
widget asks for, and the user may refuse an item or revoke it later;
revoking stops the widget first. The widgets tagged `built-in` in the
signed catalog (PlayerVox widgets only) start with their declared
permissions granted. Declare the least you need: reviewers read every
permission, and users see them before they consent.

`hasGrant(capability)` tells whether a capability was granted. Check it
before you subscribe, and show a useful state when it is missing: a refused
widget must still look right.

<!-- source: widgets/fps/logic.ts -->
```ts
if (hasGrant("fps.read")) {
  fps.subscribe((update) => {
    Object.assign(state, reading(update));
  });
} else {
  state.status = "unavailable";
}
```

## Calls and subscriptions

A service is one of two kinds.

**A call** asks once and returns a promise:

<!-- source: widgets/warframe-market/logic.ts -->
```ts
async function readStored(key: string): Promise<JsonValue | undefined> {
  try {
    return await storage.get({ key });
  } catch {
    state.error = "storage_unavailable";
    return undefined;
  }
}
```

**A subscription** takes a listener. OverCrow calls it with the current
value at once, then with each new value, until you `cancel()` it or it
ends with a failure. The listener comes last; a service with parameters
takes them first.

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

Each update is `{ ok: true, value, final }` or
`{ ok: false, error, final: true }`. A failed update is always the last
one: the subscription is over.

Services are grouped in namespaces of the SDK: `storage`, `http`,
`clipboard`, `gameEvents`, and one per data source (`fps`, `telemetry`,
`session`, `media`, `stopwatch`, `notes`, `playervox`, `journal`,
`twitch`). Every service, with its parameters and its result, is in the
[service reference](service-reference.md).

OverCrow checks every call when it arrives, in this order: the permission
or capability, the parameters, the user action when the service needs one,
then the account when it needs one. The SDK's types help you call a
service right; they are not what enforces the rules.

## Errors

A failed call rejects with a `ServiceError`, whose `code` says why. A
subscription that fails delivers the same error in its last update.

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
  try {
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const value = (body as { temperature?: unknown } | null)?.temperature;
    if (status !== 200 || typeof value !== "number") {
      state.status = "unavailable";
      return;
    }
    state.temperature = value;
    state.status = "updated";
    await storage.set({ key, value });
  } catch (error) {
    // permission_denied until the user consents, transport_failed offline…
    state.status = error instanceof ServiceError ? "unavailable" : "failed";
  }
```

<!-- generated:error-codes -->
| Code | Meaning |
| --- | --- |
| `invalid_request` | The parameters are not what the service takes: a member is missing or unknown, has the wrong type or is out of bounds. |
| `permission_denied` | The permission or capability is not declared in the manifest, or the user has not granted it. For `http.fetch`, no network rule allows this URL and method. A write through a form can also get it from the account's provider, for a write it does not allow. |
| `gesture_required` | The service can be called only during a user action, and this call was not made while one was handled, or that action already allowed another call. |
| `not_connected` | The service needs the user's PlayerVox or Twitch account, which is not connected at the moment. |
| `stale_context` | What the call was about changed before the answer: another game, another account, another media player, an object deleted meanwhile. Read the current state again. |
| `unavailable` | OverCrow's source for this data failed, or cannot act right now. A subscription that ends with it can be started again later. |
| `busy` | Too much is in progress: a confirmation is already open, a queue or the budget of network responses is full, or the provider asks to wait. Try again later. |
| `cancelled` | The user declined the confirmation, or left Interactive mode while it was open. |
| `quota_exceeded` | A quota is full: the storage, the timers, the notes, the favourite channels. |
| `unsupported` | The target cannot do this: a media player that does not offer the command, for instance. |
| `url_invalid` | `http.fetch`: the URL is not an absolute HTTPS URL that OverCrow accepts. |
| `resolve_failed` | `http.fetch`: the host name could not be resolved. |
| `address_denied` | `http.fetch`: the host name resolves to a local, private or otherwise non-public address. |
| `too_many_addresses` | `http.fetch`: the host name resolves to more addresses than OverCrow accepts. |
| `peer_mismatch` | `http.fetch`: the server that answered is not at one of the addresses that were resolved and checked. |
| `redirect_denied` | `http.fetch`: the server answered with a redirection. OverCrow follows none: declare and request the final URL. |
| `encoding_denied` | `http.fetch`: the response is compressed or encoded in a way OverCrow does not accept, or its body does not decode as `as` asks (invalid JSON or text). |
| `content_type_denied` | `http.fetch`: the media type of the response is not one that OverCrow accepts for this request. |
| `response_metadata_limit` | `http.fetch`: the status line or the headers of the response are malformed or exceed OverCrow's bounds. |
| `request_body_limit` | `http.fetch`: the request body is larger than `MAX_HTTP_REQUEST_BYTES`. |
| `response_body_limit` | `http.fetch`: the response body is larger than the bound of the network rule (`maxResponseBytes`, or 1 MiB without it and for `as: "image"`). |
| `image_invalid` | `http.fetch` with `as: "image"`: the response is not a PNG, JPEG or WebP image within the image limits. |
| `timeout` | `http.fetch`: the exchange took longer than 30 seconds. |
| `transport_failed` | `http.fetch`: the connection failed: no network, a TLS error, a connection closed by the server. |
<!-- /generated:error-codes -->

Three habits cover most cases:

- **Show a state, not an error message.** The codes are for your logic;
  the user sees "Forecast unavailable", not `transport_failed`.
- **Retry a subscription that ended.** A source of OverCrow can fail while
  the widget runs (the media player's session, for instance): the
  subscription ends with `unavailable`. Subscribe again a few seconds later
  with `timers.after`; OverCrow restarts the source for the new
  subscription. The Media widget waits five seconds:

<!-- source: widgets/media/logic.ts -->
```ts
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.media = null;
      state.unavailable = true;
      retry = timers.after(RETRY_MS, subscribe);
    }
```

- **Do not retry in a loop.** `busy` and `quota_exceeded` mean that a bound
  is reached: wait, or do less.

## Calls that need a user action

Services that change something for the user, or put something where other
programs read it, can be called **only during a user action**: while the
logic handles one of these events of the view.

<!-- generated:gesture-events -->
`activate`, `contextmenu`, `keydown`, `input`, `change`, `submit`.
<!-- /generated:gesture-events -->

<!-- source: widgets/stopwatch/logic.ts -->
```ts
export function toggle(): void {
  command(() => stopwatch.toggle());
}
```

`toggle` is the `on:activate` handler of the stopwatch's button: the click
is the user action, and `stopwatch.toggle()` is called while it is handled.
The same call from a timer, from the answer of another service, from
`onHost` or from a row of the options menu is refused with
`gesture_required`.

- One user action allows one protected call. Call the service directly in
  the handler, not after an `await` on something else.
- Widgets receive input only in OverCrow's Interactive mode, so a protected
  call can only happen there.
- `notes.delete` and `journal.delete` also ask the user to confirm, in a
  dialog drawn by OverCrow; a declined confirmation is `cancelled`.

The tables below say, for each service, when it can be called.

## Permissions

<!-- generated:permission-list -->
| Permission | Meaning | With a sensitive capability |
| --- | --- | --- |
| `network` | Exact HTTPS routes reachable through the host broker, at most `MAX_NETWORK_RULES` rules. | manifest rejected |
| `storage` | Host-managed key-value storage partitioned by widget ID, within `STORAGE_QUOTA_BYTES`. | process-lifetime data only |
| `clipboardWrite` | Text clipboard writes, during a user action in Interactive mode. | manifest rejected |
| `gameEvents` | Named semantic game events `overcrow.game.<name>.v1`, at most `MAX_GAME_EVENTS`. | allowed |
| `capabilities` | Host services listed with the capabilities. | allowed |
<!-- /generated:permission-list -->

<!-- generated:permissions -->
| Permission | Service | When it can be called |
| --- | --- | --- |
| `network` | `http.fetch` | At any time |
| `storage` | `storage.get` | At any time |
| `storage` | `storage.set` | At any time |
| `storage` | `storage.remove` | At any time |
| `storage` | `storage.keys` | At any time |
| `clipboardWrite` | `clipboard.writeText` | Only during a user action |
| `gameEvents` | `gameEvents.subscribe` | At any time |

“Only during a user action” is explained in [Calls that need a user action](services.md#calls-that-need-a-user-action).
<!-- /generated:permissions -->

### Network rules

`network` is a list of rules. A rule allows requests to exactly one HTTPS
origin, one method and one path; a `{name}` segment of the path is a typed
parameter, and only the declared query parameters are accepted.

<!-- source: widgets/warframe-market/manifest.json -->
```json
  "permissions": {
    "network": [
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/versions",
        "maxResponseBytes": 4096
      },
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/items",
        "maxResponseBytes": 3145728
      },
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/orders/item/{slug}/top",
        "pathParams": {
          "slug": {
            "type": "slug",
            "maxLength": 96
          }
        },
        "maxResponseBytes": 131072
      }
    ],
    "storage": true,
    "clipboardWrite": true
  }
```

<!-- generated:network-rule-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `origin` | `origin` | yes | Canonical `https://host[:port]` origin, host ≤ `MAX_DNS_NAME_BYTES` with labels ≤ `MAX_DNS_LABEL_BYTES`; no credentials, IP literal or local name. |
| `method` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` | yes | One method. |
| `path` | text ≤ `MAX_NETWORK_PATH_BYTES` | yes | Complete path; `{name}` segments are typed path parameters. |
| `pathParams` | `name → ParameterConstraint` | no | Constraint of every `{name}` segment, at most `MAX_PATH_PARAMS`. |
| `queryParams` | `name → ParameterConstraint` | no | Allowed query parameters, at most `MAX_QUERY_PARAMS`, each optionally `required`; others are refused. |
| `maxResponseBytes` | integer 1 to 3145728 | no | Largest response body of this route, from 1 to `MAX_HTTP_DECLARED_RESPONSE_BYTES`; `MAX_HTTP_RESPONSE_BYTES` when absent. Not for `as: "image"`, which keeps `MAX_HTTP_RESPONSE_BYTES`. When several rules allow a request, the largest bound applies. |
<!-- /generated:network-rule-fields -->

Each path and query parameter has a constraint:

<!-- generated:parameter-constraints -->
| Type | Shape | Accepts |
| --- | --- | --- |
| `integer` | `{ min, max }` | Decimal without leading zero, from 0 to 2^53 - 1. |
| `slug` | `{ maxLength }` | ASCII letters of either case, digits, `_` and `-`, at least one character; `maxLength` from 1 to `MAX_SLUG_PARAMETER_BYTES`. |
| `enum` | list of `literal segment` ≤ `MAX_ENUM_VALUES` | One of the listed values, each ≤ `MAX_ENUM_VALUE_BYTES`. |
| `string` | `{ maxLength }` | Query parameters only; any text without control characters; `maxLength` from 1 to `MAX_STRING_PARAMETER_BYTES`. |
<!-- /generated:parameter-constraints -->

The request leaves through OverCrow's broker, never from the widget's
process. The broker:

- refuses any URL that no rule allows (`permission_denied`), before any
  DNS query;
- follows no redirection, and sends no cookie, credential or proxy
  header;
- refuses local and private addresses, so a widget cannot reach the user's
  router or another program of the machine;
- bounds each exchange: 256 KiB for a request body, 30 seconds in all, and
  1 MiB for a response body unless the rule declares a larger
  `maxResponseBytes`, up to 3 MiB. Reviewers and users see that bound.

`http.fetch(url, { as })` decodes the body as you ask: `"json"`, `"text"`,
`"bytes"` (an `ArrayBuffer`) or `"image"`, which gives an image handle to
bind to an `image` element instead of the bytes. A string `body` is sent as
`text/plain` and any other value as JSON, unless `contentType` says
otherwise. An HTTP error status is not a failure of the call: check
`status`.

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const value = (body as { temperature?: unknown } | null)?.temperature;
    if (status !== 200 || typeof value !== "number") {
      state.status = "unavailable";
      return;
    }
```

At most four requests of a widget are in flight at once, and they share a
budget of response bytes: a request that does not fit fails with `busy` at
once.

### Storage

`storage` is a key-value store that OverCrow keeps for your widget only:
`storage.get({ key })`, `storage.set({ key, value })`,
`storage.remove({ key })` and `storage.keys()`. A value is any JSON value.
There is no file access.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
function setRounds(rounds: number): void {
  state.rounds = rounds;
  paint();
  // Storage needs the user's consent: without it the count lasts as long
  // as the widget runs.
  storage.set({ key: "rounds", value: rounds }).catch(() => {});
}
```

The store holds at most 512 keys and 256 KiB in all, 64 KiB per value;
beyond, `storage.set` fails with `quota_exceeded` and changes nothing. A
write is answered once it is on disk. Uninstalling the widget erases its
store, and a development session (`overcrow-widget dev`) never reads or
writes the store of an installed widget.

### Clipboard

`clipboard.writeText({ text })` puts text on the clipboard, only during a
user action. A widget cannot read the clipboard.

<!-- source: widgets/warframe-market/logic.ts -->
```ts
  clipboard.writeText({ text: whisperLine(order, detail.name) }).then(
    () => {
      if (mine === selection) state.copy = { side, id, state: "copied" };
    },
    () => {
      if (mine === selection) state.copy = { side, id, state: "failed" };
    },
  );
```

Text that the user selects in a `text` element with the `selectable`
attribute is copied by OverCrow itself, and needs no permission.

### Game events

`gameEvents` lists the named game events the widget wants, each of the form
`overcrow.game.<name>.v1`. `gameEvents.subscribe(listener)` then delivers
`{ event, at }` for each one that happens.

## Capabilities

A capability gives access to data or actions that OverCrow holds: what the
game's use of the machine, the media player, the user's notes, their
PlayerVox and Twitch accounts.

<!-- generated:capability-list -->
| Capability | Sensitive | Account | Meaning |
| --- | --- | --- | --- |
| `telemetry.read` | no | — | CPU, RAM and temperature samples of the active game. |
| `fps.read` | no | — | Frame rate of the active game when the host has a source. |
| `media.read` | **yes** | — | Now-playing metadata and the image of its cover art. |
| `media.control` | **yes** | — | Previous, play/pause and next. |
| `session.read` | no | — | Duration of the active game session, without the game identity. |
| `stopwatch.read` | no | — | State of the host's single manual stopwatch and its shortcuts. |
| `stopwatch.control` | no | — | Start, pause and reset the host's single manual stopwatch. |
| `notes.read` | **yes** | — | The user's notes and checklists: one document shared by every game. |
| `notes.write` | **yes** | — | Create, select, save, check and delete notes; text only through a form bound to a write intent. |
| `playervox.score.read` | **yes** | — | Public PlayerVox score of the active game; sensitive because it reveals the game. |
| `playervox.rating.read` | **yes** | PlayerVox | The user's own rating of the active game. |
| `playervox.rating.write` | **yes** | PlayerVox | Publish a rating and review through a form bound to a write intent. |
| `playervox.reviews.read` | **yes** | PlayerVox | Paged player reviews of the active game, optionally from followed players only. |
| `journal.read` | **yes** | — | Play sessions of the active game: local ones, plus cloud ones while PlayerVox is connected. |
| `journal.delete` | **yes** | — | Delete a journal session after a confirmation asked by the host; cloud sessions need PlayerVox. |
| `twitch.chat.read` | **yes** | Twitch | Join, read and leave a Twitch channel chat, and keep favourite channels. |
| `twitch.chat.compose` | **yes** | Twitch | Send a chat message through a form bound to a write intent; the host allows 20 messages per 30 s and answers `busy` beyond. |
<!-- /generated:capability-list -->

<!-- generated:capabilities -->
| Capability | Sensitive | Service | When it can be called |
| --- | --- | --- | --- |
| `telemetry.read` | no | `telemetry.subscribe` | At any time |
| `fps.read` | no | `fps.subscribe` | At any time |
| `media.read` | **yes** | `media.subscribe` | At any time |
| `media.control` | **yes** | `media.previous` | Only during a user action |
| `media.control` | **yes** | `media.playPause` | Only during a user action |
| `media.control` | **yes** | `media.next` | Only during a user action |
| `session.read` | no | `session.subscribe` | At any time |
| `stopwatch.read` | no | `stopwatch.subscribe` | At any time |
| `stopwatch.control` | no | `stopwatch.toggle` | Only during a user action |
| `stopwatch.control` | no | `stopwatch.reset` | Only during a user action |
| `notes.read` | **yes** | `notes.subscribe` | At any time |
| `notes.write` | **yes** | `notes.create` | Only during a user action |
| `notes.write` | **yes** | `notes.select` | Only during a user action |
| `notes.write` | **yes** | `notes.setItem` | Only during a user action |
| `notes.write` | **yes** | `notes.delete` | Only during a user action |
| `notes.write` | **yes** | [form `notes.save`](forms.md#notessave) | When the user submits the form |
| `playervox.score.read` | **yes** | `playervox.score.subscribe` | At any time |
| `playervox.rating.read` | **yes** | `playervox.rating.subscribe` | At any time |
| `playervox.rating.write` | **yes** | [form `playervox.rating.publish`](forms.md#playervoxratingpublish) | When the user submits the form |
| `playervox.reviews.read` | **yes** | `playervox.reviews.subscribe` | At any time |
| `playervox.reviews.read` | **yes** | `playervox.reviews.page` | At any time |
| `journal.read` | **yes** | `journal.subscribe` | At any time |
| `journal.read` | **yes** | `journal.page` | At any time |
| `journal.delete` | **yes** | `journal.delete` | Only during a user action |
| `twitch.chat.read` | **yes** | `twitch.chat.subscribe` | At any time |
| `twitch.chat.read` | **yes** | `twitch.chat.join` | Only during a user action |
| `twitch.chat.read` | **yes** | `twitch.chat.leave` | Only during a user action |
| `twitch.chat.read` | **yes** | `twitch.chat.favorite` | Only during a user action |
| `twitch.chat.compose` | **yes** | [form `twitch.chat.send`](forms.md#twitchchatsend) | When the user submits the form |

“Only during a user action” is explained in [Calls that need a user action](services.md#calls-that-need-a-user-action).
<!-- /generated:capabilities -->

A row whose service is a form is a write that the user types: see
[forms that write user data](forms.md#forms-that-write-user-data).

### Sensitive capabilities

A **sensitive** capability reveals personal data or the game being played.
A widget that declares one:

- cannot also declare `network` or `clipboardWrite`: the manifest is
  refused;
- has a storage that lasts only as long as its process, and is emptied when
  the widget restarts.

So what such a widget reads cannot leave the machine through it. If your
widget needs both an HTTP API and a sensitive capability, make two widgets.

### Accounts

Some capabilities need the user's PlayerVox or Twitch account. The
connection belongs to OverCrow: it draws the sign-in, keeps the tokens and
shows its own panel over the widget while the account is signed out. A
widget never sees a token; it receives only the data its capability
describes, and its calls fail with `not_connected` while the account is
not connected.

### Data that changes

- A subscription may deliver `null` (no active game, no media player): show
  an empty state.
- Some subscriptions say *what to read* rather than the data itself.
  `playervox.reviews.subscribe` and `journal.subscribe` deliver a
  `revision`: when it changes, read your page again with
  `playervox.reviews.page` or `journal.page`.
- `twitch.chat.subscribe` delivers changes rather than the whole chat, at
  most every 100 ms: the new messages, the changed ones (same `id`), the
  IDs of the removed ones, and the whole list when `reset` is set.
- A timestamp that comes with its own `offsetMinutes` must be formatted
  with it; see [time, dates and numbers](logic.md#time-dates-and-numbers).

The shape of every result is in [result shapes](result-shapes.md).
