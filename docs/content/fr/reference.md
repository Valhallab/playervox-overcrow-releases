# Référence

La référence de l’API widget v1 est écrite une seule fois, à côté du code
qu’elle décrit, et vérifiée contre lui. Cette page indique la bonne section.
Les documents de référence sont en anglais.

| Question | Où |
| --- | --- |
| Quels éléments, attributs et événements une vue peut-elle utiliser ? | [Schema reference : View](../../widget-schema-v1.md#view) |
| Quels propriétés de style, sélecteurs et valeurs sont acceptés ? | [Schema reference : Style](../../widget-schema-v1.md#style) |
| Quels tokens du design system et quelles icônes existent ? | [Design tokens](../../widget-schema-v1.md#design-tokens), [icônes](../../widget-schema-v1.md#icons) |
| Que contient `manifest.json` ? | [Manifest](../../widget-schema-v1.md#manifest), [menu du cadre](../../widget-schema-v1.md#wrapper-menu) |
| Que fait chaque permission, capability et service ? | [Permissions](../../widget-schema-v1.md#permissions), [services](../../widget-schema-v1.md#services) |
| Quelles sont les limites (tailles, nombres, budgets) ? | [Limits](../../widget-schema-v1.md#limits) |
| Comment écrire `view.ocml` et `style.ocss` ? | [Source formats](../../widget-source-formats.md) |
| Quelles fonctions `@overcrow/sdk` exporte-t-il ? | [SDK reference](../../sdk-reference.md) |
| Comment formater les heures, les dates et les nombres ? | [SDK reference : time, dates and numbers](../../sdk-reference.md#time-dates-and-numbers) |
| Comment écrire des tests unitaires et des scénarios ? | [Testing a widget](../../widget-testing.md) |
| Que fait chaque commande et chaque diagnostic du CLI ? | [CLI](../../cli.md) |
| Que contient un `.ocpkg`, et comment le catalogue est-il signé ? | [Package and catalog format](../../widget-package-v1.md) |
| Comment `overcrow-widget dev` parle-t-il à OverCrow ? | [Development channel](../../dev-channel.md) |

## Comment la référence reste exacte

- La **schema reference** est générée à partir du crate
  `overcrow-widget-schema`, les mêmes tables qu’OverCrow et le CLI compilent
  dans leurs validateurs. La CI la régénère et échoue si le fichier commité
  diffère.
- Les **types du SDK** (`sdk/src/generated/`) sont générés à partir du même
  crate : un élément, une icône, une capability ou un paramètre de service
  erroné est une erreur TypeScript dans votre logique.
- La **SDK reference** est vérifiée par les tests du SDK : chaque export de
  `@overcrow/sdk` doit y figurer et porter son commentaire de documentation.
- Les tableaux de ces pages (permissions, capabilities, gestes, widgets de
  référence) sont générés à partir des types du SDK et de `widgets/`, et
  chaque exemple de code est un extrait d’un projet que le CLI vérifie et
  empaquette en CI.

## Les permissions en bref

<!-- generated:permissions -->
| Permission | Services | Sur un geste |
| --- | --- | --- |
| `network` | `http.fetch` | — |
| `storage` | `storage.get`, `storage.set`, `storage.remove`, `storage.keys` | — |
| `clipboardWrite` | — | `clipboard.writeText` |
| `gameEvents` | `gameEvents.subscribe` | — |
<!-- /generated:permissions -->

Les capabilities, leur sensibilité et leurs services sont listés sur la page
[sécurité](security.md#permissions-et-consentement).
