# Performance

`com.playervox.overcrow.performance` — the game's CPU share and memory, the
temperatures of this computer's CPU and GPU, and the game's frame rate. A
built-in of OverCrow, written against the public `@overcrow/sdk` and
packaged with `overcrow-widget` like any creator's widget. MIT.

## What it shows

One row per metric, in this order, as a two-column list (vertical, the
default) or on one line separated by `·` (horizontal):

| Row | EN / FR label | Value | Amber | Red |
| --- | --- | --- | --- | --- |
| Game CPU | CPU | share of all logical processors, `23.0 %`, at most 100 | ≥ 80 % | ≥ 95 % |
| Game memory | RAM | resident memory in binary gigabytes, `3.0 GB` | never | never |
| CPU temperature | CPU TEMP / TEMP CPU | `61.0 °C` or `141.8 °F` | ≥ 80 °C | ≥ 90 °C |
| GPU temperature | GPU TEMP / TEMP GPU | the same | ≥ 80 °C | ≥ 90 °C |
| Frame rate | FPS | an integer, `144` | never | never |

- A row shows only when its menu toggle is on **and** OverCrow has a
  reading: no dash, no "N/A". The first sample after the game starts has
  no CPU share yet; the row appears a second or two later.
- Temperatures compare with their thresholds in °C, even when shown in
  °F, and convert before rounding.
- A frame rate without a new sample for 3 s keeps its number, followed by
  "old" / "ancien".
- Numbers follow the number format of OverCrow's settings, not the
  language: `us` 1,234.5 (the default), `fr` 1 234,5, `de` 1.234,5.
- With nothing to show: "Waiting for game data…" / "En attente des données
  du jeu…"; with every metric switched off: "No metric selected" /
  "Aucune mesure sélectionnée".

Values use the interface font with tabular figures. Hovering a row in
Interactive mode explains it ("Game CPU use across all logical
processors.", "Last FPS reading. …" for an old frame rate…); each value's
accessible name says what it is ("CPU temperature 61.0 °C").

## Platforms

| | Linux | Windows |
| --- | --- | --- |
| Game CPU and memory | every process of the game (same Steam app, or the game and its children) | the attached process only |
| CPU temperature | `k10temp`, `zenpower` or `coretemp` sensors | none: the row and its menu toggle do not appear |
| GPU temperature | `amdgpu` sensors | the graphics driver's reading, when it gives one |
| Frame rate | X11 and XWayland game windows | OverCrow's FPS service |

A sensor OverCrow cannot read, or two sensors of the same kind that
disagree, give no reading: the row stays away.

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Layout / Disposition | choice `layout`: Vertical, Horizontal | Vertical |
| Show CPU / Afficher le CPU | toggle `show-cpu` | on |
| Show RAM / Afficher la RAM | toggle `show-ram` | on |
| Show CPU temperature / Afficher la température CPU | toggle `show-cpu-temperature`, `requires: telemetry.cpuTemperature` | on |
| Show GPU temperature / Afficher la température GPU | toggle `show-gpu-temperature`, `requires: telemetry.gpuTemperature` | on |
| Show FPS / Afficher les FPS | toggle `show-fps`, `requires: fps` | on |
| Temperature / Température | choice `temperature-unit`: Celsius (°C), Fahrenheit (°F) | Celsius |

OverCrow hides a `requires` row while it has no such source.

## Permissions

- `telemetry.read`: the game's CPU share and resident memory, and the
  computer's temperatures. Not sensitive.
- `fps.read`: the game's frame rate. Not sensitive.

The widget stores nothing: its menu values are OverCrow's.

## How it works

`telemetry.subscribe` gives `{ cpu, ram, cpuTemperature, gpuTemperature,
sources }`, or `null` without a game; the host normalizes the CPU share
to the whole machine and keeps each temperature to its sensor's
thousandth of a degree. `fps.subscribe` gives `{ fps, stale, status }`
and marks a value stale itself, so the widget runs no timer. The widget
subscribes to the frame rate only while the FPS row is switched on:
OverCrow measures the frame rate only for a subscriber, so switching the
row off also stops the measurement.

## Tests

- `tests/logic.test.mjs`, `tests/refused.test.mjs`: the logic on
  `@overcrow/sdk/testing` (rows and their order, units, thresholds, the
  °F vectors, number formats, the stale marker, messages, the menu and
  the FPS subscription).
- Scenarios with their reference images:
  - `render`: every row, vertical, in both themes and languages at 100
    and 150 %;
  - `horizontal`: the one-line layout, the same matrix, an old frame rate;
  - `thresholds`: below, amber and red, in both themes, and °F;
  - `fahrenheit`: the conversion vectors and a negative temperature;
  - `region`: the `us`, `fr` and `de` number formats;
  - `stale`: "old" and "ancien", then a fresh value, then none;
  - `sources`: Windows (no CPU temperature), no sensor, the first
    sample without CPU; `no-fps-source`;
  - `waiting`, `menu` (every toggle, both choices, "No metric selected",
    the FPS subscription ending and starting again), `refused`,
    `telemetry-only`.
