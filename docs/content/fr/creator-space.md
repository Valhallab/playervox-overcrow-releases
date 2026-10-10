# Démarrer dans l’espace créateurs

L’espace créateurs de PlayerVox OverCrow, à l’adresse
`overcrow.playervox.com/creators`, sert à publier des widgets : vous y créez votre éditeur une fois, réservez les
identifiants de vos widgets, envoyez leurs versions et suivez leur revue. Il
est ouvert sur invitation pour l’instant.

## Se connecter

Connectez-vous avec votre compte PlayerVox : l’espace créateurs vous envoie
sur playervox.com, qui vous demande de confirmer, puis vous ramène. Vous ne
tapez jamais votre mot de passe dans l’espace créateurs. La session dure tant
que vous l’utilisez, 14 jours au plus ; vous pouvez la fermer sur
playervox.com, dans **Appareils connectés**.

L’interface est en français ou en anglais : choisissez dans le menu du
compte. Les adresses restent les mêmes dans les deux langues.

## Activer la double authentification

Publier exige la double authentification sur votre compte. La première
visite l’active :

1. Ouvrez une application d’authentification (Aegis, 2FAS, Google
   Authenticator, 1Password…).
2. Scannez le QR code sur un ordinateur, ou touchez **Ajouter à mon
   application** sur un téléphone ou une tablette. Vous pouvez aussi saisir
   la clé à la main.
3. Entrez le code à 6 chiffres affiché par l’application.

Vous recevez ensuite dix codes de secours, affichés une seule fois : chacun
vous connecte une fois si vous perdez votre téléphone. Rangez-les en lieu
sûr. Créer une clé de publication ou supprimer votre éditeur redemande un
code récent.

## Créer votre éditeur

L’éditeur est le nom sous lequel vos widgets apparaissent.

- **Nom affiché** : montré aux joueurs. Un nom qui se lit comme PlayerVox,
  OverCrow ou Valhallab est refusé.
- **Identifiant** : de 3 à 32 lettres minuscules, chiffres et tirets, sans
  tiret au début ni à la fin. Il est **définitif** : il ne peut plus être
  changé, et un identifiant n’est jamais donné à quelqu’un d’autre, même
  après une suppression. Les identifiants de vos widgets commencent par lui.
- **E-mail de contact** : pour que PlayerVox vous joigne. Il n’est jamais
  affiché.
- **Site web** et **logo** (carré, PNG ou WebP) : facultatifs, affichés sur
  votre page éditeur.

Votre profil public (nom, présentation, site, logo) paraît avec la prochaine
publication du catalogue : d’ici là, l’espace créateurs indique **Visible
après la prochaine publication**.

Lisez ensuite l’accord créateur, résumé en six points à l’écran, et
acceptez-le. Votre espace est prêt.

## Réserver l’identifiant de votre premier widget

L’identifiant d’un widget s’écrit `<identifiant>.<nom>` : `nova.lol-timers`
pour l’identifiant `nova`. Avec un [domaine vérifié](verified-domain.md), il
peut aussi commencer par votre domaine inversé : `gg.nova.lol-timers` pour
`nova.gg`. Le nom s’écrit en lettres minuscules, chiffres et tirets. Un
identifiant est définitif et ne ressert jamais.

Dans **Widgets**, **Nouveau widget** réserve l’identifiant. Créez le projet
avec le même identifiant :

```sh
overcrow-widget init lol-timers --id nova.lol-timers
```

Essayez-le dans votre jeu avec le [canal de développement](dev-channel.md) :
rien n’est publié.

## Ensuite

- Envoyer une version : [publication et revue](publishing.md).
- Envoyer depuis un terminal ou une CI :
  [clés de publication et CI](publish-keys.md).
- Obtenir le badge vérifié et des identifiants à votre domaine :
  [domaine vérifié](verified-domain.md).
