# Session

`com.playervox.overcrow.session` — how long the current game has been
running, as `HH:MM:SS`. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Running | `01:27:43`; hours never wrap (`25:01:01`, `100:00:00`) |
| Duration unknown, no grant, or the service failed | `--:--:--` |

The duration counts from the start of the game process, on Linux and
Windows alike, truncated to whole seconds.

## Menu

No widget row: only the host's rows.

## Permissions

`session.read`: the duration of the active game session, never its
identity. Not sensitive.

## How it works

`session.subscribe` gives an anchor, `{ elapsedMs, at }` on the host's
monotonic clock; the view's `elapsed` element shows it and the host
advances it at each whole second. The widget runs no timer and sends
nothing while the game runs; a clock change never moves the value. Its
accessible label is "Session time" / "Temps de session".

## Tests

- `tests/logic.test.mjs`, `tests/refused.test.mjs`: the logic on
  `@overcrow/sdk/testing`.
- Scenarios with their reference images: `render` (both themes and
  languages at 100 and 150 %), `unknown`, `ticks` (whole seconds, past 24
  and 99 hours, a new anchor, the end of the game), `hidden`, `refused`.

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU):

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 7 ms at most | — |
| VM memory | 0.56–0.59 MiB anonymous | similar to the Clock's 0.83 MiB private working set |
| VM CPU while the game runs | none: the host advances the value | — |
| Overlay frames | one each second while shown | — |

With the Clock and FPS widgets beside it, the overlay's process grows by
about 2 MB per widget and stays at 0.1 % of one core; nothing runs while
the overlay is hidden.
