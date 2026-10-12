# Statistiques : définitions

L’onglet **Statistiques** d’un widget, dans l’espace créateurs, montre comment
les joueurs l’utilisent : installations, joueurs actifs par jour, erreurs et
note des joueurs. PlayerVox OverCrow envoie ces chiffres de façon anonyme. Ce
sont des tendances, pas des comptes exacts : cette page dit ce que compte
chaque chiffre et ce qu’il laisse de côté.

## D’où viennent les chiffres

Une fois par jour au plus, à un moment tiré au hasard, OverCrow envoie un
signal anonyme pour chaque widget installé depuis le catalogue : le widget,
sa version, le jour, le système (Windows ou Linux), la version d’OverCrow, si
le widget a été affiché, installé ou désinstallé ce jour-là, et ses erreurs
(type, endroit du code, nombre arrondi).

- **Aucun identifiant** : rien ne désigne le joueur ni l’ordinateur, et rien
  ne relie les widgets d’un même joueur, chaque widget étant envoyé à part.
- **Aucun message d’erreur** : seulement le type d’une erreur et son endroit
  dans votre code. Un message peut contenir des données personnelles.
- **Activé par défaut** : les joueurs peuvent couper **Partager des
  statistiques anonymes** dans OverCrow ; plus rien n’est envoyé ensuite, et
  ils ne sont plus comptés.

Les chiffres s’additionnent à l’arrivée des signaux. **Mis à jour** donne
l’heure du dernier signal compté.

## Les chiffres

| Chiffre | Ce qu’il compte |
| --- | --- |
| Joueurs actifs par jour | Les joueurs qui ont affiché le widget au moins une fois dans la journée. La tuile donne la moyenne par jour sur la période. |
| Installations actives | Les installations moins les désinstallations, additionnées depuis le premier signal, jamais sous zéro. |
| Installations · désinstallations | Les installations et les désinstallations de la période, et leur solde. Une mise à jour n’est ni l’une ni l’autre. |
| Erreurs | La somme des erreurs signalées sur la période. |

Chaque tuile compare son chiffre à la période juste avant, de même durée :
vert quand il évolue dans le bon sens (moins d’erreurs, plus de joueurs),
ambre dans l’autre sens, gris quand il bouge de moins de 1 %. **Première
période** signifie qu’il n’y a rien avant pour comparer.

## Périodes et filtres

- **Période** : 7 jours, 28 jours, 90 jours ou 12 mois. Sur 12 mois, le
  graphique des installations et désinstallations additionne chaque semaine.
- **Version** : une de vos versions publiées. Les installations actives
  affichent « — » avec une version : une installation change de version à
  chaque mise à jour, ce chiffre n’a donc de sens que pour toutes les
  versions. **Adoption des versions** compare les versions et ne suit pas ce
  filtre.
- **Système** : Windows ou Linux. **Où tourne votre widget** compare les
  systèmes et ne suit pas ce filtre.
- La note ne suit aucun filtre.

Chaque graphique a **Voir en tableau**, avec les mêmes chiffres jour par
jour.

## Adoption des versions et où tourne votre widget

- **Adoption des versions** : la part des joueurs actifs du jour sur chaque
  version. Les trois versions les plus récentes gardent leur couleur ; les
  autres s’additionnent dans **Plus anciennes**.
- **Où tourne votre widget** : la part des joueurs actifs sous Windows et
  sous Linux, et sur chaque version d’OverCrow (les deux plus utilisées, puis
  **Autres**).

## Erreurs

Les erreurs sont regroupées par type et par endroit du code : le même type à
la même ligne de la même fonction forme un groupe, quelle que soit la
version. Le tableau montre les 50 groupes les plus fréquents de la période,
avec leurs versions, leur nombre et leur tendance ; **Exporter CSV** les
enregistre.

OverCrow signale où une erreur s’est produite dans le `logic.js` du paquet.
L’espace créateurs retrouve cette position dans vos sources (fichier, ligne
et fonction) grâce à une carte de votre code construite avec le paquet et
jamais publiée.

- **Retraduction en cours** : la position s’affiche en
  `logic.js:ligne:colonne` jusqu’à ce qu’elle soit retrouvée.
- **Non retrouvée** : la version n’a pas de carte, ou la position n’y figure
  pas ; la position brute reste.
- **Sans position dans le code** : le widget s’est arrêté tout entier
  (budget dépassé, plus de réponse) ; voyez son type.
- **SDK** : l’erreur s’est produite dans `@overcrow/sdk`, appelé depuis votre
  code.

| Type | Signification |
| --- | --- |
| `Error` | Erreur levée |
| `TypeError` | Valeur d’un type inattendu |
| `RangeError` | Valeur hors limites |
| `ReferenceError` | Nom inconnu |
| `SyntaxError` | Syntaxe invalide |
| `URIError` | Encodage d’adresse invalide |
| `EvalError` | Évaluation de code refusée |
| `AggregateError` | Plusieurs erreurs à la fois |
| `InternalError` | Limite du moteur atteinte |
| Valeur levée | Une valeur qui n’est pas une erreur a été levée |
| Budget mémoire ou de calcul dépassé | Le widget a été redémarré |
| Ne répondait plus | Le widget a été redémarré |
| Échec du chargement | Le code ou la vue n’a pas pu se charger |
| Processus du widget arrêté | Sans erreur signalée |
| Requête réseau refusée | Adresse non déclarée dans le manifeste |
| Autre erreur | D’un type que l’espace créateurs ne connaît pas encore |

Le type d’une erreur est le type intégré dont elle a été créée, jamais le
`name` que votre code peut lui donner.

## Note des joueurs

Les joueurs notent un widget de 0 à 100 dans le Centre de contrôle
d’OverCrow, avec leur compte PlayerVox : une note par compte et par widget,
qu’ils peuvent modifier ou retirer.

- **Score** : la moyenne des notes, arrondie, avec son rang : S+ dès 90, S
  dès 80, A dès 70, B dès 60, C dès 40, D dès 20, puis F.
- **À partir de 5 notes** : en dessous, l’espace créateurs indique **Pas
  encore assez de notes** et donne le nombre de notes ; le catalogue
  n’affiche rien.
- **Répartition par rang** : le nombre de notes dans chaque rang, visible
  seulement dans l’espace créateurs. Personne ne voit qui a noté.
- **Depuis la dernière version** : les points gagnés ou perdus depuis la
  publication de votre dernière version, si 5 notes existaient avant elle.
- Les membres de votre éditeur ne peuvent pas noter ses widgets.

Les joueurs voient le score, le rang et le nombre de notes dans le catalogue
et sur le site.

## Des tendances, pas des comptes exacts

- Seuls les joueurs qui partagent leurs statistiques anonymes sont comptés.
- OverCrow arrondit chaque nombre d’erreurs à un palier avant de l’envoyer,
  et envoie au plus 10 endroits du code par widget et par jour : les chiffres
  des erreurs donnent des ordres de grandeur.
- Un jour est la date du joueur lui-même.
- Un joueur qui efface les données d’OverCrow, puis réinstalle le widget,
  compte pour deux installations.
- Les signaux qui semblent cassés ou gonflés sont écartés avant d’être
  comptés.
