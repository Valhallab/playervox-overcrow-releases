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
| Mission picked, loading | The node, then the three rotations A, B and C stacked, three rows each, and when C comes ("One rotation every 5 min · C at 20 min") |
| Survival | "Rotation B in **1:48**" and "C in 6:48"; then "Then A at 25 min" before a C, "2 C so far · next C at 60 min" in later cycles. The mission clock in the header |
| Defense | "Waves until B **4**", "This one included · B after wave 15"; the wave in the header |
| Interception, Disruption | "Rotation B at the end of round 3" |
| Progress not given (Excavation, Spy, Capture, Mobile Defense) | The three rotations stacked, with when C comes for Excavation, "Progress not tracked" otherwise: no rotation is made up |
| One reward at the end (Assassination) | "No rotation: one reward at the end" and that table |
| No loot table (Exterminate) | "No loot table for this kind of mission." |
| New node | "Loot not published yet" |
| Void Fissure | The node's table, as in any mission, and "10 reactant per relic" |
| Mission ended | A summary without tables: "4 rotations earned in 20 min 41" and the cycle checked; "Rewards lost 13 min into the mission." after a failure, "Left without extracting" after an abort |
| After the game | The last mission, kept in storage: "Survival · 2 h ago" with the game closed, "last mission" in the next session |
| Errors | Missions not allowed, missions that can't be read, loot unavailable for now |

The cycle A A B C is a row of cells: a check for each rotation earned, the
next one in the accent colour.

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

Warframe tells what happens about 10 seconds late, sometimes 26. The
widget never waits for it: it counts down to `nextRewardAt`, and when that
moment passes it moves on to the next rotation by itself; the late update
then says what it already shows. In Defense, a wave already past the
reward's wave counts as paid. One host timer ticks on the second the
countdown changes, or on the minute for "2 h ago"; none while the widget
is hidden.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents` `warframe.mission` | The mission picked, loading, in progress or ended |
| `gameEvents` `warframe.progress` | The rewards given, the wave or round, when the next reward comes |
| `gameEvents` `warframe.rewards` | The node's tables, by rotation, with each item's chance |
| `storage` | The last mission, in one key (`last`) of a few hundred bytes |

No network.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line ("Mot · B in **1:48**"), Compact (the countdown, the cycle, two rows), Full (default; three columns from 580 px wide) |
| Loot order | Rarest first (default), Most likely first |

## Tests

- `npm test`: the logic (`tests/logic.test.mjs`), on `@overcrow/sdk/testing`:
  the rotation at every boundary (5:00 sharp, wave 5, a reward told 26 s
  late, a relaunched mission, an aborted one), both orders, "+ n more".
- `overcrow-widget test`: one scenario per state and language, each a
  sequence of `gameEvents` steps, with reference images in English and
  French; Full at 100 %, and a few at 150 %, One line, Compact, wide and
  in the most likely order.
