# PlayerVox score

`com.playervox.overcrow.playervox.score` — the public PlayerVox community
grade of the Steam game you play: a grade badge (S+ to F), the rounded
overall score out of 100, the game's name on PlayerVox, the rating count
and, if you want, the Gameplay, Art and Technology criteria. No PlayerVox
account is needed. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Rated | the badge, "94 /100", "1,284 ratings", the game's name |
| Not rated yet | a neutral `--` badge, "Not rated yet" / "Pas encore noté", "No ratings yet" / "Aucun vote", the game's name |
| Waiting for PlayerVox | a `--` badge and "Loading…" / "Chargement…": after a game switch, never the previous game's score |
| No game | "Waiting for a game" / "En attente du jeu" |
| A game without a Steam app ID | "Game not linked" / "Jeu non associé", "Steam game required" / "Jeu Steam requis" |
| A game PlayerVox does not know, or cannot tell apart | "Game not found" / "Jeu introuvable", "On PlayerVox" / "Sur PlayerVox" |
| PlayerVox unreachable, busy or failing | "Score unavailable" / "Note indisponible", "Retrying automatically" / "Nouvel essai automatique"; an earlier score is not kept |
| No permission | "Score unavailable": the widget asks OverCrow nothing |

Without a score the title reads "Community rating" / "Note communautaire".
A status's second line shows only with the rating count option on.

- **The badge.** A 56 px rounded square with a black face and a 3 px border
  in the grade's colour, turned by 4° with its letter in the display face.
  `--` is square, grey on a translucent face. S+ has a faint static glow.
  The badge is drawn by the widget in a canvas, from the source it shares
  with PlayerVox Rating ([widgets-shared](../../widgets-shared/README.md)).
- **Grades** come from OverCrow, on the raw score: S+ ≥ 90, S ≥ 80,
  A ≥ 70, B ≥ 60, C ≥ 40, D ≥ 20, else F. 89.6 shows "90" with grade S.
  Numbers round half away from zero (72.5 shows 73).

  | Grade | S+ | S | A | B | C | D | F, `--` |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Colour | `#9ae600` | `#7ccf00` | `#00d3f3` | `#fdc700` | `#fe9a00` | `#e7000b` | `#52525c` |

  The same colours serve both themes: the badge keeps its black face on a
  light panel.
- **The pulse.** When a score shows or changes (another grade or number),
  the badge grows to 108 % and back once, in 600 ms. OverCrow animates it:
  the widget sends one class change, nothing moves once it ends, and a
  hidden widget draws nothing. A new rating count alone, a status or `--`
  never pulses.
- **The count** uses your number format ("1,284 ratings", FR "1 284 votes"),
  in the singular only for exactly one.
- **The criteria**, 220 px wide: the name, the rounded value or `--` when
  PlayerVox has none (a real 0 shows "0"), and a 3 px bar in the colour of
  that value's own grade.
- **The title** stays on one line, ending with an ellipsis. The PlayerVox
  mark keeps the header's right corner, the title shown or not. Hovering
  the widget shows the game's name, or the status.
- **Accessible names:** the badge "Grade S+, 94/100" / "Note S+, 94/100" or
  "No grade" / "Pas de note"; each bar "Gameplay: 97".
- **Size.** Fitted to its content, 64 to 220 px of content wide (220 with
  the criteria), within the host frame and its 10 × 8 px margin; the badge
  alone is a 64 px square within the frame's 8 px margin.

## Controls

None: no click, no key. In Interactive mode the host moves and resizes the
widget; hovering shows the tooltip.

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Show overall score / Afficher le score global | toggle `show-score` | on |
| Show three criteria / Afficher les trois critères | toggle `show-criteria` | off |
| Show game title / Afficher le nom du jeu | toggle `show-title` | on |
| Show rating count / Afficher le nombre de notes | toggle `show-votes` | on |

No row hides the badge. With every row off, the widget is the badge alone;
set the background opacity to 0 % for the look without a panel (OverCrow
does so when it moves an egui badge-only Score to this widget).

## Permissions

- `playervox.score.read`: the public PlayerVox score of the active game.
  Sensitive: the score and the game's name tell which game you play.

As a sensitive capability rules out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing. OverCrow fetches
the score (`api.playervox.com`, anonymously), refreshes it every five
minutes and on PlayerVox's live updates, and backs off after failures; it
does so only while this widget subscribes.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: the badge's
  commands per grade, one pulse per new score, rounding, the count's
  plural and number format, every state's text, the tooltip's bound, the
  criteria, the options and the retry.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`:

  | Scenario | Covers |
  | --- | --- |
  | `states` | every state, dark English and light French, 100 % and 150 % |
  | `grades` | the seven grades with the criteria, a real 0, missing criteria, rounding, light theme, 150 % in French |
  | `options` | the badge alone (both themes, 150 %), each toggle, a long title, a large count, a single rating |
  | `pulse` | the pulse's peak and end, none for the same score or a status |
  | `unavailable` | the host's source failing, then the new subscription 5 s later |
  | `refused` | no grant: no call, "Score unavailable" |
  | `signed-out` | signed out of PlayerVox: the score, no account panel |

## Cost

Measured on 2026-09-30 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU),
with a rated game and the default rows:

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 8.5 ms (p50), 12.4 ms at most | VM ready in 16–20 ms (p50) |
| VM memory | 0.73 MiB private, 0.91 MiB PSS | 1.08 MiB private working set, 1.36 MiB private commit |
| Private memory in all (VM, sandbox helpers, overlay share) | 6.5–8.6 MB | — |
| CPU, a score held | 0.03 % of one core, no frame | — |
| CPU, a new score and its pulse every 2 s | 0.23 % of one core: about 36 frames of 0.05 ms per pulse, then none | — |
| CPU, hidden, a new score every 2 s | 0.05–0.07 % of one core: no pulse frame | — |
| VM CPU | one short turn per score; none during the pulse | — |

Scores change only when PlayerVox publishes an update or at the five-minute
refresh: the 2 s load is a stress. The egui widget it replaces had no pulse
and painted in the overlay's own process (0.04 ms a frame); OverCrow fetched
the score whenever that widget was enabled, and now only while this widget
subscribes. Scenarios render the same images on Linux and Windows, pixel
for pixel.
