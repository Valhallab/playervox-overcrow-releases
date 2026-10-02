# Référence

La référence des widgets PlayerVox OverCrow liste chaque élément, chaque
propriété de style, chaque service et chaque fonction du SDK de l’API
widget v1. Cette page indique où trouver chaque réponse. Les pages de la
rubrique « Écrire un widget » expliquent comment les parties fonctionnent
ensemble ; celles qui suivent sont à garder ouvertes pendant que vous
écrivez.

| Question | Page |
| --- | --- |
| Que contient `manifest.json` ? | [Le manifeste](manifest.md) |
| Quels éléments, attributs et événements une vue peut-elle utiliser ? | [Éléments et attributs](elements.md) |
| Quelles propriétés de style et quelles valeurs sont acceptées ? | [Propriétés de style et tokens](style-properties.md) |
| Quels tokens du design system et quelles icônes existent ? | [Tokens du design system](style-properties.md#tokens-du-design-system), [icônes](style-properties.md#icônes) |
| Quelles fonctions `@overcrow/sdk` exporte-t-il ? | [Référence du SDK](sdk.md) |
| Comment formater les heures, les dates et les nombres ? | [Heure, dates et nombres](sdk.md#heure-dates-et-nombres) |
| Qu’autorise chaque permission et chaque capability ? | [Services et permissions](services.md) |
| Quels sont les paramètres et le résultat d’un service ? | [Référence des services](service-reference.md), [formes de résultat](result-shapes.md) |
| Que signifie un code d’erreur ? | [Erreurs](services.md#erreurs) |
| Quels champs un intent d’écriture prend-il ? | [Les intents](forms.md#les-intents) |
| Quelles sont les limites (tailles, nombres, budgets) ? | [Limites](limits.md) |
| Que fait chaque commande et chaque diagnostic de la CLI ? | [L’outil en ligne de commande](cli.md) |
| Comment écrire un scénario de test ? | [Tester un widget](testing.md#scénarios) |
| Que contient un `.ocpkg` ? | [Le paquet](package.md) |

## Comment la référence reste exacte

- Les tableaux des éléments, des attributs, des propriétés de style, des
  tokens, des services, des formes de résultat et des limites sont
  **générés à partir du schéma des widgets**, les mêmes tables qu’OverCrow
  et l’outil en ligne de commande compilent dans leurs validateurs. Une
  vérification échoue dès qu’une page diffère du schéma, en anglais ou en
  français.
- Les **types du SDK** sont générés à partir du même schéma : un élément,
  une icône, une capability ou un paramètre de service erroné est donc une
  erreur TypeScript dans votre logique.
- La **référence du SDK** est vérifiée par les tests du SDK : chaque export
  de `@overcrow/sdk` y figure.
- Chaque **exemple de code** de ces pages est un extrait d’un projet que
  l’outil en ligne de commande vérifie, empaquette et admet à chaque
  changement : un template, un widget de référence ou l’un des deux
  exemples.

## Versions

Ces pages décrivent l’API widget v1 (`"apiVersion": 1` dans le manifeste)
et `@overcrow/sdk` 1.0.

## Spécifications pour les implémenteurs

Trois spécifications, dans le dépôt public, s’adressent à ceux qui
implémentent un hôte ou un autre outil plutôt qu’un widget : la
[référence complète du schéma, générée](../../widget-schema-v1.md), qui
couvre aussi le protocole entre OverCrow et le processus du widget ainsi que
les données du catalogue ; le
[protocole du canal de développement](../../dev-channel.md) ; et le
[format de l’archive et du catalogue](../../widget-package-v1.md). L’auteur
d’un widget n’en a pas besoin.
