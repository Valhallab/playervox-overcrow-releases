# Reference

The reference of PlayerVox OverCrow widgets lists every element, style
property, service and SDK function of widget API v1. This page says where
each answer is. The pages of "Write a widget" explain how the parts work
together; the pages below are the ones to keep open while you write.

| Question | Page |
| --- | --- |
| What goes in `manifest.json`? | [The manifest](manifest.md) |
| Which elements, attributes and events can a view use? | [Elements and attributes](elements.md) |
| Which style properties and values are accepted? | [Style properties and tokens](style-properties.md) |
| Which design tokens and icons exist? | [Design tokens](style-properties.md#design-tokens), [icons](style-properties.md#icons) |
| Which functions does `@overcrow/sdk` export? | [SDK reference](sdk.md) |
| How do I format times, dates and numbers? | [Time, dates and numbers](sdk.md#time-dates-and-numbers) |
| What does each permission and capability allow? | [Services and permissions](services.md) |
| What are the parameters and the result of a service? | [Service reference](service-reference.md), [result shapes](result-shapes.md) |
| What does an error code mean? | [Errors](services.md#errors) |
| Which fields does a write intent take? | [The intents](forms.md#the-intents) |
| What are the limits (sizes, counts, budgets)? | [Limits](limits.md) |
| What does each command and diagnostic of the CLI do? | [The command-line tool](cli.md) |
| How is a test scenario written? | [Testing a widget](testing.md#scenarios) |
| What is inside a `.ocpkg`? | [The package](package.md) |

## How the reference stays exact

- The tables of elements, attributes, style properties, tokens, services,
  result shapes and limits are **generated from the widget schema**, the
  same tables that OverCrow and the command-line tool compile into their
  validators. A check fails when a page differs from the schema, in English
  or in French.
- The **SDK types** are generated from the same schema, so a wrong element,
  icon, capability or service parameter is a TypeScript error in your
  logic.
- The **SDK reference** is checked by the SDK's tests: every export of
  `@overcrow/sdk` is listed there.
- Every **code example** of these pages is an excerpt of a project that the
  command-line tool checks, packages and admits on each change: a template,
  a reference widget or one of the two examples.

## Versions

These pages describe widget API v1 (`"apiVersion": 1` in the manifest) and
`@overcrow/sdk` 1.0.

## Specifications for implementers

Three specifications, in the public repository, are written for those who
implement a host or another tool rather than a widget: the complete
[generated schema reference](../../widget-schema-v1.md), which also covers
the protocol between OverCrow and the widget's process and the catalog's
payloads; the
[wire protocol of the development channel](../../dev-channel.md); and the
[archive and catalog format](../../widget-package-v1.md). A widget author
does not need them.
