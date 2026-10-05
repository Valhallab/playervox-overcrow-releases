# Changelog of `@overcrow/sdk`

The SDK follows [semantic versioning](https://semver.org/): within 1.x, no
export is removed or changed incompatibly, and a widget written against
1.x keeps building with a later 1.x. Each widget package bundles the SDK
version it was built with, so a new SDK never changes a published widget.
An incompatible change would be 2.0.0. Every 1.x release needs the VM's
runtime surface 0.1, which OverCrow keeps for widget API v1.

## 1.0.0

First release on npm, for widget API v1 and OverCrow 0.6.0-beta.1 or later.
OverCrow itself is still in beta; the SDK's API is not.

- The state of a widget (`state`, `initState`, `WidgetState`) and the view
  table that the CLI generates (`registerView`).
- Host data: `host` (locale, messages, theme, region, scale, viewport…),
  `onHost`, `hasGrant`, and the options menu (`option`, `onMenu`).
- Typed services and their permissions: `storage`, `http`, `clipboard`,
  `gameEvents`, `session`, `telemetry`, `fps`, `media`, `stopwatch`,
  `notes`, `journal`, `playervox` (score, rating, reviews) and `twitch`
  chat, plus the generic `call` and `subscribe`, `ServiceError` and the
  generated parameter and result types of every service.
- Timers on the VM's clock: `timers.after`, `every` and `atEach`, the
  last aligned on second, minute, hour and day boundaries.
- Canvas drawing (`draw`), messages (`t`) and logs (`log`).
- Dates, times, numbers and durations without `Intl`: `formatTime`,
  `formatDate`, `formatNumber`, `formatDuration`, `localTime`,
  `delayToNext`, following the user's region settings.
- The generated types of the schema: tokens, icons, events, draw commands,
  capabilities and limit constants.
- `@overcrow/sdk/testing`: a stand-in of the runtime with virtual time, for
  unit tests of widget logic in Node.js. It is never bundled into a widget.
- License: MIT-0. A bundled copy needs no notice.

Documentation: [SDK reference](https://overcrow.playervox.com/docs/en/sdk/),
[the logic](https://overcrow.playervox.com/docs/en/logic/),
[testing a widget](https://overcrow.playervox.com/docs/en/testing/).
