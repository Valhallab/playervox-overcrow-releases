# Clock

`com.playervox.overcrow.clock` — the local time of day and, optionally, the
date on a second line. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Default | `14:08` over `17/07/2026` |
| Seconds on | `14:08:42` |
| Date off | the time alone |
| Date format | `dd/mm/yyyy` (default), `yyyy-mm-dd` or `mm/dd/yyyy`, whatever the user's regional date order |

Always 24-hour and zero padded, in English and French alike. The time is
local: the VM's clock is UTC, and the SDK applies the host's UTC offset
(`host.region`), which the host sends again at each summer time change.

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Show seconds / Afficher les secondes | toggle `show-seconds` | off |
| Show date / Afficher la date | toggle `show-date` | on |
| Date format / Format de date | choice `date-format`, shown while the date is | `day-month-year` |

## Permissions

None. The widget reads no service.

## How it works

- `timers.atEach("minute" | "second", tick)`: one repeating host timer
  aligned on the local boundary, one VM turn per tick; a tick that drifted
  re-aligns it. No tick while hidden; the time is current at once when the
  widget is shown again.
- `onHost`: a menu change re-arms the timer at the new unit at once, and a
  new UTC offset shows at once.
- The accessible label is "Local time {time}, {date}" /
  "Heure locale {time}, {date}".

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing` (formats,
  defaults, the timer and its re-arming).
- Scenarios, played by `overcrow-widget test` in OverCrow's headless
  runtime, with their reference images: `render` (both themes and
  languages at 100 and 150 %), `options` (each menu row), `ticks` (minutes,
  seconds, midnight), `hidden`, `summer-time` (both changes).

```sh
node ../../scripts/prepare-widgets.mjs
overcrow-widget check && overcrow-widget package
node --test tests/*.test.mjs
overcrow-widget test --runtime <overcrow-widget-headless>
```

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU):

| | Linux | Windows (VM) |
| --- | --- | --- |
| VM start (spawn → ready) | 1.9 ms | 13.5–14.5 ms, sandboxed |
| Widget start, warm, into the overlay's runtime | 7 ms at most | — |
| VM memory | 0.55 MiB anonymous | 0.83 MiB private working set |
| VM CPU per tick, seconds shown | about 95 µs, one VM turn | — |
| Overlay frames | one each minute (each second with seconds) | — |

With the Session and FPS widgets beside it, the overlay's process grows by
about 2 MB per widget and stays at 0.1 % of one core; nothing runs while
the overlay is hidden.
