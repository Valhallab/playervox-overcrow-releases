# Warframe Market

`com.playervox.overcrow.warframe.market` — searches the public PC item
catalog of [warframe.market](https://warframe.market), shows the online
sellers and buyers of one item in two tabs and copies a trade whisper when
you click. A
PlayerVox widget of the catalog, not a built-in: written against the public
`@overcrow/sdk` and packaged with `overcrow-widget` like any creator's
widget. MIT. Version 3.0.0 replaced the Web widget (2.0.6) of the retired
runtime, under the same ID; 3.1.0 shows every online offer instead of the
five best, in tabs, with a refresh button and an optional auto refresh.

Warframe and related names remain trademarks of their respective owners
([trademarks](../../TRADEMARKS.md)); this widget is not affiliated with
them or with warframe.market.

## What it shows

| State | Shows |
| --- | --- |
| Loading | "Loading catalog…" until the stored or downloaded catalog is ready |
| Search | Up to 12 items whose English name or slug holds the text, in catalog order |
| Selected item | Lowest sell and highest buy price per item, then two tabs, Sellers (first) and Buyers, each with its count: every visible PC offer of a player in game or online, sellers by rising and buyers by falling price per item, the best 150 shown and "+N more" below them: price, trader followed by a dot for the player's state (green in game, amber online, named on hover and for screen readers; a long name is cut before the dot), quantity and variant (rank, charges, stars, subtype). A legend of the dots stays at the bottom, out of the scroll |
| Refresh | The button beside "Back" reloads the item's offers; it is off while they load. The offers shown stay until the new ones arrive ("Refreshing offers…"); a failed refresh keeps them ("Refresh failed · showing the previous offers") |
| Copy | "Whisper" writes `/w <trader> Hi, WTB <item> (<variant>) for <price>p` (WTS for a buyer; `n x … total` for several items) to the clipboard; the button then says "Copied", or "Retry" when it failed |
| Passive mode | The last results, with "Switch to interactive mode to search" |
| Errors | Catalog unavailable (with or without a cached catalog), orders unavailable, storage unavailable |

The interface is in English and French; item names stay in English, as the
provider sends them, and so does the whisper, which goes to the game's
trade chat. Prices use the user's number format.

## Permissions

| Permission | Why |
| --- | --- |
| `network` | Three `GET` routes of `https://api.warframe.market`, each with its response bound: `/v2/versions` (4 KiB; its answer is about 0.5 KB), `/v2/items` (3 MiB; the catalog is 1.6 MB and the default 1 MiB bound is too small) and `/v2/orders/item/{slug}`, the slug checked as a `slug` parameter of at most 96 bytes (2 MiB; the orders of users seen in the last seven days, 0.4 to 1 MB for popular items on 2026-10-08) |
| `storage` | The saved search and the compact catalog with its version, in at most four keys and about 70 KB of the 256 KiB quota |
| `clipboardWrite` | The whisper, on a click in interactive mode only |

No capability: the widget reads nothing about the user or the game.

## Options menu

| Row | Values |
| --- | --- |
| Auto refresh | Off (default), every 30 s, every minute: the shown item's offers reload on their own. Only with an item shown, never while a request runs, paused while the widget or the overlay is hidden (a reload that fell due runs when it shows again), and each failure in a row doubles the wait, up to eight times. Off by default: every 30 s, a popular item costs about 1.75 MB of download a minute |

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
- **Orders.** An item's answer is read as text, 300 orders per VM turn, one
  host timer (100 ms) apart: rows are cut where `},{"id":"` starts the next
  one and each slice is parsed by the engine's `JSON.parse`, so a wrong cut
  fails, never silently, and a slice beyond 512 KB, a malformed envelope or
  more than 20,000 rows refuse the answer ("Orders unavailable"). Parsing a
  1 MB answer in one turn would exceed the turn budget under the VM's CPU
  ceiling. Only visible PC orders of players in game or online are kept.
- **Requests.** The provider allows three requests per second: a request
  starts at least 400 ms after the previous one. Selecting several items
  quickly sends one request, for the latest; a late answer for an earlier
  selection is dropped. The catalog and the orders run one after the other:
  their bounds (3 and 2 MiB) do not fit the widget's 4 MiB network budget
  together.
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
  pacing, storage writes, search, selection, copy and its failure, refresh
  (offers kept while they reload, a failed refresh), auto refresh (off by
  default, every 30 s or minute, slower after errors, never two at once,
  none without an item), tabs, the catalog and the orders one after the
  other, the incremental readers (strings, nesting, slices, malformed or
  oversized answers), the catalog, orders and whisper rules, the 150-offer
  cap, and a catalog of today's size that fits two storage values.
- Scenarios, played by `overcrow-widget test` in OverCrow's headless
  runtime, with synthetic `http.fetch` fixtures (no request reaches
  warframe.market) and their reference images: `render` (both themes and
  languages at 100 and 150 %), `detail` (both tabs, copies, back, clicks at
  100 and 150 %), `tabs` (161 sellers: the 150 cap and "+11 more", at the
  minimum and default widths, both themes and languages), `auto-refresh`
  (every 30 s, nothing while hidden, the due reload when shown again, the
  refresh button), `search`, `passive`, `cached`, `refresh`, `bounds` (a
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

All within the 8 MB engineering goal per widget. The eleven scenarios of
3.0.1 pass on Windows too; their 22 images are identical, pixel for pixel,
to the Linux references.

The offers of one item (3.1.0), measured on 2026-10-08 on the same Linux
workstation with the provider's real answers, the VM in its sandbox with
the production cgroup leaf (a quarter of one core, 64 MiB):

| | 876 KB answer (1,718 orders, about 115 online) | synthetic 2 MB answer (3,895 orders) |
| --- | --- | --- |
| VM resident peak (`VmHWM`) | 9.4 MiB | 11.5 MiB |
| VM CPU per slice of 300 orders | 2 to 3 ms | the same |
| Last turn (sort, scene) | 3.5 to 6 ms | the same |
| Offers shown after the answer | 6 slices, about 0.6 s | 13 slices, about 1.3 s |
| Turns killed by the turn budget, 25 runs | none | none |
| One turn for the whole answer (rejected design) | killed 5 times in 5 | killed 5 times in 5 |

Sixty refreshes in a row leave the heap at 1.0 MiB and the resident memory
flat. The most offers found on a side among twelve popular items was 112
(Primed Flow): 933 scene nodes, about 15 ms of host work once when the list
arrives; 150 offers, the cap, stay near 1,250 nodes, far below the 4,096
nodes of a scene. Network, a refresh of a popular item: 0.4 to 1 MB, about
1.75 MB a minute every 30 s (the host's broker takes no compression).

At the declared ceiling (a synthetic 3.0 MB catalog of 7,200 items) the
first load takes about 60 turns, the VM peaks at 8.1 MiB private on Linux
and the default 16 MiB heap suffices. The catalog then needs four storage
values, beyond three: it is searchable but kept in memory only, and
downloaded again at the next start. A catalog beyond 3 MiB fails with
`response_body_limit`, and the widget shows "Catalog unavailable" (or keeps
its stored catalog). Not measured: the overlay's share and frame times
(the headless runtime renders on the CPU).
