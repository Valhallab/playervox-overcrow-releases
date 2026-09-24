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

Lead guides with a working result. Start each service reference with its purpose,
required permissions and a small usable example, followed by fields and practical
limits. Keep shared status and permission rules in the services overview and link
to them. Use short navigation labels and English identifiers in code examples in
both languages.

The public host boundary is game context, telemetry/FPS, media, presentation,
media assets, network, clipboard, lifecycle/messages, locale and isolated widget
storage. Only `telemetry.read`, `fps.read`, `media.read` and `media.control` are
host service capabilities. System measurements require telemetry or FPS grants;
game snapshots expose session context only. Media permissions retain their
network, clipboard and temporary-storage restrictions. No public widget reads
built-in notes, stopwatch state, journal history or connected PlayerVox/Twitch accounts.

Keep Notes, Stopwatch, Journal and Public score in the build group: they are
recipes using ordinary JavaScript, widget storage or anonymous `overcrow.fetch`.
The SDK has no Twitch integration.

Every code block declares its language and contains at most 28 lines. Small examples must include the HTML they
query or create their own DOM nodes. Keep code and comments in English in both
locales; translate the explanatory prose and visible documentation labels.
