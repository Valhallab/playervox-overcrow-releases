# Public SDK documentation content

English and French SDK articles live in `en.json` and `fr.json`; `routes.mjs`
retains existing public slugs. The separate web application imports this content
from a pinned public revision and provides navigation, search, and rendering.

Edit articles here. Keep both languages aligned, preserve anchors and example
contracts, and retain MIT notices. SDK sources live in `content/sdk/` and source
templates in `content/templates/`. Run the website integration checks after
updating its vendor snapshot; this repository's creator tests verify the tools
and portable exports without depending on React.
