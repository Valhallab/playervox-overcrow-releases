# Limits

Everything in a PlayerVox OverCrow widget is bounded: the size of its
files, the number of elements of its view, the time of a turn of its logic,
the bytes of a response. The bounds keep a widget small and keep one widget
from slowing the game or the others. This page lists the ones a widget
author meets.

```text
error[view.too_many_children]: the view exceeds a size bound of the schema
  --> view.ocml:15:14375
   = help: split long static content, or render repeated content with <for>
check: 1 error(s), 0 warning(s)
```

An element with more than 1024 children: `check` names the bound, the place
and a way out.

## What happens at a limit

- **In the project's files**, a limit is an error of `overcrow-widget
  check`, with a code that names it (`view.too_many_elements`,
  `style.too_many_rules`, `project.file_size`…). Nothing is truncated.
- **In a service call**, a parameter out of bounds fails with
  `invalid_request`, a full quota with `quota_exceeded`, and too many
  requests at once with `busy`. See [errors](services.md#errors).
- **While the logic runs**, exceeding a budget of the VM (the time of a
  turn, the heap, the messages of a turn) stops the widget; OverCrow
  restarts it a few times. See
  [what happens on a failure](logic.md#what-happens-on-a-failure).
- **In what the widget shows**, a value out of bounds (a text too long for
  an attribute, too many nodes) is refused by OverCrow and stops the widget
  too: bound what you show, for example the number of rows of a list.

Lengths are logical pixels at 100 % content scale. Text limits count UTF-8
bytes unless the unit says characters. KiB and MiB are 1024 and 1024²
bytes. The limits that the logic can read are also constants of the SDK:
see [limit constants](sdk.md#limit-constants).

## Limits by topic

<!-- generated:limits -->
### Project files and package

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_VIEW_SOURCE_BYTES` | 256 KiB | `view.ocml` source size. |
| `MAX_STYLE_SOURCE_BYTES` | 128 KiB | `style.ocss` source size. |
| `MAX_LOGIC_BYTES` | 512 KiB | The `logic.js` script, compiled code of the view included. |
| `MAX_LOCALE_ENTRIES` | 2048 | Messages in one `locales/<locale>.json` file. |
| `MAX_LOCALE_KEY_BYTES` | 128 bytes | Length of one message key. |
| `MAX_LOCALE_VALUE_BYTES` | 4 KiB | Length of one message text. |
| `MAX_LOCALE_FILE_BYTES` | 256 KiB | One `locales/<locale>.json` file. |
| `MAX_MANIFEST_BYTES` | 64 KiB | `manifest.json` size. |
| `MAX_LICENSE_BYTES` | 64 KiB | `LICENSE` text. |
| `MAX_COMPILED_VIEW_BYTES` | 512 KiB | `view.json`, the compiled view. |
| `MAX_PACKAGE_BYTES` | 16 MiB | Size of one `.ocpkg` archive. |
| `MAX_PACKAGE_FILES` | 256 | Entries in one archive, `manifest.json` and `ledger.json` included. |
| `MAX_PACKAGE_PATH_BYTES` | 128 bytes | Path of one archive entry. |
| `MAX_ASSET_PATH_SEGMENTS` | 4 | Path segments below `assets/`, the file name included. |

### Manifest and options menu

| Limit | Value | Meaning |
| --- | --- | --- |
| `MIN_WIDGET_ID_BYTES` | 3 bytes | Shortest widget ID. |
| `MAX_WIDGET_ID_BYTES` | 128 bytes | Longest widget ID; each dot-separated segment is at most 63 bytes. |
| `MAX_VERSION_BYTES` | 64 bytes | Package version text. |
| `MAX_WIDGET_NAME_CHARS` | 48 characters | One English or French widget name in the manifest. |
| `MAX_WIDGET_EDGE_PX` | 4096 px | Width or height of a widget's frame. |
| `MIN_CONTENT_SCALE` | 500 ‰ | Smallest content scale (50 %). |
| `MAX_CONTENT_SCALE` | 1750 ‰ | Largest content scale (175 %). |
| `MAX_GAME_EVENTS` | 32 | Semantic game events declared by one package. |
| `MAX_MENU_ROWS` | 16 | Widget rows in `wrapper.menu`, group rows and their children included. |
| `MAX_MENU_DEPTH` | 1 | Submenu levels: a `group` cannot contain another `group`. |
| `MAX_MENU_LABEL_CHARS` | 80 characters | One English or French label of a row or choice. |
| `MAX_MENU_ID_BYTES` | 48 bytes | Row ID and choice value. |
| `MIN_MENU_CHOICES` | 2 | Choices of one `choice` row, lower bound. |
| `MAX_MENU_CHOICES` | 16 | Choices of one `choice` row, upper bound. |
| `MAX_MENU_NUMBER` | 1000000 absolute value | Absolute value of a slider bound, step or default. |
| `MAX_SLIDER_STEPS` | 10000 | `(max - min) / step` of one slider row. |

### Network rules

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_NETWORK_RULES` | 32 | Network rules declared by one package. |
| `MAX_NETWORK_PATH_BYTES` | 1 KiB | `path` template of one network rule. |
| `MAX_PATH_PARAMS` | 8 | `pathParams` of one network rule. |
| `MAX_QUERY_PARAMS` | 16 | `queryParams` of one network rule. |
| `MAX_ENUM_VALUES` | 32 | Values of one `enum` parameter constraint. |
| `MAX_ENUM_VALUE_BYTES` | 128 bytes | One `enum` parameter value. |
| `MAX_PARAMETER_NAME_BYTES` | 32 bytes | Name of one path or query parameter. |
| `MAX_SLUG_PARAMETER_BYTES` | 128 bytes | Largest `maxLength` of a `slug` parameter constraint. |
| `MAX_STRING_PARAMETER_BYTES` | 256 bytes | Largest `maxLength` of a `string` query parameter constraint. |
| `MAX_DNS_LABEL_BYTES` | 63 bytes | One dot-separated label of a network origin host or of a widget ID. |
| `MAX_DNS_NAME_BYTES` | 253 bytes | Host name of one network origin. |
| `MAX_REQUEST_URL_BYTES` | 2 KiB | URL text of one request. |
| `MAX_HTTP_REQUEST_BYTES` | 256 KiB | Body of one outgoing request. |
| `MAX_HTTP_RESPONSE_BYTES` | 1 MiB | Body of one response delivered to the widget when its network rule declares no `maxResponseBytes`, and of every `as: "image"` response. |
| `MAX_HTTP_DECLARED_RESPONSE_BYTES` | 3 MiB | Largest `maxResponseBytes` of one network rule: the body of one response the rule allows, delivered to the widget. |
| `MAX_HTTP_RESPONSE_BYTES_PER_WIDGET` | 4 MiB | Response bytes one widget's requests in flight may reserve, each the bound of its rule; `busy` beyond. Equals `MAX_HTTP_CONCURRENT_PER_WIDGET` × `MAX_HTTP_RESPONSE_BYTES`, so rules without `maxResponseBytes` never reach it. |
| `MAX_HTTP_RESPONSE_BYTES_GLOBAL` | 64 MiB | Response bytes all widgets' requests in flight may reserve; `busy` beyond. Equals `MAX_HTTP_CONCURRENT_GLOBAL` × `MAX_HTTP_RESPONSE_BYTES`. |
| `MAX_HTTP_CONCURRENT_PER_WIDGET` | 4 | Requests in flight for one widget. |
| `MAX_HTTP_CONCURRENT_GLOBAL` | 64 | Requests in flight for all widgets. |
| `HTTP_TIMEOUT_MS` | 30000 ms | Total duration of one request. |

### Listing

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_LISTING_LOCALIZATIONS` | 16 | Localized texts of one listing. |
| `MAX_LISTING_NAME_BYTES` | 128 bytes | Marketplace name of one localization. |
| `MAX_LISTING_DESCRIPTION_BYTES` | 512 bytes | Marketplace description of one localization. |
| `MAX_AUTHOR_BYTES` | 128 bytes | Author shown in a listing. |
| `MAX_SPDX_LICENSE_BYTES` | 64 bytes | SPDX license expression of a listing. |
| `MAX_CATALOG_URL_BYTES` | 2 KiB | Source URL of a listing. |
| `MAX_PREVIEW_BYTES` | 256 KiB | PNG preview image of a listing. |

### View

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_VIEW_ELEMENTS` | 4096 | Elements written in `view.ocml`, components included. |
| `MAX_COMPONENTS` | 64 | Local components declared in one view. |
| `MAX_COMPONENT_PROPS` | 32 | Declared properties of one local component. |
| `MAX_VIEW_EXPRESSIONS` | 4096 | Compiled expressions of one view, handlers included. |
| `MAX_EXPRESSION_BYTES` | 1 KiB | Source length of one `{expr}` expression. |
| `MAX_EXPRESSION_DEPTH` | 32 | Nesting of operators, calls, members and literals in one expression. |
| `MAX_CALL_ARGUMENTS` | 8 | Arguments of one call, and entries of one object or array literal, in an expression. |
| `MAX_SCENE_NODES` | 4096 | Elements present in the view of a running widget, list items included. |
| `MAX_TREE_DEPTH` | 32 | Depth of the view's tree below its root, also the nesting limit of `if`, `for` and components. |
| `MAX_CHILDREN` | 1024 | Children of one element. |
| `MAX_NODE_TEXT_BYTES` | 16 KiB | Text content of one `text`, `span`, `badge` or `option` element. |
| `MAX_ATTRIBUTE_TEXT_BYTES` | 1 KiB | Any text attribute not bounded more tightly. |
| `MAX_LABEL_BYTES` | 256 bytes | `label`, `tooltip` and `placeholder` attributes. |
| `MAX_IDENTIFIER_BYTES` | 64 bytes | Class names, component names, field names, `@keyframes` names and similar identifiers. |
| `MAX_INITIALS_BYTES` | 16 bytes | `initials` fallback of an `avatar`. |
| `MAX_CLASSES_PER_NODE` | 16 | Classes on one element. |
| `MAX_FIELD_TEXT_BYTES` | 16 KiB | Content of one `field` or `textarea`, and of one `input` or `change` event. |
| `MAX_CHART_POINTS` | 1024 | Values in one chart series. |
| `MAX_CHART_SERIES` | 4 | `series` children of one `chart`. |
| `MAX_KEY_BYTES` | 32 bytes | `key` of one `keydown` event: one printable character or a named key. |

### Style

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_STYLE_RULES` | 1024 | Rules in one style sheet, `@keyframes` blocks excluded. |
| `MAX_SELECTORS_PER_RULE` | 8 | Comma-separated selectors of one rule. |
| `MAX_COMPOUNDS_PER_SELECTOR` | 4 | Compound selectors joined by combinators in one selector. |
| `MAX_SIMPLE_SELECTORS_PER_COMPOUND` | 6 | Type, class and state selectors in one compound selector. |
| `MAX_DECLARATIONS_PER_RULE` | 64 | Declarations in one rule or `@keyframes` stop. |
| `MAX_KEYFRAMES` | 32 | `@keyframes` blocks in one style sheet. |
| `MAX_KEYFRAME_STOPS` | 16 | Stops in one `@keyframes` block. |
| `MAX_SHADOWS` | 2 | Layers in one `box-shadow` value. |
| `MAX_SHADOW_BLUR_PX` | 64 px | Blur and spread radius of one shadow. |
| `MAX_GRADIENT_STOPS` | 8 | Colour stops in one `linear-gradient()`. |
| `MAX_GRID_TRACKS` | 24 | Tracks in one `grid-template-rows` or `grid-template-columns`. |
| `MAX_GRID_FRACTION` | 1000 absolute value | Largest `<fr>` factor of one grid track. |
| `MAX_TRANSITIONS` | 8 | Entries in one `transition` or `animation` list. |
| `MAX_ANIMATION_MS` | 300000 ms | Duration or delay of one transition or animation. |
| `MAX_ACTIVE_ANIMATIONS` | 64 | Transitions and animations running at once in one widget; extra ones jump to their end state. |
| `ANIMATION_RATE_HZ` | 60 Hz | Maximum repaint rate while an animation runs; nothing repaints when nothing changes. |
| `MAX_LENGTH_PX` | 16384 px | Absolute value of any length, offset or coordinate. |
| `MIN_FONT_SIZE_PX` | 6 px | Smallest `font-size` before content scale. |
| `MAX_FONT_SIZE_PX` | 96 px | Largest `font-size` before content scale. |
| `MAX_PERCENT` | 1000 absolute value | Absolute value of any `<percent>` in a style value. |
| `MAX_ANGLE_DEG` | 3600 absolute value | Absolute value of any `<angle>`, in degrees (ten turns). |
| `MAX_TRANSFORM_FUNCTIONS` | 4 | Functions in one `transform` value. |
| `MAX_TRANSFORM_SCALE` | 8 absolute value | Largest `scale()` factor; the smallest is 0. |
| `MAX_EASING_STEPS` | 60 | Steps of one `steps()` easing. |
| `MAX_ANIMATION_ITERATIONS` | 10000 | Finite iteration count of one animation; `infinite` stays allowed. |

### Drawing and images

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_CANVASES` | 8 | `canvas` elements in one widget. |
| `MAX_DRAW_COMMANDS` | 4096 | Commands in one call of `draw`, replacing the canvas content. |
| `MAX_PATH_POINTS` | 16384 | Vertices the host draws for one call of `draw`, all paths included, counted with a fixed ceiling per command: `moveTo` and `lineTo` 1, `quadTo` 8, `cubicTo` 16, `arc` and `circle` 64, `rect` 36, other commands 0. |
| `MAX_DRAW_STATE_DEPTH` | 16 | Nested `save` commands. |
| `MAX_IMAGE_EDGE_PX` | 2048 px | Width or height of one decoded image. |
| `MAX_IMAGE_ENCODED_BYTES` | 2 MiB | Encoded size of one PNG, JPEG or WebP image before decoding. |

### Logic

| Limit | Value | Meaning |
| --- | --- | --- |
| `VM_HEAP_BYTES` | 16 MiB | Heap ceiling of the VM when the manifest requests none. |
| `VM_MAX_HEAP_BYTES` | 48 MiB | Largest heap ceiling a manifest may request. |
| `VM_STACK_BYTES` | 256 KiB | Stack ceiling of the VM. |
| `VM_PROCESS_MEMORY_BYTES` | 64 MiB | Hard memory ceiling of one widget's process. |
| `VM_CPU_PERCENT` | 25 % of one core | CPU ceiling of one widget's process. |
| `VM_TURN_BUDGET_MS` | 50 ms | Wall time of one turn of the logic before the VM interrupts it. |
| `VM_JOBS_PER_TURN` | 1024 | Promise jobs run in one turn; a longer queue is a resource failure. |
| `VM_MESSAGES_PER_TURN` | 64 | Messages the widget may emit during one turn. |
| `MAX_VM_MESSAGES_PER_SECOND` | 120 per second | Sustained rate of messages from the widget to the host. |
| `MAX_VM_MESSAGE_BURST` | 240 | Burst of messages allowed above that rate. |
| `MAX_PATCH_BYTES` | 256 KiB | Size of what the widget sends at once: one change of the view or one call of `draw`. |
| `MAX_PATCH_OPS` | 4096 | Operations in one change of the view (elements created, removed, moved or changed) after a turn. |
| `MAX_TIMERS` | 16 | Active timers of one widget. |
| `MIN_TIMER_INTERVAL_MS` | 100 ms | Shortest timer period; animation belongs to style, not to timers. |
| `CLOCK_RESOLUTION_MS` | 1 ms | Granularity of `Date.now()` inside the VM. |
| `MAX_LOG_BYTES` | 4 KiB | Text of one `log` call. |

### Services

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_SERVICE_CALLS_IN_FLIGHT` | 16 | Unanswered service calls of one widget, subscriptions excluded. |
| `MAX_SUBSCRIPTIONS` | 16 | Open service subscriptions of one widget. |
| `STORAGE_QUOTA_BYTES` | 256 KiB | Keys and values stored by one widget. |
| `MAX_STORAGE_KEYS` | 512 | Keys stored by one widget. |
| `MAX_STORAGE_KEY_BYTES` | 128 bytes | Length of one storage key. |
| `MAX_STORAGE_VALUE_BYTES` | 64 KiB | Serialized JSON size of one storage value. |
| `MAX_CLIPBOARD_BYTES` | 16 KiB | Text of one clipboard write. |
| `MAX_OBJECT_ID_BYTES` | 128 bytes | Opaque object ID or cursor exchanged with a capability service. |

### Notes, reviews and chat

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_NOTES` | 8 | Notes in the user's notes document; `notes.create` fails beyond it. |
| `MAX_NOTE_TITLE_BYTES` | 96 bytes | Note title, non-empty after trimming. |
| `MAX_NOTE_BODY_BYTES` | 8 KiB | Note body. |
| `MAX_NOTE_ITEMS` | 64 | Checklist items of one note. |
| `MAX_NOTE_ITEM_BYTES` | 256 bytes | One checklist item. |
| `MAX_REVIEW_CHARS` | 2000 characters | PlayerVox review text. |
| `MAX_CHAT_MESSAGE_CHARS` | 500 characters | Twitch chat message, the Twitch limit; not empty or whitespace-only, no control characters. |
| `MAX_CHAT_FRAGMENTS` | 16 | Text and emote runs of one delivered chat message; the host merges the rest into text. |
| `MAX_CHAT_FAVORITES` | 20 | Favourite Twitch channels kept by the host. |
| `MAX_CHAT_CHANNEL_BYTES` | 25 bytes | Twitch channel login after normalization: ASCII letters, digits and `_`, lowercased. |

### Reference images

| Limit | Value | Meaning |
| --- | --- | --- |
| `PARITY_CHANNEL_TOLERANCE` | 2 levels of 255 | Largest per-channel difference for a pixel to count as equal to the reference image's. |
| `PARITY_MAX_DIFFERENT_PIXELS` | 100 ppm | Share of pixels allowed beyond the channel tolerance. One wrong 10 px letter in a 360 × 260 widget is 385 ppm. |
<!-- /generated:limits -->
