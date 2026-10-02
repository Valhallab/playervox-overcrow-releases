# Forms and write intents

A PlayerVox OverCrow widget takes input through controls that OverCrow
draws and edits itself: buttons, toggles, checkboxes, sliders, drop-down
lists, text fields. The logic hears about them through events. A `form`
groups controls and submits them together, and a form bound to a **write
intent** is how a widget lets the user write to their notes, publish a
rating or send a chat message, without the text ever passing through the
widget's code.

Widgets receive input only in OverCrow's Interactive mode. In Passive mode
a click goes through the widget to the game: hide or disable what cannot be
used, as the built-ins do with `host.mode`.

## Controls

| Element | Value | Events |
| --- | --- | --- |
| `button` | none | `activate` |
| `toggle`, `checkbox` | `checked` | `change` |
| `slider` | `value`, between `min` and `max` | `input` while dragging, `change` on release |
| `select` with `option` children | `value` of the chosen option | `change` |
| `field` | one line of text | `input` at each edit, `change` on Enter or when the focus leaves, `submit` on Enter |
| `textarea` | several lines of text | `input`, `change`, `submit` on Ctrl+Enter |

Each takes a `label`, its accessible name, and `disabled`. Their attributes
are in [elements and attributes](elements.md).

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
    <select class="duration" value={minutesValue(state.minutes)} label={t("duration")} disabled={state.running} on:change={setMinutes}>
      <for each={state.durations} as="minutes" key={minutes}>
        <option value={minutesValue(minutes)}>{t("minutes", { count: minutes })}</option>
      </for>
    </select>
```

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
export function setMinutes(event: { value: unknown }): void {
  const minutes = Number(event.value);
  if (state.durations.includes(minutes)) {
    state.minutes = minutes;
    state.remainingMs = total(minutes);
  }
}
```

The view binds the control to the state (`value={…}`, `checked={…}`), and
the handler writes the new value back. The detail of `input` and `change`
is `{ value }`: a boolean for a toggle or a checkbox, a number for a
slider, text for the others.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
    <toggle class="repeat" label={t("repeat")} tooltip={t("repeat")} checked={state.repeat} on:change={setRepeat}/>
```

### Text fields

OverCrow edits the text of a `field` or a `textarea` itself: the caret, the
selection, copy and paste, and input methods for languages that compose
characters. The logic receives a copy of the text in each `input` event.

<!-- source: widgets/warframe-market/view.ocml -->
```xml
      <field class="query" label={t("search-field")} value={state.query} placeholder={t("placeholder")} max-length="256" on:input={search}/>
```

<!-- source: widgets/warframe-market/logic.ts -->
```ts
export function search(detail: { value: unknown }): void {
  state.query = typeof detail.value === "string" ? detail.value : "";
  state.results = searchItems(items, lowered, state.query);
  state.detail = null;
  state.loadingOrders = false;
  state.copy = null;
  if (state.error === "orders_unavailable") {
    state.error = null;
  }
  selection += 1;
  saveQuery();
}
```

Binding `value` replaces what the field holds: bind it to the state your
`input` handler writes, as above, or leave it out and only listen.
`max-length` bounds the text in bytes, and `placeholder` shows a hint while
the field is empty.

A field also sends `keydown` when you ask for it, with the key and its
modifiers, for shortcuts such as Escape to cancel. Keys that OverCrow
reserves (Tab to move the focus, its own shortcuts, a composition in
progress) are not delivered.

### The focus when an editor opens

The logic cannot move the keyboard focus. A `field` or a `textarea` that
carries `autofocus` takes it by itself when it appears while the logic
handles a user action: a click on an Edit button that opens an editor puts
the caret in the field, after its text, as a click in it would.

<!-- source: widgets/notes/view.ocml -->
```xml
        <field class="title-field" name="title" autofocus placeholder={t("title-hint")} label={t("title-hint")} on:input={titleInput(editor.note, event.value)} on:keydown={keyed(editor.note, event.key, event.ctrl)}/>
```

OverCrow gives that focus only when the element appears during a
[user action](services.md#calls-that-need-a-user-action), in Interactive
mode, in the widget the user acted on; when several such elements appear
together, the first one of the view takes it. An element that appears when
the widget starts, from a timer or from the answer of a service (after an
`await` in the handler of the click too) does not take the focus, and
neither does an element that was already shown: `autofocus` is read when
the element appears. Give it to one field of an editor, and not to a field
that appears while the user types, such as a new row of a list.

## Forms

A `form` groups controls and gives them one `submit` event. It is
submitted by Enter in a `field`, by Ctrl+Enter in a `field` or a
`textarea`, or by activating a button with the `submit` attribute.

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
      <form class="selector" on:submit={join}>
        <field class="input channel" max-length="26" autofocus placeholder={t("channel-name")} label={t("channel-name")} on:input={channelTyped(event.value)}/>
        <button class="action" submit disabled={!canJoin(state)}>
          <text class="action-label">{t("join")}</text>
        </button>
      </form>
```

<!-- source: widgets/twitch-chat/logic.ts -->
```ts
export function join(): void {
  const channel = normalizeChannel(state.channelDraft);
  if (channel !== null) {
    joinChannel(channel);
  }
}
```

This form has no intent: its `submit` handler reads what the `input`
handler kept in the state, and calls a service. `submit` is a user action,
so the handler may call a service that needs one
(`twitch.chat.join` here).

A form keeps what the user entered for as long as it stays in the view.
Hide it with `display: none` to keep a draft; remove it from the view to
discard one. To start over with empty fields, give the form a new key in a
`for`: a new key is a new form.

## Forms that write user data

Three things a widget can do write text that the user typed into the
user's own data: saving a note, publishing a PlayerVox rating with its
review, and sending a Twitch chat message. They are not service calls. A
form with an `intent` attribute sends them:

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
    <form class={composerClass(state)} intent="twitch.chat.send" target={replyTarget(state)} on:submit={submitted(event.outcome, event.error)}>
      <if test={state.reply}>
        <box class="replying">
          <text class="replying-label">{replyingTo(state)}</text>
          <button class="icon-button small" label={t("cancel-reply")} tooltip={t("cancel-reply")} on:activate={cancelReply}>
            <icon name="x"/>
          </button>
        </box>
      </if>
      <if test={state.sendError != ""}>
        <text class="error">{t(state.sendError)}</text>
      </if>
      <box class="compose">
        <field class="input message-field" name="message" max-length="500" placeholder={t(composerHint(state))} label={t("message-label")} disabled={!state.canSend} on:input={drafted(event.value)} on:keydown={keyed(event.key)}/>
        <if test={sendMark(state) != ""}>
          <text class={sendMarkClass(state)}>{t(sendMark(state))}</text>
        </if>
        <button class="action" submit disabled={!canSubmit(state)} on:activate={sendPressed}>
          <text class="action-label">{t("send")}</text>
        </button>
      </box>
    </form>
```

When the user submits such a form, **OverCrow reads the values of the
form's own controls and sends them itself**. The widget's logic never
supplies the text, so a widget cannot write something the user did not
type, and cannot submit without the user: the form goes only on a user
action, in Interactive mode, with the capability granted.

What this changes for the view and the logic:

- **The controls belong to OverCrow.** The `field`, `textarea` and `slider`
  controls of the form take no `value`: `overcrow-widget check` refuses it
  (`view.bound_value`), and OverCrow stops a widget that sets one at run
  time. Their `name` attribute says which field of the intent each one is.
- **OverCrow fills them** where the intent says so: the note's title, body
  and checklist, the user's published rating. A fill sends the control's
  `input` event with the value, so the logic knows what is shown; that
  event is not a user action.
- **The logic follows through `input` events**, to show a counter or to
  enable the button, and may disable the controls.
- **The outcome arrives in the form's `submit` event**: `event.outcome` is
  `accepted`, `rejected` (with the [error code](services.md#errors) in
  `event.error`) or `cancelled`. A form without an intent gives
  `submitted`.

<!-- source: widgets/playervox-rating/view.ocml -->
```xml
      <slider class="criterion-slider" name="gameplay" min="0" max="100" step="1" label={t("gameplay")} disabled={!editable(state)} on:input={scored("gameplay", event.value)}/>
```

<!-- source: widgets/playervox-rating/logic.ts -->
```ts
export function scored(key: CriterionKey, value: number): void {
  state[key] = value;
  edited();
}
```

<!-- source: widgets/playervox-rating/logic.ts -->
```ts
export function submitted(outcome: string, error: ServiceErrorPayload | undefined): void {
  state.pending = Math.max(0, state.pending - 1);
  if (state.pending === 0) {
    answer?.cancel();
    answer = null;
  }
  if (outcome === "accepted") {
    // The subscription sends the stored rating; nothing is read again.
    state.saved = true;
    state.error = "";
  } else if (outcome !== "cancelled") {
    state.error = errorKey(error?.code ?? null);
  }
}
```

A write does not change what a subscription says by itself: after an
accepted rating, `playervox.rating.subscribe` delivers the stored rating,
and the widget shows that.

### The intents

<!-- generated:write-intents -->
### `notes.save`

Capability `notes.write`; `target` attribute required (note ID; the host fills the bound controls from that note). Enter in a `field` of the form moves the focus to its next `field` or `textarea` and does not submit; Ctrl+Enter and a `submit` button do.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | text ≤ 96 bytes | yes | `field`; saved trimmed, and not empty. |
| `body` | text ≤ 8 KiB | no | `textarea`; saved as written. |
| `item` | list of `NoteItem` ≤ 64 | no | One `field` per checklist row, in order, each ≤ 256 bytes. The host remembers which item it filled each field with: a row keeps that item's ID and check whichever rows the widget removes or moves, and a field that appeared since is a new, unchecked item. Rows are saved trimmed; an empty row is dropped. A note saved as it is stored is accepted without a write. |

### `playervox.rating.publish`

Capability `playervox.rating.write`; `target` attribute refused.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `gameplay` | integer 0 to 100 | yes | `slider`; filled from the user's rating, 50 before the first one. |
| `art` | integer 0 to 100 | yes | `slider`; filled like `gameplay`. |
| `tech` | integer 0 to 100 | yes | `slider`; filled like `gameplay`. |
| `review` | text ≤ 2000 characters | no | `textarea`; filled from the published review. An unchanged review is not sent again; an emptied one removes it. |

### `twitch.chat.send`

Capability `twitch.chat.compose`; `target` attribute optional (ID of the message replied to).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `message` | text ≤ 500 characters | yes | `field`; the host clears it after a successful send. |
<!-- /generated:write-intents -->

`target` is the form's attribute that names the object written: the note's
ID for `notes.save`, the ID of the message replied to for
`twitch.chat.send`.

### Several rows of one field

The `notes.save` intent takes one `item` field per checklist row. The
logic decides which rows the form has, with a `for`; OverCrow fills each
row's field from the stored note and remembers which checklist entry it
put there. A row that the logic removes or moves keeps its entry, and a
row added since is a new entry.

<!-- source: widgets/notes/view.ocml -->
```xml
          <for each={editor.rows} as="row" key={row.key}>
            <box class="row">
              <if test={rowStored(state, editor, row)}>
                <checkbox class="row-check" checked={rowChecked(state, editor, row)} label={rowLabel(row)} on:change={check(editor.note, row.id, event.value)}/>
              </if>
              <else>
                <icon class="row-new" name="circle"/>
              </else>
              <field class="row-field" name="item" placeholder={rowHint(editor, row)} label={t("item-hint")} on:input={rowInput(editor.note, row.key, event.value)} on:keydown={keyed(editor.note, event.key, event.ctrl)}/>
```

In that form, Enter moves to the next field instead of submitting;
Ctrl+Enter or the `submit` button saves.

## Confirmations

Two services delete user data: `notes.delete` and `journal.delete`. They
are ordinary calls that need a user action, and OverCrow then asks the
user to confirm in a dialog that it draws itself, outside the widget. The
call resolves when the user confirms and fails with `cancelled` when they
decline. Do not draw your own "Are you sure?": OverCrow's is the one that
counts.

## Checklist for a form

- Every control has a `label`.
- Buttons that cannot act are `disabled`, and nothing that needs input
  shows in Passive mode.
- The `submit` handler handles a refusal: `not_connected` when the account
  is signed out, `busy` when the user sends too fast, `unavailable`.
- A form bound to an intent has no `value` on its text fields and
  sliders, and every named control is a field of the intent.
- Test it with a scenario: `text` steps type into the focused field,
  `key` steps press Enter, and `expect.intents` checks exactly what
  OverCrow sent. See [testing a widget](testing.md#steps).
