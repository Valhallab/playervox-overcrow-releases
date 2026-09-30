# Manual stopwatch

`com.playervox.overcrow.stopwatch` — a stopwatch to the hundredth of a
second, `HH:MM:SS.cc`, started, paused and reset with its buttons or with
OverCrow's global shortcuts. A built-in of OverCrow, written against the
public `@overcrow/sdk` and packaged with `overcrow-widget` like any
creator's widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Zero | `00:00:00.00`, the play button |
| Running | the time advancing to the hundredth, truncated; the pause button |
| Paused | the frozen time, the play button |
| Past 99 hours | hours never wrap: `100:00:00.00` |
| State unknown, no grant, or the service failed | `--:--:--.--`, no buttons, no reminder |

Below the time, a reminder of the host's two shortcuts, in the host's
own words for its platform: `Super+Alt+P  Start / pause  ·  Super+Alt+R
Reset` on Linux, `Ctrl+Shift+P` and `Ctrl+Shift+R` on Windows. In French:
`Démarrer / pause`, `Réinitialiser`. The time uses the interface font with
tabular figures and `.` before the hundredths in both languages.

## Controls

| Mode | Control | Does |
| --- | --- | --- |
| Interactive | Play or pause button ("Start" / "Pause", FR "Démarrer" / "Pause") | `stopwatch.toggle` |
| Interactive | Reset button ("Reset", FR "Réinitialiser") | `stopwatch.reset`: zero, paused |
| Interactive | Enter or Space on a focused button | the same |
| Interactive | Hover or focus a button | tooltip `{label} ({chord})`, e.g. "Start (Super+Alt+P)" |
| Passive | — | no buttons: the time and the reminder only |
| Any | OverCrow's global shortcuts | the host acts on its stopwatch directly; the widget shows the result |

Each button makes one call on its own gesture; the host refuses a call
made outside a gesture (`gesture_required`). The state a command returns
shows at once. A command the host cannot apply (`unavailable`, or
`stale_context` after a game change) changes nothing on screen.

## Menu

No widget row: only the host's rows.

## Permissions

- `stopwatch.read`: the state of the host's single stopwatch and the
  labels of its shortcuts. Not sensitive.
- `stopwatch.control`: start, pause and reset it. Not sensitive. Without
  it the widget shows no buttons.

The widget stores nothing: the host keeps one stopwatch for as long as it
runs, resets it when the game changes, and forgets it when it stops. While
a widget holding `stopwatch.control` is enabled, the host binds the
shortcuts whenever the game has focus, even when the widget is hidden in
Passive mode.

## How it works

`stopwatch.subscribe` gives the state as an anchor, `{ running,
elapsedMs, at, shortcuts }` on the host's monotonic clock, or `null`
without a game. The view's `elapsed` element (`format="hh:mm:ss.cc"`)
shows it and the host advances it, at most at 60 Hz while it is running
and visible: the widget runs no timer and sends nothing while the
stopwatch runs. `shortcuts.bound` is `false` when another application took
a chord; the reminder stays, as before, and OverCrow's Control Center
reports the conflict.

## Tests

- `tests/logic.test.mjs`, `tests/read-only.test.mjs`,
  `tests/refused.test.mjs`: the logic on `@overcrow/sdk/testing`.
- Scenarios with their reference images:
  - `render`: running, with its buttons, in both themes and languages at
    100 and 150 %;
  - `states`: zero, running, paused and reset through the buttons, Passive
    mode, shortcuts seen as updates, Windows chords;
  - `hundredths`: the host's hundredths, truncated, without calls; hours
    past 99; a new anchor; no game;
  - `hidden`, `gesture` (Passive clicks call nothing; a click, Enter and
    Space each make one call), `errors`, `unknown`, `refused`,
    `read-only`.

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU):

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 6.9 ms (p50), 7.0 ms at most | VM ready in 14 ms (p50) |
| VM memory | 0.57–0.58 MiB anonymous | 0.85 MiB private working set |
| Private memory in all (VM, sandbox helpers, overlay share) | about 5 MB | — |
| CPU, paused or hidden | 0.03 % of one core, no frame | — |
| CPU, running and shown | 0.7 % of one core: 59 frames a second of 0.06–0.10 ms | — |
| VM CPU while running | none: the host advances the value | — |

The egui stopwatch it replaces also drew one frame per display refresh
while running (0.04 ms each, painting only) and nothing when paused.
