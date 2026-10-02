# Build widgets for PlayerVox OverCrow

A PlayerVox OverCrow widget is a small package that the overlay draws over
your game: a clock, a frame-rate counter, a checklist, a chat. You describe
its view in markup, style it with a small subset of CSS, and write its logic
in TypeScript against `@overcrow/sdk`. The `overcrow-widget` command-line
tool checks, tests and packages it; the signed catalog brings it to users.

Every built-in widget of OverCrow is written this way, with the same public
SDK, package format and sandbox as yours. Their sources are the
[reference widgets](widgets.md).

## What a widget is made of

| File | Role | Page |
| --- | --- | --- |
| `manifest.json` | Identity, version, names, size rules, the options menu and the permissions the widget asks for. | [The manifest](manifest.md) |
| `view.ocml` | The view: elements such as `box`, `text`, `button`, `list` or `chart`, bound to the state with `{…}` expressions. | [The view](view.md) |
| `style.ocss` | Optional style: flex and grid layout, colours, borders, typography, with the theme's design tokens. | [The style](style.md) |
| `logic.ts` | The logic: the state, the event handlers, timers and calls to services. | [The logic](logic.md) |
| `locales/en.json`, `locales/fr.json` | Optional messages in English and French. | [Messages](logic.md#messages) |
| `LICENSE` | The license of your widget. | [The package](package.md) |

The view and the logic meet like this: the view reads `state.count` and
calls the handlers the logic exports.

<!-- source: templates/counter/view.ocml -->
```xml
<box class="counter">
  <text class="value">{state.count}</text>
  <box class="actions">
    <button class="step" label={t("decrement")} on:activate={decrement}>
      <icon name="minus"/>
    </button>
    <button class="step" label={t("increment")} on:activate={increment}>
      <icon name="plus"/>
    </button>
  </box>
</box>
```

<!-- source: templates/counter/logic.ts -->
```ts
const state = initState({ count: 0 });

export function increment(): void {
  state.count += 1;
}
```

## How a widget runs

- The logic runs in its own small JavaScript VM, in its own sandboxed
  process. It has no DOM, no file system, no network and no access to other
  widgets; it reaches OverCrow only through the SDK.
- After each event, timer tick or service answer, the VM evaluates the view
  again and sends OverCrow only what changed. OverCrow lays out and paints
  the widget itself: no web engine is involved.
- Everything that reaches the outside (network, storage, clipboard, game
  data) is a service of OverCrow, which checks the widget's declared and
  consented permissions at each call. See
  [services and permissions](services.md).

These pages call OverCrow **the host** when they describe what it does for a
widget: the host draws the view, answers the services and keeps the user's
data.

## Where to start

1. Follow the [creator guide](guide.md): from `overcrow-widget init` to a
   submitted widget, in twelve short steps.
2. Read the [reference widgets](widgets.md): the built-ins, with their tests.
3. Go deeper, one topic per page: the [manifest](manifest.md), the
   [view](view.md), the [style](style.md), the [logic](logic.md),
   [services and permissions](services.md), [forms](forms.md).
4. Use the tools: the [CLI](cli.md), [tests](testing.md) and the
   [development channel](dev-channel.md) that runs your widget in OverCrow
   while you write it.
5. Look up an element, a style property, a service or an SDK function in the
   [reference](reference.md).
6. Before you publish, read [the package](package.md),
   [security](security.md) and [publishing and review](publishing.md).

Widgets run on Windows and Linux alike: the same package, the same SDK and
the same rendering.
