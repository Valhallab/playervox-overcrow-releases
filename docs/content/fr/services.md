# Services et permissions

Un widget PlayerVox OverCrow n’a aucun accès par lui-même : ni réseau, ni
fichier, ni presse-papiers, ni donnée sur le jeu. Tout ce qui sort de son
propre état vient d’un **service** d’OverCrow, que la logique appelle par
`@overcrow/sdk`. Un service ne répond que si le widget a déclaré la
permission correspondante dans son manifeste et que l’utilisateur l’a
accordée.

<!-- source: widgets/session/logic.ts -->
```ts
// Without the grant the host would refuse the subscription: show the
// unknown duration instead of asking.
if (hasGrant("session.read")) {
  session.subscribe((update) => {
    state.session = anchor(update);
  });
}
```

C’est tout l’usage d’un service dans le widget Session : il déclare la
capability `session.read`, vérifie que l’utilisateur l’a accordée, puis
s’abonne.

## Déclarer, puis demander à l’utilisateur

Il existe deux sortes d’autorité, toutes deux déclarées dans `permissions`
du [manifeste](manifest.md#permissions) :

- quatre **permissions** pour les services généraux : `network`, `storage`,
  `clipboardWrite` et `gameEvents` ;
- des **capabilities**, listées sous `permissions.capabilities`, pour les
  données et les actions d’OverCrow lui-même et des comptes de
  l’utilisateur : la fréquence d’images, le lecteur multimédia, les notes de
  l’utilisateur, la note qu’il donne à un jeu sur PlayerVox, le chat
  Twitch…

<!-- source: docs/content/examples/weather/manifest.json -->
```json
  "permissions": {
    "network": [
      {
        "origin": "https://api.example.com",
        "method": "GET",
        "path": "/v1/forecast/{city}",
        "pathParams": { "city": { "type": "slug", "maxLength": 32 } },
        "queryParams": {
          "units": { "type": "enum", "values": ["metric", "imperial"], "required": true }
        }
      }
    ],
    "storage": true
  },
```

Une déclaration n’accorde rien à elle seule. OverCrow montre à
l’utilisateur ce que le widget demande ; celui-ci peut refuser l’une de ces
autorisations, ou la retirer plus tard. Le retrait arrête d’abord le
widget. Les widgets marqués `built-in` dans le catalogue signé (widgets
PlayerVox uniquement) démarrent avec leurs permissions déclarées accordées.
Déclarez le strict nécessaire : les relecteurs lisent chaque permission, et
les utilisateurs les voient avant de donner leur accord.

`hasGrant(capability)` indique si une capability a été accordée.
Vérifiez-le avant de vous abonner, et affichez un état utile quand elle
manque : même après un refus, le widget doit rester présentable.

<!-- source: widgets/fps/logic.ts -->
```ts
if (hasGrant("fps.read")) {
  fps.subscribe((update) => {
    Object.assign(state, reading(update));
  });
} else {
  state.status = "unavailable";
}
```

## Appels et abonnements

Il existe deux sortes de services.

**Un appel** pose sa question une fois et renvoie une promesse :

<!-- source: widgets/warframe-market/logic.ts -->
```ts
async function readStored(key: string): Promise<JsonValue | undefined> {
  try {
    return await storage.get({ key });
  } catch {
    state.error = "storage_unavailable";
    return undefined;
  }
}
```

**Un abonnement** prend un écouteur. OverCrow l’appelle aussitôt avec la
valeur courante, puis à chaque nouvelle valeur, jusqu’à ce que vous
l’annuliez avec `cancel()` ou qu’il se termine par un échec. L’écouteur
vient en dernier ; un service qui a des paramètres les prend en premier.

<!-- source: widgets/media/logic.ts -->
```ts
  const current = media.subscribe({ cover: state.showCover }, (update) => {
    if (update.ok) {
      state.media = update.value;
      state.unavailable = false;
      return;
    }
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.media = null;
      state.unavailable = true;
      retry = timers.after(RETRY_MS, subscribe);
    }
  });
```

Chaque mise à jour vaut `{ ok: true, value, final }` ou
`{ ok: false, error, final: true }`. Une mise à jour en échec est toujours
la dernière : l’abonnement est terminé.

Les services sont regroupés dans des espaces de noms du SDK : `storage`,
`http`, `clipboard`, `gameEvents`, et un par source de données (`fps`,
`telemetry`, `session`, `media`, `stopwatch`, `notes`, `playervox`,
`journal`, `twitch`). Chaque service figure, avec ses paramètres et son
résultat, dans la [référence des services](service-reference.md).

OverCrow vérifie chaque appel à son arrivée, dans cet ordre : la permission
ou la capability, les paramètres, l’action de l’utilisateur quand le
service en demande une, puis le compte quand il en faut un. Les types du
SDK vous aident à appeler correctement un service ; ce ne sont pas eux qui
font respecter les règles.

## Erreurs

Un appel qui échoue rejette sa promesse avec une `ServiceError`, dont le
`code` dit pourquoi. Un abonnement qui échoue livre la même erreur dans sa
dernière mise à jour.

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
  try {
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const value = (body as { temperature?: unknown } | null)?.temperature;
    if (status !== 200 || typeof value !== "number") {
      state.status = "unavailable";
      return;
    }
    state.temperature = value;
    state.status = "updated";
    await storage.set({ key, value });
  } catch (error) {
    // permission_denied until the user consents, transport_failed offline…
    state.status = error instanceof ServiceError ? "unavailable" : "failed";
  }
```

<!-- generated:error-codes -->
| Code | Signification |
| --- | --- |
| `invalid_request` | Les paramètres ne sont pas ceux que le service attend : un membre manque ou est inconnu, n’a pas le bon type ou sort de ses limites. |
| `permission_denied` | La permission ou la capability n’est pas déclarée dans le manifeste, ou l’utilisateur ne l’a pas accordée. Pour `http.fetch`, aucune règle réseau n’autorise cette URL et cette méthode. Une écriture par formulaire peut aussi le recevoir du fournisseur du compte, pour une écriture qu’il n’autorise pas. |
| `gesture_required` | Le service ne peut être appelé que pendant une action de l’utilisateur, et cet appel n’a pas eu lieu pendant le traitement d’une telle action, ou cette action a déjà autorisé un autre appel. |
| `not_connected` | Le service a besoin du compte PlayerVox ou Twitch de l’utilisateur, qui n’est pas connecté pour le moment. |
| `stale_context` | Ce sur quoi portait l’appel a changé avant la réponse : un autre jeu, un autre compte, un autre lecteur multimédia, un objet supprimé entre-temps. Relisez l’état courant. |
| `unavailable` | La source d’OverCrow pour ces données a échoué, ou ne peut pas agir pour l’instant. Un abonnement qui se termine ainsi peut être relancé plus tard. |
| `busy` | Trop d’opérations sont en cours : une confirmation est déjà ouverte, une file ou le budget des réponses réseau est plein, ou le fournisseur demande d’attendre. Réessayez plus tard. |
| `cancelled` | L’utilisateur a refusé la confirmation, ou a quitté le mode interactif pendant qu’elle était ouverte. |
| `quota_exceeded` | Un quota est atteint : le stockage, les minuteurs, les notes, les chaînes favorites. |
| `unsupported` | La cible ne sait pas le faire : un lecteur multimédia qui ne propose pas la commande, par exemple. |
| `url_invalid` | `http.fetch` : l’URL n’est pas une URL HTTPS absolue qu’OverCrow accepte. |
| `resolve_failed` | `http.fetch` : le nom d’hôte n’a pas pu être résolu. |
| `address_denied` | `http.fetch` : le nom d’hôte se résout en une adresse locale, privée ou non publique. |
| `too_many_addresses` | `http.fetch` : le nom d’hôte se résout en plus d’adresses qu’OverCrow n’en accepte. |
| `peer_mismatch` | `http.fetch` : le serveur qui a répondu n’est pas à l’une des adresses résolues et vérifiées. |
| `redirect_denied` | `http.fetch` : le serveur a répondu par une redirection. OverCrow n’en suit aucune : déclarez et demandez l’URL finale. |
| `encoding_denied` | `http.fetch` : la réponse est compressée ou encodée d’une façon qu’OverCrow n’accepte pas, ou son corps ne se décode pas comme `as` le demande (JSON ou texte invalide). |
| `content_type_denied` | `http.fetch` : le type de média de la réponse n’est pas de ceux qu’OverCrow accepte pour cette requête. |
| `response_metadata_limit` | `http.fetch` : la ligne d’état ou les en-têtes de la réponse sont mal formés ou dépassent les limites d’OverCrow. |
| `request_body_limit` | `http.fetch` : le corps de la requête dépasse 256 Kio. |
| `response_body_limit` | `http.fetch` : le corps de la réponse dépasse la limite de la règle réseau (`maxResponseBytes`, ou 1 Mio sans lui et pour `as: "image"`). |
| `image_invalid` | `http.fetch` avec `as: "image"` : la réponse n’est pas une image PNG, JPEG ou WebP dans les limites des images. |
| `timeout` | `http.fetch` : l’échange a duré plus de 30 secondes. |
| `transport_failed` | `http.fetch` : la connexion a échoué : pas de réseau, erreur TLS, connexion fermée par le serveur. |
<!-- /generated:error-codes -->

Trois habitudes couvrent la plupart des cas :

- **Affichez un état, pas un message d’erreur.** Les codes servent à votre
  logique ; l’utilisateur voit « Prévisions indisponibles », pas
  `transport_failed`.
- **Réabonnez-vous quand un abonnement s’est terminé.** Une source
  d’OverCrow peut échouer pendant que le widget tourne (la session du
  lecteur multimédia, par exemple) : l’abonnement se termine avec
  `unavailable`. Réabonnez-vous quelques secondes plus tard avec
  `timers.after` ; OverCrow relance la source pour le nouvel abonnement. Le
  widget Média attend cinq secondes :

<!-- source: widgets/media/logic.ts -->
```ts
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.media = null;
      state.unavailable = true;
      retry = timers.after(RETRY_MS, subscribe);
    }
```

- **Ne réessayez pas en boucle.** `busy` et `quota_exceeded` signalent
  qu’une limite est atteinte : attendez, ou faites-en moins.

## Les appels qui demandent une action de l’utilisateur

Les services qui changent quelque chose pour l’utilisateur, ou qui déposent
quelque chose là où d’autres programmes le lisent, s’appellent **seulement
pendant une action de l’utilisateur** : pendant que la logique traite l’un
de ces événements de la vue.

<!-- generated:gesture-events -->
`activate`, `contextmenu`, `keydown`, `input`, `change`, `submit`.
<!-- /generated:gesture-events -->

<!-- source: widgets/stopwatch/logic.ts -->
```ts
export function toggle(): void {
  command(() => stopwatch.toggle());
}
```

`toggle` est le gestionnaire `on:activate` du bouton du chronomètre : le
clic est l’action de l’utilisateur, et `stopwatch.toggle()` est appelé
pendant son traitement. Le même appel depuis un minuteur, depuis la réponse
d’un autre service, depuis `onHost` ou depuis une ligne du menu d’options
est refusé avec `gesture_required`.

- Une action de l’utilisateur autorise un seul appel protégé. Appelez le
  service directement dans le gestionnaire, pas après un `await` sur autre
  chose.
- Les widgets ne reçoivent d’entrées qu’en mode interactif d’OverCrow : un
  appel protégé ne peut donc avoir lieu que dans ce mode.
- `notes.delete` et `journal.delete` demandent en plus une confirmation à
  l’utilisateur, dans une boîte de dialogue dessinée par OverCrow ; une
  confirmation refusée donne `cancelled`.

Les tableaux ci-dessous indiquent, pour chaque service, quand l’appeler.

## Permissions

<!-- generated:permission-list -->
| Permission | Signification | Avec une capability sensible |
| --- | --- | --- |
| `network` | Routes HTTPS exactes, joignables par le broker de l’hôte ; au plus 32 règles. | manifeste refusé |
| `storage` | Stockage clé-valeur tenu par l’hôte, cloisonné par ID de widget, dans la limite de 256 Kio. | données conservées le temps du processus seulement |
| `clipboardWrite` | Écriture de texte dans le presse-papiers, pendant une action de l’utilisateur en mode interactif. | manifeste refusé |
| `gameEvents` | Événements de jeu sémantiques nommés `overcrow.game.<name>.v1`, au plus 32. | admis |
| `capabilities` | Services de l’hôte listés avec les capabilities. | admis |
<!-- /generated:permission-list -->

<!-- generated:permissions -->
| Permission | Service | Quand l’appeler |
| --- | --- | --- |
| `network` | `http.fetch` | À tout moment |
| `storage` | `storage.get` | À tout moment |
| `storage` | `storage.set` | À tout moment |
| `storage` | `storage.remove` | À tout moment |
| `storage` | `storage.keys` | À tout moment |
| `clipboardWrite` | `clipboard.writeText` | Seulement pendant une action de l’utilisateur |
| `gameEvents` | `gameEvents.subscribe` | À tout moment |

« Seulement pendant une action de l’utilisateur » est expliqué dans [Les appels qui demandent une action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).
<!-- /generated:permissions -->

### Règles réseau

`network` est une liste de règles. Une règle autorise les requêtes vers
exactement une origine HTTPS, une méthode et un chemin ; un segment
`{name}` du chemin est un paramètre typé, et seuls les paramètres de
requête déclarés sont acceptés.

<!-- source: widgets/warframe-market/manifest.json -->
```json
  "permissions": {
    "network": [
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/versions",
        "maxResponseBytes": 4096
      },
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/items",
        "maxResponseBytes": 3145728
      },
      {
        "origin": "https://api.warframe.market",
        "method": "GET",
        "path": "/v2/orders/item/{slug}/top",
        "pathParams": {
          "slug": {
            "type": "slug",
            "maxLength": 96
          }
        },
        "maxResponseBytes": 131072
      }
    ],
    "storage": true,
    "clipboardWrite": true
  }
```

<!-- generated:network-rule-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `origin` | `origin` | oui | Origine canonique `https://host[:port]`, hôte ≤ 253 octets avec des labels ≤ 63 octets ; ni identifiants, ni adresse IP littérale, ni nom local. |
| `method` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` | oui | Une seule méthode. |
| `path` | texte ≤ 1 Kio | oui | Chemin complet ; les segments `{name}` sont des paramètres de chemin typés. |
| `pathParams` | `name → ParameterConstraint` | non | Contrainte de chaque segment `{name}`, au plus 8. |
| `queryParams` | `name → ParameterConstraint` | non | Paramètres de requête admis, au plus 16, chacun éventuellement `required` ; les autres sont refusés. |
| `maxResponseBytes` | entier de 1 à 3145728 | non | Plus grand corps de réponse de cette route, de 1 à 3 Mio ; 1 Mio quand il est absent. Sans effet pour `as: "image"`, qui garde 1 Mio. Quand plusieurs règles autorisent une requête, la plus grande limite s’applique. |
<!-- /generated:network-rule-fields -->

Chaque paramètre de chemin ou de requête porte une contrainte :

<!-- generated:parameter-constraints -->
| Type | Forme | Accepte |
| --- | --- | --- |
| `integer` | `{ min, max }` | Entier décimal sans zéro initial, de 0 à 2^53 - 1. |
| `slug` | `{ maxLength }` | Lettres ASCII majuscules ou minuscules, chiffres, `_` et `-`, au moins un caractère ; `maxLength` de 1 à 128 octets. |
| `enum` | liste de `literal segment` ≤ 32 | L’une des valeurs listées, chacune ≤ 128 octets. |
| `string` | `{ maxLength }` | Paramètres de requête seulement ; tout texte sans caractère de contrôle ; `maxLength` de 1 à 256 octets. |
<!-- /generated:parameter-constraints -->

La requête sort par le broker d’OverCrow, jamais du processus du widget.
Le broker :

- refuse toute URL qu’aucune règle n’autorise (`permission_denied`), avant
  toute requête DNS ;
- ne suit aucune redirection, et n’envoie ni cookie, ni identifiant, ni
  en-tête de proxy ;
- refuse les adresses locales et privées : un widget ne peut donc pas
  joindre le routeur de l’utilisateur ni un autre programme de la machine ;
- limite chaque échange : 256 Kio pour le corps d’une requête, 30 secondes
  en tout, et 1 Mio pour le corps d’une réponse, sauf si la règle déclare
  un `maxResponseBytes` plus grand, jusqu’à 3 Mio. Les relecteurs et les
  utilisateurs voient cette limite.

`http.fetch(url, { as })` décode le corps comme vous le demandez :
`"json"`, `"text"`, `"bytes"` (un `ArrayBuffer`) ou `"image"`, qui donne, à
la place des octets, un identifiant d’image à lier à un élément `image`. Un
`body` de type chaîne est envoyé en `text/plain`, et toute autre valeur en
JSON, sauf si `contentType` en décide autrement. Un statut HTTP d’erreur
n’est pas un échec de l’appel : vérifiez `status`.

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
    const value = (body as { temperature?: unknown } | null)?.temperature;
    if (status !== 200 || typeof value !== "number") {
      state.status = "unavailable";
      return;
    }
```

Un widget a au plus quatre requêtes en cours à la fois, et elles partagent
un budget d’octets de réponse : une requête qui n’y tient pas échoue
aussitôt avec `busy`.

### Stockage

`storage` est un stockage clé-valeur qu’OverCrow tient pour votre seul
widget : `storage.get({ key })`, `storage.set({ key, value })`,
`storage.remove({ key })` et `storage.keys()`. Une valeur est n’importe
quelle valeur JSON. Il n’y a aucun accès aux fichiers.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
function setRounds(rounds: number): void {
  state.rounds = rounds;
  paint();
  // Storage needs the user's consent: without it the count lasts as long
  // as the widget runs.
  storage.set({ key: "rounds", value: rounds }).catch(() => {});
}
```

Le stockage contient au plus 512 clés et 256 Kio en tout, 64 Kio par
valeur ; au-delà, `storage.set` échoue avec `quota_exceeded` et ne change
rien. Une écriture reçoit sa réponse une fois qu’elle est sur le disque.
Désinstaller le widget efface son stockage, et une session de développement
(`overcrow-widget dev`) ne lit ni n’écrit jamais le stockage d’un widget
installé.

### Presse-papiers

`clipboard.writeText({ text })` place du texte dans le presse-papiers,
seulement pendant une action de l’utilisateur. Un widget ne peut pas lire
le presse-papiers.

<!-- source: widgets/warframe-market/logic.ts -->
```ts
  clipboard.writeText({ text: whisperLine(order, detail.name) }).then(
    () => {
      if (mine === selection) state.copy = { side, id, state: "copied" };
    },
    () => {
      if (mine === selection) state.copy = { side, id, state: "failed" };
    },
  );
```

Le texte que l’utilisateur sélectionne dans un élément `text` doté de
l’attribut `selectable` est copié par OverCrow lui-même, sans aucune
permission.

### Événements de jeu

`gameEvents` liste les événements de jeu nommés que le widget veut
recevoir, chacun de la forme `overcrow.game.<name>.v1`.
`gameEvents.subscribe(listener)` livre ensuite `{ event, at }` chaque fois
que l’un d’eux se produit.

## Capabilities

Une capability donne accès à des données ou à des actions que détient
OverCrow : les ressources qu’utilise le jeu, le lecteur multimédia, les
notes de l’utilisateur, ses comptes PlayerVox et Twitch.

<!-- generated:capability-list -->
| Capability | Sensible | Compte | Signification |
| --- | --- | --- | --- |
| `telemetry.read` | non | — | Mesures de CPU, de mémoire et de température du jeu actif. |
| `fps.read` | non | — | Fréquence d’images du jeu actif, quand l’hôte dispose d’une source. |
| `media.read` | **oui** | — | Métadonnées du morceau en cours de lecture, et l’image de sa pochette. |
| `media.control` | **oui** | — | Précédent, lecture/pause et suivant. |
| `session.read` | non | — | Durée de la session du jeu actif, sans l’identité du jeu. |
| `stopwatch.read` | non | — | État du chronomètre manuel de l’hôte, unique, et de ses raccourcis. |
| `stopwatch.control` | non | — | Démarrer, mettre en pause et réinitialiser le chronomètre manuel de l’hôte, unique. |
| `notes.read` | **oui** | — | Les notes et listes de tâches de l’utilisateur : un seul document, commun à tous les jeux. |
| `notes.write` | **oui** | — | Créer, sélectionner, enregistrer, cocher et supprimer des notes ; le texte ne passe que par un formulaire lié à un intent d’écriture. |
| `playervox.score.read` | **oui** | — | Note publique PlayerVox du jeu actif ; sensible parce qu’elle révèle le jeu. |
| `playervox.rating.read` | **oui** | PlayerVox | La note que l’utilisateur a lui-même donnée au jeu actif. |
| `playervox.rating.write` | **oui** | PlayerVox | Publier une note et un avis, par un formulaire lié à un intent d’écriture. |
| `playervox.reviews.read` | **oui** | PlayerVox | Avis des joueurs sur le jeu actif, par pages, limités sur demande aux joueurs suivis. |
| `journal.read` | **oui** | — | Sessions de jeu du jeu actif : les sessions locales, plus celles du cloud tant que PlayerVox est connecté. |
| `journal.delete` | **oui** | — | Supprimer une session du journal, après une confirmation demandée par l’hôte ; les sessions du cloud exigent PlayerVox. |
| `twitch.chat.read` | **oui** | Twitch | Rejoindre, lire et quitter le chat d’une chaîne Twitch, et conserver des chaînes favorites. |
| `twitch.chat.compose` | **oui** | Twitch | Envoyer un message dans le chat, par un formulaire lié à un intent d’écriture ; l’hôte admet 20 messages par 30 s et répond `busy` au-delà. |
<!-- /generated:capability-list -->

<!-- generated:capabilities -->
| Capability | Sensible | Service | Quand l’appeler |
| --- | --- | --- | --- |
| `telemetry.read` | non | `telemetry.subscribe` | À tout moment |
| `fps.read` | non | `fps.subscribe` | À tout moment |
| `media.read` | **oui** | `media.subscribe` | À tout moment |
| `media.control` | **oui** | `media.previous` | Seulement pendant une action de l’utilisateur |
| `media.control` | **oui** | `media.playPause` | Seulement pendant une action de l’utilisateur |
| `media.control` | **oui** | `media.next` | Seulement pendant une action de l’utilisateur |
| `session.read` | non | `session.subscribe` | À tout moment |
| `stopwatch.read` | non | `stopwatch.subscribe` | À tout moment |
| `stopwatch.control` | non | `stopwatch.toggle` | Seulement pendant une action de l’utilisateur |
| `stopwatch.control` | non | `stopwatch.reset` | Seulement pendant une action de l’utilisateur |
| `notes.read` | **oui** | `notes.subscribe` | À tout moment |
| `notes.write` | **oui** | `notes.create` | Seulement pendant une action de l’utilisateur |
| `notes.write` | **oui** | `notes.select` | Seulement pendant une action de l’utilisateur |
| `notes.write` | **oui** | `notes.setItem` | Seulement pendant une action de l’utilisateur |
| `notes.write` | **oui** | `notes.delete` | Seulement pendant une action de l’utilisateur |
| `notes.write` | **oui** | [formulaire `notes.save`](forms.md#notessave) | Quand l’utilisateur valide le formulaire |
| `playervox.score.read` | **oui** | `playervox.score.subscribe` | À tout moment |
| `playervox.rating.read` | **oui** | `playervox.rating.subscribe` | À tout moment |
| `playervox.rating.write` | **oui** | [formulaire `playervox.rating.publish`](forms.md#playervoxratingpublish) | Quand l’utilisateur valide le formulaire |
| `playervox.reviews.read` | **oui** | `playervox.reviews.subscribe` | À tout moment |
| `playervox.reviews.read` | **oui** | `playervox.reviews.page` | À tout moment |
| `journal.read` | **oui** | `journal.subscribe` | À tout moment |
| `journal.read` | **oui** | `journal.page` | À tout moment |
| `journal.delete` | **oui** | `journal.delete` | Seulement pendant une action de l’utilisateur |
| `twitch.chat.read` | **oui** | `twitch.chat.subscribe` | À tout moment |
| `twitch.chat.read` | **oui** | `twitch.chat.join` | Seulement pendant une action de l’utilisateur |
| `twitch.chat.read` | **oui** | `twitch.chat.leave` | Seulement pendant une action de l’utilisateur |
| `twitch.chat.read` | **oui** | `twitch.chat.favorite` | Seulement pendant une action de l’utilisateur |
| `twitch.chat.compose` | **oui** | [formulaire `twitch.chat.send`](forms.md#twitchchatsend) | Quand l’utilisateur valide le formulaire |

« Seulement pendant une action de l’utilisateur » est expliqué dans [Les appels qui demandent une action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).
<!-- /generated:capabilities -->

Une ligne dont le service est un formulaire correspond à une écriture que
l’utilisateur saisit lui-même : voir
[les formulaires qui écrivent des données de l’utilisateur](forms.md#les-formulaires-qui-écrivent-des-données-de-lutilisateur).

### Capabilities sensibles

Une capability **sensible** révèle des données personnelles ou le jeu en
cours. Un widget qui en déclare une :

- ne peut pas déclarer aussi `network` ni `clipboardWrite` : le manifeste
  est refusé ;
- a un stockage qui ne dure que le temps de son processus, et qui est vidé
  quand le widget redémarre.

Ce qu’un tel widget lit ne peut donc pas quitter la machine par son
intermédiaire. Si votre widget a besoin à la fois d’une API HTTP et d’une
capability sensible, faites deux widgets.

### Comptes

Certaines capabilities ont besoin du compte PlayerVox ou Twitch de
l’utilisateur. La connexion appartient à OverCrow : c’est lui qui dessine
l’écran de connexion, conserve les jetons et affiche son propre panneau
par-dessus le widget tant que le compte est déconnecté. Un widget ne voit
jamais un jeton ; il ne reçoit que les données que décrit sa capability, et
ses appels échouent avec `not_connected` tant que le compte n’est pas
connecté.

### Des données qui changent

- Un abonnement peut livrer `null` (aucun jeu actif, aucun lecteur
  multimédia) : affichez un état vide.
- Certains abonnements indiquent *quoi relire* plutôt que les données
  elles-mêmes. `playervox.reviews.subscribe` et `journal.subscribe` livrent
  une `revision` : quand elle change, relisez votre page avec
  `playervox.reviews.page` ou `journal.page`.
- `twitch.chat.subscribe` livre des changements plutôt que le chat entier,
  au plus toutes les 100 ms : les nouveaux messages, les messages modifiés
  (même `id`), les IDs des messages supprimés, et la liste entière quand
  `reset` vaut `true`.
- Un horodatage fourni avec son propre `offsetMinutes` doit être formaté
  avec celui-ci ; voir
  [heure, dates et nombres](logic.md#heure-dates-et-nombres).

La forme de chaque résultat figure dans les
[formes de résultat](result-shapes.md).
