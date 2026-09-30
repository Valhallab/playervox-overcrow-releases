# Publication et revue

Les widgets atteignent les utilisateurs d’OverCrow par le catalogue signé des
widgets v1
(`https://overcrow.playervox.com/marketplace/widgets/v1/catalog.json`).
Cette page va d’un dossier de sources à une version listée. Ni une pull
request ni une fusion ne publient quoi que ce soit : la publication est une
étape distincte, hors ligne, des mainteneurs.

## La soumission

Une soumission est un dossier de sources sous `widgets/<dossier>/` de ce
dépôt, dans une pull request vers la branche `candidate` :

```text
widgets/<dir>/
  manifest.json   view.ocml   style.ocss?   logic.ts | logic.js
  locales/en.json + locales/fr.json?   assets/**?   LICENSE
  listing.json    (marketplace text, never packaged)
```

Les IDs sous `com.playervox` sont réservés aux widgets publiés par
PlayerVox. Utilisez un ID en DNS inversé sous un domaine que vous contrôlez,
et gardez-le : l’ID est l’identité du widget dans le catalogue.

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

- `author`, les noms et les descriptions sont du texte brut, sans espaces
  superflus, sans `<` ni `>` ; les locales sont de la forme `xx` ou `xx-YY`,
  l’une d’elles étant `defaultLocale`.
- `spdxLicense` est une expression SPDX ; le `LICENSE` du paquet en contient
  le texte. Les widgets PlayerVox sont sous MIT. La politique pour les
  licences des tiers n’est pas encore arrêtée : une expression valide est
  relue, pas approuvée par les métadonnées ([licensing](../../../LICENSING.md)).
- `sourceUrl` est une URL HTTPS canonique des sources relues, sans port,
  requête ni fragment.
- `preview` (facultatif) désigne un PNG empaqueté sous `assets/`, de
  256 Kio au plus, par exemple `"preview": "assets/preview.png"`.

Les règles exactes sont celles de Listing dans la
[schema reference](../../widget-schema-v1.md#listing).

## L’admission : lancez-la vous-même

```sh
overcrow-widget admit widgets/<dir>
overcrow-widget admit widgets/<dir> --package dist/<id>-<version>.ocpkg
overcrow-widget admit widgets/<dir> --format json
```

`admit` est exactement l’admission statique de la CI de la marketplace. Elle
n’exécute jamais votre code ni `tsc` :

1. elle construit le dossier avec la chaîne de `package` : tous les
   contrôles des sources, du style, de la logique et du paquet, puis le
   lecteur de paquets d’OverCrow lui-même ;
2. avec `--package`, le `view.json` de votre archive doit être, octet pour
   octet, le résultat de la compilation de `view.ocml` (le catalogue livre
   toujours la reconstruction à partir des sources relues) ;
3. elle vérifie les bornes du schéma, les IDs réservés, `listing.json`,
   l’aperçu et, pour les widgets PlayerVox, la licence MIT ;
4. elle liste pour le relecteur l’autorité que demande le widget :
   capabilities sensibles, chaque route réseau, écritures dans le
   presse-papiers, stockage et événements de jeu.

Le rapport se termine avec le statut 1 quand la soumission serait refusée.
Les codes sont listés avec la [commande `admit`](../../cli.md#admit-dir).
Sur une pull request, la CI compile `overcrow-widget` depuis la branche de
base relue, jamais depuis votre révision, et exécute la même admission sur
vos fichiers, traités comme des données ; voir la
[review policy](../../review-policy.md).

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
  [sécurité](security.md).
- **La fiche.** Un texte exact et brut dans chaque langue, une URL de
  sources canonique, un aperçu qui montre le widget.
- **La licence.** `LICENSE` correspond à `spdxLicense`, et chaque ressource,
  police ou code tiers embarqué garde sa mention.

À la fusion, la CI admet de nouveau la révision exacte et enregistre un reçu
qui lie le paquet admis au commit relu. Accepter une soumission ne signe et
ne publie rien.

## Le catalogue

Les mainteneurs préparent le catalogue suivant à partir des révisions
admises et le signent hors ligne avec la clé du catalogue, dont la moitié
publique est dans [`keys/`](../../../keys/). Le catalogue :

- liste chaque version à
  `…/widgets/v1/packages/<id>/<version>/<sha256>.ocpkg`, avec son aperçu à
  `…/widgets/v1/previews/<id>/<version>/<sha256>.png` ; une version publiée
  ne change jamais, et un changement est une nouvelle version ;
- porte une séquence strictement croissante et expire au bout de 90 jours au
  plus : OverCrow refuse une séquence plus ancienne et un catalogue expiré ;
- marque `built-in` les widgets de référence PlayerVox (IDs
  `com.playervox.*` uniquement) : ils sont installés sur un nouveau profil
  avec leurs permissions déclarées accordées, sauf pour une mise à jour qui en
  demande davantage.

OverCrow vérifie la signature, l’empreinte du paquet, son registre de
fichiers et sa vue compilée avant l’installation, puis à chaque démarrage du
widget. Le format est spécifié dans
[package and catalog format](../../widget-package-v1.md).

## Statuts des versions

Chaque version listée a un statut :

| Statut | Signification |
| --- | --- |
| `verified` | Installable. |
| `security-suspended` | Soupçonnée de compromission : ni installée ni proposée en mise à jour, et une copie installée est arrêtée. Réversible dans un catalogue ultérieur. |
| `revoked` | Définitif : plus jamais installée, et une copie installée est arrêtée. |

Retirer une version d’un catalogue ne change jamais son statut. La signature
d’un catalogue ne contourne jamais la validation du paquet, le consentement
de l’utilisateur ni le sandbox.
