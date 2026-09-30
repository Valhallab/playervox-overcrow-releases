# Build widgets for OverCrow

An OverCrow widget is a small package that the overlay draws over your game:
a clock, a frame-rate counter, a checklist, a chat. You describe its view in
markup, style it with a small subset of CSS, and write its logic in
TypeScript against `@overcrow/sdk`. The `overcrow-widget` command-line tool
checks, tests and packages it; the signed catalog brings it to users.

Every built-in widget of OverCrow is written this way, with the same public
SDK, package format and sandbox as yours. Their sources are the
[reference widgets](widgets.md).

## What a widget is made of

| File | Role |
| --- | --- |
| `manifest.json` | Identity, version, names, size rules, the options menu and the permissions the widget asks for. |
| `view.ocml` | The view: elements such as `box`, `text`, `button`, `list` or `chart`, bound to the state with `{…}` expressions. |
| `style.ocss` | Optional style: flex and grid layout, colours, borders, typography, with the theme's design tokens. |
| `logic.ts` | The logic: the state, the event handlers, timers and calls to host services. |
| `locales/en.json`, `locales/fr.json` | Optional messages in English and French. |
| `LICENSE` | The license of your widget. |

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
  data) is a host service that checks the widget's declared and consented
  permissions at each call. See [security](security.md).

## Where to start

1. Follow the [creator guide](guide.md): from `overcrow-widget init` to a
   submitted widget.
2. Read the [reference widgets](widgets.md): the built-ins, with their tests.
3. Look up an element, a style property, a service or an SDK function in the
   [reference](reference.md).
4. Before you publish, read [security](security.md) and
   [publishing and review](publishing.md).

Widgets run on Windows and Linux alike: the same package, the same SDK and
the same rendering.
