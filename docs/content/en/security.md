# Security

PlayerVox OverCrow treats every widget as untrusted code, built-ins
included: the same package checks, the same sandbox, the same permissions
and the same consent apply to a PlayerVox widget and to yours. This page
describes what that means for a widget author.

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
a package or protocol error waits for the user to enable it again. The
numbers are in [limits](limits.md#logic).

## Permissions and consent

A widget gets nothing it has not declared in `manifest.json`, and a
declaration grants nothing by itself. When the widget is installed, the
Control Center proposes each permission checked, and the user may uncheck
any. Later, the user allows or takes back each permission in the Control
Center; taking one back restarts the widget without it.
OverCrow checks the permission again at every call of a service.

Four permissions open general services: `network` (exact HTTPS routes,
through OverCrow's broker), `storage` (a key-value store for this widget
only), `clipboardWrite` (writing text, during a user action) and
`gameEvents` (named game events).

Capabilities give access to data and actions of OverCrow and of the user's
accounts. A **sensitive** capability reveals personal data or the game
being played: a widget that declares one cannot also declare `network` or
`clipboardWrite`, and its storage lasts only as long as its process, so the
data cannot leave the machine through the widget.

Account connections (PlayerVox, Twitch) belong to OverCrow: sign-in, codes
and tokens are drawn and kept by OverCrow, and a widget receives only the
data its capability describes.

Each permission, each capability and the services it opens are described
in [services and permissions](services.md). Declare the least you need:
reviewers read every permission and route, and users see them before they
consent. Widgets tagged `built-in` in the signed catalog (PlayerVox widgets
only) start with their declared permissions granted; an update that asks
for more needs the user's consent, built-ins included.

## User actions

Services that change something for the user can be called only while the
logic handles a real action of the user in the widget: a click, a key, an
edit, a submitted form. A call from a timer, from a service answer or from
a row of the options menu is refused with `gesture_required`. Widgets
receive input only in OverCrow's Interactive mode; in Passive mode they are
click-through. Deleting a note or a journal session also asks the user to
confirm in a dialog drawn by OverCrow. See
[calls that need a user action](services.md#calls-that-need-a-user-action).

What the user writes to notes, ratings and chat never passes through your
logic: a `form` with an `intent` sends the values of its own text fields and
sliders, which OverCrow fills, edits and submits itself. Your logic can read
them, not set them. See
[forms that write user data](forms.md#forms-that-write-user-data).

## What a widget cannot do

- Read or write files, open sockets, reach the local network or any address
  its manifest does not declare.
- Start processes, load native code, compile code at runtime or fetch code:
  the only code is the reviewed `logic.js` of the package.
- See other widgets, their state, storage or permissions, or the game's
  memory, window or input. OverCrow never injects into the game.
- Draw outside its frame, cover or imitate OverCrow's frame, menus or
  confirmations.
- Read account tokens, cookies or credentials.
- Read the clipboard.
- Write to logs in production: `log.*` output appears only in a local
  development session.
- Grant itself a permission, or use a menu row as a user action.

## What OverCrow verifies

Every package is checked when it is admitted to the catalog and again each
time OverCrow starts it: the signed catalog, the ledger of its files and
the compiled view must match, or the widget does not start. See
[the package](package.md#how-overcrow-checks-a-package) and
[publishing and review](publishing.md).

A version of the catalog can be suspended or revoked after its
publication: OverCrow then stops the installed copy. See
[version statuses](publishing.md#version-statuses).

## Reporting a vulnerability

Report vulnerabilities privately, as described in the repository's
[security policy](../../../SECURITY.md).
