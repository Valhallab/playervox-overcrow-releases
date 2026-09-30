# Security

OverCrow treats every widget as untrusted code, built-ins included: the same
package checks, the same sandbox, the same permissions and the same consent
apply to a PlayerVox widget and to yours. This page describes what that
means for a widget author. Numeric bounds are listed in the
[schema reference](../../widget-schema-v1.md#limits).

## The sandbox

Each widget runs behind two barriers.

1. **The VM.** Your `logic.js` runs in its own QuickJS virtual machine with
   a heap ceiling, a time budget per turn, a bounded stack and bounded
   queues. There is no `eval`, no `Function` constructor, no module loader,
   no `WebAssembly` and no shared memory; the only global besides
   ECMAScript is the frozen SDK. Local time is UTC: the SDK applies the
   user's offset for you.
2. **The process.** Each VM runs in its own operating-system process that
   needs no display, GPU, network or files, so its sandbox takes all of them
   away. On Linux, Bubblewrap namespaces, a seccomp allowlist that kills the
   process on any attempt to open a file, a socket or another process, and
   a cgroup per widget. On Windows, a Less Privileged AppContainer without
   capabilities, a Job Object per widget, and process mitigations that
   forbid dynamic code and the window system.

OverCrow draws everything itself: the VM sends a description of the view,
never pixels, and never runs code in OverCrow's process. Hover, focus,
pressed states and transitions are resolved by OverCrow, so a widget does
not observe pointer motion it has not asked for through an event.

Going over a budget ends only that widget. OverCrow shows a fixed error in
its frame and restarts it after 1, 5 and 15 seconds, at most three times;
a package or protocol error waits for the user to enable it again.

## Permissions and consent

A widget gets nothing it has not declared in `manifest.json`, and a
declaration grants nothing by itself: OverCrow asks the user, who may
refuse or revoke a permission at any time. Revoking stops the widget first.
Check `hasGrant(capability)` in your logic and show a useful state when a
capability is missing.

Permissions:

<!-- generated:permissions -->
| Permission | Services | On a gesture |
| --- | --- | --- |
| `network` | `http.fetch` | — |
| `storage` | `storage.get`, `storage.set`, `storage.remove`, `storage.keys` | — |
| `clipboardWrite` | — | `clipboard.writeText` |
| `gameEvents` | `gameEvents.subscribe` | — |
<!-- /generated:permissions -->

- **`network`** lists exact routes: one HTTPS origin, one method and one
  complete path per rule, with typed path and query parameters. The request
  leaves through OverCrow's broker, which refuses anything else, follows no
  redirect, sends no cookie or credential, refuses local and private
  addresses, and bounds the size and duration of each exchange. A response
  is at most 1 MiB, unless the rule declares a larger `maxResponseBytes`
  (up to 3 MiB): the bound shows in the review and in the permission
  panel. Requests in flight share a byte budget per widget and for all
  widgets, so a larger bound never raises OverCrow's worst case.
- **`storage`** is a key-value store kept by OverCrow for your widget only,
  within a quota. There is no file access.
- **`clipboardWrite`** writes text, only while the user interacts with the
  widget.
- **`gameEvents`** delivers the named game events you declare.

Capabilities give access to data and actions of OverCrow and of the user's
accounts. A **sensitive** capability reveals personal data or the game
being played: a widget that declares one cannot also declare `network` or
`clipboardWrite`, and its storage lasts only as long as its process, so the
data cannot leave the machine through the widget.

<!-- generated:capabilities -->
| Capability | Sensitive | Services | On a gesture |
| --- | --- | --- | --- |
| `telemetry.read` | no | `telemetry.subscribe` | — |
| `fps.read` | no | `fps.subscribe` | — |
| `media.read` | **yes** | `media.subscribe` | — |
| `media.control` | **yes** | — | `media.previous`, `media.playPause`, `media.next` |
| `session.read` | no | `session.subscribe` | — |
| `stopwatch.read` | no | `stopwatch.subscribe` | — |
| `stopwatch.control` | no | — | `stopwatch.toggle`, `stopwatch.reset` |
| `notes.read` | **yes** | `notes.subscribe` | — |
| `notes.write` | **yes** | — | `notes.create`, `notes.select`, `notes.setItem`, `notes.delete` |
| `playervox.score.read` | **yes** | `playervox.score.subscribe` | — |
| `playervox.rating.read` | **yes** | `playervox.rating.subscribe` | — |
| `playervox.rating.write` | **yes** | none (host-bound intent) | — |
| `playervox.reviews.read` | **yes** | `playervox.reviews.page` | — |
| `journal.read` | **yes** | `journal.subscribe`, `journal.page` | — |
| `journal.delete` | **yes** | — | `journal.delete` |
| `twitch.chat.read` | **yes** | `twitch.chat.subscribe` | `twitch.chat.join`, `twitch.chat.leave`, `twitch.chat.favorite` |
| `twitch.chat.compose` | **yes** | none (host-bound intent) | — |
<!-- /generated:capabilities -->

Account connections (PlayerVox, Twitch) belong to OverCrow: sign-in, codes
and tokens are drawn and kept by OverCrow, and a widget receives only the
data its capability describes.

Declare the least you need: reviewers read every permission and route, and
users see them before they consent. Widgets tagged `built-in` in the signed
catalog (PlayerVox widgets only) start with their declared permissions
granted; an update that asks for more needs the user's consent, built-ins
included.

## Gestures

Actions that change something for the user need a real user gesture: the
service must be called while one of these events is handled:

<!-- generated:gesture-events -->
`activate`, `contextmenu`, `keydown`, `input`, `change`, `submit`.
<!-- /generated:gesture-events -->

A call from a timer, a service answer or a widget menu row is refused with
`gesture_required`. Widgets receive input only in OverCrow's interactive
mode; in passive mode they are click-through. Deleting a note or a journal
session also asks the user to confirm in a dialog drawn by OverCrow.

Text the user writes to notes, ratings and chat never passes through your
logic: a `form` with an `intent` sends the text of its own controls, which
OverCrow edits and submits itself.

## What a widget cannot do

- Read or write files, open sockets, reach the local network or any address
  its manifest does not declare.
- Start processes, load native code, compile code at runtime or fetch code:
  the only code is the reviewed `logic.js` of the package.
- See other widgets, their state, storage or permissions, or the game's
  memory, window or input. OverCrow never injects into the game.
- Draw outside its frame, cover or imitate OverCrow's frame, menus,
  permission panel or confirmations.
- Read account tokens, cookies or credentials.
- Write to logs in production: `log.*` output appears only in a local
  development session.
- Grant itself a permission, or use a menu row as a gesture.

Every package is checked when it is admitted to the catalog and again each
time OverCrow starts it: the signed catalog, the file ledger and the
compiled view must match, or the widget does not start. See
[publishing and review](publishing.md).

## Reporting a vulnerability

Report vulnerabilities privately, as described in the repository's
[security policy](../../../SECURITY.md).
