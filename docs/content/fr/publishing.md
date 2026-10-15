# Vérifications et catalogue

Les widgets atteignent les utilisateurs de PlayerVox OverCrow par le
catalogue signé des widgets : OverCrow n’installe que ce que liste ce
catalogue. Vous envoyez une version depuis l’espace créateurs
([publier un widget](publish-a-widget.md)), elle est vérifiée, une personne
de PlayerVox la relit ([la revue](widget-review.md)), puis elle est publiée
dans le catalogue. Cette page couvre les vérifications que vous pouvez
lancer sur votre ordinateur, `listing.json` et le catalogue lui-même.

## Lancer les vérifications vous-même

```sh
overcrow-widget admit --listing optional
overcrow-widget admit --package dist/<id>-<version>.ocpkg
overcrow-widget admit --format json
```

`admit` lance sur votre ordinateur les vérifications statiques de l’espace
créateurs. Elle n’exécute jamais votre code ni `tsc` :

1. elle construit le dossier comme le fait `package` : toutes les
   vérifications des sources, du style, de la logique et du paquet, puis le
   lecteur de paquets de PlayerVox OverCrow lui-même ;
2. avec `--package`, la vue compilée de votre archive doit être, octet pour
   octet, le résultat de la compilation de `view.ocml` ;
3. elle vérifie les limites du schéma, les IDs réservés, `listing.json`,
   l’aperçu et, pour les widgets PlayerVox, la licence MIT ;
4. elle liste l’autorité que demande le widget, comme la voit le
   relecteur : capabilities sensibles, chaque route réseau, écritures dans
   le presse-papiers, stockage et événements de jeu.

`--listing optional` vérifie le dossier comme le fait l’espace créateurs,
où `listing.json` peut manquer. La commande se termine avec le code de
sortie 1 quand la version serait refusée ; ses codes sont listés avec la
[commande `admit`](cli.md#admit). Pour vérifier aussi ce que seul l’espace
créateurs connaît (le numéro de version, les justifications, la politique
de confidentialité), utilisez `overcrow-widget submit --dry-run`
([`submit`](cli.md#submit)).

## La fiche

Les joueurs lisent la fiche dans le catalogue. Vous l’écrivez dans l’espace
créateurs ([la fiche](widget-listing.md)). `listing.json`, dans le dossier
du widget, en est la forme fichier : `admit` le lit, l’espace créateurs peut
l’importer, et il n’est jamais empaqueté.

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
- `spdxLicense` est une expression SPDX, ou `LicenseRef-Proprietary` pour
  un code qui n’est pas open source ; le `LICENSE` du paquet en contient le
  texte. Toute licence est acceptée, code fermé compris. Les widgets de
  PlayerVox sont sous MIT.
- `sourceUrl` est une URL HTTPS canonique de vos sources publiques, sans
  port, requête ni fragment. Le fichier l’exige, pas l’espace créateurs :
  si votre code n’est pas public, laissez `listing.json` de côté et écrivez
  la fiche à l’écran.
- `preview` (facultatif) désigne un PNG empaqueté sous `assets/`, de
  256 Kio au plus, par exemple `"preview": "assets/preview.png"`. Le
  Centre de contrôle et la marketplace montrent un aperçu entier dans un
  cadre 4:3, centré sur la couleur `#1e242e`, à 1,5 pixel par point d’écran
  au plus : rendez le widget à 150 % (`"scale": 1500` dans un scénario) et
  donnez à l’image un format 4:3, il apparaît à sa taille réelle, jamais
  recadré ni agrandi.

## Le catalogue

PlayerVox vise à publier une version approuvée sous 24 heures ouvrées. Il
signe chaque catalogue hors de ses serveurs avec la clé du catalogue, dont la
moitié publique est dans [`keys/`](../../../keys/). Le catalogue :

- liste chaque version avec le SHA-256 et la taille de son paquet ; une
  version publiée ne change jamais, et un changement est une nouvelle
  version ;
- porte un numéro de séquence strictement croissant et expire au bout de
  90 jours au plus : PlayerVox OverCrow refuse une séquence plus ancienne et
  un catalogue expiré ;
- marque `built-in` les widgets de référence PlayerVox (IDs
  `com.playervox.*` uniquement) : ils sont installés sur un nouveau profil
  avec leurs permissions déclarées accordées, sauf pour une mise à jour qui
  en demande davantage.

Le paquet du catalogue est toujours celui que PlayerVox a reconstruit à
partir des sources relues. PlayerVox OverCrow vérifie la signature,
l’empreinte du paquet, son registre et sa vue compilée avant
l’installation, puis à chaque démarrage du widget. Voir
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
consentement de l’utilisateur ni le sandbox. Une suspension dans l’espace
créateurs est expliquée dans [la revue](widget-review.md#suspension).
