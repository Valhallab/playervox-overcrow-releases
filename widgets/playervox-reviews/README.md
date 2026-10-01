# Player reviews

`com.playervox.overcrow.playervox.reviews` — what PlayerVox players think of
the Steam game you play: three reviews per page, each with its player's
grade badge (S+ to F), name, date, score out of 100 and text, in your
language when PlayerVox has a translation. A row of the widget's menu limits
them to the players you follow. It needs your PlayerVox account. A built-in
of OverCrow (it replaces the former "PlayerVox Circle" widget), written
against the public `@overcrow/sdk` and packaged with `overcrow-widget` like
any creator's widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Reviews | the game's name, then up to three reviews under a rule each, and a footer: "7 reviews" / "7 avis" and the pager "1 / 3" |
| The last page | the pager "3 / 3" with its next button disabled: the end of the list |
| No review | "No player reviews for this game yet." / "Aucun avis pour ce jeu pour le moment." |
| No review from the players you follow | "No reviews from the players you follow yet." / "Aucun avis des joueurs que vous suivez pour le moment." |
| Waiting for PlayerVox | "Loading…" / "Chargement…" |
| No game | "Waiting for a game" / "En attente du jeu": nothing of the last game stays |
| A game without a Steam app ID | "Steam game required" / "Jeu Steam requis" |
| A read failed | "PlayerVox is unavailable for this game right now.", in the warning colour, above the page shown, which stays |
| PlayerVox asks to retry later | "An operation is already in progress. Please try again shortly.", after three more tries |
| The session ended during a read | "Your connection expired. Link your account again." |
| Offline | the page shown, its paging buttons disabled; OverCrow adds its own notice under the content. Without a page: "Offline · Reviews show once PlayerVox is reachable again." |
| OverCrow's reviews source failed | "The reviews are unavailable. Retrying automatically."; the widget asks again 5 s later |
| No account, a sign-in in progress, an expired session | nothing of the widget: OverCrow covers it with its account panel (link or create an account, reopen the browser, cancel), whether the followed players filter is on or off |
| No permission | "The reviews need your permission.": the widget asks OverCrow nothing |

### A review

| Part | Shows |
| --- | --- |
| Badge | the grade of the player's score, S+ ≥ 90, S ≥ 80, A ≥ 70, B ≥ 60, C ≥ 40, D ≥ 20, else F, drawn from the source shared with PlayerVox Score ([widgets-shared](../../widgets-shared/README.md)) at 42 % |
| Name | the player's PlayerVox name, in bold; a long one ends with an ellipsis, and hovering shows it whole |
| Date | the day the review was published, in your local time and date order: `mdy` 09/20/2026, `dmy` 20/09/2026, `ymd` 2026-09-20 |
| Score | the mean of the player's three criteria, rounded half away from zero |
| Text | the review, with its line breaks; a review without text shows none |

- **Long reviews fold.** A review of more than 120 characters, or of more
  than three lines, shows its first three lines and an ellipsis; "Read
  more" / "Lire la suite" shows it whole and "Show less" / "Réduire" folds
  it again. OverCrow does not tell a widget whether a text was cut, so a
  review just above 120 characters gets the button on a wide panel where it
  fits in three lines. While a review is folded the widget gives OverCrow
  only its first 450 characters, more than three lines hold on the widest
  panel: OverCrow lays out every character it is given. The reviews scroll
  within 340 px; the count and the pager stay below them.
- **Translations.** OverCrow reads the reviews in the language of its
  interface, English or French, and PlayerVox answers its translation of a
  review written in another language, when the author and you allow it. A
  translated review is marked "Translated" / "Traduit"; "Show original" /
  "Voir l’original" shows the text as written and "Show translation" /
  "Voir la traduction" comes back. The widget translates nothing itself.
  Changing OverCrow's language reads the first page again.
- **Hidden reviews.** A review the community hid shows "Review hidden by
  the community" / "Avis masqué par la communauté" instead of its text,
  until "Show review" / "Afficher l’avis".
- **Your reading choices** (unfolded, original, shown) belong to the page
  shown: they stay when the same page is read again and start over on
  another page, filter or game.
- **No avatar**, no link to a profile or to the website, nothing to copy.
- **Accessible names:** each review "Mira_Quill, 09/20/2026, 94/100", its
  badge "Grade S+, 94/100", the pager "Page 2 of 3" / "Page 2 sur 3", the
  buttons "Previous page" / "Page précédente" and "Next page" / "Page
  suivante".
- **Size.** As wide as you make it (280 to 900 px, 350 by default) and as
  tall as its content, within the host frame and its 10 × 8 px margin.

## Controls

In Interactive mode only. Passive mode shows the reviews folded, the
"Translated" mark, the count and the pager, without any button.

| Control | Does |
| --- | --- |
| Previous page, next page | reads that page; disabled at an end of the list, while a page is read and while PlayerVox is unreachable |
| Read more, Show less | unfolds or folds a long review |
| Show original, Show translation | switches a translated review between its two texts |
| Show review | shows a review the community hid |

One request at a time: quick clicks do not queue page turns. Tab moves
through the buttons that can act, and Enter or Space activates one; the
keyboard goes to the widget the pointer rests on. The wheel scrolls the
reviews.

## Menu

| Row | Values | Default |
| --- | --- | --- |
| Followed players only / Joueurs suivis uniquement | on, off | off |

Turning it on or off reads the first page of the other list. The filter is
applied by PlayerVox; the widget never sees who you follow.

## Permissions

- `playervox.reviews.read`: the PlayerVox reviews of the active game,
  optionally from the players you follow, with the game's name. Sensitive:
  it tells what you play, and the filter tells, indirectly, who you follow.

As a sensitive capability rules out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing. OverCrow reads
the reviews with your PlayerVox session (`api.playervox.com`), only while
this widget subscribes. PlayerVox asks for an account for both lists, so
the widget needs yours whether the filter is on or off.

## How it reads the reviews

The widget subscribes to `playervox.reviews.subscribe`, which says
`{ state, revision, offline }` and never a review: `idle` without a game,
`unsupported` for a game without a Steam app ID, `ready` otherwise. At each
new `revision` (another game, another PlayerVox account, reviews changed on
PlayerVox) it reads the page it shows again with `playervox.reviews.page`,
giving its own page number and filter; PlayerVox answers its last page for a
page that no longer exists, and the widget follows it. OverCrow keeps no
page, filter or position shared between widgets: another widget reading
reviews never moves this one's page. OverCrow follows PlayerVox's changes
of the game's reviews only while a widget holds the subscription.

A read OverCrow answers `busy`, or `stale_context` after a change under
it, is asked again one second later, three times at most; nothing polls. An
answer that arrives after the game, the filter or the language changed is
dropped.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: one read
  per revision, one request at a time, the page before or after the one
  shown, the last page PlayerVox answers, each row's name, date, score and
  badge name, the count's plural and number format, the fold's bound, the
  translation mark and its two texts, hidden reviews, reading choices kept
  on a refresh and reset on another page, the filter and the language back
  to the first page, a late answer dropped, a game switch, each failure's
  message, the bounded re-reads, offline, the theme's badge, a failed source
  and its new subscription, text bounds.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`:

  | Scenario | Covers |
  | --- | --- |
  | `states` | every state in Passive mode, dark English and light French: loading, the list (translated in French), no game, a game without a Steam app ID, no review, one review, a failed read with and without a page, a failed source |
  | `paging` | previous and next, one page per click, disabled buttons, the last page, a new revision reading the same page, a page that no longer exists, Passive without buttons |
  | `reading` | Read more and Show less, the translation mark, Show original and Show translation, a hidden review and Show review, the choices kept on a refresh and reset on another page, Passive |
  | `keyboard` | Tab to Read more and Enter, Tab past the disabled previous button to the next one and Space |
  | `filter` | Followed players only turned on from page 2, its own empty text in both languages, turned off again |
  | `account` | the filter on without a PlayerVox session: OverCrow's account panel signed out, pending and expired, in both modes, no input and no read; connected, the followed players' reviews; signed out with the filter off |
  | `offline` | PlayerVox unreachable with a page shown: OverCrow's notice, disabled paging, nothing read; back online |
  | `offline-start` | started while PlayerVox is unreachable: the widget's own line, both languages, then online |
  | `changes` | another game back on its first page; a stale and a busy read asked again; the third refusal shown, a failed read, then cleared |
  | `unavailable` | OverCrow's source failing, the new subscription 5 s later, and none while hidden |
  | `refused` | no grant: no call, "The reviews need your permission." |
  | `scale` | 150 % in dark English and light French: the list in both modes, no followed review, no game, a game without a Steam app ID |
  | `frame` | the host frame, Interactive and Passive, 280 px wide with long names at 100 % and 175 %, and 600 px |
  | `bounds` | an 8000-character review folded, unfolded and scrolled; 120 and 121 characters; four short lines; a blank review; the count in both number formats |

  The reviews and the player names of every fixture are synthetic.
