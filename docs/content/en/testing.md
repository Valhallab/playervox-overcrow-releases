# Testing a widget

A PlayerVox OverCrow widget is tested in two ways, both without a desktop,
a game or an account:

- **Unit tests of the logic**, in Node.js, with `@overcrow/sdk/testing`:
  fast, for the functions of `logic.ts`.
- **Scenarios**, played by `overcrow-widget test` in OverCrow's **headless
  runtime**: the real VM, style, layout and renderer, OverCrow's own
  checks, simulated services, virtual time and reference images. What
  passes there is what the overlay shows.

<!-- source: templates/counter/tests/example.scenario.json -->
```json
{
  "scenarioVersion": 1,
  "name": "example",
  "description": "The counter starts at 0 and Increase adds one. `overcrow-widget test` plays it and compares the images with tests/reference/example/; `--update` records them again (https://overcrow.playervox.com/docs/en/testing/).",
  "host": { "mode": "interactive" },
  "steps": [
    { "expect": { "state": "running", "text": ["0"], "image": "initial" } },
    { "pointer": { "click": { "label": "Increase" } } },
    { "expect": { "text": ["1"], "noText": ["0"], "image": "increased", "fault": "none" } }
  ]
}
```

This scenario starts the counter in Interactive mode, checks that it shows
`0` and compares its image with a reference, clicks the button whose label
is "Increase", then checks the new text and image.

## Unit tests

`installRuntime()` puts a stand-in for OverCrow in place before the logic
is imported: service calls return promises that your test settles,
subscriptions take the values you push, timers fire when you advance the
time, and `Date.now()` is virtual.

<!-- source: widgets/clock/tests/logic.test.mjs -->
```js
const START = Date.UTC(2026, 6, 17, 12, 8, 42, 250);
const vm = installRuntime({
  now: START,
  host: {
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 120 },
    messages: { label: "Local time {time}", "label-date": "Local time {time}, {date}" },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
```

<!-- source: widgets/clock/tests/logic.test.mjs -->
```js
test("one timer at the next local minute, then each minute", () => {
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, Date.UTC(2026, 6, 17, 12, 9));
  vm.advance(Date.UTC(2026, 6, 17, 12, 9) - vm.now);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:09");
  assert.deepEqual(
    vm.timers.map(({ intervalMs, repeat }) => ({ intervalMs, repeat })),
    [{ intervalMs: 60_000, repeat: true }],
  );
  assert.equal(vm.advance(120_000), 2);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11");
});
```

| Member | Does |
| --- | --- |
| `installRuntime({ now, host })` | Installs the stand-in; `Date.now()` returns the virtual time. One at a time. |
| `now`, `advance(ms)` | The virtual time; `advance` fires the timers that fall due, in order (a repeating one re-arms), and returns their count. |
| `setHost(changes)` | Changes `host` as OverCrow does: `region`, `locale`, `options`… |
| `calls`, `lastCall(service)` | Every service call, with `resolve(value)` and `reject(code)`. |
| `push(service, value)`, `fail(service, code)` | The next update, or the final failure, of the subscriptions to a service. |
| `menu(row)` | Chooses an `action` row of the options menu. |
| `draws`, `logs`, `timers`, `table` | What the logic sent: canvas drawings, logs, timers, and the functions of the view. |
| `uninstall()` | Removes the stand-in and gives `Date.now` back. |

The stand-in runs your logic only: it does not apply OverCrow's rules (the
grants, the accounts, the user-action rule) and renders nothing. Scenarios
do. The reference widgets compile their `logic.ts` with a small loader
before importing it:

<!-- source: widgets/clock/tests/load-logic.mjs -->
```js
export async function loadLogic() {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("logic.ts", root), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
  });
  mkdirSync(new URL("dist/", root), { recursive: true });
  // One file per test process: test files run in parallel.
  const output = new URL(`dist/logic-${process.pid}.mjs`, root);
  writeFileSync(output, outputText);
  return import(output.href);
}
```

## Scenarios

A scenario is a JSON file of the project, `tests/<name>.scenario.json`,
whose `name` is `<name>`. Its reference images are
`tests/reference/<name>/<image>.png`. Neither is packaged.

```sh
overcrow-widget test --runtime path/to/overcrow-widget-headless
overcrow-widget test --runtime path/to/overcrow-widget-headless --scenario example
overcrow-widget test --runtime path/to/overcrow-widget-headless --update
```

`--update` records the captured images as the references: look at them
before you commit them. A failed image writes
`tests/output/<name>/<image>.actual.png` and, for a difference,
`<image>.diff.png`, with the differing pixels in red.

A scenario has four parts: `host` (the user's settings), `fixtures` (what
the services answer), `assets` (images for the fixtures) and `steps` (what
happens, and what must hold). The format is strict: an unknown field, name
or value is an error of the scenario, reported with its path
(`steps[3].pointer.click`) before anything runs. It is also checked against
the manifest: the grants the widget declares, the menu rows that exist, the
services of its capabilities.

### `host`

Everything is optional.

| Member | Default | Meaning |
| --- | --- | --- |
| `locale` | `en` | `en` or `fr`. |
| `theme` | `dark` | `dark` or `light`. |
| `scale` | `1000` | Content scale in thousandths: 500 to 1750 (50 % to 175 %). |
| `size` | the manifest's preferred size | `{ width, height }` of the frame, in logical pixels; the manifest's `fit` still applies. |
| `mode` | `passive` | `interactive` gives input to the widget. |
| `visible` | `true` | Hidden, the widget gets no timer tick. |
| `frame` | `false` | `true` captures OverCrow's frame around the content. |
| `background` | the theme's panel colour | `#rrggbb` behind the widget. |
| `region` | `us`, date order of the locale | `{ numberFormat, dateOrder }`. |
| `zone` | UTC | `{ offsetMinutes, transitions: [{ at, offsetMinutes }] }`: the user's UTC offset, and the instants at which it changes. |
| `startAt` | 2026-01-01T00:00:00Z | The virtual time at which the widget starts, in Unix milliseconds. |
| `options` | the rows' defaults | Values of the rows of the options menu. |
| `grants` | `"declared"` | Or the exact list of what the user granted (`storage`, `network`, `fps.read`…): OverCrow refuses the rest. |
| `accounts` | connected | `{ playervox, twitch }`, each `connected`, `disconnected`, `pending`, `expired` or `offline`. |
| `features` | all | The data sources of the machine, for `requires`. |
| `storage` | empty | The widget's storage before it starts. |

<!-- source: widgets/clock/tests/summer-time.scenario.json -->
```json
  "host": {
    "zone": {
      "offsetMinutes": 60,
      "transitions": [
        {
          "at": 1774746000000,
          "offsetMinutes": 120
        },
        {
          "at": 1792890000000,
          "offsetMinutes": 60
        }
      ]
    },
    "startAt": 1774745970000
  },
```

With an account that is not `connected`, OverCrow draws its own account
panel over the widget, as it does for the user; capture it with `frame`.

### `fixtures`

Fixtures replace where the data comes from, never OverCrow's checks. A call
first passes the grants, its parameters, the user-action rule and the
account check, exactly as in the overlay; only then does a fixture answer
it. Every value must have the shape of the service's
[result](result-shapes.md): one that does not is an error of the scenario,
not of the widget.

| Member | Answers |
| --- | --- |
| `subscriptions` | The value of a subscription when it starts; `publish` steps send the next ones. |
| `calls` | The calls of a service, in order: `{ "value": … }` or `{ "error": code }`. A call beyond them is an error of the scenario. |
| `http` | The `http.fetch` requests, each used once: `{ "request": { method, url }, "response": { status, contentType, body } }` (or `bodyBase64`), or `{ "request": …, "error": code }`. The manifest's network rules apply first, and the response bounds apply as in the overlay. |
| `confirmations` | `accept` or `cancel`, in order, for OverCrow's confirmation of `notes.delete` and `journal.delete`. |
| `intents` | The answer to each submitted [write intent](forms.md#forms-that-write-user-data), in order: `"accepted"`, `{ "error": code }` or `"pending"`. |

<!-- source: widgets/stopwatch/tests/errors.scenario.json -->
```json
  "fixtures": {
    "calls": {
      "stopwatch.toggle": [
        {
          "error": "unavailable"
        },
        {
          "value": {
            "running": true,
            "elapsedMs": 5000,
            "at": 0,
            "shortcuts": {
              "toggle": "Super+Alt+T",
              "reset": "Super+Alt+Z",
              "bound": true
            }
          }
        }
      ],
      "stopwatch.reset": [
        {
          "error": "stale_context"
        }
      ]
    },
    "subscriptions": {
      "stopwatch.subscribe": {
        "running": false,
        "elapsedMs": 5000,
        "at": 0,
        "shortcuts": {
          "toggle": "Super+Alt+T",
          "reset": "Super+Alt+Z",
          "bound": true
        }
      }
    }
  },
```

<!-- source: widgets/warframe-market/tests/errors.scenario.json -->
```json
    "http": [
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/versions"
        },
        "error": "timeout"
      },
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/orders/item/primed_flow"
        },
        "error": "transport_failed"
      },
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/orders/item/primed_flow"
        },
        "response": {
          "status": 200,
          "contentType": "application/json",
          "body": "{\"apiVersion\":\"0.25.0\",\"data\":[],\"error\":null}"
        }
      }
    ]
```

The codes that OverCrow gives itself (`permission_denied`,
`gesture_required`, `not_connected`, `invalid_request`) cannot be written
in a fixture: get them the real way, with `grants`, `accounts`, a call
outside a user action, or wrong parameters. Storage, timers and the
clipboard are OverCrow's own and need no fixture.

### `assets`

Images that a fixture hands to the widget, as OverCrow hands it a media
cover or a chat emote: `{ "<name>": "<path>" }`, at most 8, each a PNG or
JPEG of the project (`tests/assets/cover.png`). Where a result holds an
image handle, the fixture writes `"fixture:<name>"`.

### `steps`

| Step | Does |
| --- | --- |
| `{ "advance": { "ms": N } }` | Moves the virtual time by `N` ms. Every timer due on the way fires in order, and the UTC offset changes at its instant. |
| `{ "advance": { "ms": N, "jump": true } }` | Moves the time at once, as a machine waking from sleep: each due timer fires once, late. |
| `{ "host": { … } }` | Changes `locale`, `theme`, `scale`, `size`, `mode`, `visible`, `region`, `zone` or `accounts`. |
| `{ "pointer": { "click": target } }` | A click. Also `rightClick`, `move` (hover), `wheel` (`{ target, dx, dy }`) and `"leave"`. |
| `{ "key": { "key": "Enter", "modifiers": ["shift"] } }` | A key press: `Tab`, `Escape`, `ArrowUp`, letters, digits… |
| `{ "text": "…" }` | Text typed into the focused field. |
| `{ "menu": { "id": "row", "value": … } }` | A row of the options menu: the value of a toggle, slider or choice, none for an action. |
| `{ "publish": { "service": "fps.subscribe", "value": … } }` | The next value of a subscription. |
| `{ "publish": { "service": "media.subscribe", "error": "unavailable" } }` | Ends the subscription with this failure. |
| `{ "expect": { … } }` | What must hold once the previous steps settled. |

A pointer target is `{ "at": [x, y] }` (logical pixels of the content),
`{ "text": "…" }` (the first element showing exactly this text) or
`{ "label": "…" }` (its accessible label). Input reaches the widget in
Interactive mode only. A click is a user action; a menu row never is.

Each step settles before the next: the widget has answered everything it
was sent and nothing is in flight. There is no real waiting.

### `expect`

| Member | Holds when |
| --- | --- |
| `image` | The capture matches `tests/reference/<scenario>/<image>.png`. Names are unique in a scenario. |
| `text`, `noText` | Each text is (is not) the whole text of an element the widget shows. |
| `calls` | Exactly these service calls were made since the previous `calls` expectation, in order: `{ service, params?, outcome? }`, `outcome` being `ok` or the error code the widget received. |
| `state` | `starting`, `running`, `restarting`, `failed`, `refused` or `stopped`. |
| `fault` | The last fault of the widget's VM, or `none`. |
| `clipboard` | The last text the widget wrote to the clipboard. |
| `intents` | Exactly these write intents were submitted since the previous `intents` expectation, in order: `{ intent, fields?, outcome? }`. `fields` are the exact values OverCrow's form sent. |

<!-- source: templates/chart/tests/example.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["Activity", "50"], "image": "initial" } },
    { "advance": { "ms": 10000 } },
    { "expect": { "noText": ["50"], "image": "ten-seconds", "fault": "none" } }
  ]
```

The faults a widget's VM can report:

<!-- generated:fault-categories -->
| Category | Fatal | Meaning |
| --- | --- | --- |
| `resource_limit` | yes | Heap, stack, job queue or message budget exhausted inside the VM. |
| `unresponsive` | yes | The turn budget interrupted the VM. |
| `protocol_violation` | yes | The host sent a message the VM cannot accept. |
| `invalid_bundle` | yes | `logic.js` or the compiled view failed to load or register. |
| `handler_exception` | no | An event handler threw; the VM keeps running. |
<!-- /generated:fault-categories -->

## Reference images

An image is the widget's content, rendered at the scenario's scale, theme
and size. Record the states that matter in both themes, both languages and
two scales, as the reference widgets do: a scenario can change `theme`,
`locale` and `scale` between two `expect` steps.

<!-- source: templates/list/tests/example.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["Today", "2 left"], "image": "initial" } },
    { "host": { "locale": "fr", "theme": "light" } },
    { "expect": { "image": "french-light", "fault": "none" } }
  ]
```

Images are compared with a small tolerance: a pixel differs when one of its
channels differs by more than 2 levels, and the image differs when more
than 100 pixels per million do. One wrong letter is far above that. A
reference is never rewritten by a test run: only `--update` records images.

## Time and determinism

The runtime is deterministic: the same package and scenario render the same
bytes, on Linux and on Windows.

- Time is virtual: `Date.now()` and `new Date()` return the scenario's
  time, timers fire when the scenario moves it.
- `Math.random()` is seeded with a fixed value.
- Text uses the fonts bundled with OverCrow, never the system's.
- Rendering does not depend on the graphics card.

This holds for the test runtime only: in the overlay, time and randomness
are real.

## The headless runtime

`overcrow-widget-headless` is OverCrow's own code without a window: it
validates the package as the overlay does and runs the widget's logic in
the same sandbox. `overcrow-widget test` needs its path, with `--runtime`,
and prints its version and SHA-256. Without the operating system's sandbox
the runtime refuses to run and says so; the test command then ends with
status 2.
