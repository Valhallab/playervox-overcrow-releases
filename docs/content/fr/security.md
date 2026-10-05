# Sécurité

PlayerVox OverCrow traite chaque widget comme du code non fiable, widgets
intégrés PlayerVox compris : les mêmes vérifications du paquet, le même sandbox, les
mêmes permissions et le même consentement s’appliquent à un widget
PlayerVox et au vôtre. Cette page décrit ce que cela implique pour l’auteur
d’un widget.

## Le sandbox

Chaque widget tourne derrière deux barrières.

1. **La VM.** Votre `logic.js` s’exécute dans sa propre machine virtuelle
   QuickJS, avec un tas plafonné, un budget de temps par tour, une pile et
   des files limitées. Il n’y a ni `eval`, ni constructeur `Function`, ni
   chargeur de modules, ni `WebAssembly`, ni mémoire partagée ; la seule
   globale en plus d’ECMAScript est le SDK, figé. L’heure locale est UTC :
   le SDK applique pour vous le décalage de l’utilisateur.
2. **Le processus.** Chaque VM tourne dans son propre processus du système,
   qui n’a besoin ni d’affichage, ni de GPU, ni de réseau, ni de fichiers :
   son sandbox les lui retire tous. Sous Linux, des namespaces Bubblewrap,
   une liste blanche seccomp qui tue le processus à toute tentative
   d’ouvrir un fichier, un socket ou un autre processus, et un cgroup par
   widget. Sous Windows, un AppContainer « Less Privileged » sans
   capability, un Job Object par widget, et des mitigations de processus
   qui interdisent le code dynamique et le système de fenêtres.

OverCrow dessine tout lui-même : la VM envoie une description de la vue,
jamais de pixels, et n’exécute jamais de code dans le processus d’OverCrow.
Le survol, le focus, l’état pressé et les transitions sont résolus par
OverCrow : un widget n’observe pas les mouvements du pointeur qu’il n’a pas
demandés par un événement.

Un dépassement de budget n’arrête que ce widget. OverCrow affiche une
erreur fixe dans son cadre et le relance après 1, 5 puis 15 secondes, trois
fois au plus ; une erreur de paquet ou de protocole attend que
l’utilisateur le réactive. Les chiffres figurent dans les
[limites](limits.md#logique).

## Permissions et consentement

Un widget n’obtient rien qu’il n’ait déclaré dans `manifest.json`, et une
déclaration n’accorde rien à elle seule. À l’installation du widget, le
Centre de contrôle propose chaque permission cochée, et l’utilisateur peut
en décocher. Ensuite, l’utilisateur autorise ou retire chaque permission
dans le Centre de contrôle ; en retirer une redémarre le widget sans elle.
OverCrow vérifie de nouveau la permission à chaque appel
d’un service.

Quatre permissions ouvrent les services généraux : `network` (des routes
HTTPS exactes, par le broker d’OverCrow), `storage` (un stockage clé-valeur
pour ce seul widget), `clipboardWrite` (l’écriture de texte, pendant une
action de l’utilisateur) et `gameEvents` (des événements de jeu nommés).

Les capabilities donnent accès à des données et à des actions d’OverCrow et
des comptes de l’utilisateur. Une capability **sensible** révèle des
données personnelles ou le jeu en cours : un widget qui en déclare une ne
peut pas déclarer aussi `network` ni `clipboardWrite`, et son stockage ne
dure que le temps de son processus, pour que ces données ne puissent pas
quitter la machine par le widget.

Les connexions aux comptes (PlayerVox, Twitch) appartiennent à OverCrow :
la connexion, les codes et les jetons sont affichés et conservés par
OverCrow, et un widget ne reçoit que les données que décrit sa capability.

Chaque permission, chaque capability et les services qu’elle ouvre sont
décrits dans [services et permissions](services.md). Déclarez le strict
nécessaire : les relecteurs lisent chaque permission et chaque route, et
les utilisateurs les voient avant de donner leur accord. Les widgets
marqués `built-in` dans le catalogue signé (widgets PlayerVox uniquement)
démarrent avec leurs permissions déclarées accordées ; une mise à jour qui
en demande davantage exige l’accord de l’utilisateur, widgets intégrés
PlayerVox compris.

## Actions de l’utilisateur

Les services qui changent quelque chose pour l’utilisateur ne peuvent être
appelés que pendant que la logique traite une vraie action de l’utilisateur
dans le widget : un clic, une touche, une modification, la validation d’un
formulaire. Un appel depuis un minuteur, une réponse de service ou une
ligne du menu d’options est refusé avec `gesture_required`. Les widgets ne
reçoivent d’entrées qu’en mode interactif d’OverCrow ; en mode passif, les
clics les traversent. Supprimer une note ou une session du journal demande
aussi une confirmation à l’utilisateur, dans une boîte de dialogue dessinée
par OverCrow. Voir
[les appels qui demandent une action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).

Ce que l’utilisateur écrit dans ses notes, dans un avis PlayerVox et dans
le chat ne passe jamais par votre logique : un `form` doté d’un `intent` envoie les
valeurs de ses propres champs de texte et curseurs, qu’OverCrow remplit,
modifie et valide lui-même. Votre logique peut les lire, pas les écrire.
Voir
[les formulaires qui écrivent des données de l’utilisateur](forms.md#les-formulaires-qui-écrivent-des-données-de-lutilisateur).

## Ce qu’un widget ne peut pas faire

- Lire ou écrire des fichiers, ouvrir des sockets, joindre le réseau local
  ou une adresse que son manifeste ne déclare pas.
- Lancer des processus, charger du code natif, compiler du code à
  l’exécution ou télécharger du code : le seul code est le `logic.js` relu
  du paquet.
- Voir les autres widgets, leur état, leur stockage ou leurs permissions,
  ni la mémoire, la fenêtre ou les entrées du jeu. OverCrow ne s’injecte
  jamais dans le jeu.
- Dessiner hors de son cadre, couvrir ou imiter le cadre, les menus ou les
  confirmations d’OverCrow.
- Lire des jetons de compte, des cookies ou des identifiants.
- Lire le presse-papiers.
- Écrire des journaux en production : la sortie de `log.*` n’apparaît que
  dans une session de développement locale.
- S’accorder une permission, ou utiliser une ligne de menu comme action de
  l’utilisateur.

## Ce qu’OverCrow vérifie

Chaque paquet est vérifié lors de son admission au catalogue, puis chaque
fois qu’OverCrow le démarre : le catalogue signé, le registre de ses
fichiers et la vue compilée doivent concorder, sinon le widget ne démarre
pas. Voir [le paquet](package.md#comment-overcrow-vérifie-un-paquet) et
[publication et revue](publishing.md).

Une version du catalogue peut être suspendue ou révoquée après sa
publication : OverCrow arrête alors la copie installée. Voir
[statuts des versions](publishing.md#statuts-des-versions).

## Signaler une vulnérabilité

Signalez les vulnérabilités en privé, comme le décrit la
[politique de sécurité](../../../SECURITY.md) du dépôt.
