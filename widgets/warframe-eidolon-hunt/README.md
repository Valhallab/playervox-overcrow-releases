# Eidolon Hunt

`com.playervox.overcrow.warframe.eidolon-hunt` — the timer of each tricap on
the Plains of Eidolon, every capture to the hundredth against your best, and
the night left at Cetus. A PlayerVox widget of the catalog, not a built-in,
not installed by default: written against the public `@overcrow/sdk` and
packaged with `overcrow-widget` like any creator's widget. MIT.

It reads Warframe through PlayerVox OverCrow's
[game events](https://overcrow.playervox.com/docs/en/game-events/): no
network, no account.

Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
them.

## What it shows

A tricap is three Eidolons in a fixed order: Teralyst, Gantulyst, Hydrolyst.
Every screen has one label over one big number, and the night at Cetus.

| State | Shows |
| --- | --- |
| First start | "Night in 41:10" (or "Night left"), and "Your times show during the hunt, a few seconds after each capture." |
| Warframe closed | The night, then "Today: 1 tricap · best 07:32.40 (yesterday)" |
| Away from the Plains | The night, and "Away from the Plains" |
| On the Plains, before a hunt | The night, and "The timer starts at the first spawn." |
| Hunt in progress | The time since the first Eidolon appeared (`06:41`), then the gap to the best after the last capture, in words: "1.78 s behind your best after Gantulyst" in amber, "3.10 s ahead…" in green; then one row per Eidolon: its exact time and its gap, "running" for the one being hunted. The header says "Night 32:14" |
| Dawn near | The header turns amber: "Dawn 2:48", in the last five minutes |
| Tricap | The exact total (`07:15.37`); a new best gets "New best" and its gap to the previous one, otherwise the gap to the best |
| Eidolon killed | "Tricap missed", the timer frozen at its death, "1 capture of 3 · Gantulyst killed"; the next rows stay at "—": a killed Eidolon gives no shard to summon the next one |
| Eidolon gone at dawn | "Tricap missed", the timer frozen on the real duration, "2 captures of 3 · Hydrolyst fled at dawn" |
| Times unreadable | Warframe's Eidolon times cannot be read: the night stays, with "Can’t read your times: restart Warframe." One line: "Night 32:14 · times unreadable", by day "Day 1:39:59 · times unreadable": the phase and the time it has left, short enough for the error beside it |
| Game events not allowed | The night from the last cycle seen, with an alert icon and "Allow “Warframe: Eidolons” in the Control Center.": the user grants game events as a whole, so the widget names the feature it lives on. One line: "Night 32:14 · Access denied" (by day "Day 1:39:59 · …"), or "Access denied · Control Center" before any Cetus cycle is known; its accessible label is the whole sentence. Followed again as soon as the user allows them |

A finished hunt stays on screen for ten minutes, while the player is on the
Plains. Wide (420 px and more), Full shows the past hunts beside it: one
line per day, the last three days, with their tricaps and the best one,
green on the day the best was set.

One line: "06:41 +1.78 · Night 32:14" during a hunt, "Tricap 07:15.37 · New
best" after one, "Night in 41:10" otherwise.

## Permissions

| Permission | Why |
| --- | --- |
| `gameEvents`: `warframe.eidolons` | When each Eidolon appears, is captured, killed or leaves at dawn, to the millisecond |
| `gameEvents`: `warframe.location` | Whether the player is on the Plains, to keep a finished hunt on screen only there |
| `gameEvents`: `warframe.world` | The day and night of Cetus |
| `storage` | Four keys, a few kilobytes: the Eidolons of the current night, the last 30 hunts, the best tricap and the last known end of a night |

## Options menu

| Row | Values |
| --- | --- |
| Layout | Full (default), One line |

## How it works

- **The timer never goes back.** Warframe tells its events about ten
  seconds late, sometimes 26. The big number counts from the first spawn,
  so a capture told late adds an exact row without moving it. Once the
  tricap is over, the frozen total is exact to the hundredth.
- **Which Eidolon.** PlayerVox OverCrow names each Eidolon from the order of
  the hunt; when it cannot tell (`eidolon: null`), the widget names it by
  its position in the tricap. Splits and gaps are compared with the best
  tricap position by position, and a new best with the one it beats.
- **Runs.** A Teralyst starts a tricap; a Gantulyst or a Hydrolyst continues
  the tricap whose previous Eidolon was captured. A tricap ends when the
  Hydrolyst is captured, when an Eidolon is killed (the next one needs the
  shards of a capture), when an Eidolon leaves at dawn, or when the night
  ends. Should an Eidolon appear after a kill all the same, the tricap goes
  on, missed.
- **The night.** The end of the night comes from the world's Cetus cycle
  (150 minutes: 100 of day, 50 of night). The widget keeps the last one it
  saw and counts the cycles from it, so the night left shows even offline.
- **Restarts.** The Eidolons of the night are kept in storage and merged
  with each Warframe session by their spawn time: after Warframe or the
  widget restarts, the hunt goes on with its first spawn and earlier rows.
- **Storage.** Values read back are checked; a value of another shape is
  ignored. The keys keep their names and shapes across versions, so an
  update never loses the best or the past hunts.

## Tests

- `tests/engine-hunt.test.mjs`: a night on the logic, on
  `@overcrow/sdk/testing`: waiting, a hunt with a capture told 26 s late,
  a perfect tricap and the first best, unnamed Eidolons by position, a new
  best against the previous one, a Gantulyst killed, the Hydrolyst gone at
  dawn, then the day.
- `tests/engine-restart.test.mjs`: the stored night, best and past hunts;
  a hunt that goes on after Warframe restarts; the night counted from the
  stored cycle; a run left open at dawn; unreadable times; away from the
  Plains; the bounded history; stored values of another shape.
- Scenarios, one per state, with reference images in French and English, at
  100 % and 150 %, in Full, One line, wide and the light theme; and
  `resumed`, `capture-late`, `refused` and the error lines at their longest
  (`unavailable-day`, `refused-day`, `refused-unknown`). `preview` is the
  marketplace preview.

```sh
node --test widgets/warframe-eidolon-hunt/tests/*.test.mjs
overcrow-widget test widgets/warframe-eidolon-hunt
```
