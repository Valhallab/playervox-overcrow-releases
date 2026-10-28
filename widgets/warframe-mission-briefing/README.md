# Mission Briefing

`com.playervox.overcrow.warframe.mission-briefing` — while a Warframe
mission loads, shows what it is up against and what hurts it: the enemy
faction, the damage types it is weak to and the one to avoid, the enemy
level, and what changes the mission. A PlayerVox widget of the catalog, not
a built-in: written against the public `@overcrow/sdk` and packaged with
`overcrow-widget` like any creator's widget. MIT, free.

Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
Digital Extremes and shows no logo of theirs.

## What it shows

| State | Shows |
| --- | --- |
| No mission | "Pick a mission to see the briefing." (first run, in the orbiter, after a mission) |
| Mission chosen, loading | Node · planet · type on a muted line; the faction (a coloured dot and its name) with the enemy level on the right; "Use" and the faction's two weaknesses as chips with their damage icon; "Avoid: …" with an amber icon for a faction that resists a type. Below a rule, one line per modifier: Steel Path, the Void Fissure and its era ("Collect 10 Reactant from Corrupted enemies", except in a Void Storm), the Sortie and its stage ("Sortie 2/3") with the day's condition, Arbitration ("Drones first · no self-revive"), Archon Hunt, Nightmare, Void Storm, Alert, Kuva Lich |
| Wide (500 px and more, with modifiers) | The modifiers in a column on the right |
| In mission | One line: "Grineer · **Impact, Corrosive**" |
| No advice | An unknown faction ("Unknown enemies") or one without weaknesses: the faction muted and "No advice yet for these enemies." |
| Warframe closed | "Run Warframe to see the briefing." |
| Mission data unavailable | "Mission not found yet." in amber; a failed subscription is retried 30 s later |
| Refused | "Allow “Warframe: missions” in the Control Center." |

Names (nodes, planets, mission types, factions, modifiers, Sortie
conditions) come from PlayerVox OverCrow in the user's language; a name it
does not know yet is left out, never replaced by an ID. The interface is in
English and French.

## Weaknesses

The widget embeds the faction weaknesses of Damage 3.0 (Update 36.0, with
Scaldra and Techrot from Update 38), from the official Warframe wiki's
[overview table](https://wiki.warframe.com/w/Damage/Overview_Table) and
faction pages, checked on 2026-10-28. A weakness is ×1.5 damage taken, a
resistance ×0.5.

| Faction | Use | Avoid |
| --- | --- | --- |
| Grineer | Impact, Corrosive | |
| Corpus | Puncture, Magnetic | |
| Infested | Slash, Heat | |
| Corrupted | Puncture, Viral | Radiation |
| Sentient | Cold, Radiation | Corrosive |
| Narmer | Slash, Toxin | Magnetic |
| The Murmur | Electricity, Radiation | Viral |
| Scaldra | Impact, Corrosive | Gas |
| Techrot | Magnetic, Gas | Cold |

Sub-factions: Kuva Grineer share the Grineer's weaknesses; on Jupiter, where
the Corpus Amalgams fight, the Corpus get Magnetic only, which hurts both;
the Deimos Infested of the Cambion Drift share none with the Infested, so
an Infested free roam on Deimos gets no advice rather than a wrong one. A
faction not in the table gets none either. The table is updated with the
widget when the game changes it.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents`: `warframe.mission` | The chosen mission: node, planet, type, faction, enemy level, Void Fissure era and modifiers, and its state (chosen, loading, in progress, ended) |
| `gameEvents`: `warframe.world` | The day's Sortie, for the condition of the chosen Sortie mission and its stage |

No network, no storage: everything comes from PlayerVox OverCrow.

## Options menu

| Row | Values |
| --- | --- |
| Layout | Full (default): the briefing while the mission is chosen and loads, one line during it. One line: the line all along |

## How it works

- The widget follows `gameEvents.warframe.subscribe` and builds what it
  shows from `info.mission` and `info.world` at each update; it keeps no
  event.
- The briefing opens with the `selected` state, stays through `loading`,
  folds into one line in `in_progress` and gives way to the waiting line
  at `ended`. A mission of an earlier launch of Warframe waits for the next
  choice.
- Warframe tells its events about 10 s late. The waiting line gives no
  order that would contradict the player during that delay.
- Advice is chosen by IDs (`faction.id`, `planet.id`, `type.id`), never by
  a shown name.

## Tests

`npm test` runs the unit tests of the logic (`tests/logic.test.mjs`): the
embedded table against the wiki's, the sub-faction cases, the modifier
lines, the Sortie condition and each state. The scenarios replay Warframe's
game events with `gameEvents` steps and compare each state, in English and
French, at 100 and 150 %, in both themes and the wide layout, to its
reference image:

```sh
overcrow-widget test widgets/warframe-mission-briefing
```
