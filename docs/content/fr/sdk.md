# Référence du SDK

`@overcrow/sdk` 1.0 est l’API de la logique d’un widget PlayerVox OverCrow :
l’état, les données de l’hôte, les services, les minuteurs, le dessin, le
menu d’options, les messages, les journaux et le formatage. Cette page liste
tous les exports du paquet. [La logique](logic.md) et
[Services et permissions](services.md) expliquent comment s’en servir.

Le SDK est sur npm, et la commande ci-dessous l’ajoute à un projet. Un
projet créé par `overcrow-widget init` le liste déjà : lancez-y
`npm install`.

```sh
npm install --save-dev --save-exact @overcrow/sdk@1.0.0
```

<!-- source: widgets/clock/logic.ts -->
```ts
import {
  formatDate,
  formatTime,
  initState,
  onHost,
  option,
  t,
  timers,
  type DateOrder,
  type Timer,
} from "@overcrow/sdk";
```

Le SDK est assemblé dans le `logic.js` du widget à l’empaquetage et
s’exécute dans la VM du widget ; le charger ailleurs lève une erreur. Les
parties inutilisées sont retirées du script assemblé. C’est une commodité,
pas une barrière de sécurité : OverCrow vérifie chaque appel, chaque
paramètre et chaque valeur qui sort de la VM.

| Export | Nature | Résumé |
| --- | --- | --- |
| `SDK_VERSION` | constante | `"1.0.0"`. |
| `RUNTIME_SURFACE` | constante | `"0.1"`, la version de l’interface intégrée de la VM dont ce SDK a besoin. |

## État et vue

| Export | Nature | Résumé |
| --- | --- | --- |
| `state` | constante | L’objet d’état du widget. Modifiez-le ; après chaque tour, la VM réévalue la vue et n’envoie que les différences. |
| `WidgetState` | interface | Type de `state` ; déclarez ses membres par augmentation de module. Les membres non déclarés sont `unknown`. |
| `initState(initial)` | fonction | Copie `initial` dans `state` et renvoie `state` avec le type de `initial`. Appelez-la une seule fois, pendant le chargement du module. |
| `registerView(table)` | fonction | Enregistre les expressions et les gestionnaires compilés de la vue. L’outil en ligne de commande génère cet appel : un widget ne l’écrit jamais. |
| `ViewTable` | type | La table que prend `registerView`. |
| `Expression` | type | `(state, scope) => value` : une expression compilée de la vue. |
| `Handler` | type | `(state, scope, event) => void` : un gestionnaire compilé de la vue. |
| `NodeEvent<E>` | interface | `{ type, detail }` d’un événement ; `detail` vaut `EventDetailMap[E]`. |
| `Scope` | interface | Les noms à la portée d’une expression : entrées d’un `for`, propriétés d’un composant. |

<!-- source: templates/chart/logic.ts -->
```ts
declare module "@overcrow/sdk" {
  interface WidgetState {
    values: number[];
  }
}

const state = initState({ values: [50] as number[] });
```

## Données de l’hôte

| Export | Nature | Résumé |
| --- | --- | --- |
| `host` | constante | Objet figé dont les membres donnent toujours les dernières valeurs envoyées par OverCrow. |
| `HostData` | interface | Type de `host` : `locale`, `messages`, `theme`, `region`, `scale` (en millièmes), `viewport`, `mode`, `visible`, `options`, `grants`. |
| `onHost(listener)` | fonction | Appelle `listener` avec les noms des membres de `host` qu’OverCrow vient d’envoyer (`options` après un changement dans le menu, `visible` quand le widget est affiché ou masqué, `region`…), avant la réévaluation de la vue. Renvoie `{ cancel() }`. |
| `HostKey` | type | Le nom d’un membre de `HostData`. |
| `HostListener` | type | Un écouteur de `onHost`. |
| `Viewport` | interface | `{ width, height }`, en pixels logiques. |
| `hasGrant(capability)` | fonction | Indique si l’utilisateur a accordé une capability. |
| `option(id, fallback)` | fonction | La valeur enregistrée d’une ligne du menu d’options, ou `fallback` quand il n’y en a pas ou qu’elle est d’un autre type. |
| `MenuValue` | type | `boolean \| number \| string`. |
| `Widened<T>` | type | Le type du résultat de `option` : une valeur de repli `false` donne `boolean`. |

<!-- source: widgets/clock/logic.ts -->
```ts
onHost((changed) => {
  if (changed.includes("options")) {
    const values = menuValues();
    const unitChanged = values.seconds !== state.seconds;
    Object.assign(state, values);
    if (unitChanged) {
      start();
    }
  }
  // A new UTC offset (time zone or summer time) shows at once.
  if (changed.includes("region")) {
    tick();
  }
});
```

## Services

Chaque service répond par l’intermédiaire d’OverCrow, qui vérifie à chaque
appel sa permission ou sa capability, ses paramètres et l’action de
l’utilisateur.

| Export | Nature | Résumé |
| --- | --- | --- |
| `storage` | espace de noms | `get({ key })`, `set({ key, value })`, `remove({ key })`, `keys()`. Permission `storage`. |
| `http` | espace de noms | `fetch(url, { as, method?, body?, contentType? })`. Permission `network`. |
| `clipboard` | espace de noms | `writeText({ text })`, pendant une action de l’utilisateur. Permission `clipboardWrite`. |
| `gameEvents` | espace de noms | `subscribe(listener)`. Permission `gameEvents`. |
| `session` | espace de noms | `subscribe(listener)`. Capability `session.read`. |
| `telemetry` | espace de noms | `subscribe(listener)`. Capability `telemetry.read`. |
| `fps` | espace de noms | `subscribe(listener)`. Capability `fps.read`. |
| `media` | espace de noms | `subscribe({ cover? }, listener)` ; `previous`, `playPause`, `next({ player? })` pendant une action de l’utilisateur. |
| `stopwatch` | espace de noms | `subscribe(listener)` ; `toggle()`, `reset()` pendant une action de l’utilisateur. |
| `notes` | espace de noms | `subscribe(listener)` ; `create()`, `select({ note })`, `setItem({ note, item, checked })`, `delete({ note })` pendant une action de l’utilisateur. |
| `playervox` | espace de noms | `score.subscribe`, `rating.subscribe`, `reviews.subscribe`, `reviews.page({ page?, followedOnly? })`. |
| `journal` | espace de noms | `subscribe(listener)` ; `page({ cursor? })` ; `delete({ session })` pendant une action de l’utilisateur, après confirmation de celui-ci. |
| `twitch` | espace de noms | `chat.subscribe(listener)` ; `chat.join({ channel })`, `chat.leave()`, `chat.favorite({ channel, favorite })` pendant une action de l’utilisateur. |
| `call(service, params?)` | fonction | Appelle par son nom n’importe quel service qui répond une seule fois. |
| `subscribe(service, params, listener)` | fonction | S’abonne par son nom à n’importe quel service d’abonnement. |
| `ServiceError` | classe | Le rejet d’un appel en échec : `code` est un `ServiceErrorCode`. |
| `Listener<T>` | type | `(update: SubscriptionUpdate<T>) => void`. |
| `SubscriptionUpdate<T>` | type | `{ ok: true, value, final }` ou `{ ok: false, error, final: true }`. |
| `Subscription` | interface | `cancel()` ; un nouvel appel ne fait rien. |
| `ServiceParams<N>` | type | Les paramètres du service `N`. |
| `ServiceResult<N>` | type | Le résultat, ou la mise à jour, du service `N`. |
| `FetchOptions<A>` | interface | Les options de `http.fetch`. |
| `FetchResponse<A>` | type | `{ status, contentType, body }`, ou `{ status, asset }` pour `as: "image"`. |
| `BodyType` | type | `"json" \| "text" \| "bytes" \| "image"`. |
| `BodyTypes` | interface | Le corps décodé de chaque type de corps. |
| `HttpMethod` | type | Les méthodes des règles réseau. |
| `HttpServices` | interface | Type de `http`. |

L’écouteur vient toujours en dernier, et un service sans paramètres n’en
prend aucun :

<!-- source: widgets/fps/logic.ts -->
```ts
  fps.subscribe((update) => {
    Object.assign(state, reading(update));
  });
```

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

`http.fetch` envoie un corps de type chaîne en `text/plain` et tout autre
corps en JSON, sauf si `contentType` en dit autrement, et décode la réponse
comme le demande `as`. Une réponse sans corps donne `null`, `""` ou un
`ArrayBuffer` vide.

Les types des autres espaces de noms sont générés à partir du schéma :
`ClipboardServices`, `FpsServices`, `GameEventsServices`,
`JournalServices`, `MediaServices`, `NotesServices`, `PlayervoxServices`,
`SessionServices`, `StopwatchServices`, `StorageServices`,
`TelemetryServices` et `TwitchServices`. Chaque service est décrit dans la
[référence des services](service-reference.md).

## Minuteurs

| Export | Nature | Résumé |
| --- | --- | --- |
| `timers` | espace de noms | `after(ms, callback)`, `every(ms, callback)`, `atEach(unit, callback)`. |
| `Timer` | interface | `cancel()` ; un nouvel appel ne fait rien. |

- 16 minuteurs au plus, jamais plus courts que 100 ms : un intervalle plus
  court est porté à cette valeur.
- Aucun minuteur ne se déclenche tant que le widget est masqué. Un minuteur
  répétitif saute les déclenchements manqués ; un minuteur à usage unique
  arrivé à échéance pendant ce temps se déclenche une fois quand le widget
  réapparaît.
- `atEach("second" | "minute" | "hour" | "day", callback)` appelle
  `callback` à chaque changement d’unité de l’heure locale de l’utilisateur,
  et une fois quand le widget réapparaît. Il se réveille aussi quand le
  décalage UTC de l’utilisateur change.

<!-- source: widgets/media/logic.ts -->
```ts
      retry = timers.after(RETRY_MS, subscribe);
```

## Dessin, menu, messages et journal

| Export | Nature | Résumé |
| --- | --- | --- |
| `draw(ref, commands)` | fonction | Remplace les commandes du `canvas` dont le `ref` est donné. |
| `onMenu(handler)` | fonction | Reçoit l’identifiant de chaque ligne `action` du menu d’options que l’utilisateur choisit. |
| `t(key, params?)` | fonction | Le message de la langue active, où chaque `{name}` est remplacé par `params.name` ; la clé elle-même quand il n’y a pas de message. |
| `MessageParams` | type | `Record<string, string \| number>`. |
| `log` | espace de noms | `debug`, `info`, `warn`, `error(text)` : affichés par `overcrow-widget dev`, ignorés pour un widget installé. |

Les commandes de dessin sont des tuples typés, listés dans
[Dessin](logic.md#dessin).

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
    dots.push(["circle", 6 + index * 14, 6, 4], ["fill", "var(--color-accent)"]);
```

## Heure, dates et nombres

La VM n’a pas d’`Intl`, et son heure locale est UTC : `Date` ne donne jamais
l’heure de l’utilisateur. Ces fonctions formatent à partir de `host.region`.
Les nombres suivent le format de nombre de l’utilisateur (`1,234.5`,
`1 234,5` ou `1.234,5`), quelle que soit la langue de l’interface ; les
dates sont numériques, dans l’ordre de date de l’utilisateur ; les heures
s’affichent sur 24 heures. Chaque fonction accepte aussi ses valeurs
régionales en options : elle peut ainsi tourner dans un test unitaire, hors
de la VM.

| Export | Nature | Résumé |
| --- | --- | --- |
| `localTime(ms, offsetMinutes?)` | fonction | Les champs `LocalTime` d’un instant dans le décalage UTC de l’utilisateur, ou dans l’`offsetMinutes` d’un horodatage de service. |
| `formatTime(ms, options?)` | fonction | `14:08`, ou `14:08:42` avec `seconds: true`. |
| `formatDate(ms, options?)` | fonction | `17/07/2026` (`dmy`), `07/17/2026` (`mdy`), `2026-07-17` (`ymd`). |
| `formatNumber(value, options?)` | fonction | Les séparateurs du format de nombre de l’utilisateur ; `minimumFractionDigits`, `maximumFractionDigits` (3 par défaut), `grouping`. |
| `formatDuration(ms, options?)` | fonction | `04:05`, `1:02:03`, `04:05.67` avec `hundredths: true` ; tronquée, comme l’affiche un chronomètre. |
| `delayToNext(unit, nowMs, region?)` | fonction | Les millisecondes jusqu’au prochain changement d’unité de l’heure locale, jamais au-delà du prochain changement de décalage UTC. |
| `LocalTime` | interface | `year`, `month` (1 à 12), `day`, `weekday` (0 pour dimanche), `hour`, `minute`, `second`, `millisecond`. |
| `TimeUnit` | type | `"second" \| "minute" \| "hour" \| "day"`. |
| `TimeOptions` | interface | `offsetMinutes`. |
| `DateOptions` | interface | `offsetMinutes`, `order`. |
| `ClockOptions` | interface | `offsetMinutes`, `seconds`. |
| `NumberOptions` | interface | Les options de `formatNumber`. |
| `DurationOptions` | interface | `hours`, `hundredths`, `format`. |

<!-- source: widgets/clock/logic.ts -->
```ts
export function clockDate(now: number, order: DateOrder): string {
  return formatDate(now, { order });
}
```

Les noms de mois et de jours de la semaine, l’affichage sur 12 heures et les
règles de pluriel ne font pas partie de la version 1.0.

## Types générés

Ces types sont générés à partir du schéma des widgets : ils correspondent
donc toujours à ce qu’OverCrow accepte.

| Export | Résumé |
| --- | --- |
| `ServiceName`, `CallServiceName`, `SubscribeServiceName`, `GestureServiceName` | Les noms de service : tous, ceux qui répondent une seule fois, les abonnements, et ceux qui demandent une action de l’utilisateur. |
| `ServiceParamsMap`, `ServiceResultMap` | Les paramètres et le résultat de chaque service. |
| `ServiceErrorCode`, `ServiceErrorPayload` | Les [codes d’erreur](services.md#erreurs), et la valeur `{ code }` qui en porte un. |
| `Session`, `Telemetry`, `Fps`, `Stopwatch`, `Media`, `Notes`, `Note`, `NoteItem`, `CreatedNote`, `Score`, `Rating`, `RatingState`, `Review`, `ReviewsState`, `ReviewsPage`, `JournalState`, `JournalPage`, `JournalSession`, `TwitchChat`, `ChatMessage`, `ChatFragment`, `GameEvent`, `HttpResponse` | Les [formes de résultat](result-shapes.md). |
| `Permission`, `Capability`, `SensitiveCapability`, `CapabilityServices`, `PermissionServices` | Les permissions et les capabilities du manifeste, et les services que chacune autorise. |
| `Locale`, `Theme`, `Mode`, `Region`, `NumberFormat`, `DateOrder` | Les valeurs de `host`. |
| `EventName`, `GestureEventName`, `EventDetailMap`, `NamedKey` | Les événements de la vue, ceux qui sont des actions de l’utilisateur, leurs détails, et les touches nommées de `keydown`. |
| `DrawCommand`, `DrawCommandName`, `Color` | Les commandes et les couleurs du canvas. |
| `TokenName`, `ColorToken`, `LengthToken`, `FontSizeToken`, `FontFamilyToken`, `TimeToken`, `ShadowToken` | Les [tokens du design system](style-properties.md#tokens-du-design-system). |
| `IconName` | Les noms des [icônes](style-properties.md#icônes). |
| `MenuRowType`, `HostFeature` | Les types de ligne du menu d’options, et les sources de données de `requires`. |
| `JsonValue`, `AssetHandle`, `ImageSource` | Toute valeur JSON ; un identifiant d’image donné par un service ; une image du paquet ou un tel identifiant. |

## Constantes de limites

Les [limites](limits.md) que la logique d’un widget doit respecter sont
exportées sous forme de constantes, pour que le code ne répète jamais un
nombre : `MAX_TIMERS`, `MIN_TIMER_INTERVAL_MS`, `MAX_SERVICE_CALLS_IN_FLIGHT`,
`MAX_SUBSCRIPTIONS`, `MAX_STORAGE_KEYS`, `MAX_STORAGE_KEY_BYTES`,
`MAX_STORAGE_VALUE_BYTES`, `STORAGE_QUOTA_BYTES`, `MAX_REQUEST_URL_BYTES`,
`MAX_HTTP_REQUEST_BYTES`, `MAX_HTTP_RESPONSE_BYTES`,
`MAX_HTTP_DECLARED_RESPONSE_BYTES`, `MAX_CLIPBOARD_BYTES`,
`MAX_OBJECT_ID_BYTES`, `MAX_NOTES`, `MAX_NOTE_ITEMS`,
`MAX_NOTE_TITLE_BYTES`, `MAX_NOTE_BODY_BYTES`, `MAX_NOTE_ITEM_BYTES`,
`MAX_REVIEW_CHARS`, `MAX_CHAT_CHANNEL_BYTES`, `MAX_CHAT_MESSAGE_CHARS`,
`MAX_CHAT_FRAGMENTS`, `MAX_CHAT_FAVORITES`, `MAX_DRAW_COMMANDS`,
`MAX_DRAW_STATE_DEPTH`, `MAX_PATH_POINTS`, `MAX_PATCH_BYTES`,
`MAX_SCENE_NODES`, `MAX_CHILDREN`, `MAX_NODE_TEXT_BYTES`,
`MAX_ATTRIBUTE_TEXT_BYTES`, `MAX_LABEL_BYTES`, `MAX_FIELD_TEXT_BYTES`,
`MAX_LOCALE_ENTRIES`, `MAX_LOG_BYTES`, `VM_HEAP_BYTES`,
`VM_MAX_HEAP_BYTES`, `VM_TURN_BUDGET_MS`, `VM_JOBS_PER_TURN` et
`VM_MESSAGES_PER_TURN`.

## Tests unitaires : `@overcrow/sdk/testing`

Un second point d’entrée, jamais assemblé dans un widget, remplace OverCrow
dans un test unitaire de la logique : `installRuntime()` fournit un temps
virtuel, fait aboutir les appels de service et pousse les valeurs des
abonnements. Voir les [tests unitaires](testing.md#tests-unitaires).
