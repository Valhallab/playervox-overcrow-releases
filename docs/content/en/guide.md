# Creator guide

This guide takes a PlayerVox OverCrow widget from an empty directory to a
submission: create a project, edit its view, style and logic, run it in
OverCrow, test it, package it and submit it. Each step links to the page
that covers it in full.

## 1. Install the tools

- **`overcrow-widget`**, the widget CLI, one binary for Linux and Windows.
  See [installing the CLI](cli.md#installing).
- **Node.js 22 or later**, so that `check` can type-check your logic with the
  project's own TypeScript. The CLI checks and packages without it, but
  warns that types were not checked.
- **OverCrow**, to run the widget while you write it.

`overcrow-widget doctor` tells what your setup has and lacks.

## 2. Create a project

```sh
overcrow-widget init my-counter --template counter
cd my-counter
```

The templates are `blank`, `counter`, `list` and `chart`. The ID defaults to
`com.example.<dir>`: pass `--id` with a reverse-DNS name you control
(`com.playervox.*` is reserved). [Files of a project](cli.md#files-of-a-project)
lists every file and says which ones are packaged;
[the SDK types](cli.md#the-sdk-types) says how to install TypeScript and
the SDK types into the project.

## 3. The view

`view.ocml` is markup: elements, attributes, `{…}` expressions bound to the
state, and `on:<event>` handlers that call functions exported by the logic.

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

The view also has `if`, `for` with a mandatory key, and local components:
see [the view](view.md). Every element and attribute is in
[elements and attributes](elements.md).

## 4. The style

`style.ocss` is a bounded subset of CSS: class, element, descendant and
child selectors, the `:hover`, `:active`, `:focus`, `:disabled` and
`:checked` states, flex and grid layout, and the theme's design tokens as
`var(--…)`, which follow the user's light or dark theme.

<!-- source: templates/counter/style.ocss -->
```css
.step {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}
```

<!-- source: templates/counter/style.ocss -->
```css
.step:hover {
  background: var(--color-surface-hover);
}
```

There is no `@media`, `@import`, `url()` or `calc()`: an unknown
property or selector is an error, not a silent no-op. See
[the style](style.md) and [style properties and tokens](style-properties.md).

## 5. The logic

`logic.ts` owns the state. Declare its type once, mutate it in your
handlers, and the view follows: after each turn the VM evaluates the view
again and sends only what changed.

<!-- source: templates/counter/logic.ts -->
```ts
import { initState } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    count: number;
  }
}
```

<!-- source: templates/counter/logic.ts -->
```ts
export function increment(): void {
  state.count += 1;
}
```

The logic runs in a sandboxed VM, not in a browser: there is no DOM,
`fetch`, `setTimeout`, `console` or `Intl`. The SDK provides timers,
services, formatting helpers for times and numbers in the user's regional
format, messages and drawing. See [the logic](logic.md) and the
[SDK reference](sdk.md).

## 6. Messages

`t("key")` in the view or the logic reads `locales/en.json` or
`locales/fr.json` for the user's language, and fills `{name}` parameters.

<!-- source: templates/counter/locales/en.json -->
```json
{
  "decrement": "Decrease",
  "increment": "Increase"
}
```

Provide both files or neither, with the same keys. See
[messages](logic.md#messages).

## 7. Check

```sh
overcrow-widget check
```

`check` runs the same validators as OverCrow: manifest, view, style,
locales, a lint of the logic against what the VM runs, the project's
TypeScript, and a package built in memory and read back. Each problem has a
stable code, a position and a help line; see
[diagnostics](cli.md#diagnostics).

## 8. Run it in OverCrow

```sh
overcrow-widget dev
```

`dev` sends the widget to the OverCrow overlay running on your machine and
reloads it each time you save. OverCrow offers this only when it was
started with development installs allowed (`OVERCROW_WIDGET_DEVELOPMENT=1`;
`overcrow-widget doctor` prints the commands). The widget shows an
**Unverified · development package** marker; its declared permissions are
granted for the session only, and nothing is stored. `log.info(…)` from your
logic prints in the terminal. See
[the development channel](dev-channel.md).

## 9. Test it

Two kinds of tests, both described in [testing a widget](testing.md):

- unit tests of the logic with `@overcrow/sdk/testing`, which runs your
  module with virtual time and simulated services;
- scenarios played by `overcrow-widget test` in OverCrow's headless
  runtime: the real VM and renderer, services answered by fixtures, and
  images compared with references.

<!-- source: templates/counter/tests/example.scenario.json -->
```json
  "host": { "mode": "interactive" },
  "steps": [
    { "expect": { "state": "running", "text": ["0"], "image": "initial" } },
    { "pointer": { "click": { "label": "Increase" } } },
    { "expect": { "text": ["1"], "noText": ["0"], "image": "increased", "fault": "none" } }
  ]
```

```sh
overcrow-widget test --runtime path/to/overcrow-widget-headless
```

## 10. Ask for what you need

A widget gets nothing by default. To call an API, keep data or read game
information, declare it in `manifest.json`; the user consents before the
widget gets it. A network rule names one HTTPS origin, one method and one
complete path, with typed parameters:

<!-- source: docs/content/examples/weather/manifest.json -->
```json
  "permissions": {
    "network": [
      {
        "origin": "https://api.example.com",
        "method": "GET",
        "path": "/v1/forecast/{city}",
        "pathParams": { "city": { "type": "slug", "maxLength": 32 } },
        "queryParams": {
          "units": { "type": "enum", "values": ["metric", "imperial"], "required": true }
        }
      }
    ],
    "storage": true
  },
```

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
```

Game and system data come from subscriptions (`fps.subscribe`,
`media.subscribe`…), which update your state until you cancel them. See
[services and permissions](services.md) for what each permission allows,
and [security](security.md) for what a widget can never do. The complete
example is in
[`docs/content/examples/weather`](../examples/weather/).

## 11. Package

```sh
overcrow-widget package
overcrow-widget inspect dist/com.example.my-counter-0.1.0.ocpkg
```

`package` writes a deterministic `.ocpkg` to `dist/`: the same sources and
CLI version give the same bytes on every system. `inspect` shows what a
package holds and asks for, as a reviewer sees it. A package installed
locally stays unverified; users get widgets from the signed catalog. See
[the package](package.md).

## 12. Submit

Add a `listing.json` with the marketplace text, run the admission yourself,
then open a pull request that adds your widget under `widgets/<dir>/` on the
`candidate` branch of the
[public repository](https://github.com/Valhallab/playervox-overcrow-releases):

```sh
overcrow-widget admit
```

`admit` runs exactly the checks of the marketplace CI. What happens next,
from review to the signed catalog, is in
[publishing and review](publishing.md).
