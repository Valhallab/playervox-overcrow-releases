# Steam achievements

`com.playervox.overcrow.steam.achievements` — the Steam achievements of the
game you play: how many you have, the latest one unlocked with its rarity,
and the next ones to get. A PlayerVox widget of the catalog, not a built-in,
not installed by default: written against the public `@overcrow/sdk` and
packaged with `overcrow-widget` like any creator's widget. MIT.

It reads Steam through PlayerVox OverCrow's **integrated Steam service**
(`"accounts": [{ "service": "steam" }]`): the user connects Steam once, in
the Control Center's Connected services, and every widget that uses the
service shares that connection. The widget never sees the key: the host adds
it to the routes that name the `steam` account, and only to
`https://api.steampowered.com`.

Steam is a trademark of Valve Corporation. PlayerVox is not affiliated with
Valve Corporation ([trademarks](../../TRADEMARKS.md)).

## What it shows

| State | Shows |
| --- | --- |
| Steam not connected, key refused | PlayerVox OverCrow's own panel over the widget ("Steam is not connected", "Connect Steam"): the widget draws no account screen |
| Profile | "Last step · Your Steam profile": a field for the profile link (`steamcommunity.com/id/<name>`, `/profiles/<id>`, a SteamID or a custom name), in Interactive mode; in Passive mode, a line saying to switch to Interactive mode |
| Loading | A skeleton, on the very first start only |
| Playing now | The game (store image, name), a green "Playing now", the count, bar and percentage, then by layout the tracked achievements (one: its own card; two or three: one card, a row each), else the next or latest achievement, and in Full the recently unlocked and next ones |
| New unlock | The card in the accent colour, pulsing twice, with "New" for a minute |
| Last game played | The same, with a neutral "Last game played" heading: not playing is not a problem |
| All achievements | Green bar and check |
| No achievements | "This game has no Steam achievements." |
| Not readable | Steam names the running game but refuses its achievements (a 403 with public game details: a game the player does not own; a 400 "Requested app has no stats"; `success: false`): the game, and "Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile." instead of the bar; in Standard and Full, the path "In Steam: Profile › Edit Profile › Privacy Settings", "Game details: Public"; in One line, an amber alert icon with the text in its tooltip. Asked again every 10 minutes; never "no achievements", never a server failure |
| Game details hidden | Game details set to Friends Only or Private: Steam names no running game and answers 403 "Profile is not public" for the last game played, even to the player's own key. An amber "Game details hidden", "Steam hides your game details. Set them to Public (Friends Only is not enough).", then where: "In Steam: Profile › Edit Profile › Privacy Settings", "Game details: Public". No game is shown, since the running one cannot be known. One line: the title, the rest in its tooltip |
| Profile hidden | A private profile (`communityvisibilitystate` 1): "Profile hidden", "Steam hides your profile. Set it to Public, and your game details too.", and the same path to "My profile and Game details: Public". Nothing else is asked until it is public |
| Nothing | "Play a Steam game: its achievements show up here." |
| Unreachable, rate limited | The heading becomes "Unreachable · 5 min ago" or "Rate limited · 2 min ago" (amber), the values stay; the tooltip says why and when it retries. Without any value yet: "Steam unreachable. Retrying every minute." |

"Playing now" shows only after a successful read that named the game: a
failed read never leaves it on. Values never disappear during a read, a
failure or a limit. Texts are in English and French; numbers use the user's
format; names and descriptions of achievements come from Steam in the
user's language.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line, Compact, Standard (default), Full. The frame fits its height to the content; the width is yours |
| Rows per list | 1 to 6 (3): rows of each list in Full |
| Achievements › Only missing achievements | The count becomes "28 missing", Standard shows the next one to get, Full one "Missing achievements" list of twice the rows |
| Achievements › Sort missing | Easiest first (default), Rarest first, By name |
| Achievements › Show rarity | On (default): "4.2% of players"; off, the description instead |
| Achievements › Reveal hidden achievements | Off (default): "Hidden achievement", "Revealed when you unlock it.", a lock |
| Steam logo | On (default): the Steam symbol on the game card; off, the word "Steam" |
| Track achievements… | In Interactive mode: a checklist, the tracked ones first, then the missing achievements; a click ticks or unticks at once, up to three per game ("Limit reached" greys the other rows), "Done" closes it. The rows keep their place while it is open. Tracked achievements stay at the top of the widget in the order they were added; one unlocked goes last with a green check and "Unlocked … ago", until it is unticked. Each game keeps its own (the last 20 games) |
| Change Steam profile… | The profile step, with the current link and Cancel |

## Permissions

| Permission | Why |
| --- | --- |
| `account:steam` | The integrated Steam service. Read only: the widget never calls a trade route (`IEconService`), and PlayerVox OverCrow refuses any route outside the read interfaces of the player and the games |
| `network` | Six `GET` routes of `https://api.steampowered.com` (below); the store image of a game on two Steam image hosts; the icons of achievements and games on `https://shared.akamai.steamstatic.com/community_assets/images/apps/`, a `file` parameter (`<name>.jpg`, catalog feature `network-file-param`) |
| `storage` | The profile link, the tracked achievements (three per game, 20 games), the last values shown and the achievement lists of the last three games |

| Route | When |
| --- | --- |
| `ISteamUser/ResolveVanityURL/v1` | When you enter a profile link with a custom name |
| `ISteamUser/GetPlayerSummaries/v2` | Every minute while shown: the game running and the profile's visibility |
| `IPlayerService/GetRecentlyPlayedGames/v1` | When the game changes, then every 10 minutes out of game |
| `ISteamUserStats/GetPlayerAchievements/v1` | Every minute in game, every 10 minutes out of game |
| `ISteamUserStats/GetSchemaForGame/v2` | Once per game and language, then kept |
| `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2` | Once per game and day, without the key |

At worst, in game all day: about 2,880 calls a day, far under the 100,000
of Steam's terms.

**Your Steam key is sensitive.** Besides reading, a Steam Web API key can
read and manage the trade offers of its account. This widget only reads
your game and your achievements, and PlayerVox OverCrow keeps the key on
your computer and sends it only to `api.steampowered.com`. To revoke it:
[steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey), then
"Revoke My Steam Web API Key". Never show that page on stream.

## How it works

- **Rhythm.** One timer a minute. Hidden, the widget calls nothing; shown
  again, it reads once if the last read is older than a minute. A route is
  asked at most once per tick of that timer (one second of slack absorbs
  the delivery of the tick); the list of achievements once per game and
  language, so a language switch reads its names at once; the profile's
  check is the first read.
- **Failures.** A network failure or a timeout retries every minute; a 5xx
  or a 429 waits 1, 2, 4, 8 then 10 minutes (`http.fetch` gives no
  `Retry-After`); a refusal of a game's achievements (403, 400 with an
  error, `success: false`) is asked again every 10 minutes, never in a loop.
  PlayerVox OverCrow's own network budget being full (`busy`) is not a
  failure of Steam: the view stays, the next minute reads again.
- **Hidden details.** Steam answers 403 "Profile is not public" both when
  the game details are not Public and for a game the player does not own.
  A game Steam names as running (`gameid`) means public game details: a
  403 there is the game. A game taken from the last ones played, with no
  running game named, is one the player owns: a 403 there is the hidden
  details. When a running game stops being named, the widget asks at once
  which. What Steam hides is kept, so a new start says it at once.
- **Key and probe.** A 401 or 403 is a refused key only when PlayerVox
  OverCrow's own probe of the key is refused too; otherwise the widget gets
  the status (a 403 on the achievements: see Hidden details).
- **Images.** Steam's answers name an icon by its file name alone or by a
  URL on hosts and paths that changed over the years
  (`steamcdn-a.akamaihd.net`, `media.steampowered.com`,
  `/steamcommunity/public/images/apps/`, `/community_assets/images/apps/`…,
  some redirecting): the widget keeps only the file name and asks
  `shared.akamai.steamstatic.com/community_assets/images/apps/`, the one
  path that serves recent games too, never the URL as given, and never
  follows a redirection. An image that fails is not asked again for an hour; a
  missing achievement icon shows a neutral Lucide icon (`trophy`, `award`,
  `lock`), a missing store image the game's icon, then `gamepad-2`.
- **Large games.** Answers over 64 kB (a game with hundreds or thousands
  of achievements) are read as text by a small JSON scanner, 16 KiB per VM
  turn, 100 ms apart, so no turn nears the VM's budget; the list of a game
  is limited to 2 MiB (games of about 6,000 achievements). The view only
  ever receives the few achievements it shows, chosen without sorting the
  whole list, and memory holds the shown game only.
- **Storage.** The achievement lists of past games are kept within 180 kB
  in all (parts of 20,000 characters, the oldest making room), so the
  profile, the tracked achievements and the last view always fit the
  host's 256 KiB; a larger list stays in memory, a failed write leaves
  nothing behind. A list that misses an achievement Steam reports (the game
  was updated) is read again. The last view is kept so a
  new start shows it at once, as the last game played, until Steam answers.
- **The Steam symbol.** Cut out of Valve's `steam_brandAssets.eps` (through
  PlayerVox OverCrow's `assets/service-logos/steam-symbol.png`), white on the
  dark theme, black on the light one, shown in the widget only (owner's
  decision of 2026-10-14; removed at once if Valve asks: empty
  `STEAM_LOGO` in `logic.ts`). Never in marketing material: the catalog
  preview is captured with the option off.

## Limits

- Game details that are not Public (Friends Only included) hide the game
  being played and its achievements, even from the player's own key: the
  widget says so and where to set them Public.
- Whether a game is borrowed through Steam Families is not shown (that
  needs a route the widget does not use); a borrowed game Steam reads
  shows as any game.
- Games outside Steam are not seen.
- Store images are sometimes missing (recent games name them with a hash
  no route gives): the game's icon replaces them.
- Updated every minute, not live.

## Tests

`node --test tests/*.test.mjs` checks the readers of each route and the
engine on a synthetic Steam (`tests/steam-fake.mjs`). `node
tests/scenarios.mjs` writes the scenarios from one invented account, and
`overcrow-widget test` plays them in PlayerVox OverCrow's headless runtime.
The games, achievements, figures and images of the scenarios and of the
catalog preview are fictional, for demonstration only. Steam's answers in the
fixtures follow those other projects measured in 2026 (`403 Profile is not
public` for hidden game details and for a game the player does not own,
`400 Requested app has no stats`, `{"game":{}}` for a game without
achievements, `{"response":{}}` for hidden recent games); no real key or
account was used.
