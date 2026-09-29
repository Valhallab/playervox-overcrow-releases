# Testing a widget

Two kinds of tests, without a desktop or an account:

- **Unit tests of the logic**, in Node, with `@overcrow/sdk/testing`: fast,
  for the functions of `logic.ts`.
- **Scenarios**, played by `overcrow-widget test` in OverCrow's **headless
  runtime**: the real VM, style, layout and renderer, the host's own checks,
  simulated services, virtual time and reference images. What passes there is
  what the overlay shows.

## Unit tests with `@overcrow/sdk/testing`

`installRuntime()` puts a stand-in for the VM's runtime surface in place
before the logic is imported: service calls return promises your test
settles, subscriptions take the values you push, timers are host timers of
at least 100 ms, and `Date.now()` is virtual.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12), host: { locale: "fr" } });
const { toggle } = await import("./dist/logic.js"); // your logic, compiled
const { state } = await import("@overcrow/sdk");

test("the stopwatch shows the host's refusal", async () => {
  toggle();
  vm.lastCall("stopwatch.toggle")?.reject("unavailable");
  await Promise.resolve();
  assert.equal(state.status, "unavailable");
});

test("the clock ticks each minute", () => {
  assert.equal(vm.advance(60_000), 1);
});
```

| Member | Does |
| --- | --- |
| `installRuntime({ now, host })` | Installs the `overcrow` global; `Date.now()` returns the virtual time. One at a time. |
| `now`, `advance(ms)` | The virtual time; `advance` fires the due timers in order (a repeating one re-arms) and returns their count. |
| `setHost(changes)` | Replaces `host` as a host message does (`region`, `locale`…). |
| `calls`, `lastCall(service)` | Every call, with `resolve(value)` and `reject(code)`. |
| `push(service, value)`, `fail(service, code)` | The next update, or the final failure, of the service's subscriptions. |
| `menu(row)` | Chooses an `action` row. |
| `draws`, `logs`, `timers`, `table` | What the logic sent. |
| `uninstall()` | Removes the global and gives `Date.now` back. |

It checks the logic only: it does not apply the host's rules (grants,
accounts, the gesture rule) nor render anything. Scenarios do.

## Scenarios

A scenario is a JSON file of the project, `tests/<name>.scenario.json`,
whose `name` is `<name>`. Its reference images are
`tests/reference/<name>/<image>.png`. Neither is packaged. `overcrow-widget
init` writes an example; [`overcrow-widget test`](cli.md#test-dir) plays
them all:

```sh
overcrow-widget test --runtime path/to/overcrow-widget-headless
overcrow-widget test --update     # record the references (review them first)
overcrow-widget test --scenario dst --format json
```

A failed image writes `tests/output/<name>/<image>.actual.png` and, for a
difference, `<image>.diff.png`, the differing pixels in red; `tests/output/`
is ignored by Git.

```json
{
  "scenarioVersion": 1,
  "name": "dst",
  "description": "Summer time starts at 01:00 UTC on 2026-03-29.",
  "host": {
    "locale": "fr",
    "theme": "dark",
    "scale": 1500,
    "zone": {
      "offsetMinutes": 60,
      "transitions": [{ "at": 1774746000000, "offsetMinutes": 120 }]
    },
    "startAt": 1774745940000
  },
  "steps": [
    { "expect": { "text": ["01:59"], "image": "before" } },
    { "advance": { "ms": 60000 } },
    { "expect": { "text": ["03:00"], "noText": ["02:00"], "image": "after" } }
  ]
}
```

A widget that calls services answers them from `fixtures`; here a stopwatch
button whose first call fails:

```json
{
  "scenarioVersion": 1,
  "name": "error-then-success",
  "host": { "mode": "interactive" },
  "fixtures": {
    "calls": { "stopwatch.toggle": [{ "error": "unavailable" }, { "value": null }] },
    "subscriptions": { "stopwatch.subscribe": null }
  },
  "steps": [
    { "pointer": { "click": { "label": "Start or stop" } } },
    { "expect": { "text": ["unavailable"], "calls": [
      { "service": "stopwatch.subscribe", "outcome": "ok" },
      { "service": "stopwatch.toggle", "outcome": "unavailable" }
    ] } }
  ]
}
```

The Clock and stopwatch of `sdk/test/e2e/` in this repository have complete
scenarios: two times in both themes, both languages and two scales, summer
time through `region.nextChangeAt`, hidden then shown, a service error then
success, a refused permission and the gesture rule.

The format is strict: an unknown field, name or out-of-bound value is an
error of the scenario, reported before anything runs, with its path
(`steps[3].pointer.click`). It is checked against the manifest too: grants
it declares, menu rows and values that exist, fixtures of declared
capabilities. The Rust crate `crates/overcrow-widget-scenario` holds the
format, its bounds and shared test vectors.

### `host`

Everything is optional.

| Member | Default | Meaning |
| --- | --- | --- |
| `locale` | `en` | `en` or `fr`. |
| `theme` | `dark` | `dark` or `light`. |
| `scale` | `1000` | Content scale in thousandths, as `host.scale`: 500 to 1750 (50 % to 175 %). |
| `size` | the manifest's preferred size | `{ width, height }` of the container, logical px (1 to 1024); the manifest's `fit` still applies. |
| `mode` | `passive` | `interactive` gives input to the widget, with a new Interactive epoch. |
| `visible` | `true` | Hidden, the widget gets no timer tick; its one-shot timers fire when shown. |
| `frame` | `false` | `true` captures the host wrapper around the content. |
| `background` | the theme's panel colour | `#rrggbb` behind the widget. |
| `region` | `us`, date order of the locale | `{ numberFormat, dateOrder }`. |
| `zone` | UTC | `{ offsetMinutes, transitions: [{ at, offsetMinutes }] }`: the host sends `Region` with the offset and `nextChangeAt`, and again at each transition. |
| `startAt` | 2026-01-01T00:00:00Z | Virtual Unix milliseconds when the widget starts. |
| `options` | the rows' defaults | Values of `wrapper.menu` rows. |
| `grants` | `"declared"` | Or the exact list of granted items (`storage`, `network`, `fps.read`…): the others are refused by the host. |
| `accounts` | connected | `{ playervox, twitch }`: `connected` or `disconnected`. |
| `features` | all | Host data sources of `requires` rows. |
| `storage` | empty | The widget's storage before it starts (within the quota). |

### `fixtures`

The simulator replaces where data comes from, never the host's checks. A
call first passes the grants, its parameters, the gesture rule, the account
check and the sensitive-capability rule, exactly as in the overlay; only
then does a fixture answer it. Every value must have the shape of the
service's result (`Service.returns` in the schema): a value that does not is
an error of the scenario, not of the widget.

| Member | Answers |
| --- | --- |
| `calls` | Provider calls (`stopwatch.toggle`, `notes.create`…): `{ "value": … }` or `{ "error": code }` in call order. A call beyond them is an error of the scenario. Codes the host gives itself (`permission_denied`, `gesture_required`, `not_connected`, `invalid_request`) are refused: use `grants`, `accounts`, Interactive input or the call's parameters. |
| `subscriptions` | The value of a capability subscription (`fps.subscribe`…) when it starts; `publish` steps send the next ones. No data when absent. |
| `http` | `http.fetch` answers, each used once: `{ "request": { method, url }, "response": { status, contentType, body or bodyBase64 } }` or `{ "request": …, "error": code }`. The manifest's network rules apply first. Responses are bounded as the broker bounds them: no redirection (use `redirect_denied`), a printable content type of at most 128 bytes, a body within `MAX_HTTP_RESPONSE_BYTES`; errors are the broker's (`timeout`, `transport_failed`…). |
| `confirmations` | `accept` or `cancel`, in order, for the host's native confirmation of `notes.delete` and `journal.delete`. |

Storage, timers and the clipboard are the host's own.

### `steps`

| Step | Does |
| --- | --- |
| `{ "advance": { "ms": N } }` | Moves the virtual time by `N` ms. Every timer due on the way fires in order, and zone transitions apply at their instant, as on a running machine. The runtime paces the ticks to stay within the host's real-time message rate: hours of minute ticks take seconds. |
| `{ "advance": { "ms": N, "jump": true } }` | Moves the time at once, as a machine waking from sleep: each due timer fires once, late. |
| `{ "host": { … } }` | Changes `locale`, `theme`, `scale`, `size`, `mode`, `visible`, `region`, `zone` or `accounts`. |
| `{ "pointer": { "click": target } }` | Also `rightClick`, `move` (hover), `wheel` (`{ target, dx, dy }`, lines) and `"leave"`. A target is `{ "at": [x, y] }` (logical px of the content), `{ "text": "…" }` (the first element showing exactly this text) or `{ "label": "…" }` (its accessible label). Input reaches the widget in Interactive mode only; a click is a gesture. |
| `{ "key": { "key": "Enter", "modifiers": ["shift"] } }` | A key press; keys are egui's names (`Tab`, `Escape`, `ArrowUp`, letters, digits…). |
| `{ "text": "…" }` | Committed text input for the focused field. |
| `{ "menu": { "id": "row", "value": … } }` | A `wrapper.menu` row: the value of a toggle, slider or choice, none for an action. A menu row is never a gesture. |
| `{ "publish": { "service": "fps.subscribe", "value": … } }` | The next value of a subscription. |
| `{ "expect": { … } }` | What must hold once the previous steps settled. |

Each step settles before the next: the VM has answered everything it was
sent and nothing is in flight. There is no wall-clock wait.

`expect` members:

| Member | Holds when |
| --- | --- |
| `image` | The capture matches `tests/reference/<scenario>/<image>.png` within the parity bounds. Names are unique in a scenario. |
| `text`, `noText` | Each text is (is not) the whole text of an element the widget shows. |
| `calls` | Exactly these calls since the previous `calls` expectation, in order, without the SDK's timers: `{ service, params?, outcome? }`, `outcome` being `ok` or the error code the widget received. |
| `state` | `starting`, `running`, `restarting`, `failed`, `refused` or `stopped`. |
| `fault` | The last fault of the VM (`handler_exception`, `resource_limit`…) or `none`. |
| `clipboard` | The last text the widget wrote to the clipboard. |

## Time and determinism

The runtime is deterministic: the same package and scenario render the same
bytes. It runs on virtual time: `Date.now()`, `Date()` and `new Date()` return
the scenario's time, the host timers fire when the scenario moves it, and
`Math.random()` is seeded with a fixed value. Only the runtime's VM does
this; the overlay's VM refuses it. The text uses the fonts bundled with
OverCrow, never the system's; rendering is on the CPU at a fixed scale,
theme and background.

Images are compared within the schema's `PARITY_CHANNEL_TOLERANCE` (2
levels per channel) and `PARITY_MAX_DIFFERENT_PIXELS` (100 ppm). The Linux
and Windows runtimes rendered the Clock and stopwatch examples of this
repository identically, pixel for pixel; the tolerance is a guard.

## The runtime

`overcrow-widget-headless` is built by OverCrow's release pipeline with the
same code as the application, for Linux and Windows x86-64; the CLI pins a
version and its SHA-256 and never builds it. It validates the package as the
overlay does (a reserved `com.playervox.*` ID is accepted only in its
ephemeral test registry, never as a built-in: the scenario sets every grant)
and runs the widget's code in the same OS sandbox as the overlay: Bubblewrap
and seccomp on Linux, a Less Privileged AppContainer and a Job on Windows.
Without the sandbox it refuses to run and says so. On a Linux session
without cgroup delegation, the VM runs without its per-widget cgroup
(Bubblewrap, seccomp, the rlimits and the VM's heap ceiling still apply) and
the report says `without-cgroup`. On Windows it grants its own executable
read and execute for the AppContainer when the ACL lacks it.

The CLI pins no published runtime yet: pass `--runtime` with one built from
OverCrow. Until the runtime is published with the application and pinned
(P6.4), hosted CI checks the scenarios, their fixtures and reference images
without playing them (`cli/tests/reference_widgets.rs` for the reference
widgets of `widgets/`), and the scenarios are played on Linux and Windows
before each change is merged.

`overcrow-widget test` talks to it through a versioned interface
(`overcrow_widget_scenario::report`): `--version --format json`, then `run
--interface 1 --package … --scenario … --out …`, which writes the images and
prints a report.

## Maintaining the templates

The reference images of `templates/*/tests/reference/` are recorded with the
pinned runtime: create a project from the template, run `overcrow-widget test
--update`, review the images and copy them back. `cli/tests/test_command.rs`
checks that every template's scenario is valid and has its images.
