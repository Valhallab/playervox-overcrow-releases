# The listing: best practices

The listing is what players read in the PlayerVox OverCrow catalog before
they install a widget: its description, its preview, its category, its
games, its license and its links. You write it in the creator space, in the
widget's **Listing** tab.

## Saved as you type

The listing is a draft, saved by itself as you type.

- A widget's first listing goes to review with its first version.
- Later changes go alone to a quick review: **Submit the listing**. They
  need no new version of the widget. **Cancel the changes** brings the
  draft back to the published listing.
- The category is the exception: you change it at any time, without a
  review, and the change reaches players with the next publication of the
  catalog.

## Languages

English comes first: it is the default, shown when a player's language has
no description. **Add a language** adds another one, 16 languages at most.
The widget's name comes from its manifest (`name.en`, `name.fr`): to change
it, change the manifest and submit a version. The languages of the widget's
own interface come from its `locales/` files.

## Description

- 500 characters at most per language. The first two lines show on the
  catalog card: say what the widget does, plainly.
- Say when the widget contacts a server, and which one.
- No advertising and no claim the widget does not keep.

## Preview image

One image, in English, for every language: a PNG in 4:3, from 640 × 480 to
1,600 × 1,200 (1,280 × 960 recommended), 256 KiB at most. Show the widget in
use, without marketing text.

## Category and games

The category places the widget in the catalog. Add up to five games it is
made for: players filter the catalog by game.

## License and links

- **License**: "Proprietary, all rights reserved", or an SPDX license such
  as `MIT` or `Apache-2.0`.
- **Support**: an e-mail address or a web page where players get help.
  Required.
- **Privacy policy**: required as soon as the widget uses the network.
- **Public source code**: optional; a public repository adds the "Public
  source code" badge.

## From listing.json

A version's sources may carry a `listing.json`, as the command-line tool
reads it (see [`admit`](cli.md#admit)). In the
**Listing** tab, **Import listing.json** applies its descriptions, license
and source code address to the draft.
