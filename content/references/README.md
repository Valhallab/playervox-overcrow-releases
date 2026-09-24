# Public SDK reference widgets

These MIT examples use SDK 1.3.0 and own their state. They never access built-in
widget data or native account sessions. Session, performance, FPS and media use
host/system services; stopwatch uses JavaScript; notes and journal use isolated
SDK storage. Score uses the anonymous PlayerVox HTTP endpoint with an explicit
network permission. Browser score data is explicitly fictional.

Initialize one with `node tools/creator-kit/overcrow.mjs init /new/project --template notes`.
Available references: session, clock, performance, fps, stopwatch, media, notes,
score and journal. Each project supports EN/FR, native wrapper options and export.

The shared view/styles in `common/` are assembled by the creator kit and archive
builder. All exports include the byte-identical SDK and MIT license.
`python3 scripts/package-docs-examples.py published/docs/downloads` builds source
ZIPs and the portable kit; it does not sign or publish marketplace widgets.
