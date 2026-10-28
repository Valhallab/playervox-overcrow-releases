# Dailies & Weeklies

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
| Header | "Dailies & weeklies", and on the right how many tracked activities are left ("3 to do"), or "All done" in green |
| Today | The Sortie, with its reset ("resets in 6h"): its three mission types, then "Remaining: …" and "1/3" once a stage is done |
| This week | The Archon Hunt (its Archon and mission types, "0/3"), Netracells ("3/5"), the normal Circuit (the week's Warframes) and Nightwave ("This week's challenges"), with the week's reset ("resets in 3d 14h") |
| Done | A green check and the time it was done ("09:12" today, "Tue 21:42" before); a click adds a small hand before the time. Right after a mission, "just now" in green for five minutes, without animation |
| Baro Ki'Teer | One quiet line under the lists: "Baro Ki'Teer arrives Fri 14:00 · Larunda Relay", brighter while he is there ("… at Larunda Relay · leaves Sun 14:00") |
| First run | "Sortie, Archon Hunt and Netracells tick automatically with the overlay open. A click ticks the rest." until the first tick |
| Without the game's missions | "Game not detected: check by hand." (or "Access to Warframe refused" when the permission is refused): everything ticks by a click, and no "0/3" that nothing can count |
| Offline | The last world stays, with "Offline · data from 10:42" when it is more than 15 minutes old |
| Nothing tracked | "No activity tracked", and where to choose some |

Times are local, 24-hour; durations never read as a time of day ("6h",
"3d 14h", "42 min"). The interface is in English and French, the user's
language; the game's names (activities, missions, Archons, relays, Baro
Ki'Teer) come from PlayerVox OverCrow in the game's language, the
activities from its glossary.

**Layouts.** "Full" (default) is 300 points wide; from 560 points, the two
lists sit side by side, Baro under today's. "One line" says "3 to do ·
Sortie resets in 6h", or "Sortie done · 2 to do" right after a mission.

## When an activity ticks itself

With the overlay open, a mission that ends with success ticks:

- a **Sortie** stage or an **Archon Hunt** stage: the stage PlayerVox
  OverCrow gives, or else the rank of the mission's node in the day's
  Sortie or the week's Archon Hunt; all three stages done tick the whole
  activity;
- a **Netracell**, up to five a week.

The Circuit and Nightwave tick only by a click: Warframe does not tell
them. A click in Interactive mode ticks or unticks any activity; unticking
a click goes back to what missions counted.

A tick never undoes itself before its reset. Each event is handled once:
the widget keeps the `at` of the last mission it handled, so after a
restart, when PlayerVox OverCrow repeats the session's events, none ticks
twice. A mission counts only in the period it ended in.

**Resets.** The Sortie at its end (16:00 UTC), the week on Monday 00:00
UTC, as the world gives them; when the world is unknown, the widget
computes the same instants.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents`: `warframe.mission` | A Sortie stage, an Archon Hunt stage or a Netracell ticks when the mission ends with success |
| `gameEvents`: `warframe.world` | The Sortie and Archon Hunt missions, the Circuit's Warframes, Baro Ki'Teer and the resets, game closed or not |
| `storage` | One key, `ticks`: what was done this day and this week, when, and whether by a click (under 1 KB) |

No network: everything comes from PlayerVox OverCrow.

## Options menu

| Row | Values |
| --- | --- |
| Layout | One line, Full (default) |
| Tracked activities | Sortie, Archon Hunt, Netracells, Normal Circuit, Nightwave, Baro Ki'Teer: all on by default. The count in the header counts only the tracked activities |

## Tests

`node --test tests/*.test.mjs` runs the logic on `@overcrow/sdk/testing`
with synthetic values (`tests/fixtures.mjs`): a Sortie in three stages,
Netracells, clicks, the tracked activities, offline, the game not
detected, a whole week of virtual time, a restart, the French wording.

`overcrow-widget test` plays one scenario per state, in English and
French, at 100 % and 150 %, and the wide and one-line layouts: `first-run`,
`mid-week` (also the light theme), `just-detected`, `all-done`,
`new-week`, `offline`, `events-unavailable`, `unknown-name`, `baro-here`,
`refused` and `nothing-tracked`; `week` runs Thursday to Monday in virtual
time with clicks, `restart` repeats a session's events after a restart,
and `preview` captures the catalog preview. The data of the scenarios is
illustrative.
