# Fiche : bonnes pratiques

La fiche est ce que les joueurs lisent dans le catalogue de PlayerVox
OverCrow avant d’installer un widget : sa description, son aperçu, sa
catégorie, ses jeux, sa licence et ses liens. Vous l’écrivez dans l’espace
créateurs, dans l’onglet **Fiche** du widget.

## Enregistrée au fil de la saisie

La fiche est un brouillon, enregistré tout seul pendant que vous écrivez.

- La première fiche d’un widget part en revue avec sa première version.
- Les modifications suivantes partent seules en revue rapide :
  **Soumettre la fiche**. Elles ne demandent pas de nouvelle version du
  widget. **Annuler les modifications** ramène le brouillon à la fiche
  publiée.
- La catégorie fait exception : vous la changez quand vous voulez, sans
  revue, et le changement arrive aux joueurs avec la prochaine publication
  du catalogue.

## Langues

L’anglais vient en premier : c’est la langue par défaut, montrée quand la
langue d’un joueur n’a pas de description. **Ajouter une langue** en ajoute
une autre, 16 langues au plus. Le nom du widget vient de son manifeste
(`name.en`, `name.fr`) : pour le changer, changez le manifeste et envoyez une
version. Les langues de l’interface du widget viennent de ses fichiers
`locales/`.

## Description

- 500 caractères au plus par langue. Les deux premières lignes apparaissent
  sur la carte du catalogue : dites simplement ce que fait le widget.
- Dites quand le widget contacte un serveur, et lequel.
- Pas de publicité, et aucune promesse que le widget ne tient pas.

## Image d’aperçu

Une seule image, en anglais, pour toutes les langues : un PNG au format 4:3,
de 480 × 360 à 1 024 × 768 (1 024 × 768 conseillé), 256 Kio au plus.
Montrez le widget en situation, sans texte marketing.

## Catégorie et jeux

La catégorie place le widget dans le catalogue. Ajoutez jusqu’à cinq jeux
pour lesquels il est fait : les joueurs filtrent le catalogue par jeu.

## Licence et liens

- **Licence** : « Propriétaire, tous droits réservés », ou une licence SPDX
  comme `MIT` ou `Apache-2.0`.
- **Assistance** : une adresse e-mail ou une page web où les joueurs
  trouvent de l’aide. Obligatoire.
- **Politique de confidentialité** : obligatoire dès que le widget utilise
  le réseau.
- **Code source public** : facultatif ; un dépôt public ajoute le badge
  « Code source public ».

Tapez une adresse comme vous la connaissez (`exemple.com/confidentialite`) :
`https://` est ajouté pour vous, et un `/` après un domaine seul
(`exemple.com` est enregistré `https://exemple.com/`). Une adresse en
`http://` est refusée.

## Depuis listing.json

Les sources d’une version peuvent contenir un `listing.json`, tel que
l’outil en ligne de commande le lit (voir [`admit`](cli.md#admit)). Dans
l’onglet **Fiche**, **Importer listing.json** applique ses descriptions, sa
licence et l’adresse de son code source au brouillon.
