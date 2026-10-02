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

The documentation is on the website, in English and in French:

- [The logic](https://overcrow.playervox.com/docs/en/logic/): how a widget's
  logic runs, its state, timers, messages and drawing.
- [Services and permissions](https://overcrow.playervox.com/docs/en/services/).
- [SDK reference](https://overcrow.playervox.com/docs/en/sdk/): every export.
- [Testing a widget](https://overcrow.playervox.com/docs/en/testing/):
  `@overcrow/sdk/testing`, a stand-in of the runtime with virtual time for
  unit tests of widget logic. It is a separate entry point, never bundled
  into a widget.

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
`logic.js` over a stand-in of the runtime surface. `testing/` is the
public test helper, built apart into `dist/testing/`; the scenarios of
`test/e2e/clock/tests/` and `test/e2e/stopwatch/tests/` run with
`overcrow-widget test` and OverCrow's headless runtime.

MIT No Attribution (MIT-0): use, copy and bundle it without keeping any
notice.
