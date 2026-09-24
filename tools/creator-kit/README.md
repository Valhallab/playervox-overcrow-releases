# OverCrow Creator Kit 1.0.0

Public, dependency-free authoring tools for **Node.js 22+**, Windows and Linux.
SDK **1.2.0**, Web API v1 and v2. The code is MIT-licensed. No application source, Rust
compiler, Python, D-Bus or package installation is required by the downloaded kit.

```sh
node overcrow.mjs init my-widget --template counter
cd my-widget
npm run dev
npm run check
npm run package
```

Counter and Checklist support English (default) and French through the SDK locale API. Edit strings in `widget/locales/en.mjs` and `widget/locales/fr.mjs`; `i18n.mjs` applies them to HTML translation keys. The HTML language defaults to `en` and follows runtime locale changes. Use `--template checklist` for persistent state and `--id com.example.widget`
for your own identity. Existing folders are never overwritten. A generated project
ships local tooling and needs no `npm install`. PowerShell users whose policy
blocks npm.ps1 can use `npm.cmd run dev` or `node tooling/overcrow.mjs dev`.

Use `--template blank` for an empty view: only `index.html`, `styles.css`,
`view.js` and `manifest.json`, plus the SDK and its license. No controller,
permissions or sample UI are needed. It follows SDK locale and mode changes;
add translation files when you add text.

Edit `widget/` only for runtime resources. `npm run dev` prints a loopback-only,
random-path preview URL, reloads valid changes and retains the last good generation
on invalid/partial edits. A permission change requires an explicit restart.
The preview includes OverCrow's host wrapper: hover the widget to reveal its
floating toolbar, then open the options menu. Content scale (50–175%, initially
100%) reflows the widget inside its native sizing mode; background opacity (0–100%,
initially 100% for the starter templates) affects the host background and border only. Use the sliders
or type a percentage and press Enter or leave the field. Backgrounds painted by
the widget itself remain unchanged. The eye chooses whether the widget stays visible in passive mode. The Mode selector switches the whole overlay and sends the corresponding SDK snapshot and visibility events; only close is illustrative.
Move the widget
from its 22-pixel top strip. API v1 keeps its manual frame and bottom-right resize handle. API v2 supports intrinsic size without a handle, autoHeight with a horizontal-only handle, and manual dimensions. Content-size reports use unscaled CSS layout pixels; the wrapper applies scale once. The upper-left corner stays fixed while resizing, within the canvas bounds. Wrapper controls are hidden in passive mode; use the Mode selector to return to interactive mode. Focus
either control and use arrow keys
(Shift for 10-pixel steps). Appearance and frame size survive widget reloads until the preview page itself is refreshed. This wrapper belongs to the
host: do not implement it in widget/; it is never included in an exported package.
`overcrow.storage` uses shared, bounded runtime memory and reports `temporary`,
regardless of the persistence permission. Its data resets on preview reload or
a simulated game session change and is never packaged. Native mode uses the
actual OverCrow IndexedDB partition and effective persistence policy.
The simulator restarts both documents on reload; legacy persistent browser storage is
namespaced by widget ID but remains separate from OverCrow's native storage.
The preview refresh and drag icons are from Lucide; its license is included in
`preview/lucide-LICENSE.txt` (or `tooling/preview/` inside a project).
Its Storage facade supports getItem/setItem/removeItem/clear/key/length; property
syntax such as localStorage.foo is not simulated. Clipboard gestures are refused
and must be tested in OverCrow. The simulator is not a security or graphics test.

`preview.json` is outside widget/ and never exported. Optional fixtures:

```json
{
  "snapshot": {"running": true, "selectedActive": true, "sessionElapsedMs": 300000},
  "responses": [
    {"url": "https://api.example.com/v2/items", "method": "GET", "status": 200,
     "json": {"data": [{"name": "Example"}]}}
  ]
}
```

Add the corresponding manifest permission. Fixture matching is exact URL/method;
request bodies are not matched. No external API is called or proxied. Missing
fixtures produce `fixture_missing`. Use `text` instead of `json` for plain text.
The preview supplies native snapshot, locale, visibility and controller/view relay
contracts, but does not generate arbitrary named game events or simulate all host
failure modes. Browser devtools remain available for inspecting your widget.

## SDK service references

Use `--template session`, `clock`, `performance`, `fps`, `stopwatch`, `media`,
`notes`, `score`, `rating`, `reviews`, `journal`, or `twitch` for an API v2
reference. Each uses the public SDK only, declares its exact capabilities,
includes EN/FR labels and native options, respects passive mode, and reports
unscaled preferred content dimensions. Blank, Counter and Checklist retain API v1.

```sh
node overcrow.mjs init my-notes --template notes
```

The browser preview labels fictional data and never contacts device services,
private PlayerVox endpoints, or Twitch. Stopwatch/media/checklist controls only
change in-memory fixtures. Native connection, editor, delete and composer intents
return `cancelled`; actual native UI and permissions need OverCrow testing. FPS
defaults to `unsupported`. Inactive sessions hide service data. Context changes
and page disposal invalidate old replies. This is a contract simulator, not proof
of native coverage or security. Native support may still be unavailable.

Add optional service fixtures outside `widget/` in `preview.json`:

```json
{
  "services": {
    "capabilities": {"fps.read": {"supported": true, "granted": true}},
    "snapshots": {
      "fps": {"status": "stale", "sampleAgeMs": 3000,
        "data": {"value": 60, "sampleAgeMs": 3000, "stale": true}}
    }
  }
}
```

Fixtures cannot grant a capability absent from the manifest. Set `granted:false`
or a service's `permissionDenied`, `notConnected`, `unavailable`, `unsupported`
or `rateLimited` status with `data:null` to exercise fallback UI. The simulator
owns context IDs and monotonic revisions. Never put real credentials or private
content in fixtures. Native sensitive grants cannot be combined with outbound
network or raw clipboard access; the authoring checks reject that combination.

Twitch `requestCompose({replyTo?})` opens only the native composer. A widget
cannot supply message text. Notes, rating and journal intent results distinguish
queued acceptance from persistence; see the EN/FR API services guide and shipped
TypeScript declarations for DTOs, units, revisions and action signatures.

Use `npm run dev -- --native` to run the same project in OverCrow's installed
engine in an offscreen development session. Use `npm run dev` for a visual preview;
native mode does not place the development widget in the overlay. Valid edits reload after a short debounce; invalid or partial
edits leave the last accepted generation running. Expanding permissions or changing
the storage permission (which determines the retained browser context) is refused
until you review them and restart the command. `--devtools` opens native developer
tools, and `--replay ./events.json` replays a bounded schemaVersion 1
event fixture after registration and each accepted reload. The controller stays
alive during view reloads, so restart native mode after changing controller code.

On Windows, native mode launches
`%LOCALAPPDATA%\Programs\OverCrow\OverCrow.exe --widget-development`. On Linux it
resolves `overcrow-widget` from `PATH` and invokes its `dev --watch` command against
a private prepared copy. Portable installations can use
`--host /absolute/path/to/executable`; the path must be absolute. The prepared copy
and generated hash ledger never modify `widget/`. Ctrl+C, SIGTERM, or standard-input
EOF stops the session and cleans up its child process. `doctor --json` only reports
whether the expected native executable is available; it never launches it.

`npm run package` computes manifest hashes and writes a deterministic stored ZIP
`.ocpkg` to `.overcrow-output/`. A digest suffix preserves previous exports. Import
it in the Control Center to test the actual runtime on Windows or Linux. For a
replacement installation, increment version in `widget/manifest.json`; source
package.json is tooling metadata, not the widget version. Nothing is installed,
signed or published automatically. The browser preview remains the default; native
mode requires an existing OverCrow installation.

`check --json` and `package --json` return schemaVersion 1 plus `ok`, diagnostics
and exit status. `doctor --json` reports Node, OS and the available test route.
Authoring checks reject malformed/duplicate JSON keys, unknown manifest fields,
unsafe/nonportable paths, symlinks/junctions, hardlinks, native executables, case
collisions and excessive inputs. The native installer and marketplace validator
remain authoritative. The kit accepts a portable subset of paths to avoid Windows
reserved names; it is not a replacement implementation of the host security model.
Keep API keys and personal fixtures out of widget/.

## Maintainer validation

From the public releases repository root:

```sh
node --test tests/creator-kit/*.test.mjs
python3 scripts/package-docs-examples.py published/docs/downloads
```

The documentation build creates `published/docs/downloads/creator-kit.zip` from
these tools, the documented examples and the SDK downloads. The Windows/Linux CI
matrix exercises the same Node tests. Native package compatibility can additionally
be checked on Linux by extracting an exported archive and running
`overcrow-widget package` against it: output bytes must match exactly. This is
an offline validation, not an application install or native overlay session.

Native sensitive grants force ephemeral browser storage even with `storage` declared.
Runtime/session/account changes discard browser data; native notes and option
preferences remain native. The browser simulator keeps only fictional fixture data
and does not reproduce OS credential stores or the native browser sandbox.
