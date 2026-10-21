# Comptes tiers

Un widget peut utiliser le compte du joueur sur un autre service (l’API
d’un jeu, une plateforme de streaming, un site qui accepte de travailler
avec les widgets) sans jamais voir le secret. PlayerVox OverCrow garde la
clé ou la connexion dans le trousseau du système, la demande dans son
propre panneau et ne l’ajoute qu’aux requêtes des règles réseau qui nomment
le compte. Le widget reçoit les réponses, jamais le secret.

Deux façons d’entrer :

- **Une clé personnelle.** Le joueur crée une clé ou un jeton personnel chez
  le service et la colle dans le panneau d’OverCrow, en mode Interactif
  seulement.
- **Une connexion OAuth.** Le joueur clique sur « Connecter », approuve chez
  le service dans le navigateur (ou saisit un code), et c’est tout. Vous
  enregistrez chez le service un client **public** : PKCE, une redirection
  `http://127.0.0.1` sur un port quelconque ou le code d’appareil, et aucun
  secret client.

Un widget ne demande jamais de mot de passe, ni de clé dans un de ses
propres champs : chaque frappe dans un champ du widget arrive dans son code,
et le champ s’affiche sur un stream.

Steam et Twitch sont des **services intégrés** : le joueur les connecte une
fois dans PlayerVox OverCrow et vos widgets les nomment avec
`{ "service": "steam" }` au lieu de déclarer un compte ; un compte déclaré
ne peut pas les viser. Voyez [Services intégrés](integrated-services.md).

## Une clé personnelle

Déclarez le compte dans `permissions.accounts`, puis nommez-le avec
`account` sur chaque route qui a besoin de la clé :

<!-- source: docs/content/examples/run-log/manifest.json -->
```json
    "accounts": [
      {
        "id": "runlog",
        "name": "Run Log",
        "mode": "key",
        "origins": ["https://api.runlog.example"],
        "send": { "header": "X-Api-Key" },
        "key": {
          "format": { "charset": "alnum", "minLength": 40, "maxLength": 40 },
          "page": "https://runlog.example/settings/api"
        },
        "refusedStatus": [401, 403]
      }
    ],
    "network": [
      {
        "origin": "https://api.runlog.example",
        "method": "GET",
        "path": "/v1/me/runs/latest",
        "maxResponseBytes": 16384,
```

- `id` nomme le compte : la permission est `account:runlog`, et les appels
  du SDK l’utilisent.
- `name` est le nom du service tel qu’OverCrow l’affiche (« Compte Run Log »).
- `origins` liste les adresses du service. Avec un compte, toute règle
  réseau du widget vise l’une d’elles.
- `send` dit où va la clé : un en-tête (`{ "header": "X-Api-Key" }`, ou
  `Authorization` avec un `scheme`), ou un paramètre de requête
  (`{ "query": "key" }`) quand le service n’accepte rien d’autre.
- `key.format` permet à OverCrow de refuser une clé mal saisie avant de
  l’envoyer ; `key.page` est l’adresse où le joueur en obtient une. OverCrow
  affiche son domaine et l’ouvre sur un clic.
- `refusedStatus` est le statut par lequel le service refuse la clé (401 par
  défaut). OverCrow marque alors le compte refusé et demande une autre clé ;
  l’appel échoue avec `account_refused`.

## Une connexion OAuth

<!-- source: docs/content/examples/quest-log/manifest.json -->
```json
    "accounts": [
      {
        "id": "quests",
        "name": "Quest Log",
        "mode": "oauth",
        "required": false,
        "origins": ["https://api.quests.example", "https://quests.example"],
        "oauth": {
          "clientId": "nova-overcrow-widget",
          "flow": "loopback",
          "authorize": "https://quests.example/oauth/authorize",
          "token": "https://quests.example/oauth/token",
          "revoke": "https://quests.example/oauth/revoke",
          "scopes": [{ "name": "quests:read", "access": "read" }]
```

- `clientId` est votre client public chez le service. Ce n’est pas un
  secret ; un secret client n’a pas de champ et serait refusé.
- `flow` vaut `loopback` (le navigateur du système, puis une redirection
  vers OverCrow sur `127.0.0.1`) ou `device` (un code que le joueur saisit
  sur la page `verify` du service).
- `token`, et `device`, `revoke` et `validate` s’ils sont déclarés, sont sur
  une des `origins` du compte : OverCrow leur envoie le code, le
  vérificateur ou les jetons. Aucune route du widget ne peut viser un de ces
  points.
- Les `scopes` lisent par défaut. Un scope `write`, comme une route qui ne
  fait pas `GET`, peut modifier le compte du joueur : il est justifié, relu
  et montré au joueur.
- `scopeParam` nomme le paramètre des scopes dans les requêtes d’OverCrow
  vers `device` et `token`, pour un service qui veut `scopes` ;
  `clientIdHeader` envoie aussi l’identifiant client dans un en-tête
  (Twitch : `Client-Id`).
- `required: false` laisse le widget fonctionner sans le compte et montrer
  son propre bouton. Avec `required` (par défaut), OverCrow couvre le
  contenu du widget tant que le compte n’est pas connecté.

### Ce qu’OverCrow ouvre, lit et envoie

- **Vos pages de connexion restent chez votre service.** `authorize` et
  `verify` sont les pages où le joueur se connecte et autorise votre
  widget : les pages de votre service, qui n’envoient jamais le joueur chez
  un autre fournisseur (Twitch, Google…) ni chez un service qu’OverCrow
  intègre. Un widget dont la connexion aboutit chez un autre fournisseur,
  ou qui lui demande d’autres scopes que sa déclaration, est refusé.
- **La page d’autorisation** est `authorize` avec `response_type`,
  `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge` et
  `code_challenge_method=S256` : 2 Kio au plus en tout. Un `authorize` long
  ou beaucoup de scopes peuvent les dépasser, et la connexion ne démarre
  pas.
- **La redirection.** OverCrow lit `code`, `state`, `iss` et les champs
  d’erreur, 32 champs au plus ; les autres sont ignorés. Un `iss`
  (RFC 9207), si votre service en envoie un, est en HTTPS sur l’origine
  d’`authorize`, sans chemin ou avec un chemin sous lequel se trouve
  `authorize` ; tout autre `iss` met fin à la connexion.
- **Les réponses.** De `token`, OverCrow lit `access_token` (avec un
  `token_type` `Bearer`), `refresh_token`, `expires_in` et `scope` ; de
  `device`, `device_code`, `user_code`, `verification_uri`, `expires_in` et
  `interval`. Tout autre champ est ignoré.
- **La déconnexion.** OverCrow efface d’abord les jetons, puis envoie le
  jeton d’accès et `client_id` à `revoke` (RFC 7009). Toute réponse HTTP
  vaut fait. Un service injoignable est réessayé plus tard tant qu’OverCrow
  tourne, au mieux : la déconnexion ne l’attend jamais.

Un service qui refuse un client public (secret client à l’échange, port de
redirection exact, plafond pour les applications non validées) ne peut pas
être utilisé. [Rendre votre service compatible avec les
widgets](compatible-services.md) dit ce dont un service a besoin.

## Confinement

Un widget qui a un compte ne parle qu’à ce service :

- un compte par widget, toutes les règles réseau sur une de ses `origins` ;
- aucune capacité sensible et pas de presse-papiers ;
- deux règles de même origine et même méthode qui peuvent viser la même URL
  nomment le même compte, ou aucun, pour que la clé n’aille jamais où le
  widget n’a pas dit qu’elle irait ;
- aucune route sur un point OAuth, ni sur une route qui crée, liste ou
  renvoie des clés ou des jetons : sa réponse arriverait dans le code du
  widget ;
- le stockage du widget est effacé quand le compte quitte le widget.

## Dans la logique

Le widget suit l’état du compte avec `account.subscribe` : `signed_out`,
`pending`, `connected`, `refused` ou `expired`. Il ne voit jamais le nom du
compte, ses scopes ni son secret.
Le SDK les exporte sous `account` (de type `AccountServices`), avec la forme
`AccountStatus`, et `hasGrant` accepte un `AccountGrant` comme
`account:runlog`.

<!-- source: docs/content/examples/run-log/logic.ts -->
```ts
// Read again as soon as the key is saved or replaced.
account.subscribe({ id: "runlog" }, (update) => {
  if (update.ok && update.value.state === "connected") {
    void load();
  }
});
```

Un appel sur une route du compte échoue avec `not_connected` tant que le
compte n’est pas connecté, et avec `account_refused` quand le service vient
de refuser le secret. OverCrow affiche son propre panneau ; le widget
attend :

<!-- source: docs/content/examples/run-log/logic.ts -->
```ts
  } catch (error) {
    // not_connected until the player saves a key, account_refused when the
    // service refuses it: OverCrow shows its own panel, the widget waits.
    const code = error instanceof ServiceError ? error.code : "";
    state.status = code === "not_connected" || code === "account_refused" ? code : "unavailable";
  }
}
```

Un compte qui n’est pas `required` se connecte depuis le bouton du widget,
sur une action de l’utilisateur :

<!-- source: docs/content/examples/quest-log/logic.ts -->
```ts
// Called on a click: OverCrow opens its panel for the account.
export function connect(): void {
  void account.connect({ id: "quests" });
}
```

## Tests

Dans un [scénario de test](testing.md), `host.accounts` donne l’état de
chaque compte par identifiant : `playervox` et `twitch`, et les comptes que
le manifeste déclare ou les services intégrés qu’il nomme (`connected` par défaut ; `connected`, `disconnected`,
`pending`, `refused` ou `expired`). Une fixture HTTP ajoute
`"account": "runlog"` à sa `request` quand la requête part avec le compte :
une fixture ne répond qu’à une requête envoyée comme elle le dit, donc le
scénario vérifie que la clé va où elle doit. Une fixture dont le statut est
dans `refusedStatus` joue un refus.

Dans les tests unitaires, `@overcrow/sdk/testing` prend `accounts` à
l’installation, et `setAccount(id, state)` envoie un nouvel état aux
abonnements du widget.

## Revue

Pour un widget qui a un compte, le relecteur vérifie :

- que chaque origine, celles des points OAuth comprises, appartient au
  service, avec un lien vers sa documentation ;
- que chaque route qui peut modifier le compte, et chaque scope `write`, est
  justifié ;
- qu’aucune route ne crée, ne liste ni ne renvoie des clés, des jetons ou
  des connexions (clé de stream Twitch, secrets d’extension, jetons de
  socket Streamlabs) ;
- qu’aucun champ du widget ne demande une clé, un jeton ou un mot de passe ;
- le widget avec un compte de test chez le service. Ne mettez jamais de clé
  ni de mot de passe dans le message pour la revue.

## Référence

### `permissions.accounts`

<!-- generated:account-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `id` | identifiant ≤ 32 octets | oui | `[a-z][a-z0-9-]` de 2 octets à 32 octets, sans `-` final ni double ; `playervox` est réservé, et l’ID d’un service intégré (`steam`, `twitch`) est refusé : nommez le service à la place. La clé de permission est `account:<id>` ; une règle réseau le nomme dans `account`. |
| `name` | texte ≤ 32 caractères | oui | Le nom du service tel que l’hôte l’affiche, texte simple d’au plus 32 caractères ; un nom qui se lit comme PlayerVox, OverCrow ou Valhallab est refusé, de même qu’un nom qui se lit comme un service intégré (Steam, Valve, Twitch). |
| `mode` | `key` \| `oauth` | oui | `key` : une clé ou un jeton personnel que l’utilisateur colle dans le panneau de l’hôte. `oauth` : une connexion avec le client OAuth public de l’éditeur. Seul l’objet du mode est présent. |
| `origins` | liste de `origin` ≤ 4 | oui | Origines HTTPS canoniques et distinctes du service, comme dans les règles réseau, aucune d’un service intégré. Chaque règle réseau du widget vise l’une d’elles. |
| `required` | booléen | non | Par défaut `true` : l’hôte couvre le contenu tant que le compte n’est pas connecté. `false` : le widget fonctionne sans lui et ouvre le panneau de l’hôte avec `account.connect`. |
| `refusedStatus` | `list of 401 and 403` | non | Statuts distincts, parmi 401 et 403, par lesquels le service refuse le secret sur une route du compte ; par défaut `[401]`. Une telle réponse marque le compte refusé (clé) ou expiré (OAuth) et l’appel échoue avec `account_refused`. |
| `send` | `AccountSend` | non | Mode clé seulement, requis dans ce mode : comment l’hôte envoie la clé. |
| `key` | `AccountKey` | non | Mode clé seulement, requis dans ce mode. |
| `oauth` | `AccountOAuth` | non | Mode OAuth seulement, requis dans ce mode. L’hôte envoie toujours `Authorization: Bearer <token>`. |
<!-- /generated:account-fields -->

### `send`

<!-- generated:account-send -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `header` | texte ≤ 64 octets | non | En-tête qui porte la clé : un jeton HTTP, pas un en-tête que l’hôte pose lui-même (`Host`, `Cookie`, `Content-*`, `Accept*`, `If-*`, `User-Agent`, `Referer`, `Origin`, `Connection`, `Proxy-*`, `Sec-*`, `X-Forwarded-*`…). Exactement un de `header` et `query`. |
| `scheme` | texte ≤ 16 octets | non | Avec `header: "Authorization"` seulement : un mot `[A-Za-z][A-Za-z0-9-]*` envoyé avant la clé (`<scheme> <key>`). |
| `query` | texte ≤ 32 octets | non | Paramètre de requête qui porte la clé, un nom de paramètre des règles réseau ; aucune route du compte ne le déclare dans `queryParams`. Préférez un en-tête. |
<!-- /generated:account-send -->

### `key`

<!-- generated:account-key -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `format` | `KeyFormat` | oui | À quoi ressemble une clé ; l’hôte en refuse une autre à la saisie. |
| `page` | texte ≤ 512 octets | oui | La page du service où l’utilisateur obtient une clé : origine `https://` canonique, chemin et requête statique facultative, sans fragment ni identifiants. L’hôte l’ouvre sur un clic dans son panneau. |
<!-- /generated:account-key -->

### `key.format`

<!-- generated:key-format -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `charset` | `hex` \| `alnum` \| `base64url` \| `base64` \| `printable` | oui | Caractères d’une clé : `hex` (`0-9a-fA-F`), `alnum` (lettres et chiffres ASCII), `base64url` (`alnum`, `-`, `_`, `=`), `base64` (`alnum`, `+`, `/`, `=`) ou `printable` (ASCII de `!` à `~`). |
| `minLength` | entier de 8 à 512 | oui | Clé la plus courte, de 8 octets à `maxLength`. |
| `maxLength` | entier de 8 à 512 | oui | Clé la plus longue, de `minLength` à 512 octets. |
<!-- /generated:key-format -->

### `oauth`

<!-- generated:account-oauth -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `clientId` | texte ≤ 128 octets | oui | Le client public de l’éditeur chez le service : lettres et chiffres ASCII, `-`, `.`, `_` et `~`. Il n’y a pas de secret client. |
| `flow` | `loopback` \| `device` | oui | `loopback` : le navigateur du système et une redirection `http://127.0.0.1:<port>/callback`, PKCE S256. `device` : un code que l’utilisateur saisit sur la page du service (RFC 8628). |
| `authorize` | texte ≤ 512 octets | non | Point d’autorisation ; `loopback` seulement, requis dans ce flux. Chaque point est une origine `https://` canonique et un chemin, sans requête, fragment ni identifiants. |
| `token` | texte ≤ 512 octets | oui | Point de jeton. `token`, `device`, `revoke` et `validate` sont sur une des `origins` du compte : l’hôte leur envoie le code, le vérificateur ou les jetons. |
| `device` | texte ≤ 512 octets | non | Point d’autorisation d’appareil ; `device` seulement, requis dans ce flux. |
| `verify` | texte ≤ 512 octets | non | La page où l’utilisateur saisit le code ; `device` seulement, requise dans ce flux. La `verification_uri` du service doit lui être égale. |
| `revoke` | texte ≤ 512 octets | non | Point de révocation (RFC 7009), appelé à la déconnexion. |
| `validate` | texte ≤ 512 octets | non | Point de validation du jeton, appelé avec le jeton à la connexion puis toutes les heures tant que le widget tourne ; un statut de `refusedStatus` marque le compte expiré. Son corps n’est jamais lu. |
| `scopes` | liste de `AccountScope` ≤ 16 | oui | Scopes que l’hôte demande, distincts par nom. |
| `scopeParam` | `scope` \| `scopes` | non | Nom du paramètre des scopes dans les requêtes de l’hôte vers `device` et `token` ; par défaut `scope`. La requête d’autorisation utilise toujours `scope`. |
| `clientIdHeader` | texte ≤ 64 octets | non | En-tête qui porte aussi `clientId` sur les routes du compte (Twitch : `Client-Id`) ; les règles de `send.header`, `Authorization` exclu. |
<!-- /generated:account-oauth -->

### `oauth.scopes`

<!-- generated:account-scope -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `name` | texte ≤ 128 octets | oui | Lettres et chiffres ASCII, `-`, `.`, `_`, `:` et `/`, rien qu’un service décode ou découpe ; un nom dont les lettres et chiffres contiennent `streamkey`, en majuscules ou non (`stream_key`, `stream-key`…), est refusé. |
| `access` | `read` \| `write` | oui | Si le scope peut modifier le compte de l’utilisateur ; `write` est montré à l’utilisateur et relu. |
<!-- /generated:account-scope -->

### Services

<!-- generated:account-services -->
### `account.subscribe`

- **Nature** : abonnement
- **Exige** : un compte déclaré et accordé (`id`)
- **Quand l’appeler** : À tout moment
- **Paramètres** : `id` : identifiant ≤ 32 octets
- **Chaque mise à jour** : `{ state }` aussitôt, puis à chaque changement : `signed_out`, `pending` (une étape de connexion est ouverte), `connected`, `refused` (le service a refusé la clé) ou `expired` (le service demande de se reconnecter). Le widget ne voit jamais le secret, le nom du compte ni ses scopes ; avec `required`, l’hôte couvre le contenu tant que le compte n’est pas connecté
- **Forme** : [`AccountStatus`](#accountstatus)

### `account.connect`

- **Nature** : appel, à réponse unique
- **Exige** : un compte déclaré et accordé (`id`)
- **Quand l’appeler** : Seulement pendant une action de l’utilisateur
- **Paramètres** : `id` : identifiant ≤ 32 octets
- **Résultat** : `null` ; l’hôte affiche son panneau pour ce compte, dans son état du moment : le bouton du widget pour un compte qui n’est pas `required`
- **Forme** : `null`
<!-- /generated:account-services -->

<!-- generated:account-shapes -->
### `AccountStatus`

État d’un compte tiers que le widget déclare. `{ state }`

| Membre | Forme | Signification |
| --- | --- | --- |
| `state` | `signed_out` \| `pending` \| `connected` \| `refused` \| `expired` | État du compte ; la connexion est dessinée par l’hôte. |
<!-- /generated:account-shapes -->

### Erreurs

| Code | Sens |
| --- | --- |
| `not_connected` | Le service a besoin d’un compte de l’utilisateur qui n’est pas connecté pour le moment : PlayerVox, un service intégré (Steam, Twitch) ou le compte que le widget déclare. |
| `account_refused` | Le service a refusé la clé ou la connexion du compte sur cette route. Le compte est maintenant `refused` ou `expired`, et PlayerVox OverCrow demande à l’utilisateur une nouvelle clé ou une nouvelle connexion. |
