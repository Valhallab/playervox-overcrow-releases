// Notes: the user's notes and checklists, one document for every game.
// OverCrow stores them; this widget shows the active note, and in
// Interactive mode lets the user choose, create, delete, check and edit
// notes. The editor is a form bound to the `notes.save` intent: its title,
// body and checklist rows belong to OverCrow, which fills them, keeps the
// draft and sends their values itself when the user saves. The logic only
// follows them and decides which rows the form has.
import {
  MAX_NOTES,
  MAX_NOTE_ITEMS,
  hasGrant,
  host,
  initState,
  notes,
  onHost,
  option,
  t,
  timers,
  type Note,
  type NoteItem,
  type Notes,
  type ServiceError,
  type ServiceErrorPayload,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

/** One checklist row of an editor. */
export interface Row {
  /** Stable key of the row in the view. */
  key: string;
  /** The stored item the row was opened with; `null` for a new row. */
  id: string | null;
  /** The row's text as OverCrow last reported it. */
  text: string;
}

/**
 * The editor of one note: what OverCrow's form holds, as its `input`
 * events reported it. The form stays in the view while the editor exists,
 * hidden when it is not the one shown: OverCrow keeps the draft.
 */
export interface Editor {
  /**
   * Stable key of the form in the view: the note's ID, or a key of its
   * own for the editor of a note being created.
   */
  key: string;
  /**
   * The note the form saves to. `null` while a new note is being created:
   * the form is already there, so that its title takes the focus in the
   * turn of the user's click, and OverCrow fills it once it has its note.
   */
  note: string | null;
  /** The user opened it and has not saved or cancelled since. */
  open: boolean;
  /**
   * The editor of a note just created: it shows until its note is the
   * active one, which the document says a moment after the click.
   */
  fresh: boolean;
  /** `null` until OverCrow filled the form. */
  title: string | null;
  body: string | null;
  rows: Row[];
  /** Number of the next row key. */
  next: number;
  /** A save was sent and not answered yet. */
  pending: boolean;
}

/** Which parts of the active note show (menu row `sections`). */
export type Sections = "both" | "note" | "checklist";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The stored document; `null` until the host's first answer. */
    doc: Notes | null;
    /** The host's source failed: the widget asks again later. */
    unavailable: boolean;
    /** Interactive mode: selector, checks and editor. */
    interactive: boolean;
    sections: Sections;
    moveChecked: boolean;
    /** The note list is open. */
    menu: boolean;
    editors: Editor[];
    /** Checks sent and not stored yet, by item ID. */
    checks: Record<string, boolean>;
    /** Calls and saves sent and not answered yet. */
    busy: number;
    /** Message key of the last failure, or `""`. */
    error: string;
  }
}

/**
 * After the host ends the subscription with a failure, the widget
 * subscribes again this much later.
 */
export const RETRY_MS = 5_000;

/**
 * OverCrow answers a save once the note is stored. Should no answer come
 * at all, the editor is given back after this long.
 */
export const ANSWER_MS = 40_000;

/** `label` bound (`MAX_LABEL_BYTES`). */
const MAX_LABEL_BYTES = 256;

const canRead = hasGrant("notes.read");
const canWrite = hasGrant("notes.write");

function sectionsOption(): Sections {
  const value = option("sections", "both");
  return value === "note" || value === "checklist" ? value : "both";
}

const state = initState({
  doc: null as Notes | null,
  unavailable: false,
  interactive: host.mode === "interactive",
  sections: sectionsOption(),
  moveChecked: option("move-checked", true),
  menu: false,
  editors: [] as Editor[],
  checks: {} as Record<string, boolean>,
  busy: 0,
  error: "",
});

/** What the view reads of the state. */
export interface View {
  doc: Notes | null;
  unavailable: boolean;
  interactive: boolean;
  sections: Sections;
  moveChecked: boolean;
  menu: boolean;
  editors: Editor[];
  checks: Record<string, boolean>;
  busy: number;
  error: string;
}

/** `text` cut to `limit` UTF-8 bytes on a character boundary. */
export function cutBytes(text: string, limit: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > limit) {
      return text.slice(0, end);
    }
    bytes += size;
    end += character.length;
  }
  return text;
}

/** A label of `key` with the note's title, within the label bound. */
export function titled(key: string, title: string): string {
  return cutBytes(t(key, { title }), MAX_LABEL_BYTES);
}

/** The first shown state: nothing known yet, the source failed, or ready. */
export function phase(view: View): "loading" | "unavailable" | "ready" {
  if (!canRead || view.unavailable) {
    return "unavailable";
  }
  return view.doc === null ? "loading" : "ready";
}

/** The selector, the checks and the editor show: Interactive, with the write grant. */
export function editable(view: View): boolean {
  return view.interactive && canWrite;
}

export function noteOf(view: View, id: string | null): Note | null {
  return id === null ? null : (view.doc?.notes.find((note) => note.id === id) ?? null);
}

/** The note shown: the document's active one. */
export function active(view: View): Note | null {
  return view.doc === null ? null : noteOf(view, view.doc.active);
}

export function noteCount(view: View): number {
  return view.doc?.notes.length ?? 0;
}

/** No more note can be created. */
export function full(view: View): boolean {
  return noteCount(view) >= MAX_NOTES;
}

export function showsNote(view: View): boolean {
  return view.sections !== "checklist";
}

export function showsChecklist(view: View): boolean {
  return view.sections !== "note";
}

export function editorOf(view: View, id: string | null): Editor | null {
  return id === null ? null : (view.editors.find((editor) => editor.note === id) ?? null);
}

/** The editor whose form has this key. */
export function editorAt(view: View, key: string): Editor | null {
  return view.editors.find((editor) => editor.key === key) ?? null;
}

/** The rows a save keeps: trimmed, the empty ones left out. */
function keptRows(editor: Editor): Row[] {
  return editor.rows.filter((row) => row.text.trim() !== "");
}

/**
 * The editor's form differs from the stored note. Unknown before OverCrow
 * filled the form: not a draft yet.
 */
export function dirty(editor: Editor, note: Note | null): boolean {
  if (note === null || editor.title === null || editor.body === null) {
    return false;
  }
  // As a save reads the form: the title and the rows trimmed, the empty
  // rows left out, the text as written. Stored texts are compared trimmed
  // too: a note written by an older version may hold a padded entry.
  const rows = keptRows(editor);
  const items = note.items.filter((item) => item.text.trim() !== "");
  return (
    editor.title.trim() !== note.title.trim() ||
    editor.body !== note.body ||
    rows.length !== items.length ||
    rows.some((row, index) => {
      const item = items[index];
      return item === undefined || row.id !== item.id || row.text.trim() !== item.text.trim();
    })
  );
}

/** The note has an unsaved draft. */
export function drafted(view: View, id: string | null): boolean {
  const editor = editorOf(view, id);
  return editor !== null && dirty(editor, noteOf(view, id));
}

/** A note's title in the selector and the list, " •" with a draft. */
export function noteLabel(view: View, note: Note): string {
  return drafted(view, note.id) ? `${note.title} •` : note.title;
}

/** The ID of the note shown, `""` without one. */
export function activeId(view: View): string {
  return active(view)?.id ?? "";
}

export function activeTitle(view: View): string {
  return active(view)?.title ?? "";
}

export function activeBody(view: View): string {
  return active(view)?.body ?? "";
}

/** The selector's text: the active note's title, " •" with a draft. */
export function activeLabel(view: View): string {
  const note = active(view);
  return note === null ? "" : noteLabel(view, note);
}

/** The chevron shows when there is another note to choose. */
export function chevronClass(view: View): string {
  return noteCount(view) > 1 ? "selector-icon" : "selector-icon none";
}

export function listItemClass(view: View, note: Note): string {
  return note.id === view.doc?.active ? "list-item current" : "list-item";
}

/** Message key of the state without notes to show. */
export function unavailableKey(view: View): string {
  return canRead && view.unavailable ? "error-unavailable" : "error-permission";
}

/**
 * The editor that shows, in Interactive mode: the one of a note just
 * created, else the open one of the active note.
 */
export function shownEditor(view: View): Editor | null {
  if (!editable(view)) {
    return null;
  }
  const fresh = view.editors.find((editor) => editor.open && editor.fresh);
  if (fresh !== undefined) {
    return fresh;
  }
  const editor = editorOf(view, view.doc?.active ?? null);
  return editor !== null && editor.open ? editor : null;
}

/** An editor shows in place of the active note's preview. */
export function editing(view: View): boolean {
  return shownEditor(view) !== null;
}

/**
 * The classes of an editor's form: shown for the editor that shows,
 * hidden otherwise. Hidden, it stays in the view and OverCrow keeps the
 * draft its controls hold.
 */
export function editorClass(view: View, editor: Editor): string {
  return shownEditor(view) === editor ? "editor" : "editor hidden";
}

/** Whether the item shows checked: a check just sent, else the stored one. */
export function checked(view: View, item: NoteItem): boolean {
  return (item.id !== null ? view.checks[item.id] : undefined) ?? item.checked;
}

/** A stored item's check by its ID, for an editor's row. */
export function rowChecked(view: View, editor: Editor, row: Row): boolean {
  const item = noteOf(view, editor.note)?.items.find((candidate) => candidate.id === row.id);
  return item !== undefined && checked(view, item);
}

/** A row whose item is stored: it has a check. */
export function rowStored(view: View, editor: Editor, row: Row): boolean {
  return row.id !== null && noteOf(view, editor.note)?.items.some((item) => item.id === row.id) === true;
}

/**
 * The checklist of the preview: in the stored order, or with the checked
 * entries after the open ones, each group in the stored order. The note is
 * never reordered.
 */
export function previewItems(view: View): NoteItem[] {
  const items = active(view)?.items ?? [];
  if (!view.moveChecked) {
    return [...items];
  }
  return [
    ...items.filter((item) => !checked(view, item)),
    ...items.filter((item) => checked(view, item)),
  ];
}

export function itemClass(view: View, item: NoteItem): string {
  return checked(view, item) ? "item-text done" : "item-text";
}

export function itemLabel(item: NoteItem): string {
  return cutBytes(item.text, MAX_LABEL_BYTES);
}

/** The accessible name of a row's check: the row's text. */
export function rowLabel(row: Row): string {
  return cutBytes(row.text, MAX_LABEL_BYTES);
}

/** The rows of an editor's form hold as many entries as a note can. */
export function rowsFull(editor: Editor): boolean {
  return keptRows(editor).length >= MAX_NOTE_ITEMS;
}

/** The row is the empty one at the end, where a new entry is typed. */
export function lastEmpty(editor: Editor, row: Row): boolean {
  return row.text === "" && editor.rows[editor.rows.length - 1] === row;
}

export function rowHint(editor: Editor, row: Row): string {
  return t(lastEmpty(editor, row) ? "new-item-hint" : "item-hint");
}

/**
 * The body's visible rows: its lines, from 3 to 10. OverCrow scrolls a
 * longer text to the caret.
 */
export function bodyRows(editor: Editor): number {
  const lines = (editor.body ?? "").split("\n").length;
  return Math.min(10, Math.max(3, lines));
}

/** The title is empty: nothing to save under. */
export function untitled(editor: Editor): boolean {
  return editor.title !== null && editor.title.trim() === "";
}

/**
 * Save is active once the form has its note and OverCrow filled it, with a
 * title, while no save is in flight.
 */
export function canSave(view: View, editor: Editor): boolean {
  return editable(view) && editor.note !== null && editor.title !== null && !untitled(editor) && !editor.pending;
}

export function saveClass(view: View, editor: Editor): string {
  return canSave(view, editor) ? "action primary" : "action";
}

/** Message key of a refused call or save. */
export function errorKey(code: string | null): string {
  switch (code) {
    case "quota_exceeded":
      return "error-full";
    case "permission_denied":
      return "error-permission";
    default:
      // `unavailable`, `busy`, `stale_context`, `timeout` and the rest: the
      // notes could not be saved.
      return "error-unavailable";
  }
}

// ---------------------------------------------------------------------
// Editors.

/** A new empty row at the end, unless the form holds its last one. */
function addEmptyRow(editor: Editor): void {
  const last = editor.rows[editor.rows.length - 1];
  if (editor.rows.length < MAX_NOTE_ITEMS && (last === undefined || last.text !== "")) {
    editor.rows.push({ key: `row-${editor.next}`, id: null, text: "" });
    editor.next += 1;
  }
}

/**
 * The editor of `note`, opened: its rows are the note's items in their
 * stored order, which is the order OverCrow fills the form's fields in,
 * and an empty row to type a new entry.
 */
function openEditor(note: Note): void {
  if (note.id === null) {
    return;
  }
  let editor = editorOf(state, note.id);
  if (editor === null) {
    editor = {
      key: note.id,
      note: note.id,
      open: true,
      fresh: false,
      title: null,
      body: null,
      rows: note.items.map((item, index) => ({ key: `row-${index}`, id: item.id, text: item.text })),
      next: note.items.length,
      pending: false,
    };
    addEmptyRow(editor);
    state.editors.push(editor);
  }
  editor.open = true;
  state.menu = false;
}

/** Removes an editor: OverCrow forgets its form's draft with it. */
function closeEditor(key: string): void {
  state.editors = state.editors.filter((editor) => editor.key !== key);
}

/**
 * The editors leave the screen: a draft stays, hidden, with its form; an
 * editor without a change is closed, and so is the editor of a note that
 * is still being created.
 */
function setEditorsAside(): void {
  state.editors = state.editors.filter((editor) => editor.pending || dirty(editor, noteOf(state, editor.note)));
  for (const editor of state.editors) {
    editor.open = false;
    editor.fresh = false;
  }
}

/** The title's text, from the user's typing or from OverCrow's fill. */
export function titleInput(key: string, text: string): void {
  const editor = editorAt(state, key);
  if (editor !== null) {
    editor.title = text;
  }
}

/** The body's text, from the user's typing or from OverCrow's fill. */
export function bodyInput(key: string, text: string): void {
  const editor = editorAt(state, key);
  if (editor !== null) {
    editor.body = text;
  }
}

/**
 * A row's text. Typing in the empty row at the end adds the next one, so
 * that Enter, which OverCrow moves to the next field, continues the list.
 */
export function rowInput(form: string, key: string, text: string): void {
  const editor = editorAt(state, form);
  const row = editor?.rows.find((candidate) => candidate.key === key);
  if (editor === null || row === undefined) {
    return;
  }
  row.text = text;
  addEmptyRow(editor);
}

/** Removes a row from the form: its entry leaves the note at the next save. */
export function dropRow(form: string, key: string): void {
  const editor = editorAt(state, form);
  if (editor === null) {
    return;
  }
  editor.rows = editor.rows.filter((row) => row.key !== key);
  addEmptyRow(editor);
}

const answers = new Map<string, Timer>();

/** OverCrow is sending the form: the editor waits for the outcome. */
function sending(key: string): void {
  const editor = editorAt(state, key);
  // Without its note yet, the form has nothing to save to.
  if (editor === null || editor.note === null || editor.pending) {
    return;
  }
  editor.pending = true;
  state.busy += 1;
  state.error = "";
  answers.set(
    key,
    timers.after(ANSWER_MS, () => {
      answers.delete(key);
      const waiting = editorAt(state, key);
      if (waiting !== null && waiting.pending) {
        waiting.pending = false;
        state.busy = Math.max(0, state.busy - 1);
        state.error = "error-unavailable";
      }
    }),
  );
}

/** The Save button: OverCrow submits the form on the same gesture. */
export function saving(key: string): void {
  sending(key);
}

/** Ctrl+Enter in a field or the body submits the form too. */
export function keyed(form: string, key: string, ctrl: boolean): void {
  if (key === "Enter" && ctrl) {
    sending(form);
  }
}

/**
 * The outcome of a save OverCrow sent: the form's `submit` event, with the
 * failure's code when it was refused. Stored, the editor closes and the
 * subscription shows the note; refused, the form keeps the draft.
 */
export function saved(key: string, outcome: string, error: ServiceErrorPayload | undefined): void {
  const editor = editorAt(state, key);
  if (editor !== null && editor.pending) {
    editor.pending = false;
    state.busy = Math.max(0, state.busy - 1);
  }
  answers.get(key)?.cancel();
  answers.delete(key);
  if (outcome === "accepted") {
    state.error = "";
    closeEditor(key);
  } else if (outcome !== "cancelled" && (editor === null || editor.note !== null)) {
    // (A save asked before the new note exists had no note to go to:
    // nothing to report, the form is filled a moment later.)
    state.error = editor !== null && untitled(editor) ? "add-title" : errorKey(error?.code ?? null);
  }
}

/** Cancel: the draft is discarded with its form. */
export function cancel(key: string): void {
  closeEditor(key);
}

// ---------------------------------------------------------------------
// Calls. Each one is made while handling the user's gesture.

function sent<T>(promise: Promise<T>, done: (value: T) => void, refused: () => void = () => {}): void {
  state.busy += 1;
  promise.then(
    (value) => {
      state.busy = Math.max(0, state.busy - 1);
      state.error = "";
      done(value);
    },
    (error: ServiceError) => {
      state.busy = Math.max(0, state.busy - 1);
      refused();
      // The user declined the host's confirmation: nothing to say.
      if (error.code !== "cancelled") {
        state.error = errorKey(error.code);
      }
    },
  );
}

/** Opens or closes the note list. */
export function toggleMenu(): void {
  state.menu = !state.menu;
}

/** A click beside the list closes it. */
export function closeMenu(): void {
  state.menu = false;
}

/** Shows another note: OverCrow stores the active note. */
export function select(id: string): void {
  state.menu = false;
  if (state.doc?.active === id) {
    return;
  }
  setEditorsAside();
  sent(notes.select({ note: id }), () => {});
}

/** Opens the editor of a note, showing that note first. */
export function edit(id: string): void {
  const note = noteOf(state, id);
  if (note === null) {
    return;
  }
  if (state.doc?.active !== id) {
    setEditorsAside();
    sent(notes.select({ note: id }), () => {});
  }
  openEditor(note);
}

/** Number of the next new note's editor. */
let created = 0;

/**
 * A new note, titled by OverCrow, opened in its editor. The editor is in
 * the view at once, in the turn of the user's click, so that its title
 * takes the focus; its note comes with OverCrow's answer, and OverCrow
 * fills the form then. If the note cannot be created (the notes are full,
 * the store refuses), the editor goes and the failure is said.
 */
export function create(): void {
  state.menu = false;
  setEditorsAside();
  // A key no note and no editor has.
  let key = "";
  do {
    created += 1;
    key = `new:${created}`;
  } while (noteOf(state, key) !== null || editorAt(state, key) !== null);
  const editor: Editor = {
    key,
    note: null,
    open: true,
    fresh: true,
    title: null,
    body: null,
    rows: [],
    next: 0,
    pending: false,
  };
  addEmptyRow(editor);
  state.editors.push(editor);
  sent(
    notes.create(),
    (answer) => {
      const waiting = editorAt(state, key);
      // The user went elsewhere meanwhile: the note exists, without editor.
      if (waiting === null) {
        return;
      }
      if (answer.note.id === null) {
        closeEditor(key);
        return;
      }
      waiting.note = answer.note.id;
    },
    () => {
      closeEditor(key);
    },
  );
}

/** Deletes a note: OverCrow asks the user to confirm first. */
export function remove(id: string): void {
  state.menu = false;
  sent(notes.delete({ note: id }), () => {
    state.editors = state.editors.filter((editor) => editor.note !== id);
  });
}

/**
 * Checks or unchecks a stored item at once: the box shows the new state
 * until OverCrow stored it, and goes back if it could not.
 */
export function check(note: string | null, item: string | null, value: boolean): void {
  if (note === null || item === null) {
    return;
  }
  state.checks[item] = value;
  state.busy += 1;
  notes.setItem({ note, item, checked: value }).then(
    () => {
      state.busy = Math.max(0, state.busy - 1);
      state.error = "";
      settleChecks();
    },
    (error: ServiceError) => {
      state.busy = Math.max(0, state.busy - 1);
      delete state.checks[item];
      state.error = errorKey(error.code);
    },
  );
}

/** Forgets the checks the stored document now holds. */
function settleChecks(): void {
  const stored = new Map<string, boolean>();
  for (const note of state.doc?.notes ?? []) {
    for (const item of note.items) {
      if (item.id !== null) {
        stored.set(item.id, item.checked);
      }
    }
  }
  for (const [id, value] of Object.entries(state.checks)) {
    if (stored.get(id) === value || !stored.has(id)) {
      delete state.checks[id];
    }
  }
}

// ---------------------------------------------------------------------
// The document.

let subscription: Subscription | null = null;

function show(doc: Notes): void {
  state.doc = doc;
  state.unavailable = false;
  // What is stored changed: the last failure is no longer the news. A
  // refused write changes nothing, so its message stays.
  state.error = "";
  // A note deleted, here or elsewhere, takes its editor with it. The
  // editor of a note being created has none yet and stays.
  state.editors = state.editors.filter((editor) => editor.note === null || noteOf(state, editor.note) !== null);
  // A new note is now the active one: its editor shows as any other.
  for (const editor of state.editors) {
    if (editor.fresh && editor.note !== null && editor.note === doc.active) {
      editor.fresh = false;
    }
  }
  if (doc.notes.length < 2) {
    state.menu = false;
  }
  settleChecks();
}

function subscribe(): void {
  const current = notes.subscribe((update) => {
    if (update.ok) {
      show(update.value);
      return;
    }
    // The subscription ended: the host's source failed. Say so and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.unavailable = true;
      timers.after(RETRY_MS, subscribe);
    }
  });
  subscription = current;
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
    if (!state.interactive) {
      state.menu = false;
    }
  }
  if (changed.includes("options")) {
    state.sections = sectionsOption();
    state.moveChecked = option("move-checked", true);
  }
});

// Without the grant the host would refuse the subscription: say so instead
// of asking.
if (canRead) {
  subscribe();
}
