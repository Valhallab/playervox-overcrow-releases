# FPS

`com.playervox.overcrow.fps` — the frame rate the game presents, observed
from outside the game. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| A reading | `144  FPS` (the unit muted, 12 px semibold) |
| A gap of the capture | the last reading, exactly as it was |
| No reading yet | `—  FPS`, muted |
| Label off | the value alone |

Hovering the widget in Interactive mode shows one sentence, the
measurement status's (`ready`, `waiting`, `unsupported`,
`permission_denied`, `ambiguous`, `events_lost`, `unavailable`).

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Show “FPS” label / Afficher le libellé « FPS » | toggle `show-label` | on |

## Permissions

`fps.read` (not sensitive), and `requires: ["fps"]`: on a machine without a
frame-rate source OverCrow neither starts nor shows the widget, and keeps
its place for when the source comes back.

## How it works

`fps.subscribe` gives `{ fps, stale, status }`; the host keeps the last
value of the game through a gap of its capture until the next one, so the
widget runs no timer and shows the value as it is: a value shown never
disappears and shows no sign of its age (`stale` is not drawn). The
accessible label is "144 frames per second" or "Frame rate unavailable".

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing` (value,
  colour, sentences, labels, updates, the label row).
- Scenarios with their reference images: `render` (both themes and
  languages at 100 and 150 %), `stale` (a reading kept through a gap looks
  unchanged), `unavailable` (the statuses, the
  service stopping), `label`, `refused`.

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU):

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 7 ms at most | — |
| VM memory | 0.55–0.59 MiB anonymous | similar to the Clock's 0.83 MiB private working set |
| VM CPU | one short turn per new reading | — |
| Overlay frames | one per new reading | — |

With the Clock and Session widgets beside it, the overlay's process grows
by about 2 MB per widget and stays at 0.15 % of one core with a reading
each second; nothing runs while the overlay is hidden.
