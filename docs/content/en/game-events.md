# Game events

A PlayerVox OverCrow widget can follow what happens in a game: the mission
the player is in, the wave, the squad, the Eidolons of the night. The
widget lists the features it wants in its manifest, and PlayerVox OverCrow
gives it their state, ready to show: names in the user's language beside
stable IDs, times in Unix milliseconds, durations in seconds. Warframe is
the first game.

<!-- source: docs/content/examples/warframe-mission/logic.ts -->
```ts
let lastSeq = 0;
gameEvents.warframe.subscribe((update) => {
  if (!update.ok) return; // not declared or not granted
  const { features, info, events } = update.value;
  state.ready = features.mission === "available";
  state.node = info.mission?.node.name ?? info.mission?.node.id ?? "";
  state.type = info.mission?.type?.name ?? info.mission?.type?.id ?? "";
  state.wave = info.progress?.wave ?? null;
  state.rotation = info.progress?.rotation ?? null;
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    lastSeq = event.seq;
    if (event.type === "mission_ended") state.lastResult = event.mission.result ?? "ended";
  }
});
```

This is the logic of the mission companion of
[`docs/content/examples/warframe-mission`](../examples/warframe-mission/):
it shows the node, the mission type, the wave, the rotation of the next
reward and how the last mission ended. `info` holds the current state;
`events` says what just happened.

## Declare the features

`permissions.gameEvents` lists the features the widget follows, each
`<game>.<feature>`:

<!-- source: docs/content/examples/warframe-mission/manifest.json -->
```json
  "permissions": {
    "gameEvents": ["warframe.mission", "warframe.progress"]
  }
```

- Each feature once. A widget gets nothing of a feature it does not list.
- The player sees each feature before installing the widget. Like any
  permission, game events can be refused or taken back in the Control
  Center.
- A version that lists a Warframe feature needs the catalog feature
  `game-events-warframe`: the catalog offers it only to a PlayerVox OverCrow
  that has Warframe game events, and an older application keeps the
  previous version.
- Game events are not sensitive: a widget may follow them and also use the
  network, links, the clipboard or an account. See [Privacy](#privacy).
- For the review, each feature is a permission key,
  `gameEvent:warframe.mission`, with its justification
  ([permission keys](cli.md#permission-keys)).

## Follow a game

Each game has one subscription, without parameters:
`gameEvents.warframe.subscribe(listener)`. It gives a value at once, then a
new one at each change of what the widget follows.

| Member | Meaning |
| --- | --- |
| `playing` | `true` while Warframe is the active game in PlayerVox OverCrow. |
| `session` | `{ startedAt }`: when Warframe was launched, in Unix milliseconds; `null` before any launch. Each launch is a new session. |
| `features` | The status of each feature: `location`, `mission`, `progress`, `squad`, `eidolons` and `world`. |
| `info` | The state of each feature the widget follows, ready to show. `null` for the others, and while nothing is known yet. |
| `events` | The latest 16 events of those features, oldest first. |

The status of a feature is one of:

- `available`: PlayerVox OverCrow follows it on this computer.
- `unavailable`: PlayerVox OverCrow cannot follow it, for example when the
  game is not found on this computer or a game update changed what it
  tells. Show what you have, and say the data is missing.
- `undeclared`: the manifest does not list it.

The subscription fails with `permission_denied` when `gameEvents` lists no
`warframe.*` feature or the user did not grant it, and with `busy` when the
widget already has one. The full shapes are in
[result shapes](result-shapes.md#warframeevents).

### Events

Each event is `{ seq, at, type }` with the state its type names: the
mission, the progress, the Eidolon, the member or the place, as it was at
that moment.

- Updates are coalesced, and each one repeats the latest 16 events. Handle
  only the events whose `seq` is above the last one you handled, as the
  example does. `seq` counts from 1 in each subscription.
- `at` is the real time of the moment in the game, in Unix milliseconds.
- To remember an event across restarts, for example to tick a Sortie
  mission once, keep the `at` of the last event you handled in the
  widget's storage, and skip the events at or before it. `seq` starts again
  at 1 after a restart; `at` does not change.

## Warframe

### Features

| Feature | What the widget gets |
| --- | --- |
| `warframe.location` | Where the player is: orbiter, relay, hub, open world, mission or dojo. |
| `warframe.mission` | The mission chosen, loading, in progress or ended: node, planet, type, faction, enemy levels, Void Fissure era, modifiers, result and duration. |
| `warframe.progress` | The progress of the mission: wave, rounds, rewards given, the rotation of the next reward and when it comes. |
| `warframe.squad` | The names of the player and of their squad. |
| `warframe.eidolons` | Night and day on the Plains of Eidolon, and each Eidolon of the night: spawn, weak points, capture, kill or escape, to the millisecond. |
| `warframe.world` | The world of the day and the week: the Sortie, the Archon Hunt, the Void Fissures, the cycles of the open worlds, Baro Ki'Teer and the resets. |

### When the data comes

- `location`, `mission`, `progress`, `squad` and `eidolons` work only while
  Warframe is the active game in PlayerVox OverCrow (`playing` is `true`).
  When Warframe closes, `playing` becomes `false` and `location` `null`;
  the other members keep their last values until the next session.
- `world` comes from Warframe's public world state. PlayerVox OverCrow
  reads it every 5 minutes while a widget that follows it runs, whether
  Warframe is played or not. `updatedAt` says when it was read.
- Warframe tells PlayerVox OverCrow what happens a few seconds late: about
  10 seconds, sometimes 15 to 25. The times stay exact to the millisecond;
  only the update comes later. Count down from the times, such as
  `nextRewardAt`, not from the moment an update arrives.
- When PlayerVox OverCrow starts during a Warframe session, it catches up
  the session from its start: `info` at once, and the latest events with
  their real times.

### `info`

Named things are `{ id, name }`: our stable ID, and the name in the user's
language. A node is `{ id, name, englishName }`; see
[Names and IDs](#names-and-ids).

#### `info.location`

| Member | Meaning |
| --- | --- |
| `kind` | `orbiter`, `relay`, `hub`, `open_world`, `mission`, `dojo` or `other`. |
| `place` | Which one: a hub, a relay or an open world of the [places](#places), or the node of the mission (its key and name); `null` when Warframe does not say. |
| `since` | When the player arrived, in Unix milliseconds. |

#### `info.mission`

The latest mission of the session.

| Member | Meaning |
| --- | --- |
| `state` | `selected` (chosen on the star chart), `loading`, `in_progress` or `ended`. |
| `node` | The node: `{ id, name, englishName }`. |
| `planet` | Its [planet or region](#planets-and-regions). |
| `type` | The [mission type](#mission-types); `null` for a type not in the list. |
| `faction` | The enemy [faction](#factions). |
| `enemyLevel` | `{ min, max }`: the enemy levels of the node, or `null`. |
| `fissure` | The [era](#void-fissure-eras) of a Void Fissure mission, or `null`. |
| `modifiers` | What changes the mission, at most 8, each `{ id, name, stage }` ([modifiers](#modifiers)). `stage` is 1 to 3 for a Sortie or an Archon Hunt mission, when known. |
| `selectedAt`, `loadingAt`, `startedAt`, `endedAt` | When it was chosen, began to load, began and ended, in Unix milliseconds; `null` until then. |
| `result` | `succeeded`, `failed` or `aborted`; `null` before the end, or when Warframe did not say. |
| `durationSeconds` | From the start of play to the end, in seconds, to the millisecond. |

#### `info.progress`

The progress of the latest mission.

| Member | Meaning |
| --- | --- |
| `wave` | The current wave (Defense, Mirror Defense), or `null`. |
| `round` | Rounds done (Interception, Disruption), or `null`. |
| `rewards` | Rotation rewards given so far. |
| `rotation` | `A`, `B` or `C`: the rotation of the next reward; `null` for a type without rotations or one PlayerVox OverCrow cannot count. |
| `nextRewardAt` | When the next reward comes, in Unix milliseconds, for a type paid on time (Survival); `null` otherwise. |
| `nextRewardWave` | The wave of the next reward, for a type paid on waves (Defense); `null` otherwise. |

#### `info.squad`

| Member | Meaning |
| --- | --- |
| `members` | The members, the user included, at most 8, each `{ name, you }`. `name` is the player's name without the platform icon; `you` is `true` for the user. |

#### `info.eidolons`

| Member | Meaning |
| --- | --- |
| `night` | Whether it is night on the Plains, as the player last saw it; `null` before. |
| `hunts` | The Eidolons of the night, oldest first, at most 16. |

Each hunt:

| Member | Meaning |
| --- | --- |
| `eidolon` | Which [Eidolon](#eidolons); `null` when PlayerVox OverCrow cannot tell. |
| `spawnedAt` | When it appeared, in Unix milliseconds. |
| `weakpoints` | Weak points destroyed. |
| `capturedAt`, `killedAt`, `fledAt` | When it was captured, killed, or left at dawn; `null` otherwise. |

#### `info.world`

| Member | Meaning |
| --- | --- |
| `updatedAt` | When PlayerVox OverCrow last read it, in Unix milliseconds. |
| `sortie` | The Sortie of the day, `{ boss, faction, endsAt, missions }`, or `null`. |
| `archonHunt` | The Archon Hunt of the week, `{ boss, endsAt, missions }`, or `null`. |
| `fissures` | The open Void Fissures, the soonest to close first, at most 64, each `{ node, planet, type, era, steelPath, voidStorm, endsAt }`. `voidStorm` is a Railjack Void Storm. |
| `cycles` | `{ cetus, vallis, cambion }`, each `{ state, endsAt }`: day or night at Cetus and on the Plains, warm or cold in the Orb Vallis, Fass or Vome in the Cambion Drift ([cycle states](#cycle-states)); `null` for a cycle PlayerVox OverCrow cannot tell. |
| `resets` | `{ daily, weekly }`: the next daily reset (00:00 UTC) and weekly reset (Monday 00:00 UTC), in Unix milliseconds. |
| `voidTrader` | Baro Ki'Teer's next visit, or the current one, `{ arrivesAt, leavesAt, relay }`, or `null`. What he sells is not given. |
| `circuit` | The Circuit's rewards of the week, `{ normal, steelPath }`, when the world state gives them; `null` otherwise. |

The missions of the Sortie and of the Archon Hunt are
`{ node, planet, type, modifier }`, in order: `modifier` is the condition of
a Sortie mission, `null` in the Archon Hunt.

### Event types

| Type | Feature | Carries |
| --- | --- | --- |
| `mission_selected`, `mission_loading`, `mission_started`, `mission_ended` | `warframe.mission` | `mission` |
| `wave_started`, `reward_given` | `warframe.progress` | `progress` |
| `night_started`, `day_started` | `warframe.eidolons` | nothing more |
| `eidolon_spawned`, `weakpoint_destroyed`, `eidolon_captured`, `eidolon_killed`, `eidolon_fled` | `warframe.eidolons` | `eidolon`: the hunt |
| `member_joined`, `member_left` | `warframe.squad` | `member`: `{ name, you }` |
| `location_changed` | `warframe.location` | `location`: the new place |

`warframe.world` has no events: read `info.world`.

### What PlayerVox OverCrow calculates

Warframe does not tell everything a widget shows. PlayerVox OverCrow
calculates:

- **Rotations.** Counted A, A, B, C, then again, from the rewards given, in
  the missions where PlayerVox OverCrow sees them, such as Survival,
  Defense, Interception and Disruption.
- **The next reward.** `nextRewardAt` in Survival: every 5 minutes, from
  the mission clock. `nextRewardWave` in Defense: every 5 waves.
- **The duration** of a mission, from the start of play to the end.
- **Which Eidolon.** Teralyst, Gantulyst or Hydrolyst, told by the order
  of the hunt; `null` when the order cannot tell.
- **The stage of a Sortie or an Archon Hunt mission**, only for a widget
  that also follows `warframe.world`; otherwise `stage` is `null`.
- **The resets**, at 00:00 UTC each day and on Monday.

### What is not given

PlayerVox OverCrow does not give the excavators of an Excavation, kill
counts, the progress of Capture, Mobile Defense and Spy missions, the
progress of the Circuit, relics, Nightwave or what Baro Ki'Teer sells. For
those missions, the mission itself is given, and `progress` keeps `null`
counters and a `null` `rotation`.

### Names and IDs

- `name` is in the app's language, English or French, and changes with it;
  the IDs do not. A name is one line, at most 128 bytes.
- A name PlayerVox OverCrow does not know yet, such as new content, is
  `null` with its ID: show the ID, or nothing.
- Our IDs are `snake_case` and never change. The lists below give them all,
  with their English names.
- A node keeps the game's own key, such as `SolNode195`: the key that
  public data such as drop tables and the world state use. Its
  `englishName` gives its English name, to match public data in English.
- Bosses, Sortie conditions and the Circuit's rewards have stable IDs too,
  not listed here: show their `name`.

#### Planets and regions

| ID | English name |
| --- | --- |
| `mercury` | Mercury |
| `venus` | Venus |
| `earth` | Earth |
| `mars` | Mars |
| `jupiter` | Jupiter |
| `saturn` | Saturn |
| `uranus` | Uranus |
| `neptune` | Neptune |
| `pluto` | Pluto |
| `ceres` | Ceres |
| `eris` | Eris |
| `sedna` | Sedna |
| `europa` | Europa |
| `void` | Void |
| `phobos` | Phobos |
| `deimos` | Deimos |
| `lua` | Lua |
| `kuva_fortress` | Kuva Fortress |
| `zariman` | Zariman |
| `duviri` | Duviri |
| `hollvania` | Höllvania |
| `dark_refractory` | Dark Refractory |

#### Mission types

| ID | English name |
| --- | --- |
| `assassination` | Assassination |
| `extermination` | Extermination |
| `survival` | Survival |
| `rescue` | Rescue |
| `sabotage` | Sabotage |
| `capture` | Capture |
| `spy` | Spy |
| `defense` | Defense |
| `mobile_defense` | Mobile Defense |
| `interception` | Interception |
| `hijack` | Hijack |
| `hive` | Hive |
| `excavation` | Excavation |
| `infested_salvage` | Infested Salvage |
| `rathuum` | Rathuum |
| `junction` | Junction |
| `pursuit` | Pursuit |
| `rush` | Rush |
| `assault` | Assault |
| `defection` | Defection |
| `free_roam` | Free Roam |
| `disruption` | Disruption |
| `void_flood` | Void Flood |
| `void_cascade` | Void Cascade |
| `orphix` | Orphix |
| `netracell` | Netracell |
| `alchemy` | Alchemy |
| `circuit` | The Circuit |
| `ascension` | Ascension |
| `legacyte_harvest` | Legacyte Harvest |
| `shrine_defense` | Shrine Defense |

#### Factions

| ID | English name |
| --- | --- |
| `grineer` | Grineer |
| `corpus` | Corpus |
| `infested` | Infested |
| `corrupted` | Corrupted |
| `sentient` | Sentient |
| `narmer` | Narmer |
| `murmur` | The Murmur |
| `scaldra` | Scaldra |
| `techrot` | Techrot |
| `tenno` | Tenno |

#### Void Fissure eras

| ID | English name |
| --- | --- |
| `lith` | Lith |
| `meso` | Meso |
| `neo` | Neo |
| `axi` | Axi |
| `requiem` | Requiem |
| `omnia` | Omnia |

#### Places

Hubs, relays and open worlds: `location.place` and `voidTrader.relay`.

| ID | English name |
| --- | --- |
| `drifter_camp` | Drifter's Camp |
| `larunda_relay` | Larunda Relay |
| `vesper_relay` | Vesper Relay |
| `strata_relay` | Strata Relay |
| `kronia_relay` | Kronia Relay |
| `orcus_relay` | Orcus Relay |
| `cetus` | Cetus |
| `fortuna` | Fortuna |
| `necralisk` | Necralisk |
| `sanctum_anatomica` | Sanctum Anatomica |
| `chrysalith` | Chrysalith |
| `plains_of_eidolon` | Plains of Eidolon |
| `orb_vallis` | Orb Vallis |
| `cambion_drift` | Cambion Drift |

#### Eidolons

| ID | English name |
| --- | --- |
| `teralyst` | Teralyst |
| `gantulyst` | Gantulyst |
| `hydrolyst` | Hydrolyst |

#### Cycle states

| ID | English name |
| --- | --- |
| `day` | Day |
| `night` | Night |
| `warm` | Warm |
| `cold` | Cold |
| `fass` | Fass |
| `vome` | Vome |

#### Modifiers

| ID | English name |
| --- | --- |
| `steel_path` | Steel Path |
| `arbitration` | Arbitration |
| `sortie` | Sortie |
| `archon_hunt` | Archon Hunt |
| `nightmare` | Nightmare |
| `void_storm` | Void Storm |
| `alert` | Alert |
| `lich` | Kuva Lich |

## Privacy

Game events are not sensitive, the names of the player and of their squad
included. A widget that follows them may also declare the network, so it
may send what it receives to its server. The player sees each feature
before installing the widget, and its privacy policy says what it sends.
See [security](security.md#permissions-and-consent).

## Testing

In a [scenario](testing.md#scenarios), a `gameEvents` step says what the
game tells, in the words of the service: you never write anything of the
game itself. This is the scenario of the example: a Defense mission loads,
wave 5 starts, then the mission succeeds.

<!-- source: docs/content/examples/warframe-mission/tests/mission.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["No mission yet"] } },
    { "gameEvents": { "warframe": {
      "info": { "mission": {
        "state": "loading",
        "node": { "id": "SolNode195", "name": "Hydron", "englishName": "Hydron" },
        "planet": { "id": "sedna", "name": "Sedna" },
        "type": { "id": "defense", "name": "Defense" },
        "faction": { "id": "grineer", "name": "Grineer" }
      } },
      "event": "mission_loading"
    } } },
    { "expect": { "text": ["Hydron", "Defense"] } },
    { "advance": { "ms": 30000 } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "in_progress" }, "progress": { "wave": 5, "rotation": "A", "nextRewardWave": 5 } },
      "event": "wave_started"
    } } },
    { "expect": { "text": ["Wave 5", "Rotation A"] } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "ended", "result": "succeeded", "durationSeconds": 312.5 } },
      "event": "mission_ended"
    } } },
    { "expect": { "text": ["Last mission succeeded"], "fault": "none" } }
  ]
```

- A step names one game, here `warframe`, and what changes: `playing`,
  `session`, `features` (a status by feature), `info` and `event`.
- `info` members merge into the current state: `{ "state": "ended" }`
  keeps the node given before.
- `event` is a type, or `{ "type": …, "at": …, <state> }`. Without its
  state, the event carries the matching `info` member. Without `at`, its
  time is the scenario's current time.
- The scenario completes what a step leaves out (`null`, `[]`, `0`,
  `false`, or the step's time for a time), numbers the events and keeps
  the latest 16, as PlayerVox OverCrow does.
- Before the first step, Warframe is played, the features the manifest
  lists are `available`, the others `undeclared`, and nothing is known.
  `fixtures.subscriptions` may give a whole first value instead, and a
  `publish` step a whole next one.
- Each step is checked when the scenario is read: a value without the
  service's shape is an error with the path of the first wrong member, and
  a step may only touch the features the manifest lists.

In a unit test, `push("gameEvents.warframe.subscribe", value)` sends a whole
value to the logic ([unit tests](testing.md#unit-tests)).
