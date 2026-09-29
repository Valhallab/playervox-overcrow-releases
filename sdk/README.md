# @overcrow/sdk

The TypeScript API of OverCrow widget logic, for widget API v1: widget
state, host data, typed services and capabilities, subscriptions, timers,
canvas drawing, menus, messages, logs, and date, time and number
formatting without `Intl`.

```ts
import * as overcrow from "@overcrow/sdk";

const state = overcrow.initState({ now: Date.now() });
overcrow.timers.atEach("minute", () => {
  state.now = Date.now();
});
```

The package is bundled into a widget's `logic.js` and runs in the widget
VM over its runtime surface 0.1; it has no runtime dependency. The host
checks every service call: the SDK helps, the host decides.

- [Guide](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/docs/sdk-guide.md)
- [API reference](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/docs/sdk-reference.md)
- [Widget schema v1](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/docs/widget-schema-v1.md)

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run pack:check
```

`src/generated/` is written from the widget schema by
`cargo run -p overcrow-widget-schema --example sdk-types` at the repository
root; never edit it by hand. `npm test` packages the end-to-end Clock of
`test/e2e/clock/` with the widget CLI (build it first with
`cargo build -p overcrow-widget-cli` at the repository root) and runs its
`logic.js` over a stand-in of the runtime surface.

MIT licensed.
