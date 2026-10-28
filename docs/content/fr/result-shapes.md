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
- Un identifiant `asset:` est une image que PlayerVox OverCrow détient pour
  le widget : liez-le au `src` d’une `image` ou d’un `avatar`, ou
  dessinez-le sur un canvas. Ce n’est pas une URL, et ses octets ne peuvent
  pas être lus.
- Un abonnement dont la forme est « … ou `null` » livre `null` quand il n’y
  a rien à afficher : pas de jeu actif, pas de lecteur multimédia.

La [référence des services](service-reference.md) indique quel service donne
quelle forme.

## Formes

<!-- generated:result-shapes -->
### `HttpResponse`

Réponse de `http.fetch`. `{ status, contentType, headers }` ou `{ status, asset, headers }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `status` | entier | Code d’état HTTP. |
| `contentType` | texte ou `null` | Type de média de la réponse ; le SDK y ajoute le corps décodé, `body`. |
| `headers` | [`HttpHeaders`](#httpheaders) | Les en-têtes de la réponse parmi `RESPONSE_HEADERS`. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `status` | entier | Code d’état HTTP. |
| `asset` | identifiant `asset:` | L’image décodée (`as: "image"`). |
| `headers` | [`HttpHeaders`](#httpheaders) | Les en-têtes de la réponse parmi `RESPONSE_HEADERS`. |

### `HttpHeaders`

En-têtes d’une réponse de `http.fetch`, par nom en minuscules : seulement ceux de `RESPONSE_HEADERS` que la réponse contient, chacun en ASCII imprimable d’au plus 256 octets ; un en-tête répété est joint par `, `. Aucun autre en-tête n’atteint le widget. `{ retry-after?, ratelimit?, ratelimit-policy?, ratelimit-limit?, ratelimit-remaining?, ratelimit-reset?, x-ratelimit-limit?, x-ratelimit-remaining?, x-ratelimit-reset?, date?, etag?, last-modified?, cache-control?, expires?, age? }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `retry-after` | texte | Présent quand la réponse le contient. |
| `ratelimit` | texte | Présent quand la réponse le contient. |
| `ratelimit-policy` | texte | Présent quand la réponse le contient. |
| `ratelimit-limit` | texte | Présent quand la réponse le contient. |
| `ratelimit-remaining` | texte | Présent quand la réponse le contient. |
| `ratelimit-reset` | texte | Présent quand la réponse le contient. |
| `x-ratelimit-limit` | texte | Présent quand la réponse le contient. |
| `x-ratelimit-remaining` | texte | Présent quand la réponse le contient. |
| `x-ratelimit-reset` | texte | Présent quand la réponse le contient. |
| `date` | texte | Présent quand la réponse le contient. |
| `etag` | texte | Présent quand la réponse le contient. |
| `last-modified` | texte | Présent quand la réponse le contient. |
| `cache-control` | texte | Présent quand la réponse le contient. |
| `expires` | texte | Présent quand la réponse le contient. |
| `age` | texte | Présent quand la réponse le contient. |

### `Session`

Durée de la session du jeu actif. `{ elapsedMs, at }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `elapsedMs` | entier | Temps écoulé depuis le démarrage du processus du jeu. |
| `at` | entier | Instant de l’horloge monotone de l’hôte, en ms, auquel `elapsedMs` a été mesuré. |

### `Game`

Le jeu actif. `{ steamAppId, name }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `steamAppId` | entier ou `null` | App ID Steam, de 1 à 2147483647, ou `null` hors du magasin Steam. |
| `name` | texte ou `null` | Nom dans la liste de jeux de l’utilisateur, une ligne de 512 octets au plus, ou `null`. |

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

### `AccountStatus`

État d’un compte tiers que le widget déclare. `{ state }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `signed_out` \| `pending` \| `connected` \| `refused` \| `expired` | État du compte ; la connexion est dessinée par l’hôte. |

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

### `TwitchEvent`

Un événement Twitch en direct. `{ seq, type, at, data }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l'événement dans l'abonnement, à partir de 1, sans trou sauf si des événements ont été perdus. |
| `type` | `channel.goal.begin` \| `channel.goal.progress` \| `channel.goal.end` \| `channel.follow` \| `channel.hype_train.begin` \| `channel.hype_train.progress` \| `channel.hype_train.end` \| `channel.cheer` \| `channel.subscribe` \| `channel.subscription.gift` \| `channel.subscription.message` \| `channel.poll.begin` \| `channel.poll.progress` \| `channel.poll.end` \| `channel.prediction.begin` \| `channel.prediction.progress` \| `channel.prediction.lock` \| `channel.prediction.end` | Le type EventSub, parmi ceux de l'abonnement. |
| `at` | entier | Quand l'hôte l'a reçu, en millisecondes Unix de l'horloge de l'hôte. |
| `data` | JSON | La projection de l'événement par l'hôte : les champs de la table du type sous les noms de Twitch, `null` là où Twitch n'a rien envoyé. |

### `TwitchEvents`

Événements Twitch en direct des types que le widget déclare. `{ state, reason, events }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `live` \| `off` | `live` tant que l'hôte est abonné chez Twitch. |
| `reason` | `connecting` \| `not_connected` \| `unavailable` ou `null` | Pourquoi l'état est `off` ; `null` en `live`. |
| `events` | liste de [`TwitchEvent`](#twitchevent) | Les derniers événements, du plus ancien au plus récent. |

### `SteamEvent`

Un événement Steam local. `{ seq, type, at, data }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l'événement dans l'abonnement, à partir de 1, sans trou sauf si des événements ont été perdus. |
| `type` | `stats.saved` | Le type, parmi ceux de l'abonnement. |
| `at` | entier | Quand le client Steam l'a enregistré, en millisecondes Unix de l'horloge de l'hôte, jamais après la mise à jour. |
| `data` | JSON | Les champs de la table du type : `{ appid }` pour `stats.saved`. |

### `SteamEvents`

Événements Steam locaux des types que le widget déclare, pour le compte qu'il nomme. `{ state, reason, events }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `live` \| `off` | `live` tant que l'hôte surveille les stats du client Steam sur cet ordinateur. |
| `reason` | `connecting` \| `not_connected` \| `unavailable` ou `null` | Pourquoi l'état est `off` ; `null` en `live`. |
| `events` | liste de [`SteamEvent`](#steamevent) | Les derniers événements, du plus ancien au plus récent. |

### `SteamLocalAchievement`

Un succès que le client Steam de cet ordinateur a enregistré comme débloqué. `{ name, unlockedAt }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `name` | texte | Le nom d’API du succès, au plus 128 octets d’ASCII imprimable. |
| `unlockedAt` | entier ou `null` | Quand il a été débloqué, en millisecondes Unix ; `null` si Steam n’a enregistré aucune date. |

### `SteamLocalAchievements`

Les succès débloqués d’un jeu, lus sur cet ordinateur pour le compte que le widget nomme. `{ appid, total, achievements }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `appid` | entier | Le jeu demandé. |
| `total` | entier | Combien de succès du jeu les fichiers tiennent pour débloqués. |
| `achievements` | liste de [`SteamLocalAchievement`](#steamlocalachievement) | Une page de ceux-ci, du plus récent au plus ancien (dates `null` en dernier, puis par nom). |

### `WarframeName`

Un élément de Warframe, nommé. `{ id, name }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte | Notre ID stable, en `snake_case`, listé dans la page des événements de jeu. |
| `name` | texte ou `null` | Son nom dans la langue de l’utilisateur, une ligne d’au plus 128 octets ; `null` quand PlayerVox OverCrow n’en a pas encore. |

### `WarframeNode`

Un nœud de la carte stellaire. `{ id, name, englishName }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | texte | La clé du nœud propre au jeu (`SolNode195`, `ClanNode…`, `SettlementNode…`), telle que la nomment les données publiques comme les tables de butin et l’état du monde. |
| `name` | texte ou `null` | Son nom dans la langue de l’utilisateur, ou `null` quand PlayerVox OverCrow n’en a pas encore (nouveau contenu). |
| `englishName` | texte ou `null` | Son nom anglais, pour le croiser avec des données publiques en anglais, ou `null`. |

### `WarframeEvents`

Les événements de jeu de Warframe, pour les fonctionnalités que le widget liste. `{ playing, session, features, info, events }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `playing` | booléen | Si Warframe est le jeu actif dans PlayerVox OverCrow. |
| `session` | `{ startedAt }` ou `null` | La session Warframe suivie, ou `null` avant la première ; chaque lancement est une nouvelle session. |
| `session.startedAt` | entier | Quand Warframe a été lancé, en millisecondes Unix. |
| `features` | [`WarframeFeatures`](#warframefeatures) | Le statut de chaque fonctionnalité. |
| `info` | [`WarframeInfo`](#warframeinfo) | L’état de chaque fonctionnalité que le widget suit. |
| `events` | liste de [`WarframeEvent`](#warframeevent) | Les derniers événements des fonctionnalités que le widget suit, du plus ancien au plus récent. |

### `WarframeFeatures`

Le statut de chaque fonctionnalité Warframe. `{ location, mission, progress, squad, eidolons, world }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `location` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |
| `mission` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |
| `progress` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |
| `squad` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |
| `eidolons` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |
| `world` | `available` \| `unavailable` \| `undeclared` | `available`, `unavailable` ou `undeclared`. |

### `WarframeInfo`

L’état de chaque fonctionnalité Warframe ; `null` pour une fonctionnalité que le widget ne suit pas. `{ location, mission, progress, squad, eidolons, world }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `location` | [`WarframeLocation`](#warframelocation) ou `null` | Où est le joueur ; `null` tant que Warframe n’est pas joué. |
| `mission` | [`WarframeMission`](#warframemission) ou `null` | La dernière mission de la session. |
| `progress` | [`WarframeProgress`](#warframeprogress) ou `null` | La progression de la dernière mission. |
| `squad` | [`WarframeSquad`](#warframesquad) ou `null` | L’escouade. |
| `eidolons` | [`WarframeEidolons`](#warframeeidolons) ou `null` | La nuit sur les Plaines d’Eidolon. |
| `world` | [`WarframeWorld`](#warframeworld) ou `null` | Le monde du jour et de la semaine, que Warframe soit joué ou non. |

### `WarframeLocation`

Où est le joueur. `{ kind, place, since }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `kind` | `orbiter` \| `relay` \| `hub` \| `open_world` \| `mission` \| `dojo` \| `other` | Le genre de lieu. |
| `place` | [`WarframeName`](#warframename) ou `null` | Lequel : une ville, un relais ou un monde ouvert de nos lieux, ou le nœud d’une mission ; `null` quand le jeu ne le dit pas. |
| `since` | entier | Quand le joueur est arrivé, en millisecondes Unix. |

### `WarframeMission`

Une mission Warframe. `{ state, node, planet, type, faction, enemyLevel, fissure, modifiers, selectedAt, loadingAt, startedAt, endedAt, result, durationSeconds }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `selected` \| `loading` \| `in_progress` \| `ended` | `selected` sur la carte stellaire, `loading`, `in_progress` ou `ended`. |
| `node` | [`WarframeNode`](#warframenode) | Le nœud. |
| `planet` | [`WarframeName`](#warframename) ou `null` | Sa planète ou sa région. |
| `type` | [`WarframeName`](#warframename) ou `null` | Le type de mission ; `null` pour un type que nous ne connaissons pas. |
| `faction` | [`WarframeName`](#warframename) ou `null` | La faction ennemie. |
| `enemyLevel` | `{ min, max }` ou `null` | Les niveaux des ennemis du nœud. |
| `enemyLevel.min` | entier | Niveau d’ennemi le plus bas. |
| `enemyLevel.max` | entier | Niveau d’ennemi le plus haut. |
| `fissure` | [`WarframeName`](#warframename) ou `null` | L’ère d’une mission de Fissure du Néant. |
| `modifiers` | liste de [`WarframeModifier`](#warframemodifier) | Ce qui modifie la mission, au plus 8. |
| `selectedAt` | entier ou `null` | Quand elle a été choisie, en millisecondes Unix. |
| `loadingAt` | entier ou `null` | Quand son chargement a commencé. |
| `startedAt` | entier ou `null` | Quand la partie a commencé. |
| `endedAt` | entier ou `null` | Quand elle s’est terminée. |
| `result` | `succeeded` \| `failed` \| `aborted` ou `null` | `succeeded`, `failed` ou `aborted` ; `null` avant la fin, ou quand le jeu ne l’a pas dit. |
| `durationSeconds` | nombre ou `null` | Du début de la partie à la fin, en secondes, à la milliseconde près. |

### `WarframeModifier`

Ce qui modifie une mission. `{ id, name, stage }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `id` | `steel_path` \| `arbitration` \| `sortie` \| `archon_hunt` \| `nightmare` \| `void_storm` \| `alert` \| `lich` | Notre ID du modificateur. |
| `name` | texte | Son nom dans la langue de l’utilisateur. |
| `stage` | entier ou `null` | L’étape d’une Sortie ou d’une Chasse d’Archonte, de 1 à 3, quand PlayerVox OverCrow peut la connaître. |

### `WarframeProgress`

La progression d’une mission. `{ wave, round, rewards, rotation, nextRewardAt, nextRewardWave }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `wave` | entier ou `null` | La vague en cours (Défense, Défense miroir). |
| `round` | entier ou `null` | Manches terminées (Interception, Perturbation). |
| `rewards` | entier | Récompenses de rotation reçues jusqu’ici. |
| `rotation` | `A` \| `B` \| `C` ou `null` | La rotation de la prochaine récompense, comptée A, A, B, C d’après les récompenses reçues ; `null` pour un type sans rotations ou que nous ne savons pas compter. |
| `nextRewardAt` | entier ou `null` | Quand vient la prochaine récompense, en millisecondes Unix, pour un type payé au temps (Survie). |
| `nextRewardWave` | entier ou `null` | La vague de la prochaine récompense, pour un type payé aux vagues (Défense). |

### `WarframeSquadMember`

Un membre de l’escouade. `{ name, you }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `name` | texte | Le pseudo du joueur, sans l’icône de plateforme. |
| `you` | booléen | Si c’est l’utilisateur. |

### `WarframeSquad`

L’escouade. `{ members }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `members` | liste de [`WarframeSquadMember`](#warframesquadmember) | Les membres, utilisateur compris, au plus 8. |

### `WarframeEidolonHunt`

Un Eidolon de la nuit. `{ eidolon, spawnedAt, weakpoints, capturedAt, killedAt, fledAt }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `eidolon` | [`WarframeName`](#warframename) ou `null` | Quel Eidolon, déduit de l’ordre de la chasse ; `null` quand on ne peut pas le savoir. |
| `spawnedAt` | entier | Quand il est apparu, en millisecondes Unix. |
| `weakpoints` | entier | Points faibles détruits. |
| `capturedAt` | entier ou `null` | Quand il a été capturé. |
| `killedAt` | entier ou `null` | Quand il a été tué. |
| `fledAt` | entier ou `null` | Quand il est parti à l’aube. |

### `WarframeEidolons`

La nuit sur les Plaines d’Eidolon. `{ night, hunts }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `night` | booléen ou `null` | S’il fait nuit sur les Plaines, tel que le joueur l’a vu en dernier ; `null` avant. |
| `hunts` | liste de [`WarframeEidolonHunt`](#warframeeidolonhunt) | Les Eidolons de la nuit, du plus ancien au plus récent, au plus 16. |

### `WarframeEvent`

Un événement Warframe ; son type dit quel état il porte. `{ seq, at, type, mission }` ou `{ seq, at, type, progress }` ou `{ seq, at, type }` ou `{ seq, at, type, eidolon }` ou `{ seq, at, type, member }` ou `{ seq, at, type, location }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `mission_selected` \| `mission_loading` \| `mission_started` \| `mission_ended` | Ce qui est arrivé. |
| `mission` | [`WarframeMission`](#warframemission) | La mission à ce moment. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `wave_started` \| `reward_given` | Ce qui est arrivé. |
| `progress` | [`WarframeProgress`](#warframeprogress) | La progression à ce moment. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `night_started` \| `day_started` | La nuit ou le jour a commencé sur les Plaines. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `eidolon_spawned` \| `weakpoint_destroyed` \| `eidolon_captured` \| `eidolon_killed` \| `eidolon_fled` | Ce qui est arrivé. |
| `eidolon` | [`WarframeEidolonHunt`](#warframeeidolonhunt) | L’Eidolon à ce moment. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `member_joined` \| `member_left` | Ce qui est arrivé. |
| `member` | [`WarframeSquadMember`](#warframesquadmember) | Qui. |

| Membre | Forme | Signification |
| --- | --- | --- |
| `seq` | entier | Rang de l’événement dans l’abonnement, à partir de 1. |
| `at` | entier | Quand c’est arrivé dans le jeu, en millisecondes Unix. |
| `type` | `location_changed` | Ce qui est arrivé. |
| `location` | [`WarframeLocation`](#warframelocation) | Le nouveau lieu. |

### `WarframeWorldMission`

Une mission de la Sortie ou de la Chasse d’Archonte. `{ node, planet, type, modifier }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `node` | [`WarframeNode`](#warframenode) | Le nœud. |
| `planet` | [`WarframeName`](#warframename) ou `null` | Sa planète ou sa région. |
| `type` | [`WarframeName`](#warframename) ou `null` | Le type de mission. |
| `modifier` | [`WarframeName`](#warframename) ou `null` | La condition d’une mission de Sortie ; `null` sinon. |

### `WarframeCycle`

Le cycle d’un monde ouvert. `{ state, endsAt }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | [`WarframeName`](#warframename) | Jour ou nuit (Cetus), chaud ou froid (Vallée Orbis), Fass ou Vome (Gouffre de Cambion). |
| `endsAt` | entier | Quand il change, en millisecondes Unix. |

### `WarframeWorld`

Le monde de Warframe du jour et de la semaine. `{ updatedAt, sortie, archonHunt, fissures, cycles, resets, voidTrader, circuit }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `updatedAt` | entier | Quand PlayerVox OverCrow l’a lu pour la dernière fois, en millisecondes Unix. |
| `sortie` | `{ boss, faction, endsAt, missions }` ou `null` | La Sortie du jour. |
| `sortie.boss` | [`WarframeName`](#warframename) | Le boss. |
| `sortie.faction` | [`WarframeName`](#warframename) ou `null` | Sa faction. |
| `sortie.endsAt` | entier | Quand elle se termine. |
| `sortie.missions` | liste de [`WarframeWorldMission`](#warframeworldmission) | Ses missions, dans l’ordre. |
| `archonHunt` | `{ boss, endsAt, missions }` ou `null` | La Chasse d’Archonte de la semaine. |
| `archonHunt.boss` | [`WarframeName`](#warframename) | L’Archonte. |
| `archonHunt.endsAt` | entier | Quand elle se termine. |
| `archonHunt.missions` | liste de [`WarframeWorldMission`](#warframeworldmission) | Ses missions, dans l’ordre. |
| `fissures` | liste de `{ node, planet, type, era, steelPath, voidStorm, endsAt }` | Les Fissures du Néant ouvertes, les plus proches de leur fermeture d’abord, au plus 64. |
| `cycles` | `{ cetus, vallis, cambion }` | Les cycles des mondes ouverts ; `null` pour un cycle que PlayerVox OverCrow ne peut pas connaître. |
| `cycles.cetus` | [`WarframeCycle`](#warframecycle) ou `null` | Le jour et la nuit à Cetus et sur les Plaines. |
| `cycles.vallis` | [`WarframeCycle`](#warframecycle) ou `null` | Le chaud et le froid dans la Vallée Orbis. |
| `cycles.cambion` | [`WarframeCycle`](#warframecycle) ou `null` | Fass et Vome dans le Gouffre de Cambion. |
| `resets` | `{ daily, weekly }` | Les prochaines réinitialisations. |
| `resets.daily` | entier | La prochaine réinitialisation quotidienne, 00:00 UTC, en millisecondes Unix. |
| `resets.weekly` | entier | La prochaine réinitialisation hebdomadaire, lundi 00:00 UTC. |
| `voidTrader` | `{ arrivesAt, leavesAt, relay }` ou `null` | La prochaine visite de Baro Ki’Teer, ou celle en cours. |
| `voidTrader.arrivesAt` | entier | Quand il arrive. |
| `voidTrader.leavesAt` | entier | Quand il repart. |
| `voidTrader.relay` | [`WarframeName`](#warframename) ou `null` | Où il vient. |
| `circuit` | `{ normal, steelPath }` ou `null` | Les récompenses du Circuit de la semaine, quand l’état du monde les donne. |
| `circuit.normal` | liste de [`WarframeName`](#warframename) | Les récompenses de la semaine. |
| `circuit.steelPath` | liste de [`WarframeName`](#warframename) | Les récompenses de la Route de l’Acier de la semaine. |
<!-- /generated:result-shapes -->
