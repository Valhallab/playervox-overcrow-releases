# Le paquet

Un widget PlayerVox OverCrow est distribué en un seul fichier,
`<id>-<version>.ocpkg` : une archive qui réunit le manifeste, la vue
compilée, le style, un script, les messages, les images et la licence.
`overcrow-widget package` la construit, et OverCrow la lit avec le code
même qui l’a construite.

```sh
overcrow-widget package
overcrow-widget inspect dist/com.example.my-widget-0.1.0.ocpkg
```

`package` vérifie le projet, écrit l’archive dans `dist/` et affiche sa
taille et son SHA-256. `inspect` montre ce qu’un paquet contient et ce
qu’il demande, tel que le voit un relecteur.

## Ce qu’il contient

<!-- generated:package-files -->
| Chemin | Obligatoire | Limite | Signification |
| --- | --- | --- | --- |
| `manifest.json` | oui | 64 Kio | Le manifeste, tel qu’il a été écrit. |
| `ledger.json` | oui | 64 Kio | Registre canonique du SHA-256 et de la taille de chaque autre entrée, écrit par la CLI. |
| `logic.js` | oui | 512 Kio | Le seul contenu exécutable : un script ES2023 sans import, expressions compilées de la vue comprises. UTF-8, non vide. |
| `view.json` | oui | 512 Kio | La vue compilée. Le source `view.ocml` n’est pas embarqué. |
| `style.ocss` | non | 128 Kio | Source de la feuille de style, analysée par l’hôte au démarrage du widget. UTF-8. |
| `locales/en.json` | non | 256 Kio | Messages en anglais ; présent si et seulement si `locales/fr.json` l’est, avec les mêmes clés. |
| `locales/fr.json` | non | 256 Kio | Messages en français. |
| `LICENSE` | oui | 64 Kio | Texte de la licence du paquet. UTF-8, non vide. |
| `assets/<path>.{png,jpg,jpeg,webp}` | non | 2 Mio | Images dont la signature correspond à l’extension ; segments en minuscules `[a-z0-9_-]`, au plus 4 sous `assets/`. |
<!-- /generated:package-files -->

Toute autre entrée fait refuser le paquet : un second script, un fichier
HTML, un module WebAssembly, du code natif, un fichier caché, une autre
langue. Les fichiers texte sont en UTF-8, sans marque d’ordre d’octets.

Tout ce que vous écrivez n’est pas empaqueté tel quel :

| Dans le projet | Dans le paquet |
| --- | --- |
| `manifest.json` | les mêmes octets |
| `view.ocml` | `view.json`, la vue compilée ; le fichier source n’est pas livré |
| `logic.ts` ou `logic.js` | `logic.js` : votre module, le SDK et les expressions compilées de la vue, en un seul script |
| `style.ocss`, `locales/`, `assets/`, `LICENSE` | les mêmes octets |
| `package.json`, `tsconfig.json`, `node_modules/`, `listing.json`, `tests/` | non empaquetés |

Les images sont des fichiers PNG, JPEG ou WebP placés sous `assets/`, à des
chemins en minuscules, et le contenu de chaque fichier doit correspondre à
son extension. La vue en désigne une par `src="assets/logo.png"`, et
l’aperçu (`preview`) d’une [fiche](publishing.md#la-fiche) est l’une de ces
images empaquetées.

## Le script

`logic.js` est le seul contenu exécutable d’un paquet. L’outil le construit
à partir de votre module de logique, du SDK qu’il embarque et d’une
fonction par expression et par gestionnaire de la vue, puis retire ce qui
ne sert pas et raccourcit les noms locaux. Deux conséquences :

- le SDK de votre `node_modules` ne sert qu’à la vérification des types :
  celui qui s’exécute est celui de l’outil, et `inspect` affiche sa
  version ;
- la vue elle-même ne contient aucun code : `view.json` désigne les
  fonctions de `logic.js` par leur numéro.

Un paquet contient des sources qu’OverCrow peut lire et vérifier, jamais de
bytecode compilé.

## Les mêmes octets à chaque fois

L’empaquetage est déterministe : les mêmes sources et la même version de
l’outil donnent la même archive, octet pour octet, à chaque exécution et
sur chaque système. C’est ce qui permet à un relecteur de reconstruire
votre paquet à partir des sources que vous soumettez, puis de comparer.
C’est aussi ce qui permet au catalogue de désigner un paquet par son
SHA-256.

Pour cela, l’archive n’admet qu’une seule structure, exacte : un zip non
compressé, aux entrées triées, aux dates fixes et sans champ
supplémentaire. Écrivez-la avec `overcrow-widget package` ; une archive
produite par un autre outil zip est refusée.

## Le registre

`ledger.json`, écrit par l’outil, liste tous les autres fichiers avec leur
taille et leur SHA-256. OverCrow le recalcule à partir de l’archive et
exige les mêmes octets. C’est lui qui lie chaque fichier au paquet : un
fichier modifié, ajouté ou retiré après l’empaquetage ne correspond plus.

## Comment OverCrow vérifie un paquet

OverCrow valide un paquet en entier lors de son admission au catalogue,
lors de son installation, puis **à chaque démarrage du widget** :

1. la taille de l’archive, sa structure exacte et la somme de contrôle de
   chaque entrée ;
2. chaque chemin, comparé à la liste de fichiers ci-dessus et à leurs
   limites de taille, ainsi que la présence des fichiers obligatoires ;
3. le registre, octet pour octet ;
4. le manifeste, le script, le style, la paire de langues, la licence,
   chaque image et la vue compilée : des éléments connus à des emplacements
   autorisés, des attributs connus dont les valeurs ont le bon type, des
   événements propres à leur élément, des composants utilisés comme ils
   sont déclarés, les limites de la vue, et la présence dans le paquet de
   chaque image statique.

Pour un paquet du catalogue, la taille et le SHA-256 de l’archive doivent
d’abord être ceux qu’indique le catalogue signé, et le manifeste doit être
identique à celui que liste le catalogue. Un widget dont le paquet échoue à
l’une de ces vérifications ne démarre pas. `overcrow-widget check` et
`package` exécutent les mêmes vérifications : vous voyez donc un problème
avant qu’un utilisateur ne le rencontre.

## Installé depuis le catalogue, ou localement

- Un paquet **issu du catalogue signé** est vérifié : c’est ainsi que les
  utilisateurs obtiennent les widgets. Voir
  [publication et revue](publishing.md).
- Un paquet envoyé par `overcrow-widget dev` est un **paquet de
  développement** : marqué « Unverified », pour la durée de la session
  seulement. Voir [le canal de développement](dev-channel.md).

Un paquet qui ne vient pas du catalogue ne peut pas utiliser un ID sous
`com.playervox`.

## Limites d’un paquet

Les tailles de chaque fichier et de l’archive figurent dans les
[limites](limits.md#fichiers-du-projet-et-paquet). Quand un paquet dépasse
une limite, `check` indique laquelle :

| Code | Problème |
| --- | --- |
| `project.file_size` | Un fichier source dépasse sa limite. |
| `project.entry_limit` | Le projet compte plus de fichiers qu’un paquet ne peut en contenir. |
| `project.asset_path` | Le chemin d’une image n’est pas en minuscules, est trop profond ou porte une autre extension. |
| `package.file_size` | Un fichier construit (`logic.js`, `view.json`) dépasse sa limite. |
| `package.archive_size` | L’archive dépasse 16 Mio. |
