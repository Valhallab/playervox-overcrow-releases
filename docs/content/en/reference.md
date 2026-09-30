# Reference

The reference of widget API v1 is written once, next to the code it
describes, and checked against it. This page points to the right section.
The reference documents are in English.

| Question | Where |
| --- | --- |
| Which elements, attributes and events can a view use? | [Schema reference: View](../../widget-schema-v1.md#view) |
| Which style properties, selectors and values are accepted? | [Schema reference: Style](../../widget-schema-v1.md#style) |
| Which design tokens and icons exist? | [Design tokens](../../widget-schema-v1.md#design-tokens), [icons](../../widget-schema-v1.md#icons) |
| What goes in `manifest.json`? | [Manifest](../../widget-schema-v1.md#manifest), [wrapper menu](../../widget-schema-v1.md#wrapper-menu) |
| What does each permission, capability and service do? | [Permissions](../../widget-schema-v1.md#permissions), [services](../../widget-schema-v1.md#services) |
| What are the limits (sizes, counts, budgets)? | [Limits](../../widget-schema-v1.md#limits) |
| How are `view.ocml` and `style.ocss` written? | [Source formats](../../widget-source-formats.md) |
| Which functions does `@overcrow/sdk` export? | [SDK reference](../../sdk-reference.md) |
| How do I format times, dates and numbers? | [SDK reference: time, dates and numbers](../../sdk-reference.md#time-dates-and-numbers) |
| How do I write unit tests and scenarios? | [Testing a widget](../../widget-testing.md) |
| What does each CLI command and diagnostic do? | [CLI](../../cli.md) |
| What is inside a `.ocpkg`, and how is the catalog signed? | [Package and catalog format](../../widget-package-v1.md) |
| How does `overcrow-widget dev` talk to OverCrow? | [Development channel](../../dev-channel.md) |

## How the reference stays exact

- The **schema reference** is generated from the `overcrow-widget-schema`
  crate, the same tables that OverCrow and the CLI compile into their
  validators. CI regenerates it and fails when the committed file differs.
- The **SDK types** (`sdk/src/generated/`) are generated from the same
  crate, so a wrong element, icon, capability or service parameter is a
  TypeScript error in your logic.
- The **SDK reference** is checked by the SDK's tests: every export of
  `@overcrow/sdk` must be listed there and carry its documentation comment.
- The tables of these pages (permissions, capabilities, gestures, reference
  widgets) are generated from the SDK types and from `widgets/`, and every
  code example is an excerpt of a project that the CLI checks and packages
  in CI.

## Permissions at a glance

<!-- generated:permissions -->
| Permission | Services | On a gesture |
| --- | --- | --- |
| `network` | `http.fetch` | — |
| `storage` | `storage.get`, `storage.set`, `storage.remove`, `storage.keys` | — |
| `clipboardWrite` | — | `clipboard.writeText` |
| `gameEvents` | `gameEvents.subscribe` | — |
<!-- /generated:permissions -->

Capabilities, their sensitivity and their services are listed on the
[security](security.md#permissions-and-consent) page.
