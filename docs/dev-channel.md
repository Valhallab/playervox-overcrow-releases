# The development channel, version 1

`overcrow-widget dev` installs a widget in a running OverCrow overlay, reloads
it when its sources change, and shows its states and logs. It talks to the
overlay through the **development channel** described here. The
implementation both ends share is the MIT crate
[`crates/overcrow-widget-devchannel`](../crates/overcrow-widget-devchannel)
(messages, bounds, framing), and its test vectors,
[`vectors/v1.json`](../crates/overcrow-widget-devchannel/vectors/v1.json), are
the reference for any other client.

The channel installs **development packages**: the overlay validates every
package in full, exactly as it validates a sideloaded one, runs it in the same
sandbox, grants it only the permissions its manifest declares and only for
the session, never persists anything of it, and marks it
"Unverified · development package" in both modes. Nothing sent over the
channel skips a check.

## Availability

The channel exists only while an overlay runs **with development installs
allowed**: OverCrow started with the environment variable
`OVERCROW_WIDGET_DEVELOPMENT=1`. Without it, the overlay opens no socket or
pipe at all. `overcrow-widget doctor` says whether the channel is there and
how to restart OverCrow with it.

- **Linux**: `systemctl --user set-environment OVERCROW_WIDGET_DEVELOPMENT=1`,
  then `systemctl --user restart overcrow-overlay.service`. Undo it with
  `systemctl --user unset-environment OVERCROW_WIDGET_DEVELOPMENT` and the
  same restart (or log out).
- **Windows**: quit OverCrow (tray icon, Quit), then start it from
  PowerShell: `$env:OVERCROW_WIDGET_DEVELOPMENT='1'; & "$env:LOCALAPPDATA\Programs\OverCrow\OverCrow.exe"`.

One overlay holds the channel at a time.

## Transport and identity

Only processes of the **same user** reach the channel, and each end checks
the other.

| | Linux | Windows |
| --- | --- | --- |
| Address | `$XDG_RUNTIME_DIR/overcrow-widget-development.sock` | `\\.\pipe\overcrow-widget-development-<SID>`, the user's SID string (`S-1-5-21-…`) |
| Overlay side | The runtime directory must be the user's, not a link, mode `0700`; the socket is `0600`. A stale socket of an overlay that ended is replaced; a live one means another overlay has the channel. | The first pipe instance is created exclusively (`FILE_FLAG_FIRST_PIPE_INSTANCE`), so an existing name (another overlay, or anyone squatting it) means no channel. Its DACL grants read and write to the user's SID only, which excludes AppContainers; remote clients are refused; the default mandatory label (medium, no write-up) applies. |
| Client checked by the overlay | `SO_PEERCRED`: the peer's user ID is the overlay's. | The client's token (by impersonation): the same user SID, integrity medium or above, not an AppContainer, not restricted. |
| Overlay checked by the client | The socket is a socket (not a link) owned by the user, and `SO_PEERCRED` of the connection is the user. | `GetNamedPipeServerProcessId`: the server process's token is the user's SID. The client opens the pipe at the identification level: the overlay can check the client, not act as it. |

A refused client is disconnected without an answer. By design, any process
of the same user may use the channel: the user chose to allow development
installs, and such a process could already act as the user. Widgets cannot:
their sandbox has no runtime directory on Linux, and no access to the pipe
on Windows.

## Framing

Every message is one frame: a **big-endian `u32` length**, then that many
bytes of **one UTF-8 JSON object**, which starts at its first byte with `{`.
Its `type` member names the message. Only an `install` frame carries more:
exactly `packageBytes` raw bytes of the `.ocpkg` archive follow the object.

- Every object has exactly the members listed below: an unknown `type`, an
  unknown or duplicate member, a missing member, a wrong JSON type or a value
  out of bounds is refused. Member names are camelCase.
- A client frame is 1 to 16 384 bytes (`MAX_CLIENT_HEADER_BYTES`), an overlay
  message 1 to 65 536 bytes (`MAX_SERVER_FRAME_BYTES`), before the package.
- A package is 1 to 16 777 216 bytes, the schema's `MAX_PACKAGE_BYTES`; its
  `sha256` is 64 lowercase hexadecimal digits.
- IDs follow the widget ID grammar of the [schema](widget-schema-v1.md).
  Codes are `[a-z0-9_]`, at most 64 bytes. Names (`client`, `overlay`) are
  printable ASCII, at most 64 bytes.
- Request numbers (`request`) are non-zero; the client chooses them and the
  overlay echoes them in its answer.

A malformed frame ends the session: the overlay answers `refused` with
`protocol_error` and closes the connection. A package whose bytes do not
match its `sha256` is answered `result` with `digest_mismatch`, and the
session goes on.

## Session

1. The client connects and sends `hello` within 2 s.
2. The overlay answers `welcome`, or `refused` then closes.
3. The client sends requests; the overlay answers each one, and sends the
   events, states and logs of the widgets this session installed.
4. Either end may close. When the client's connection ends, for any reason
   (Ctrl+C, a crash), the overlay removes every widget this session
   installed, including an install still in progress.

### Client messages

| `type` | Members | Meaning |
| --- | --- | --- |
| `hello` | `protocol` (number), `client` (name) | First and only once. Its shape is the same in every version, so an overlay can always refuse an unknown `protocol`. |
| `install` | `request`, `packageBytes`, `sha256`, then the bytes | Installs the package, or reloads it: a new install of the same ID replaces the session's copy. |
| `remove` | `request`, `id` | Removes a widget this session installed. |
| `status` | `request` | The development widgets and their states. |

Nothing in the protocol names a file or a path: the overlay never opens a
file the client chooses.

### Overlay messages

| `type` | Members | Meaning |
| --- | --- | --- |
| `welcome` | `protocol`, `overlay` (name), `platform` (`linux`, `windows`), `limits` | The session is open. `limits` states `maxHeaderBytes`, `maxPackageBytes`, `maxSessions`, `requestsPerSecond`, `requestBurst`. |
| `refused` | `code`, `supported`? | The overlay closes the connection after it. With `unsupported_protocol`, `supported` lists its versions. |
| `result` | `request`, `ok`, `id`?, `sha256`?, `code`? | The answer to `install` (with the widget's `id` and the `sha256` of the accepted package) or `remove` (with `id`); `code` when `ok` is false. |
| `status` | `request`, `widgets` | Up to 64 `{id, state, failure?}`. |
| `event` | `kind` (`installed`, `failed`, `removed`), `id`?, `code`? | `installed` and `removed` name the widget; `failed` has a `code` and no ID. |
| `state` | `id`, `state`, `failure`? | A widget's state changed: `starting`, `running`, `restarting`, `failed` (waits for a reload), `refused`, `stopped`; `failure` is the overlay's category (`resource_limit`, `unresponsive`…). |
| `log` | `id`, `generation`, `level` (`debug`, `info`, `warn`, `error`), `text` | A `log` of the widget's logic ([SDK](sdk-reference.md)), at most 4 096 bytes of text. |
| `dropped` | `count` | Events, states or logs dropped because the client read too slowly. |

`?` marks a member present only when it applies; it is then never `null`.

**Texts from the widget are untrusted.** `log.text`, and every ID or code
the overlay relays, may carry terminal escape sequences, bidirectional
controls or anything else a widget chose. A client must neutralize them
before display, as `overcrow-widget` does: C0 controls but tab (escape,
carriage return and newline included), DEL, C1 controls, and U+061C,
U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069 are shown escaped, and
each line is cut at 512 characters.

### Refusal and failure codes

`refused`: `unsupported_protocol`, `too_many_sessions`, `rate_limited`,
`protocol_error`, `timeout`.

`result` failures of the channel:

| Code | Meaning |
| --- | --- |
| `busy` | Another install or remove is in progress (in any session): send again after a moment. |
| `conflict` | Another session installed this widget ID. |
| `not_installed` | This session has no development widget with this ID. |
| `digest_mismatch` | The bytes do not match `sha256`. |
| `development_disabled` | The overlay no longer allows development installs. |
| `unavailable` | The overlay could not start its widget runtime, or did not answer within 30 s. |

Other codes are the overlay's validation categories, for example
`invalid_bundle` (the package fails validation, a reserved `com.playervox.*`
ID included) or `needs_consent`. Clients should show unknown codes as they
are.

## Bounds

| Bound | Value |
| --- | --- |
| Sessions at once | 4; the next connection gets `refused` `too_many_sessions` |
| Requests of a session | 10 per second, bursts of 20; above, `refused` `rate_limited` |
| Operations in progress | one install or remove for the whole overlay; others get `busy` |
| `hello` | within 2 s of the connection |
| A frame that started | complete within 10 s (an idle session has no deadline) |
| An overlay message | written within 5 s, or the session is closed |
| Messages waiting for a client | 512, 2 MiB; beyond, events, states and logs are dropped and counted (`dropped`); an answer that no longer fits closes the session |

## Versions

The protocol version is `1`. Any change to a message, a member or a
bound's meaning is a new version; an overlay refuses versions it does not
speak with `unsupported_protocol` and the list it supports, and
`overcrow-widget doctor` reports the mismatch. Event replay and service
fixtures (the simulator of the next release of the CLI) will be new
requests of a later version.

## Test vectors

[`vectors/v1.json`](../crates/overcrow-widget-devchannel/vectors/v1.json)
holds client frames and overlay messages with the outcome a conforming end
must reach: `ok`, `malformed`, `frameSize`, `digest`, `eof`, `closed` or
`invalid:<member>`. The crate's `tests/vectors.rs` reads each one and writes
back the same bytes.
