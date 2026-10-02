# Formes de résultat

Ce que répondent les services de PlayerVox OverCrow : la forme de chaque
résultat et de chaque mise à jour d’abonnement. Le SDK exporte pour chaque
forme un type TypeScript du même nom : la logique n’a donc jamais à les
décrire à la main.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest state, or `null` while it is unknown. */
    stopwatch: Stopwatch | null;
    /** The buttons take input only in Interactive mode. */
    interactive: boolean;
  }
}
```

Le widget Chronomètre garde dans son état la dernière valeur `Stopwatch`, et
la vue en lit les membres :

<!-- source: widgets/stopwatch/view.ocml -->
```xml
      <elapsed class="value" base={state.stopwatch.elapsedMs} at={state.stopwatch.at} running={state.stopwatch.running} format="hh:mm:ss.cc"/>
```

## Lire une forme

- Une forme est un enregistrement exact : chaque membre est présent, et un
  membre sans valeur vaut `null` ; il n’est jamais absent.
- « texte ou `null` » signifie que le membre peut valoir `null` : testez-le
  avant de l’afficher.
- Un entier est inférieur à 2^53 : il est donc exact en JavaScript. Les
  temps sont en millisecondes : « Millisecondes Unix » compte depuis 1970 en
  UTC, comme `Date.now()`.
- Un membre accompagné de `offsetMinutes` est un horodatage à mettre en
  forme avec ce décalage UTC ; voir
  [heure, dates et nombres](logic.md#heure-dates-et-nombres).
- Un identifiant `asset:` est une image qu’OverCrow détient pour le widget :
  liez-le au `src` d’une `image` ou d’un `avatar`, ou dessinez-le sur un
  canvas. Ce n’est pas une URL, et ses octets ne peuvent pas être lus.
- Un abonnement dont la forme est « … ou `null` » livre `null` quand il n’y
  a rien à afficher : pas de jeu actif, pas de lecteur multimédia.

La [référence des services](service-reference.md) indique quel service donne
quelle forme.

## Formes

<!-- generated:result-shapes -->
### `HttpResponse`

Réponse de `http.fetch`. `{ status, contentType }` ou `{ status, asset }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `status` | entier | Code d’état HTTP. |
| `contentType` | texte ou `null` | Type de média de la réponse ; le SDK y ajoute le corps décodé, `body`. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `status` | entier | Code d’état HTTP. |
| `asset` | identifiant `asset:` | L’image décodée (`as: "image"`). |

### `GameEvent`

Un événement de jeu. `{ event, at }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `event` | texte | Un événement de jeu déclaré. |
| `at` | entier | Horloge monotone de l’hôte, en ms. |

### `Session`

Durée de la session du jeu actif. `{ elapsedMs, at }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `elapsedMs` | entier | Temps écoulé depuis le démarrage du processus du jeu. |
| `at` | entier | Instant de l’horloge monotone de l’hôte, en ms, auquel `elapsedMs` a été mesuré. |

### `Telemetry`

Ressources utilisées par le jeu actif. `{ cpu, ram, cpuTemperature, gpuTemperature, sources }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `cpu` | nombre ou `null` | Part du jeu dans toute la machine, en %, de 0 à 100. |
| `ram` | entier ou `null` | Mémoire résidente du jeu, en octets. |
| `cpuTemperature` | nombre ou `null` | °C. |
| `gpuTemperature` | nombre ou `null` | °C. |
| `sources` | `{ cpuTemperature, gpuTemperature }` | Capteurs dont l’hôte dispose. |
| `sources.cpuTemperature` | booléen | L’hôte dispose d’un capteur pour le CPU. |
| `sources.gpuTemperature` | booléen | L’hôte dispose d’un capteur pour le GPU. |

### `Fps`

Fréquence d’images du jeu actif. `{ fps, stale, status }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `fps` | entier ou `null` | Images par seconde. |
| `stale` | booléen | Aucune mesure depuis 3 s. |
| `status` | `ready` \| `waiting` \| `unsupported` \| `permission_denied` \| `ambiguous` \| `events_lost` \| `unavailable` | État de la mesure. |

### `Stopwatch`

Le chronomètre manuel. `{ running, elapsedMs, at, shortcuts }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `running` | booléen | Il tourne. |
| `elapsedMs` | entier | Temps écoulé à l’instant `at`. |
| `at` | entier | Instant de l’horloge monotone de l’hôte, en ms, auquel `elapsedMs` a été mesuré. |
| `shortcuts` | `{ toggle, reset, bound }` | Raccourcis du chronomètre. |
| `shortcuts.toggle` | texte | Raccourci clavier, mis en forme par l’hôte. |
| `shortcuts.reset` | texte | Raccourci clavier, mis en forme par l’hôte. |
| `shortcuts.bound` | booléen | Les raccourcis sont actifs. |

### `Media`

Le lecteur multimédia courant. `{ player, title, artists, playing, canPrevious, canPlayPause, canNext, cover }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `player` | texte | ID opaque du lecteur courant. |
| `title` | texte ou `null` | Titre du morceau. |
| `artists` | liste de textes | Artistes. |
| `playing` | booléen | En cours de lecture. |
| `canPrevious` | booléen | Le lecteur sait passer au morceau précédent. |
| `canPlayPause` | booléen | Le lecteur sait lire et mettre en pause. |
| `canNext` | booléen | Le lecteur sait passer au morceau suivant. |
| `cover` | identifiant `asset:` ou `null` | Pochette, de 512 px au plus. |

### `NoteItem`

Une entrée de liste de tâches. `{ id, text, checked }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte ou `null` | ID de l’entrée. |
| `text` | texte | Texte. |
| `checked` | booléen | Cochée. |

### `Note`

Une note. `{ id, title, body, items }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte ou `null` | ID de la note. |
| `title` | texte | Titre. |
| `body` | texte | Texte courant. |
| `items` | liste de [`NoteItem`](#noteitem) | Liste de tâches. |

### `Notes`

Le document de notes de l’utilisateur. `{ active, notes }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `active` | texte ou `null` | ID de la note active. |
| `notes` | liste de [`Note`](#note) | Notes. |

### `CreatedNote`

Réponse de `notes.create`. `{ note }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `note` | [`Note`](#note) | La nouvelle note. |

### `Score`

Note PlayerVox du jeu actif. `{ state, name, score, grade, ratingsCount, criteria }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `loading` \| `ready` \| `no_ratings` \| `not_found` \| `unavailable` | État de la note : `idle` sans jeu actif, `unsupported` pour un jeu sans ID d’application Steam, `loading` jusqu’à la première réponse pour ce jeu (jamais le score du jeu précédent), `ready` et `no_ratings` avec le score, `not_found` pour un jeu que PlayerVox ne reconnaît pas, `unavailable` pendant que l’hôte réessaie. Tout état autre que `ready` et `no_ratings` a un nom et un score `null`, le grade `--`, aucun vote et des critères `null`. |
| `name` | texte ou `null` | Nom du jeu. |
| `score` | nombre ou `null` | 0–100. |
| `grade` | `S+` \| `S` \| `A` \| `B` \| `C` \| `D` \| `F` \| `--` | Grade correspondant au score. |
| `ratingsCount` | entier | Nombre de votes. |
| `criteria` | `{ gameplay, art, tech }` | Scores des critères. |
| `criteria.gameplay` | nombre ou `null` | 0–100. |
| `criteria.art` | nombre ou `null` | 0–100. |
| `criteria.tech` | nombre ou `null` | 0–100. |

### `Rating`

La note PlayerVox que l’utilisateur a donnée au jeu actif. `{ gameplay, art, tech, review, publishedAt, offsetMinutes }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `gameplay` | entier | 0–100. |
| `art` | entier | 0–100. |
| `tech` | entier | 0–100. |
| `review` | texte ou `null` | Texte de l’avis. |
| `publishedAt` | entier ou `null` | Millisecondes Unix. |
| `offsetMinutes` | entier ou `null` | Décalage UTC, en minutes, avec lequel afficher l’horodatage. |

### `RatingState`

La note que l’utilisateur a lui-même donnée au jeu actif, avec son état. `{ state, name, offline, rating }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `loading` \| `ready` \| `unavailable` | État de la note : `idle` sans jeu actif, `unsupported` pour un jeu sans ID d’application Steam, `loading` jusqu’à la première réponse pour ce jeu et ce compte (jamais la note du jeu précédent), `ready` avec la note, `unavailable` pendant que l’hôte retente une lecture qui a échoué. Tout état autre que `ready` a un nom et une note `null`. |
| `name` | texte ou `null` | Nom du jeu sur PlayerVox. |
| `offline` | booléen | PlayerVox est injoignable : la note est la dernière lue, et `playervox.rating.publish` répond `not_connected`. |
| `rating` | [`Rating`](#rating) ou `null` | La note de l’utilisateur ; `null` avant la première. |

### `Review`

Un avis de joueur. `{ id, author, grade, score, text, original, hidden, publishedAt, offsetMinutes }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte | ID de l’avis. |
| `author` | texte | Nom de l’auteur. |
| `grade` | `S+` \| `S` \| `A` \| `B` \| `C` \| `D` \| `F` \| `--` | Grade. |
| `score` | entier | 0–100. |
| `text` | texte ou `null` | Texte, traduit quand une traduction existe. |
| `original` | texte ou `null` | Texte non traduit quand `text` est une traduction ; `null` sinon. |
| `hidden` | booléen | Masqué par la communauté : n’affichez le texte que lorsque l’utilisateur le demande. |
| `publishedAt` | entier | Millisecondes Unix. |
| `offsetMinutes` | entier | Décalage UTC, en minutes, avec lequel afficher l’horodatage. |

### `ReviewsState`

Les avis des joueurs sur le jeu actif : ce qu’il faut lire, non les avis eux-mêmes. `{ state, revision, offline }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `idle` \| `unsupported` \| `ready` | `idle` sans jeu actif, `unsupported` pour un jeu sans ID d’application Steam, `ready` quand `playervox.reviews.page` lit les avis du jeu. |
| `revision` | entier | Change chaque fois que les avis à lire changent : autre jeu, autre compte PlayerVox, ou avis modifiés sur PlayerVox. |
| `offline` | booléen | PlayerVox est injoignable : `playervox.reviews.page` répond `not_connected`. |

### `ReviewsPage`

Une page d’avis de joueurs. `{ gameName, items, page, totalPages, count }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `gameName` | texte | Nom du jeu sur PlayerVox. |
| `items` | liste de [`Review`](#review) | Avis. |
| `page` | entier | Numéro de la page. |
| `totalPages` | entier | Nombre de pages. |
| `count` | entier | Nombre d’avis. |

### `JournalSession`

Une session du journal. `{ id, startedAt, offsetMinutes, durationMs, source }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte | ID de la session. |
| `startedAt` | entier | Millisecondes Unix. |
| `offsetMinutes` | entier | Décalage UTC, en minutes, avec lequel afficher l’horodatage. |
| `durationMs` | entier | Durée. |
| `source` | `local` \| `cloud` | Où la session est enregistrée. |

### `JournalState`

Le journal du jeu actif. `{ revision, notice }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `revision` | entier | Change chaque fois que le journal fusionné du jeu actif change. |
| `notice` | `offline` \| `storage_unavailable` \| `full` \| `expired` \| `busy` \| `unavailable` ou `null` | État du journal à afficher au-dessus des sessions : `offline` la synchronisation est hors ligne (les sessions locales restent), `storage_unavailable` le journal local est illisible, `full` le journal local est plein, `expired` la connexion à PlayerVox a expiré, `busy` PlayerVox demande de réessayer plus tard, `unavailable` tout autre échec ; `null` quand il n’y en a pas. |

### `JournalPage`

Une page du journal du jeu. `{ gameName, items, page, next, previous }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `gameName` | texte | Jeu actif ; vide quand l’hôte n’a pas de nom. |
| `items` | liste de [`JournalSession`](#journalsession) | Sessions, de la plus récente à la plus ancienne. |
| `page` | entier | Numéro de la page, à partir de 1. |
| `next` | texte ou `null` | Curseur de la page suivante. |
| `previous` | texte ou `null` | Curseur de la page précédente. |

### `ChatFragment`

Une portion de texte ou une emote d’un message de chat. `{ text }` ou `{ emote, alt }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `text` | texte | Portion de texte. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `emote` | identifiant `asset:` | Image de l’emote. |
| `alt` | texte | Nom de l’emote. |

### `ChatMessage`

Un message de chat. `{ id, author, color, badges, fragments, reply, deleted, receivedAt }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte | ID du message. |
| `author` | texte | Nom de l’auteur. |
| `color` | texte ou `null` | Couleur de l’auteur, `#rrggbb`. |
| `badges` | liste d’identifiants `asset:` | Images des badges. |
| `fragments` | liste de [`ChatFragment`](#chatfragment) | Portions du contenu. |
| `reply` | `{ author, text }` ou `null` | Le message auquel celui-ci répond. |
| `reply.author` | texte | Auteur du message auquel celui-ci répond. |
| `reply.text` | texte | Texte du message auquel celui-ci répond. |
| `deleted` | booléen | Supprimé par un modérateur. |
| `receivedAt` | entier | Moment où l’hôte a reçu le message, en millisecondes Unix de l’horloge de l’hôte : comparez-le à `Date.now()` pour connaître l’âge d’un message (l’estompage du mode passif), y compris après un `reset`. |

### `TwitchChat`

État du chat Twitch. `{ account, channel, joinState, failure, favorites, canSend, generation, reset, messages, removed, skipped }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `account` | `signed_out` \| `pending` \| `connected` \| `expired` | État du compte Twitch ; la connexion est affichée par l’hôte. |
| `channel` | texte ou `null` | Identifiant de la chaîne rejointe. |
| `joinState` | `idle` \| `connecting` \| `joined` \| `reconnecting` \| `failed` | État de la connexion à la chaîne. |
| `failure` | `channel_unavailable` \| `connection` \| `provider` \| `limit` ou `null` | Pourquoi `joinState` vaut `failed`, sous la forme d’une catégorie fixe : la chaîne n’existe pas ou refuse le compte, la connexion a échoué, Twitch a répondu quelque chose d’inattendu, ou un autre widget occupe l’unique connexion de l’hôte au chat (`limit`). `null` dans tout autre état. Un échec lié au compte n’y figure pas : c’est l’hôte qui l’affiche. |
| `favorites` | liste de textes | Chaînes favorites. |
| `canSend` | booléen | Un message peut être envoyé maintenant. |
| `generation` | entier | Change avec la chaîne ou le compte. |
| `reset` | booléen | `messages` remplace toute la liste. |
| `messages` | liste de [`ChatMessage`](#chatmessage) | Messages, du plus ancien au plus récent : toute la liste avec `reset` ; sinon les nouveaux messages, à ajouter, et les messages modifiés, qui remplacent sur place celui de même `id`. |
| `removed` | liste de textes | ID des messages retirés. |
| `skipped` | entier | Nouveaux messages que l’hôte a laissés de côté depuis la mise à jour précédente, parce que le chat va plus vite qu’il ne transmet ; 0 avec `reset`. Un retrait n’est jamais laissé de côté. |
<!-- /generated:result-shapes -->
