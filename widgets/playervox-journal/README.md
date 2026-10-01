# Session journal

`com.playervox.overcrow.playervox.journal` — the finished play sessions of
the game you play, newest first, five per page: the start date and time and
the duration of each, and a trash button to delete one. OverCrow records the
sessions on your device without any account; with a linked PlayerVox account
and sync enabled, it merges them with your PlayerVox journal. A built-in of
OverCrow, written against the public `@overcrow/sdk` and packaged with
`overcrow-widget` like any creator's widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| Sessions | the game's name when OverCrow has one, then a row per session under a rule: "09/20/2026 · 20:30" and "0 h 45 min" |
| Several pages | a footer: "Page 2"; on the last one "Page 3 · End of the journal" / "Page 3 · Fin du journal" |
| No session yet | "Your next sessions will appear here." / "Vos prochaines sessions apparaîtront ici." |
| Waiting for OverCrow | "Loading…" / "Chargement…" |
| No game | "Waiting for a game" / "En attente du jeu": nothing of the last game stays |
| Sync offline | "Sync is offline. Your sessions stay on this device." above the sessions of this device |
| PlayerVox sign-in expired | "Your connection expired. Link your account again." above the sessions |
| Local journal full | "Journal storage is full. Delete local sessions or synchronize pending deletions." above the sessions |
| Local journal unreadable | "Local session storage is unavailable.", no session |
| A read failed | "The journal is unavailable right now."; the page shown stays |
| OverCrow's journal source failed | "The journal is unavailable. Retrying automatically."; the widget asks again 5 s later |
| No permission | "The journal needs your permission.": the widget asks OverCrow nothing |

- **Signed out** of PlayerVox, the widget shows the sessions of this device:
  no sign-in panel, no banner. Cloud sessions appear only while PlayerVox is
  connected and sync is on; the sync switch is in OverCrow's Control Center.
- **Only the active game.** Another game's sessions never show; when the
  game changes, the journal starts on its first page.
- **Dates** are in your local time, with the UTC offset each session
  carries: a winter session keeps winter time after the clocks change. The
  date follows your date order (`mdy` 09/20/2026, `dmy` 20/09/2026, `ymd`
  2026-09-20), the time is 24-hour, both in tabular figures.
- **Durations** are whole hours and minutes, "H h MM min": no seconds, no
  days (a week is "168 h 00 min").
- **The game's name** comes from PlayerVox; a game it does not know, or one
  you added yourself, has none, and the line is left out. A long name ends
  with an ellipsis; hovering shows it whole.
- **A message** wraps on as many lines as it needs; it never widens the
  panel.
- **Accessible names:** each row "09/20/2026 · 20:30, 0 h 45 min", the
  buttons "Delete session" / "Supprimer la session", "Previous page" /
  "Page précédente", "Next page" / "Page suivante".
- **Size.** As wide as you make it (280 to 900 px, 350 by default) and as
  tall as its content, within the host frame and its 10 × 8 px margin.

## Controls

In Interactive mode only; Passive mode shows the sessions and the page
label, without any button.

| Control | Does |
| --- | --- |
| Trash, on a row | asks OverCrow to delete the session. OverCrow shows its own confirmation beside the widget ("Delete this journal session?", Cancel first); the widget never draws or answers it. Confirmed, the session is deleted (on PlayerVox too for a synced one) and the page is read again; declined, nothing changes. |
| Previous page, next page | reads that page; a button without a page is disabled |

One request at a time: while a page is read or a confirmation is open, the
buttons are disabled, and quick clicks do not queue page turns. A deletion
OverCrow refuses says why above the sessions ("Connect PlayerVox to delete
this session.", "An operation is already in progress. Please try again
shortly.", "The session could not be deleted. Try again."); the next action
clears it. There is no keyboard shortcut, no link and no session note.

## Menu

None: OverCrow's own rows (size, opacity, fit to content, Passive
visibility, close) are all it needs.

## Permissions

- `journal.read`: the play sessions of the active game, those of this
  device and, while PlayerVox is connected, those of your PlayerVox journal.
  Sensitive: they tell when and how long you play.
- `journal.delete`: deleting a session, on a click, after OverCrow's
  confirmation. Sensitive.

As a sensitive capability rules out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing. Without
`journal.delete` it shows and pages the journal without any trash.

## How it reads the journal

The widget subscribes to `journal.subscribe`, which answers `null` without
a game, or the journal's `revision` and its `notice`. At each new revision
(a session recorded or deleted, cloud sessions merged, the account or sync
changed) it reads the page it shows again with `journal.page` and the
cursor of that page; the previous and next buttons read the cursors the
page gave. OverCrow keeps no page position shared between widgets: another
widget reading the journal never moves this one's page. OverCrow runs its
journal source (the merge and the cloud reads) only while a widget holds
the subscription; recording your sessions does not depend on any widget.

A read OverCrow answers `busy`, or `stale_context` after a change under
it, is asked again one second later, three times at most; nothing polls.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: one read
  per revision and none for a notice alone, one request at a time, the
  page's own cursor read again, the deletion asked once and its outcomes,
  a game switch back to the first page and a late answer dropped, an
  unknown handle, the bounded re-reads, a failed source and its new
  subscription, dates by offset and date order, durations, accessible
  names, every message in both languages.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`:

  | Scenario | Covers |
  | --- | --- |
  | `states` | every state, dark English and light French: loading, the list, no game, empty, offline, full, expired, unreadable storage, a failed read, the last page, Passive then Interactive |
  | `scale` | 150 % in dark English and light French: the list with its buttons, offline, empty, no game |
  | `frame` | the host frame, Passive and Interactive, at 280 px with a wrapped message and a long name, and at 600 px |
  | `paging` | Passive without buttons, previous and next with the page's cursors, disabled buttons, the last page, a new revision reading the same page |
  | `delete` | a deletion accepted (the page without the session), then declined (nothing changes, nothing read), then refused by the host, in both languages; no trash in Passive mode |
  | `changes` | a game switch back to the first page; a busy host and a stale read asked again; a third refusal shown, then cleared |
  | `unavailable` | the host's source failing, then the new subscription 5 s later |
  | `refused` | no grant: no call, "The journal needs your permission." |
  | `read-only` | `journal.read` alone: the journal and its paging, no trash |
  | `signed-out` | signed out of PlayerVox: the local sessions and a deletion, no account panel |

  The sessions of every fixture are synthetic.

## Cost

Measured on 2026-10-01 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU),
over a synthetic journal of 10,000 sessions:

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime | 7.9 ms (p50), 8.0 ms at most | VM ready in 15.0–15.6 ms (p50) |
| VM memory, twenty pages read | 0.75 MiB private, 0.93 MiB PSS | 1.12–1.14 MiB private working set, 1.40–1.41 MiB private commit |
| Private memory in all (VM, sandbox helpers, overlay share) | 3.1–6.1 MB | — |
| CPU, a page held | 0.03 % of one core, no frame | — |
| CPU, a page read every 2 s | 0.07–0.08 % of one core: one frame of 0.5 ms per page | — |
| CPU, hidden, a page read every 2 s | 0.07 % of one core | — |
| VM CPU | 0.02 % of one core while a page is read every 2 s; none at rest | — |

The widget keeps the page it shows, never the journal: its memory does not
grow with the journal's length or with the pages read, and there is no
scrolling to measure. A page is read on a click or when the journal
changes; the 2 s load is a stress. The egui widget it replaces painted its
five rows at every overlay frame (0.08 ms a frame); OverCrow read the
journal whenever that widget was enabled, and now only while this widget
subscribes. Scenarios render the same images on Linux and Windows, pixel
for pixel.
