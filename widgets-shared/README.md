# Shared sources of the built-in widgets

Some built-ins draw the same thing: the PlayerVox grade badge and mark of
[PlayerVox Score](../widgets/playervox-score/README.md) and
[PlayerVox Rating](../widgets/playervox-rating/README.md), and the mark
alone of the [Session journal](../widgets/playervox-journal/README.md).
Their one source lives here, and `scripts/sync-shared-widgets.mjs` copies it
into each widget that uses it, between marker lines:

```ts
// <shared:playervox-badge/badge.ts>
// </shared:playervox-badge/badge.ts>
```

```css
/* <shared:playervox-badge/badge.ocss> */
/* </shared:playervox-badge/badge.ocss> */
```

A marker is a whole line of the widget's `logic.ts` or `style.ocss`; the
script replaces what lies between a pair with the named file. Edit the file
here, then run:

```sh
node scripts/sync-shared-widgets.mjs
```

CI runs it with `--check` (`scripts/ci-verify.sh` and the `sdk-cli`
workflow), which fails when a copy differs from its source: the copies
cannot diverge. Each widget directory therefore stays a complete project
that `overcrow-widget check`, `package`, `test` and `admit` build alone, and
that a creator can copy as it is.

This is an internal tool of the built-ins, not a feature of the widget CLI:
a widget still has one logic module and one style sheet. Admission builds
the packages from `widgets/` only, so a change here alters no package until
the copies are synced, and a pull request that changes a built-in's copy is
under the same publisher rule as any change to that built-in.

| Source | Used by | Holds |
| --- | --- | --- |
| [`playervox-badge/badge.ts`](playervox-badge/badge.ts) | `playervox-score`, `playervox-rating` | The grade thresholds for criteria, the grade colours, the badge's and the PlayerVox mark's draw commands, the badge's accessible name, rounding half away from zero, the pulse class |
| [`playervox-badge/badge.ocss`](playervox-badge/badge.ocss) | `playervox-score`, `playervox-rating` | The badge canvas's size, its one-shot pulse (`@keyframes`, animated by the host) and the grade colour classes |

MIT, like the widgets ([LICENSING.md](../LICENSING.md)).
