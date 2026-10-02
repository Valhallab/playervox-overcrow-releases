# The development channel

`overcrow-widget dev` shows your widget in the PlayerVox OverCrow overlay
running on your machine, over your game, and reloads it each time you save
a file. It reaches the overlay through the **development channel**, which
OverCrow opens only when you ask for it.

```sh
overcrow-widget doctor
overcrow-widget dev
```

`doctor` says whether a running overlay offers the channel; `dev` then
builds the widget, sends it and stays in the foreground until Ctrl+C.

## Turn it on

The channel exists only while OverCrow runs with development installs
allowed: started with the environment variable
`OVERCROW_WIDGET_DEVELOPMENT=1`. Without it, the overlay opens nothing.

**Linux.** Set the variable for your session's services, then restart the
overlay:

```sh
systemctl --user set-environment OVERCROW_WIDGET_DEVELOPMENT=1
systemctl --user restart overcrow-overlay.service
```

To turn it off, unset the variable and restart again (or log out):

```sh
systemctl --user unset-environment OVERCROW_WIDGET_DEVELOPMENT
systemctl --user restart overcrow-overlay.service
```

**Windows.** Quit OverCrow from its tray icon, then start it from
PowerShell:

```text
$env:OVERCROW_WIDGET_DEVELOPMENT='1'; & "$env:LOCALAPPDATA\Programs\OverCrow\OverCrow.exe"
```

`overcrow-widget doctor` prints these commands when it finds an overlay
without the channel (`doctor.development_off`).

## What a development widget is

The overlay treats what `dev` sends as a **development package**:

- it is validated in full, exactly as an installed package is, and runs in
  the same sandbox: nothing sent over the channel skips a check;
- it is marked **Unverified · development package** in both modes, so it
  cannot be mistaken for a widget of the catalog;
- the permissions its manifest declares are granted for the session only;
- nothing of it is stored: its storage lasts as long as the session, and it
  never reads or writes the data of an installed widget;
- it takes the place of an installed widget of the same ID for the
  session, and the installed widget comes back when it is removed;
- IDs under `com.playervox.` are refused.

When `dev` ends, for any reason, the overlay removes the widget.

## What `dev` prints

For each save, `dev` rebuilds the package and prints the same diagnostics
as `check`. A build with errors is not sent: the widget keeps running its
last good build. Then come the overlay's reports.

**States** of the widget:

| State | Meaning |
| --- | --- |
| `starting` | The overlay is starting the widget's process. |
| `running` | The widget runs. |
| `restarting` | It failed and is being restarted; the failure is shown. |
| `failed` | It failed too often: it waits for your next save. |
| `refused` | The overlay refused to start it. |
| `stopped` | It was stopped. |

**Failures** that come with `restarting` and `failed`:

<!-- generated:failure-categories -->
| Category | Restarted | Meaning |
| --- | --- | --- |
| `invalid_bundle` | no | Package, ledger or compiled content rejected. |
| `permission_denied` | no | What the widget declares, what the user granted and what is requested disagree. |
| `protocol_violation` | no | What the widget sent to the host is malformed, unknown or out of order. |
| `resource_limit` | yes | A memory, CPU, queue, rate or size ceiling was exceeded. |
| `unresponsive` | yes | The widget did not start or answer in time, or exceeded the time budget of a turn. |
| `vm_exited` | yes | The widget's process ended without reporting a fault (killed by the sandbox, out of memory). |
<!-- /generated:failure-categories -->

**Logs**: each `log.debug`, `log.info`, `log.warn` and `log.error` of the
logic, with its level. A log line is cut at 512 characters, and control
characters, terminal escape sequences and bidirectional controls are shown
escaped (`\u{1b}`), never interpreted: a widget's text cannot take over
your terminal.

With `--format json`, each of these is one JSON object per line: the
diagnostics, `{"type":"built",…}` for each build, then the overlay's
messages (`state`, `log`, `event`…) as they come.

## When it does not connect

| What you see | Cause |
| --- | --- |
| `doctor.development_off` | No running overlay allows development installs: [turn it on](#turn-it-on). |
| `doctor.overcrow_missing` | OverCrow is not installed. |
| `doctor.channel_busy`, `too_many_sessions` | Four `dev` sessions are already connected to this overlay. |
| `doctor.protocol_version`, `unsupported_protocol` | The overlay and the tool do not speak the same version of the channel: update the older one. |
| `doctor.channel_untrusted` | What answers on the channel's address is not your own overlay. |
| `busy` | Another install or removal is in progress: `dev` tries again. |
| `conflict` | Another `dev` session installed a widget with this ID. |
| `invalid_bundle` | The overlay's validation refused the package; a reserved `com.playervox.*` ID is one cause. |
| `development_disabled` | The overlay no longer allows development installs. |
| `unavailable` | The overlay could not start its widget runtime, or did not answer within 30 seconds. |
| `rate_limited` | More than 10 requests per second: saves are arriving faster than the overlay accepts them. |

## Who can use the channel

Only programs running as **your own user** on the same machine: the channel
is a local socket (Linux) or a named pipe (Windows) that other users, other
machines and sandboxed programs cannot open, and each end checks the other
before a session starts. Widgets cannot use it: their sandbox has no access
to it.

This is why the channel is off by default. With it on, any program you run
can show an unverified widget in your overlay, for as long as OverCrow
runs. Turn it off when you are done.
