# Elements and attributes

The view of a PlayerVox OverCrow widget is made of a closed set of
elements. This page lists each one with its content, its attributes and
the events it can send. [The view](view.md) explains the markup around
them: expressions, `if`, `for`, components.

<!-- source: templates/chart/view.ocml -->
```xml
<box class="panel">
  <box class="header">
    <text class="title">{t("title")}</text>
    <text class="value">{latest(state.values)}</text>
  </box>
  <chart class="plot" kind="area" min="0" max="100">
    <series class="series" values={state.values}/>
  </chart>
</box>
```

Two `box` containers, two `text` elements bound to the state, and a `chart`
with one `series`: OverCrow draws all of it, the chart included.

## How to read an element

- **Content** is what the element may hold: *flow* is any element that can
  stand on its own in a container (all but `span`, `option` and `series`);
  *inline* is the content of a `text`; *text* is plain text; *empty* means
  the element is written `<name …/>`.
- **Parents** says where the element may be: *any flow* is any container.
- **Keyboard focus**: *always* for controls; *when subscribed* for an
  element that takes the focus only when the view listens to one of its
  events (`on:activate`…); *never* otherwise.
- **Role** is what assistive technology is told the element is.
- **Events** are the events the view may listen to with `on:<event>`.

A type such as "text ≤ `MAX_LABEL_BYTES`" names a [limit](limits.md).

## Attributes of every element

<!-- generated:common-attributes -->
| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `class` | class list | no | Style classes: distinct names separated by one space. |
| `ref` | static `ref` name | no | Name by which `draw` designates this `canvas` and by which an attribute such as the `anchor` of a `popover` designates this element. Static, unique in the view, and not allowed inside a `for` or a component body, where it would name several elements. |
| `label` | text ≤ `MAX_LABEL_BYTES` | no | Accessible name; required on icon-only controls. |
| `tooltip` | text ≤ `MAX_LABEL_BYTES` | no | Plain text drawn by the host on hover or focus. |
| `on` | sorted event names | no | Events forwarded to the logic; written `on:<event>` in the view. |
<!-- /generated:common-attributes -->

## Elements

<!-- generated:elements -->
### `box`

Generic container; flex or grid layout comes from style. The root of the view is a `box`.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | when subscribed | `group` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

No attribute of its own.

### `scroll`

Clipping container scrolled by the host with wheel, drag and keyboard.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | never | `scroll-view` | `reachend`, `stick`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `axis` | `vertical` \| `horizontal` | no | Scroll direction; default `vertical`. |
| `stick-to-end` | boolean | no | Stay at the end while content grows, until the user scrolls away (chat). Setting it again after it was off scrolls to the end. |

### `list`

Vertical scrolling list whose children are laid out and painted only when visible.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | never | `list` | `reachend`, `stick`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `stick-to-end` | boolean | no | As for `scroll`. |
| `item-height` | integer 1 to 4096 | no | Estimated child height used before a child is first measured. |

### `text`

Block of wrapped text; its inline children flow with it (chat line with emotes).

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| inline: `span`, `icon`, `image` | any flow | when subscribed | `label` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `selectable` | boolean | no | The user can select the text and copy it through the host; no widget permission involved. |

### `span`

Styled run of text inside `text`.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| text | `text` | never | `label` | none |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `color` | opaque `#rrggbb` | no | Colour from data, such as a chat author's; overrides the style colour, and the host raises its contrast to at least 4.5:1 against the panel. |

### `icon`

Lucide icon tinted with `color`, sized by `font-size` unless `width` and `height` are set.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | Lucide icon name | yes | Icon name, for example `circle-check`. |

### `image`

Raster image from the package, or an image handed by a service (an `asset:` handle); `object-fit` applies.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `src` | image source | yes | Image source. |

### `avatar`

Round image with a text fallback while the image is missing or failed.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `src` | image source | no | Image source. |
| `initials` | text ≤ `MAX_INITIALS_BYTES` | no | Fallback text. |

### `badge`

Short pill of text.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| text | any flow | when subscribed | `label` | `activate`, `contextmenu`, `wheel` |

No attribute of its own.

### `button`

Activatable control; its children (icon, text) form its content.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | always | `button` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `submit` | boolean | no | Submits the enclosing `form`. |

### `toggle`

On/off switch.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | always | `switch` | `change`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `checked` | boolean | no | State; matches `:checked`. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `checkbox`

Check control (checklists).

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | always | `check-box` | `change`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `checked` | boolean | no | State; matches `:checked`. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `slider`

Numeric range control; dragging is handled by the host.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | always | `slider` | `input`, `change`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `min` | number -1000000000 to 1000000000 | yes | Lower bound. |
| `max` | number -1000000000 to 1000000000 | yes | Upper bound, greater than `min`. |
| `step` | number -1000000000 to 1000000000 | no | Positive increment; default 1. |
| `value` | number -1000000000 to 1000000000 | no | Current value, clamped to the range; rejected on a slider bound to a write intent. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `select`

Drop-down choice; the open list is drawn by the host.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| `option` | any flow | always | `combo-box` | `change`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | text ≤ `MAX_ATTRIBUTE_TEXT_BYTES` | no | Selected option value. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `option`

Choice of a `select`; its text is the visible label.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| text | `select` | never | `list-box-option` | none |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | text ≤ `MAX_ATTRIBUTE_TEXT_BYTES` | yes | Value reported by `change`. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |

### `field`

Single-line text input edited by the host, input methods (IME) included.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | always | `text-input` | `input`, `change`, `submit`, `keydown`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | text ≤ `MAX_FIELD_TEXT_BYTES` | no | Replaces the content; rejected on a field bound to a write intent. |
| `placeholder` | text ≤ `MAX_LABEL_BYTES` | no | Hint shown while empty. |
| `max-length` | integer 1 to 16384 | no | Content limit in bytes; a write intent may impose a lower one. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `textarea`

Multi-line text input edited by the host, input methods (IME) included.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | always | `multiline-text-input` | `input`, `change`, `submit`, `keydown`, `focus`, `blur`, `contextmenu` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | text ≤ `MAX_FIELD_TEXT_BYTES` | no | As for `field`. |
| `placeholder` | text ≤ `MAX_LABEL_BYTES` | no | Hint shown while empty. |
| `max-length` | integer 1 to 16384 | no | As for `field`. |
| `rows` | integer 1 to 40 | no | Visible rows before scrolling; default 3. |
| `disabled` | boolean | no | Rejects input; matches `:disabled`. |
| `name` | identifier ≤ `MAX_IDENTIFIER_BYTES` | no | Field name inside a `form`. |

### `form`

Groups named controls. With `intent`, submitting sends their values to a write service directly from the host; the widget's logic never supplies that content.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | never | `form` | `submit` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `intent` | `notes.save` \| `playervox.rating.publish` \| `twitch.chat.send` | no | Bound write intent. |
| `target` | text ≤ `MAX_ATTRIBUTE_TEXT_BYTES` | no | Opaque ID of the edited object (note, reply parent), checked by the service. |

### `elapsed`

Duration text advanced by the host from an anchor given by a service, so a running stopwatch needs no work from the logic. Styled like `text`; repainted only when the shown text changes, at most at `ANIMATION_RATE_HZ`, and never while hidden.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `timer` | `activate`, `contextmenu`, `wheel` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `base` | integer 0 to 9007199254740991 | yes | Elapsed milliseconds at `at`. |
| `at` | integer 0 to 9007199254740991 | yes | Host monotonic milliseconds from the service result. |
| `running` | boolean | no | Advance from `at`; default `false`. |
| `format` | `hh:mm:ss` \| `hh:mm:ss.cc` \| `mm:ss` | yes | Hours grow past 99; `cc` are hundredths, truncated. |

### `progress`

Horizontal progress bar.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `progress-indicator` | `activate`, `contextmenu`, `wheel` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | number -1000000000 to 1000000000 | yes | Current value. |
| `max` | number -1000000000 to 1000000000 | no | Positive upper bound; default 1. |

### `gauge`

Ring or arc gauge.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `meter` | `activate`, `contextmenu`, `wheel` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | number -1000000000 to 1000000000 | yes | Current value. |
| `max` | number -1000000000 to 1000000000 | no | Positive upper bound; default 1. |
| `shape` | `ring` \| `arc` | no | Default `ring`. |

### `chart`

Line, area, bar or sparkline chart drawn by the host.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| `series` | any flow | when subscribed | `figure` | `activate`, `contextmenu`, `wheel` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `kind` | `line` \| `area` \| `bar` \| `sparkline` | yes | Chart type. |
| `min` | number -1000000000 to 1000000000 | no | Fixed lower bound of the value axis. |
| `max` | number -1000000000 to 1000000000 | no | Fixed upper bound of the value axis. |

### `series`

One data series of a `chart`, coloured with `color`.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | `chart` | never | `figure` | none |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `values` | number list ≤ `MAX_CHART_POINTS` | yes | Values in order. |

### `separator`

Thin rule between groups.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | never | `splitter` | none |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `axis` | `vertical` \| `horizontal` | no | Default `horizontal`. |

### `canvas`

Surface painted by the host from the latest list of commands given to `draw`.

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| empty | any flow | when subscribed | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

No attribute of its own.

### `popover`

Floating panel anchored to an element, drawn above the content and clipped to the widget's frame (drop-downs, context menus).

| Content | Parents | Keyboard focus | Role | Events |
| --- | --- | --- | --- | --- |
| flow | any flow | never | `menu` | `dismiss` |

| Attribute | Type | Required | Meaning |
| --- | --- | --- | --- |
| `anchor` | `ref` name | yes | `ref` of the element the panel is placed against. |
| `open` | boolean | no | Visibility; the host closes it and sends `dismiss`. |
| `placement` | `below` \| `above` \| `start` \| `end` \| `pointer` | no | Preferred side, or the last pointer position; default `below`. |
<!-- /generated:elements -->

## Events

<!-- generated:events -->
| Event | User action | Detail | Meaning |
| --- | --- | --- | --- |
| `activate` | **yes** | `x`, `y` | Primary click, or Enter or Space on the focused element. |
| `contextmenu` | **yes** | `x`, `y` | Secondary click, Menu key or Shift+F10. |
| `wheel` | no | `dx`, `dy` | Wheel or touchpad scroll over an element that is not a scroll container. |
| `keydown` | **yes** | `key`, `ctrl`, `alt`, `shift`, `meta`, `repeat` | Key pressed while the element has focus in Interactive mode. Keys reserved by the host (Tab traversal, OverCrow shortcuts, input method composition) are never delivered. |
| `input` | **yes** | `value` | Value edited (text, slider drag). Read-only copy; the host keeps the content. |
| `change` | **yes** | `value` | Value committed: blur or Enter for text, release for a slider, any change for toggle, checkbox and select. |
| `submit` | **yes** | `outcome`, `error` | Form submitted by Enter in a field, Ctrl+Enter in a `field` or `textarea`, or a `submit` button; a write intent may keep plain Enter for moving between its fields. With an intent, carries the outcome of the write. |
| `focus` | no | none | The element gained keyboard focus. |
| `blur` | no | none | The element lost keyboard focus. |
| `reachend` | no | none | Scrolled within one viewport of the end (load more, history). |
| `stick` | no | `stuck` | The user scrolled a container away from its end, or back to it (unread count, return to the latest). Content growing never sends it. |
| `dismiss` | no | none | The host closed a popover (Escape, outside click, anchor removed). |
<!-- /generated:events -->

An event marked as a user action allows a
[protected service call](services.md#calls-that-need-a-user-action) while
the logic handles it. The detail is what a handler receives; in a handler
written as a call, it is named `event`:

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
    <list class="history" stick-to-end={state.following} item-height="20" label={heading(state)} on:stick={stuck(event.stuck)}>
```

The named keys of `keydown` are:

<!-- generated:named-keys -->
`Enter`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`.
<!-- /generated:named-keys -->

Any other `key` is one printable character.

## Default sizes

The elements that OverCrow draws take these sizes, in logical pixels at
100 %, unless the style sets `width` or `height`. Any other element is
sized by its content and by the style: a `canvas` has no size until the
style gives it one.

<!-- generated:default-sizes -->
| Element | When | Width | Height |
| --- | --- | --- | --- |
| `icon` | always | `font-size` | `font-size` |
| `image` | always | decoded image, else 0 | decoded image, else 0 |
| `avatar` | always | decoded image, else 28 | decoded image, else 28 |
| `toggle` | always | 32 | 18 |
| `checkbox` | always | 16 | 16 |
| `slider` | always | 120 | 18 |
| `progress` | always | 120 | 6 |
| `gauge` | `shape="arc"` | 48 | 32 |
| `gauge` | always | 48 | 48 |
| `chart` | always | 160 | 48 |
| `field` | always | 160 | max(`--control-height`, line height) |
| `textarea` | always | 160 | `rows` line heights |
| `separator` | `axis="vertical"` | 1 | 0 |
| `separator` | always | 0 | 1 |
| `select` | always | its text | its text |
| `elapsed` | always | its text | its text |
<!-- /generated:default-sizes -->

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.dots {
  height: 12px;
}
```
