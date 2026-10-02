# The package

A PlayerVox OverCrow widget is distributed as one file, `<id>-<version>.ocpkg`:
an archive of the manifest, the compiled view, the style, one script, the
messages, the images and the license. `overcrow-widget package` builds it,
and OverCrow reads it with the same code that built it.

```sh
overcrow-widget package
overcrow-widget inspect dist/com.example.my-widget-0.1.0.ocpkg
```

`package` checks the project, writes the archive to `dist/` and prints its
size and its SHA-256. `inspect` shows what a package holds and what it asks
for, as a reviewer sees it.

## What goes in

<!-- generated:package-files -->
| Path | Required | Limit | Meaning |
| --- | --- | --- | --- |
| `manifest.json` | yes | 64 KiB | The manifest, as written. |
| `ledger.json` | yes | 64 KiB | Canonical SHA-256 and byte ledger of every other entry, written by the CLI. |
| `logic.js` | yes | 512 KiB | The only executable content: one ES2023 script without imports, compiled expressions of the view included. UTF-8, not empty. |
| `view.json` | yes | 512 KiB | Compiled view. The `view.ocml` source is not shipped. |
| `style.ocss` | no | 128 KiB | Style sheet source, parsed by the host when the widget starts. UTF-8. |
| `locales/en.json` | no | 256 KiB | English messages; present if and only if `locales/fr.json` is, with the same keys. |
| `locales/fr.json` | no | 256 KiB | French messages. |
| `LICENSE` | yes | 64 KiB | License text of the package. UTF-8, not empty. |
| `assets/<path>.{png,jpg,jpeg,webp}` | no | 2 MiB | Images whose signature matches the extension; lowercase `[a-z0-9_-]` segments, at most 4 below `assets/`. |
<!-- /generated:package-files -->

Any other entry rejects the package: a second script, an HTML file, a
WebAssembly module, native code, a hidden file, another locale. Text files
are UTF-8, without a byte-order mark.

What you write is not all packaged as it is:

| In the project | In the package |
| --- | --- |
| `manifest.json` | the same bytes |
| `view.ocml` | `view.json`, the compiled view; the source is not shipped |
| `logic.ts` or `logic.js` | `logic.js`: your module, the SDK and the compiled expressions of the view, in one script |
| `style.ocss`, `locales/`, `assets/`, `LICENSE` | the same bytes |
| `package.json`, `tsconfig.json`, `node_modules/`, `listing.json`, `tests/` | not packaged |

Images are PNG, JPEG or WebP files under `assets/`, in lowercase paths, and
the content of each file must match its extension. The view names one as
`src="assets/logo.png"`, and the `preview` of a
[listing](publishing.md#the-listing) is one of those packaged images.

## The script

`logic.js` is the only executable content of a package. The tool builds it
from your logic module, the SDK it embeds and one function per expression
and handler of the view, then removes what is unused and shortens local
names. Two consequences:

- the SDK in your `node_modules` is used for type checking only: the one
  that runs is the tool's, and `inspect` shows its version;
- the view itself carries no code: `view.json` refers to the functions of
  `logic.js` by number.

A package holds source that OverCrow can read and check, never compiled
bytecode.

## The same bytes every time

Packaging is deterministic: the same sources and the same version of the
tool give the same archive, byte for byte, on every run and every system.
That is what lets a reviewer rebuild your package from the sources you
submit and compare, and what lets the catalog name a package by its
SHA-256.

For that, the archive has one exact layout: an uncompressed zip, with its
entries sorted, fixed dates and no extra field. Use `overcrow-widget
package` to write it; an archive made with another zip tool is refused.

## The ledger

`ledger.json`, written by the tool, lists every other file with its size
and its SHA-256. OverCrow recomputes it from the archive and requires the
same bytes. It is what ties each file to the package: a file changed,
added or removed after packaging no longer matches.

## How OverCrow checks a package

OverCrow validates a package in full when it is admitted to the catalog,
when it is installed, and again **each time the widget starts**:

1. the size of the archive, its exact layout and the checksum of each
   entry;
2. every path, against the list of files above and their size limits, and
   the required files;
3. the ledger, byte for byte;
4. the manifest, the script, the style, the pair of locales, the license,
   each image, and the compiled view: known elements in allowed places,
   known attributes with values of the right type, events of their element,
   components used as declared, the bounds of the view, and each static
   image present in the package.

For a package of the catalog, the size and the SHA-256 of the archive must
first equal what the signed catalog says, and the manifest must equal the
one the catalog lists. A widget whose package fails any of these does not
start. `overcrow-widget check` and `package` run the same checks, so you
see a problem before a user does.

## Installed from the catalog, or locally

- A package **from the signed catalog** is verified: this is how users get
  widgets. See [publishing and review](publishing.md).
- A package sent by `overcrow-widget dev` is a **development package**:
  marked "Unverified", for the session only. See
  [the development channel](dev-channel.md).

A package that does not come from the catalog cannot use an ID under
`com.playervox`.

## Limits of a package

The sizes of each file and of the archive are in
[limits](limits.md#project-files-and-package). When a package is over a
bound, `check` says which:

| Code | Problem |
| --- | --- |
| `project.file_size` | A source file is larger than its limit. |
| `project.entry_limit` | The project has more files than a package may hold. |
| `project.asset_path` | An image's path is not lowercase, is too deep or has another extension. |
| `package.file_size` | A built file (`logic.js`, `view.json`) is larger than its limit. |
| `package.archive_size` | The archive is larger than 16 MiB. |
