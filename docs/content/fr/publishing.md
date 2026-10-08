# Publication et revue

Les widgets atteignent les utilisateurs de PlayerVox OverCrow par le
catalogue signé des widgets : OverCrow n’installe que ce que liste ce
catalogue. Cette page va du dossier de sources d’un widget à une version
listée. Ni une pull request ni une fusion ne publient quoi que ce soit : la
publication est une étape distincte des mainteneurs, hors de la CI.

## La soumission

Une soumission est le dossier de sources d’un widget, placé sous
`widgets/<dir>/` du
[dépôt public](https://github.com/Valhallab/playervox-overcrow-releases),
dans une pull request vers sa branche `candidate` :

```text
widgets/<dir>/
  manifest.json   view.ocml   style.ocss?   logic.ts | logic.js
  locales/en.json + locales/fr.json?   assets/**?   LICENSE
  listing.json    (marketplace text, never packaged)
```

Vous soumettez des sources, pas un paquet : le catalogue livre toujours le
paquet reconstruit à partir des sources relues.

Les IDs de paquet sous `com.playervox` sont réservés aux widgets publiés
par PlayerVox. Utilisez un ID en DNS inversé sous un domaine que vous
contrôlez, et gardez-le : l’ID est l’identité du widget dans le catalogue.

## La fiche

`listing.json` contient ce qu’affiche la marketplace :

<!-- source: docs/content/examples/weather/listing.json -->
```json
{
  "author": "Example Studio",
  "spdxLicense": "MIT",
  "sourceUrl": "https://github.com/example/weather-widget",
  "defaultLocale": "en",
  "localizations": [
    { "locale": "en", "name": "Weather", "description": "The temperature of a city, refreshed every 30 minutes." },
    { "locale": "fr", "name": "Météo", "description": "La température d’une ville, actualisée toutes les 30 minutes." }
  ]
}
```

<!-- generated:listing-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `author` | texte ≤ 128 octets | oui | Texte brut, sans espaces en début ni en fin, sans `<` ni `>`. |
| `spdxLicense` | texte ≤ 64 octets | oui | Expression SPDX, faite des caractères `[A-Za-z0-9.+-]`. |
| `sourceUrl` | texte ≤ 2 Kio | oui | URL HTTPS canonique des sources relues, sans port, requête ni fragment. |
| `defaultLocale` | `locale` | oui | L’une des localisations. |
| `localizations` | liste de `Localization` ≤ 16 | oui | `{ locale, name, description }` avec des locales distinctes de la forme `xx` ou `xx-YY` ; nom ≤ 128 octets, description ≤ 512 octets. |
<!-- /generated:listing-fields -->

- `author`, les noms et les descriptions sont du texte brut, sans espace au
  début ni à la fin, sans `<` ni `>` ; les langues sont de la forme `xx` ou
  `xx-YY`, l’une d’elles étant `defaultLocale`.
- `spdxLicense` est une expression SPDX ; le `LICENSE` du paquet en
  contient le texte. Les widgets PlayerVox sont sous MIT. La politique pour
  les licences des tiers n’est pas encore arrêtée : une expression valide
  est relue, pas approuvée par les métadonnées
  ([licences](../../../LICENSING.md)).
- `sourceUrl` est une URL HTTPS canonique des sources relues, sans port,
  requête ni fragment.
- `preview` (facultatif) désigne un PNG empaqueté sous `assets/`, de
  256 Kio au plus, par exemple `"preview": "assets/preview.png"`. Le
  Centre de contrôle et la marketplace le montrent entier dans un cadre
  4:3, centré sur la couleur `#1e242e`, à 1,5 pixel par point d’écran au
  plus : rendez le widget à 150 % (`"scale": 1500` dans un scénario) et
  donnez à l’image un format 4:3, il apparaît à sa taille réelle, jamais
  recadré ni agrandi.

## L’admission : lancez-la vous-même

```sh
overcrow-widget admit widgets/<dir>
overcrow-widget admit widgets/<dir> --package dist/<id>-<version>.ocpkg
overcrow-widget admit widgets/<dir> --format json
```

`admit` est exactement l’admission statique de la marketplace. Elle
n’exécute jamais votre code ni `tsc` :

1. elle construit le dossier comme le fait `package` : toutes les
   vérifications des sources, du style, de la logique et du paquet, puis le
   lecteur de paquets d’OverCrow lui-même ;
2. avec `--package`, la vue compilée de votre archive doit être, octet pour
   octet, le résultat de la compilation de `view.ocml` ;
3. elle vérifie les limites du schéma, les IDs réservés, `listing.json`,
   l’aperçu et, pour les widgets PlayerVox, la licence MIT ;
4. elle liste pour le relecteur l’autorité que demande le widget :
   capabilities sensibles, chaque route réseau, écritures dans le
   presse-papiers, stockage et événements de jeu.

La commande se termine avec le code de sortie 1 quand la soumission serait
refusée. Ses codes sont listés avec la [commande `admit`](cli.md#admit).

Sur une pull request, l’outil d’admission est construit depuis la branche
de base relue, jamais depuis votre révision, et il lit vos fichiers comme
des données : votre JavaScript, votre TypeScript, vos commandes de build,
vos tests et vos scripts n’y sont jamais exécutés. Une pull request ne peut
pas modifier les outils de l’admission eux-mêmes.

## La revue

Un mainteneur lit le rapport d’admission et les sources, puis fusionne dans
`candidate`. Les relecteurs vérifient :

- **L’identité.** Un nouvel ID sous un domaine que l’auteur contrôle. Une
  nouvelle version pour tout changement : les versions publiées sont
  immuables, et une version inférieure à une version listée est refusée.
- **La reproductibilité.** Le paquet est reconstruit à partir des sources
  relues.
- **L’autorité.** Chaque capability, surtout les sensibles ; chaque route
  réseau, qui doit servir l’objet annoncé du widget ; les écritures dans le
  presse-papiers, le stockage et les événements de jeu. Voir
  [services et permissions](services.md).
- **La fiche.** Un texte exact et brut dans chaque langue, une URL de
  sources canonique, un aperçu qui montre le widget.
- **La licence.** `LICENSE` correspond à `spdxLicense`, et chaque
  ressource, police ou code tiers embarqué garde sa mention.

À la fusion, la révision exacte est admise de nouveau, et un reçu lie le
paquet admis au commit relu. Accepter une soumission ne signe et ne publie
rien.

## Le catalogue

Les mainteneurs préparent le catalogue suivant à partir des révisions
admises et le signent hors de la CI avec la clé du catalogue, dont la moitié
publique est dans [`keys/`](../../../keys/). Le catalogue :

- liste chaque version avec le SHA-256 et la taille de son paquet ; une
  version publiée ne change jamais, et un changement est une nouvelle
  version ;
- porte un numéro de séquence strictement croissant et expire au bout de
  90 jours au plus : OverCrow refuse une séquence plus ancienne et un
  catalogue expiré ;
- marque `built-in` les widgets de référence PlayerVox (IDs
  `com.playervox.*` uniquement) : ils sont installés sur un nouveau profil
  avec leurs permissions déclarées accordées, sauf pour une mise à jour qui
  en demande davantage.

OverCrow vérifie la signature, l’empreinte du paquet, son registre et sa
vue compilée avant l’installation, puis à chaque démarrage du widget. Voir
[le paquet](package.md#comment-overcrow-vérifie-un-paquet).

## Mises à jour

Une nouvelle version de votre widget est une nouvelle soumission, avec une
`version` plus élevée : une version publiée n’est jamais remplacée. Une
mise à jour dont le manifeste demande plus que la version installée (une
règle réseau, un événement de jeu, une capability, le stockage ou le
presse-papiers) exige l’accord de l’utilisateur, dans le Centre de
contrôle, avant de s’exécuter.

## Statuts des versions

Chaque version listée a un statut :

| Statut | Signification |
| --- | --- |
| `verified` | Installable. |
| `security-suspended` | Soupçonnée de compromission : ni installée ni proposée en mise à jour, et une copie installée est arrêtée. Réversible dans un catalogue ultérieur. |
| `revoked` | Définitif : plus jamais installée, et une copie installée est arrêtée. |

Omettre une version dans un catalogue ne change jamais son statut. La
signature d’un catalogue ne contourne jamais la validation du paquet, le
consentement de l’utilisateur ni le sandbox.
