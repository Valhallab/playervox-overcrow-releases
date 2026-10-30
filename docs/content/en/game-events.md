# Game events

A PlayerVox OverCrow widget can follow what happens in a game: the mission
the player is in, the wave, the squad, the Eidolons of the night. The
widget lists the features it wants in its manifest, and PlayerVox OverCrow
gives it their state, ready to show: the game's names in the game's
language beside stable IDs, times in Unix milliseconds, durations in
seconds. Warframe is the first game.

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
| `session` | `{ startedAt, language }`: when Warframe was launched, in Unix milliseconds, and the game's language (`en`, `fr`, `de`…; `null` until the game says it); `null` before any launch. Each launch is a new session. |
| `glossary` | Words of the game, in the game's language, always given: see [Glossary](#glossary). |
| `features` | The status of each feature: `location`, `mission`, `progress`, `squad`, `eidolons`, `world` and `rewards`. |
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
| `warframe.mission` | The mission chosen, loading, in progress or ended: node, planet, type, faction, enemy levels, Void Fissure era, modifiers, result, duration, and at the end the rotations earned and the credits. |
| `warframe.progress` | The progress of the mission: wave and its enemies, rounds, the rotations earned, the rotation of the next reward and when it comes. |
| `warframe.squad` | The names of the player and of their squad. |
| `warframe.eidolons` | Night and day on the Plains of Eidolon, and each Eidolon of the night: spawn, weak points, capture, kill or escape, to the millisecond. |
| `warframe.world` | The world of the day and the week: the Sortie, the Archon Hunt, the Void Fissures, the cycles of the open worlds, Baro Ki'Teer and the resets. |
| `warframe.rewards` | What the mission can reward, by table and rotation, with each item's chance (`info.mission.rewards`). |

### When the data comes

- `location`, `mission`, `progress`, `squad` and `eidolons` work only while
  Warframe is the active game in PlayerVox OverCrow (`playing` is `true`).
  When Warframe closes, `playing` becomes `false` and `location` `null`;
  the other members keep their last values until the next session.
- `world` comes from Warframe's public world state. PlayerVox OverCrow
  reads it every 5 minutes while a widget that follows it runs, whether
  Warframe is played or not. `updatedAt` says when it was read.
- `rewards` comes from Digital Extremes' official drop tables, read once a
  day and at each game update while a widget that follows it runs. It
  follows the mission of `info.mission`. To tell a Sortie's mission from
  an Archon Hunt's, PlayerVox OverCrow also reads the world state then;
  only a widget that follows `warframe.world` gets it.
- Warframe writes what happens with a delay. Measured on Linux (Proton):
  most events reach the widget about a second after they happen; the game
  sometimes holds lines back, and a chosen mission or the start of a
  Defense can come 5 to 50 seconds late, a reward up to about 15 seconds.
  Not measured on Windows yet. The times stay exact to the millisecond;
  only the update comes later. Count down from the times, such as
  `nextRewardAt`, not from the moment an update arrives.
- When PlayerVox OverCrow starts during a Warframe session, it catches up
  the session from its start: `info` at once, and the latest events with
  their real times.

### `info`

Named things are `{ id, name }`: our stable ID, and the name in the game's
language. A node is `{ id, name }`; see
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
| `node` | The node: `{ id, name }`. |
| `planet` | Its [planet or region](#planets-and-regions). |
| `type` | The [mission type](#mission-types); `null` for a type not in the list. |
| `faction` | The enemy [faction](#factions). |
| `enemyLevel` | `{ min, max }`: the enemy levels. Chosen, the node's (on the Steel Path, plus 100); a Nightmare, Arbitration, Alert or Kuva Lich mission's are `null` until it loads, then the game's. |
| `fissure` | The [era](#void-fissure-eras) of a Void Fissure mission, or `null`. |
| `modifiers` | What changes the mission, at most 8, each `{ id, name, stage }` ([modifiers](#modifiers)), from the moment it is chosen. `stage` is 1 to 3 for a Sortie or an Archon Hunt mission, when known. |
| `selectedAt`, `loadingAt`, `startedAt`, `endedAt` | When it was chosen, began to load, began and ended, in Unix milliseconds; `null` until then. |
| `result` | `succeeded`, `failed` or `aborted`; `null` before the end, or when Warframe did not say. |
| `durationSeconds` | From the start of play to the end, in seconds, to the millisecond. |
| `earned` | The rotations earned, `{ rotations, totals }` as in [`info.progress`](#infoprogress), for a type with rotations; `null` otherwise. Kept after the end, for a recap. |
| `credits` | The credits the end screen counts; `null` before the end, or when the game does not say (an aborted mission). |
| `rewards` | What the mission can reward, for a widget that follows `warframe.rewards` ([rewards](#rewards-warframerewards)); `null` otherwise. |
| `rewardsPending` | `true` while `rewards` is `null` for now: which table applies is not known yet. `false` otherwise. |

`mission_ended` comes with the credits of the end screen, written a moment
after the end: at most 10 seconds of the game later, and without them for
an aborted mission. Its `at` is the end itself. Warframe does not write
which item a reward gave: show the rotations earned and the tables they
come from.

#### `info.progress`

The progress of the latest mission.

| Member | Meaning |
| --- | --- |
| `wave` | The current wave (Defense, Mirror Defense), or `null`. |
| `waveEnemies` | `{ total, left }`: the enemies of the current Defense wave. `total` as the wave announces it; `left` as the game counts them, once all have spawned and then every 10 seconds or so, `0` once the wave is cleared, `null` before. `null` before the first wave. |
| `round` | Rounds done (Interception, Disruption), or `null`. |
| `rewards` | Rotation rewards given so far. |
| `rotation` | `A`, `B` or `C`: the rotation of the next reward; `null` for a type without rotations or one PlayerVox OverCrow cannot count. |
| `earned` | `{ rotations, totals }`: the rotations given, in order (the latest 64), and how many of each, all of them, `{ A, B, C }`. |
| `cycle` | `{ number, rotations, earned }`: the round of rotations of the next reward, 1 for the first, its rotations in order and how many were given; `null` for a Disruption and a type without rotations. See [Rotations](#rotations). |
| `clock` | For a type paid on time (Survival): `waiting` until its clock starts, then `running`; `null` otherwise. |
| `nextRewardAt` | When the next reward comes, in Unix milliseconds, for a type paid on time (Survival) once its clock runs; `null` otherwise. |
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

### Rewards (`warframe.rewards`)

With `warframe.rewards`, `info.mission.rewards` lists what the chosen or
current mission can reward, by table and rotation, never from a table
that is not its own:

```text
{ source: "node" | "arbitration" | "nightmare" | "sortie";
  tables: { kind: "mission" | "caches" | "extra";
            rotation: "A" | "B" | "C" | null;
            items: { id: string; name: string; quantity: number; chance: number;
                     icon: string | null; iconPending: boolean; category: string }[] }[] }
```

- `source` says whose tables, and the title to give them:

  | `source` | Tables | Suggested title |
  | --- | --- | --- |
  | `node` | The node's own. | "Rotation A" … or "End reward" |
  | `arbitration` | Every Arbitration's, A, B and C, in place of the node's. | "Arbitration rewards" |
  | `nightmare` | A Nightmare mission's reward: the rotation of its planet (all three for a Rescue, by objectives done), given once per mission. | "Nightmare mod, once" |
  | `sortie` | The Sortie's reward, without rotation, given after its third mission. | "Sortie reward, after the 3rd mission" |

- `null`, with `rewardsPending` `false`: no table for this mission: a node
  without one (Exterminate, open worlds, events, the Circuit), an Archon
  Hunt, a Netracell or an Alert (Digital Extremes publishes none).
- `null`, with `rewardsPending` `true`: not known yet. A node of the day's
  Sortie or Archon Hunt, chosen, is told apart when it loads; without the
  world state or the drop tables read yet, it waits for them.

- `kind`: `mission` is the mission's own table; `caches` the caches of a
  Sabotage, Exterminate or Hive node; `extra` an additional table of the
  node.
- `rotation`: `null` for a table without rotations.
- In a Void Fissure mission, the node's rewards are still given and the
  relic opens on top: `rewards` stays the node's tables, even when
  `fissure` is not `null`. What a relic gives is not listed.
- `items`, **the rarest first**: from the lowest `chance` to the highest,
  equal chances by English name, the same order in every language. A
  table keeps its 64 rarest items at most. `id` is the English
  name in `snake_case` (`orokin_cell`, `axi_a1_relic_radiant`), stable
  across languages; `name` is shown as is, in the game's language, or in
  English when PlayerVox OverCrow has no translation yet; `quantity` the
  number given at once; `chance` from 0 to 1, the same item's entries of a
  table added together.
- `icon`: the item's image from Digital Extremes' public export, an
  `asset:` handle of a 48 px square (show it with an
  [`image`](elements.md#image), at 24 px for instance). `iconPending` is
  `true` while it may still come: keep its place empty, so that nothing
  moves when it arrives. With `icon` `null` and `iconPending` `false`, no
  image will come (the item has none, or the source cannot be reached):
  show your own icon of its `category` (`relic`, `mod`, `resource`,
  `blueprint`, `warframe_part`, `weapon_part`, `arcane`, `currency`,
  `other`). An image may still arrive later; `iconPending` never comes
  back to `true`.
- **Source**: Digital Extremes' official drop tables
  (warframe.com/droptables), read by PlayerVox OverCrow on the player's
  computer once a day and at each game update, while a widget that follows
  `warframe.rewards` runs. Show the source with the rates, in these
  words: **"Rates: Digital Extremes, no guarantees"** (in French: **« Taux :
  Digital Extremes, sans garantie »**).
- **Images**: Digital Extremes' public export (content.warframe.com),
  downloaded by PlayerVox OverCrow on the player's computer, once for each
  item a widget shows, and kept there. Nothing is shipped in a widget.

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

- **Rotations**, from the rewards given, in the missions where PlayerVox
  OverCrow sees them; see [Rotations](#rotations).
- **The next reward.** `nextRewardAt` in Survival: every 5 minutes of the
  mission's clock, which starts once the alarm panel is hacked: until
  then `clock` is `waiting` and `nextRewardAt` `null`. The clock starts
  3.6 seconds after the game's endless state (measured on one Survival),
  then each reward sets it again from the game's own clock.
  `nextRewardWave` in Defense: every 3 waves; in Mirror Defense, every 2.
- **The duration** of a mission, from the start of play to the end.
- **Which Eidolon.** Teralyst, Gantulyst or Hydrolyst, told by the order
  of the hunt; `null` when the order cannot tell.
- **The stage of a Sortie or an Archon Hunt mission**, only for a widget
  that also follows `warframe.world`; otherwise `stage` is `null`.
- **The resets**, at 00:00 UTC each day and on Monday.

### Rotations

| Mode | A reward | Rotations |
| --- | --- | --- |
| Survival | every 5 minutes | A, A, B, C, then again |
| Defense | every 3 waves | A, A, B, C, then again |
| Mirror Defense | every 2 waves | A, A, B, C, then again |
| Interception | each round | A, A, B, C, then again |
| Void Cascade | every 4 Exolizers | A, A, B, C, then again |
| Disruption | each round | by round and conduits defended (below) |
| Arbitration (Survival, Defense, Interception) | as above | A, A, B, B, then C to the end |

Arbitrations, in the words of the official wiki: "After the first four
rotations (AABB), the Arbitration will continue on the C rotation
endlessly." `cycle` shows them as a first round A, A, B, B, then rounds
C, C, C, C.

Disruption, conduits defended in the round:

| Round | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | A | A | A | B |
| 2 | A | A | B | B |
| 3 | A | B | B | C |
| 4 and after | B | B | C | C |

In a Disruption, `rotation` is what the current round pays with the
conduits defended so far (one at least). Source: the official wiki's
Mission Rewards and Arbitrations pages.

### What is not given

PlayerVox OverCrow does not give the excavators of an Excavation, kill
counts, the progress of Capture, Mobile Defense and Spy missions, the
progress of the Circuit, relics, Nightwave, what Baro Ki'Teer sells, or
which item a reward gave (Warframe does not write it). For those missions,
the mission itself is given, and `progress` keeps `null` counters and a
`null` `rotation`.

- The Orb Vallis cycle, for now: `cycles.vallis` is `null`.

### Names and IDs

- What comes from the game is named in **the game's language**
  (`session.language`), whatever the app's: nodes, planets and items in
  Warframe's 15 languages (from Digital Extremes' public export), our
  other names and the glossary in English and French, in English for the
  game's other languages. Before a session says it, the last language the
  game used, then the app's. The IDs never change; when the game's
  language changes, the same IDs come with the new names. A name is one
  line, at most 128 bytes.
- The widget's own texts stay in the app's language: only the game's
  words follow the game. Never write a game's word yourself: take it from
  the data or from the [glossary](#glossary).
- A name PlayerVox OverCrow does not know yet, such as new content, is
  `null` with its ID: show the ID, or nothing.
- Our IDs are `snake_case` and never change. The lists below give them all,
  with their English names.
- A node keeps the game's own key, such as `SolNode195`: the key that
  public data such as the world state uses.
- The Circuit's rewards have IDs too: their English name in `snake_case`;
  show their `name`.

#### Glossary

`glossary` gives the words of the game a widget shows on their own, in
the game's language, whatever the features the widget follows:
`glossary.damage.corrosive`, `glossary.activity.archon_hunt`,
`glossary.term.reactant`. `glossary.language` is the language of these
words: `fr` or `en` (English for the game's other languages). Its groups:

| Group | IDs |
| --- | --- |
| `damage` | `impact`, `puncture`, `slash`, `heat`, `cold`, `electricity`, `toxin`, `blast`, `corrosive`, `gas`, `magnetic`, `radiation`, `viral` |
| `era` | the [Void Fissure eras](#void-fissure-eras) |
| `fissure` | a Void Fissure of each era, by the era's ID: `lith` is "Lith Fissure" |
| `activity` | `sortie`, `archon_hunt`, `netracells`, `circuit`, `nightwave`, `baro_ki_teer`, `void_fissure`, `arbitration`, `steel_path`, `void_storm` |
| `place` | the [places](#places) |
| `eidolon` | the [Eidolons](#eidolons) |
| `faction` | the [factions](#factions) |
| `cycle` | the [cycle states](#cycle-states) |
| `term` | `reactant`, `relic`, `credits` |
| `icons` | `damage`: each damage type's symbol, by the same IDs |

`glossary.icons.damage.<id>` is the symbol of a damage type from the
official Warframe wiki (wiki.warframe.com), an `asset:` handle of a 72 px
square whose symbol is the middle 64 px: show it at 22 px for a 20 px
symbol. The pale ones (`impact`, `puncture`, `slash`, `radiation`) have a
soft dark halo that keeps them readable on a light background. It is
`null` until PlayerVox OverCrow has it (downloaded once on the player's
computer, read again every 30 days), or while the wiki cannot be
reached: show your own icon in its place.

English names: damage types as their IDs (Impact, Puncture, Slash, Heat,
Cold, Electricity, Toxin, Blast, Corrosive, Gas, Magnetic, Radiation,
Viral); activities Sortie, Archon Hunt, Netracells, The Circuit,
Nightwave, Baro Ki'Teer, Void Fissure, Arbitration, The Steel Path, Void
Storm; terms Reactant, Relic, Credits.

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
| `void_armageddon` | Void Armageddon |
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
| `hollvania_central_mall` | Höllvania Central Mall |
| `maroos_bazaar` | Maroo's Bazaar |
| `iron_wake` | Iron Wake |
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

#### Sortie conditions

| ID | English name |
| --- | --- |
| `energy_reduction` | Energy Reduction |
| `augmented_armor` | Augmented Enemy Armor |
| `augmented_shields` | Augmented Enemy Shields |
| `eximus_stronghold` | Eximus Stronghold |
| `impact_enhancement` | Enemy Physical Enhancement: Impact |
| `puncture_enhancement` | Enemy Physical Enhancement: Puncture |
| `slash_enhancement` | Enemy Physical Enhancement: Slash |
| `heat_enhancement` | Enemy Elemental Enhancement: Heat |
| `cold_enhancement` | Enemy Elemental Enhancement: Cold |
| `electricity_enhancement` | Enemy Elemental Enhancement: Electricity |
| `toxin_enhancement` | Enemy Elemental Enhancement: Toxin |
| `blast_enhancement` | Enemy Elemental Enhancement: Blast |
| `corrosive_enhancement` | Enemy Elemental Enhancement: Corrosive |
| `gas_enhancement` | Enemy Elemental Enhancement: Gas |
| `magnetic_enhancement` | Enemy Elemental Enhancement: Magnetic |
| `radiation_enhancement` | Enemy Elemental Enhancement: Radiation |
| `viral_enhancement` | Enemy Elemental Enhancement: Viral |
| `radiation_hazard` | Radiation Hazard |
| `electromagnetic_anomalies` | Electromagnetic Anomalies |
| `dense_fog` | Dense Fog |
| `fire` | Fire |
| `cryogenic_leakage` | Cryogenic Leakage |
| `extreme_cold` | Extreme Cold |
| `secondary_only` | Secondary Only |
| `shotgun_only` | Shotgun Only |
| `sniper_only` | Sniper Only |
| `assault_rifle_only` | Assault Rifle Only |
| `melee_only` | Melee Only |
| `bow_only` | Bow Only |

#### Bosses

| ID | English name |
| --- | --- |
| `captain_vor` | Captain Vor |
| `vay_hek` | Councilor Vay Hek |
| `sargas_ruk` | General Sargas Ruk |
| `kela_de_thaym` | Kela De Thaym |
| `lech_kril` | Lieutenant Lech Kril |
| `tyl_regor` | Tyl Regor |
| `alad_v` | Alad V |
| `ambulas` | Ambulas |
| `hyena_pack` | The Hyena Pack |
| `jackal` | Jackal |
| `nef_anyo` | Nef Anyo |
| `raptor` | The Raptor |
| `phorid` | Phorid |
| `lephantis` | Lephantis |
| `mutalist_alad_v` | Mutalist Alad V |
| `corrupted_vor` | Corrupted Vor |
| `archon_amar` | Archon Amar |
| `archon_nira` | Archon Nira |
| `archon_boreal` | Archon Boreal |

## Privacy

Game events are not sensitive, the names of the player and of their squad
included. A widget that follows them may also declare the network, so it
may send what it receives to its server. The player sees each feature
before installing the widget, and its privacy policy says what it sends.
See [security](security.md#permissions-and-consent).

The game's images come from Digital Extremes (item images) and the
official Warframe wiki (damage symbols): PlayerVox OverCrow downloads them
itself on the player's computer, without any identifier, and keeps them
there. A widget only receives handles to them.

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
        "node": { "id": "SolNode195", "name": "Hydron" },
        "planet": { "id": "sedna", "name": "Sedna" },
        "type": { "id": "defense", "name": "Defense" },
        "faction": { "id": "grineer", "name": "Grineer" }
      } },
      "event": "mission_loading"
    } } },
    { "expect": { "text": ["Hydron", "Defense"] } },
    { "advance": { "ms": 30000 } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "in_progress" }, "progress": { "wave": 5, "rewards": 1, "rotation": "A", "nextRewardWave": 6 } },
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
  `session`, `features` (a status by feature), `info`, `glossary` and
  `event`.
- `info` members merge into the current state: `{ "state": "ended" }`
  keeps the node given before.
- `event` is a type, or `{ "type": …, "at": …, <state> }`. Without its
  state, the event carries the matching `info` member. Without `at`, its
  time is the scenario's current time.
- The scenario completes what a step leaves out (`null`, `[]`, `0`,
  `false`, or the step's time for a time), numbers the events and keeps
  the latest 16, as PlayerVox OverCrow does.
- Before the first step, Warframe is played, the features the manifest
  lists are `available`, the others `undeclared`, nothing is known, and
  the glossary is in English. `fixtures.subscriptions` may give a whole
  first value instead (without `glossary`, it gets the English one), and a
  `publish` step a whole next one.
- `glossary` merges like `info`: `{ "language": "fr", "damage": { "corrosive": "Corrosif" } }`
  changes those words only. A step's `rewards` are the node's unless it
  gives `source`.
- Images are the scenario's own, drawn for the test: declare them in
  `assets` and name them `fixture:<name>` where a handle goes, as
  `"icon": "fixture:relic"` or
  `{ "icons": { "damage": { "impact": "fixture:impact" } } }` in
  `glossary`. Never put the game's images in a widget.
- Each step is checked when the scenario is read: a value without the
  service's shape is an error with the path of the first wrong member, and
  a step may only touch the features the manifest lists.

In a unit test, `push("gameEvents.warframe.subscribe", value)` sends a whole
value to the logic ([unit tests](testing.md#unit-tests)).
