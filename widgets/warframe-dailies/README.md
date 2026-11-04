# Checklist

`com.playervox.overcrow.warframe.dailies` — what is left to do in Warframe
today and this week, and when each list resets: the Sortie, the Archon
Hunt, Netracells, the Circuit and Nightwave, with Baro Ki'Teer's next
visit. A PlayerVox widget of the catalog, not a built-in: written against
the public `@overcrow/sdk` and its [game events](../../docs/content/en/game-events.md),
and packaged with `overcrow-widget` like any creator's widget. MIT.

Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
Digital Extremes.

## What it shows

| Part | Shows |
| --- | --- |
| Header | "Checklist", and on the right how many tracked activities are left ("3 to do"), or "All done" in green |
| Today | The Sortie, with its reset ("resets in 6h"): a box per stage, named by its mission type, and "1/3" |
| This week | The Archon Hunt (a box per stage, the week's Archon Shard and the Archon beside its name, "0/3"); Netracells (a row of five boxes, "3/5"); the Circuit and the Circuit · Steel Path (the week's Warframes and Incarnon adapters, the picks in a green chip); Nightwave (a box per challenge, Daily, Weekly and Elite, "1/10"); with the week's reset ("resets in 3d 14h") |
| Done | A green check and the text struck through. A finished activity shows the time it was done ("09:12" today, "Tue 21:42" before); right after a game event, "just now" in green for five minutes, without animation. In Passive it folds to its line; in Interactive its boxes stay, to untick |
| Progress | A dotted circle: Warframe showed progress on this challenge during the session |
| By hand | A small hand in the right column where the player set a box against what the game said (a stage, a Netracell, a challenge, the Circuit's pick) |
| Stage types | A Sortie stage whose type the game chooses at loading shows its node and planet in muted grey ("Morax · Europa") until then; before the world is read, "1st mission", "2nd mission"… |
| Baro Ki'Teer | One quiet line under the lists: "Baro Ki'Teer arrives Fri 14:00 · Larunda Relay", brighter while he is there ("… at Larunda Relay · leaves Sun 14:00") |
| Interactive | Every box, every Circuit name and the Circuit's own box is a button; on hover, a Nightwave challenge shows its objective as the game writes it ("Kill 30 Eximus."); a two-line note at the bottom: "Ticks itself while PlayerVox OverCrow runs during play. Played without it? Tick by hand." |
| Without the game's missions | "Game not detected" (or "Allow “Warframe: missions” in the Control Center." when the permission is refused): every box ticks by a click |
| Offline | The last world stays, with "Offline · data from 10:42" when it is more than 15 minutes old; without any world, "Offline", and Nightwave waits: "List when back online" |
| Nothing tracked | "No activity tracked", and where to choose some |

Times are local, 24-hour; durations never read as a time of day ("6h",
"3d 14h", "42 min"). The interface is in English and French, the user's
language; the game's names (activities, missions, Archons, Warframes,
challenges, relays, Baro Ki'Teer) come from PlayerVox OverCrow in the
game's language, the activities from its glossary.

**Layouts.** "Full" (default) is 300 points wide and as tall as its
content; from 560 points, Nightwave sits on the right, the rest on the
left, Baro under both. The panel stops at the frame's largest height
(680 points, 1,020 px at 150 %: it fits a 1080p screen): beyond, the lists scroll in Interactive, and in Passive the
end of Nightwave folds into "+ 3 challenges". "One line" says "3 to do ·
Sortie resets in 6h", or "Sortie done · 2 to do" right after a mission.

## What ticks itself

While PlayerVox OverCrow runs during play:

- a mission that ends with success ticks a **Sortie** or **Archon Hunt**
  stage (the stage PlayerVox OverCrow gives, or else the rank of the
  mission's node), or the next **Netracell**;
- the **Circuit**'s picks the game shows mark the week's Warframe and
  Incarnon adapters;
- a **Nightwave** challenge the game writes complete ticks, and stays
  ticked until the challenge ends, even after the game restarts (its log
  starts again each launch).

The Circuit's own boxes tick only by a click. A click in Interactive mode
sets any box the other way; what the hand set wins, and a tick of the
game never changes it, except for the stages played in order. The
Sortie's and the Archon Hunt's stages done stay the first ones: a click
on a stage done unticks it and every one after it, a click on a stage to
do ticks it and every one before it, and a stage the game ends ticks
every one before it, the hand's unticked ones included, since the game
proves them; the stages after it stay as they are. A Circuit name picks
it or takes it back (one Warframe, two adapters: a new pick beyond
replaces the oldest); the pick by hand stays until the weekly reset.

A tick never undoes itself before its reset. Each event is handled once:
the widget keeps the `at` of the last mission it handled, so after a
restart, when PlayerVox OverCrow repeats the session's events, none ticks
twice. A mission counts only in the period it ended in. The type the game
gives a Sortie stage at loading is kept with the stage until the reset.

**Resets.** The Sortie at its end (16:00 UTC), the week on Monday 00:00
UTC, as the world gives them; when the world is unknown, the widget
computes the same instants. A Nightwave challenge at its own end.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents`: `warframe.mission` | A Sortie stage, an Archon Hunt stage or a Netracell ticks when the mission ends with success |
| `gameEvents`: `warframe.world` | The Sortie and Archon Hunt missions, the Archon Shard, the Circuit's rewards and picks, Nightwave's challenges and their objectives, Baro Ki'Teer and the resets, game closed or not |
| `storage` | One key, `ticks`: what was done this day and this week, when, what the hand set, the Circuit's picks and the stage types told at loading (a few KB) |

No network: everything comes from PlayerVox OverCrow.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line, Full (default) |
| Tracked activities | Sortie, Archon Hunt, Netracells, Normal Circuit, The Circuit · Steel Path, Nightwave, Baro Ki'Teer: all on by default. The count in the header counts only the tracked activities |

## Tests

`node --test tests/*.test.mjs` runs the logic on `@overcrow/sdk/testing`
with synthetic values (`tests/fixtures.mjs`): a Sortie in three stages,
the hand against the game, the stages kept in order, Netracells, the
Circuit's picks, Nightwave challenges completed by the game and their
objectives on hover, a stage type told at loading, the tracked
activities, the wide layout, the Passive fold, the world not read, the
game not detected, a whole week of virtual time, a restart, the French
wording; and, read from the reference captures, the frame that never cuts
the panel and every status icon on its slot's centre.

`overcrow-widget test` plays one scenario per state, in English, French
and French with the game in English, at 100 % and 150 %, in both themes
and modes, and the wide and one-line layouts: `typical-day` (the game's
ticks, then the player's corrections), `sortie-replaced`,
`sortie-learned`, `world-unread`, `offline`, `nightwave-complete`,
`all-done`, `events-unavailable`, `long-list` (the host's scrollbar, the
Passive fold), `tall-week` (taller than the frame), `ordered-stages` (the
stages kept in order by hand and by the game), `nightwave-objective` (a
challenge's objective on hover, in Interactive only), `status-icons`
(every status icon in its slot, at 100 % and 150 %), `baro-here`, `refused` and
`nothing-tracked`; `week` runs
Thursday to Monday in virtual time with clicks, `restart` repeats a
session's events after a restart, and `preview` captures the catalog
preview. The data of the scenarios is illustrative; the Archon Shard's
image is drawn for the tests.
