# Live goals

`com.playervox.overcrow.twitch.goals` — for streamers: your Twitch channel's
current goal and its progress, your follower count and the latest follower,
and the Hype Train while it runs, over your game. A PlayerVox widget of the
catalog, not a built-in, not installed by default: written against the
public `@overcrow/sdk` and packaged with `overcrow-widget` like any
creator's widget. MIT.

It reads Twitch through PlayerVox OverCrow's **integrated Twitch service**
(`"accounts": [{ "service": "twitch", "scopes": [...] }]`): the user
connects Twitch once, in the Control Center's Connected services or from
the widget's frame in game, and the Twitch chat and every widget that uses
the service share that connection. The connection asks Twitch for the read
permissions this widget names; the widget never sees the token: the host
adds it to the routes that name the `twitch` account, and only to
`https://api.twitch.tv`.

Twitch is a trademark of Twitch Interactive, Inc. PlayerVox is not
affiliated with Twitch ([trademarks](../../TRADEMARKS.md)).

## What it shows

| State | Shows |
| --- | --- |
| Twitch not connected, pending, expired, more permissions needed | PlayerVox OverCrow's own panel over the widget ("Connect Twitch", "Reconnect Twitch"…): the widget draws no account screen |
| Loading | A skeleton, on the very first read only |
| Goal | The newest active goal: its icon by type (star subscriptions, user-plus followers, gem Bits, sparkles cheerers), the streamer's description or else the type ("Followers goal"), bar, count and percentage; then the followers |
| Reached | Green check, green bar and "Reached" |
| Hype Train | A card in the accent colour in front: "Hype Train", the time left counted down each second, the level and its progress. Alone in Compact; with the goal on one line in Standard. It leaves when its time is up, without waiting for Twitch |
| New follower | The followers card in the accent colour, pulsing twice, for 10 seconds |
| No goal | "No active goal" and where to create one (Creator Dashboard, Goals); the followers stay |
| Nothing to show | Every option off: "Nothing to show", choose in the widget options |
| Unreachable, rate limited, refused | An amber line on top: "Unreachable · 5 min ago", "Rate limited · 2 min ago" or "Refused by Twitch · 5 min ago"; the values stay; the tooltip says why and what to do. Without any value yet: "Twitch unreachable. Retrying every minute." |

Values never disappear during a read, a failure or a limit. Texts are in
English and French ("Followers" and "Hype Train" keep Twitch's own words in
French); numbers use the user's format.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line, Compact, Standard (default), Full. The frame fits its height to the content; the width is yours |
| Goals shown › Subscribers, Followers, Bits, Cheerers | Which goal types show (all by default); the four subscription goal types follow "Subscribers" |
| Follower count | On (default): "1,284 followers" |
| Latest follower | On (default): "Latest: NyxArcade", with how long ago in Full |
| Hype Train while it runs | On (default); off, never shown and never read |
| Twitch logo | On (default): Twitch's Glitch on the first card; off, the word "Twitch" |

A route whose data no option shows is not called.

## Permissions

| Permission | Why |
| --- | --- |
| `account:twitch` | The integrated Twitch service, with three read scopes: `channel:read:goals`, `moderator:read:followers`, `channel:read:hype_train`. PlayerVox OverCrow refuses any other Twitch path, and any method but `GET` |
| `network` | Four `GET` routes of `https://api.twitch.tv` (below) |

| Route | Scope | When |
| --- | --- | --- |
| `/helix/users` | none | Once per connection: the channel's ID |
| `/helix/goals` | `channel:read:goals` | Every minute while shown, when goals show |
| `/helix/channels/followers?first=1` | `moderator:read:followers` | Every minute while shown, when the count or the latest follower shows |
| `/helix/hypetrain/status` | `channel:read:hype_train` | Every minute while shown, when the Hype Train shows |

At worst three requests a minute, 4,320 a day, well inside Twitch's
per-minute bucket. No storage: nothing of Twitch is kept on disk (Twitch
allows a cache of 24 hours at most); after a restart the widget reads
again.

## How it works

- **Rhythm.** One timer a minute. Hidden, the widget calls nothing; shown
  again, it reads once if the last read is older than a minute. A route is
  asked at most once per tick of that timer (one second of slack absorbs
  the delivery of the tick). Polling, not EventSub: everything is at most a
  minute late, except the Hype Train's countdown, local each second while a
  train runs (and only then).
- **Channel.** Each connection reads `/helix/users` again: if another
  account is now connected, the values of the old one are dropped. A 401 or
  403 on a route while PlayerVox OverCrow's own check of the token
  (`validate`) passes reads the channel again first; if Twitch keeps
  refusing, the amber "Refused by Twitch" line says to reconnect Twitch.
  When the token itself is refused, PlayerVox OverCrow marks the connection
  expired and covers the widget with its panel.
- **Failures.** A network failure or a timeout retries every minute; a 5xx
  or a 429 waits 1, 2, 4, 8 then 10 minutes (`http.fetch` gives no
  `Ratelimit-Reset`). PlayerVox OverCrow's own network budget being full
  (`busy`) is not a failure of Twitch: the view stays, the next minute
  reads again.
- **Twitch's answers.** Goals come newest first (Twitch documents no
  order); an unknown goal type shows with a neutral icon. Without the
  followers scope Twitch may give the count alone: the latest follower is
  then left out. A Hype Train reads as running from `current` and its
  `expires_at` (moved later at each new level); `current` null, or no data,
  means none.
- **The Glitch.** Twitch's official `glitch_flat_white` (dark theme) and
  `glitch_flat_black-ops` (light theme) from `Twitch-Brand.zip`, unchanged,
  rasterized at 64 px and shown at 16 px with its clear space, on the first
  card only, as attribution of the data's source (Twitch Developer Services
  Agreement). Never in the title, the widget's icon, the one-line layout or
  marketing material: the catalog preview is captured with the option off.

## Limits

- Updated every minute, not live.
- Twitch's goals API lists the active goals only; a goal ended on Twitch
  disappears at the next read.
- The latest follower only: no follower list.

## Tests

`node --test tests/*.test.mjs` checks the readers of each route and the
engine on a synthetic Twitch (`tests/twitch-fake.mjs`): rhythm, options,
failures, account changes, new followers and the Hype Train. `node
tests/scenarios.mjs` writes the scenarios from one invented channel, and
`overcrow-widget test` plays them in PlayerVox OverCrow's headless runtime.
The channel, goals, followers and figures of the scenarios and of the
catalog preview are fictional, for demonstration only.
