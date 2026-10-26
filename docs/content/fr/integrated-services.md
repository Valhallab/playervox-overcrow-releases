# Services intégrés

Certains services sont **intégrés** à PlayerVox OverCrow. PlayerVox définit
chacun d’eux une fois : ses adresses, la façon d’envoyer la clé ou la
connexion, et les chemins qu’un widget peut atteindre. Le joueur connecte
chacun une fois, dans la page **Services connectés** du Centre de contrôle,
et chaque widget qui le nomme et que le joueur autorise utilise cette
connexion. Le widget ne voit jamais la clé ni le jeton.

Steam et Twitch viennent en premier. Un widget ne peut pas déclarer son
propre compte chez eux ([Comptes tiers](accounts.md)), ni utiliser une de
leurs adresses ou de leurs pages pour un autre compte : il nomme le service.

## Nommer un service

<!-- source: docs/content/examples/steam-stats/manifest.json -->
```json
    "accounts": [{ "service": "steam", "events": ["stats.saved"] }],
    "network": [
      {
        "origin": "https://api.steampowered.com",
        "method": "GET",
        "path": "/ISteamUser/GetPlayerSummaries/v2/",
        "queryParams": {
          "steamids": { "type": "slug", "maxLength": 17, "required": true }
        },
        "maxResponseBytes": 16384,
        "account": "steam"
```

- L’identifiant du compte est celui du service : la permission est
  `account:steam`, une route le nomme dans `account`, et
  `account.subscribe({ id: "steam" })` suit son état.
- Seuls `scopes`, `required` et `events`
  ([événements en direct](#événements-en-direct-twitch)) accompagnent
  `service`. Les origines, l’envoi et la page de clé viennent de la table de
  PlayerVox ci-dessous.
- Twitch prend des `scopes` parmi ceux qu’il propose, par exemple
  `{ "service": "twitch", "scopes": ["channel:read:goals"] }`. Le joueur
  voit ce que lit chaque scope.

## Lecture seule

Dans cette version, les services intégrés sont en lecture seule pour les
widgets :

- toute règle réseau du widget utilise `GET` et vise une origine du service
  (son API, ses images) ;
- seules les règles sur les origines qui reçoivent la clé ou le jeton
  nomment le service ; les origines d’images ne le reçoivent jamais ;
- ces règles restent sur les chemins que le service permet et n’atteignent
  jamais un chemin refusé (échanges et jetons de serveur de Steam, clé de
  stream et secrets d’extension de Twitch). Un paramètre de chemin y compte
  pour n’importe quelle valeur ;
- chez Twitch, chaque point d’accès exige le scope qu’il lit, demandé par
  le widget lui-même : la connexion est partagée, et un widget n’atteint
  jamais ce que seul le scope d’un autre widget ouvre.

Le chat Twitch de PlayerVox OverCrow utilise la même connexion Twitch, par
ses propres capacités : un widget ne demande jamais les scopes du chat.

## Une connexion partagée

- Le joueur connecte un service une fois, dans le Centre de contrôle : une
  clé avec un court guide pour Steam, un code pour Twitch. Chaque widget
  demande toujours la permission `account:<service>` ; la retirer à un
  widget ne déconnecte pas le service.
- Quand un widget demande à Twitch un scope que la connexion n’a pas,
  OverCrow demande au joueur de reconnecter Twitch.
- Déconnecter un service déconnecte tous les widgets qui l’utilisent
  (`signed_out`). Désinstaller un widget n’efface rien de la connexion.

Le SDK, les erreurs et les tests fonctionnent comme pour tout compte : voyez
[Comptes tiers](accounts.md). Dans un scénario de test, `host.accounts` donne
l’état du service par son identifiant : `steam`, ou `twitch`, qui est le
compte Twitch d’OverCrow.

## Événements en direct (Twitch)

À partir de PlayerVox OverCrow 0.8.1-beta.1, un widget qui nomme Twitch peut
recevoir les événements de sa chaîne dès qu’ils arrivent, au lieu de lire
Helix en boucle. Il les liste dans `events`, à côté des scopes qui les
lisent :

<!-- source: docs/content/examples/live-goal/manifest.json -->
```json
    "accounts": [
      {
        "service": "twitch",
        "scopes": ["channel:read:goals"],
        "events": ["channel.goal.begin", "channel.goal.progress", "channel.goal.end"]
      }
    ],
```

- Chaque type demande son scope parmi les `scopes` du widget (tableau
  ci-dessous). `events` ne demande rien de plus au joueur : un événement lit
  ce que son scope ouvre déjà.
- Une version avec `events` demande la fonction de catalogue
  `twitch-events` : le catalogue la propose à OverCrow 0.8.1-beta.1 ou plus
  récent, et une application plus ancienne garde la version précédente.
- OverCrow ouvre une seule connexion EventSub pour tous les widgets, sur la
  propre chaîne du joueur. Le widget ne voit jamais de jeton ni
  d’abonnement.

`twitch.events.subscribe` les transmet. Twitch ne rejoue rien de ce qu’une
coupure fait perdre, et les mises à jour sont fusionnées en chemin vers le
widget : un widget garde donc le dernier `seq` traité et relit Helix quand il
a pu manquer quelque chose :

<!-- source: docs/content/examples/live-goal/logic.ts -->
```ts
let lastSeq = 0; // the highest `seq` handled
let live = false;

twitch.events.subscribe({}, (update) => {
  if (!update.ok) return;
  const { state, events } = update.value;
  if (state === "live" && !live) readHelix(); // live again: catch up once
  live = state === "live";
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    if (event.seq > lastSeq + 1) readHelix(); // some were missed
    lastSeq = event.seq;
    apply(event.type, event.data);
  }
});

// While `off`, read Helix as before.
timers.every(20_000, () => {
  if (!live) readHelix();
});
```

- `state` vaut `live` une fois OverCrow abonné chez Twitch à chaque type que
  l’abonnement demande, `off` sinon, avec `reason` : `connecting`,
  `not_connected` (Twitch n’est pas connecté, ou sa connexion n’a pas un
  scope que le widget déclare) ou `unavailable` (Twitch a refusé ou est
  injoignable ; OverCrow réessaie).
- `events` répète les derniers événements de l’abonnement, du plus ancien au
  plus récent, chacun `{ seq, type, at, data }`. `seq` compte à partir de 1
  pour chaque abonnement ; un trou veut dire que des événements ont été
  perdus.
- `data` contient les champs de l’événement sous les noms de Twitch (voir la
  référence EventSub de Twitch), `null` là où Twitch n’a rien envoyé ; les
  textes et les listes sont coupés à des bornes fixes. Ce qu’écrivent les
  spectateurs n’en fait jamais partie : un cheer ou un réabonnement arrive
  sans son message.
- `types` restreint l’abonnement à certains des types déclarés ; un type que
  la déclaration ne liste pas échoue avec `permission_denied`.
- Dans un scénario de test, `fixtures.subscriptions["twitch.events.subscribe"]`
  donne la première mise à jour et une étape `publish` les suivantes.

| Type | Version | Scope |
| --- | --- | --- |
| `channel.goal.begin`, `channel.goal.progress`, `channel.goal.end` | 1 | `channel:read:goals` |
| `channel.follow` | 2 | `moderator:read:followers` |
| `channel.hype_train.begin`, `channel.hype_train.progress`, `channel.hype_train.end` | 2 | `channel:read:hype_train` |
| `channel.cheer` | 1 | `bits:read` |
| `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message` | 1 | `channel:read:subscriptions` |
| `channel.poll.begin`, `channel.poll.progress`, `channel.poll.end` | 1 | `channel:read:polls` |
| `channel.prediction.begin`, `channel.prediction.progress`, `channel.prediction.lock`, `channel.prediction.end` | 1 | `channel:read:predictions` |

## Événements locaux (Steam)

Steam ne pousse rien, mais le client Steam de l'ordinateur du joueur
enregistre les stats d'un jeu de chaque compte à l'instant où un succès
s'obtient. Depuis PlayerVox OverCrow 0.9.0-beta.1, un widget qui nomme
Steam peut le savoir et relire les succès tout de suite au lieu d'attendre
sa lecture suivante :

<!-- source: docs/content/examples/steam-stats/manifest.json -->
```json
    "accounts": [{ "service": "steam", "events": ["stats.saved"] }],
```

- `events` ne demande rien de plus au joueur : un événement dit seulement
  quand relire ce que les routes du widget lisent déjà.
- Une version avec ces événements demande la fonction de catalogue
  `steam-events` : le catalogue la propose à OverCrow 0.9.0-beta.1 ou
  plus récent, et une application plus ancienne garde la version
  précédente.
- OverCrow regarde les dates des fichiers de stats du client Steam sur cet
  ordinateur, seulement pour le compte que le widget nomme et seulement
  quand un widget écoute. Il n'y lit rien, et le widget n'apprend que le
  jeu et l'heure.

`steam.events.subscribe` prend le SteamID64 du compte que le widget suit
et transmet ses événements :

<!-- source: docs/content/examples/steam-stats/logic.ts -->
```ts
  let lastSeq = 0;

  events = steam.events.subscribe({ steamid }, (update) => {
    if (!update.ok) return;
    for (const event of update.value.events) {
      if (event.seq <= lastSeq) continue; // seen in an earlier update
      lastSeq = event.seq;
      void load();
    }
  });
```

- `stats.saved` arrive à chaque succès obtenu, mais aussi à d'autres
  moments (lancement d'un jeu, synchronisation de Steam, plusieurs jeux
  d'affilée) : relisez les succès, au plus toutes les quelques secondes,
  sans attendre forcément du nouveau. L'API Web de Steam peut répondre
  l'ancienne liste pendant quelques secondes.
- `state` vaut `live` tant qu'OverCrow surveille le client Steam de cet
  ordinateur, `off` sinon, avec `reason` `connecting`, `not_connected`
  (Steam n'est pas connecté) ou `unavailable` (aucun client Steam trouvé).
  Le joueur peut jouer sur un autre ordinateur : continuez aussi à lire à
  votre rythme.
- `seq`, `at`, `types` et le scénario de test marchent comme pour Twitch
  ci-dessus ; `data` vaut `{ appid }`. Un seul abonnement par widget à la
  fois : un autre échoue avec `busy`.

| Type | Version | Données |
| --- | --- | --- |
| `stats.saved` | 1 | `appid` |

## Référence

### `permissions.accounts` avec un service

<!-- generated:integrated-service-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `service` | `steam` \| `twitch` | oui | Un service intégré de la table : PlayerVox définit ses origines, l’envoi du secret, sa page de clé ou son client OAuth et les chemins qu’aucun widget n’atteint ; l’utilisateur le connecte une fois et chaque widget qui le nomme partage la connexion. L’`id` du compte est celui du service : la clé de permission est `account:<service>` et les routes le nomment dans `account`. Seuls `scopes`, `required` et `events` l’accompagnent. |
| `scopes` | liste de `scope name` ≤ 16 | non | Services OAuth seulement : scopes distincts parmi ceux que le service propose, tous en lecture seule dans la version 1 ; aucun par défaut. |
| `required` | booléen | non | Comme pour un compte déclaré ; `true` par défaut. |
| `events` | liste de `event type` ≤ 32 | non | Seulement pour un service à événements (Twitch, Steam) : types distincts de la table du service, chacun lu par un scope parmi `scopes` quand il en a un. Ceux de Twitch viennent de la propre chaîne de l'utilisateur par `twitch.events.subscribe` ; ceux de Steam, du client Steam de l'ordinateur de l'utilisateur, pour le compte que le widget nomme, par `steam.events.subscribe`. Hors du détail de la permission : un événement dit ce que les routes du service lisent déjà. Demande la fonction `twitch-events` ou `steam-events`. |
<!-- /generated:integrated-service-fields -->

### Les services

<!-- generated:integrated-services -->
| Service | Connexion | Clé ou jeton envoyé à | Images | Chemins permis | Chemins refusés |
| --- | --- | --- | --- | --- | --- |
| `steam` | clé personnelle | `https://api.steampowered.com` | `https://avatars.steamstatic.com`, `https://avatars.fastly.steamstatic.com`, `https://avatars.akamai.steamstatic.com`, `https://steamcdn-a.akamaihd.net`, `https://cdn.akamai.steamstatic.com`, `https://shared.akamai.steamstatic.com`, `https://shared.fastly.steamstatic.com` | `/ISteamUser/`, `/IPlayerService/`, `/ISteamUserStats/`, `/ISteamApps/`, `/ISteamNews/` | `/IEconService/`, `/IGameServersService/`, `/IBroadcastService/`, `/ISteamUserAuth/`, `/IAuthenticationService/`, `/ITwoFactorService/`, `/IEconMarketService/`, `/ISteamMicroTxn/`, `/ISteamMicroTxnSandbox/` |
| `twitch` | connexion OAuth | `https://api.twitch.tv` | `https://static-cdn.jtvnw.net` | `/helix/streams`, `/helix/users`, `/helix/channels`, `/helix/games`, `/helix/games/top`, `/helix/clips`, `/helix/videos`, `/helix/schedule`, `/helix/search/categories`, `/helix/search/channels`, `/helix/chat/emotes`, `/helix/chat/emotes/global`, `/helix/chat/badges`, `/helix/chat/badges/global`, `/helix/goals` (`channel:read:goals`), `/helix/channels/followers` (`moderator:read:followers`), `/helix/hypetrain/status` (`channel:read:hype_train`), `/helix/polls` (`channel:read:polls`), `/helix/predictions` (`channel:read:predictions`), `/helix/subscriptions` (`channel:read:subscriptions`), `/helix/bits/leaderboard` (`bits:read`), `/helix/charity/campaigns` (`channel:read:charity`), `/helix/charity/donations` (`channel:read:charity`), `/helix/channels/ads` (`channel:read:ads`), `/helix/channels/vips` (`channel:read:vips`), `/helix/chat/chatters` (`moderator:read:chatters`) | `/helix/streams/key`, `/helix/extensions/`, `/helix/eventsub/` |
<!-- /generated:integrated-services -->

### Scopes

<!-- generated:integrated-scopes -->
| Service | Scope | Ce qu’il lit |
| --- | --- | --- |
| `twitch` | `channel:read:goals` | vos objectifs |
| `twitch` | `moderator:read:followers` | vos followers |
| `twitch` | `channel:read:hype_train` | vos Hype Trains |
| `twitch` | `channel:read:polls` | vos sondages |
| `twitch` | `channel:read:predictions` | vos prédictions |
| `twitch` | `channel:read:subscriptions` | vos abonnés |
| `twitch` | `bits:read` | vos Bits |
| `twitch` | `channel:read:charity` | vos collectes caritatives |
| `twitch` | `channel:read:ads` | vos publicités |
| `twitch` | `channel:read:vips` | vos VIP |
| `twitch` | `moderator:read:chatters` | les spectateurs de votre chat |
<!-- /generated:integrated-scopes -->
