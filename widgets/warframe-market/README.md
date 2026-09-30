# Warframe Market

`com.playervox.overcrow.warframe.market` — searches the public PC item
catalog of [warframe.market](https://warframe.market), shows the best buy
and sell offers of one item and copies a trade whisper when you click. A
PlayerVox widget of the catalog, not a built-in: written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT. Version 3.0.0 replaces the Web widget (2.0.6) of the retired
runtime, under the same ID.

Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
them or with warframe.market.

## What it shows

| State | Shows |
| --- | --- |
| Loading | "Loading catalog…" until the stored or downloaded catalog is ready |
| Search | Up to 12 items whose English name or slug holds the text, in catalog order |
| Selected item | Lowest sell and highest buy price per item, the number of offers, then up to five visible PC offers a side: price, trader, presence (in game, online, offline), quantity and variant (rank, charges, stars, subtype) |
| Copy | "Copy whisper" writes `/w <trader> Hi, WTB <item> (<variant>) for <price>p` (WTS for a buyer; `n x … total` for several items); the button and the bottom line say whether it worked |
| Passive mode | The last results, with "Switch to interactive mode to search" |
| Errors | Catalog unavailable (with or without a cached catalog), orders unavailable, storage unavailable |

The interface is in English and French; item names stay in English, as the
provider sends them, and so does the whisper, which goes to the game's
trade chat. Prices use the user's number format.

## Permissions

| Permission | Why |
| --- | --- |
| `network` | Three `GET` routes of `https://api.warframe.market`, each with its response bound: `/v2/versions` (4 KiB; its answer is about 0.5 KB), `/v2/items` (3 MiB; the catalog is 1.6 MB and the default 1 MiB bound is too small) and `/v2/orders/item/{slug}/top`, the slug checked as a `slug` parameter of at most 96 bytes (128 KiB; about 5 KB) |
| `storage` | The saved search and the compact catalog with its version, in at most four keys and about 70 KB of the 256 KiB quota |
| `clipboardWrite` | The whisper, on a click in interactive mode only |

No capability: the widget reads nothing about the user or the game.

## How it works

- **Catalog.** At start the widget reads the stored catalog, then asks
  `/v2/versions` for the catalog's version. It downloads `/v2/items` only
  when nothing is stored or the version changed; a failed download keeps
  the stored catalog.
- **Turns.** The catalog is downloaded as text and read in slices of 250
  items, one host timer (100 ms) apart: each item is parsed alone and
  checked (slug `[a-z0-9_-]`, name without control characters, cut to 96
  characters). The stored copy is written and read back the same way. No
  VM turn handles the whole catalog, so none nears the turn budget, even
  under the VM's CPU ceiling.
- **Storage.** One line per item: the name, followed by a tab and the slug
  when the slug does not derive from the name (83 of 3,892 items). The
  lines fill chunks of at most 60 KB (two for today's catalog, three at
  most). The index key is removed before the chunks are written and set
  last, so an interrupted write is never read back as a catalog.
- **Requests.** The provider allows three requests per second: a request
  starts at least 400 ms after the previous one. Selecting several items
  quickly sends one request, for the latest; a late answer for an earlier
  selection is dropped.
- **Search.** In memory, at each keystroke; the text is saved a second
  after the last one.

## Differences from the Web widget

- The catalog lived in IndexedDB; it is now in host storage, compacted.
- Its layout adapted to the panel width with CSS media queries; the style
  subset has none, so the offer rows keep one grid and the panel scrolls.
- After "Clear", the Web widget put the focus back in the search field.
  The SDK has no focus API; a future SDK version could add one.
- A "Back to results" button returns from an item to the search results.

## Tests

- `tests/logic.test.mjs`: the logic on `@overcrow/sdk/testing`: start,
  pacing, storage writes, search, selection, copy and its failure, the
  incremental reader (strings, nesting, slices, malformed text), the
  catalog, orders and whisper rules, and a catalog of today's size that fits
  two storage values.
- Scenarios, played by `overcrow-widget test` in OverCrow's headless
  runtime, with synthetic `http.fetch` fixtures (no request reaches
  warframe.market) and their reference images: `render` (both themes and
  languages at 100 and 150 %), `detail` (offers, copies, back, clicks at
  100 and 150 %), `search`, `passive`, `cached`, `refresh`, `bounds` (a
  version answer beyond its 4 KiB bound), `errors`, `unavailable`,
  `refused` (without `network`) and `no-clipboard`.

```sh
node ../../scripts/prepare-widgets.mjs
overcrow-widget check && overcrow-widget package
node --test tests/*.test.mjs
overcrow-widget test --runtime <overcrow-widget-headless>
```

## Cost

Measured on 2026-09-30 with OverCrow's headless runtime (release build),
on an AMD Ryzen 7 5800X3D Linux workstation (the VM in its Bubblewrap and
seccomp sandbox, without the per-widget cgroup) and in a Windows 11 virtual
machine (2 vCPU, cross-built runtime, full containment: Less Privileged
AppContainer, Job, mitigations). The catalog is synthetic, 3,892 items
shaped and sized like the provider's (1.63 MB). Figures of the VM process:
`RssAnon`, `VmHWM` and `schedstat` on Linux; private commit, private
working set and peak working set on Windows. Three runs each; Windows
samples every few milliseconds on 2 vCPU and can miss a short peak.

| | Linux | Windows (VM) |
| --- | --- | --- |
| VM private memory, catalog downloaded and stored (peak) | 5.0 MiB `RssAnon` | 5.7–5.8 MiB commit, 5.1–5.3 MiB private working set |
| VM private memory, at rest after searches | 3.7 MiB `RssAnon` | 3.4–5.1 MiB private working set |
| VM private memory, start from the stored catalog | 3.2 MiB `RssAnon` | 2.6–3.0 MiB commit |
| VM resident peak, shared pages included | 11.5–11.7 MiB `VmHWM` | 14.9–15.1 MiB peak working set |
| VM CPU, download, check and store the catalog | 126–137 ms in about 35 turns | 110–160 ms (15.6 ms clock) |
| VM CPU per keystroke of a search | about 0.3 ms | not resolved by the clock |
| VM CPU at rest | none: no timer runs once the catalog is loaded | the same |
| First load, catalog downloaded | searchable after about 16 turns (1.6 s after the answer), stored after about 35 turns at 100 ms (3.5 s) | the same turns |
| Searchable after a start from the stored catalog | 5 turns, about 0.5 s | the same turns |
| Network, a refresh | 1.64 MB (catalog) + 0.5 KB (version), plus about 0.6 KB of headers each | — |
| Network, a start with the current catalog stored | 0.5 KB (version) | — |

All within the 8 MB engineering goal per widget. The eleven scenarios pass
on Windows too; their 22 images are identical, pixel for pixel, to the
Linux references.

At the declared ceiling (a synthetic 3.0 MB catalog of 7,200 items) the
first load takes about 60 turns, the VM peaks at 8.1 MiB private on Linux
and the default 16 MiB heap suffices. The catalog then needs four storage
values, beyond three: it is searchable but kept in memory only, and
downloaded again at the next start. A catalog beyond 3 MiB fails with
`response_body_limit`, and the widget shows "Catalog unavailable" (or keeps
its stored catalog). Not measured: the overlay's share and frame times
(the headless runtime renders on the CPU).
