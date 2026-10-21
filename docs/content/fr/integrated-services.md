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
    "accounts": [{ "service": "steam" }],
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
- Seuls `scopes` et `required` accompagnent `service`. Les origines, l’envoi
  et la page de clé viennent de la table de PlayerVox ci-dessous.
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

## Référence

### `permissions.accounts` avec un service

<!-- generated:integrated-service-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `service` | `steam` \| `twitch` | oui | Un service intégré de la table : PlayerVox définit ses origines, l’envoi du secret, sa page de clé ou son client OAuth et les chemins qu’aucun widget n’atteint ; l’utilisateur le connecte une fois et chaque widget qui le nomme partage la connexion. L’`id` du compte est celui du service : la clé de permission est `account:<service>` et les routes le nomment dans `account`. Seuls `scopes` et `required` l’accompagnent. |
| `scopes` | liste de `scope name` ≤ 16 | non | Services OAuth seulement : scopes distincts parmi ceux que le service propose, tous en lecture seule dans la version 1 ; aucun par défaut. |
| `required` | booléen | non | Comme pour un compte déclaré ; `true` par défaut. |
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
