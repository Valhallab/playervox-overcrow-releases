# Public SDK reference widgets

These original MIT examples use SDK 1.2.0 only. They do not contain proprietary
built-in renderers. Each folder supplies its API v2 manifest and identity; the
shared view/styles in `common/` are assembled by the creator kit and archive
builder. All exported examples include the byte-identical public SDK and license.

Run `node tools/creator-kit/overcrow.mjs init /new/project --template notes`, or
choose session, clock, performance, fps, stopwatch, media, score, rating, reviews,
journal or twitch. `npm run dev`, `check` and `package` run from the new project.

Reference coverage includes data/status display, declared grants, native actions,
EN/FR, native preferences, passive mode, content sizing and unsubscribe/disposal.
The browser uses clearly labeled fictional data. Native-only account/editor/chat
UI returns cancelled in simulation. Availability depends on the installed host;
these examples and automated checks do not establish complete native parity.

Per-example source ZIPs and the portable kit are built with
`python3 scripts/package-docs-examples.py published/docs/downloads`.
No reference is signed or added to the marketplace catalog by that command.
