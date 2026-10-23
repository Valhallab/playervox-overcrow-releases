# Integrated services

Some services are **integrated** into PlayerVox OverCrow. PlayerVox defines
each of them once: its addresses, how the key or the sign-in is sent, and
the paths a widget may reach. The player connects each one once, in the
**Connected services** page of the Control Center, and every widget that
names it and that the player allows uses that connection. The widget never
sees the key or the token.

Steam and Twitch come first. A widget cannot declare its own account on
them ([Third-party accounts](accounts.md)), nor use one of their addresses
or pages for another account: it names the service.

## Naming a service

<!-- source: docs/content/examples/steam-stats/manifest.json -->
```json
    "accounts": [{ "service": "steam" }],
    "network": [
      {
        "origin": "https://api.steampowered.com",
        "method": "GET",
        "path": "/ISteamUser/GetPlayerSummaries/v2/",
        "queryParams": {
          "steamids": { "type": "slug", "maxLength": 17, "required": true }
        },
        "maxResponseBytes": 16384,
        "account": "steam"
```

- The account's ID is the service's: the permission is `account:steam`, a
  route names it in `account`, and `account.subscribe({ id: "steam" })`
  follows its state.
- Only `scopes`, `required` and `events` ([live events](#live-events-twitch))
  stand beside `service`. The origins, the sending and the key page come
  from PlayerVox's table below.
- Twitch takes `scopes` among those it offers, for example
  `{ "service": "twitch", "scopes": ["channel:read:goals"] }`. The player
  sees what each scope reads.

## Read-only

In this version, integrated services are read-only for widgets:

- every network rule of the widget uses `GET` and targets one of the
  service's origins (its API, its images);
- only the rules on the origins that receive the key or the token name the
  service; image origins never receive it;
- those rules stay on the paths the service allows and never reach a
  refused one (Steam's trades and game server tokens, Twitch's stream key
  and extension secrets). A path parameter counts as any value there.
- on Twitch, each endpoint needs the scope it reads, asked for by the
  widget itself: the connection is shared, and a widget never reaches what
  only another widget's scope opens.

The Twitch chat of PlayerVox OverCrow uses the same Twitch connection,
through its own capabilities: a widget never asks for the chat's scopes.

## One connection, shared

- The player connects a service once, in the Control Center: a key with a
  short guide for Steam, a code for Twitch. Each widget still asks for the
  permission `account:<service>`; removing it from one widget does not
  disconnect the service.
- When a widget asks Twitch for a scope the connection lacks, OverCrow asks
  the player to connect Twitch again.
- Disconnecting a service signs every widget that uses it out
  (`signed_out`). Uninstalling a widget erases nothing of the connection.

The SDK, the errors and the tests work as for any account: see
[Third-party accounts](accounts.md). In a test scenario, `host.accounts`
gives the service's state by its ID: `steam`, or `twitch`, which is
OverCrow's own Twitch account.

## Live events (Twitch)

From PlayerVox OverCrow 0.8.1-beta.1, a widget that names Twitch can receive
its channel's events as they happen instead of reading Helix in a loop. It
lists them in `events`, beside the scopes that read them:

<!-- source: docs/content/examples/live-goal/manifest.json -->
```json
    "accounts": [
      {
        "service": "twitch",
        "scopes": ["channel:read:goals"],
        "events": ["channel.goal.begin", "channel.goal.progress", "channel.goal.end"]
      }
    ],
```

- Each type needs its scope among the widget's `scopes` (table below).
  `events` asks the player nothing more: an event reads what its scope
  already opens.
- A version with `events` needs the catalog feature `twitch-events`: the
  catalog offers it to OverCrow 0.8.1-beta.1 or later, and an older
  application keeps the previous version.
- OverCrow opens one EventSub connection for every widget, on the player's
  own channel. The widget never sees a token or a subscription.

`twitch.events.subscribe` delivers them. Twitch replays nothing that a cut
loses, and updates are coalesced on their way to the widget, so a widget
keeps the last `seq` it handled and reads Helix again when it may have
missed something:

<!-- source: docs/content/examples/live-goal/logic.ts -->
```ts
let lastSeq = 0; // the highest `seq` handled
let live = false;

twitch.events.subscribe({}, (update) => {
  if (!update.ok) return;
  const { state, events } = update.value;
  if (state === "live" && !live) readHelix(); // live again: catch up once
  live = state === "live";
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    if (event.seq > lastSeq + 1) readHelix(); // some were missed
    lastSeq = event.seq;
    apply(event.type, event.data);
  }
});

// While `off`, read Helix as before.
timers.every(20_000, () => {
  if (!live) readHelix();
});
```

- `state` is `live` once OverCrow is subscribed at Twitch to every type the
  subscription asks, `off` otherwise, with `reason`: `connecting`,
  `not_connected` (Twitch is not connected, or its connection lacks a scope
  the widget declares) or `unavailable` (Twitch refused or cannot be
  reached; OverCrow retries).
- `events` repeats the latest events of the subscription, oldest first,
  each `{ seq, type, at, data }`. `seq` counts from 1 for each
  subscription; a gap means events were lost.
- `data` holds the event's fields under Twitch's names (see Twitch's
  EventSub reference), `null` where Twitch sent none; texts and lists are
  cut to fixed bounds. What viewers write is never part of it: a cheer or
  a resubscription comes without its message.
- `types` narrows the subscription to some of the declared types; a type
  the declaration does not list fails with `permission_denied`.
- In a test scenario, `fixtures.subscriptions["twitch.events.subscribe"]`
  gives the first update and a `publish` step the next ones.

| Type | Version | Scope |
| --- | --- | --- |
| `channel.goal.begin`, `channel.goal.progress`, `channel.goal.end` | 1 | `channel:read:goals` |
| `channel.follow` | 2 | `moderator:read:followers` |
| `channel.hype_train.begin`, `channel.hype_train.progress`, `channel.hype_train.end` | 2 | `channel:read:hype_train` |
| `channel.cheer` | 1 | `bits:read` |
| `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message` | 1 | `channel:read:subscriptions` |
| `channel.poll.begin`, `channel.poll.progress`, `channel.poll.end` | 1 | `channel:read:polls` |
| `channel.prediction.begin`, `channel.prediction.progress`, `channel.prediction.lock`, `channel.prediction.end` | 1 | `channel:read:predictions` |

## Reference

### `permissions.accounts` with a service

<!-- generated:integrated-service-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `service` | `steam` \| `twitch` | yes | An integrated service of the table: PlayerVox defines its origins, how the secret is sent, its key page or OAuth client and the paths no widget reaches; the user connects it once and every widget that names it shares the connection. The account's `id` is the service's: the permission key is `account:<service>` and the routes name it in `account`. Only `scopes`, `required` and `events` stand beside it. |
| `scopes` | list of `scope name` ≤ 16 | no | OAuth services only: distinct scopes among those the service offers, all read-only in version 1; default none. |
| `required` | boolean | no | As for a declared account; default `true`. |
| `events` | list of `event type` ≤ 32 | no | A service with live events only (Twitch): distinct types of the service's table, each read by a scope among `scopes`; the host subscribes on the user's own channel and `twitch.events.subscribe` delivers them. Not part of the permission's detail: an event reads what its scope already opens. Needs the feature `twitch-events`. |
<!-- /generated:integrated-service-fields -->

### The services

<!-- generated:integrated-services -->
| Service | Connection | Key or token sent to | Images | Allowed paths | Refused paths |
| --- | --- | --- | --- | --- | --- |
| `steam` | personal key | `https://api.steampowered.com` | `https://avatars.steamstatic.com`, `https://avatars.fastly.steamstatic.com`, `https://avatars.akamai.steamstatic.com`, `https://steamcdn-a.akamaihd.net`, `https://cdn.akamai.steamstatic.com`, `https://shared.akamai.steamstatic.com`, `https://shared.fastly.steamstatic.com` | `/ISteamUser/`, `/IPlayerService/`, `/ISteamUserStats/`, `/ISteamApps/`, `/ISteamNews/` | `/IEconService/`, `/IGameServersService/`, `/IBroadcastService/`, `/ISteamUserAuth/`, `/IAuthenticationService/`, `/ITwoFactorService/`, `/IEconMarketService/`, `/ISteamMicroTxn/`, `/ISteamMicroTxnSandbox/` |
| `twitch` | OAuth sign-in | `https://api.twitch.tv` | `https://static-cdn.jtvnw.net` | `/helix/streams`, `/helix/users`, `/helix/channels`, `/helix/games`, `/helix/games/top`, `/helix/clips`, `/helix/videos`, `/helix/schedule`, `/helix/search/categories`, `/helix/search/channels`, `/helix/chat/emotes`, `/helix/chat/emotes/global`, `/helix/chat/badges`, `/helix/chat/badges/global`, `/helix/goals` (`channel:read:goals`), `/helix/channels/followers` (`moderator:read:followers`), `/helix/hypetrain/status` (`channel:read:hype_train`), `/helix/polls` (`channel:read:polls`), `/helix/predictions` (`channel:read:predictions`), `/helix/subscriptions` (`channel:read:subscriptions`), `/helix/bits/leaderboard` (`bits:read`), `/helix/charity/campaigns` (`channel:read:charity`), `/helix/charity/donations` (`channel:read:charity`), `/helix/channels/ads` (`channel:read:ads`), `/helix/channels/vips` (`channel:read:vips`), `/helix/chat/chatters` (`moderator:read:chatters`) | `/helix/streams/key`, `/helix/extensions/`, `/helix/eventsub/` |
<!-- /generated:integrated-services -->

### Scopes

<!-- generated:integrated-scopes -->
| Service | Scope | What it reads |
| --- | --- | --- |
| `twitch` | `channel:read:goals` | your goals |
| `twitch` | `moderator:read:followers` | your followers |
| `twitch` | `channel:read:hype_train` | your Hype Trains |
| `twitch` | `channel:read:polls` | your polls |
| `twitch` | `channel:read:predictions` | your predictions |
| `twitch` | `channel:read:subscriptions` | your subscribers |
| `twitch` | `bits:read` | your Bits |
| `twitch` | `channel:read:charity` | your charity campaigns |
| `twitch` | `channel:read:ads` | your ads |
| `twitch` | `channel:read:vips` | your VIPs |
| `twitch` | `moderator:read:chatters` | your chatters |
<!-- /generated:integrated-scopes -->
