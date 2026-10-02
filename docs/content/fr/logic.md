# La logique

`logic.ts` est le code d’un widget PlayerVox OverCrow : il détient l’état du
widget, exporte les fonctions que la vue appelle et dialogue avec OverCrow
par `@overcrow/sdk`. C’est un seul module TypeScript (ou JavaScript),
assemblé avec le SDK dans l’unique script du paquet, `logic.js`.

<!-- source: templates/counter/logic.ts -->
```ts
// A counter. The view reads `state.count` and calls `increment` and
// `decrement` on activation; after each handler the VM renders the view
// again and sends only what changed.
import { initState } from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    count: number;
  }
}

const state = initState({ count: 0 });

export function increment(): void {
  state.count += 1;
}

export function decrement(): void {
  state.count -= 1;
}
```

Voilà un module de logique complet : un état à un seul membre, et deux
gestionnaires que la vue appelle avec `on:activate={increment}`.

## Comment la logique s’exécute

- Le module s’exécute une fois, au démarrage du widget, dans sa propre VM
  JavaScript, à l’intérieur d’un processus placé dans un sandbox. Ce n’est
  ni un navigateur ni Node.js : il n’y a ni DOM, ni `window`, ni `fetch`, ni
  `setTimeout`, ni `console`, ni `Intl`, ni `require`. Les objets standard
  d’ECMAScript sont là (`Math`, `JSON`, `Date`, `Map`, `Promise`…), et le
  SDK est la seule porte de sortie.
- Tout le reste se passe par **tours**. OverCrow envoie un événement, un
  déclenchement de minuteur, une réponse de service ou un changement de ses
  propres données ; votre code s’exécute ; puis la VM réévalue la vue et
  n’envoie à OverCrow que ce qui a changé. Vous ne mettez jamais la vue à
  jour à la main.
- Un tour a un budget de temps, et la VM un plafond de mémoire. OverCrow
  arrête et relance, quelques fois, un widget qui dépasse l’un ou l’autre ;
  voir [ce qui se passe en cas d’échec](#ce-qui-se-passe-en-cas-déchec).

Le seul import permis à un module de logique est `@overcrow/sdk`. Tout ce
dont il a besoin par ailleurs se trouve dans le module lui-même.

## L’état

`state` est un objet ordinaire. Déclarez une fois le type de ses membres en
étendant l’interface `WidgetState` du SDK, donnez-lui sa première valeur
avec `initState`, puis modifiez-le par simple affectation.

<!-- source: templates/list/logic.ts -->
```ts
interface Item {
  id: number;
  text: string;
  done: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    items: Item[];
  }
}

const state = initState({
  items: [
    { id: 1, text: t("first"), done: false },
    { id: 2, text: t("second"), done: false },
    { id: 3, text: t("third"), done: true },
  ] as Item[],
});
```

Après chaque tour, la VM réévalue toute la vue et envoie les différences. Il
n’y a ni abonnement à prendre ni setter à appeler : modifier un membre en
place ou le remplacer, les deux fonctionnent.

<!-- source: templates/list/logic.ts -->
```ts
export function setDone(id: number, done: unknown): void {
  state.items = state.items.map((item) => (item.id === id ? { ...item, done: done === true } : item));
}
```

Gardez dans l’état ce que la vue affiche, et dans des variables ordinaires
ce qui ne sert qu’à la logique (un minuteur, un abonnement). Une valeur de
l’état doit être une donnée simple : nombres, chaînes, booléens, `null`, et
tableaux ou objets qui en sont composés.

## Des fonctions pour la vue

La vue ne peut appeler que ce que le module de logique exporte par son nom :

- dans une **expression**, une fonction qui renvoie ce qu’il faut afficher :
  `{remaining(state.items)}` ;
- comme **gestionnaire**, une fonction qui modifie l’état :
  `on:activate={remove(item.id)}`.

<!-- source: templates/list/logic.ts -->
```ts
export function remove(id: number): void {
  state.items = state.items.filter((item) => item.id !== id);
}
```

<!-- source: templates/list/logic.ts -->
```ts
export function remaining(items: readonly Item[]): number {
  return items.filter((item) => !item.done).length;
}
```

Les fonctions d’expression s’exécutent à chaque évaluation de la vue :
gardez-les légères et sans effet de bord. Un gestionnaire nommé sans
arguments (`on:change={setRepeat}`) reçoit le détail de l’événement :

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
export function setRepeat(event: { value: unknown }): void {
  state.repeat = event.value === true;
}
```

`export default` est refusé : la vue appelle des exports nommés. `t` n’a pas
besoin d’être exporté : une vue qui appelle `t(…)` obtient celui du SDK,
sauf si la logique exporte le sien.

## Les données d’OverCrow : `host`

`host` contient ce qu’OverCrow sait de l’utilisateur et du widget. Ses
membres donnent toujours la dernière valeur.

| Membre | Valeur |
| --- | --- |
| `host.locale` | Langue de l’interface, `"en"` ou `"fr"`. |
| `host.theme` | `"dark"` ou `"light"`. |
| `host.mode` | `"passive"` ou `"interactive"` : le widget ne reçoit d’entrées qu’en mode interactif. |
| `host.visible` | Indique si le widget est affiché. |
| `host.scale` | Échelle du contenu en millièmes : `1000` vaut 100 %. |
| `host.viewport` | `{ width, height }` du contenu du widget, en pixels logiques. |
| `host.region` | Les formats régionaux et le décalage UTC de l’utilisateur ; les fonctions de formatage les lisent. |
| `host.options` | Les valeurs du menu d’options ; lisez-les avec `option`. |
| `host.grants` | Les capabilities accordées par l’utilisateur ; lisez-les avec `hasGrant`. |
| `host.messages` | Les messages de la langue active ; lisez-les avec `t`. |

`onHost(listener)` appelle votre écouteur quand OverCrow envoie de nouvelles
valeurs, avec les noms des membres qui ont changé, avant la réévaluation de
la vue. Utilisez-le quand un changement demande plus que l’affichage de la
nouvelle valeur : réarmer un minuteur, se réabonner, redessiner un canvas.
Un membre peut être renvoyé avec la même valeur : comparez-la à celle que
vous avez gardée quand cela compte.

<!-- source: widgets/stopwatch/logic.ts -->
```ts
onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
});
```

La plupart des widgets n’affichent que les boutons utilisables : en mode
passif, un clic traverse le widget jusqu’au jeu. Le chronomètre masque donc
ses boutons tant que `host.mode` ne vaut pas `"interactive"`.

## Le menu d’options

OverCrow dessine et enregistre les lignes déclarées dans `wrapper.menu` du
[manifeste](manifest.md#le-menu-doptions). La logique les lit :

- `option(id, fallback)` renvoie la valeur enregistrée d’une ligne de type
  bascule, curseur ou choix, ou `fallback` quand il n’y en a pas ou qu’elle
  est d’un autre type ;
- `onHost` signale `"options"` quand l’utilisateur modifie une ligne ;
- `onMenu(handler)` reçoit l’identifiant d’une ligne `action` quand
  l’utilisateur la choisit.

<!-- source: widgets/clock/logic.ts -->
```ts
export function menuValues(): { seconds: boolean; showDate: boolean; order: DateOrder } {
  return {
    seconds: option("show-seconds", false),
    showDate: option("show-date", true),
    order: DATE_ORDERS[option("date-format", "day-month-year")] ?? "dmy",
  };
}
```

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
onMenu((row) => {
  if (row === "reset-rounds") {
    resetRounds();
  }
});
```

Choisir une ligne du menu n’est pas une
[action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur)
pour un service protégé : une ligne `action` peut modifier l’état, pas
écrire dans le presse-papiers.

## Minuteurs

Il n’y a pas de `setTimeout`. Les minuteurs appartiennent à OverCrow et
passent par `timers` :

| Fonction | Se déclenche |
| --- | --- |
| `timers.after(ms, callback)` | une fois, après `ms` |
| `timers.every(ms, callback)` | toutes les `ms` |
| `timers.atEach(unit, callback)` | à chaque `"second"`, `"minute"`, `"hour"` ou `"day"` de l’heure locale de l’utilisateur |

Chacune renvoie un `Timer` doté de `cancel()`.

<!-- source: templates/chart/logic.ts -->
```ts
timers.every(1000, () => {
  const previous = state.values.at(-1) ?? 50;
  state.values = [...state.values.slice(1 - POINTS), sample(previous)];
});
```

Puisque les minuteurs appartiennent à OverCrow, trois règles s’appliquent :

- **Aucun minuteur de moins de 100 ms.** Un intervalle plus court est porté
  à cette valeur. Le mouvement relève du
  [style](style.md#transitions-et-animations), pas des minuteurs.
- **Rien ne se déclenche dans un widget masqué.** Un minuteur répétitif
  saute les déclenchements tombés pendant que le widget était masqué ; un
  minuteur à usage unique arrivé à échéance pendant ce temps se déclenche
  une fois quand le widget réapparaît. Calculez le temps écoulé à partir de
  `Date.now()`, jamais en comptant les déclenchements :

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
// A timer does not tick while the widget is hidden: the time left comes
// from the clock, not from the number of ticks.
function tick(): void {
  state.remainingMs = Math.max(0, endsAt - Date.now());
  if (state.remainingMs > 0) {
    return;
  }
  stop();
  setRounds(state.rounds + 1);
  log.info(`round ${state.rounds} finished`);
  if (state.repeat) {
    start();
  }
}
```

- **16 minuteurs au plus** à la fois.

Pour une horloge, `timers.atEach` est le bon outil : un seul minuteur
répétitif, calé sur les changements d’unité de l’heure locale, qui se
réveille aussi quand le décalage UTC change (heure d’été) et une fois quand
le widget réapparaît.

<!-- source: widgets/clock/logic.ts -->
```ts
/** Ticks at each second or minute of local time, and shows the time now. */
function start(): void {
  clock?.cancel();
  clock = timers.atEach(state.seconds ? "second" : "minute", tick);
  tick();
}
```

Une durée qui doit seulement avancer à l’écran n’a besoin d’aucun minuteur :
OverCrow fait avancer l’élément `elapsed` à partir d’un point de départ que
la logique lui donne. Voir l’[élément `elapsed`](elements.md#elapsed).

## Heure, dates et nombres

Dans la VM, l’heure locale est UTC : `Date` ne donne jamais l’heure de
l’utilisateur, et il n’y a pas d’`Intl`. C’est le SDK qui formate, à partir
de `host.region` :

| Fonction | Donne |
| --- | --- |
| `formatTime(ms, { seconds })` | `14:08`, ou `14:08:42` : sur 24 heures, dans le fuseau horaire de l’utilisateur |
| `formatDate(ms, { order })` | `17/07/2026`, `07/17/2026` ou `2026-07-17`, par défaut dans l’ordre de date de l’utilisateur |
| `formatNumber(value, options)` | `1,234.5`, `1 234,5` ou `1.234,5` : les séparateurs de l’utilisateur, quelle que soit la langue de l’interface |
| `formatDuration(ms, options)` | `04:05`, `1:02:03`, ou `04:05.67` avec les centièmes |
| `localTime(ms)` | les champs de l’instant dans le fuseau horaire de l’utilisateur : `year`, `month`, `day`, `weekday`, `hour`… |

<!-- source: widgets/clock/logic.ts -->
```ts
export function clockTime(now: number, seconds: boolean): string {
  return formatTime(now, { seconds });
}
```

<!-- source: templates/chart/logic.ts -->
```ts
export function latest(values: readonly number[]): string {
  const last = values.at(-1);
  return last === undefined ? "" : formatNumber(last, { maximumFractionDigits: 0 });
}
```

Un horodatage qui vient d’un service porte son propre `offsetMinutes` :
passez-le à la fonction (`formatTime(at, { offsetMinutes })`) pour qu’une
session enregistrée dans un autre fuseau horaire affiche l’heure qu’il y
était. Les noms de mois et de jours de la semaine et l’affichage sur
12 heures ne sont pas fournis.

## Messages

Placez les textes du widget dans `locales/en.json` et `locales/fr.json` :
deux objets plats de chaînes, aux mêmes clés. Les deux fichiers, ou aucun.

<!-- source: templates/list/locales/en.json -->
```json
{
  "first": "Warm up",
  "remaining": "{count} left",
  "remove": "Remove",
  "second": "Play three matches",
  "third": "Update the drivers",
  "title": "Today"
}
```

`t(key, params)` renvoie le message dans la langue de l’utilisateur et
remplace chaque `{name}` par `params.name` ; une clé absente donne la clé
elle-même. La fonction s’utilise dans la vue comme dans la logique :

<!-- source: templates/list/view.ocml -->
```xml
  <text class="summary">{t("remaining", { count: remaining(state.items) })}</text>
```

<!-- source: widgets/stopwatch/logic.ts -->
```ts
export function toggleLabel(running: boolean): string {
  return t(running ? "pause" : "start");
}
```

Quand l’utilisateur change la langue d’OverCrow, la vue est réévaluée avec
les nouveaux messages. En revanche, un texte que la logique a calculé puis
rangé dans l’état ne change pas : calculez les textes dans des fonctions que
la vue appelle, ou rafraîchissez-les dans `onHost` quand `"locale"` change.
Le nom du widget et les libellés de son menu se trouvent dans le manifeste,
pas dans les fichiers de langue.

`overcrow-widget check` avertit quand la vue appelle `t("key")` avec une clé
sans message, et refuse deux fichiers dont les clés diffèrent.

## Dessin

Pour ce que les éléments ne savent pas afficher, l’élément `canvas` offre
une surface que la logique peint avec une liste de commandes : chemins,
remplissages, contours, texte et images. `draw(ref, commands)` remplace tout
le contenu du canvas nommé `ref`.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
/** One dot per finished round, on the `dots` canvas. */
function paint(): void {
  const dots: DrawCommand[] = [];
  for (let index = 0; index < Math.min(state.rounds, MAX_DOTS); index += 1) {
    dots.push(["circle", 6 + index * 14, 6, 4], ["fill", "var(--color-accent)"]);
  }
  draw("dots", dots);
}
```

Les coordonnées sont en pixels logiques, depuis le coin supérieur gauche du
canvas ; les couleurs sont des littéraux (`#rrggbb`) ou des tokens de
couleur. OverCrow vérifie chaque commande et les dessine lui-même : il n’y a
ni accès aux pixels ni shader. Redessinez quand ce que vous affichez change,
et quand `host.theme` change si vous utilisez des couleurs littérales.

<!-- generated:draw-commands -->
| Commande | Arguments | Signification |
| --- | --- | --- |
| `moveTo` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 | Commence un sous-chemin. |
| `lineTo` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 | Segment de droite. |
| `quadTo` | `cx` : nombre de -16384 à 16384 ; `cy` : nombre de -16384 à 16384 ; `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 | Segment de Bézier quadratique. |
| `cubicTo` | `c1x` : nombre de -16384 à 16384 ; `c1y` : nombre de -16384 à 16384 ; `c2x` : nombre de -16384 à 16384 ; `c2y` : nombre de -16384 à 16384 ; `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 | Segment de Bézier cubique. |
| `arc` | `cx` : nombre de -16384 à 16384 ; `cy` : nombre de -16384 à 16384 ; `r` : nombre de -16384 à 16384 ; `start` : nombre de -720 à 720 ; `end` : nombre de -720 à 720 | Arc de cercle, en degrés, dans le sens horaire. |
| `rect` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 ; `w` : nombre de -16384 à 16384 ; `h` : nombre de -16384 à 16384 ; `radius` : nombre de -16384 à 16384 | Sous-chemin fermé : un rectangle aux coins arrondis. |
| `circle` | `cx` : nombre de -16384 à 16384 ; `cy` : nombre de -16384 à 16384 ; `r` : nombre de -16384 à 16384 | Sous-chemin fermé : un cercle. |
| `close` | aucune | Ferme le sous-chemin. |
| `fill` | `color` : `<color>` | Remplit le chemin courant, puis l’efface. |
| `stroke` | `color` : `<color>` ; `width` : nombre de 0 à 256 | Trace le contour du chemin courant, puis l’efface. |
| `text` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 ; `text` : texte ≤ `MAX_ATTRIBUTE_TEXT_BYTES` ; `size` : nombre de 6 à 96 ; `color` : `<color>` ; `align` : `start` \| `center` \| `end` ; `family` : `ui` \| `mono` \| `display` ; `weight` : `400` \| `500` \| `600` \| `700` | Une ligne de texte, posée sur sa ligne de base. |
| `image` | `src` : source d’image ; `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 ; `w` : nombre de -16384 à 16384 ; `h` : nombre de -16384 à 16384 | Dessine une image mise à l’échelle du rectangle. |
| `save` | aucune | Empile la transformation, le rognage et l’opacité, ≤ `MAX_DRAW_STATE_DEPTH`. |
| `restore` | aucune | Dépile l’état ; un `restore` sans `save` est une erreur. |
| `clip` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 ; `w` : nombre de -16384 à 16384 ; `h` : nombre de -16384 à 16384 | Réduit le rectangle de rognage à son intersection avec celui-ci. |
| `translate` | `x` : nombre de -16384 à 16384 ; `y` : nombre de -16384 à 16384 | Translation. |
| `rotate` | `degrees` : nombre de -360 à 360 | Rotation. |
| `scale` | `x` : nombre de 0 à 8 ; `y` : nombre de 0 à 8 | Mise à l’échelle. |
| `alpha` | `value` : nombre de 0 à 1 | Multiplie l’opacité. |
<!-- /generated:draw-commands -->

Un graphique, une jauge ou une barre de progression n’ont pas besoin de
canvas : les éléments `chart`, `gauge` et `progress` les dessinent à partir
de valeurs.

## Journalisation

`log.debug`, `log.info`, `log.warn` et `log.error` prennent un texte. Leur
sortie apparaît dans le terminal de `overcrow-widget dev` et nulle part
ailleurs : les journaux d’un widget installé sont ignorés. Ne journalisez
jamais de données de l’utilisateur.

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
  log.info(`round ${state.rounds} finished`);
```

## Ce que la logique ne peut pas utiliser

`overcrow-widget check` confronte la logique à ce que la VM exécute et
indique par quoi le SDK remplace ce qui manque :

| Code | Règle |
| --- | --- |
| `logic.syntax` | Le module s’analyse comme de l’ES2023 ; les types TypeScript sont permis. |
| `logic.import` | Son seul import est `@overcrow/sdk` : aucun autre module, fichier ou paquet, pas de `export *`. |
| `logic.dynamic_import`, `logic.import_meta` | Ni `import()` ni `import.meta`. |
| `logic.eval`, `logic.function_constructor` | Ni `eval`, ni `Function(…)`, ni `new Function(…)`. |
| `logic.unavailable_global` | Chaque globale lue existe dans la VM. `Intl`, `setTimeout`, `console`, `fetch`, `WebAssembly`, `SharedArrayBuffer`, `performance`, `WeakRef`, les globales du navigateur et de Node.js n’y existent pas. |
| `logic.top_level_await`, `logic.top_level_this` | Ni `await` ni `for await` au niveau supérieur, ni `this` au niveau supérieur. |
| `logic.syntax_version` | Rien de plus récent qu’ES2023 : décorateurs, `using`, drapeau `v` des expressions régulières, attributs d’import. |
| `logic.default_export` | La vue appelle des exports nommés ; `export default` est refusé. |
| `logic.missing_export` | Chaque fonction que la vue appelle est exportée. |
| `logic.debugger` | `debugger` donne un avertissement. |

Ce contrôle vous aide ; ce n’est pas lui qui protège l’utilisateur. C’est le
rôle du sandbox, des budgets de la VM et de la vérification par OverCrow de
tout ce que le widget envoie.

## Ce qui se passe en cas d’échec

- Une exception dans un gestionnaire met fin à ce tour ; le widget continue
  de tourner, et `overcrow-widget dev` affiche la faute.
- Un tour plus long que son budget (50 ms), un tas au-dessus de son plafond
  ou trop de messages dans un tour arrêtent le widget. OverCrow affiche une
  erreur fixe dans son cadre et le relance après 1, 5 puis 15 secondes,
  trois fois au plus.
- La promesse rejetée d’un appel de service est une erreur ordinaire de
  votre code : interceptez-la. Voir les [erreurs](services.md#erreurs).

Les valeurs chiffrées figurent dans les [limites](limits.md#logique). Toute
l’API du SDK est décrite dans la [référence du SDK](sdk.md).
