# Service reference

Every service that the logic of a PlayerVox OverCrow widget can call, with
what it requires, when it can be called, its parameters and its result.
[Services and permissions](services.md) explains how calls, subscriptions,
errors and user actions work; this page is the list.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
      if (canRead) {
        state.stopwatch = next;
      }
    },
    () => {},
  );
}
```

In the SDK, a service `stopwatch.subscribe` is the function
`stopwatch.subscribe` of the `stopwatch` namespace. A call returns a
promise of its result; a subscription takes a listener that receives each
update.

## How to read a service

- **Kind**: a *call* is answered once; a *subscription* delivers a value at
  once, then each new value.
- **Requires**: the permission or the capability to declare in
  [the manifest](manifest.md#permissions), which the user must grant.
- **When it can be called**: at any time, or only during a
  [user action](services.md#calls-that-need-a-user-action).
- **Parameters**: the members of the object to pass; a `?` marks an
  optional one. A type such as "text ≤ 128 bytes" gives a
  [limit](limits.md).
- **Result**, or **Each update** for a subscription: what the service
  answers, and the error codes that are specific to it. Every service can
  also fail with the general [error codes](services.md#errors).
- **Shape**: the type of the result, described in
  [result shapes](result-shapes.md).

## Services

<!-- generated:services -->
### `storage.get`

- **Kind**: call, answered once
- **Requires**: permission `storage`
- **When it can be called**: At any time
- **Parameters**: `key`: text ≤ 128 bytes
- **Result**: stored JSON value or `null`
- **Shape**: JSON

### `storage.set`

- **Kind**: call, answered once
- **Requires**: permission `storage`
- **When it can be called**: At any time
- **Parameters**: `key`: text ≤ 128 bytes; `value`: JSON
- **Result**: `null`; `quota_exceeded` beyond 256 KiB
- **Shape**: `null`

### `storage.remove`

- **Kind**: call, answered once
- **Requires**: permission `storage`
- **When it can be called**: At any time
- **Parameters**: `key`: text ≤ 128 bytes
- **Result**: `null`

### `storage.keys`

- **Kind**: call, answered once
- **Requires**: permission `storage`
- **When it can be called**: At any time
- **Parameters**: none
- **Result**: list of keys
- **Shape**: list of text

### `http.fetch`

- **Kind**: call, answered once
- **Requires**: permission `network`
- **When it can be called**: At any time
- **Parameters**: `url`: text ≤ 2 KiB; `method`: `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE`; `contentType?`: `application/json` \| `text/plain`; `as`: `json` \| `text` \| `bytes` \| `image`
- **Result**: `{ status, contentType, headers }` with the body, ≤ the rule's `maxResponseBytes` (1 MiB when absent), or `{ status, asset, headers }` from a body ≤ 1 MiB; `headers` holds only the response headers a widget may read; on a rule that names an account, `not_connected` while it is not connected and `account_refused` when the service refused its secret
- **Shape**: [`HttpResponse`](result-shapes.md#httpresponse)

### `clipboard.writeText`

- **Kind**: call, answered once
- **Requires**: permission `clipboardWrite`
- **When it can be called**: Only during a user action
- **Parameters**: `text`: text ≤ 16 KiB
- **Result**: `null`

### `links.open`

- **Kind**: call, answered once; the user confirms it first, in a dialog drawn by PlayerVox OverCrow
- **Requires**: permission `links`
- **When it can be called**: Only during a user action
- **Parameters**: `url`: text ≤ 2 KiB
- **Result**: `null` once the host handed the address to the browser. The host shows the address and, the first time for its origin, asks the user, who may later take that back in the Control Center; `cancelled` when the user declines; `permission_denied` for an address no rule allows; `url_invalid` for one that is not a plain HTTPS address (credentials, a path with encoded or dot segments, beyond 2 KiB); `busy` while a confirmation is open; `unavailable` when no browser could open it
- **Shape**: `null`

### `gameEvents.warframe.subscribe`

- **Kind**: subscription
- **Requires**: permission `gameEvents`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ playing, session, features, info, events }` at once, then at each change of what the widget follows; `permission_denied` when `gameEvents` lists no `warframe.*` feature. `playing` says whether Warframe is the active game; `session` is the launch of Warframe, which changes at each launch; `features` gives each feature's status; `info` the state of each feature the widget follows, ready to show (`null` for the others and while nothing is known); `events` repeats the latest 16 events of those features, oldest first, each `{ seq, at, type }` and the state its type names: updates are coalesced, so take only those whose `seq` is above the last one seen. At most one subscription per widget at a time: another fails with `busy`
- **Shape**: [`WarframeEvents`](result-shapes.md#warframeevents)

### `session.subscribe`

- **Kind**: subscription
- **Requires**: capability `session.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ elapsedMs, at }` counted from the start of the game process, or `null` without an active game
- **Shape**: [`Session`](result-shapes.md#session) or `null`

### `game.subscribe`

- **Kind**: subscription
- **Requires**: capability `game.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ steamAppId, name }` of the active game, or `null` without one: `steamAppId` is the game's Steam app ID, `null` for a game outside the Steam store (a game added by hand, a non-Steam shortcut), and `name` the game's name in the user's game list, `null` when the host has none
- **Shape**: [`Game`](result-shapes.md#game) or `null`

### `telemetry.subscribe`

- **Kind**: subscription
- **Requires**: capability `telemetry.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ cpu, ram, cpuTemperature, gpuTemperature, sources }`, or `null` without an active game: `cpu` is the game's share of the whole machine in % (0–100), `ram` its resident bytes, temperatures are °C or `null`, `sources` `{ cpuTemperature, gpuTemperature }` says whether the host has each sensor
- **Shape**: [`Telemetry`](result-shapes.md#telemetry) or `null`

### `fps.subscribe`

- **Kind**: subscription
- **Requires**: capability `fps.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ fps, stale, status }`: `fps` a number or `null`; the host sets `stale` 3 s after the last sample; `status` is `ready`, `waiting`, `unsupported`, `permission_denied`, `ambiguous`, `events_lost` or `unavailable`
- **Shape**: [`Fps`](result-shapes.md#fps)

### `media.subscribe`

- **Kind**: subscription
- **Requires**: capability `media.read`
- **When it can be called**: At any time
- **Parameters**: `cover?`: boolean
- **Each update**: `null` without a player, or `{ player, title, artists, playing, canPrevious, canPlayPause, canNext, cover }`: `player` an opaque ID, `artists` a list, `cover` an `asset:` handle of at most 512 px or `null`
- **Shape**: [`Media`](result-shapes.md#media) or `null`

### `media.previous`

- **Kind**: call, answered once
- **Requires**: capability `media.control`
- **When it can be called**: Only during a user action
- **Parameters**: `player?`: text ≤ 128 bytes
- **Result**: `null`; `stale_context` when `player` is no longer current
- **Shape**: `null`

### `media.playPause`

- **Kind**: call, answered once
- **Requires**: capability `media.control`
- **When it can be called**: Only during a user action
- **Parameters**: `player?`: text ≤ 128 bytes
- **Result**: `null`; `stale_context` when `player` is no longer current
- **Shape**: `null`

### `media.next`

- **Kind**: call, answered once
- **Requires**: capability `media.control`
- **When it can be called**: Only during a user action
- **Parameters**: `player?`: text ≤ 128 bytes
- **Result**: `null`; `stale_context` when `player` is no longer current
- **Shape**: `null`

### `stopwatch.subscribe`

- **Kind**: subscription
- **Requires**: capability `stopwatch.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ running, elapsedMs, at, shortcuts }`, or `null` without an active game; `shortcuts` `{ toggle, reset, bound }` holds host-formatted key chords
- **Shape**: [`Stopwatch`](result-shapes.md#stopwatch) or `null`

### `stopwatch.toggle`

- **Kind**: call, answered once
- **Requires**: capability `stopwatch.control`
- **When it can be called**: Only during a user action
- **Parameters**: none
- **Result**: the new state, as in `stopwatch.subscribe`; `unavailable` when the host cannot act
- **Shape**: [`Stopwatch`](result-shapes.md#stopwatch) or `null`

### `stopwatch.reset`

- **Kind**: call, answered once
- **Requires**: capability `stopwatch.control`
- **When it can be called**: Only during a user action
- **Parameters**: none
- **Result**: the new state, as in `stopwatch.subscribe`; `unavailable` when the host cannot act
- **Shape**: [`Stopwatch`](result-shapes.md#stopwatch) or `null`

### `notes.subscribe`

- **Kind**: subscription
- **Requires**: capability `notes.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ active, notes }` of the user's single notes document; each note `{ id, title, body, items }`, each item `{ id, text, checked }`
- **Shape**: [`Notes`](result-shapes.md#notes)

### `notes.create`

- **Kind**: call, answered once
- **Requires**: capability `notes.write`
- **When it can be called**: Only during a user action
- **Parameters**: none
- **Result**: `{ note }`, a new empty active note titled `Note {n}` in the user's language; `quota_exceeded` beyond 8
- **Shape**: [`CreatedNote`](result-shapes.md#creatednote)

### `notes.select`

- **Kind**: call, answered once
- **Requires**: capability `notes.write`
- **When it can be called**: Only during a user action
- **Parameters**: `note`: text ≤ 128 bytes
- **Result**: `null`; the host stores the active note
- **Shape**: `null`

### `notes.setItem`

- **Kind**: call, answered once
- **Requires**: capability `notes.write`
- **When it can be called**: Only during a user action
- **Parameters**: `note`: text ≤ 128 bytes; `item`: text ≤ 128 bytes; `checked`: boolean
- **Result**: `null`

### `notes.delete`

- **Kind**: call, answered once; the user confirms it first, in a dialog drawn by PlayerVox OverCrow
- **Requires**: capability `notes.write`
- **When it can be called**: Only during a user action
- **Parameters**: `note`: text ≤ 128 bytes
- **Result**: `null`, or `cancelled` when the user declines
- **Shape**: `null`

### `playervox.score.subscribe`

- **Kind**: subscription
- **Requires**: capability `playervox.score.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ state, name, score, grade, ratingsCount, criteria }`: `state` is `idle`, `unsupported`, `loading`, `ready`, `no_ratings`, `not_found` or `unavailable`; `criteria` `{ gameplay, art, tech }`, each from 0 to 100 or `null`
- **Shape**: [`Score`](result-shapes.md#score)

### `playervox.rating.subscribe`

- **Kind**: subscription
- **Requires**: capability `playervox.rating.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ state, name, offline, rating }`: `state` is `idle`, `unsupported`, `loading`, `ready` or `unavailable`; `rating` is `null` before the user's first rating, or `{ gameplay, art, tech, review, publishedAt, offsetMinutes }`. Nothing is sent while the PlayerVox account is signed out, pending or expired. A published rating is sent again by the subscription. The host fills the `playervox.rating.publish` controls from it
- **Shape**: [`RatingState`](result-shapes.md#ratingstate)

### `playervox.reviews.subscribe`

- **Kind**: subscription
- **Requires**: capability `playervox.reviews.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ state, revision, offline }`: `state` is `idle`, `unsupported` or `ready`; `revision` changes whenever the reviews to read change (another game, another PlayerVox account, reviews changed on PlayerVox), so the widget reads its page again; `offline` while PlayerVox is unreachable. Nothing is sent while the PlayerVox account is signed out, pending or expired. Holding this subscription is what keeps the host's reviews source running
- **Shape**: [`ReviewsState`](result-shapes.md#reviewsstate)

### `playervox.reviews.page`

- **Kind**: call, answered once
- **Requires**: capability `playervox.reviews.read`
- **When it can be called**: At any time
- **Parameters**: `page?`: integer 1 to 100000; `followedOnly?`: boolean
- **Result**: `{ gameName, items, page, totalPages, count }`: three reviews of the active game per page, in the language of the host's interface; a page past the end answers the last page; each item `{ id, author, grade, score, text, original, hidden, publishedAt, offsetMinutes }`, `text` translated when a translation exists, `original` the untranslated text of a translated review or `null`, both cut by the host to 16 KiB. Each call reads its own page: the host keeps no page position or filter shared between widgets
- **Shape**: [`ReviewsPage`](result-shapes.md#reviewspage)

### `journal.subscribe`

- **Kind**: subscription
- **Requires**: capability `journal.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `null` without an active game, or `{ revision, notice }`: `revision` changes whenever the merged journal of the active game changes (a session recorded or deleted, cloud sessions merged, the PlayerVox account or sync changed), so the widget reads its page again; `notice` is `null`, `offline`, `storage_unavailable`, `full`, `expired`, `busy` or `unavailable`. Holding this subscription is what keeps the host's journal source running
- **Shape**: [`JournalState`](result-shapes.md#journalstate) or `null`

### `journal.page`

- **Kind**: call, answered once
- **Requires**: capability `journal.read`
- **When it can be called**: At any time
- **Parameters**: `cursor?`: text ≤ 128 bytes
- **Result**: `{ gameName, items, page, next, previous }`: five local and cloud sessions of the active game, merged and deduplicated, newest first; without `cursor`, the first page; each item `{ id, startedAt, offsetMinutes, durationMs, source }`; cursors are host handles that stay valid for the widget whatever other widgets read, and a cursor past the end answers the last page
- **Shape**: [`JournalPage`](result-shapes.md#journalpage)

### `journal.delete`

- **Kind**: call, answered once; the user confirms it first, in a dialog drawn by PlayerVox OverCrow
- **Requires**: capability `journal.delete`
- **When it can be called**: Only during a user action
- **Parameters**: `session`: text ≤ 128 bytes
- **Result**: `null`, or `cancelled` when the user declines; `not_connected` for a cloud session while PlayerVox is disconnected
- **Shape**: `null`

### `twitch.chat.subscribe`

- **Kind**: subscription
- **Requires**: capability `twitch.chat.read`
- **When it can be called**: At any time
- **Parameters**: none
- **Each update**: `{ account, channel, joinState, failure, favorites, canSend, generation, reset, messages, removed, skipped }`: `account` is `signed_out`, `pending`, `connected` or `expired` (sign-in is drawn by the host); `failure` is the fixed category of a `failed` join; messages arrive as deltas, at most one update per 100 ms, with `reset` after subscribing, a generation change or a show, and nothing while the widget is hidden; a faster chat is sampled, `skipped` counting the new messages left out; each message `{ id, author, color, badges, fragments, reply, deleted, receivedAt }` with at most 16 fragments, emotes and badges as `asset:` handles for the current theme and scale
- **Shape**: [`TwitchChat`](result-shapes.md#twitchchat)

### `twitch.chat.join`

- **Kind**: call, answered once
- **Requires**: capability `twitch.chat.read`
- **When it can be called**: Only during a user action
- **Parameters**: `channel`: text ≤ 25 bytes
- **Result**: `null`; the host remembers the channel and rejoins it when the widget starts
- **Shape**: `null`

### `twitch.chat.leave`

- **Kind**: call, answered once
- **Requires**: capability `twitch.chat.read`
- **When it can be called**: Only during a user action
- **Parameters**: none
- **Result**: `null`; the host forgets the channel
- **Shape**: `null`

### `twitch.chat.favorite`

- **Kind**: call, answered once
- **Requires**: capability `twitch.chat.read`
- **When it can be called**: Only during a user action
- **Parameters**: `channel`: text ≤ 25 bytes; `favorite`: boolean
- **Result**: `null`; `quota_exceeded` beyond 20
- **Shape**: `null`

### `account.subscribe`

- **Kind**: subscription
- **Requires**: a declared, granted account (`id`)
- **When it can be called**: At any time
- **Parameters**: `id`: identifier ≤ 32 bytes
- **Each update**: `{ state }` at once, then at each change: `signed_out`, `pending` (a sign-in step is open), `connected`, `refused` (the service refused the key) or `expired` (the service asks to sign in again). The widget never sees the secret, the account's name or its scopes; with `required`, the host covers the content until the account is connected
- **Shape**: [`AccountStatus`](result-shapes.md#accountstatus)

### `twitch.events.subscribe`

- **Kind**: subscription
- **Requires**: the named, granted service `twitch`
- **When it can be called**: At any time
- **Parameters**: `types?`: list of `event type` ≤ 32
- **Each update**: `{ state, reason, events }` at once, then at each change. `state` is `live` once the host has subscribed at Twitch, `off` otherwise, with `reason` `connecting`, `not_connected` (Twitch is not connected, or its connection lacks a declared scope) or `unavailable` (Twitch refused or cannot be reached; the host retries). Twitch replays nothing: at each `live`, read once by `http.fetch` what changed meanwhile, and keep reading while `off`. `events` repeats the latest 16 events of the subscription, oldest first, each `{ seq, type, at, data }`: updates are coalesced, so take only those whose `seq` is above the last one seen; a gap in `seq` means events were missed (read again). `data` is the host's projection of Twitch's event: every field of the type's table, `null` where Twitch sent none
- **Shape**: [`TwitchEvents`](result-shapes.md#twitchevents)

### `steam.events.subscribe`

- **Kind**: subscription
- **Requires**: the named, granted service `steam`
- **When it can be called**: At any time
- **Parameters**: `steamid`: text ≤ 17 bytes; `types?`: list of `event type` ≤ 32
- **Each update**: `{ state, reason, events }` at once, then at each change. `state` is `live` while the host watches the Steam client's stats on this computer, `off` otherwise, with `reason` `connecting`, `not_connected` (Steam is not connected) or `unavailable` (no Steam client found on this computer). Steam pushes nothing and the host replays nothing: the events only say when to read again by `http.fetch`, and the widget keeps reading at its own pace too (Steam may run on another computer). `events` repeats the latest 16 events of the subscription, oldest first, each `{ seq, type, at, data }`: updates are coalesced, so take only those whose `seq` is above the last one seen; a gap in `seq` means events were missed (read again). `stats.saved`: the Steam client saved the stats of a game of that account, at each achievement unlocked and at other times; `data` is `{ appid }`, `at` the time of the save. At most one subscription per widget at a time: another fails with `busy`
- **Shape**: [`SteamEvents`](result-shapes.md#steamevents)

### `steam.achievements.local`

- **Kind**: call, answered once
- **Requires**: the named, granted service `steam`
- **When it can be called**: At any time
- **Parameters**: `steamid`: text ≤ 17 bytes; `appid`: integer 1 to 4294967295; `offset?`: integer 0 to 1000000
- **Result**: `{ appid, total, achievements }`: the achievements of that game the Steam client of this computer saved as unlocked for that account, read-only from its own stats files, even before Steam publishes them online and whatever the game details' privacy. `total` counts them all; `achievements` gives at most 4096 from `offset`, newest first, each `{ name, unlockedAt }`: the API name, as `GetSchemaForGame` and `GetPlayerAchievements` give it, and the unlock time in Unix milliseconds, `null` when Steam saved none. Nothing else of the files. An empty list: no achievement unlocked yet. Needs the declaration's `local: ["achievements"]` (`permission_denied` without), not a connected key. `unavailable` when the computer has no Steam client, no stats of that account and game, or files the host cannot read or does not know: keep reading Steam's Web API. One call per widget at a time: another fails with `busy`
- **Shape**: [`SteamLocalAchievements`](result-shapes.md#steamlocalachievements)

### `account.connect`

- **Kind**: call, answered once
- **Requires**: a declared, granted account (`id`)
- **When it can be called**: Only during a user action
- **Parameters**: `id`: identifier ≤ 32 bytes
- **Result**: `null`; the host shows its account panel for this account, in its current state: the widget's own button for an account that is not `required`
- **Shape**: `null`
<!-- /generated:services -->

## Writes that go through a form

Saving a note, publishing a rating and sending a chat message are not in
this list: they are write intents, sent by a `form` from the values that
the user typed. See
[forms that write user data](forms.md#forms-that-write-user-data).
