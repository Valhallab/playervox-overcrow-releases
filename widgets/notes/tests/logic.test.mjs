// Unit tests of the Notes widget's logic on @overcrow/sdk/testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"));

const vm = installRuntime({
  host: {
    grants: ["notes.read", "notes.write"],
    mode: "interactive",
    messages: messages("en"),
    options: { sections: "both", "move-checked": true },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");

const SERVICE = "notes.subscribe";
const item = (id, text, checked = false) => ({ id, text, checked });
const note = (id, title, body = "", items = []) => ({ id, title, body, items });
const expedition = () =>
  note("note-1", "Expedition", "Find the northern entrance.", [
    item("local-1", "Pack torches", true),
    item("local-2", "Sharpen the blade"),
    item("local-3", "Buy potions"),
  ]);
const doc = (notes = [expedition(), note("note-2", "Build ideas")], active = "note-1") => ({
  active: notes.length === 0 ? null : active,
  notes,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** What OverCrow does when it fills an editor's form: one `input` per control. */
function seed(id) {
  const stored = logic.noteOf(state, id);
  const editor = logic.editorOf(state, id);
  logic.titleInput(id, stored.title);
  logic.bodyInput(id, stored.body);
  stored.items.forEach((entry, index) => logic.rowInput(id, editor.rows[index].key, entry.text));
}

/** A fresh document, Interactive mode, nothing open or in flight. */
function reset(notes) {
  vm.setHost({ mode: "interactive", options: { sections: "both", "move-checked": true } });
  state.editors = [];
  state.checks = {};
  state.busy = 0;
  state.error = "";
  state.menu = false;
  vm.push(SERVICE, notes ?? doc());
}

/** The editor of the active note, opened and filled by OverCrow. */
function openEditor(id = "note-1") {
  logic.edit(id);
  seed(id);
  return logic.editorOf(state, id);
}

test("it subscribes once and shows Loading until the first document", () => {
  assert.deepEqual(
    vm.subscriptions.map(({ service }) => service),
    [SERVICE],
  );
  assert.equal(state.doc, null);
  assert.equal(logic.phase(state), "loading");
  assert.equal(vm.timers.length, 0, "nothing ticks");
});

test("the active note shows; Passive mode has no selector, check or editor", () => {
  reset();
  assert.equal(logic.phase(state), "ready");
  assert.equal(logic.activeId(state), "note-1");
  assert.equal(logic.activeTitle(state), "Expedition");
  assert.equal(logic.activeBody(state), "Find the northern entrance.");
  assert.equal(logic.editable(state), true);
  vm.setHost({ mode: "passive" });
  assert.equal(logic.editable(state), false);
  assert.equal(logic.editing(state), false);
});

test("checked entries show after the open ones, each group in the stored order", () => {
  reset();
  const texts = () => logic.previewItems(state).map((entry) => entry.text);
  assert.deepEqual(texts(), ["Sharpen the blade", "Buy potions", "Pack torches"]);
  vm.setHost({ options: { sections: "both", "move-checked": false } });
  assert.deepEqual(texts(), ["Pack torches", "Sharpen the blade", "Buy potions"]);
  assert.deepEqual(
    state.doc.notes[0].items.map((entry) => entry.id),
    ["local-1", "local-2", "local-3"],
    "the note is never reordered",
  );
});

test("the sections row shows the note, the checklist or both", () => {
  reset();
  const shown = (sections) => {
    vm.setHost({ options: { sections, "move-checked": true } });
    return [logic.showsNote(state), logic.showsChecklist(state)];
  };
  assert.deepEqual(shown("both"), [true, true]);
  assert.deepEqual(shown("note"), [true, false]);
  assert.deepEqual(shown("checklist"), [false, true]);
  assert.deepEqual(shown("nonsense"), [true, true], "an unknown value shows both");
});

test("a check shows at once, is sent with its value, and goes back if it could not be stored", async () => {
  reset();
  const blade = state.doc.notes[0].items[1];
  logic.check("note-1", "local-2", true);
  assert.equal(logic.checked(state, blade), true, "shown before the answer");
  assert.equal(state.busy, 1);
  assert.deepEqual(vm.lastCall("notes.setItem").params, { note: "note-1", item: "local-2", checked: true });
  assert.deepEqual(
    logic.previewItems(state).map((entry) => entry.id),
    ["local-3", "local-1", "local-2"],
    "it joins the checked entries",
  );
  vm.lastCall("notes.setItem").reject("unavailable");
  await flush();
  assert.equal(logic.checked(state, blade), false, "back to the stored state");
  assert.equal(state.error, "error-unavailable");
  assert.equal(state.busy, 0);

  logic.check("note-1", "local-2", true);
  vm.lastCall("notes.setItem").resolve(null);
  await flush();
  assert.equal(state.error, "", "the next stored write clears the message");
  assert.equal(logic.checked(state, blade), true, "kept until the document says so");
  const stored = expedition();
  stored.items[1].checked = true;
  vm.push(SERVICE, doc([stored, note("note-2", "Build ideas")]));
  assert.deepEqual(state.checks, {}, "the document holds it now");
  assert.equal(logic.checked(state, state.doc.notes[0].items[1]), true);
});

test("an editor's rows are the note's items in their stored order, and an empty row to type in", () => {
  reset();
  logic.edit("note-1");
  const editor = logic.editorOf(state, "note-1");
  assert.deepEqual(
    editor.rows.map((row) => row.id),
    ["local-1", "local-2", "local-3", null],
    "the stored order, whatever the preview's",
  );
  assert.equal(logic.editing(state), true);
  assert.equal(logic.editorClass(state, editor), "editor");
  assert.equal(logic.canSave(state, editor), false, "not before OverCrow filled the form");
  assert.equal(logic.dirty(editor, state.doc.notes[0]), false, "nor a draft");
  seed("note-1");
  assert.equal(logic.canSave(state, editor), true);
  assert.equal(logic.dirty(editor, state.doc.notes[0]), false, "the stored note is no draft");
  assert.equal(logic.activeLabel(state), "Expedition");
  assert.equal(logic.lastEmpty(editor, editor.rows[3]), true);
  assert.equal(logic.rowHint(editor, editor.rows[3]), "Add an item…");
  assert.equal(logic.rowHint(editor, editor.rows[0]), "Checklist item");
});

test("typing in the last row adds the next one; a removed row leaves the form", () => {
  reset();
  const editor = openEditor();
  logic.rowInput("note-1", editor.rows[3].key, "R");
  assert.equal(editor.rows.length, 5, "a new empty row");
  logic.rowInput("note-1", editor.rows[3].key, "Rope");
  assert.equal(editor.rows.length, 5, "only one empty row at the end");
  assert.equal(logic.dirty(editor, state.doc.notes[0]), true);
  assert.equal(logic.activeLabel(state), "Expedition •");
  logic.rowInput("note-1", editor.rows[3].key, "");
  assert.equal(logic.dirty(editor, state.doc.notes[0]), false, "an empty row is not saved");

  logic.dropRow("note-1", editor.rows[1].key);
  assert.deepEqual(
    logic.editorOf(state, "note-1").rows.map((row) => row.id),
    ["local-1", "local-3", null, null],
  );
  assert.equal(logic.dirty(logic.editorOf(state, "note-1"), state.doc.notes[0]), true);
});

test("the title and the rows compare trimmed, the body as written", () => {
  reset();
  const editor = openEditor();
  const stored = state.doc.notes[0];
  logic.titleInput("note-1", "  Expedition ");
  logic.rowInput("note-1", editor.rows[0].key, " Pack torches  ");
  assert.equal(logic.dirty(editor, stored), false);
  logic.bodyInput("note-1", "Find the northern entrance. ");
  assert.equal(logic.dirty(editor, stored), true);
  logic.bodyInput("note-1", stored.body);
  logic.titleInput("note-1", "   ");
  assert.equal(logic.untitled(editor), true);
  assert.equal(logic.canSave(state, editor), false, "no save without a title");
  assert.equal(logic.saveClass(state, editor), "action");
});

test("a stored note with padded texts is not a draft when its editor opens", () => {
  reset(doc([note("note-1", " Padded ", "text ", [item("local-1", "entry "), item("local-2", "  ")])]));
  const editor = openEditor();
  assert.equal(logic.dirty(editor, state.doc.notes[0]), false);
  assert.equal(logic.activeLabel(state), " Padded ");
  logic.bodyInput("note-1", "text");
  assert.equal(logic.dirty(editor, state.doc.notes[0]), true, "the text is compared as written");
  logic.cancel("note-1");
});

test("a save waits for OverCrow's answer: stored, the editor closes; refused, the draft stays", () => {
  reset();
  let editor = openEditor();
  logic.titleInput("note-1", "Expedition II");
  logic.saving("note-1");
  assert.equal(editor.pending, true);
  assert.equal(state.busy, 1);
  assert.equal(logic.canSave(state, editor), false, "one save at a time");
  logic.saving("note-1");
  assert.equal(state.busy, 1, "a second click sends nothing more");
  logic.saved("note-1", "rejected", { code: "unavailable" });
  assert.equal(state.error, "error-unavailable");
  assert.equal(state.busy, 0);
  editor = logic.editorOf(state, "note-1");
  assert.equal(editor.title, "Expedition II", "the draft is kept");
  assert.equal(logic.editing(state), true);
  assert.equal(vm.timers.filter((timer) => !timer.cancelled).length, 0, "no timer left");

  logic.keyed("note-1", "Enter", false);
  assert.equal(editor.pending, false, "Enter alone saves nothing");
  logic.keyed("note-1", "Enter", true);
  assert.equal(editor.pending, true, "Ctrl+Enter does");
  logic.saved("note-1", "accepted", undefined);
  assert.equal(state.error, "");
  assert.equal(logic.editorOf(state, "note-1"), null, "the editor closed");
  assert.equal(logic.editing(state), false);
  assert.equal(state.busy, 0);
});

test("a save refused for its empty title says so", () => {
  reset();
  openEditor();
  logic.titleInput("note-1", " ");
  logic.keyed("note-1", "Enter", true);
  logic.saved("note-1", "rejected", { code: "invalid_request" });
  assert.equal(state.error, "add-title");
});

test("should OverCrow give no answer, the editor comes back after 40 s", () => {
  reset();
  const editor = openEditor();
  logic.saving("note-1");
  vm.advance(logic.ANSWER_MS - 1);
  assert.equal(editor.pending, true);
  vm.advance(1);
  assert.equal(editor.pending, false);
  assert.equal(state.busy, 0);
  assert.equal(state.error, "error-unavailable");
  logic.cancel("note-1");
});

test("Cancel discards the draft; the next editor starts from the stored note", () => {
  reset();
  const editor = openEditor();
  logic.titleInput("note-1", "Changed");
  logic.dropRow("note-1", editor.rows[0].key);
  logic.cancel("note-1");
  assert.equal(logic.editorOf(state, "note-1"), null);
  assert.equal(logic.drafted(state, "note-1"), false);
  logic.edit("note-1");
  assert.deepEqual(
    logic.editorOf(state, "note-1").rows.map((row) => row.id),
    ["local-1", "local-2", "local-3", null],
  );
  assert.equal(logic.editorOf(state, "note-1").title, null, "until OverCrow fills the new form");
});

test("choosing another note keeps a draft, hidden, and closes an unchanged editor", async () => {
  reset();
  openEditor();
  logic.titleInput("note-1", "Expedition II");
  logic.select("note-2");
  assert.deepEqual(vm.lastCall("notes.select").params, { note: "note-2" });
  vm.lastCall("notes.select").resolve(null);
  await flush();
  vm.push(SERVICE, doc(undefined, "note-2"));
  const draft = logic.editorOf(state, "note-1");
  assert.ok(draft, "the draft's form stays in the view");
  assert.equal(draft.open, false);
  assert.equal(logic.editorClass(state, draft), "editor hidden");
  assert.equal(logic.editing(state), false);
  assert.equal(logic.noteLabel(state, state.doc.notes[0]), "Expedition •");
  assert.equal(logic.activeLabel(state), "Build ideas");

  // An editor without a change does not stay behind.
  openEditor("note-2");
  logic.select("note-1");
  vm.lastCall("notes.select").resolve(null);
  await flush();
  vm.push(SERVICE, doc(undefined, "note-1"));
  assert.equal(logic.editorOf(state, "note-2"), null);
  // Back on the first note: the preview, and the pencil opens the draft.
  assert.equal(logic.editing(state), false);
  logic.edit("note-1");
  assert.equal(logic.editing(state), true);
  assert.equal(logic.editorOf(state, "note-1").title, "Expedition II");
  logic.cancel("note-1");
});

test("a draft is hidden in Passive mode and back in Interactive mode", () => {
  reset();
  const editor = openEditor();
  logic.bodyInput("note-1", "Changed");
  vm.setHost({ mode: "passive" });
  assert.equal(logic.editorClass(state, editor), "editor hidden");
  assert.equal(logic.editing(state), false);
  assert.equal(state.editors.length, 1, "the form stays in the view");
  vm.setHost({ mode: "interactive" });
  assert.equal(logic.editorClass(state, editor), "editor");
  assert.equal(editor.body, "Changed");
  logic.cancel("note-1");
});

test("a new note's editor is there from the click, and gets its note with OverCrow's answer", async () => {
  reset();
  logic.create();
  assert.equal(state.busy, 1);
  // In the turn of the click: the form exists and shows, so that its title
  // takes the focus; it has no note yet and cannot be saved.
  assert.equal(state.editors.length, 1);
  const editor = state.editors[0];
  assert.equal(editor.note, null);
  assert.equal(logic.shownEditor(state), editor);
  assert.equal(logic.editing(state), true);
  assert.equal(logic.editorClass(state, editor), "editor");
  assert.deepEqual(
    editor.rows.map((row) => row.id),
    [null],
    "one empty row",
  );
  logic.titleInput(editor.key, "Typed early");
  assert.equal(logic.canSave(state, editor), false, "no note to save to yet");
  logic.saving(editor.key);
  assert.equal(editor.pending, false);
  // A change of the document meanwhile keeps the editor.
  vm.push(SERVICE, doc([expedition(), note("note-2", "Build ideas")]));
  assert.equal(logic.shownEditor(state), editor);

  vm.lastCall("notes.create").resolve({ note: note("note-3", "Note 3") });
  await flush();
  assert.equal(editor.note, "note-3", "the form now has its target");
  assert.equal(state.editors.length, 1, "the same form, not another one");
  assert.equal(logic.shownEditor(state), editor, "before the document names the new note");
  vm.push(SERVICE, doc([expedition(), note("note-2", "Build ideas"), note("note-3", "Note 3")], "note-3"));
  assert.equal(logic.shownEditor(state), editor);
  assert.equal(editor.fresh, false, "its note is the active one");
  assert.equal(logic.editorOf(state, "note-3"), editor);
  // OverCrow fills the form: Save is active.
  logic.titleInput(editor.key, "Note 3");
  logic.bodyInput(editor.key, "");
  assert.equal(logic.canSave(state, editor), true);
  logic.cancel(editor.key);
  assert.equal(state.editors.length, 0);
});

test("a note that cannot be created leaves no editor and says why", async () => {
  reset();
  const eight = Array.from({ length: 8 }, (_, index) => note(`note-${index + 1}`, `Note ${index + 1}`));
  vm.push(SERVICE, doc(eight));
  assert.equal(logic.full(state), true);
  for (const [code, message] of [
    ["quota_exceeded", "error-full"],
    ["unavailable", "error-unavailable"],
    ["permission_denied", "error-permission"],
  ]) {
    logic.create();
    assert.equal(state.editors.length, 1);
    vm.lastCall("notes.create").reject(code);
    await flush();
    assert.equal(state.editors.length, 0, `${code}: no orphan editor`);
    assert.equal(logic.editing(state), false);
    assert.equal(state.error, message);
    assert.equal(state.busy, 0);
  }
});

test("going elsewhere before the new note exists drops its editor; a draft elsewhere is kept", async () => {
  reset();
  openEditor();
  logic.titleInput("note-1", "Changed");
  logic.create();
  assert.equal(state.editors.length, 2, "the draft is kept aside");
  const fresh = state.editors.find((editor) => editor.note === null);
  assert.equal(logic.shownEditor(state), fresh);
  // The user chooses another note before OverCrow answered.
  logic.select("note-2");
  assert.equal(state.editors.includes(fresh), false);
  vm.lastCall("notes.create").resolve({ note: note("note-3", "Note 3") });
  await flush();
  assert.equal(logic.editorOf(state, "note-3"), null, "the note exists, without an editor");
  assert.equal(logic.drafted(state, "note-1"), true);
  // Two notes created in a row have two forms.
  logic.create();
  const first = logic.shownEditor(state);
  logic.create();
  const second = logic.shownEditor(state);
  assert.notEqual(first.key, second.key);
  assert.equal(state.editors.includes(first), false, "the first one left with the second click");
  for (const call of vm.calls.filter((pending) => !pending.settled)) {
    call.reject("unavailable");
  }
  await flush();
  assert.equal(state.editors.some((editor) => editor.note === null), false);
});

test("a deletion is OverCrow's to confirm: declined, nothing is said; done, the note's editor goes", async () => {
  reset();
  openEditor();
  logic.titleInput("note-1", "Changed");
  logic.remove("note-1");
  assert.deepEqual(vm.lastCall("notes.delete").params, { note: "note-1" });
  vm.lastCall("notes.delete").reject("cancelled");
  await flush();
  assert.equal(state.error, "");
  assert.ok(logic.editorOf(state, "note-1"), "the draft is untouched");

  logic.remove("note-1");
  vm.lastCall("notes.delete").resolve(null);
  await flush();
  vm.push(SERVICE, doc([note("note-2", "Build ideas")], "note-2"));
  assert.equal(logic.editorOf(state, "note-1"), null);
  assert.equal(logic.chevronClass(state), "selector-icon none", "one note: nothing to choose");

  vm.push(SERVICE, doc([]));
  assert.equal(logic.noteCount(state), 0);
  assert.equal(logic.activeId(state), "");
});

test("a failure's message stays until something is stored", async () => {
  reset();
  logic.remove("note-2");
  vm.lastCall("notes.delete").reject("unavailable");
  await flush();
  assert.equal(state.error, "error-unavailable");
  vm.setHost({ mode: "passive" });
  assert.equal(state.error, "error-unavailable", "not cleared by a mode change");
  vm.push(SERVICE, doc([expedition()]));
  assert.equal(state.error, "", "the stored document changed");
});

test("a note deleted elsewhere takes its editor with it", () => {
  reset();
  openEditor();
  logic.titleInput("note-1", "Changed");
  vm.push(SERVICE, doc([note("note-2", "Build ideas")], "note-2"));
  assert.deepEqual(state.editors, []);
});

test("a full checklist has no empty row and says so", () => {
  const items = Array.from({ length: 64 }, (_, index) => item(`local-${index + 1}`, `Entry ${index + 1}`));
  reset(doc([note("note-1", "Long", "", items)]));
  const editor = openEditor();
  assert.equal(editor.rows.length, 64);
  assert.equal(logic.rowsFull(editor), true);
  logic.dropRow("note-1", editor.rows[0].key);
  const after = logic.editorOf(state, "note-1");
  assert.equal(after.rows.length, 64, "63 entries and the empty row");
  assert.equal(logic.rowsFull(after), false);
  logic.cancel("note-1");
});

test("the note list opens and closes; one note has no list", () => {
  reset();
  logic.toggleMenu();
  assert.equal(state.menu, true);
  assert.equal(logic.listItemClass(state, state.doc.notes[0]), "list-item current");
  assert.equal(logic.listItemClass(state, state.doc.notes[1]), "list-item");
  logic.select("note-1");
  assert.equal(state.menu, false, "choosing the active note only closes the list");
  assert.equal(vm.calls.filter((call) => call.service === "notes.select" && !call.settled).length, 0);
  logic.toggleMenu();
  vm.setHost({ mode: "passive" });
  assert.equal(state.menu, false, "closed in Passive mode");
});

test("labels carry the note's title within the label bound", () => {
  assert.equal(logic.titled("edit-note", "Boss"), "Edit note: Boss");
  assert.equal(logic.titled("delete-note", "Boss"), "Delete note: Boss");
  const long = logic.titled("edit-note", "é".repeat(200));
  assert.ok(new TextEncoder().encode(long).length <= 256);
  assert.equal(logic.cutBytes("héllo", 2), "h");
});

test("a failed source says so and the widget asks again 5 s later", () => {
  reset();
  vm.fail(SERVICE, "unavailable");
  assert.equal(logic.phase(state), "unavailable");
  assert.equal(logic.unavailableKey(state), "error-unavailable");
  const before = vm.subscriptions.length;
  vm.advance(logic.RETRY_MS);
  assert.equal(vm.subscriptions.length, before + 1);
  vm.push(SERVICE, doc());
  assert.equal(logic.phase(state), "ready");
});

test("every message exists in English and French", () => {
  const [en, fr] = [messages("en"), messages("fr")];
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const key of ["error-unavailable", "error-full", "error-permission", "add-title"]) {
    assert.ok(en[key] && fr[key], key);
  }
  assert.equal(logic.errorKey("quota_exceeded"), "error-full");
  assert.equal(logic.errorKey("stale_context"), "error-unavailable");
  assert.equal(logic.errorKey(null), "error-unavailable");
});
