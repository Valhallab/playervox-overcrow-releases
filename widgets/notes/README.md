# Notes

`com.playervox.overcrow.notes` — your notes and checklists over the game:
up to eight notes, each with a title, free text and a checklist of up to 64
entries. They are the same for every game and stay on this computer. In
Passive mode the widget shows the active note; in Interactive mode you
choose, create, delete and edit notes in the widget itself, and tick
entries off. A built-in of OverCrow, written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT.

## What it shows

| State | Shows |
| --- | --- |
| A note, Passive mode | its title beside a note icon, its text, its checklist; the checked entries last, struck through |
| A note, Interactive mode | the note selector with the edit, add and delete buttons, the text, the checklist with its checks |
| Waiting for OverCrow | "Loading notes…" / "Chargement des notes…" |
| A note without text | no text line, no placeholder |
| No note at all | Interactive mode: an "Add note" / "Ajouter une note" button; Passive mode: an empty panel |
| One note | a selector that opens nothing, without its chevron |
| Eight notes | an add button that takes no click |
| Something sent and not stored yet | a spinner in the chevron's place; the title does not move |
| A note with a draft | a dot after its title, "Expedition •", in the selector and in the list |
| The notes cannot be read, or a change could not be stored | "Notes could not be loaded or saved. Try again." / "Impossible de charger ou d’enregistrer les notes. Réessayez." |
| No permission to read | "Allow access to your notes in the Control Center.": the widget asks OverCrow nothing |

A note taller than the panel scrolls in it (wheel, drag, keyboard) in
Interactive mode; Passive mode shows its top.

## Choosing, creating and deleting

- The **selector** opens the list of notes under it, in the panel: a click
  on a note shows it, and each row has its own edit and delete buttons.
  OverCrow stores which note is shown.
- **Add** creates a note titled "Note {n}" by OverCrow and opens its
  editor. The editor is there from the click, with the caret in its
  title: OverCrow fills the title when the note exists, and typing goes
  on after it. A note that cannot be created (eight notes already, a
  store that refuses) leaves no editor, and the widget says why.
- **Delete** asks OverCrow, which confirms in its own panel beside the
  widget, naming the note: "Delete “Expedition”? This permanently deletes
  the note and its checklist." Declined, nothing changes.
- A **check** in the note is written at once. The box shows it before
  OverCrow answers and goes back, with the message above, if it could not
  be stored.

## The editor

The pencil opens the editor in place of the note:

| Control | |
| --- | --- |
| Title | one line, at most 96 bytes, not empty |
| Text | several lines, at most 8192 bytes; the field shows 3 to 10 rows, following its lines |
| Checklist | one row per entry (at most 256 bytes each), with its check and a remove button, and an empty row at the end to add an entry |
| Save, Cancel | below the fields, which scroll above them |

- **The form is OverCrow's.** The title, the text and each row are
  host-owned controls of a `form` bound to the `notes.save` intent: the
  view gives them no `value`. OverCrow fills them from the stored note and
  tells the logic each value through the control's `input` event. The logic
  only follows them, to know whether the form is a draft, and decides which
  rows the form has; it cannot write a character in them.
- **Saving** takes your gesture: a click on Save, Enter or Space on it, or
  Ctrl+Enter in any field. OverCrow then sends the values of its own
  controls; the logic cannot submit the form. The title and each row are
  saved trimmed, an empty row is dropped, the text is kept as written. Each
  row keeps the entry OverCrow filled it with, and that entry's check,
  whichever rows were removed. A note saved as it is stored writes nothing.
- **Enter does not save.** In the title it goes to the text; in the text
  it is a line break; in a row it goes to the next row. Typing in the
  empty row adds the next one: "torches, Enter, rope, Enter" types two
  entries.
- **The editor closes when the note is stored**, and the subscription shows
  it. If OverCrow could not store it, the message shows, the editor keeps
  the draft and Save comes back. Should OverCrow give no answer at all,
  Save comes back after 40 s.
- **The draft is kept by OverCrow** while its form stays in the view: when
  you choose another note (the form is hidden; the note is marked with a
  dot and its pencil brings the draft back), in Passive mode, while the
  widget is hidden between two games, and when the notes change elsewhere.
  An editor without a change is closed by a change of note. Cancel discards
  the draft; a draft does not outlive OverCrow.
- **Checks in the editor** are those of the stored entries: they are
  written at once, as in the note, and Cancel does not undo them. A new
  row gets its check once it is saved.
- **Limits** are OverCrow's: a field takes no more than its bound, typed or
  pasted, without a counter. A checklist of 64 entries has no empty row and
  says "Checklist full" / "Liste de tâches pleine".

A text longer than its field scrolls in it: the wheel and Page Up and Page
Down move the text first, and the editor around it once the text is at its
end.

OverCrow's fields give you the caret, the selection (Shift with the
arrows, Home and End, a double click, Ctrl+A), copy, cut and paste through
OverCrow, and input methods (IME): the composition is drawn in the field
and reaches the note when you commit it. Tab and Shift+Tab move through
the widget's controls and stay in it. Escape is OverCrow's: it leaves
Interactive mode, and the draft stays.

## Menu

| Row | Values |
| --- | --- |
| Show / Afficher | Note and checklist (default), Note only, Checklist only |
| Checked items at the end / Éléments cochés à la fin | on by default; display only, the note is never reordered |

With "Checklist only", Interactive mode keeps the selector and names the
checklist; Passive mode shows the entries alone.

## Size

360 px wide by default, from 280 px to 900 px; the height fits the content,
up to 900 px.

## Permissions

- `notes.read`: your notes and checklists. Sensitive.
- `notes.write`: create, choose, check, save and delete notes; text only
  through the host-bound form. Sensitive.

As sensitive capabilities rule out the network and the clipboard, the
widget declares neither, and no storage: it keeps nothing, and what you
type never leaves OverCrow's own fields except to your notes file. Copy
and paste are OverCrow's and yours, not the widget's. OverCrow reads the
notes file only while this widget subscribes. With the read permission
alone the widget shows the active note in both modes and nothing that
writes.

## Differences from the former built-in

- The editor does not take the keyboard when it opens: click the title or
  press Tab.
- The note list opens in the panel, under the selector, and is closed by
  the selector or by choosing a note; it is not a floating menu.
- There is no separate "Add an item" field and button: the empty row at
  the end of the checklist is where a new entry is typed.
- Checks in the editor are written at once (they were part of the draft).
- Enter in the title goes to the text (it only left the field).
- A note that was stored but whose durability the system could not confirm
  is reported as not saved; there is no "saved with warning" state.
- Escape leaves Interactive mode (it only left the field); the draft stays.
- The deletion is confirmed in OverCrow's panel beside the widget, not in
  the widget.
- The Interactive checks are OverCrow's square check boxes; Passive mode
  keeps the round marks.
- There is no undo in a field.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: the states,
  the display order, the sections, a check and its failure, the rows of an
  editor, what makes a draft, the Save cycle and its 40 s bound, Cancel,
  drafts kept across notes and Passive mode, creation and its quota,
  deletion, the full checklist, the retry of a failed subscription.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`:

  | Scenario | Covers |
  | --- | --- |
  | `states` | Passive mode: loading, the note in dark English and light French at 100 % and 150 %, each value of the Show row, the stored order, a note without text, without checklist, without either, no note, a checklist longer than the panel |
  | `interactive` | the selector, the list and the buttons in both themes and languages, 150 %, 280 px wide; checklist only, note only, one note, eight notes |
  | `editor` | the form filled by OverCrow in both themes and languages, 150 %, 280 px wide; no title; a save OverCrow refuses for its empty title |
  | `typing` | the keyboard alone: typing, selection, Backspace, Delete, arrows, Home, End, Ctrl+A, Enter between the fields and in the text, rows added by typing, Escape, Tab and Shift+Tab staying in the widget, Ctrl+Enter, what OverCrow sent |
  | `save` | Save with the pointer: a refusal, no answer for 40 s, a stale note, then stored, each with what OverCrow sent |
  | `drafts` | a draft through another note, the list, Passive mode and a hidden widget; an unchanged editor closed; Cancel |
  | `checks` | a check written at once, stored, refused; a check in the editor |
  | `delete` | a deletion declined, confirmed, from the list, refused; the last note; a new note |
  | `create` | a new note: its editor at the click with the caret in the title, the title filled, typing without a click, the save; a note that could not be created |
  | `limits` | 96 bytes of title, 8192 of text, 256 of an entry; eight notes; a full checklist that scrolls above Save |
  | `unavailable` | the source failed and came back, in French on a light panel; a failure with a draft open |
  | `refused` | no grant: no call |
  | `read-only` | the read grant alone: the note, nothing that writes |
  | `frame` | the widget in OverCrow's wrapper |

  Copy, cut, paste and an input method's composition are OverCrow's own
  events, which a scenario's `key` and `text` steps do not play: OverCrow
  tests them with this package in its own repository, with a save refused
  because no gesture made it and a logic that tries to set or submit the
  form.

## Cost

Measured on 2026-10-01 with OverCrow's release build, on an AMD Ryzen 7
5800X3D Linux workstation and in a Windows 11 virtual machine (2 vCPU),
with synthetic notes: an ordinary document (two notes, a few lines, three
entries) and the largest OverCrow stores (8 notes, each with 8 KiB of text
and 64 entries of 256 bytes).

| | Linux | Windows (VM) |
| --- | --- | --- |
| Widget start, warm, into the overlay's runtime, largest document | 8.9–9.1 ms (p50), 10.8 ms at most | VM ready in 15.1–15.4 ms (p50) |
| VM memory, ordinary document | 0.96 MiB private | — |
| VM memory, largest document | 1.84 MiB private, 2.0 MiB PSS; up to 3.0 MiB after thirty saves | 1.76 MiB private working set, 2.04 MiB private commit |
| Private memory in all (VM, sandbox helpers, overlay share), ordinary document | 6.5–9.9 MB | — |
| Private memory in all, largest document | 15.6–17.4 MB in Passive mode, 19.3–26.7 MB with the editor | — |
| CPU at rest, Passive mode or the editor open | 0.03–0.05 % of one core, no frame | — |
| CPU, typing ten characters a second in a 64-entry note | overlay 1.0–1.2 % of one core, VM 5.2–5.3 % | — |
| A typed character shown | in the frame of its key: 0.3 ms (p50), 0.5 ms (p95), 1.2 ms at most | — |
| The widget's answer to a typed character (draft mark, Save) | 5–7 ms (p50), 11 ms at most | — |
| Opening the editor of a 64-entry note | frames of 6–10 ms; 0.33 ms for the ordinary note | — |
| CPU, hidden, a changed document every 2 s | 0.10–0.12 % of one core | — |

What you type is drawn by OverCrow in its own field, in the frame of the
key; the widget's logic is told the value afterwards and only updates the
draft mark and the Save button. With the ordinary document the private
memory is around OverCrow's 8 MB goal per widget (above it by up to 2 MB);
with the largest document it is above that goal, and far under the 80 MB
ceiling: the cost is the text itself, laid out by OverCrow, and in the
editor one host field per entry. The frames that open the editor of a
64-entry note are above OverCrow's 2 ms goal for a frame, once per opening.
The egui widget it replaces painted in the overlay's own process at every
frame (0.16 ms in Passive mode, 0.30 ms with its editor, largest
document); OverCrow read the notes file at each start, and now only while
this widget subscribes. Scenarios render the same images on Linux and
Windows, pixel for pixel.
