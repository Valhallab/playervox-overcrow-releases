# Changelog of `@overcrow/sdk`

The SDK follows [semantic versioning](https://semver.org/): within 1.x, no
export is removed or changed incompatibly, and a widget written against
1.x keeps building with a later 1.x. Each widget package bundles the SDK
version it was built with, so a new SDK never changes a published widget.
An incompatible change would be 2.0.0. Every 1.x release needs the VM's
runtime surface 0.1, which OverCrow keeps for widget API v1.

## 1.3.0

Not released yet. Ships with the release of PlayerVox OverCrow that opens
links for widgets:

- `links.open({ url })` (`links`): opens a page of a site the manifest
  declares in `permissions.links`, in the user's browser, during a user
  action. PlayerVox OverCrow shows the address and asks the user the first
  time for each site.
- `http.fetch` answers give `headers`: the response headers a widget may
  read (`retry-after`, the rate limit fields, `date`, `etag`,
  `last-modified`, `cache-control`, `expires`, `age`), by lowercase name.
  It is empty with an older PlayerVox OverCrow. The `HttpHeaders` type.
- The service error `review_removed_by_moderation`: PlayerVox's moderation
  removed the review a rating form publishes.
- `steam.events.subscribe` (`steam.events`): the local Steam events of the
  account the widget follows, of the types the manifest lists in `events`
  beside the Steam service. `stats.saved` tells that the Steam client of
  the player's computer saved that account's stats of a game, as at each
  achievement unlocked: `{ appid }` and the time. The `SteamEvent` and
  `SteamEvents` types.

## 1.2.0

Ships with PlayerVox OverCrow 0.8.1-beta.1, the first
release that delivers live Twitch events to widgets:

- `twitch.events.subscribe` (`twitch.events`): the live events of the
  player's own Twitch channel (goals, follows, Hype Trains, cheers,
  subscriptions, polls, predictions) of the types the manifest lists in
  `events` beside the Twitch service. Each update gives `state` (`live` or
  `off` with a `reason`) and the latest events, numbered by `seq`.
- The `TwitchEvent` and `TwitchEvents` types.

## 1.1.0

Ships with PlayerVox OverCrow 0.8.0-beta.1, the first release that runs
widgets with third-party accounts:

- `account.subscribe` and `account.connect` (`account`, `AccountServices`):
  the state of an account the manifest declares in `permissions.accounts`,
  or of an integrated service it names (`steam`, `twitch`), and the host's
  panel to connect it. The widget never sees the secret.
- The service error `account_refused`, and the `AccountStatus` and
  `AccountGrant` types; `hasGrant` takes `account:<id>`.
- `@overcrow/sdk/testing`: account states (`accounts` at install,
  `setAccount`, `accounts`).

## 1.0.0

First release on npm, for widget API v1 and OverCrow 0.6.0-beta.1 or later.
OverCrow itself is still in beta; the SDK's API is not.

- The state of a widget (`state`, `initState`, `WidgetState`) and the view
  table that the CLI generates (`registerView`).
- Host data: `host` (locale, messages, theme, region, scale, viewport…),
  `onHost`, `hasGrant`, and the options menu (`option`, `onMenu`).
- Typed services and their permissions: `storage`, `http`, `clipboard`,
  `gameEvents`, `session`, `telemetry`, `fps`, `media`, `stopwatch`,
  `notes`, `journal`, `playervox` (score, rating, reviews) and `twitch`
  chat, plus the generic `call` and `subscribe`, `ServiceError` and the
  generated parameter and result types of every service.
- Timers on the VM's clock: `timers.after`, `every` and `atEach`, the
  last aligned on second, minute, hour and day boundaries.
- Canvas drawing (`draw`), messages (`t`) and logs (`log`).
- Dates, times, numbers and durations without `Intl`: `formatTime`,
  `formatDate`, `formatNumber`, `formatDuration`, `localTime`,
  `delayToNext`, following the user's region settings.
- The generated types of the schema: tokens, icons, events, draw commands,
  capabilities and limit constants.
- `@overcrow/sdk/testing`: a stand-in of the runtime with virtual time, for
  unit tests of widget logic in Node.js. It is never bundled into a widget.
- License: MIT-0. A bundled copy needs no notice.

Documentation: [SDK reference](https://overcrow.playervox.com/docs/en/sdk/),
[the logic](https://overcrow.playervox.com/docs/en/logic/),
[testing a widget](https://overcrow.playervox.com/docs/en/testing/).
