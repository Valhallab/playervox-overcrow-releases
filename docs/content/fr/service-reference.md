# Référence des services

Tous les services que la logique d’un widget PlayerVox OverCrow peut
appeler, avec ce que chacun exige, le moment où il peut être appelé, ses
paramètres et son résultat. [Services et permissions](services.md) explique
le fonctionnement des appels, des abonnements, des erreurs et des actions de
l’utilisateur ; cette page en est la liste.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
      if (canRead) {
        state.stopwatch = next;
      }
    },
    () => {},
  );
}
```

Dans le SDK, un service `stopwatch.subscribe` est la fonction
`stopwatch.subscribe` de l’espace de noms `stopwatch`. Un appel renvoie une
promesse de son résultat ; un abonnement prend un écouteur qui reçoit chaque
mise à jour.

## Lire la fiche d’un service

- **Nature** : un *appel, à réponse unique* reçoit une seule réponse ; un
  *abonnement* livre une valeur immédiatement, puis chaque nouvelle valeur.
- **Exige** : la permission ou la capability à déclarer dans
  [le manifeste](manifest.md#permissions), et que l’utilisateur doit
  accorder.
- **Quand l’appeler** : *À tout moment*, ou
  [*Seulement pendant une action de l’utilisateur*](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).
- **Paramètres** : les membres de l’objet à passer ; un `?` marque un membre
  facultatif. Un type tel que « texte ≤ 128 octets » donne une
  [limite](limits.md).
- **Résultat**, ou **Chaque mise à jour** pour un abonnement : ce que répond
  le service, et les codes d’erreur qui lui sont propres. Tout service peut
  aussi échouer avec les [codes d’erreur](services.md#erreurs) généraux.
- **Forme** : le type du résultat, décrit dans
  [formes de résultat](result-shapes.md).

## Services

<!-- generated:services -->
### `storage.get`

- **Nature** : appel, à réponse unique
- **Exige** : permission `storage`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `key` : texte ≤ 128 octets
- **Résultat** : la valeur JSON enregistrée, ou `null`
- **Forme** : JSON

### `storage.set`

- **Nature** : appel, à réponse unique
- **Exige** : permission `storage`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `key` : texte ≤ 128 octets ; `value` : JSON
- **Résultat** : `null` ; `quota_exceeded` au-delà de 256 Kio
- **Forme** : `null`

### `storage.remove`

- **Nature** : appel, à réponse unique
- **Exige** : permission `storage`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `key` : texte ≤ 128 octets
- **Résultat** : `null`

### `storage.keys`

- **Nature** : appel, à réponse unique
- **Exige** : permission `storage`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Résultat** : la liste des clés
- **Forme** : liste de textes

### `http.fetch`

- **Nature** : appel, à réponse unique
- **Exige** : permission `network`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `url` : texte ≤ 2 Kio ; `method` : `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` ; `contentType?` : `application/json` \| `text/plain` ; `as` : `json` \| `text` \| `bytes` \| `image`
- **Résultat** : `{ status, contentType }` avec le corps, d’une taille ≤ au `maxResponseBytes` de la règle (1 Mio quand il est absent), ou `{ status, asset }` à partir d’un corps ≤ 1 Mio
- **Forme** : [`HttpResponse`](result-shapes.md#httpresponse)

### `clipboard.writeText`

- **Nature** : appel, à réponse unique
- **Exige** : permission `clipboardWrite`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `text` : texte ≤ 16 Kio
- **Résultat** : `null`

### `gameEvents.subscribe`

- **Nature** : abonnement
- **Exige** : permission `gameEvents`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ event, at }` pour chaque événement déclaré
- **Forme** : [`GameEvent`](result-shapes.md#gameevent)

### `session.subscribe`

- **Nature** : abonnement
- **Exige** : capability `session.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ elapsedMs, at }` compté depuis le démarrage du processus du jeu, ou `null` sans jeu actif
- **Forme** : [`Session`](result-shapes.md#session) ou `null`

### `telemetry.subscribe`

- **Nature** : abonnement
- **Exige** : capability `telemetry.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ cpu, ram, cpuTemperature, gpuTemperature, sources }`, ou `null` sans jeu actif : `cpu` est la part du jeu dans toute la machine, en % (0–100), `ram` sa mémoire résidente en octets, les températures sont en °C ou `null`, `sources` `{ cpuTemperature, gpuTemperature }` dit si l’hôte dispose de chaque capteur
- **Forme** : [`Telemetry`](result-shapes.md#telemetry) ou `null`

### `fps.subscribe`

- **Nature** : abonnement
- **Exige** : capability `fps.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ fps, stale, status }` : `fps` est un nombre ou `null` ; l’hôte met `stale` 3 s après la dernière mesure ; `status` vaut `ready`, `waiting`, `unsupported`, `permission_denied`, `ambiguous`, `events_lost` ou `unavailable`
- **Forme** : [`Fps`](result-shapes.md#fps)

### `media.subscribe`

- **Nature** : abonnement
- **Exige** : capability `media.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `cover?` : booléen
- **Chaque mise à jour** : `null` sans lecteur, ou `{ player, title, artists, playing, canPrevious, canPlayPause, canNext, cover }` : `player` est un ID opaque, `artists` une liste, `cover` un identifiant `asset:` d’une image de 512 px au plus, ou `null`
- **Forme** : [`Media`](result-shapes.md#media) ou `null`

### `media.previous`

- **Nature** : appel, à réponse unique
- **Exige** : capability `media.control`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `player?` : texte ≤ 128 octets
- **Résultat** : `null` ; `stale_context` quand `player` n’est plus le lecteur courant
- **Forme** : `null`

### `media.playPause`

- **Nature** : appel, à réponse unique
- **Exige** : capability `media.control`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `player?` : texte ≤ 128 octets
- **Résultat** : `null` ; `stale_context` quand `player` n’est plus le lecteur courant
- **Forme** : `null`

### `media.next`

- **Nature** : appel, à réponse unique
- **Exige** : capability `media.control`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `player?` : texte ≤ 128 octets
- **Résultat** : `null` ; `stale_context` quand `player` n’est plus le lecteur courant
- **Forme** : `null`

### `stopwatch.subscribe`

- **Nature** : abonnement
- **Exige** : capability `stopwatch.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ running, elapsedMs, at, shortcuts }`, ou `null` sans jeu actif ; `shortcuts` `{ toggle, reset, bound }` contient les raccourcis clavier, mis en forme par l’hôte
- **Forme** : [`Stopwatch`](result-shapes.md#stopwatch) ou `null`

### `stopwatch.toggle`

- **Nature** : appel, à réponse unique
- **Exige** : capability `stopwatch.control`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : aucune
- **Résultat** : le nouvel état, comme dans `stopwatch.subscribe` ; `unavailable` quand l’hôte ne peut pas agir
- **Forme** : [`Stopwatch`](result-shapes.md#stopwatch) ou `null`

### `stopwatch.reset`

- **Nature** : appel, à réponse unique
- **Exige** : capability `stopwatch.control`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : aucune
- **Résultat** : le nouvel état, comme dans `stopwatch.subscribe` ; `unavailable` quand l’hôte ne peut pas agir
- **Forme** : [`Stopwatch`](result-shapes.md#stopwatch) ou `null`

### `notes.subscribe`

- **Nature** : abonnement
- **Exige** : capability `notes.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ active, notes }` de l’unique document de notes de l’utilisateur ; chaque note `{ id, title, body, items }`, chaque entrée `{ id, text, checked }`
- **Forme** : [`Notes`](result-shapes.md#notes)

### `notes.create`

- **Nature** : appel, à réponse unique
- **Exige** : capability `notes.write`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : aucune
- **Résultat** : `{ note }`, une nouvelle note vide et active, intitulée `Note {n}` dans la langue de l’utilisateur ; `quota_exceeded` au-delà de 8
- **Forme** : [`CreatedNote`](result-shapes.md#creatednote)

### `notes.select`

- **Nature** : appel, à réponse unique
- **Exige** : capability `notes.write`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `note` : texte ≤ 128 octets
- **Résultat** : `null` ; l’hôte enregistre la note active
- **Forme** : `null`

### `notes.setItem`

- **Nature** : appel, à réponse unique
- **Exige** : capability `notes.write`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `note` : texte ≤ 128 octets ; `item` : texte ≤ 128 octets ; `checked` : booléen
- **Résultat** : `null`

### `notes.delete`

- **Nature** : appel, à réponse unique ; l’utilisateur le confirme d’abord, dans une boîte de dialogue dessinée par OverCrow
- **Exige** : capability `notes.write`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `note` : texte ≤ 128 octets
- **Résultat** : `null`, ou `cancelled` quand l’utilisateur refuse
- **Forme** : `null`

### `playervox.score.subscribe`

- **Nature** : abonnement
- **Exige** : capability `playervox.score.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ state, name, score, grade, ratingsCount, criteria }` : `state` vaut `idle`, `unsupported`, `loading`, `ready`, `no_ratings`, `not_found` ou `unavailable` ; `criteria` `{ gameplay, art, tech }`, chacun de 0 à 100 ou `null`
- **Forme** : [`Score`](result-shapes.md#score)

### `playervox.rating.subscribe`

- **Nature** : abonnement
- **Exige** : capability `playervox.rating.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ state, name, offline, rating }` : `state` vaut `idle`, `unsupported`, `loading`, `ready` ou `unavailable` ; `rating` est `null` avant la première note de l’utilisateur, ou `{ gameplay, art, tech, review, publishedAt, offsetMinutes }`. Rien n’est envoyé tant que le compte PlayerVox est déconnecté, en cours de connexion ou expiré. Une note publiée est renvoyée par l’abonnement. L’hôte remplit les contrôles de `playervox.rating.publish` à partir d’elle
- **Forme** : [`RatingState`](result-shapes.md#ratingstate)

### `playervox.reviews.subscribe`

- **Nature** : abonnement
- **Exige** : capability `playervox.reviews.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ state, revision, offline }` : `state` vaut `idle`, `unsupported` ou `ready` ; `revision` change chaque fois que les avis à lire changent (autre jeu, autre compte PlayerVox, avis modifiés sur PlayerVox) : le widget relit alors sa page ; `offline` tant que PlayerVox est injoignable. Rien n’est envoyé tant que le compte PlayerVox est déconnecté, en cours de connexion ou expiré. C’est cet abonnement qui maintient en marche la source des avis de l’hôte
- **Forme** : [`ReviewsState`](result-shapes.md#reviewsstate)

### `playervox.reviews.page`

- **Nature** : appel, à réponse unique
- **Exige** : capability `playervox.reviews.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `page?` : entier de 1 à 100000 ; `followedOnly?` : booléen
- **Résultat** : `{ gameName, items, page, totalPages, count }` : trois avis du jeu actif par page, dans la langue de l’interface de l’hôte ; une page au-delà de la fin donne la dernière page ; chaque avis `{ id, author, grade, score, text, original, hidden, publishedAt, offsetMinutes }`, `text` traduit quand une traduction existe, `original` le texte non traduit d’un avis traduit ou `null`, tous deux coupés par l’hôte à 16 Kio. Chaque appel lit sa propre page : l’hôte ne garde ni position ni filtre communs à plusieurs widgets
- **Forme** : [`ReviewsPage`](result-shapes.md#reviewspage)

### `journal.subscribe`

- **Nature** : abonnement
- **Exige** : capability `journal.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `null` sans jeu actif, ou `{ revision, notice }` : `revision` change chaque fois que le journal fusionné du jeu actif change (session enregistrée ou supprimée, sessions du cloud fusionnées, compte PlayerVox ou synchronisation modifiés) : le widget relit alors sa page ; `notice` vaut `null`, `offline`, `storage_unavailable`, `full`, `expired`, `busy` ou `unavailable`. C’est cet abonnement qui maintient en marche la source du journal de l’hôte
- **Forme** : [`JournalState`](result-shapes.md#journalstate) ou `null`

### `journal.page`

- **Nature** : appel, à réponse unique
- **Exige** : capability `journal.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : `cursor?` : texte ≤ 128 octets
- **Résultat** : `{ gameName, items, page, next, previous }` : cinq sessions locales et du cloud du jeu actif, fusionnées et dédoublonnées, de la plus récente à la plus ancienne ; sans `cursor`, la première page ; chaque session `{ id, startedAt, offsetMinutes, durationMs, source }` ; les curseurs sont des identifiants de l’hôte qui restent valables pour le widget quoi que lisent les autres widgets, et un curseur au-delà de la fin donne la dernière page
- **Forme** : [`JournalPage`](result-shapes.md#journalpage)

### `journal.delete`

- **Nature** : appel, à réponse unique ; l’utilisateur le confirme d’abord, dans une boîte de dialogue dessinée par OverCrow
- **Exige** : capability `journal.delete`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `session` : texte ≤ 128 octets
- **Résultat** : `null`, ou `cancelled` quand l’utilisateur refuse ; `not_connected` pour une session du cloud tant que PlayerVox est déconnecté
- **Forme** : `null`

### `twitch.chat.subscribe`

- **Nature** : abonnement
- **Exige** : capability `twitch.chat.read`
- **Quand l’appeler** : À tout moment
- **Paramètres** : aucune
- **Chaque mise à jour** : `{ account, channel, joinState, failure, favorites, canSend, generation, reset, messages, removed, skipped }` : `account` vaut `signed_out`, `pending`, `connected` ou `expired` (la connexion est affichée par l’hôte) ; `failure` est la catégorie fixe d’une connexion à la chaîne qui a échoué (`failed`) ; les messages arrivent par différences, au plus une mise à jour par 100 ms, avec `reset` après l’abonnement, un changement de génération ou un retour à l’affichage, et rien tant que le widget est masqué ; un chat plus rapide est échantillonné, `skipped` comptant les nouveaux messages laissés de côté ; chaque message `{ id, author, color, badges, fragments, reply, deleted, receivedAt }` avec au plus 16 fragments, les emotes et les badges étant des identifiants `asset:` pour le thème et l’échelle courants
- **Forme** : [`TwitchChat`](result-shapes.md#twitchchat)

### `twitch.chat.join`

- **Nature** : appel, à réponse unique
- **Exige** : capability `twitch.chat.read`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `channel` : texte ≤ 25 octets
- **Résultat** : `null` ; l’hôte retient la chaîne et la rejoint au démarrage du widget
- **Forme** : `null`

### `twitch.chat.leave`

- **Nature** : appel, à réponse unique
- **Exige** : capability `twitch.chat.read`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : aucune
- **Résultat** : `null` ; l’hôte oublie la chaîne
- **Forme** : `null`

### `twitch.chat.favorite`

- **Nature** : appel, à réponse unique
- **Exige** : capability `twitch.chat.read`
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `channel` : texte ≤ 25 octets ; `favorite` : booléen
- **Résultat** : `null` ; `quota_exceeded` au-delà de 20
- **Forme** : `null`
<!-- /generated:services -->

## Les écritures qui passent par un formulaire

Enregistrer une note, publier la note d’un jeu sur PlayerVox et envoyer un
message de chat ne figurent pas dans cette liste : ce sont des intents d’écriture,
envoyés par un `form` à partir des valeurs que l’utilisateur a saisies. Voir
[les formulaires qui écrivent des données de l’utilisateur](forms.md#les-formulaires-qui-écrivent-des-données-de-lutilisateur).
