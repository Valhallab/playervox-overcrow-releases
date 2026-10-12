# Publier un widget

Dans l’espace créateurs de PlayerVox OverCrow, à l’adresse
`overcrow.playervox.com/creators`, un widget arrive aux joueurs en quatre
étapes : vous envoyez ses sources, elles sont contrôlées automatiquement,
PlayerVox les relit, puis la version est publiée dans le catalogue. Cette
page couvre les deux premières et l’écran qui envoie une version en revue ;
la [revue](widget-review.md) et la [fiche](widget-listing.md) ont leur
propre page.

## Avant d’envoyer

- L’identifiant de votre widget est réservé dans l’espace créateurs
  ([démarrer](creator-space.md)), et `manifest.json` l’utilise.
- `overcrow-widget check` passe dans le dossier du widget.
- La version de `manifest.json` est plus récente que la dernière approuvée :
  `1.2.1` ou plus après `1.2.0`.

## Envoyer les sources

Ouvrez le widget dans **Widgets**, puis **Envoyer une version**.

- Sur un ordinateur, déposez le dossier du widget sur la page, ou
  choisissez-le. Vous pouvez aussi envoyer un `.zip` du dossier.
- Sur un téléphone ou une tablette, qui ne savent pas choisir un dossier,
  choisissez le `.zip`.

L’espace créateurs lit un dossier avec les mêmes règles que
`overcrow-widget submit`, sur votre ordinateur, et envoie les mêmes
fichiers. Il laisse de côté les fichiers et dossiers cachés (`.env`,
`.git/`…), `node_modules/`, `dist/`, `tests/output/`, `__MACOSX/`, les
paquets déjà construits, les fichiers de clés, les fichiers système et les
noms qui ne sont pas en ASCII portable ; la page liste ce qu’il a laissé de
côté. Un `.zip` est envoyé tel quel. Les bornes et les refus sont ceux des
[archives de sources](cli.md#archives-de-sources) : 32 Mio pour l’archive,
64 Mio et 2 000 fichiers une fois décompressé, 16 niveaux de dossiers, des
chemins de 255 octets au plus, aucun nom qui ne diffère d’un autre que par
la casse.

- Un `.zip` fait par Windows PowerShell 5.1 (`Compress-Archive`) sépare les
  dossiers par `\` et est refusé aussitôt : déposez plutôt le dossier.
- Un navigateur lit le fichier vers lequel pointe un lien, là où l’outil en
  ligne de commande laisse le lien de côté. Gardez les liens hors du dossier
  du widget.
- Vos sources restent privées : seuls les relecteurs PlayerVox les lisent,
  et chaque consultation apparaît dans l’espace créateurs.

Un éditeur fait au plus 20 envois en 24 heures ; la page dit quand le
suivant est possible. Si la page se ferme ou si la connexion se coupe
pendant l’envoi, déposez à nouveau le même dossier : l’envoi reprend, et
rien n’est compté deux fois.

## Les contrôles

Les contrôles prennent environ une minute : le manifeste, le numéro de
version, le code, la construction du paquet, les permissions, la taille.
Vous pouvez quitter la page : un e-mail vous prévient quand ils sont finis.

- Quand un contrôle échoue, chaque problème est montré dans vos propres
  fichiers, avec la ligne et la correction. Corrigez et envoyez à nouveau ;
  rien n’arrive aux relecteurs.
- « Problème de notre côté » signifie que PlayerVox n’a pas pu faire les
  contrôles : votre code n’est pas en cause. PlayerVox est prévenu et les
  relance.

## Soumettre pour revue

Quand les contrôles passent, la page de la version dit ce qui change pour
les joueurs :

- **Permissions.** Expliquez pourquoi le widget a besoin de chaque
  permission nouvelle ou élargie, avec des mots que les joueurs comprennent.
  Une première version les explique toutes.
- **Politique de confidentialité.** Obligatoire dès que le widget utilise
  le réseau. L’adresse tapée ici est aussi enregistrée dans la fiche.
- **Fiche.** Une première version part en revue avec sa fiche, qui demande
  une description en anglais, une licence et un contact d’assistance.
- **Notes de version**, visibles par les joueurs : facultatives. L’anglais
  vient d’abord ; **Ajouter une langue** en ajoute d’autres, 16 au plus. Dès
  que vous en écrivez, écrivez-les aussi en anglais.
- **Message pour la revue**, lu seulement par PlayerVox : un compte de test,
  un contexte utile.

La page dit aussi quelle revue la version reçoit (rapide ou complète) et ce
qui a changé depuis la dernière version approuvée. **Soumettre pour revue**
l’envoie.

## Depuis un terminal ou une CI

`overcrow-widget submit` envoie une version avec une clé de publication, et
s’arrête au même écran quand il manque quelque chose : voir
[`submit`](cli.md#submit) et [clés de publication et CI](publish-keys.md).

## Après la revue

Une version approuvée est publiée sous 24 heures ouvrées. Dans l’espace
créateurs, vous pouvez ensuite la retirer, ou retirer le widget entier
(**Réglages**) : il sort du catalogue à la prochaine publication, et les
copies installées continuent de fonctionner.
