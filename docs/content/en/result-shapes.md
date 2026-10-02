# Result shapes

What the services of PlayerVox OverCrow answer: the shape of each result
and of each subscription update. The SDK exports a TypeScript type of the
same name for each shape, so the logic never describes them by hand.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest state, or `null` while it is unknown. */
    stopwatch: Stopwatch | null;
    /** The buttons take input only in Interactive mode. */
    interactive: boolean;
  }
}
```

The Stopwatch widget keeps the latest `Stopwatch` value in its state, and
the view reads its members:

<!-- source: widgets/stopwatch/view.ocml -->
```xml
      <elapsed class="value" base={state.stopwatch.elapsedMs} at={state.stopwatch.at} running={state.stopwatch.running} format="hh:mm:ss.cc"/>
```

## How to read a shape

- A shape is an exact record: every member is present, and a member
  without a value is `null`, never absent.
- "text or `null`" means that the member may be `null`: test it before you
  show it.
- An integer is below 2^53, so it is exact in JavaScript. Times are in
  milliseconds: "Unix milliseconds" count from 1970 in UTC, as `Date.now()`
  does.
- A member that goes with `offsetMinutes` is a timestamp to format with
  that UTC offset; see
  [time, dates and numbers](logic.md#time-dates-and-numbers).
- An `asset:` handle is an image that OverCrow holds for the widget: bind
  it to the `src` of an `image` or an `avatar`, or draw it on a canvas. It
  is not a URL and cannot be read as bytes.
- A subscription whose shape is "… or `null`" delivers `null` when there is
  nothing to show: no active game, no media player.

Which service gives which shape is in the
[service reference](service-reference.md).

## Shapes

<!-- generated:result-shapes -->
### `HttpResponse`

Answer of `http.fetch`. `{ status, contentType }` or `{ status, asset }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `status` | integer | HTTP status. |
| `contentType` | text or `null` | Response media type; the SDK adds the decoded body, `body`. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `status` | integer | HTTP status. |
| `asset` | `asset:` handle | The decoded image (`as: "image"`). |

### `GameEvent`

One game event. `{ event, at }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `event` | text | A declared game event. |
| `at` | integer | Host monotonic clock in ms. |

### `Session`

Duration of the active game session. `{ elapsedMs, at }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `elapsedMs` | integer | Time since the game process started. |
| `at` | integer | Host monotonic clock in ms at which `elapsedMs` was measured. |

### `Telemetry`

Resource use of the active game. `{ cpu, ram, cpuTemperature, gpuTemperature, sources }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `cpu` | number or `null` | The game's share of the whole machine in %, from 0 to 100. |
| `ram` | integer or `null` | Resident bytes of the game. |
| `cpuTemperature` | number or `null` | °C. |
| `gpuTemperature` | number or `null` | °C. |
| `sources` | `{ cpuTemperature, gpuTemperature }` | Sensors the host has. |
| `sources.cpuTemperature` | boolean | The host has a CPU sensor. |
| `sources.gpuTemperature` | boolean | The host has a GPU sensor. |

### `Fps`

Frame rate of the active game. `{ fps, stale, status }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `fps` | integer or `null` | Frames per second. |
| `stale` | boolean | No sample for 3 s. |
| `status` | `ready` \| `waiting` \| `unsupported` \| `permission_denied` \| `ambiguous` \| `events_lost` \| `unavailable` | Measurement state. |

### `Stopwatch`

The manual stopwatch. `{ running, elapsedMs, at, shortcuts }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `running` | boolean | It is counting. |
| `elapsedMs` | integer | Elapsed time at `at`. |
| `at` | integer | Host monotonic clock in ms at which `elapsedMs` was measured. |
| `shortcuts` | `{ toggle, reset, bound }` | Stopwatch shortcuts. |
| `shortcuts.toggle` | text | Host-formatted key chord. |
| `shortcuts.reset` | text | Host-formatted key chord. |
| `shortcuts.bound` | boolean | The shortcuts are active. |

### `Media`

The current media player. `{ player, title, artists, playing, canPrevious, canPlayPause, canNext, cover }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `player` | text | Opaque ID of the current player. |
| `title` | text or `null` | Track title. |
| `artists` | list of text | Artists. |
| `playing` | boolean | Playing. |
| `canPrevious` | boolean | The player supports previous. |
| `canPlayPause` | boolean | The player supports play/pause. |
| `canNext` | boolean | The player supports next. |
| `cover` | `asset:` handle or `null` | Cover art, at most 512 px. |

### `NoteItem`

One checklist item. `{ id, text, checked }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text or `null` | Item ID. |
| `text` | text | Text. |
| `checked` | boolean | Checked. |

### `Note`

One note. `{ id, title, body, items }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text or `null` | Note ID. |
| `title` | text | Title. |
| `body` | text | Body text. |
| `items` | list of [`NoteItem`](#noteitem) | Checklist. |

### `Notes`

The user's notes document. `{ active, notes }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `active` | text or `null` | ID of the active note. |
| `notes` | list of [`Note`](#note) | Notes. |

### `CreatedNote`

Answer of `notes.create`. `{ note }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `note` | [`Note`](#note) | The new note. |

### `Score`

PlayerVox score of the active game. `{ state, name, score, grade, ratingsCount, criteria }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `loading` \| `ready` \| `no_ratings` \| `not_found` \| `unavailable` | Score state: `idle` without an active game, `unsupported` for a game without a Steam app ID, `loading` until the game's first answer (never the previous game's score), `ready` and `no_ratings` with the score, `not_found` for a game PlayerVox cannot match, `unavailable` while the host retries. Every state but `ready` and `no_ratings` has a `null` name and score, grade `--`, no ratings and `null` criteria. |
| `name` | text or `null` | Game name. |
| `score` | number or `null` | 0–100. |
| `grade` | `S+` \| `S` \| `A` \| `B` \| `C` \| `D` \| `F` \| `--` | Grade of the score. |
| `ratingsCount` | integer | Number of ratings. |
| `criteria` | `{ gameplay, art, tech }` | Criteria scores. |
| `criteria.gameplay` | number or `null` | 0–100. |
| `criteria.art` | number or `null` | 0–100. |
| `criteria.tech` | number or `null` | 0–100. |

### `Rating`

The user's PlayerVox rating of the active game. `{ gameplay, art, tech, review, publishedAt, offsetMinutes }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `gameplay` | integer | 0–100. |
| `art` | integer | 0–100. |
| `tech` | integer | 0–100. |
| `review` | text or `null` | Review text. |
| `publishedAt` | integer or `null` | Unix milliseconds. |
| `offsetMinutes` | integer or `null` | UTC offset in minutes to show the timestamp with. |

### `RatingState`

The user's own rating of the active game, with its state. `{ state, name, offline, rating }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `loading` \| `ready` \| `unavailable` | Rating state: `idle` without an active game, `unsupported` for a game without a Steam app ID, `loading` until the first answer for this game and account (never the previous game's rating), `ready` with the rating, `unavailable` while the host retries a failed read. Every state but `ready` has a `null` name and rating. |
| `name` | text or `null` | Game name on PlayerVox. |
| `offline` | boolean | PlayerVox is unreachable: the rating is the last one read, and `playervox.rating.publish` answers `not_connected`. |
| `rating` | [`Rating`](#rating) or `null` | The user's rating; `null` before the first one. |

### `Review`

One player review. `{ id, author, grade, score, text, original, hidden, publishedAt, offsetMinutes }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | Review ID. |
| `author` | text | Author name. |
| `grade` | `S+` \| `S` \| `A` \| `B` \| `C` \| `D` \| `F` \| `--` | Grade. |
| `score` | integer | 0–100. |
| `text` | text or `null` | Text, translated when a translation exists. |
| `original` | text or `null` | Untranslated text when `text` is a translation; `null` otherwise. |
| `hidden` | boolean | Hidden by the community: show the text only once the user asks for it. |
| `publishedAt` | integer | Unix milliseconds. |
| `offsetMinutes` | integer | UTC offset in minutes to show the timestamp with. |

### `ReviewsState`

The player reviews of the active game: what to read, not the reviews. `{ state, revision, offline }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `ready` | `idle` without an active game, `unsupported` for a game without a Steam app ID, `ready` when `playervox.reviews.page` reads the game's reviews. |
| `revision` | integer | Changes whenever the reviews to read change: another game, another PlayerVox account, or reviews changed on PlayerVox. |
| `offline` | boolean | PlayerVox is unreachable: `playervox.reviews.page` answers `not_connected`. |

### `ReviewsPage`

A page of player reviews. `{ gameName, items, page, totalPages, count }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `gameName` | text | Game name on PlayerVox. |
| `items` | list of [`Review`](#review) | Reviews. |
| `page` | integer | Page number. |
| `totalPages` | integer | Number of pages. |
| `count` | integer | Number of reviews. |

### `JournalSession`

One journal session. `{ id, startedAt, offsetMinutes, durationMs, source }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | Session ID. |
| `startedAt` | integer | Unix milliseconds. |
| `offsetMinutes` | integer | UTC offset in minutes to show the timestamp with. |
| `durationMs` | integer | Duration. |
| `source` | `local` \| `cloud` | Where the session is stored. |

### `JournalState`

The journal of the active game. `{ revision, notice }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `revision` | integer | Changes whenever the merged journal of the active game changes. |
| `notice` | `offline` \| `storage_unavailable` \| `full` \| `expired` \| `busy` \| `unavailable` or `null` | Journal condition to show above the sessions: `offline` sync is offline (local sessions remain), `storage_unavailable` the local journal cannot be read, `full` the local journal is full, `expired` the PlayerVox sign-in expired, `busy` PlayerVox asks to retry later, `unavailable` any other failure; `null` when none. |

### `JournalPage`

A page of the game journal. `{ gameName, items, page, next, previous }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `gameName` | text | Active game; empty when the host has no name. |
| `items` | list of [`JournalSession`](#journalsession) | Sessions, newest first. |
| `page` | integer | Page number, from 1. |
| `next` | text or `null` | Cursor of the next page. |
| `previous` | text or `null` | Cursor of the previous page. |

### `ChatFragment`

A text run or an emote of a chat message. `{ text }` or `{ emote, alt }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `text` | text | Text run. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `emote` | `asset:` handle | Emote image. |
| `alt` | text | Emote name. |

### `ChatMessage`

One chat message. `{ id, author, color, badges, fragments, reply, deleted, receivedAt }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | Message ID. |
| `author` | text | Author name. |
| `color` | text or `null` | Author colour `#rrggbb`. |
| `badges` | list of `asset:` handle | Badge images. |
| `fragments` | list of [`ChatFragment`](#chatfragment) | Content runs. |
| `reply` | `{ author, text }` or `null` | The message replied to. |
| `reply.author` | text | Author replied to. |
| `reply.text` | text | Text replied to. |
| `deleted` | boolean | Deleted by a moderator. |
| `receivedAt` | integer | When the host received the message, in Unix milliseconds of the host's clock: compare it with `Date.now()` to age a message (the fade of Passive mode), also after a `reset`. |

### `TwitchChat`

Twitch chat state. `{ account, channel, joinState, failure, favorites, canSend, generation, reset, messages, removed, skipped }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `account` | `signed_out` \| `pending` \| `connected` \| `expired` | Twitch account state; sign-in is drawn by the host. |
| `channel` | text or `null` | Joined channel login. |
| `joinState` | `idle` \| `connecting` \| `joined` \| `reconnecting` \| `failed` | Channel connection state. |
| `failure` | `channel_unavailable` \| `connection` \| `provider` \| `limit` or `null` | Why `joinState` is `failed`, as a fixed category: the channel does not exist or refuses the account, the connection failed, Twitch answered something unexpected, or another widget holds the host's one chat connection (`limit`). `null` in every other state. An account failure is not here: the host draws it. |
| `favorites` | list of text | Favorite channels. |
| `canSend` | boolean | A message can be sent now. |
| `generation` | integer | Changes with the channel or account. |
| `reset` | boolean | `messages` replaces the whole list. |
| `messages` | list of [`ChatMessage`](#chatmessage) | Messages, oldest first: the whole list with `reset`; otherwise the new messages, to append, and the changed ones, which replace the message of the same `id` in place. |
| `removed` | list of text | IDs of removed messages. |
| `skipped` | integer | New messages the host left out since the previous update, because the chat is faster than it delivers; 0 with `reset`. A removal is never left out. |
<!-- /generated:result-shapes -->
