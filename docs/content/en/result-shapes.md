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
- An `asset:` handle is an image that PlayerVox OverCrow holds for the
  widget: bind it to the `src` of an `image` or an `avatar`, or draw it on a
  canvas. It is not a URL and cannot be read as bytes.
- A subscription whose shape is "… or `null`" delivers `null` when there is
  nothing to show: no active game, no media player.

Which service gives which shape is in the
[service reference](service-reference.md).

## Shapes

<!-- generated:result-shapes -->
### `HttpResponse`

Answer of `http.fetch`. `{ status, contentType, headers }` or `{ status, asset, headers }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `status` | integer | HTTP status. |
| `contentType` | text or `null` | Response media type; the SDK adds the decoded body, `body`. |
| `headers` | [`HttpHeaders`](#httpheaders) | The response's headers of `RESPONSE_HEADERS`. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `status` | integer | HTTP status. |
| `asset` | `asset:` handle | The decoded image (`as: "image"`). |
| `headers` | [`HttpHeaders`](#httpheaders) | The response's headers of `RESPONSE_HEADERS`. |

### `HttpHeaders`

Headers of an `http.fetch` response, by lowercase name: only those of `RESPONSE_HEADERS` the response has, each printable ASCII of at most 256 bytes; a repeated header is joined by `, `. Any other header never reaches the widget. `{ retry-after?, ratelimit?, ratelimit-policy?, ratelimit-limit?, ratelimit-remaining?, ratelimit-reset?, x-ratelimit-limit?, x-ratelimit-remaining?, x-ratelimit-reset?, date?, etag?, last-modified?, cache-control?, expires?, age? }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `retry-after` | text | Present when the response has it. |
| `ratelimit` | text | Present when the response has it. |
| `ratelimit-policy` | text | Present when the response has it. |
| `ratelimit-limit` | text | Present when the response has it. |
| `ratelimit-remaining` | text | Present when the response has it. |
| `ratelimit-reset` | text | Present when the response has it. |
| `x-ratelimit-limit` | text | Present when the response has it. |
| `x-ratelimit-remaining` | text | Present when the response has it. |
| `x-ratelimit-reset` | text | Present when the response has it. |
| `date` | text | Present when the response has it. |
| `etag` | text | Present when the response has it. |
| `last-modified` | text | Present when the response has it. |
| `cache-control` | text | Present when the response has it. |
| `expires` | text | Present when the response has it. |
| `age` | text | Present when the response has it. |

### `Session`

Duration of the active game session. `{ elapsedMs, at }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `elapsedMs` | integer | Time since the game process started. |
| `at` | integer | Host monotonic clock in ms at which `elapsedMs` was measured. |

### `Game`

The active game. `{ steamAppId, name }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `steamAppId` | integer or `null` | Steam app ID, 1–2147483647, or `null` outside the Steam store. |
| `name` | text or `null` | Name in the user's game list, one line of at most 512 bytes, or `null`. |

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

### `AccountStatus`

State of a third-party account the widget declares. `{ state }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `signed_out` \| `pending` \| `connected` \| `refused` \| `expired` | State of the account; connection is drawn by the host. |

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

### `TwitchEvent`

One live Twitch event. `{ seq, type, at, data }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1, without gaps unless events were dropped. |
| `type` | `channel.goal.begin` \| `channel.goal.progress` \| `channel.goal.end` \| `channel.follow` \| `channel.hype_train.begin` \| `channel.hype_train.progress` \| `channel.hype_train.end` \| `channel.cheer` \| `channel.subscribe` \| `channel.subscription.gift` \| `channel.subscription.message` \| `channel.poll.begin` \| `channel.poll.progress` \| `channel.poll.end` \| `channel.prediction.begin` \| `channel.prediction.progress` \| `channel.prediction.lock` \| `channel.prediction.end` | The EventSub type, among those subscribed. |
| `at` | integer | When the host received it, in Unix milliseconds of the host's clock. |
| `data` | JSON | The host's projection of the event: the fields of the type's table under Twitch's names, `null` where Twitch sent none. |

### `TwitchEvents`

Live Twitch events of the widget's declared types. `{ state, reason, events }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `live` \| `off` | `live` while the host is subscribed at Twitch. |
| `reason` | `connecting` \| `not_connected` \| `unavailable` or `null` | Why the state is `off`; `null` when `live`. |
| `events` | list of [`TwitchEvent`](#twitchevent) | The latest events, oldest first. |

### `SteamEvent`

One local Steam event. `{ seq, type, at, data }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1, without gaps unless events were dropped. |
| `type` | `stats.saved` | The type, among those subscribed. |
| `at` | integer | When the Steam client saved it, in Unix milliseconds of the host's clock, never later than the update. |
| `data` | JSON | The fields of the type's table: `{ appid }` for `stats.saved`. |

### `SteamEvents`

Local Steam events of the widget's declared types, for the account it names. `{ state, reason, events }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `live` \| `off` | `live` while the host watches the Steam client's stats on this computer. |
| `reason` | `connecting` \| `not_connected` \| `unavailable` or `null` | Why the state is `off`; `null` when `live`. |
| `events` | list of [`SteamEvent`](#steamevent) | The latest events, oldest first. |

### `SteamLocalAchievement`

One achievement the Steam client of this computer saved as unlocked. `{ name, unlockedAt }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `name` | text | The achievement's API name, at most 128 bytes of printable ASCII. |
| `unlockedAt` | integer or `null` | When it was unlocked, in Unix milliseconds; `null` when Steam saved no time. |

### `SteamLocalAchievements`

The unlocked achievements of a game, read on this computer for the account the widget names. `{ appid, total, achievements }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `appid` | integer | The game asked for. |
| `total` | integer | How many achievements of the game the files hold as unlocked. |
| `achievements` | list of [`SteamLocalAchievement`](#steamlocalachievement) | A page of them, newest first (`null` times last, then by name). |

### `WarframeName`

Something of Warframe, named. `{ id, name }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | Our stable ID, in `snake_case`, listed in the game events page. |
| `name` | text or `null` | Its name in the game's language, one line of at most 128 bytes; `null` when PlayerVox OverCrow has none yet. |

### `WarframeNode`

A node of the star chart. `{ id, name }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | The game's own key of the node (`SolNode195`, `ClanNode…`, `SettlementNode…`), as public data such as drop tables and the world state name it. |
| `name` | text or `null` | Its name in the game's language, or `null` when PlayerVox OverCrow has none yet (new content). |

### `WarframeEvents`

Warframe's game events, for the features the widget lists. `{ playing, session, glossary, features, info, events }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `playing` | boolean | Whether Warframe is the active game in PlayerVox OverCrow. |
| `session` | `{ startedAt, language }` or `null` | The Warframe session being followed, or `null` before any; a new launch is a new session. |
| `session.startedAt` | integer | When Warframe was launched, in Unix milliseconds. |
| `session.language` | `de` \| `en` \| `es` \| `fr` \| `it` \| `ja` \| `ko` \| `pl` \| `pt` \| `ru` \| `tc` \| `th` \| `tr` \| `uk` \| `zh` or `null` | The game's language (`en`, `fr`, `de`…); `null` until the game says it. |
| `glossary` | [`WarframeGlossary`](#warframeglossary) | Words of the game in the game's language, whatever the features the widget follows. |
| `features` | [`WarframeFeatures`](#warframefeatures) | The status of each feature. |
| `info` | [`WarframeInfo`](#warframeinfo) | The state of each feature the widget follows. |
| `events` | list of [`WarframeEvent`](#warframeevent) | The latest events of the features the widget follows, oldest first. |

### `WarframeGlossary`

Words of the game a widget shows on their own, in the game's language, so that it never writes one itself. `{ language, damage, era, fissure, activity, place, eidolon, faction, cycle, term }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `language` | `en` \| `fr` | The language of these words: the game's when PlayerVox OverCrow has them in it, English otherwise. |
| `damage` | `{ impact, puncture, slash, heat, cold, electricity, toxin, blast, corrosive, gas, magnetic, radiation, viral }` | The damage types, by our ID. |
| `damage.impact` | text | Its name in the language of `glossary.language`. |
| `damage.puncture` | text | Its name in the language of `glossary.language`. |
| `damage.slash` | text | Its name in the language of `glossary.language`. |
| `damage.heat` | text | Its name in the language of `glossary.language`. |
| `damage.cold` | text | Its name in the language of `glossary.language`. |
| `damage.electricity` | text | Its name in the language of `glossary.language`. |
| `damage.toxin` | text | Its name in the language of `glossary.language`. |
| `damage.blast` | text | Its name in the language of `glossary.language`. |
| `damage.corrosive` | text | Its name in the language of `glossary.language`. |
| `damage.gas` | text | Its name in the language of `glossary.language`. |
| `damage.magnetic` | text | Its name in the language of `glossary.language`. |
| `damage.radiation` | text | Its name in the language of `glossary.language`. |
| `damage.viral` | text | Its name in the language of `glossary.language`. |
| `era` | `{ lith, meso, neo, axi, requiem, omnia }` | The Void Fissure eras. |
| `era.lith` | text | Its name in the language of `glossary.language`. |
| `era.meso` | text | Its name in the language of `glossary.language`. |
| `era.neo` | text | Its name in the language of `glossary.language`. |
| `era.axi` | text | Its name in the language of `glossary.language`. |
| `era.requiem` | text | Its name in the language of `glossary.language`. |
| `era.omnia` | text | Its name in the language of `glossary.language`. |
| `fissure` | `{ lith, meso, neo, axi, requiem, omnia }` | A Void Fissure of each era, by the era's ID. |
| `fissure.lith` | text | Its name in the language of `glossary.language`. |
| `fissure.meso` | text | Its name in the language of `glossary.language`. |
| `fissure.neo` | text | Its name in the language of `glossary.language`. |
| `fissure.axi` | text | Its name in the language of `glossary.language`. |
| `fissure.requiem` | text | Its name in the language of `glossary.language`. |
| `fissure.omnia` | text | Its name in the language of `glossary.language`. |
| `activity` | `{ sortie, archon_hunt, netracells, circuit, nightwave, baro_ki_teer, void_fissure, arbitration, steel_path, void_storm }` | Activities of the game. |
| `activity.sortie` | text | Its name in the language of `glossary.language`. |
| `activity.archon_hunt` | text | Its name in the language of `glossary.language`. |
| `activity.netracells` | text | Its name in the language of `glossary.language`. |
| `activity.circuit` | text | Its name in the language of `glossary.language`. |
| `activity.nightwave` | text | Its name in the language of `glossary.language`. |
| `activity.baro_ki_teer` | text | Its name in the language of `glossary.language`. |
| `activity.void_fissure` | text | Its name in the language of `glossary.language`. |
| `activity.arbitration` | text | Its name in the language of `glossary.language`. |
| `activity.steel_path` | text | Its name in the language of `glossary.language`. |
| `activity.void_storm` | text | Its name in the language of `glossary.language`. |
| `place` | `{ drifter_camp, larunda_relay, vesper_relay, strata_relay, kronia_relay, orcus_relay, cetus, fortuna, necralisk, sanctum_anatomica, chrysalith, hollvania_central_mall, maroos_bazaar, iron_wake, plains_of_eidolon, orb_vallis, cambion_drift }` | The places that are not a node. |
| `place.drifter_camp` | text | Its name in the language of `glossary.language`. |
| `place.larunda_relay` | text | Its name in the language of `glossary.language`. |
| `place.vesper_relay` | text | Its name in the language of `glossary.language`. |
| `place.strata_relay` | text | Its name in the language of `glossary.language`. |
| `place.kronia_relay` | text | Its name in the language of `glossary.language`. |
| `place.orcus_relay` | text | Its name in the language of `glossary.language`. |
| `place.cetus` | text | Its name in the language of `glossary.language`. |
| `place.fortuna` | text | Its name in the language of `glossary.language`. |
| `place.necralisk` | text | Its name in the language of `glossary.language`. |
| `place.sanctum_anatomica` | text | Its name in the language of `glossary.language`. |
| `place.chrysalith` | text | Its name in the language of `glossary.language`. |
| `place.hollvania_central_mall` | text | Its name in the language of `glossary.language`. |
| `place.maroos_bazaar` | text | Its name in the language of `glossary.language`. |
| `place.iron_wake` | text | Its name in the language of `glossary.language`. |
| `place.plains_of_eidolon` | text | Its name in the language of `glossary.language`. |
| `place.orb_vallis` | text | Its name in the language of `glossary.language`. |
| `place.cambion_drift` | text | Its name in the language of `glossary.language`. |
| `eidolon` | `{ teralyst, gantulyst, hydrolyst }` | The Eidolons. |
| `eidolon.teralyst` | text | Its name in the language of `glossary.language`. |
| `eidolon.gantulyst` | text | Its name in the language of `glossary.language`. |
| `eidolon.hydrolyst` | text | Its name in the language of `glossary.language`. |
| `faction` | `{ grineer, corpus, infested, corrupted, sentient, narmer, murmur, scaldra, techrot, tenno }` | The factions. |
| `faction.grineer` | text | Its name in the language of `glossary.language`. |
| `faction.corpus` | text | Its name in the language of `glossary.language`. |
| `faction.infested` | text | Its name in the language of `glossary.language`. |
| `faction.corrupted` | text | Its name in the language of `glossary.language`. |
| `faction.sentient` | text | Its name in the language of `glossary.language`. |
| `faction.narmer` | text | Its name in the language of `glossary.language`. |
| `faction.murmur` | text | Its name in the language of `glossary.language`. |
| `faction.scaldra` | text | Its name in the language of `glossary.language`. |
| `faction.techrot` | text | Its name in the language of `glossary.language`. |
| `faction.tenno` | text | Its name in the language of `glossary.language`. |
| `cycle` | `{ day, night, warm, cold, fass, vome }` | The states of the open worlds' cycles. |
| `cycle.day` | text | Its name in the language of `glossary.language`. |
| `cycle.night` | text | Its name in the language of `glossary.language`. |
| `cycle.warm` | text | Its name in the language of `glossary.language`. |
| `cycle.cold` | text | Its name in the language of `glossary.language`. |
| `cycle.fass` | text | Its name in the language of `glossary.language`. |
| `cycle.vome` | text | Its name in the language of `glossary.language`. |
| `term` | `{ reactant, relic, credits }` | Other words of the game. |
| `term.reactant` | text | Its name in the language of `glossary.language`. |
| `term.relic` | text | Its name in the language of `glossary.language`. |
| `term.credits` | text | Its name in the language of `glossary.language`. |

### `WarframeEarned`

The rotations a mission earned. `{ rotations, totals }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `rotations` | list of `A` \| `B` \| `C` | The rotations earned, in order, the latest 64. |
| `totals` | `{ A, B, C }` | How many of each, all of them. |
| `totals.A` | integer | Rotations A earned. |
| `totals.B` | integer | Rotations B earned. |
| `totals.C` | integer | Rotations C earned. |

### `WarframeFeatures`

The status of each Warframe feature. `{ location, mission, progress, squad, eidolons, world, rewards }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `location` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `mission` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `progress` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `squad` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `eidolons` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `world` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |
| `rewards` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` or `undeclared`. |

### `WarframeInfo`

The state of each Warframe feature; `null` for a feature the widget does not follow. `{ location, mission, progress, squad, eidolons, world }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `location` | [`WarframeLocation`](#warframelocation) or `null` | Where the player is; `null` while Warframe is not played. |
| `mission` | [`WarframeMission`](#warframemission) or `null` | The latest mission of the session. |
| `progress` | [`WarframeProgress`](#warframeprogress) or `null` | The progress of the latest mission. |
| `squad` | [`WarframeSquad`](#warframesquad) or `null` | The squad. |
| `eidolons` | [`WarframeEidolons`](#warframeeidolons) or `null` | The night on the Plains of Eidolon. |
| `world` | [`WarframeWorld`](#warframeworld) or `null` | The world of the day and the week, whether Warframe is played or not. |

### `WarframeLocation`

Where the player is. `{ kind, place, since }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `kind` | `orbiter` \| `relay` \| `hub` \| `open_world` \| `mission` \| `dojo` \| `other` | What kind of place. |
| `place` | [`WarframeName`](#warframename) or `null` | Which one: a hub, a relay or an open world of our places, or the node of a mission; `null` when the game does not say. |
| `since` | integer | When the player arrived, in Unix milliseconds. |

### `WarframeMission`

A Warframe mission. `{ state, node, planet, type, faction, enemyLevel, fissure, modifiers, selectedAt, loadingAt, startedAt, endedAt, result, durationSeconds, rewards, rewardsPending, earned, credits }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `selected` \| `loading` \| `in_progress` \| `ended` | `selected` on the star chart, `loading`, `in_progress` or `ended`. |
| `node` | [`WarframeNode`](#warframenode) | The node. |
| `planet` | [`WarframeName`](#warframename) or `null` | Its planet or region. |
| `type` | [`WarframeName`](#warframename) or `null` | The mission type; `null` for one we do not know. |
| `faction` | [`WarframeName`](#warframename) or `null` | The enemy faction. |
| `enemyLevel` | `{ min, max }` or `null` | The enemy levels of the node. |
| `enemyLevel.min` | integer | Lowest enemy level. |
| `enemyLevel.max` | integer | Highest enemy level. |
| `fissure` | [`WarframeName`](#warframename) or `null` | The era of a Void Fissure mission. |
| `modifiers` | list of [`WarframeModifier`](#warframemodifier) | What changes the mission, at most 8. |
| `selectedAt` | integer or `null` | When it was chosen, in Unix milliseconds. |
| `loadingAt` | integer or `null` | When it began to load. |
| `startedAt` | integer or `null` | When play began. |
| `endedAt` | integer or `null` | When it ended. |
| `result` | `succeeded` \| `failed` \| `aborted` or `null` | `succeeded`, `failed` or `aborted`; `null` before the end, or when the game did not say. |
| `durationSeconds` | number or `null` | From the start of play to the end, in seconds to the millisecond. |
| `rewards` | [`WarframeRewards`](#warframerewards) or `null` | What the mission can reward, for a widget that follows `warframe.rewards`; `null` otherwise, for a node without a reward table, or for a mission whose table is not public or not known yet. |
| `rewardsPending` | boolean | `true` while `rewards` is `null` for now: which table applies is not known yet (a node of the day's Sortie or Archon Hunt, chosen but not loaded; the world or the drop tables not read yet). `false` otherwise, `rewards` given or not. |
| `earned` | [`WarframeEarned`](#warframeearned) or `null` | The rotations earned from the start, for a type with rotations; `null` otherwise or before the start. |
| `credits` | integer or `null` | The credits its end screen counts; `null` before the end, or when the game does not say (an aborted mission). |

### `WarframeModifier`

What changes a mission. `{ id, name, stage }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | `steel_path` \| `arbitration` \| `sortie` \| `archon_hunt` \| `nightmare` \| `void_storm` \| `alert` \| `lich` | Our ID of the modifier. |
| `name` | text | Its name in the game's language. |
| `stage` | integer or `null` | The stage of a Sortie or an Archon Hunt, 1 to 3, when PlayerVox OverCrow can tell it. |

### `WarframeProgress`

The progress of a mission. `{ wave, waveEnemies, round, rewards, rotation, earned, cycle, clock, nextRewardAt, nextRewardWave }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `wave` | integer or `null` | The current wave (Defense, Mirror Defense). |
| `waveEnemies` | `{ total, left }` or `null` | The enemies of the current Defense wave; `null` before the first. |
| `waveEnemies.total` | integer | The enemies the wave announced. |
| `waveEnemies.left` | integer or `null` | Those left, as the game counts them once all have spawned; 0 once the wave is cleared; `null` before. |
| `round` | integer or `null` | Rounds done (Interception, Disruption). |
| `rewards` | integer | Rotation rewards given so far. |
| `rotation` | `A` \| `B` \| `C` or `null` | The rotation of the next reward; `null` for a type without rotations or one we cannot count. |
| `earned` | [`WarframeEarned`](#warframeearned) | The rotations given so far. |
| `cycle` | `{ number, rotations, earned }` or `null` | The round of rotations of the next reward; `null` for a Disruption and a type without rotations. |
| `cycle.number` | integer | 1 for the first round. |
| `cycle.rotations` | list of `A` \| `B` \| `C` | Its rotations, in order: `A`, `A`, `B`, `C`; an Arbitration's first `A`, `A`, `B`, `B`, then `C`, `C`, `C`, `C`. |
| `cycle.earned` | integer | How many of them were given. |
| `clock` | `waiting` \| `running` or `null` | For a type paid on time (Survival): `waiting` until its clock starts, then `running`; `null` otherwise. |
| `nextRewardAt` | integer or `null` | When the next reward comes, in Unix milliseconds, for a type paid on time (Survival) once its clock runs. |
| `nextRewardWave` | integer or `null` | The wave of the next reward, for a type paid on waves (Defense: every 3; Mirror Defense: every 2). |

### `WarframeSquadMember`

A member of the squad. `{ name, you }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `name` | text | The player's name, without the platform icon. |
| `you` | boolean | Whether it is the user. |

### `WarframeSquad`

The squad. `{ members }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `members` | list of [`WarframeSquadMember`](#warframesquadmember) | The members, the user included, at most 8. |

### `WarframeEidolonHunt`

One Eidolon of the night. `{ eidolon, spawnedAt, weakpoints, capturedAt, killedAt, fledAt }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `eidolon` | [`WarframeName`](#warframename) or `null` | Which Eidolon, told by the order of the hunt; `null` when it cannot be told. |
| `spawnedAt` | integer | When it appeared, in Unix milliseconds. |
| `weakpoints` | integer | Weak points destroyed. |
| `capturedAt` | integer or `null` | When it was captured. |
| `killedAt` | integer or `null` | When it was killed. |
| `fledAt` | integer or `null` | When it left at dawn. |

### `WarframeEidolons`

The night on the Plains of Eidolon. `{ night, hunts }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `night` | boolean or `null` | Whether it is night on the Plains, as the player last saw it; `null` before. |
| `hunts` | list of [`WarframeEidolonHunt`](#warframeeidolonhunt) | The Eidolons of the night, oldest first, at most 16. |

### `WarframeEvent`

One Warframe event; its type tells which state it carries. `{ seq, at, type, mission }` or `{ seq, at, type, progress }` or `{ seq, at, type }` or `{ seq, at, type, eidolon }` or `{ seq, at, type, member }` or `{ seq, at, type, location }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `mission_selected` \| `mission_loading` \| `mission_started` \| `mission_ended` | What happened. |
| `mission` | [`WarframeMission`](#warframemission) | The mission then. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `wave_started` \| `reward_given` | What happened. |
| `progress` | [`WarframeProgress`](#warframeprogress) | The progress then. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `night_started` \| `day_started` | Night or day began on the Plains. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `eidolon_spawned` \| `weakpoint_destroyed` \| `eidolon_captured` \| `eidolon_killed` \| `eidolon_fled` | What happened. |
| `eidolon` | [`WarframeEidolonHunt`](#warframeeidolonhunt) | The Eidolon then. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `member_joined` \| `member_left` | What happened. |
| `member` | [`WarframeSquadMember`](#warframesquadmember) | Who. |

| Member | Shape | Meaning |
| --- | --- | --- |
| `seq` | integer | Order of the event in the subscription, from 1. |
| `at` | integer | When it happened in the game, in Unix milliseconds. |
| `type` | `location_changed` | What happened. |
| `location` | [`WarframeLocation`](#warframelocation) | The new place. |

### `WarframeReward`

An item a node can reward. `{ id, name, quantity, chance }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `id` | text | Our ID: the item's English name in `snake_case` (`orokin_cell`). |
| `name` | text | Its name in the game's language, or in English when PlayerVox OverCrow has no translation yet; never empty. |
| `quantity` | integer | How many at once. |
| `chance` | number | The chance, from 0 to 1; the same item's entries of a table added together. |

### `WarframeRewardTable`

One reward table of a node. `{ kind, rotation, items }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `kind` | `mission` \| `caches` \| `extra` | `mission`, `caches` or `extra`. |
| `rotation` | `A` \| `B` \| `C` or `null` | The rotation, or `null` for a table without rotations. |
| `items` | list of [`WarframeReward`](#warframereward) | The items, the rarest first (equal chances by English name), at most 64. |

### `WarframeRewards`

What a mission can reward. `{ source, tables }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `source` | `node` \| `arbitration` \| `sortie` \| `nightmare` | Whose tables: `node`, or the tables of their own that replace a node's: `arbitration` (every Arbitration's), `nightmare` (a Nightmare mission's reward, once, the rotation of its planet), `sortie` (a Sortie's, after its third mission). |
| `tables` | list of [`WarframeRewardTable`](#warframerewardtable) | The tables, at most 9. Source: Digital Extremes' drop tables, no guarantees. |

### `WarframeWorldMission`

A mission of the Sortie or the Archon Hunt. `{ node, planet, type, modifier }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `node` | [`WarframeNode`](#warframenode) | The node. |
| `planet` | [`WarframeName`](#warframename) or `null` | Its planet or region. |
| `type` | [`WarframeName`](#warframename) or `null` | The mission type. |
| `modifier` | [`WarframeName`](#warframename) or `null` | The condition of a Sortie mission; `null` otherwise. |

### `WarframeCycle`

The cycle of an open world. `{ state, endsAt }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | [`WarframeName`](#warframename) | Day or night (Cetus), warm or cold (Orb Vallis), Fass or Vome (Cambion Drift). |
| `endsAt` | integer | When it changes, in Unix milliseconds. |

### `WarframeWorld`

Warframe's world of the day and the week. `{ updatedAt, sortie, archonHunt, fissures, cycles, resets, voidTrader, circuit }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `updatedAt` | integer | When PlayerVox OverCrow last read it, in Unix milliseconds. |
| `sortie` | `{ boss, faction, endsAt, missions }` or `null` | The Sortie of the day. |
| `sortie.boss` | [`WarframeName`](#warframename) | The boss. |
| `sortie.faction` | [`WarframeName`](#warframename) or `null` | Its faction. |
| `sortie.endsAt` | integer | When it ends. |
| `sortie.missions` | list of [`WarframeWorldMission`](#warframeworldmission) | Its missions, in order. |
| `archonHunt` | `{ boss, endsAt, missions }` or `null` | The Archon Hunt of the week. |
| `archonHunt.boss` | [`WarframeName`](#warframename) | The Archon. |
| `archonHunt.endsAt` | integer | When it ends. |
| `archonHunt.missions` | list of [`WarframeWorldMission`](#warframeworldmission) | Its missions, in order. |
| `fissures` | list of `{ node, planet, type, era, steelPath, voidStorm, endsAt }` | The open Void Fissures, the soonest to close first, at most 64. |
| `cycles` | `{ cetus, vallis, cambion }` | The open worlds' cycles; `null` for one PlayerVox OverCrow cannot tell. |
| `cycles.cetus` | [`WarframeCycle`](#warframecycle) or `null` | Day and night at Cetus and on the Plains. |
| `cycles.vallis` | [`WarframeCycle`](#warframecycle) or `null` | Warm and cold in the Orb Vallis. |
| `cycles.cambion` | [`WarframeCycle`](#warframecycle) or `null` | Fass and Vome in the Cambion Drift. |
| `resets` | `{ daily, weekly }` | The next resets. |
| `resets.daily` | integer | The next daily reset, 00:00 UTC, in Unix milliseconds. |
| `resets.weekly` | integer | The next weekly reset, Monday 00:00 UTC. |
| `voidTrader` | `{ arrivesAt, leavesAt, relay }` or `null` | Baro Ki'Teer's next visit, or the current one. |
| `voidTrader.arrivesAt` | integer | When he arrives. |
| `voidTrader.leavesAt` | integer | When he leaves. |
| `voidTrader.relay` | [`WarframeName`](#warframename) or `null` | Where he comes. |
| `circuit` | `{ normal, steelPath }` or `null` | The Circuit's rewards of the week, when the world state gives them. |
| `circuit.normal` | list of [`WarframeName`](#warframename) | The rewards of the week. |
| `circuit.steelPath` | list of [`WarframeName`](#warframename) | The Steel Path rewards of the week. |
<!-- /generated:result-shapes -->
