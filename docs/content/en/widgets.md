# Reference widgets

The built-in widgets of PlayerVox OverCrow are ordinary widgets written with
the public SDK, packaged by `overcrow-widget` and published in the signed
catalog like yours. Their sources live in
[`widgets/`](../../../widgets/) of the public repository, under the MIT
license: read them, copy them, and use them as a starting point.

<!-- generated:widgets -->
| Widget | Description | ID | Permissions | Source |
| --- | --- | --- | --- | --- |
| **Clock** | Shows the local time of day and, optionally, the date, in a 24-hour format. | `com.playervox.overcrow.clock` | none | [widgets/clock/](../../../widgets/clock/) |
| **FPS** | Shows the game’s presented frame rate, when the host has a frame rate source. | `com.playervox.overcrow.fps` | `fps.read` | [widgets/fps/](../../../widgets/fps/) |
| **Media** | The track your music player is playing, with its cover, and previous, play/pause and next buttons in Interactive mode. | `com.playervox.overcrow.media` | `media.read`, `media.control` | [widgets/media/](../../../widgets/media/) |
| **Notes** | Your notes and checklists over the game: up to eight notes, each with free text and a checklist, the same for every game. Read them in Passive mode; in Interactive mode choose, create, delete and edit them in the widget, and tick entries off. They stay on this computer. | `com.playervox.overcrow.notes` | `notes.read`, `notes.write` | [widgets/notes/](../../../widgets/notes/) |
| **Performance** | Game CPU and memory, plus the temperatures this computer exposes. | `com.playervox.overcrow.performance` | `telemetry.read`, `fps.read` | [widgets/performance/](../../../widgets/performance/) |
| **Session journal** | The finished play sessions of your game, newest first: date, start time and duration, five per page. Recorded on your device without an account, merged with your PlayerVox journal when you sync. Delete a session after confirmation. | `com.playervox.overcrow.playervox.journal` | `journal.read`, `journal.delete` | [widgets/playervox-journal/](../../../widgets/playervox-journal/) |
| **My rating** | Your own PlayerVox rating of the Steam game you play: its grade and score, and in Interactive mode three criteria and an optional review to publish or update. Needs your PlayerVox account. | `com.playervox.overcrow.playervox.rating` | `playervox.rating.read`, `playervox.rating.write` | [widgets/playervox-rating/](../../../widgets/playervox-rating/) |
| **Player reviews** | What PlayerVox players think of the game you play: three reviews per page with each player's grade and score, in your language when a translation exists. Limit them to the players you follow from the widget's menu. Needs your PlayerVox account. | `com.playervox.overcrow.playervox.reviews` | `playervox.reviews.read` | [widgets/playervox-reviews/](../../../widgets/playervox-reviews/) |
| **PlayerVox score** | The PlayerVox community grade of your Steam game, with its score, rating count and three criteria. No account needed; the badge is always shown. | `com.playervox.overcrow.playervox.score` | `playervox.score.read` | [widgets/playervox-score/](../../../widgets/playervox-score/) |
| **Session** | Shows how long the current game session has lasted. | `com.playervox.overcrow.session` | `session.read` | [widgets/session/](../../../widgets/session/) |
| **Manual stopwatch** | A stopwatch to the hundredth of a second, started, paused and reset with its buttons or the host’s shortcuts. | `com.playervox.overcrow.stopwatch` | `stopwatch.read`, `stopwatch.control` | [widgets/stopwatch/](../../../widgets/stopwatch/) |
| **Twitch chat** | Read and send messages in a public Twitch chat you choose: your favorite channels, the scrolling history with emotes and replies in Interactive mode, the last messages fading out in Passive mode. Needs your Twitch account. | `com.playervox.overcrow.twitch.chat` | `twitch.chat.read`, `twitch.chat.compose` | [widgets/twitch-chat/](../../../widgets/twitch-chat/) |
| **Warframe Market** | Searches public PC items from a cached catalog, shows the best buy and sell offers of an item, and copies a trade whisper when you click. | `com.playervox.overcrow.warframe.market` | `network`, `storage`, `clipboardWrite` | [widgets/warframe-market/](../../../widgets/warframe-market/) |
<!-- /generated:widgets -->

## What a widget directory holds

- the package sources: `manifest.json`, `view.ocml`, `style.ocss`,
  `logic.ts`, `locales/`, `LICENSE`;
- `listing.json`, its marketplace text;
- `assets/preview.png`, its marketplace preview: a copy of one of its
  reference images;
- `tests/`: unit tests of the logic, and scenarios with reference images in
  both themes, both languages and two scales, played by
  `overcrow-widget test` in OverCrow's headless runtime;
- `README.md`: what it shows, its menu, its permissions, how it works and
  what it costs.

## What each one shows

| To see how to… | Read |
| --- | --- |
| tick at each minute or second of local time, follow a menu option | Clock |
| subscribe to a service and show a missing value | FPS, Session |
| lay out a list of values in a grid, hide a menu row the machine cannot serve | Performance |
| show an image handed by OverCrow, retry a subscription that ended | Media |
| command a service on a user action, let OverCrow advance a duration | Manual stopwatch |
| edit text through a form bound to a write intent, keep drafts | Notes, My rating |
| draw on a canvas | PlayerVox score, My rating |
| page through a service and react to a revision | Player reviews, Session journal |
| keep a long scrolling list at its end, send a message | Twitch chat |
| call an HTTP API, cache it in storage, copy to the clipboard | Warframe Market |

Warframe Market is not a built-in: a PlayerVox widget of the catalog,
installed on request, it shows network routes with a declared response
bound, storage for a cached catalog and a clipboard copy on a click.

## Work on one

From a checkout of the repository, link the SDK of that revision into the
widgets, then check one, package it and run its unit tests:

```sh
node scripts/prepare-widgets.mjs
overcrow-widget check widgets/clock
overcrow-widget package widgets/clock
node --test widgets/clock/tests/logic.test.mjs
```

`prepare-widgets.mjs` needs the SDK built first (`npm ci` then
`npm run build` in `sdk/`). The four templates of `overcrow-widget init`
are in [`templates/`](../../../templates/), and two complete examples
written for these pages in
[`docs/content/examples/`](../examples/): `weather` calls an HTTP API and
`countdown` uses a timer, a canvas, a context menu and storage.
