# The view

`view.ocml` describes what a PlayerVox OverCrow widget shows: a tree of
elements, bound to the widget's state with `{…}` expressions. It looks like
HTML or JSX, but it is neither: the set of elements is closed, there is no
DOM and no script in the view. OverCrow lays out and paints the tree
itself.

<!-- source: templates/list/view.ocml -->
```xml
<box class="checklist">
  <text class="title">{t("title")}</text>
  <list class="items" item-height="32">
    <for each={state.items} as="item" key={item.id}>
      <box class="row">
        <checkbox label={item.text} checked={item.done} on:change={setDone(item.id, event.value)}/>
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
        <button class="remove" label={t("remove")} on:activate={remove(item.id)}>
          <icon name="x"/>
        </button>
      </box>
    </for>
  </list>
  <text class="summary">{t("remaining", { count: remaining(state.items) })}</text>
</box>
```

This is the checklist template: a title, a scrolling `list` that repeats a
row per item, and a summary. The logic exports `setDone`, `remove` and
`remaining`; `t` reads the messages of `locales/`.

The view is compiled when the widget is packaged: `overcrow-widget check`
reports every mistake with its line and column, and an unknown element,
attribute or event is an error, never ignored. The source file itself is
not shipped.

## Markup

- The file is UTF-8, without a byte-order mark.
- The document is a list of top-level nodes: `<component>` declarations and
  the children of the widget's root, which is a `box`.
- Elements are lowercase: `<name …>…</name>` or `<name …/>`.
- An attribute value is quoted text (`"…"` or `'…'`), an expression
  (`{…}`), or nothing, which means `true`: `<button submit>`. Attributes
  are separated by whitespace and never repeated.
- Comments are `<!-- … -->`, without `--` inside.
- DOCTYPE, processing instructions, CDATA sections and namespaces are
  refused.

The entities are `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&lbrace;`
`&rbrace;` `&nbsp;`, and `&#…;` or `&#x…;` for any character that is not a
control character. A literal `{` or `}` in a quoted value, and a lone `}`
in text, are refused: write `&lbrace;` and `&rbrace;`.

## Elements

Each element has a fixed content, a set of attributes and the events it can
send. Containers (`box`, `scroll`, `list`, `form`, `popover`, `button`)
hold other elements; `text` holds text and inline children; the others are
leaves that OverCrow draws: `icon`, `image`, `toggle`, `slider`, `field`,
`chart`, `gauge`…

<!-- generated:element-list -->
| Element | Meaning |
| --- | --- |
| [`box`](elements.md#box) | Generic container; flex or grid layout comes from style. The root of the view is a `box`. |
| [`scroll`](elements.md#scroll) | Clipping container scrolled by the host with wheel, drag and keyboard. |
| [`list`](elements.md#list) | Vertical scrolling list whose children are laid out and painted only when visible. |
| [`text`](elements.md#text) | Block of wrapped text; its inline children flow with it (chat line with emotes). |
| [`span`](elements.md#span) | Styled run of text inside `text`. |
| [`icon`](elements.md#icon) | Lucide icon tinted with `color`, sized by `font-size` unless `width` and `height` are set. |
| [`image`](elements.md#image) | Raster image from the package, or an image handed by a service (an `asset:` handle); `object-fit` applies. |
| [`avatar`](elements.md#avatar) | Round image with a text fallback while the image is missing or failed. |
| [`badge`](elements.md#badge) | Short pill of text. |
| [`button`](elements.md#button) | Activatable control; its children (icon, text) form its content. |
| [`toggle`](elements.md#toggle) | On/off switch. |
| [`checkbox`](elements.md#checkbox) | Check control (checklists). |
| [`slider`](elements.md#slider) | Numeric range control; dragging is handled by the host. |
| [`select`](elements.md#select) | Drop-down choice; the open list is drawn by the host. |
| [`option`](elements.md#option) | Choice of a `select`; its text is the visible label. |
| [`field`](elements.md#field) | Single-line text input edited by the host, input methods (IME) included. |
| [`textarea`](elements.md#textarea) | Multi-line text input edited by the host, input methods (IME) included. |
| [`form`](elements.md#form) | Groups named controls. With `intent`, submitting sends their values to a write service directly from the host; the widget's logic never supplies that content. |
| [`elapsed`](elements.md#elapsed) | Duration text advanced by the host from an anchor given by a service, so a running stopwatch needs no work from the logic. Styled like `text`; repainted only when the shown text changes, at most at `ANIMATION_RATE_HZ`, and never while hidden. |
| [`progress`](elements.md#progress) | Horizontal progress bar. |
| [`gauge`](elements.md#gauge) | Ring or arc gauge. |
| [`chart`](elements.md#chart) | Line, area, bar or sparkline chart drawn by the host. |
| [`series`](elements.md#series) | One data series of a `chart`, coloured with `color`. |
| [`separator`](elements.md#separator) | Thin rule between groups. |
| [`canvas`](elements.md#canvas) | Surface painted by the host from the latest list of commands given to `draw`. |
| [`popover`](elements.md#popover) | Floating panel anchored to an element, drawn above the content and clipped to the widget's frame (drop-downs, context menus). |
<!-- /generated:element-list -->

[Elements and attributes](elements.md) gives the attributes and events of
each one.

## Text

Text is allowed only in `text`, `span`, `badge` and `option`. A `text` holds
either text or inline children (`span`, `icon`, `image`), not both: to
style one word, put every run in a `span`.

<!-- source: widgets/performance/view.ocml -->
```xml
      <text class={row.valueClass} label={row.name} tooltip={row.hint}><span>{row.value}</span><if test={row.unit != ""}><span class="unit">{row.unit}</span></if></text>
```

Whitespace follows the rule of JSX:

- tabs become spaces;
- a line break between two words becomes one space;
- a line break next to a tag or an expression disappears with its
  indentation;
- a run of whitespace next to a tag is dropped; one between two expressions
  on the same line is kept.

So a break before an expression removes the space before it: write
`you have {state.count} messages` on one line to keep both spaces, or
write `&#32;` where you need a space that the rule would remove.

## Attributes

A quoted value is converted to the attribute's type and checked when the
view is compiled:

| Type | Quoted value |
| --- | --- |
| boolean | `true` or `false`; the bare attribute means `true` |
| integer | a decimal integer, without a leading zero |
| number | a decimal number, without an exponent |
| number list | numbers separated by spaces: `values="12 18.5 30"` |
| text, identifier | the text itself |
| image | a file of the package: `src="assets/logo.png"` |

`attr={expression}` binds the attribute to an expression instead; OverCrow
checks every value the widget sends. Values that exist only when the widget
runs, such as an image handed by a service, must be bound.

Five attributes exist on every element:

<!-- generated:common-attributes -->
| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `class` | class list | no | Style classes: distinct names separated by one space. |
| `ref` | static `ref` name | no | Name by which `draw` designates this `canvas` and by which an attribute such as the `anchor` of a `popover` designates this element. Static, unique in the view, and not allowed inside a `for` or a component body, where it would name several elements. |
| `label` | text ≤ `MAX_LABEL_BYTES` | no | Accessible name; required on icon-only controls. |
| `tooltip` | text ≤ `MAX_LABEL_BYTES` | no | Plain text drawn by the host on hover or focus. |
| `on` | sorted event names | no | Events forwarded to the logic; written `on:<event>` in the view. |
<!-- /generated:common-attributes -->

`class` is the hook of the [style](style.md). `label` is the accessible
name of the element: give one to every control whose content is an icon.

### Names for nodes: `ref`

`ref="name"` gives a node a name. Two things use it: `draw(name, commands)`
paints the `canvas` of that name, and a `popover` is placed against the
node its `anchor` names.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<box ref="panel" class="countdown" on:contextmenu={openMenu}>
```

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<popover anchor="panel" placement="pointer" open={state.menu} on:dismiss={closeMenu}>
  <button class="menu-row" on:activate={resetRounds}>
    <text class="menu-text">{t("reset-rounds")}</text>
  </button>
</popover>
```

A `ref` is always quoted, unique in the view, and refused inside a `for` or
a component, where it would name several nodes.

## Events

`on:event={handler}` asks OverCrow to send an event of the element to the
logic. Without it, the widget does not hear about the event at all: a
widget is not told about pointer moves or key presses it has not asked for.

A handler is written in one of two ways:

- **the name of a function** exported by the logic, called with the event's
  detail: `on:activate={increment}`;
- **a call**, with the arguments you choose; in it, `event` is the event's
  detail: `on:change={setDone(item.id, event.value)}`.

<!-- source: templates/list/view.ocml -->
```xml
        <checkbox label={item.text} checked={item.done} on:change={setDone(item.id, event.value)}/>
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
        <button class="remove" label={t("remove")} on:activate={remove(item.id)}>
          <icon name="x"/>
        </button>
```

The events are `activate`, `contextmenu`, `wheel`, `keydown`, `input`,
`change`, `submit`, `focus`, `blur`, `reachend`, `stick` and `dismiss`;
[events](elements.md#events) describes each one and the detail it carries,
and each [element](elements.md#elements) lists the ones it sends. Some of
them are user actions, during which a widget may call a protected service;
see [calls that need a user action](services.md#calls-that-need-a-user-action).
Widgets receive input only in OverCrow's Interactive mode: in Passive mode,
clicks go through them to the game.

## Conditions, loops and components

<!-- generated:constructs -->
| Syntax | Meaning |
| --- | --- |
| `{expr}` | Interpolates an expression into text or an attribute value. |
| `<if test={expr}> … <else-if test={expr}> … <else>` | Conditional subtree. |
| `<for each={expr} as="item" key={expr}>` | Repeats a subtree; `key` is mandatory and must be unique among siblings. |
| `<component name="x" props="a b"> … <slot/> … </component>` | Local component with declared properties and one slot, used as `<x a={…}>`. |
| `on:<event>={handler}` | Subscribes the element to one of its events and names the handler of the logic. |
<!-- /generated:constructs -->

### `if`, `else-if`, `else`

<!-- source: widgets/stopwatch/view.ocml -->
```xml
        <if test={state.stopwatch.running}>
          <icon name="pause"/>
        </if>
        <else>
          <icon name="play"/>
        </else>
```

`else-if` and `else` follow an `if` directly; only whitespace and comments
may separate them.

### `for`

`for` repeats its children for each item of a list. `each`, `as` and `key`
are all required, and the key must be unique among the repeated items: it
is how OverCrow knows which row moved, appeared or went away.

<!-- source: widgets/warframe-market/view.ocml -->
```xml
      <for each={state.results} as="item" key={item.slug}>
        <button class="result" label={item.name} on:activate={select(item.slug)}>
          <text class="result-name">{item.name}</text>
          <icon class="result-arrow" name="chevron-right"/>
        </button>
      </for>
```

For a long list, put the `for` in a `list` element: OverCrow lays out and
paints only the rows that are visible.

### Components

A component is a piece of view with a name and declared properties, to
write once and use several times. It is local to the view.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<component name="stat" props="name value">
  <box class="stat">
    <text class="stat-name">{name}</text>
    <text class="stat-value">{value}</text>
  </box>
</component>
```

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
  <stat name={t("state")} value={stateText(state.running, state.remainingMs)}/>
```

- Components are declared at the top level, once each, with a name that is
  not an element's.
- The body sees only its own properties, not the names around the place
  where it is used. Pass what it needs.
- A use passes declared properties only. A quoted property is text; bind
  it (`value={5}`) for any other type.
- A body may contain one `<slot/>`, where the children of each use go.
- A component cannot contain itself, and a use cannot take `on:` handlers:
  put them on elements inside the body.

`if`, `for` and components are transparent for the content rules: their
children must suit the element around them.

## Expressions

Expressions are a small, strict subset of JavaScript:

- literals: numbers (`0`, `12`, `1.5`), strings, `true`, `false`, `null`,
  array and object literals;
- names in scope and their members: `a.b`, `a?.b`, `a[i]`, `a?.[i]`;
- operators: `!`, unary `-` and `+`, `* / %`, `+ -`, `< <= > >=`,
  `== != === !==`, `&&`, `||`, `??`, and `a ? b : c`. `??` cannot be mixed
  with `&&` or `||` without parentheses;
- calls of functions exported by the logic, by their bare name:
  `remaining(state.items)`. `t(key, params)` is one of them.

The names in scope are `state`, the `as` names of the enclosing `for`s, the
properties of the enclosing component, and `event` in a handler. A name
cannot hide another one.

There is no assignment, no arrow or function literal, no `new`, `this`,
template literal, regular expression, method call or global: anything more
than a simple computation belongs in a function of the logic. This is what
keeps the view checkable: when a widget is packaged, every expression is
compiled into a function of `logic.js`, and the view itself carries no
code.

<!-- source: templates/list/view.ocml -->
```xml
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
```

JavaScript reserved words, `constructor`, `prototype`, `eval`, `undefined`,
`globalThis`, `overcrow` and any name starting with `__` are refused.

## When the view is wrong

Every problem is a diagnostic of `overcrow-widget check`, with a stable
code:

| Code | Problem |
| --- | --- |
| `view.syntax`, `view.encoding`, `view.size`, `view.invalid_entity` | The file is not well-formed markup. |
| `view.unknown_element`, `view.invalid_parent` | An element that does not exist, or in a place it cannot be. |
| `view.unknown_attribute`, `view.duplicate_attribute`, `view.invalid_attribute`, `view.missing_attribute` | An attribute that the element does not have, written twice, with a wrong value, or required and absent. |
| `view.unknown_event`, `view.invalid_handler` | An event the element does not send (or put on a component use), or a handler that is neither a name nor a call. |
| `view.expression_syntax`, `view.expression_too_long`, `view.expression_too_deep`, `view.expression_too_many_entries` | An expression outside the subset or its bounds. |
| `view.reserved_name`, `view.unknown_name` | A refused name, or one that is not in scope. |
| `view.invalid_text` | Text where the element takes none, or mixed with inline children. |
| `view.invalid_component`, `view.recursive_component`, `view.invalid_slot`, `view.invalid_construct` | A component, slot, `if` or `for` that breaks its rules. |
| `view.invalid_ref`, `view.unknown_ref` | A `ref` that is not unique or is inside a `for`, or an `anchor` that names none. |
| `view.missing_asset` | A static image that is not in `assets/`. |
| `view.bound_value` | A `value` on a control of a form bound to a write intent; see [forms](forms.md#forms-that-write-user-data). |
| `view.too_many_elements`, `view.too_many_components`, `view.too_many_children`, `view.too_many_expressions`, `view.too_deep` | A [limit](limits.md) of the view is exceeded. |
| `logic.missing_export` | The view calls a function that the logic does not export. |
