# Tester un widget

Un widget PlayerVox OverCrow se teste de deux façons, toutes deux sans
bureau, sans jeu et sans compte :

- **Les tests unitaires de la logique**, dans Node.js, avec
  `@overcrow/sdk/testing` : rapides, pour les fonctions de `logic.ts`.
- **Les scénarios**, joués par `overcrow-widget test` dans le **runtime
  headless** d’OverCrow : la vraie VM, le vrai style, la vraie mise en page
  et le vrai moteur de rendu, les vérifications d’OverCrow lui-même, des
  services simulés, un temps virtuel et des images de référence. Ce qui
  passe là est ce que l’overlay affiche.

<!-- source: templates/counter/tests/example.scenario.json -->
```json
{
  "scenarioVersion": 1,
  "name": "example",
  "description": "The counter starts at 0 and Increase adds one. `overcrow-widget test` plays it and compares the images with tests/reference/example/; `--update` records them again (https://overcrow.playervox.com/docs/en/testing/).",
  "host": { "mode": "interactive" },
  "steps": [
    { "expect": { "state": "running", "text": ["0"], "image": "initial" } },
    { "pointer": { "click": { "label": "Increase" } } },
    { "expect": { "text": ["1"], "noText": ["0"], "image": "increased", "fault": "none" } }
  ]
}
```

Ce scénario démarre le compteur en mode interactif, vérifie qu’il affiche
`0` et compare son image avec une référence, clique sur le bouton dont le
libellé est « Increase », puis vérifie le nouveau texte et la nouvelle
image.

## Tests unitaires

`installRuntime()` met en place une doublure d’OverCrow avant l’import de la
logique : les appels de service renvoient des promesses que votre test
résout ou rejette, les abonnements reçoivent les valeurs que vous poussez,
les minuteurs se déclenchent quand vous avancez le temps, et `Date.now()`
est virtuel.

<!-- source: widgets/clock/tests/logic.test.mjs -->
```js
const START = Date.UTC(2026, 6, 17, 12, 8, 42, 250);
const vm = installRuntime({
  now: START,
  host: {
    region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 120 },
    messages: { label: "Local time {time}", "label-date": "Local time {time}, {date}" },
  },
});
const logic = await loadLogic();
const { state } = await import("@overcrow/sdk");
```

<!-- source: widgets/clock/tests/logic.test.mjs -->
```js
test("one timer at the next local minute, then each minute", () => {
  assert.equal(vm.timers.length, 1);
  assert.equal(vm.timers[0].dueAt, Date.UTC(2026, 6, 17, 12, 9));
  vm.advance(Date.UTC(2026, 6, 17, 12, 9) - vm.now);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:09");
  assert.deepEqual(
    vm.timers.map(({ intervalMs, repeat }) => ({ intervalMs, repeat })),
    [{ intervalMs: 60_000, repeat: true }],
  );
  assert.equal(vm.advance(120_000), 2);
  assert.equal(logic.clockTime(state.now, state.seconds), "14:11");
});
```

| Membre | Rôle |
| --- | --- |
| `installRuntime({ now, host })` | Installe la doublure ; `Date.now()` renvoie le temps virtuel. Une seule à la fois. |
| `now`, `advance(ms)` | Le temps virtuel ; `advance` déclenche, dans l’ordre, les minuteurs arrivés à échéance (un minuteur répétitif se réarme) et renvoie leur nombre. |
| `setHost(changes)` | Modifie `host` comme le fait OverCrow : `region`, `locale`, `options`… |
| `calls`, `lastCall(service)` | Chaque appel de service, avec `resolve(value)` et `reject(code)`. |
| `push(service, value)`, `fail(service, code)` | La prochaine mise à jour, ou l’échec final, des abonnements à un service. |
| `menu(row)` | Choisit une ligne `action` du menu d’options. |
| `draws`, `logs`, `timers`, `table` | Ce que la logique a envoyé : dessins du canvas, journaux, minuteurs et fonctions de la vue. |
| `uninstall()` | Retire la doublure et restaure `Date.now`. |

La doublure n’exécute que votre logique : elle n’applique pas les règles
d’OverCrow (les autorisations accordées, les comptes, la règle de l’action
de l’utilisateur) et ne rend rien. Les scénarios, eux, le font. Les widgets
de référence compilent leur `logic.ts` avec un petit chargeur avant de
l’importer :

<!-- source: widgets/clock/tests/load-logic.mjs -->
```js
export async function loadLogic() {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("logic.ts", root), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
  });
  mkdirSync(new URL("dist/", root), { recursive: true });
  // One file per test process: test files run in parallel.
  const output = new URL(`dist/logic-${process.pid}.mjs`, root);
  writeFileSync(output, outputText);
  return import(output.href);
}
```

## Scénarios

Un scénario est un fichier JSON du projet, `tests/<name>.scenario.json`,
dont le `name` vaut `<name>`. Ses images de référence sont
`tests/reference/<name>/<image>.png`. Ni l’un ni les autres ne sont
empaquetés.

```sh
overcrow-widget test
overcrow-widget test --scenario example
overcrow-widget test --update
```

`--update` enregistre les images capturées comme références : regardez-les
avant de les commiter. Une image en échec écrit
`tests/output/<name>/<image>.actual.png` et, pour une différence,
`<image>.diff.png`, où les pixels différents sont en rouge.

Un scénario a quatre parties : `host` (les réglages de l’utilisateur),
`fixtures` (les données simulées : ce que répondent les services), `assets`
(des images pour les fixtures) et `steps` (ce qui se passe, et ce qui doit
être vrai). Le format est strict : un champ, un nom ou une valeur inconnus
sont une erreur du scénario, signalée avec son chemin
(`steps[3].pointer.click`) avant toute exécution. Le scénario est aussi
vérifié par rapport au manifeste : les autorisations que le widget déclare,
les lignes de menu qui existent, les services de ses capabilities.

### `host`

Tout est facultatif.

| Membre | Par défaut | Signification |
| --- | --- | --- |
| `locale` | `en` | `en` ou `fr`. |
| `theme` | `dark` | `dark` ou `light`. |
| `scale` | `1000` | Échelle du contenu en millièmes : de 500 à 1750 (de 50 % à 175 %). |
| `size` | la taille préférée du manifeste | `{ width, height }` du cadre, en pixels logiques ; le `fit` du manifeste s’applique quand même. |
| `mode` | `passive` | `interactive` donne les entrées au widget. |
| `visible` | `true` | Masqué, le widget ne reçoit aucun déclenchement de minuteur. |
| `frame` | `false` | `true` capture le cadre d’OverCrow autour du contenu. |
| `background` | la couleur de panneau du thème | `#rrggbb` derrière le widget. |
| `region` | `us`, ordre de date de la langue | `{ numberFormat, dateOrder }`. |
| `zone` | UTC | `{ offsetMinutes, transitions: [{ at, offsetMinutes }] }` : le décalage UTC de l’utilisateur, et les instants où il change. |
| `startAt` | 2026-01-01T00:00:00Z | Le temps virtuel auquel le widget démarre, en millisecondes Unix. |
| `options` | les valeurs par défaut des lignes | Les valeurs des lignes du menu d’options. |
| `grants` | `"declared"` | Ou la liste exacte de ce que l’utilisateur a accordé (`storage`, `network`, `fps.read`…) : OverCrow refuse le reste. |
| `accounts` | connectés | `{ playervox, twitch }`, chacun valant `connected`, `disconnected`, `pending`, `expired` ou `offline`. |
| `features` | toutes | Les sources de données de la machine, pour `requires`. |
| `storage` | vide | Le stockage du widget avant son démarrage. |

<!-- source: widgets/clock/tests/summer-time.scenario.json -->
```json
  "host": {
    "zone": {
      "offsetMinutes": 60,
      "transitions": [
        {
          "at": 1774746000000,
          "offsetMinutes": 120
        },
        {
          "at": 1792890000000,
          "offsetMinutes": 60
        }
      ]
    },
    "startAt": 1774745970000
  },
```

Avec un compte qui n’est pas `connected`, OverCrow dessine son propre
panneau de compte par-dessus le widget, comme il le fait pour
l’utilisateur ; capturez-le avec `frame`.

### `fixtures`

Les fixtures remplacent la provenance des données, jamais les vérifications
d’OverCrow. Un appel franchit d’abord les mêmes contrôles que dans
l’overlay : autorisations accordées, paramètres, règle de l’action de
l’utilisateur et compte. C’est seulement ensuite qu’une fixture lui répond.
Chaque valeur doit avoir la forme du [résultat](result-shapes.md) du
service : une valeur qui ne l’a pas est une erreur du scénario, pas du
widget.

| Membre | Fournit |
| --- | --- |
| `subscriptions` | La valeur d’un abonnement à son démarrage ; les étapes `publish` envoient les suivantes. |
| `calls` | Les réponses aux appels d’un service, dans l’ordre : `{ "value": … }` ou `{ "error": code }`. Un appel au-delà est une erreur du scénario. |
| `http` | Les réponses aux requêtes `http.fetch`, chacune utilisée une fois : `{ "request": { method, url }, "response": { status, contentType, body } }` (ou `bodyBase64`), ou `{ "request": …, "error": code }`. Les règles réseau du manifeste s’appliquent d’abord, et les limites de réponse s’appliquent comme dans l’overlay. |
| `confirmations` | `accept` ou `cancel`, dans l’ordre, pour la confirmation par OverCrow de `notes.delete` et `journal.delete`. |
| `intents` | La réponse à chaque [intent d’écriture](forms.md#les-formulaires-qui-écrivent-des-données-de-lutilisateur) envoyé, dans l’ordre : `"accepted"`, `{ "error": code }` ou `"pending"`. |

<!-- source: widgets/stopwatch/tests/errors.scenario.json -->
```json
  "fixtures": {
    "calls": {
      "stopwatch.toggle": [
        {
          "error": "unavailable"
        },
        {
          "value": {
            "running": true,
            "elapsedMs": 5000,
            "at": 0,
            "shortcuts": {
              "toggle": "Super+Alt+T",
              "reset": "Super+Alt+Z",
              "bound": true
            }
          }
        }
      ],
      "stopwatch.reset": [
        {
          "error": "stale_context"
        }
      ]
    },
    "subscriptions": {
      "stopwatch.subscribe": {
        "running": false,
        "elapsedMs": 5000,
        "at": 0,
        "shortcuts": {
          "toggle": "Super+Alt+T",
          "reset": "Super+Alt+Z",
          "bound": true
        }
      }
    }
  },
```

<!-- source: widgets/warframe-market/tests/errors.scenario.json -->
```json
    "http": [
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/versions"
        },
        "error": "timeout"
      },
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/orders/item/primed_flow"
        },
        "error": "transport_failed"
      },
      {
        "request": {
          "method": "GET",
          "url": "https://api.warframe.market/v2/orders/item/primed_flow"
        },
        "response": {
          "status": 200,
          "contentType": "application/json",
          "body": "{\"apiVersion\":\"0.25.0\",\"data\":[],\"error\":null}"
        }
      }
    ]
```

Les codes qu’OverCrow attribue lui-même (`permission_denied`,
`gesture_required`, `not_connected`, `invalid_request`) ne peuvent pas
s’écrire dans une fixture : obtenez-les par la voie réelle, avec `grants`,
`accounts`, un appel hors d’une action de l’utilisateur ou des paramètres
incorrects. Le stockage, les minuteurs et le presse-papiers sont ceux
d’OverCrow et n’ont besoin d’aucune fixture.

### `assets`

Des images qu’une fixture remet au widget, comme OverCrow lui remet la
pochette d’un média ou une emote du chat : `{ "<name>": "<path>" }`, 8 au
plus, chacune étant un PNG ou un JPEG du projet (`tests/assets/cover.png`).
Là où un résultat contient un identifiant d’image, la fixture écrit
`"fixture:<name>"`.

### `steps`

| Étape | Effet |
| --- | --- |
| `{ "advance": { "ms": N } }` | Avance le temps virtuel de `N` ms. Chaque minuteur qui arrive à échéance en chemin se déclenche, dans l’ordre, et le décalage UTC change à son instant. |
| `{ "advance": { "ms": N, "jump": true } }` | Déplace le temps d’un coup, comme une machine qui sort de veille : chaque minuteur échu se déclenche une fois, en retard. |
| `{ "host": { … } }` | Modifie `locale`, `theme`, `scale`, `size`, `mode`, `visible`, `region`, `zone` ou `accounts`. |
| `{ "pointer": { "click": target } }` | Un clic. Aussi `rightClick`, `move` (survol), `wheel` (`{ target, dx, dy }`) et `"leave"`. |
| `{ "key": { "key": "Enter", "modifiers": ["shift"] } }` | Un appui sur une touche : `Tab`, `Escape`, `ArrowUp`, lettres, chiffres… |
| `{ "text": "…" }` | Du texte saisi dans le champ qui a le focus. |
| `{ "menu": { "id": "row", "value": … } }` | Une ligne du menu d’options : la valeur d’une bascule, d’un curseur ou d’un choix, aucune pour une action. |
| `{ "publish": { "service": "fps.subscribe", "value": … } }` | La prochaine valeur d’un abonnement. |
| `{ "publish": { "service": "media.subscribe", "error": "unavailable" } }` | Termine l’abonnement par cet échec. |
| `{ "expect": { … } }` | Ce qui doit être vrai une fois les étapes précédentes stabilisées. |

Une cible de pointeur est `{ "at": [x, y] }` (pixels logiques du contenu),
`{ "text": "…" }` (le premier élément qui affiche exactement ce texte) ou
`{ "label": "…" }` (son libellé accessible). Les entrées n’atteignent le
widget qu’en mode interactif. Un clic est une action de l’utilisateur ; une
ligne de menu n’en est jamais une.

Chaque étape se stabilise avant la suivante : le widget a répondu à tout ce
qu’il a reçu et plus rien n’est en cours. Il n’y a aucune attente réelle.

### `expect`

| Membre | Vérifié quand |
| --- | --- |
| `image` | La capture correspond à `tests/reference/<scenario>/<image>.png`. Les noms sont uniques dans un scénario. |
| `text`, `noText` | Chaque texte est (n’est pas) le texte entier d’un élément que le widget affiche. |
| `calls` | Exactement ces appels de service ont eu lieu depuis la vérification `calls` précédente, dans l’ordre : `{ service, params?, outcome? }`, `outcome` valant `ok` ou le code d’erreur que le widget a reçu. |
| `state` | `starting`, `running`, `restarting`, `failed`, `refused` ou `stopped`. |
| `fault` | La dernière faute de la VM du widget, ou `none`. |
| `clipboard` | Le dernier texte que le widget a écrit dans le presse-papiers. |
| `intents` | Exactement ces intents d’écriture ont été envoyés depuis la vérification `intents` précédente, dans l’ordre : `{ intent, fields?, outcome? }`. `fields` contient les valeurs exactes que le formulaire d’OverCrow a envoyées. |

<!-- source: templates/chart/tests/example.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["Activity", "50"], "image": "initial" } },
    { "advance": { "ms": 10000 } },
    { "expect": { "noText": ["50"], "image": "ten-seconds", "fault": "none" } }
  ]
```

Les fautes que la VM d’un widget peut signaler :

<!-- generated:fault-categories -->
| Catégorie | Fatale | Signification |
| --- | --- | --- |
| `resource_limit` | oui | Le tas, la pile, la file des tâches ou le budget de messages est épuisé dans la VM. |
| `unresponsive` | oui | Le budget de temps d’un tour a interrompu la VM. |
| `protocol_violation` | oui | L’hôte a envoyé un message que la VM ne peut pas accepter. |
| `invalid_bundle` | oui | `logic.js` ou la vue compilée n’a pas pu être chargé ou enregistré. |
| `handler_exception` | non | Un gestionnaire d’événement a levé une exception ; la VM continue. |
<!-- /generated:fault-categories -->

## Images de référence

Une image est le contenu du widget, rendu à l’échelle, dans le thème et à la
taille du scénario. Enregistrez les états qui comptent dans les deux thèmes,
les deux langues et à deux échelles, comme le font les widgets de
référence : un scénario peut changer `theme`, `locale` et `scale` entre deux
étapes `expect`.

<!-- source: templates/list/tests/example.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["Today", "2 left"], "image": "initial" } },
    { "host": { "locale": "fr", "theme": "light" } },
    { "expect": { "image": "french-light", "fault": "none" } }
  ]
```

Les images sont comparées avec une petite tolérance : un pixel diffère quand
l’un de ses canaux diffère de plus de 2 niveaux, et l’image diffère quand
plus de 100 pixels par million diffèrent. Une seule lettre fausse dépasse
largement ce seuil. Une exécution des tests ne réécrit jamais une
référence : seul `--update` enregistre des images.

## Temps et déterminisme

Le runtime est déterministe : le même paquet et le même scénario rendent les
mêmes octets, sous Linux comme sous Windows.

- Le temps est virtuel : `Date.now()` et `new Date()` renvoient le temps du
  scénario, et les minuteurs se déclenchent quand le scénario l’avance.
- `Math.random()` est initialisé avec une graine fixe.
- Le texte utilise les polices fournies avec OverCrow, jamais celles du
  système.
- Le rendu ne dépend pas de la carte graphique.

Cela ne vaut que pour le runtime de test : dans l’overlay, le temps et le
hasard sont réels.

## Le runtime headless

`overcrow-widget-headless` est le code d’OverCrow lui-même, sans fenêtre :
il valide le paquet comme le fait l’overlay et exécute la logique du widget
dans le même sandbox. `overcrow-widget test` exécute la version que la CLI
épingle, 0.6.0-beta.1, et affiche sa version et son SHA-256. Sans le
sandbox du système d’exploitation, le runtime refuse de s’exécuter et le
dit ; la commande de test se termine alors avec le code 2.

La CLI ne télécharge pas le runtime. Prenez-le dans la
[release OverCrow 0.6.0-beta.1](https://github.com/Valhallab/playervox-overcrow-releases/releases/tag/v0.6.0-beta.1),
vérifiez-le avec le `SHA256SUMS` de la release, puis placez-le dans le
cache de la CLI :

| Plateforme | Chemin |
| --- | --- |
| Linux | `~/.cache/overcrow-widget/runtime/0.6.0-beta.1/overcrow-widget-headless-0.6.0-beta.1-linux-x86_64` (`$XDG_CACHE_HOME` au lieu de `~/.cache` s’il est défini), exécutable |
| Windows | `%LOCALAPPDATA%\overcrow-widget\runtime\0.6.0-beta.1\overcrow-widget-headless-0.6.0-beta.1-windows-x86_64.exe` |

```sh
sha256sum --check --ignore-missing SHA256SUMS
mkdir -p ~/.cache/overcrow-widget/runtime/0.6.0-beta.1
install -m 755 overcrow-widget-headless-0.6.0-beta.1-linux-x86_64 \
  ~/.cache/overcrow-widget/runtime/0.6.0-beta.1/
```

La CLI vérifie son SHA-256 avant chaque exécution. S’il manque, `test` dit
où le placer. `--runtime <path>` exécute un autre runtime à la place, par
exemple compilé depuis OverCrow ; la sortie dit alors que ce n’est pas le
runtime épinglé.
