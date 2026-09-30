# Creator documentation content

The pages of the creator documentation of widget API v1, in English (`en/`)
and French (`fr/`). The website renders them; this repository is their only
source. The Web runtime material (the JavaScript SDK 1.3, the creator kit,
its templates, references, downloads and articles) was removed in P4.1; the
website still serves a pinned copy of it until its documentation is
realigned on these pages (P4.5).

## Layout

| Path | Content |
| --- | --- |
| `pages.json` | Navigation: the order, slug, group and localized label of each page. Both locales have every page. |
| `en/*.md`, `fr/*.md` | The pages, in GitHub-flavored Markdown. The first `#` heading is the page title. |
| `examples/<name>/` | Complete widget projects that the pages quote. |

Pages:

| Page | Topic, and the source of truth for it |
| --- | --- |
| `index.md` | What a widget is and how it runs. |
| `guide.md` | The creator path, from `init` to a submission. |
| `widgets.md` | The reference widgets of `widgets/`. |
| `reference.md` | Where each part of the reference lives. |
| `security.md` | Sandbox, permissions and consent, gestures, what a widget cannot do. |
| `publishing.md` | Submission, listing, admission, review, catalog and version statuses. |

The technical manuals stay in `docs/`, in English only, and are the
reference: [CLI](../cli.md), [SDK guide](../sdk-guide.md),
[SDK reference](../sdk-reference.md), [testing a widget](../widget-testing.md),
[source formats](../widget-source-formats.md),
[schema reference](../widget-schema-v1.md) (generated),
[package and catalog format](../widget-package-v1.md) and
[development channel](../dev-channel.md). The CLI's diagnostics and the SDK's
tests cite them by path. A page here explains and links to them; it never
copies their tables. Each topic has one source page, and the others link to
it.

## Rules

- **Both languages together.** Every page exists in `en/` and `fr/` with the
  same code blocks, byte for byte, in the same order. Code and identifiers
  are English in both; prose, headings and labels are translated.
- **Links** are relative to the file and point into this repository; the
  link check (`scripts/check-links.mjs`) verifies files and heading anchors.
- **Code blocks are excerpts.** Each block, except `sh` and `text` blocks,
  follows a `<!-- source: PATH -->` comment and must be a contiguous run of
  whole lines of that file, under `docs/content/examples/`, `templates/` or
  `widgets/`. Those projects are checked, packaged and admitted by the CLI
  in CI. In `sh` blocks, every `overcrow-widget` command must be a command
  of the CLI.
- **Generated regions.** Tables of the contract are not written by hand:

  ```text
  <!-- generated:NAME -->
  <!-- /generated:NAME -->
  ```

  `node scripts/build-docs-content.mjs` fills them from the SDK types
  (`sdk/src/generated/`, generated from the schema) and from `widgets/`.
  Regions: `permissions`, `capabilities`, `gesture-events`, `widgets`.

## Checks

From the repository root, with the CLI built
(`cargo build -p overcrow-widget-cli --locked`) and the SDK built in `sdk/`:

```sh
node scripts/prepare-widgets.mjs
node scripts/build-docs-content.mjs --check
node --test --test-concurrency=2 tests/docs-content.test.mjs
node scripts/check-links.mjs
```

The test runs `target/debug/overcrow-widget`, or the executable named by
`OVERCROW_WIDGET`.
