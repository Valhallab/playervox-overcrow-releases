# Warframe mission rewards

`com.playervox.overcrow.warframe.mission-rewards` — what the node of your
Warframe mission can give, and when the next rotation comes. A PlayerVox
widget of the catalog, not a built-in: written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

Everything comes from PlayerVox OverCrow's
[Warframe game events](../../docs/content/en/game-events.md): the widget
makes no request of its own. The rates are Digital Extremes' drop tables,
shown with their source: "Rates: Digital Extremes, no guarantees".
Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
Digital Extremes.

## What it shows

| State | Shows |
| --- | --- |
| No mission yet | "Pick a mission" |
| Mission picked, loading | The node, then the three rotations A, B and C stacked, three rows each, and when C comes ("One rotation every 5 min · C at 20 min", "One rotation every 3 waves · C at wave 12") |
| Survival before the panel is hacked | "Waiting for the hack", "Rotation A 5 min after the hack": no countdown before the game starts its own |
| Survival | "Rotation B in **1:48**", then "Then C in 6:48". The mission clock in the header |
| Defense | "Rotation B at the end of wave **9**" on one line, "Now: wave 8 · 14 enemies left" under it; "at the end of **this wave**" on the wave that pays |
| Interception | "Rotation B at the end of round 3" |
| Progress not given (Excavation, Spy, Capture, Mobile Defense, Disruption) | The three rotations stacked, with when C comes for Excavation, "Progress not tracked" otherwise: no rotation is made up |
| One reward at the end (Assassination) | "No rotation: one reward at the end" and that table |
| Arbitration | Its own table: "Arbitration · rotation C"; A, A, B, B, then C for ever |
| Sortie | One table, "Sortie reward", and "One, after the 3rd mission" |
| Nightmare | One table, "Nightmare mod, once" |
| Loot not known yet | "Loot known on loading" (a node of today's Sortie or Archon Hunt, picked) |
| No loot table | "No published loot table for this mission" (Exterminate, Archon Hunt, Alert) |
| New node | "Loot not published yet" |
| Void Fissure | The node's table, as in any mission, and "10 reactant per relic" |
| Mission ended | The recap, one line of facts: the duration, the waves of a Defense, the rotations earned ("A ×6 · B ×3 · C ×3", in green) and the credits. After a failure or an abort: "Rotations lost: A ×2" |
| After the game | The last recap, kept in storage: "Survival · succeeded · 2 h ago" with the game closed, "last mission" in the next session |
| Errors | Missions not allowed, missions that can't be read, loot unavailable for now |

The cycle A A B C is a row of cells, numbered from the second cycle on
("Cycle 2"): the rotations earned filled in green with a check, the next
one outlined in the accent colour. The table of a rotation already earned
says so ("A earned ×3"). Warframe never says which item a rotation gave:
the widget shows the rotations, never an item. Names from the game (node,
type, items, "Credits") come in the game's language; the widget's own
words follow the app's.

Within a mission, the widget never changes size by itself: the table
keeps the height of the node's longest rotation, the countdown its place.
Only the Layout menu changes it.

### Tables

- The rarest first by default: rarity is what players look for. The
  options menu can show the most likely first.
- At most 10 rows (3 per rotation when stacked, 2 in Compact), then
  "+ 6 more at 6.25%", or "+ 11 more, 2.26% to 9.68%" when the hidden rates
  differ. A single hidden row is shown instead. In Interactive mode, a
  click on "+ n more" unfolds the table, "Show less" folds it.
- The quantity apart: "Endo ×200".
- Caches and extra tables, when the node has some, under the mission's
  table with their own title.
- "Rates: Digital Extremes, no guarantees" under every table, in Compact
  too.

### Timing

Warframe tells what happens a little late. The widget never waits for it:
it counts down to `nextRewardAt`, and when that moment passes it moves on
to the next rotation by itself; the late update then says what it already
shows. In Defense, a wave already past the reward's wave counts as paid
(every 3 waves, every 2 in Mirror Defense, as the host's next wave says).
One host timer ticks on the second the countdown changes, or on the
minute for "2 h ago"; none while the widget is hidden.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents` `warframe.mission` | The mission picked, loading, in progress or ended; at the end, the rotations earned and the credits |
| `gameEvents` `warframe.progress` | The rewards given and their cycle, the wave and its enemies, the round, when the next reward comes |
| `gameEvents` `warframe.rewards` | The node's tables, by rotation, with each item's chance |
| `storage` | The last recap, in one key (`last`) of a few hundred bytes |

No network.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line ("Mot · B in **1:48**"), Compact (the countdown, the cycle, two rows), Full (default; three columns from 580 px wide) |
| Loot order | Rarest first (default), Most likely first |

## Tests

- `npm test`: the logic (`tests/logic.test.mjs`), on `@overcrow/sdk/testing`:
  the rotation at every boundary (5:00 sharp, a wave already past, a
  reward told 26 s late), endless cycles (an hour of Survival, 24 waves of
  Defense, an Arbitration), the wait for the hack, the loot's sources, the
  recap, both orders, "+ n more".
- `overcrow-widget test`: one scenario per state, in English, in French,
  and with the app in French and the game in English; a real Survival and
  a real Defense step by step. Full at 100 %, and a few at 150 %, One
  line, Compact, wide, light theme and in the most likely order.
