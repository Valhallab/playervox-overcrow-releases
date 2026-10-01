# Reference widgets

The built-in widgets of OverCrow are ordinary widgets written with the
public SDK, packaged by `overcrow-widget` and published in the signed
catalog like yours. Their sources live in [`widgets/`](../../../widgets/),
under the MIT license: read them, copy them, and use them as a starting point.

<!-- generated:widgets -->
| Widget | Description | ID | Permissions | Page |
| --- | --- | --- | --- | --- |
| **Clock** | Shows the local time of day and, optionally, the date, in a 24-hour format. | `com.playervox.overcrow.clock` | none | [clock/README.md](../../../widgets/clock/README.md) |
| **FPS** | Shows the game’s presented frame rate, when the host has a frame rate source. | `com.playervox.overcrow.fps` | `fps.read` | [fps/README.md](../../../widgets/fps/README.md) |
| **Media** | The track your music player is playing, with its cover, and previous, play/pause and next buttons in Interactive mode. | `com.playervox.overcrow.media` | `media.read`, `media.control` | [media/README.md](../../../widgets/media/README.md) |
| **Performance** | Game CPU and memory, plus the temperatures this computer exposes. | `com.playervox.overcrow.performance` | `telemetry.read`, `fps.read` | [performance/README.md](../../../widgets/performance/README.md) |
| **Session journal** | The finished play sessions of your game, newest first: date, start time and duration, five per page. Recorded on your device without an account, merged with your PlayerVox journal when you sync. Delete a session after confirmation. | `com.playervox.overcrow.playervox.journal` | `journal.read`, `journal.delete` | [playervox-journal/README.md](../../../widgets/playervox-journal/README.md) |
| **My rating** | Your own PlayerVox rating of the Steam game you play: its grade and score, and in Interactive mode three criteria and an optional review to publish or update. Needs your PlayerVox account. | `com.playervox.overcrow.playervox.rating` | `playervox.rating.read`, `playervox.rating.write` | [playervox-rating/README.md](../../../widgets/playervox-rating/README.md) |
| **PlayerVox score** | The PlayerVox community grade of your Steam game, with its score, rating count and three criteria. No account needed; the badge is always shown. | `com.playervox.overcrow.playervox.score` | `playervox.score.read` | [playervox-score/README.md](../../../widgets/playervox-score/README.md) |
| **Session** | Shows how long the current game session has lasted. | `com.playervox.overcrow.session` | `session.read` | [session/README.md](../../../widgets/session/README.md) |
| **Manual stopwatch** | A stopwatch to the hundredth of a second, started, paused and reset with its buttons or the host’s shortcuts. | `com.playervox.overcrow.stopwatch` | `stopwatch.read`, `stopwatch.control` | [stopwatch/README.md](../../../widgets/stopwatch/README.md) |
| **Warframe Market** | Searches public PC items from a cached catalog, shows the best buy and sell offers of an item, and copies a trade whisper when you click. | `com.playervox.overcrow.warframe.market` | `network`, `storage`, `clipboardWrite` | [warframe-market/README.md](../../../widgets/warframe-market/README.md) |
<!-- /generated:widgets -->

Each widget directory holds:

- the package sources: `manifest.json`, `view.ocml`, `style.ocss`,
  `logic.ts`, `locales/`, `LICENSE`;
- `listing.json`, its marketplace text;
- `tests/`: unit tests of the logic, and scenarios with reference images in
  both themes, both languages and two scales, played by
  `overcrow-widget test` in OverCrow's headless runtime;
- `README.md`: what it shows, its menu, its permissions, how it works and
  what it costs.

To work on one from this repository, link the SDK of this revision into it,
then check it, package it and run its unit tests:

```sh
node scripts/prepare-widgets.mjs
overcrow-widget check widgets/clock
overcrow-widget package widgets/clock
node --test widgets/clock/tests/logic.test.mjs
```

`prepare-widgets.mjs` needs the SDK built first (`npm ci` then
`npm run build` in `sdk/`). The other built-ins are rewritten one by one on
the same SDK and join this list as they land. Warframe Market is not a
built-in: a PlayerVox widget of the catalog, installed on request, it shows
network routes with a declared response bound, host storage for a cached
catalog and a clipboard copy on a click.
