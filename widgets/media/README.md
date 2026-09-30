# Media

`com.playervox.overcrow.media` — the track a music or video player of this
computer is playing: its cover, its title in bold and its artists, and in
Interactive mode the player's previous, play/pause and next buttons. A
built-in of OverCrow, written against the public `@overcrow/sdk` and
packaged with `overcrow-widget` like any creator's widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| A track | the square cover, the title in bold, the artists below it |
| Playing / paused or stopped | the middle button shows pause ("Pause") / play ("Play", FR "Lire"); nothing else differs |
| No cover, or it is loading | a raised square with a music note in its place |
| No artist | the artist row is left out; the cover shrinks to the title's height |
| No title | "Unknown title" / "Titre inconnu" |
| No player | "No active media" / "Aucun média actif", with the cover's placeholder |
| The player went away | the same: the previous track is gone at once |
| The media source failed | "No active media" and, below it, "Media is temporarily unavailable." / "Le média est temporairement indisponible."; the widget asks again 5 s later |
| No permission | "No active media": the widget asks OverCrow nothing |

- The cover is square, cropped to its centre, with 6 px corners, as tall as
  the title and artist rows beside it and centred on them.
- Title and artists stay on one line each; line breaks in the player's text
  become spaces. Several artists are joined with ", ".
- A title wider than its column scrolls back and forth: it waits 2 s,
  travels at 18 px/s (scaled with the content) until its end shows, waits
  2 s, travels back. It restarts on a new title or a new width, and does
  not move while the widget is hidden. With "Scroll long titles" off it
  ends with an ellipsis. The artists never scroll: they end with an
  ellipsis, and hovering them shows them whole.
- The title's accessible name is the whole, unscrolled title; the cover and
  its placeholder are "Cover artwork" / "Pochette".
- The width is the one you set: a long title never widens the widget. The
  height follows the content, and Passive mode, without buttons, is lower.

The player's text is shown as it comes, in any language; only the widget's
own messages and labels follow OverCrow's language.

## Controls

| Mode | Control | Does |
| --- | --- | --- |
| Interactive | Previous ("Previous" / "Précédent") | `media.previous` |
| Interactive | Play or pause ("Play" / "Lire", "Pause") | `media.playPause` |
| Interactive | Next ("Next" / "Suivant") | `media.next` |
| Interactive | Enter or Space on a focused button | the same |
| Interactive | Hover or focus a button, the title or the artists | its tooltip |
| Passive | — | no buttons, no tooltips: the track only |

A button shows only when the player offers its action: it is left out, not
greyed. Each click is one call, on its own gesture (OverCrow refuses a call
made outside one, `gesture_required`), and names the player shown. The
player's new state arrives with the next update; a call OverCrow cannot
apply — another player took over (`stale_context`), the player dropped the
action (`unsupported`), no player (`unavailable`) — changes nothing on
screen.

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Show cover artwork / Afficher la pochette | toggle `show-cover` | on |
| Scroll long titles / Faire défiler les titres longs | toggle `scroll-title` | on |

With the cover off, the cover's slot goes, and the widget asks OverCrow for
no cover: OverCrow then reads no cover file and contacts no image server
for it.

## Permissions

- `media.read`: the current player's title, artists, playing state, the
  actions it offers, and its cover as an image OverCrow decoded. Sensitive:
  it tells what you listen to.
- `media.control`: previous, play/pause and next. Sensitive. Without it the
  widget shows no buttons.

As sensitive capabilities rule out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing.

## Platforms

| | Linux | Windows |
| --- | --- | --- |
| Source | MPRIS players on the session bus | the system's current media session |
| Which player | the playing one, else a paused one, else a stopped one; on a tie the first by bus name | the one Windows shows as current |
| Artists | up to 8, joined with ", " | the one text the player gives |
| Cover | the player's art URL: a local file in a cache, music or temporary folder, or an image from Spotify, YouTube or Tidal | the session's thumbnail |

OverCrow runs its media source only while a widget subscribes, and loads
covers only for a widget that asks for them. It hands the widget a cover
of at most 256 px as an `asset:` handle: the widget never sees a URL, a
file path or a player's bus name. The same values give the same pixels on
both systems.

## How it works

`media.subscribe({ cover })` gives `null` without a player, or `{ player,
title, artists, playing, canPrevious, canPlayPause, canNext, cover }`;
`player` is an opaque ID the buttons pass back. The view draws `cover` with
an `image` and the title with `text-overflow: marquee`: OverCrow measures,
scrolls and holds it, so the widget runs no timer and sends nothing while a
title scrolls. When OverCrow's media source fails, the subscription ends
with `unavailable`; the widget shows it and subscribes again after 5 s,
which restarts the source.

## Tests

- `tests/logic.test.mjs`, `tests/refused.test.mjs`: the logic on
  `@overcrow/sdk/testing`.
- Scenarios with their reference images, covers drawn by
  `tests/assets/generate.mjs` (synthetic images, no real album art):
  - `render`: a playing track with its cover and buttons, in both themes and
    languages at 100 and 150 %, and in Passive mode;
  - `states`: no player, paused, no artist, unknown title (EN, FR), only
    play/pause, no button, no cover (dark, light), the player gone;
  - `covers`: a square cover, a wide one cropped to its centre, a new
    track's cover, the cover option off and on (and the subscription it
    makes);
  - `marquee`: the pause at the start, the travel, the pause at the end, the
    way back, the ellipsis with the option off, 150 %;
  - `gesture`: Passive clicks call nothing; each button by click, Enter and
    Space, with its player; refusals; a tooltip;
  - `unavailable`: the failure's message (EN, FR), the new subscription
    5 s later and the player it brings;
  - `refused`, `read-only`.

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU),
at 320 px wide with a 256 px cover:

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 6.9 ms (p50), 8.0 ms at most | VM ready in 14 ms (p50) |
| VM memory, cover included | 0.64 MiB private, 0.82 MiB PSS: the VM holds the cover's handle, not its pixels | 0.90 MiB private working set, 1.18 MiB private commit |
| Private memory in all (VM, sandbox helpers, overlay share with the cover) | under 7 MB | — |
| CPU, a track held | 0.03 % of one core, no frame | — |
| CPU, a long title scrolling | 0.15 % of one core: one frame per physical pixel it moves (18 a second at 100 %), 0.07 ms each, none during its pauses | — |
| CPU, a new track and cover every 2 s | 0.05 % of one core: one frame per track | — |
| VM CPU | one short turn per track; none while a title scrolls | — |

The egui widget it replaces repainted a scrolling title at 30 Hz (0.04 ms
each, painting only), inside the overlay's own process, and OverCrow polled
the players every second whatever the widgets showed.
