# Public SDK documentation content

English and French SDK articles live in `en.json` and `fr.json`; `routes.mjs`
builds their shared route structure. The separate web application imports this
content from a pinned public revision and provides navigation, search and rendering.

Edit articles here. Keep both languages aligned and retain MIT notices. SDK
sources live in `content/sdk/` and source templates in `content/templates/`.
Run the website integration checks after updating its vendor snapshot; this
repository's creator tests verify the tools and portable exports without React.

Document the current Web API v1 contract. Every manifest requires
`"apiVersion": "1"`. Keep article routes and heading anchors short and descriptive.
Use canonical `/docs/downloads/<filename>` links for SDK files and archives.

Lead guides with a working result. Start each SDK reference with a complete table
of methods, signatures and purpose, then permissions, a small usable example and
practical limits. The host-services overview is an index: list every service and
its permissions, link to the detailed references, and explain shared snapshot
behavior without duplicating their method lists or code examples. Services can
be added in later OverCrow updates; the manifest still uses API v1.

Explain one-time `snapshot()` reads, continuous `onSnapshot(callback)` updates,
arrow callbacks and unsubscribe functions before the first subscription example.
Game subscriptions deliver future changes only; service subscriptions read the
initial state automatically. Keep native options, presentation data and content
sizing together in `api-presentation`. Use short navigation labels and English
identifiers in code examples in both languages.

Manifest sizing declares `fitToContent: false | "both" | "height"` and an optional
`defaultMode: "fit" | "manual"`; users own the active choice. Document option
behavior with examples unrelated to sizing, and show size measurement separately.
Custom options are flat; only boolean, enum and number controls are supported.

The public host boundary is game context, telemetry/FPS, media, presentation,
media assets, network, clipboard, lifecycle/messages, locale and isolated widget
storage. Only `telemetry.read`, `fps.read`, `media.read` and `media.control` are
host service capabilities. System measurements require telemetry or FPS grants;
game snapshots expose session context only. Media permissions retain their
network, clipboard and temporary-storage restrictions. No public widget reads
built-in notes, stopwatch state, journal history or connected PlayerVox/Twitch accounts.

Keep the Examples page as a short directory to Studio and downloadable sources.
Standalone Notes, Stopwatch, Journal and Public score guides belong in Studio,
not in the documentation navigation. The SDK has no Twitch integration.

Network permissions declare exact `origin`, `method` and `path` values. Variable
path segments use bounded `integer`, `slug` or `enum` declarations in
`pathParams`; `queryParams` explicitly lists optional or required typed values
and also supports bounded `string`. Do not document prefix or wildcard grants.

Every code block uses the existing JSON block format, declares its language and
contains at most 28 lines. Keep JSON fragments parseable as objects. Small
examples must include the HTML they query or create their own DOM nodes. Keep
code and comments in English in both locales; translate the explanatory prose
and visible documentation labels. Keep FR/EN page order, slugs and heading IDs
aligned, and update links when removing a page or anchor.
