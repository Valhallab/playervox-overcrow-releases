# Widget source formats v1

This document specifies the two source files a creator writes besides
`logic.js` and `manifest.json`: the view `view.ocml` and the style sheet
`style.ocss`. They are parsed by the `overcrow-widget-format` crate, which the
host, the creator CLI and the Studio compile unchanged. Elements, attributes,
events, style properties, tokens, selectors and every numeric bound come from
the [widget schema reference](widget-schema-v1.md), which wins over this text
if they ever disagree. The package that carries the results is specified in
[widget-package-v1.md](widget-package-v1.md).

Both parsers fail closed: anything not described here or in the reference
rejects the whole file with a fixed error category and a line and column,
never with source text.

## View: `view.ocml`

`view.ocml` is compiled ahead of time into `view.json` and a table of template
expressions; it is not shipped. Admission recompiles it and requires the same
`view.json` bytes.

### Markup

- UTF-8 without byte-order mark, at most `MAX_VIEW_SOURCE_BYTES`. No NUL or
  control character other than tab, line feed and carriage return.
- The document is a list of top-level nodes: `<component>` declarations and
  the children of the scene root, a `box`.
- Elements are `<name …>…</name>` or `<name …/>`, lowercase. Attribute values
  are quoted (`"…"` or `'…'`) text, an expression `{…}`, or nothing for a
  boolean `true`. Attributes are separated by whitespace and never repeated.
- Comments are `<!-- … -->` without `--` inside. DOCTYPE, processing
  instructions, CDATA sections and namespaces are rejected.
- Entities: `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&lbrace;` `&rbrace;`
  `&nbsp;`, and `&#…;` or `&#x…;` references to non-control characters.
  A literal `{` or `}` in a quoted value, and a lone `}` in text, are
  rejected; write the entity.

### Text

Text is allowed only in elements whose content is text or inline
(`text`, `span`, `badge`, `option`); an inline element holds either text or
inline children, not both. Whitespace follows the JSX rule:

- tabs become spaces;
- a line break between two words becomes one space;
- a line break next to a tag or an expression disappears with its
  indentation;
- a whitespace-only run next to a tag is dropped; one between two expressions
  on the same line is kept.

`&#32;` forces a space the rule would remove. For example,

```xml
<text>
  Hello {state.name}, you have
  {state.count} messages
</text>
```

gives the parts `"Hello "`, `state.name`, `", you have"`, `state.count`,
`" messages"`: the break before `{state.count}` disappears, so write
`you have {state.count}` on one line to keep the space.

### Attributes and events

A quoted value is converted to the attribute's type and checked at compile
time: `true` or `false` for booleans; canonical decimal integers; decimal
numbers without exponent; space-separated numbers for a number list (`series
values`); the text itself otherwise. Static images name a package file
`assets/…`. Values that exist only at runtime (node references, asset
handles) must be bound with `{…}`.

`ref="name"` gives a node a name that `Draw.canvas` and node-reference
attributes such as `popover.anchor` use instead of a node ID. It is always a
quoted identifier, unique in the view, and rejected inside a `for` or a
component body, where it would name several nodes. A static `anchor="name"`
must name a `ref` of the view.

`attr={expr}` binds an attribute to an expression; the VM computes it and the
host checks every value it sends. `on:event={handler}` subscribes the node to
an event of its element. A handler is either the name of a function of the
logic module, called with the event detail, or a call such as
`{remove(item.id)}`; in a handler, `event` names the event detail.

### Template constructs

```xml
<if test={state.loading}> … </if>
<else-if test={state.error}> … </else-if>
<else> … </else>

<for each={state.messages} as="message" key={message.id}> … </for>

<component name="stat-row" props="label value">
  <box class="row"><text>{label}</text><text>{value}</text><slot/></box>
</component>
<stat-row label="CPU" value={state.cpu}><icon name="cpu"/></stat-row>
```

- `else-if` and `else` follow an `if` directly (comments and whitespace may
  separate them).
- `for` requires `each`, `as` and `key`; the key must be unique among the
  repeated siblings at runtime.
- Components are declared at the top level only, once, with a name that is
  not an element or construct name. Their body has at most one `slot`, where
  the children of each use are placed. A use passes declared props only; a
  quoted prop is a string literal. Components cannot be recursive.
- Constructs are transparent to the content rules: their children must suit
  the enclosing element. They count as a level of `MAX_TREE_DEPTH`.

### Expressions

Expressions are a strict subset of JavaScript, at most
`MAX_EXPRESSION_BYTES` long and `MAX_EXPRESSION_DEPTH` deep:

- literals: numbers (`0`, `12`, `1.5`; no exponent, hexadecimal or leading
  zero), strings with `\\ \' \" \n \r \t \uXXXX` escapes, `true`, `false`,
  `null`, array literals and object literals with plain or quoted keys, at
  most `MAX_CALL_ARGUMENTS` entries;
- names in scope and their members: `a.b`, `a?.b`, `a[i]`, `a?.[i]`;
- `!`, unary `-` and `+`, `* / %`, `+ -`, `< <= > >=`, `== != === !==`,
  `&&`, `||`, `??` (not mixed with `&&` or `||` without parentheses), and
  `a ? b : c`;
- calls of functions exported by the logic module, by bare name, with at
  most `MAX_CALL_ARGUMENTS` arguments; `t(key, params)` is one of them.

There is no assignment, update, arrow or function literal, `new`, `this`,
template literal, regular expression, comma operator, spread, method call or
global. JavaScript reserved words, `constructor`, `prototype`, `eval`,
`undefined`, `globalThis`, `overcrow` and any name starting with `__` are
rejected everywhere, as are object keys starting with `__`.

The names in scope are `state` (the widget state), the props of the
enclosing component body (a body does not see its caller's names), the `as`
names of enclosing `for` constructs, and `event` in a handler. A name cannot
shadow another one. A called name must not be in scope.

### Compiled output

The compiler writes `view.json` as canonical JSON: object keys sorted by
their bytes, no whitespace. Expressions are numbered in document order:
component bodies in declaration order, then the root; within an element, its
bound attributes and handlers in source order, then its text or children;
`if` tests before their branch, `for` list and key before the repeated nodes.
The compiled view is then validated by the host's own
`validate_compiled_view`.

With `view.json`, the compiler returns the expression table: for each index,
its role (text, attribute, handler, test, list, key or prop), the names in
scope besides `state` (outermost first, `event` last for a handler), the
typed expression and its canonical JavaScript text, fully parenthesized. It
also returns the sorted list of logic functions the expressions call. How the
table is wrapped into `logic.js` and registered with the SDK, and the check
that `logic.js` exports each called function, belong to the SDK (P2.1) and
the CLI (P2.2).

## Style: `style.ocss`

A style sheet is a list of rules and `@keyframes` blocks, at most
`MAX_STYLE_SOURCE_BYTES`, ASCII outside comments.

- **Rules.** A selector list of at most `MAX_SELECTORS_PER_RULE` selectors,
  then `{ property: value; … }` with at most `MAX_DECLARATIONS_PER_RULE`
  declarations, each property at most once per rule. The final `;` is
  optional. At most `MAX_STYLE_RULES` rules.
- **Selectors.** Compounds of an optional element name, `.class` and
  `:state` (`hover`, `active`, `focus`, `disabled`, `checked`; `:checked`
  only on `toggle`, `checkbox` or a compound without element), joined by a
  space (descendant) or `>` (child): at most `MAX_COMPOUNDS_PER_SELECTOR`
  compounds of at most `MAX_SIMPLE_SELECTORS_PER_COMPOUND` simple selectors.
  Specificity is (classes and states, elements); ties resolve by source
  order.
- **Values.** Each property accepts the grammar of the reference. Lengths
  are `px` (`0` may omit it) and, where allowed, percentages; tokens
  `var(--name)` of the expected type may stand for any colour, length, font
  size, font family or time, and a shadow token `var(--shadow-…)` may be
  the whole `box-shadow` value. Shorthands expand as in CSS: one to four sides
  or corners, one or two gaps; `repeat()` expands its tracks.
- **Animations.** `@keyframes name { from { … } 50% { … } to { … } }` holds
  at most `MAX_KEYFRAME_STOPS` stops of animatable properties only; a stop
  list such as `0%, 100%` counts each offset. Names are unique identifiers
  that are not animation keywords. `animation` names a block of the same
  sheet; `transition` names animatable properties.
- **Rejected.** `!important`, `@media`, `@import`, `@font-face` and every
  other at-rule, `url()`, `calc()` and the other CSS functions, strings and
  escapes, custom property declarations, ID, attribute and universal
  selectors, pseudo-elements, functional pseudo-classes, sibling combinators,
  named colours, exponents and unknown units.

The parser returns the typed sheet: rules in source order with their
selectors, specificity and typed values, and keyframe blocks with sorted
stops. The cascade, inheritance and token resolution are applied by the host
(P1.2).

In a package, `style.ocss` is checked after `read_package` with
`overcrow_widget_format::validate_package_style`, at admission and at every
activation.

## Error categories

`view.ocml`: `size`, `encoding`, `syntax`, `invalid_entity`,
`unknown_element`, `invalid_parent`, `unknown_attribute`,
`duplicate_attribute`, `invalid_attribute`, `missing_attribute`,
`unknown_event` (also an event on a component use), `invalid_handler`,
`expression_syntax`,
`expression_too_long`, `expression_too_deep`, `expression_too_many_entries`,
`reserved_name`, `unknown_name`, `invalid_text`, `recursive_component`, `invalid_component`, `invalid_slot`,
`invalid_construct`, `missing_asset`, `invalid_ref`, `unknown_ref`,
`too_many_elements`,
`too_many_components`, `too_many_children`, `too_many_expressions`,
`too_deep`.

`style.ocss`: `size`, `encoding`, `syntax`, `unsupported`, `unknown_element`,
`unknown_pseudo_class`, `invalid_selector`, `unknown_property`,
`duplicate_property`, `invalid_value`, `unknown_token`, `not_animatable`,
`unknown_keyframes`, `duplicate_keyframes`, `invalid_keyframes`,
`too_many_rules`, `too_many_selectors`, `too_many_compounds`,
`too_many_simple_selectors`, `too_many_declarations`, `too_many_keyframes`,
`too_many_stops`.

The conformance fixtures under `crates/overcrow-widget-format/fixtures/` hold
one valid or invalid example per rule; an invalid fixture is named after its
expected category.
