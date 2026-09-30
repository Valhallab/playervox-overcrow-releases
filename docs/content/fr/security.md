# Sécurité

OverCrow traite chaque widget comme du code non fiable, widgets intégrés
compris : les mêmes contrôles de paquet, le même sandbox, les mêmes
permissions et le même consentement s’appliquent à un widget PlayerVox et au
vôtre. Cette page décrit ce que cela implique pour l’auteur d’un widget. Les
bornes chiffrées figurent dans la [schema reference](../../widget-schema-v1.md#limits).

## Le sandbox

Chaque widget tourne derrière deux barrières.

1. **La VM.** Votre `logic.js` s’exécute dans sa propre machine virtuelle
   QuickJS, avec un plafond de mémoire, un budget de temps par tour, une pile
   et des files bornées. Il n’y a ni `eval`, ni constructeur `Function`, ni
   chargeur de modules, ni `WebAssembly`, ni mémoire partagée ; la seule
   globale en plus d’ECMAScript est le SDK, figé. L’heure locale est UTC : le
   SDK applique pour vous le décalage de l’utilisateur.
2. **Le processus.** Chaque VM tourne dans son propre processus du système,
   qui n’a besoin ni d’affichage, ni de GPU, ni de réseau, ni de fichiers :
   son sandbox les lui retire tous. Sous Linux, des namespaces Bubblewrap, une
   liste blanche seccomp qui tue le processus à toute tentative d’ouvrir un
   fichier, un socket ou un autre processus, et un cgroup par widget. Sous
   Windows, un AppContainer « Less Privileged » sans capability, un Job
   Object par widget, et des mitigations qui interdisent le code dynamique et
   le système de fenêtres.

OverCrow dessine tout lui-même : la VM envoie une description de la vue,
jamais de pixels, et n’exécute jamais de code dans le processus d’OverCrow.
Le survol, le focus, l’état pressé et les transitions sont résolus par
OverCrow : un widget n’observe pas les mouvements du pointeur qu’il n’a pas
demandés par un événement.

Un dépassement de budget n’arrête que ce widget. OverCrow affiche une erreur
fixe dans son cadre et le relance après 1, 5 puis 15 secondes, trois fois au
plus ; une erreur de paquet ou de protocole attend que l’utilisateur le
réactive.

## Permissions et consentement

Un widget n’obtient rien qu’il n’ait déclaré dans `manifest.json`, et une
déclaration n’accorde rien à elle seule : OverCrow demande à l’utilisateur,
qui peut refuser ou retirer une permission à tout moment. Le retrait arrête
d’abord le widget. Vérifiez `hasGrant(capability)` dans votre logique et
affichez un état utile quand une capability manque.

Permissions :

<!-- generated:permissions -->
| Permission | Services | Sur un geste |
| --- | --- | --- |
| `network` | `http.fetch` | — |
| `storage` | `storage.get`, `storage.set`, `storage.remove`, `storage.keys` | — |
| `clipboardWrite` | — | `clipboard.writeText` |
| `gameEvents` | `gameEvents.subscribe` | — |
<!-- /generated:permissions -->

- **`network`** liste des routes exactes : une origine HTTPS, une méthode et
  un chemin complet par règle, avec des paramètres de chemin et de requête
  typés. La requête sort par le broker d’OverCrow, qui refuse tout le reste,
  ne suit aucune redirection, n’envoie ni cookie ni identifiant, refuse les
  adresses locales et privées, et borne la taille et la durée de chaque
  échange. Une réponse fait au plus 1 Mio, sauf si la règle déclare un
  `maxResponseBytes` plus grand (jusqu’à 3 Mio) : cette borne apparaît à la
  revue et dans le panneau des permissions. Les requêtes en cours partagent
  un budget d’octets par widget et pour tous les widgets : une borne plus
  grande n’élève jamais le pire cas d’OverCrow.
- **`storage`** est un stockage clé-valeur tenu par OverCrow pour votre seul
  widget, dans un quota. Il n’y a aucun accès aux fichiers.
- **`clipboardWrite`** écrit du texte, seulement pendant que l’utilisateur
  interagit avec le widget.
- **`gameEvents`** transmet les événements de jeu nommés que vous déclarez.

Les capabilities donnent accès à des données et à des actions d’OverCrow et
des comptes de l’utilisateur. Une capability **sensible** révèle des données
personnelles ou le jeu en cours : un widget qui en déclare une ne peut pas
déclarer aussi `network` ni `clipboardWrite`, et son stockage ne dure que le
temps de son processus, pour que ces données ne puissent pas quitter la
machine par le widget.

<!-- generated:capabilities -->
| Capability | Sensible | Services | Sur un geste |
| --- | --- | --- | --- |
| `telemetry.read` | non | `telemetry.subscribe` | — |
| `fps.read` | non | `fps.subscribe` | — |
| `media.read` | **oui** | `media.subscribe` | — |
| `media.control` | **oui** | — | `media.previous`, `media.playPause`, `media.next` |
| `session.read` | non | `session.subscribe` | — |
| `stopwatch.read` | non | `stopwatch.subscribe` | — |
| `stopwatch.control` | non | — | `stopwatch.toggle`, `stopwatch.reset` |
| `notes.read` | **oui** | `notes.subscribe` | — |
| `notes.write` | **oui** | — | `notes.create`, `notes.select`, `notes.setItem`, `notes.delete` |
| `playervox.score.read` | **oui** | `playervox.score.subscribe` | — |
| `playervox.rating.read` | **oui** | `playervox.rating.subscribe` | — |
| `playervox.rating.write` | **oui** | aucun (intent lié à l’hôte) | — |
| `playervox.reviews.read` | **oui** | `playervox.reviews.page` | — |
| `journal.read` | **oui** | `journal.page` | — |
| `journal.delete` | **oui** | — | `journal.delete` |
| `twitch.chat.read` | **oui** | `twitch.chat.subscribe` | `twitch.chat.join`, `twitch.chat.leave`, `twitch.chat.favorite` |
| `twitch.chat.compose` | **oui** | aucun (intent lié à l’hôte) | — |
<!-- /generated:capabilities -->

Les connexions aux comptes (PlayerVox, Twitch) appartiennent à OverCrow : la
connexion, les codes et les jetons sont affichés et conservés par OverCrow,
et un widget ne reçoit que les données que décrit sa capability.

Déclarez le strict nécessaire : les relecteurs lisent chaque permission et
chaque route, et les utilisateurs les voient avant de donner leur accord. Les
widgets marqués `built-in` dans le catalogue signé (widgets PlayerVox
uniquement) démarrent avec leurs permissions déclarées accordées ; une mise à
jour qui en demande davantage exige l’accord de l’utilisateur, widgets
intégrés compris.

## Gestes

Les actions qui changent quelque chose pour l’utilisateur exigent un vrai
geste : le service doit être appelé pendant le traitement de l’un de ces
événements :

<!-- generated:gesture-events -->
`activate`, `contextmenu`, `keydown`, `input`, `change`, `submit`.
<!-- /generated:gesture-events -->

Un appel depuis un minuteur, une réponse de service ou une ligne du menu du
widget est refusé avec `gesture_required`. Les widgets ne reçoivent d’entrées
qu’en mode interactif d’OverCrow ; en mode passif, les clics les traversent.
Supprimer une note ou une session du journal demande aussi une confirmation
dans une fenêtre dessinée par OverCrow.

Le texte que l’utilisateur écrit dans les notes, les avis et le chat ne
passe jamais par votre logique : un `form` doté d’un `intent` envoie le texte
de ses propres champs, qu’OverCrow édite et soumet lui-même.

## Ce qu’un widget ne peut pas faire

- Lire ou écrire des fichiers, ouvrir des sockets, joindre le réseau local ou
  une adresse que son manifeste ne déclare pas.
- Lancer des processus, charger du code natif, compiler du code à
  l’exécution ou télécharger du code : le seul code est le `logic.js` relu
  du paquet.
- Voir les autres widgets, leur état, leur stockage ou leurs permissions, ni
  la mémoire, la fenêtre ou les entrées du jeu. OverCrow ne s’injecte jamais
  dans le jeu.
- Dessiner hors de son cadre, couvrir ou imiter le cadre, les menus, le
  panneau des permissions ou les confirmations d’OverCrow.
- Lire des jetons de compte, des cookies ou des identifiants.
- Écrire des journaux en production : la sortie de `log.*` n’apparaît que
  dans une session de développement locale.
- S’accorder une permission, ou utiliser une ligne de menu comme geste.

Chaque paquet est vérifié lors de son admission au catalogue, puis à chaque
démarrage par OverCrow : le catalogue signé, le registre des fichiers et la
vue compilée doivent concorder, sinon le widget ne démarre pas. Voir
[publication et revue](publishing.md).

## Signaler une vulnérabilité

Signalez les vulnérabilités en privé, comme le décrit la
[politique de sécurité](../../../SECURITY.md) du dépôt.
