# The style

`style.ocss` styles the view of a PlayerVox OverCrow widget with a small,
bounded subset of CSS: rules, class and element selectors, flex and grid
layout, colours, borders, typography, transitions and animations. If you
know CSS you know the syntax; what differs is that the subset is closed. A
property, a selector or a value outside it is an error that
`overcrow-widget check` reports, not something that silently does nothing.

<!-- source: templates/counter/style.ocss -->
```css
.counter {
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
}

.value {
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
}

.actions {
  gap: var(--space-2);
}

.step {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}

.step:hover {
  background: var(--color-surface-hover);
}
```

The file is optional. Without it, a widget takes the defaults: a `box` lays
its children out in a row, text has the theme's colour and size.

## Rules and selectors

A rule is a list of selectors, then declarations between braces. Each
property appears at most once in a rule; the last `;` is optional.
Comments are `/* … */`.

<!-- generated:selectors -->
| Selector | Meaning |
| --- | --- |
| `text` | Element type; specificity (0, 1). |
| `.name` | Class; specificity (1, 0). |
| `:hover :active :focus :disabled :checked` | State resolved by the host; specificity (1, 0). `:checked` applies to `toggle` and `checkbox`. |
| `a b` | Descendant combinator. |
| `a > b` | Child combinator. |
| `a, b` | Selector list; each selector keeps its own specificity. |
<!-- /generated:selectors -->

A compound selector is an optional element name followed by classes and
states: `button.primary:hover`. Compounds are joined by a space
(descendant) or `>` (child).

<!-- source: widgets/warframe-market/style.ocss -->
```css
.clear:focus,
.result:focus,
.copy:focus,
.back:focus {
  border-color: var(--color-accent);
}
```

<!-- source: widgets/warframe-market/style.ocss -->
```css
.clear:disabled .clear-text {
  color: var(--color-text-muted);
}
```

The states are resolved by OverCrow, not by your logic: `:hover` and
`:active` follow the pointer, `:focus` the keyboard focus, `:disabled` the
`disabled` attribute, and `:checked` the state of a `toggle` or
`checkbox`. A widget is not told about pointer moves: a hover effect costs
it nothing.

When two rules set the same property, the more specific selector wins:
classes and states count first, then element names. Between equal
selectors, the later rule wins. There is no `!important`.

## Layout

Every container is a flex container by default (`display: flex`, in a
row). `display: grid` makes it a grid, and `display: none` removes the
element and its children from the layout while keeping them in the view.

<!-- source: templates/list/style.ocss -->
```css
.checklist {
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
```

<!-- source: widgets/warframe-market/style.ocss -->
```css
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
```

Flex and grid work as in CSS, with the properties of the
[Layout group](style-properties.md#layout): `flex-direction`, `flex-grow`,
`gap`, `justify-content`, `align-items`, `grid-template-columns`,
`grid-column`… An element can also leave the flow with
`position: absolute`, placed against its parent with `top`, `right`,
`bottom` and `left`. Two elements in the same grid cell overlap, which is
how the countdown example puts the time in the middle of its ring:

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
/* The time sits in the middle of the ring: both share one grid cell. */
.dial {
  display: grid;
  grid-template-columns: 72px;
  grid-template-rows: 72px;
  justify-content: center;
  justify-items: center;
  align-items: center;
}
```

A widget cannot draw outside its frame: OverCrow clips it.

## Values

Values are written as in CSS, within bounds: lengths in `px` (`0` may omit
the unit) and percentages, colours as `#rrggbb`, `#rrggbbaa` or
`rgb(r g b / a)`, times in `ms` or `s`, angles in `deg` or `turn`, and
tokens as `var(--name)`. The exact notation of each kind of value is in
[values](style-properties.md#values).

Lengths are logical pixels: OverCrow multiplies them by the user's content
scale (50 % to 175 %) and by the screen's density, so `12px` is the same
physical size on every screen. Shorthands expand as in CSS: one to four
values for sides and corners, one or two for gaps.

## Design tokens

A token is a value of OverCrow's design system, written `var(--name)`.
Colour tokens change with the user's theme, light or dark: a widget styled
with tokens follows the theme without any code. Prefer them to literal
colours.

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.start {
  width: var(--control-height);
  height: var(--control-height);
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  transition: background-color var(--duration-fast) ease-out;
}
```

A token stands for a whole value or for one part of a composite value
(`padding: var(--space-2) var(--space-4)`), and must have the type the
property expects: a colour token for a colour, a length token for a
length. There is no fallback argument, and a widget cannot declare its own
custom properties. All tokens are listed in
[design tokens](style-properties.md#design-tokens).

OverCrow draws the panel behind the widget (`--color-surface-panel`), its
frame and its shadow: start from a transparent background.

## Text

Text properties (`color`, `font-family`, `font-size`, `font-weight`,
`line-height`, `text-align`…) are inherited, as in CSS: set them on a
container to style what it holds.

- Three font families exist: `ui` (Noto Sans, the default), `mono` (Noto
  Sans Mono, for values) and `display` (Space Grotesk, for grades and
  scores). OverCrow bundles them; system fonts are never used, so a widget
  looks the same on every machine.
- `font-variant-numeric: tabular-nums` gives digits one width, so a
  changing number does not move its neighbours.
- `text-overflow: ellipsis` cuts an overflowing line with `…`;
  `text-overflow: marquee` scrolls it back and forth, pausing at each end.
  `line-clamp` limits a text to a number of lines.
- An `icon` takes the `color` and the `font-size` of its place, unless
  `width` and `height` are set. In a line of text, `vertical-align: middle`
  centres an inline `icon` or `image` on the line.

Keep text at 11 px or more (`--font-size-small`): smaller text is hard to
read over a game.

## Transitions and animations

`transition` animates a change of an animatable property; `animation`
plays a `@keyframes` block of the same sheet.

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.ring.done {
  color: var(--color-success);
  animation: countdown-pulse 800ms ease-in-out 3 alternate;
}
```

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
@keyframes countdown-pulse {
  from { opacity: 1; }
  to { opacity: 0.4; }
}
```

Only properties that change paint, not layout, can be animated:
`opacity`, `color`, `background-color`, `border-color` and `transform`.
A `@keyframes` block holds only those. OverCrow runs the animation itself:
no timer and no code of the widget run while it plays, and nothing is
repainted when nothing changes. A widget that is hidden does not animate.

`@keyframes` is the only at-rule. Its name is an identifier that is not an
animation keyword, unique in the sheet.

## What is refused

Any of these rejects the whole sheet:

- `!important`, `@media`, `@import`, `@font-face` and every other at-rule;
- `url()`, `calc()` and the other CSS functions; strings and escapes;
- custom property declarations (`--name: …`);
- ID, attribute and universal (`*`) selectors, pseudo-elements, functional
  pseudo-classes (`:not()`, `:nth-child()`), sibling combinators;
- named colours (`red`), exponents, units other than `px`, `%`, `fr`,
  `ms`, `s`, `deg` and `turn`;
- characters outside ASCII, except in comments.

There is no media query because there is nothing to query: the widget's
size is the user's, and the logic reads it from `host.viewport` when the
view must change with it.

## When the style is wrong

| Code | Problem |
| --- | --- |
| `style.syntax`, `style.encoding`, `style.size` | The file is not a well-formed sheet. |
| `style.unsupported` | A construct of CSS outside the subset (see above). |
| `style.unknown_element`, `style.unknown_pseudo_class`, `style.invalid_selector` | A selector that names no element or state, or is not in the subset. |
| `style.unknown_property`, `style.duplicate_property` | A property outside the subset, or set twice in one rule. |
| `style.invalid_value`, `style.unknown_token` | A value the property does not accept, or a token that does not exist or has another type. |
| `style.not_animatable` | A transition or a keyframe on a property that cannot be animated. |
| `style.unknown_keyframes`, `style.duplicate_keyframes`, `style.invalid_keyframes` | An `animation` that names no block, a name used twice, or an invalid block. |
| `style.too_many_rules`, `style.too_many_selectors`, `style.too_many_compounds`, `style.too_many_simple_selectors`, `style.too_many_declarations`, `style.too_many_keyframes`, `style.too_many_stops` | A [limit](limits.md) of the style is exceeded. |

Unknown names come with the closest name of the schema as a suggestion.
Every property, its values and its initial value are in
[style properties and tokens](style-properties.md).
