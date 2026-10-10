# Creator documentation content

The creator documentation of widget API v1, in English (`en/`) and French
(`fr/`). The website renders these pages at
`https://overcrow.playervox.com/docs/en/<slug>/` (English) and
`https://overcrow.playervox.com/docs/<slug>/` (French); this repository is
their only source. Everything a widget creator needs is here: a page of the
website links to this repository only for the source of a widget, a
template or an example, for a license, for the public keys and for the
security policy.

## Layout

| Path | Content |
| --- | --- |
| `pages.json` | Navigation: the order, slug, group and localized label of each page. Both locales have every page. `"hidden": true` keeps a page written ahead of what it describes off the website (neither rendered nor in the navigation) while it is checked like the others; remove it to publish the page. |
| `en/*.md`, `fr/*.md` | The pages, in GitHub-flavored Markdown. The first `#` heading is the page title. |
| `examples/<name>/` | Complete widget projects that the pages quote: `weather` (an HTTP API, storage) and `countdown` (a timer, a component, a canvas, a context menu, the options menu). |
| `i18n/fr.json` | The French translation of the generated descriptions. |
| `i18n/en.json` | Descriptions of the schema reworded for a creator. |
| `i18n/service-errors.json` | The meaning of each service error code, in both languages. |

Pages, by group of the navigation:

| Group | Pages |
| --- | --- |
| `start` | `index.md` (what a widget is), `guide.md` (from `init` to a submission), `widgets.md` (the reference widgets) |
| `build` | `manifest.md`, `view.md`, `style.md`, `logic.md`, `services.md` (services, permissions, capabilities, errors, user actions), `forms.md` (controls, forms, write intents) |
| `tools` | `cli.md` (every command and diagnostic), `testing.md` (unit tests, scenarios, reference images), `dev-channel.md` |
| `reference` | `reference.md` (where each answer is), `elements.md`, `style-properties.md`, `sdk.md`, `service-reference.md`, `result-shapes.md`, `limits.md` |
| `publish` | `package.md`, `security.md`, `publishing.md`; hidden until the creator space opens to everyone: `creator-space.md` (getting started), `publish-keys.md` (publish keys and CI), `verified-domain.md` |

The other documents of `docs/`, in English only, are for implementers and
maintainers: the generated [schema reference](../widget-schema-v1.md), which
is the contract that OverCrow pins, the
[package and catalog format](../widget-package-v1.md), the
[protocol of the development channel](../dev-channel.md), the
[compiled output](../widget-source-formats.md) of the source formats, the
[CLI internals](../cli.md) and the
[headless runtime interface](../widget-testing.md). Only `reference.md`
links to the three specifications, in one paragraph written for
implementers.

## Rules

- **Both languages together.** Every page exists in `en/` and `fr/` with the
  same code blocks, byte for byte, in the same order. Code and identifiers
  are English in both; prose, headings and labels are translated.
- **Each page stands alone.** A reader who arrives from a search must
  understand the page without having read the guide: it starts with a few
  sentences that say what it covers and with an example, even when most of
  it is generated.
- **One source page per topic.** The other pages link to it.
- **Product name.** "PlayerVox OverCrow" at the first mention of each page,
  its title included when it names the product, then "OverCrow".
- **Nothing that is not shipped.** A page describes what works today.
- **Links** are relative to the file. A link to another page of the same
  language becomes a link of the website; any other link goes to this
  repository on GitHub. The link check (`scripts/check-links.mjs`) verifies
  files and heading anchors.
- **Code blocks are excerpts.** Each block, except `sh` and `text` blocks,
  follows a `<!-- source: PATH -->` comment and must be a contiguous run of
  whole lines of that file, under `docs/content/examples/`, `templates/` or
  `widgets/`. Those projects are checked, packaged and admitted by the CLI
  in CI. In `sh` blocks, every `overcrow-widget` command must be a command
  of the CLI. A `text` block shows what a tool prints.
- **Generated regions.** Tables of the contract are not written by hand:

  ```text
  <!-- generated:NAME -->
  <!-- /generated:NAME -->
  ```

  `node scripts/build-docs-content.mjs` fills them from the generated
  [schema reference](../widget-schema-v1.md), from the SDK types
  (`sdk/src/generated/`, generated from the same schema) and from
  `widgets/`. The regions are the keys of `GENERATORS` in that script:
  manifest and menu fields, elements, attributes, events, style properties,
  values, selectors, tokens, permissions, capabilities, network rules,
  services, result shapes, write intents, error codes, draw commands, fault
  categories, limits, package files, listing fields and the reference
  widgets.
- **Limits by value.** A page gives a limit as its value with its unit
  ("at most 32 rules", "text ≤ 256 bytes"), in the generated regions as in
  the prose. Only `limits.md` names the constants, with the list of the
  constants the SDK exports in `sdk.md`.

## Translated descriptions

The generated regions take their English text from the schema. Three files
of `i18n/` complete it:

- `fr.json` translates it. `text` maps each English description to its
  French one; `patterns` translates the words of types and values, with
  `{0}`, `{1}`… standing for the code and the numbers of the cell
  (`"text ≤ {0}"` is `"texte ≤ {0}"`).
- `en.json` rewords, for a creator, a description that the schema writes
  for those who implement the host (`"Children of one node."` becomes
  `"Children of one element."`). The French catalog then translates the
  reworded text.
- `service-errors.json` gives the meaning of each service error code, in
  both languages: the schema lists the codes without describing them.

`node scripts/build-docs-content.mjs --check` fails when a region is stale,
when an English description has no French translation, when a translation
or a rewording has no description left, and when an error code has no
meaning or a meaning has no code. After a change of the schema,
`node scripts/build-docs-content.mjs --missing` prints the entries to write.

## Glossary

One French term for one notion, on every page and in the catalog.
Identifiers, file names, element, property and service names and the
keywords of the schema are never translated.

| English | Français |
| --- | --- |
| widget | widget |
| built-in (widget) | widget intégré |
| reference widget | widget de référence |
| host (OverCrow, as seen from a widget) | l’hôte |
| overlay | l’overlay |
| view | la vue |
| style, style sheet | le style, la feuille de style |
| logic | la logique |
| state | l’état |
| handler | gestionnaire |
| event | événement |
| user action | action de l’utilisateur (jamais « geste ») |
| service | service |
| call | appel |
| subscription, to subscribe | abonnement, s’abonner |
| update (of a subscription) | mise à jour |
| listener | écouteur |
| permission | permission |
| capability | capability (féminin : une capability, des capabilities) |
| sensitive capability | capability sensible |
| to grant, granted | accorder, accordé |
| consent | consentement, accord |
| manifest | le manifeste |
| package | le paquet |
| to package | empaqueter |
| ledger | le registre |
| catalog | le catalogue |
| listing | la fiche |
| preview (image) | aperçu |
| marketplace | la marketplace |
| options menu | menu d’options |
| row (of the menu) | ligne |
| toggle | bascule |
| slider | curseur |
| checkbox | case à cocher |
| drop-down list (`select`) | liste déroulante |
| field (text) | champ (de texte) |
| control | contrôle |
| form | formulaire |
| to submit (a form) | valider (un formulaire) |
| write intent | intent d’écriture |
| timer | minuteur |
| tick | déclenchement ; « se déclencher » |
| turn (of the logic) | tour |
| budget | budget |
| heap | tas |
| design token | token (du design system) |
| theme (dark, light) | thème (sombre, clair) |
| element | élément |
| attribute | attribut |
| property (style) | propriété |
| property (of a component) | propriété |
| selector | sélecteur |
| component | composant |
| expression | expression |
| scenario | scénario |
| fixture | fixture (féminin), « données simulées » en première explication |
| reference image | image de référence |
| headless runtime | runtime headless |
| unit test | test unitaire |
| development channel | canal de développement |
| development package | paquet de développement |
| Interactive mode, Passive mode | mode interactif, mode passif |
| frame (of a widget) | cadre |
| panel | panneau |
| content scale | échelle du contenu |
| logical pixels | pixels logiques |
| account | compte |
| sign-in | connexion |
| token (of an account) | jeton |
| clipboard | presse-papiers |
| storage | stockage |
| network rule | règle réseau |
| route | route |
| broker | broker |
| request, response, body | requête, réponse, corps |
| checklist (notes) | liste de tâches |
| rating (PlayerVox) | note |
| review (PlayerVox) | avis |
| grade | grade |
| score | score |
| canvas | canvas |
| draw command | commande de dessin |
| image handle (`asset:`) | identifiant d’image (`asset:`) |
| limit, bound | limite |
| error code | code d’erreur |
| failure, fault | échec, faute |
| command-line tool, CLI | outil en ligne de commande, la CLI |
| diagnostic | diagnostic |
| exit status | code de sortie |
| sandbox | le sandbox |
| reviewer | relecteur |
| maintainer | mainteneur |
| submission | soumission |
| admission | admission |
| review (of a submission) | revue |
| pull request | pull request |
| repository | dépôt |
| source (code) | sources |
| byte, KiB, MiB | octet, Kio, Mio |
| locale, messages | langue, messages |
| label | libellé |
| placeholder | indication (d’un champ vide) |
| tooltip | infobulle |
| focus | focus |
| layout | mise en page |
| to render, rendering | rendre / dessiner, rendu |
| to check (CLI) | vérifier |
| to refuse / reject | refuser |

In French: a typographic apostrophe (’), « … » quotation marks, a space
before `:` `;` `?` `!`, "Kio" and "Mio", and the formal "vous".

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
`OVERCROW_WIDGET`. `npm test` in `sdk/` checks that `en/sdk.md` and
`fr/sdk.md` list every export of the SDK.
