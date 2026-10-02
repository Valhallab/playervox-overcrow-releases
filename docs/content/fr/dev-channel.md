# Le canal de développement

`overcrow-widget dev` affiche votre widget dans l’overlay PlayerVox OverCrow
qui tourne sur votre machine, par-dessus votre jeu, et le recharge chaque
fois que vous enregistrez un fichier. La commande joint l’overlay par le
**canal de développement**, qu’OverCrow n’ouvre que si vous le demandez.

```sh
overcrow-widget doctor
overcrow-widget dev
```

`doctor` indique si un overlay en cours d’exécution propose le canal ; `dev`
construit ensuite le widget, l’envoie et reste au premier plan jusqu’à
Ctrl+C.

## L’activer

Le canal n’existe que tant qu’OverCrow s’exécute avec les installations de
développement autorisées, c’est-à-dire lancé avec la variable
d’environnement `OVERCROW_WIDGET_DEVELOPMENT=1`. Sans elle, l’overlay
n’ouvre rien.

**Linux.** Définissez la variable pour les services de votre session, puis
redémarrez l’overlay :

```sh
systemctl --user set-environment OVERCROW_WIDGET_DEVELOPMENT=1
systemctl --user restart overcrow-overlay.service
```

Pour désactiver le canal, supprimez la variable et redémarrez de nouveau
(ou fermez votre session) :

```sh
systemctl --user unset-environment OVERCROW_WIDGET_DEVELOPMENT
systemctl --user restart overcrow-overlay.service
```

**Windows.** Quittez OverCrow depuis son icône de la zone de notification,
puis lancez-le depuis PowerShell :

```text
$env:OVERCROW_WIDGET_DEVELOPMENT='1'; & "$env:LOCALAPPDATA\Programs\OverCrow\OverCrow.exe"
```

`overcrow-widget doctor` affiche ces commandes quand il trouve un overlay
sans le canal (`doctor.development_off`).

## Ce qu’est un widget de développement

L’overlay traite ce que `dev` envoie comme un **paquet de développement** :

- il est validé entièrement, exactement comme un paquet installé, et
  s’exécute dans le même sandbox : rien de ce qui passe par le canal
  n’échappe à une vérification ;
- il porte la mention **Unverified · development package** dans les deux
  modes : on ne peut donc pas le prendre pour un widget du catalogue ;
- les permissions que son manifeste déclare sont accordées pour la session
  seulement ;
- rien de lui n’est conservé : son stockage dure le temps de la session, et
  il ne lit ni n’écrit jamais les données d’un widget installé ;
- il prend la place d’un widget installé de même ID pendant la session, et
  le widget installé revient quand il est retiré ;
- les ID sous `com.playervox.` sont refusés.

Quand `dev` se termine, quelle qu’en soit la raison, l’overlay retire le
widget.

## Ce qu’affiche `dev`

À chaque enregistrement, `dev` reconstruit le paquet et affiche les mêmes
diagnostics que `check`. Une construction en erreur n’est pas envoyée : le
widget continue de s’exécuter avec sa dernière construction valide. Viennent
ensuite les rapports de l’overlay.

**États** du widget :

| État | Signification |
| --- | --- |
| `starting` | L’overlay démarre le processus du widget. |
| `running` | Le widget s’exécute. |
| `restarting` | Il a échoué et redémarre ; l’échec est affiché. |
| `failed` | Il a échoué trop souvent : il attend votre prochain enregistrement. |
| `refused` | L’overlay a refusé de le démarrer. |
| `stopped` | Il a été arrêté. |

**Échecs** qui accompagnent `restarting` et `failed` :

<!-- generated:failure-categories -->
| Catégorie | Relancé | Signification |
| --- | --- | --- |
| `invalid_bundle` | non | Paquet, registre ou contenu compilé refusé. |
| `permission_denied` | non | Ce que le widget déclare, ce que l’utilisateur a accordé et ce qui est demandé ne concordent pas. |
| `protocol_violation` | non | Ce que le widget a envoyé à l’hôte est mal formé, inconnu ou dans le désordre. |
| `resource_limit` | oui | Un plafond de mémoire, de CPU, de file, de débit ou de taille a été dépassé. |
| `unresponsive` | oui | Le widget n’a pas démarré ou répondu dans le délai, ou a dépassé le budget de temps d’un tour. |
| `vm_exited` | oui | Le processus du widget s’est terminé sans signaler de faute (tué par le sandbox, mémoire épuisée). |
<!-- /generated:failure-categories -->

**Journaux** : chaque `log.debug`, `log.info`, `log.warn` et `log.error` de
la logique, avec son niveau. Une ligne de journal est coupée à
512 caractères. Les caractères de contrôle, les séquences d’échappement du
terminal et les contrôles bidirectionnels sont affichés échappés
(`\u{1b}`), jamais interprétés : le texte d’un widget ne peut pas prendre le
contrôle de votre terminal.

Avec `--format json`, chacun de ces éléments est un objet JSON par ligne :
les diagnostics, `{"type":"built",…}` à chaque construction, puis les
messages de l’overlay (`state`, `log`, `event`…) au fil de leur arrivée.

## Quand la connexion échoue

| Ce que vous voyez | Cause |
| --- | --- |
| `doctor.development_off` | Aucun overlay en cours d’exécution n’autorise les installations de développement : [activez le canal](#lactiver). |
| `doctor.overcrow_missing` | OverCrow n’est pas installé. |
| `doctor.channel_busy`, `too_many_sessions` | Quatre sessions `dev` sont déjà connectées à cet overlay. |
| `doctor.protocol_version`, `unsupported_protocol` | L’overlay et l’outil ne parlent pas la même version du canal : mettez à jour le plus ancien des deux. |
| `doctor.channel_untrusted` | Ce qui répond à l’adresse du canal n’est pas votre propre overlay. |
| `busy` | Une autre installation ou un autre retrait est en cours : `dev` réessaie. |
| `conflict` | Une autre session `dev` a installé un widget avec cet ID. |
| `invalid_bundle` | La validation de l’overlay a refusé le paquet ; un ID réservé `com.playervox.*` en est une cause. |
| `development_disabled` | L’overlay n’autorise plus les installations de développement. |
| `unavailable` | L’overlay n’a pas pu démarrer son runtime de widgets, ou n’a pas répondu dans les 30 secondes. |
| `rate_limited` | Plus de 10 requêtes par seconde : les enregistrements arrivent plus vite que l’overlay ne les accepte. |

## Qui peut utiliser le canal

Seuls les programmes qui s’exécutent en tant que **votre propre
utilisateur**, sur la même machine. Le canal est un socket local (Linux) ou
un tube nommé (Windows) que les autres utilisateurs, les autres machines et
les programmes en sandbox ne peuvent pas ouvrir, et chaque extrémité vérifie
l’autre avant qu’une session ne commence. Les widgets ne peuvent pas
l’utiliser : leur sandbox n’y a pas accès.

C’est pourquoi le canal est désactivé par défaut. Une fois activé, tout
programme que vous lancez peut afficher un widget non vérifié dans votre
overlay, aussi longtemps qu’OverCrow s’exécute. Désactivez-le quand vous
avez terminé.
