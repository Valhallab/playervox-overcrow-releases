# My rating (PlayerVox Rating)

`com.playervox.overcrow.playervox.rating` — your own PlayerVox rating of the
Steam game you play: its grade badge (S+ to F) and score out of 100, and in
Interactive mode a form with three criteria (Gameplay, Art, Technology) and
an optional review, to publish or update the rating on PlayerVox. It needs
your PlayerVox account. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Rated | the game's name, the badge, "93 /100", "Your published rating" / "Votre note publiée" |
| Not rated yet | the game's name, a neutral `--` badge, "-- /100", "Not rated yet" / "Pas encore noté" |
| Waiting for PlayerVox | a `--` badge and "Loading…" / "Chargement…": after a game switch too, never the previous game's rating |
| No game | "Waiting for a game" / "En attente du jeu" |
| A game without a Steam app ID | "Game not linked" / "Jeu non associé", "Steam game required" / "Jeu Steam requis" |
| The rating cannot be read | "Rating unavailable" / "Note indisponible", "PlayerVox is unavailable for this game right now." |
| Offline | the last rating read; OverCrow adds its own notice under the content |
| No account, a sign-in in progress, an expired session | nothing of the widget: OverCrow covers it with its account panel (link or create an account, reopen the browser, cancel) |
| No permission to read | "Rating unavailable", "Permission needed to read your rating": the widget asks OverCrow nothing |

The score is the mean of the three criteria, rounded half away from zero
(96, 88 and 94 show "93"); the grade is the mean's: S+ ≥ 90, S ≥ 80, A ≥ 70,
B ≥ 60, C ≥ 40, D ≥ 20, else F. The badge and the PlayerVox mark are drawn
from the source shared with PlayerVox Score
([widgets-shared](../../widgets-shared/README.md)); the badge pulses once
when a published rating shows or changes, never for a draft.

In Passive mode the widget shows only the published rating: no form, no
draft.

## The form (Interactive mode)

| Control | |
| --- | --- |
| Gameplay, Art / Artistique, Technology / Technique | sliders from 0 to 100 by 1, their value beside them |
| REVIEW · OPTIONAL / AVIS · FACULTATIF | a text area, "What stood out to you?", at most 2000 characters |
| The button | "Publish my rating" before the first rating, "Update my rating" after; "Saving…" while OverCrow sends it; "Saved on PlayerVox" once stored, until the next change |

- **The form is OverCrow's.** Its sliders and its review are host-owned
  controls of a `form` bound to the `playervox.rating.publish` intent: the
  view gives them no `value`. OverCrow fills them with your published
  rating, or with 50 / 50 / 50 and an empty review before the first one,
  and tells the logic each value through the control's `input` event. The
  logic only follows them, to show the draft's mean and to know whether
  something changed.
- **Publishing** takes your gesture: a click on the button, Enter or Space
  on it, or Ctrl+Enter in the review. OverCrow then sends the values of
  its own controls; the logic never supplies them and cannot submit the
  form itself. An unchanged review is not sent again; an emptied one
  removes the published review.
- **The button is active** when PlayerVox is reachable and there is
  something to send: a first rating, or a change. While the score beside
  the badge is a draft's, the caption reads "Unpublished draft" /
  "Brouillon non publié".
- **The draft is kept by OverCrow**: through Passive mode (the form stays
  in the view, hidden), through a failed publication, and when the rating
  changes elsewhere while you edit. An untouched form follows the new
  rating. Another game, or another PlayerVox user, starts from its own
  rating.
- **Once stored**, the rating comes back through the subscription: the
  widget reads nothing again.
- **Offline**, the form shows "Offline · Your changes stay here until you
  save them." and takes no input.

### When a publication fails

The draft stays, the button comes back, and a message shows above it:

| OverCrow's answer | Message |
| --- | --- |
| `invalid_request` (PlayerVox refused the values, or the game is not released) | "Check the values and try saving again." |
| `not_connected` (the session ended) | "Your connection expired. Link your account again." |
| `busy` (another publication is in flight, or too many requests) | "An operation is already in progress. Please try again shortly." |
| `stale_context` (the game or the account changed meanwhile) | "The account or game changed. Review your changes before saving." |
| `permission_denied` | "This action is not available for your account." |
| `unavailable`, `timeout` (no answer from PlayerVox within 30 s) and any other | "PlayerVox is unavailable for this game right now." |

Should OverCrow give no answer at all, the button comes back after 40 s
with the last message.

## Controls

Tab moves through the three sliders, the review and the button. On a
slider: the arrow keys move by 1, Page Up and Page Down by 10, Home and
End to the ends; a click or a drag on the track sets it. The keyboard goes
to the widget the pointer rests on.

## Menu

No row of its own.

## Size

350 px wide by default, from 280 px; the height fits the content: the
summary alone in Passive mode, the form below it in Interactive mode.

## Permissions

- `playervox.rating.read`: your own rating of the active game, with the
  game's name. Sensitive.
- `playervox.rating.write`: publish a rating and a review through the
  host-bound form. Sensitive.

As sensitive capabilities rule out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing. OverCrow reads
the rating and sends the publication with your PlayerVox session
(`api.playervox.com`); it reads the rating only while this widget
subscribes. With the read permission alone the widget shows the rating and
no form.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: every state's
  text, the draft's mean and rounding, when the button is active, the
  Publish, Saving, Saved cycle, each failure's message, the 40 s bound, one
  pulse per new published rating, the retry of a failed subscription.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`:

  | Scenario | Covers |
  | --- | --- |
  | `states` | every state in Passive mode, dark English and light French, 100 % and 150 % |
  | `form` | the form filled by OverCrow, rated and not rated yet, both themes and languages, 150 %, 280 px wide |
  | `publish-keyboard` | Tab, an arrow key, Enter on the button, then Ctrl+Enter in the review: what OverCrow sends, Saved |
  | `publish-pointer` | a first rating with the pointer, then Saving with no answer, `unavailable`, `busy`, `timeout`, `stale_context` and `not_connected` |
  | `offline` | the last rating, OverCrow's notice, a form that takes no input, then online again |
  | `account` | OverCrow's account panel signed out, pending and expired, in both modes; no input reaches the widget |
  | `draft` | the draft through Passive mode and a rating published elsewhere; an untouched form follows; another game |
  | `bounds` | a long game name; a review cut at 2000 characters by OverCrow's field |
  | `refused` | no grant: no call, "Rating unavailable" |
  | `read-only` | the read grant alone: the rating, never the form |

  A publication refused because no gesture made it (`gesture_required`)
  cannot be played by a scenario, where every submission is a gesture:
  OverCrow tests it with this package in its own repository.

## Cost

Measured on 2026-10-01 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU),
with a published rating and its review:

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 8.7 ms (p50), 8.8 ms at most | VM ready in 14–15 ms (p50) |
| VM memory | 0.79 MiB private, 0.97 MiB PSS | 1.15 MiB private working set, 1.43 MiB private commit |
| Private memory in all (VM, sandbox helpers, overlay share) | 8.7–11.2 MB | — |
| CPU at rest, Passive mode | 0.05 % of one core, no frame | — |
| CPU at rest, the form open | 0.03–0.05 % of one core, no frame | — |
| CPU, a slider changed and the rating published every 2 s | 0.30 % of one core: the frames of the keys, the outcome and the badge's pulse (about 36 frames of 0.10 ms), then none | — |
| CPU, hidden, a new rating every 2 s | 0.05 % of one core | — |
| VM CPU | one short turn per rating or form value; none at rest | — |

A rating changes when you publish one: the 2 s load is a stress. The
private memory is above OverCrow's 8 MB goal per widget by up to 3 MB and
far under its 80 MB ceiling. The egui widget it replaces painted in the
overlay's own process (0.05 ms a frame in Passive mode, 0.09 ms with its
form) and repainted each second while a publication was pending; OverCrow
read the rating whenever that widget was enabled, and now only while this
widget subscribes. Scenarios render the same images on Linux and Windows,
pixel for pixel.
