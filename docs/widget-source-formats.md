# Widget source formats v1: compiled output

`view.ocml` and `style.ocss` are documented for creators on the website:
[the view](https://overcrow.playervox.com/docs/en/view/) and
[the style](https://overcrow.playervox.com/docs/en/style/)
([français](https://overcrow.playervox.com/docs/view/)), from
[`docs/content/en/view.md`](content/en/view.md) and
[`docs/content/en/style.md`](content/en/style.md). This file keeps what
concerns those who implement or maintain the compiler: what it writes, and
its fixtures.

Both formats are parsed by the `overcrow-widget-format` crate, which the
host and the creator CLI compile unchanged. Elements, attributes, events,
style properties, tokens, selectors and every numeric bound come from the
[widget schema reference](widget-schema-v1.md), which wins over any other
text if they ever disagree. Both parsers fail closed: anything outside the
formats rejects the whole file with a fixed error category and a line and
column, never with source text.

## Compiled output

`view.ocml` is compiled ahead of time into `view.json` and a table of
template expressions; it is not shipped. Admission recompiles it and
requires the same `view.json` bytes.

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
also returns the sorted list of logic functions the expressions call.
`logic.js` registers the table with `registerView` of `@overcrow/sdk`, in the
[calling convention of the view table](cli.md#calling-convention-of-the-view-table):
one function per index, the names in scope bound from `scope`, a handler's
`event` bound to the event detail. `overcrow-widget check` verifies that the
logic module exports each called function.
`cargo run -p overcrow-widget-format --example compile < view.ocml` prints
the compiled view, the expression table and the called functions.

## Parsed style sheet

The style parser returns the typed sheet: rules in source order with their
selectors, specificity and typed values, and keyframe blocks with sorted
stops. The cascade, inheritance and token resolution are applied by the
host. In a package, `style.ocss` is checked after `read_package` with
`overcrow_widget_format::validate_package_style`, at admission and at every
activation.

## Error categories

The categories are the stable names of the public validators; the CLI shows
them as `view.<category>` and `style.<category>`, and the website describes
each one ([view](https://overcrow.playervox.com/docs/en/view/#when-the-view-is-wrong),
[style](https://overcrow.playervox.com/docs/en/style/#when-the-style-is-wrong)).

`view.ocml`: `size`, `encoding`, `syntax`, `invalid_entity`,
`unknown_element`, `invalid_parent`, `unknown_attribute`,
`duplicate_attribute`, `invalid_attribute`, `missing_attribute`,
`unknown_event`, `invalid_handler`, `expression_syntax`,
`expression_too_long`, `expression_too_deep`, `expression_too_many_entries`,
`reserved_name`, `unknown_name`, `invalid_text`, `recursive_component`,
`invalid_component`, `invalid_slot`, `invalid_construct`, `missing_asset`,
`invalid_ref`, `unknown_ref`, `bound_value`, `too_many_elements`,
`too_many_components`, `too_many_children`, `too_many_expressions`,
`too_deep`.

`style.ocss`: `size`, `encoding`, `syntax`, `unsupported`, `unknown_element`,
`unknown_pseudo_class`, `invalid_selector`, `unknown_property`,
`duplicate_property`, `invalid_value`, `unknown_token`, `not_animatable`,
`unknown_keyframes`, `duplicate_keyframes`, `invalid_keyframes`,
`too_many_rules`, `too_many_selectors`, `too_many_compounds`,
`too_many_simple_selectors`, `too_many_declarations`, `too_many_keyframes`,
`too_many_stops`.

## Conformance fixtures

The conformance fixtures under `crates/overcrow-widget-format/fixtures/` hold
one valid or invalid example per rule; an invalid fixture is named after its
expected category.
