# The manifest

`manifest.json` tells PlayerVox OverCrow what a widget is before any of its
code runs: its identity and version, its names, the sizes it supports, the
permissions it asks for and the rows it adds to its options menu. You write
it by hand; it is packaged exactly as written.

The file is one strict JSON object. A byte-order mark, a duplicate key,
trailing data or an unknown field rejects it: there is no field that
OverCrow ignores.

## A complete example

<!-- source: templates/counter/manifest.json -->
```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "{{id}}",
  "version": "0.1.0",
  "name": {
    "en": "{{name}}",
    "fr": "{{name}}"
  },
  "sizing": {
    "fit": "none",
    "preferred": { "width": 200, "height": 96 },
    "min": { "width": 140, "height": 72 },
    "max": { "width": 640, "height": 640 }
  }
}
```

`overcrow-widget init` writes this file; `{{id}}` and `{{name}}` are the
values it fills in. A manifest with permissions and a menu:

<!-- source: docs/content/examples/countdown/manifest.json -->
```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "com.example.countdown",
  "version": "1.0.0",
  "name": { "en": "Countdown", "fr": "Compte à rebours" },
  "sizing": {
    "fit": "none",
    "preferred": { "width": 220, "height": 190 },
    "min": { "width": 180, "height": 160 },
    "max": { "width": 480, "height": 400 }
  },
  "permissions": {
    "storage": true
  },
  "wrapper": {
    "menu": [
      {
        "type": "toggle",
        "id": "show-rounds",
        "label": { "en": "Show finished rounds", "fr": "Afficher les tours terminés" },
        "icon": "circle-check",
        "default": true
      },
      {
        "type": "action",
        "id": "reset-rounds",
        "label": { "en": "Reset the rounds", "fr": "Remettre les tours à zéro" },
        "icon": "rotate-ccw",
        "visibleWhen": "show-rounds"
      }
    ]
  }
}
```

## Fields

<!-- generated:manifest-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | integer 1 to 1 | yes | Manifest document version. |
| `apiVersion` | integer 1 to 1 | yes | Widget API version; selects this schema. |
| `id` | `widget ID` | yes | Reverse-DNS ID, from `MIN_WIDGET_ID_BYTES` to `MAX_WIDGET_ID_BYTES`: at least two dot-separated segments of `[a-z0-9-]`, each at most `MAX_DNS_LABEL_BYTES` and not starting or ending with `-`. `com.playervox` and `com.playervox.*` are reserved for packages signed by PlayerVox. |
| `version` | `version` | yes | SemVer 2.0.0 `MAJOR.MINOR.PATCH[-PRERELEASE]` in canonical form, at most `MAX_VERSION_BYTES`; build metadata is rejected. |
| `name` | `WidgetName` | yes | Localized widget name shown by the host. |
| `sizing` | `Sizing` | yes | Size and fit rules applied by the widget's frame. |
| `vm` | `VmRequest` | no | VM budget request; absent means the defaults. |
| `permissions` | `Permissions` | no | Requested permissions; absent means none. |
| `wrapper` | `wrapper` | no | Widget rows of the host options menu. |
| `requires` | `host features` | no | Distinct host data sources the widget cannot work without, as in a `wrapper.menu` row's `requires`. On a machine that lacks one, the host neither starts nor shows the widget and keeps its layout; the widget comes back when the source does. |
<!-- /generated:manifest-fields -->

### Identity and version

- **`id`** is the widget's identity everywhere: in the catalog, in the
  user's profile, in its storage. Choose a reverse-DNS ID under a domain you
  control and keep it. IDs under `com.playervox` are reserved for widgets
  published by PlayerVox.
- **`version`** is a semantic version. A published version never changes:
  any change to a published widget is a new, higher version.
- **`schemaVersion`** and **`apiVersion`** are both `1`.

### Names

`name` gives the name OverCrow shows in its widget list and menus, in
English and in French. Both are required.

<!-- generated:manifest-name -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `en` | `name text` | yes | English name. |
| `fr` | `name text` | yes | French name. |
<!-- /generated:manifest-name -->

## Sizes

`sizing` says how large the widget is when the user adds it, how small and
how large the user may resize it, and whether OverCrow can fit its frame to
its content. Lengths are logical pixels at 100 % scale; the user's content
scale (50 % to 175 %) multiplies them.

<!-- generated:manifest-sizing -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `fit` | `none` \| `both` \| `height` | yes | Content fitting the widget supports: `both` axes, `height` only, or `none`. Manual resizing is always available. |
| `defaultMode` | `fit` \| `manual` | no | Mode of a newly placed widget; default `fit` when `fit` is not `none`, else `manual`. `fit` with `fit: none` is rejected. |
| `preferred` | `Dimensions` | yes | Initial size; within `min` and `max`. |
| `min` | `Dimensions` | yes | Smallest size. |
| `max` | `Dimensions` | yes | Largest size. |
<!-- /generated:manifest-sizing -->

Each of `preferred`, `min` and `max` is a pair of dimensions, with
`min` ≤ `preferred` ≤ `max` on both axes:

<!-- generated:manifest-dimensions -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `width` | integer 1 to 4096 | yes | Logical pixels. |
| `height` | integer 1 to 4096 | yes | Logical pixels. |
<!-- /generated:manifest-dimensions -->

With `fit: "both"`, OverCrow sizes the frame to what the view needs, in
both directions: the Clock grows when the user turns the seconds on. With
`fit: "height"`, the user chooses the width and the height follows the
content. With `fit: "none"`, the frame keeps the size the user gave it and
the view fills it. The user can always resize by hand.

<!-- source: widgets/clock/manifest.json -->
```json
  "sizing": {
    "fit": "both",
    "preferred": { "width": 110, "height": 60 },
    "min": { "width": 40, "height": 24 },
    "max": { "width": 480, "height": 240 }
  },
```

## Permissions

A widget gets nothing it has not declared here, and a declaration grants
nothing by itself: the user consents first.
[Services and permissions](services.md) explains each permission and what
it allows.

<!-- generated:manifest-permissions -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `network` | list of `NetworkRule` ≤ `MAX_NETWORK_RULES` | no | Distinct network rules. |
| `storage` | boolean | no | Host key-value storage; default `false`. |
| `clipboardWrite` | boolean | no | Clipboard text writes; default `false`. |
| `gameEvents` | list of `game event` ≤ `MAX_GAME_EVENTS` | no | Distinct `overcrow.game.<name>.v1` event names. |
| `capabilities` | `capability names` | no | Distinct capabilities of the schema. |
<!-- /generated:manifest-permissions -->

<!-- source: widgets/stopwatch/manifest.json -->
```json
  "permissions": {
    "capabilities": ["stopwatch.read", "stopwatch.control"]
  }
```

A network rule is an object of its own; its fields are described with
[network rules](services.md#network-rules).

## The options menu

Every widget has an options menu, opened from its frame. OverCrow puts its
own rows first (opacity, scale, fit to content, visibility in Passive
mode). `wrapper.menu` adds yours below them: toggles, sliders, choices,
actions and groups, each with a label in both languages.

<!-- source: widgets/clock/manifest.json -->
```json
  "wrapper": {
    "menu": [
      {
        "type": "toggle",
        "id": "show-seconds",
        "label": { "en": "Show seconds", "fr": "Afficher les secondes" },
        "default": false
      },
      {
        "type": "toggle",
        "id": "show-date",
        "label": { "en": "Show date", "fr": "Afficher la date" },
        "default": true
      },
      {
        "type": "choice",
        "id": "date-format",
        "label": { "en": "Date format", "fr": "Format de date" },
        "visibleWhen": "show-date",
        "choices": [
          { "value": "day-month-year", "label": { "en": "dd/mm/yyyy", "fr": "jj/mm/aaaa" } },
          { "value": "year-month-day", "label": { "en": "yyyy-mm-dd", "fr": "aaaa-mm-jj" } },
          { "value": "month-day-year", "label": { "en": "mm/dd/yyyy", "fr": "mm/jj/aaaa" } }
        ],
        "default": "day-month-year"
      }
    ]
  }
```

OverCrow draws the rows, stores their values in the user's profile and
gives them to the logic: read a value with `option(id, fallback)`, and
follow changes with `onHost`. An `action` row has no value: it calls the
handler you registered with `onMenu`. See
[the options menu in the logic](logic.md#the-options-menu).

A menu row can set one of its declared values or send its action, nothing
else: it cannot grant a permission or open a link, and choosing a row is
not a [user action](services.md#calls-that-need-a-user-action) that allows
a protected service call.

### Fields of every row

<!-- generated:menu-row-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `toggle` \| `slider` \| `choice` \| `action` \| `group` | yes | Row type. |
| `id` | identifier ≤ `MAX_MENU_ID_BYTES` | yes | Unique among all rows of the widget; key of the stored value. |
| `label` | `MenuLabel` | yes | Localized row label. |
| `icon` | Lucide icon name | no | Leading icon from the host list, drawn by the host. |
| `visibleWhen` | identifier ≤ `MAX_MENU_ID_BYTES` | no | ID of a `toggle` row declared earlier; this row is shown only while that toggle is on. |
| `requires` | `fps` \| `telemetry.cpuTemperature` \| `telemetry.gpuTemperature` | no | Host data source; the host hides the row when it cannot supply it. |
<!-- /generated:menu-row-fields -->

A row with `visibleWhen` shows only while the named toggle is on: the
Clock's date format appears when the date does. A row with `requires` is
hidden on a machine that cannot supply that data, as the Performance
widget's temperature rows are:

<!-- source: widgets/performance/manifest.json -->
```json
        "requires": "telemetry.cpuTemperature",
```

### Row types

<!-- generated:menu-row-types -->
### `toggle`

Boolean switch.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `default` | boolean | yes | Initial value. |

### `slider`

Bounded number; `step` > 0, `step` ≤ `max - min`, at most `MAX_SLIDER_STEPS` steps, `default` within range.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `min` | number -1000000 to 1000000 | yes | Lower bound. |
| `max` | number -1000000 to 1000000 | yes | Upper bound, greater than `min`. |
| `step` | number -1000000 to 1000000 | yes | Increment. |
| `default` | number -1000000 to 1000000 | yes | Initial value. |

### `choice`

One value among declared choices.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `choices` | list of `MenuChoice` ≤ `MAX_MENU_CHOICES` | yes | At least `MIN_MENU_CHOICES` choices. |
| `default` | identifier ≤ `MAX_MENU_ID_BYTES` | yes | Value of one declared choice. |

### `action`

Calls the handler registered with `onMenu`, with the row ID. Not a user action.

### `group`

Side flyout holding non-group rows.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `rows` | list of `MenuRow` ≤ `MAX_MENU_ROWS` | yes | At least one row; a `group` is not allowed here. |
<!-- /generated:menu-row-types -->

### Labels and choices

A `label` is an object with both languages:

<!-- generated:menu-label -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `en` | `label text` | yes | English label. |
| `fr` | `label text` | yes | French label. |
<!-- /generated:menu-label -->

Each entry of `choices` is a value and its label:

<!-- generated:menu-choice -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `value` | identifier ≤ `MAX_MENU_ID_BYTES` | yes | Stored value; unique within the row. |
| `label` | `MenuLabel` | yes | Localized choice label. |
<!-- /generated:menu-choice -->

## Required data sources

`requires` at the top level lists data sources the widget cannot work
without, with the same names as a row's `requires`. On a machine that lacks
one, OverCrow neither starts nor shows the widget and keeps its place in the
layout; the widget comes back when the source does. Use it for a widget
that has nothing to show otherwise, such as a frame-rate counter without a
frame-rate source. For a single optional value, prefer a row's `requires`.

## A larger memory budget

The logic runs with a heap of 16 MiB. A widget that needs more asks for it
with `vm`; nothing else about the VM's budgets can be changed.

<!-- generated:manifest-vm -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `heapMiB` | integer 16 to 48 | yes | QuickJS heap ceiling in MiB, from `VM_HEAP_BYTES` to `VM_MAX_HEAP_BYTES`. The VM process ceiling (`VM_PROCESS_MEMORY_BYTES`) does not change. |
<!-- /generated:manifest-vm -->

The memory ceiling of the widget's process stays the same, so a larger heap
leaves less room for everything else. Ask for it only when
`overcrow-widget dev` shows the widget stopping with `resource_limit`.

## How the manifest is checked

`overcrow-widget check` validates the manifest with the validator OverCrow
itself runs, and points at the member it refuses:

```text
error[manifest.sizing]: `sizing` is out of bounds or inconsistent
  --> manifest.json:7:3
   |
 7 |   "sizing": {
   |   ^
   = help: `min` <= `preferred` <= `max`, each within the schema's widget size bounds
check: 1 error(s), 0 warning(s)
```

OverCrow validates it again when the package is admitted to the catalog,
when it is installed and each time the widget starts. A new version whose
manifest asks for more than the previous one (a network rule, a game event,
a capability, storage or the clipboard) waits for the user's consent before
it replaces the installed version.
