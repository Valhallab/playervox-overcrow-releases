# Style properties and tokens

Every property that `style.ocss` accepts in a PlayerVox OverCrow widget,
with its values and its initial value, then the design tokens and the
icons. [The style](style.md) explains selectors, layout, tokens and
animations; this page is the list.

<!-- source: templates/chart/style.ocss -->
```css
.value {
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
}
```

Anything that is not on this page is refused when the widget is checked:
a property, a keyword or a unit outside the lists below is an error, with
the closest name as a suggestion.

## How to read a property

- **Value** uses the notations of [values](#values): `<px>`, `<percent>`,
  `<color>`… A `|` separates alternatives, `?` marks an optional part.
- **Initial** is the value of an element that no rule styles.
- **Inherited** properties take the value of the parent when no rule sets
  them: set them on a container.
- **Animatable** properties can appear in a `transition` and in
  `@keyframes`.

## Properties

<!-- generated:style-properties -->
### Layout

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `display` | `flex` \| `grid` \| `none` | `flex` | no | no |
| `position` | `relative` \| `absolute` | `relative` | no | no |
| `top` | `<px>` \| `<percent>` \| `auto`, negative allowed | `auto` | no | no |
| `right` | `<px>` \| `<percent>` \| `auto`, negative allowed | `auto` | no | no |
| `bottom` | `<px>` \| `<percent>` \| `auto`, negative allowed | `auto` | no | no |
| `left` | `<px>` \| `<percent>` \| `auto`, negative allowed | `auto` | no | no |
| `flex-direction` | `row` \| `column` \| `row-reverse` \| `column-reverse` | `row` | no | no |
| `flex-wrap` | `nowrap` \| `wrap` | `nowrap` | no | no |
| `flex-grow` | number 0 to 1000 | `0` | no | no |
| `flex-shrink` | number 0 to 1000 | `1` | no | no |
| `flex-basis` | `<px>` \| `<percent>` \| `auto` | `auto` | no | no |
| `justify-content` | `start` \| `end` \| `center` \| `stretch` \| `space-between` \| `space-around` \| `space-evenly` | `start` | no | no |
| `align-items` | `start` \| `end` \| `center` \| `baseline` \| `stretch` | `stretch` | no | no |
| `align-self` | `auto` \| `start` \| `end` \| `center` \| `baseline` \| `stretch` | `auto` | no | no |
| `align-content` | `start` \| `end` \| `center` \| `stretch` \| `space-between` \| `space-around` \| `space-evenly` | `stretch` | no | no |
| `justify-items` | `start` \| `end` \| `center` \| `stretch` | `stretch` | no | no |
| `justify-self` | `auto` \| `start` \| `end` \| `center` \| `stretch` | `auto` | no | no |
| `gap` | 1–2 × (`<px>` \| `<percent>`) | `0` | no | no |
| `row-gap` | `<px>` \| `<percent>` | `0` | no | no |
| `column-gap` | `<px>` \| `<percent>` | `0` | no | no |
| `grid-template-columns` | `none` \| list ≤ 24 of `<track>`, or `repeat(<integer>, <track>)` | `none` | no | no |
| `grid-template-rows` | `none` \| list ≤ 24 of `<track>`, or `repeat(<integer>, <track>)` | `none` | no | no |
| `grid-auto-flow` | `row` \| `column` | `row` | no | no |
| `grid-auto-columns` | `<track>`: `<px>` \| `<percent>` \| `<fr>` \| `auto` \| `min-content` \| `max-content` \| `minmax(<track>, <track>)` | `auto` | no | no |
| `grid-auto-rows` | `<track>`: `<px>` \| `<percent>` \| `<fr>` \| `auto` \| `min-content` \| `max-content` \| `minmax(<track>, <track>)` | `auto` | no | no |
| `grid-column` | `auto` \| `<integer>` \| `span <integer>` \| `<start> / <end>`, lines 1 to 24 | `auto` | no | no |
| `grid-row` | `auto` \| `<integer>` \| `span <integer>` \| `<start> / <end>`, lines 1 to 24 | `auto` | no | no |

### Box

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `width` | `<px>` \| `<percent>` \| `auto` | `auto` | no | no |
| `height` | `<px>` \| `<percent>` \| `auto` | `auto` | no | no |
| `min-width` | `<px>` \| `<percent>` \| `auto` | `auto` | no | no |
| `min-height` | `<px>` \| `<percent>` \| `auto` | `auto` | no | no |
| `max-width` | `<px>` \| `<percent>` \| `none` | `none` | no | no |
| `max-height` | `<px>` \| `<percent>` \| `none` | `none` | no | no |
| `aspect-ratio` | number 0.01 to 100 | `auto` | no | no |
| `margin` | 1–4 × (`<px>` \| `<percent>` \| `auto`), negative allowed | `0` | no | no |
| `margin-top` | `<px>` \| `<percent>` \| `auto`, negative allowed | `0` | no | no |
| `margin-right` | `<px>` \| `<percent>` \| `auto`, negative allowed | `0` | no | no |
| `margin-bottom` | `<px>` \| `<percent>` \| `auto`, negative allowed | `0` | no | no |
| `margin-left` | `<px>` \| `<percent>` \| `auto`, negative allowed | `0` | no | no |
| `padding` | 1–4 × (`<px>` \| `<percent>`) | `0` | no | no |
| `padding-top` | `<px>` \| `<percent>` | `0` | no | no |
| `padding-right` | `<px>` \| `<percent>` | `0` | no | no |
| `padding-bottom` | `<px>` \| `<percent>` | `0` | no | no |
| `padding-left` | `<px>` \| `<percent>` | `0` | no | no |
| `overflow` | `visible` \| `hidden` | `visible` | no | no |

### Appearance

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `background-color` | `<color>` | `transparent` | no | yes |
| `background` | `<color>` \| `linear-gradient(<angle>?, <color> <percent>?, …)`, stops ≤ 8 | `transparent` | no | no |
| `border` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | no | no |
| `border-top` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | no | no |
| `border-right` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | no | no |
| `border-bottom` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | no | no |
| `border-left` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | no | no |
| `border-width` | 1–4 × (`<px>`) | `0` | no | no |
| `border-style` | `solid` \| `none` | `none` | no | no |
| `border-color` | `<color>` | `currentColor` | no | yes |
| `border-radius` | 1–4 × (`<px>` \| `<percent>`) | `0` | no | no |
| `box-shadow` | `none` \| `var(--shadow-…)` alone \| list ≤ 2 of `inset`? `<px> <px> <px>? <px>? <color>` | `none` | no | no |
| `opacity` | number 0 to 1 | `1` | no | yes |
| `visibility` | `visible` \| `hidden` | `visible` | yes | no |
| `object-fit` | `contain` \| `cover` \| `fill` \| `none` | `contain` | no | no |

### Text

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `color` | `<color>` | `var(--color-text)` | yes | yes |
| `font-family` | `ui` \| `mono` \| `display`, or a font token | `ui` | yes | no |
| `font-size` | `<px>` within 6 px to 96 px, or a size token | `var(--font-size-body)` | yes | no |
| `font-weight` | `400` \| `500` \| `600` \| `700` \| `normal` \| `bold` | `400` | yes | no |
| `font-style` | `normal` \| `italic` | `normal` | yes | no |
| `font-variant-numeric` | `normal` \| `tabular-nums` | `normal` | yes | no |
| `line-height` | number 0.5 to 4 (× font size) \| `<px>` | `1.3` | yes | no |
| `letter-spacing` | `<px>`, negative allowed | `0` | yes | no |
| `text-align` | `start` \| `center` \| `end` | `start` | yes | no |
| `text-decoration` | `none` \| `underline` \| `line-through` | `none` | no | no |
| `text-transform` | `none` \| `uppercase` \| `lowercase` \| `capitalize` | `none` | yes | no |
| `white-space` | `normal` \| `nowrap` \| `pre-wrap` | `normal` | yes | no |
| `vertical-align` | `baseline` \| `middle` | `baseline` | no | no |
| `text-overflow` | `clip` \| `ellipsis` \| `marquee` | `clip` | no | no |
| `line-clamp` | integer 0 to 64 | `0` | no | no |
| `overflow-wrap` | `normal` \| `anywhere` | `normal` | yes | no |

### Motion

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `transform` | `none` \| up to 4 of `translate(<length>, <length>)` with `<px>` or `<percent>`, `translateX()`, `translateY()`, `scale(<number>{1,2})` 0 to 8, `rotate(<angle>)` | `none` | no | yes |
| `transform-origin` | 1–2 × (`left` \| `center` \| `right` \| `top` \| `bottom` \| `<percent>` \| `<px>`) | `center` | no | no |
| `transition` | `none` \| list ≤ 8 of `<animatable-property> <time> <easing>? <time>?` | `none` | no | no |
| `animation` | `none` \| list ≤ 8 of `<keyframes-name> <time> <easing>? <time>? (<integer> \| infinite)? <direction>? <fill-mode>?`, integer 1 to 10000 | `none` | no | no |

### Interaction

| Property | Value | Initial | Inherited | Animatable |
| --- | --- | --- | --- | --- |
| `cursor` | `default` \| `pointer` \| `text` \| `not-allowed` \| `grab` \| `grabbing` | `default` | yes | no |
| `pointer-events` | `auto` \| `none` | `auto` | no | no |
<!-- /generated:style-properties -->

## Values

<!-- generated:style-values -->
| Syntax | Meaning |
| --- | --- |
| `<px>` | `12px`; `0` may omit the unit. Decimal numbers, no exponent. |
| `<percent>` | `50%` of the containing block, as in CSS; at most 1000 either way. |
| `<fr>` | `1fr`, grid tracks only; from 0 to 1000. |
| `<time>` | `120ms` or `0.12s`, from 0 to 300000 ms. |
| `<angle>` | `4deg` or `0.5turn`, at most 3600 degrees either way. |
| `<color>` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b)`, `rgb(r g b / a)`, `transparent`, `currentColor`, or a colour token. No named colours. |
| `var(--token)` | Design-system token of the expected type, as a whole value or a component of a composite value. No fallback argument; widgets cannot declare custom properties. |
| `<easing>` | `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(<integer 1..=MAX_EASING_STEPS>)`. |
| `<direction>` | `normal`, `reverse`, `alternate`. |
| `<fill-mode>` | `none`, `forwards`, `backwards`, `both`. |
<!-- /generated:style-values -->

## Design tokens

A token is written `var(--name)` where a value of its type is expected.
Colour and shadow tokens have a value per theme; the others are the same in
both.

<!-- source: templates/list/style.ocss -->
```css
.summary {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}
```

<!-- generated:tokens -->
### Colours

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--color-accent` | `#a3e635` | `#4d7c0f` | Brand accent: primary actions, checked state. |
| `--color-accent-hover` | `#b5f153` | `#3f6212` | Accent under the pointer. |
| `--color-accent-soft` | `#a3e6351c` | `#4d7c0f1f` | Accent wash behind selected content. |
| `--color-on-accent` | `#09090b` | `#ffffff` | Text and icons drawn on the accent and its hover state. |
| `--color-surface-panel` | `#111114ee` | `#fafafaee` | Widget panel background, drawn by the host behind the content. |
| `--color-surface-raised` | `#1e1e22e0` | `#f4f4f5eb` | Raised surface inside the panel. |
| `--color-surface-hover` | `#28282deb` | `#e4e4e7f0` | Surface under the pointer. |
| `--color-surface-field` | `#0f0f12` | `#ffffff` | Text input background. |
| `--color-surface-popover` | `#18181c` | `#ffffff` | Popover and drop-down background. |
| `--color-border` | `#ffffff18` | `#0000001a` | Default border. |
| `--color-border-strong` | `#ffffff2a` | `#0000002e` | Emphasized border and separator. |
| `--color-text` | `#f7f7f8` | `#18181b` | Primary text. |
| `--color-text-secondary` | `#d4d4d8` | `#3f3f46` | Secondary text. |
| `--color-text-muted` | `#a1a1aa` | `#52525b` | Captions and metadata. |
| `--color-text-subtle` | `#71717a` | `#71717a` | Placeholders and disabled text. |
| `--color-danger` | `#fb7185` | `#e11d48` | Errors and destructive actions. |
| `--color-danger-soft` | `#fb71851a` | `#e11d481a` | Danger wash behind destructive confirmations and errors. |
| `--color-warning` | `#fbbf24` | `#b45309` | Warnings. |
| `--color-success` | `#86efac` | `#15803d` | Success and healthy states. |

### Lengths

| Token | Value | Meaning |
| --- | --- | --- |
| `--space-1` | `2px` | Spacing step 1. |
| `--space-2` | `4px` | Spacing step 2. |
| `--space-3` | `6px` | Spacing step 3 (default item spacing). |
| `--space-4` | `8px` | Spacing step 4. |
| `--space-5` | `12px` | Spacing step 5. |
| `--space-6` | `16px` | Spacing step 6. |
| `--radius-sm` | `6px` | Small controls and images. |
| `--radius-md` | `9px` | Buttons. |
| `--radius-lg` | `10px` | Cards. |
| `--radius-pill` | `999px` | Pills and round buttons. |
| `--control-height` | `28px` | Standard control height. |
| `--icon-button-size` | `22px` | Compact icon button. |

### Font sizes

| Token | Value | Meaning |
| --- | --- | --- |
| `--font-size-caption` | `10px` | Eyebrow and captions. |
| `--font-size-small` | `11px` | Metadata. |
| `--font-size-button` | `13px` | Button labels. |
| `--font-size-body` | `14px` | Body text. |
| `--font-size-title` | `18px` | Section titles. |
| `--font-size-value` | `22px` | Headline values (clock, FPS). |

### Font families

| Token | Value | Meaning |
| --- | --- | --- |
| `--font-ui` | `ui` | Noto Sans UI, the interface face. |
| `--font-mono` | `mono` | Noto Sans Mono, for values. |
| `--font-display` | `display` | Space Grotesk, for grades and scores. |

### Durations

| Token | Value | Meaning |
| --- | --- | --- |
| `--duration-fast` | `120ms` | State transitions. |
| `--duration-medium` | `240ms` | Panels and popovers. |

### Shadows

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--shadow-panel` | `0px 4px 16px 0px #00000066` | `0px 4px 16px 0px #0000001f` | Shadow of the widget panel and of floating host surfaces. |
<!-- /generated:tokens -->

## Icons

The `icon` element and the rows of the options menu take the name of a
Lucide icon, in its usual spelling: `circle-check`, `rotate-ccw`,
`chevron-down`.

<!-- source: templates/list/view.ocml -->
```xml
          <icon name="x"/>
```

<!-- generated:icons -->
Lucide 1.34.0, 1777 icons.
<!-- /generated:icons -->

Any other name is refused, and the SDK's `IconName` type lists them all, so
a wrong name in the logic is a TypeScript error. Within API v1 the set may
grow but never loses or renames an icon. OverCrow draws the icons itself: a
widget ships no icon font.
