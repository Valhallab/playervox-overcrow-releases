# Guide du créateur

Ce guide mène un widget d’un dossier vide à une soumission : créer un
projet, modifier sa vue, son style et sa logique, le lancer dans OverCrow, le
tester, l’empaqueter et le soumettre. Chaque étape renvoie au manuel qui la
détaille ; les manuels de référence sont en anglais.

## 1. Installer les outils

- **`overcrow-widget`**, le CLI des widgets, un seul binaire pour Linux et
  Windows. En attendant sa première release, compilez-le depuis ce dépôt
  avec la toolchain Rust épinglée : voir
  [installing the CLI](../../cli.md#installing).
- **Node.js 22 ou plus récent**, pour que `check` vérifie les types de votre
  logique avec le TypeScript du projet. Sans lui, le CLI vérifie et
  empaquette quand même, mais signale que les types n’ont pas été vérifiés.
- **OverCrow**, pour lancer le widget pendant que vous l’écrivez.

`overcrow-widget doctor` indique ce que votre installation a et ce qui lui
manque.

## 2. Créer un projet

```sh
overcrow-widget init my-counter --template counter
cd my-counter
npm install
```

Les templates sont `blank`, `counter`, `list` et `chart`. L’ID vaut par
défaut `com.example.<dossier>` : passez `--id` avec un nom DNS inversé que
vous contrôlez (`com.playervox.*` est réservé). La
[structure du projet](../../cli.md#project-layout) liste chaque fichier et
indique lesquels sont empaquetés.

## 3. La vue

`view.ocml` est du balisage : des éléments, des attributs, des expressions
`{…}` liées à l’état, et des gestionnaires `on:<événement>` qui appellent
des fonctions exportées par la logique.

<!-- source: templates/counter/view.ocml -->
```xml
<box class="counter">
  <text class="value">{state.count}</text>
  <box class="actions">
    <button class="step" label={t("decrement")} on:activate={decrement}>
      <icon name="minus"/>
    </button>
    <button class="step" label={t("increment")} on:activate={increment}>
      <icon name="plus"/>
    </button>
  </box>
</box>
```

Les gabarits offrent aussi `if`, `for` avec une clé obligatoire, et des
composants locaux. Chaque élément et attribut figure dans la
[référence](reference.md) ; la syntaxe est décrite dans
[source formats](../../widget-source-formats.md).

## 4. Le style

`style.ocss` est un sous-ensemble borné de CSS : sélecteurs de classe,
d’élément, de descendant et d’enfant, états `:hover`, `:active`, `:focus`,
`:disabled` et `:checked`, mise en page flex et grid, et les tokens du thème
en `var(--…)`, qui suivent le thème clair ou sombre de l’utilisateur.

<!-- source: templates/counter/style.ocss -->
```css
.step {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}

.step:hover {
  background: var(--color-surface-hover);
}
```

Il n’y a ni `@media`, ni `@import`, ni `url()`, ni `calc()` : une
propriété ou un sélecteur inconnu est une erreur, pas un effet silencieux.

## 5. La logique

`logic.ts` possède l’état. Déclarez son type une fois, modifiez-le dans vos
gestionnaires, et la vue suit : après chaque tour, la VM évalue de nouveau
la vue et n’envoie que ce qui a changé.

<!-- source: templates/counter/logic.ts -->
```ts
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
```

La logique tourne dans une VM isolée, pas dans un navigateur : il n’y a ni
DOM, ni `fetch`, ni `setTimeout`, ni `console`, ni `Intl`. Le SDK fournit
les minuteurs, les services de l’hôte, des fonctions de formatage des heures
et des nombres au format régional de l’utilisateur, les messages et le
dessin. Lisez le [SDK guide](../../sdk-guide.md).

## 6. Les messages

`t("clé")`, dans la vue ou la logique, lit `locales/en.json` ou
`locales/fr.json` selon la langue de l’utilisateur et remplit les paramètres
`{nom}`.

<!-- source: templates/counter/locales/en.json -->
```json
{
  "decrement": "Decrease",
  "increment": "Increase"
}
```

Fournissez les deux fichiers ou aucun, avec les mêmes clés.

## 7. Vérifier

```sh
overcrow-widget check
```

`check` exécute les mêmes validateurs qu’OverCrow : manifeste, vue, style,
messages, une analyse de la logique selon ce que la VM exécute, le
TypeScript du projet, et un paquet construit en mémoire puis relu. Chaque
problème a un code stable, une position et une aide ; voir les
[diagnostics](../../cli.md#diagnostics).

## 8. Le lancer dans OverCrow

```sh
overcrow-widget dev
```

`dev` envoie le widget à l’overlay OverCrow de votre machine et le recharge
à chaque enregistrement. OverCrow ne le permet que s’il a été lancé avec les
installations de développement autorisées (`OVERCROW_WIDGET_DEVELOPMENT=1` ;
`overcrow-widget doctor` affiche les commandes). Le widget porte la mention
**Unverified · development package** ; ses permissions déclarées sont
accordées pour la session seulement, et rien n’est conservé. Les
`log.info(…)` de votre logique s’affichent dans le terminal. Détails :
[`dev`](../../cli.md#dev-dir).

## 9. Le tester

Deux sortes de tests, décrites dans [testing a widget](../../widget-testing.md) :

- des tests unitaires de la logique avec `@overcrow/sdk/testing`, qui
  exécute votre module avec un temps virtuel et des services simulés ;
- des scénarios joués par `overcrow-widget test` dans le runtime headless
  d’OverCrow : la vraie VM et le vrai rendu, des services qui répondent avec
  des fixtures, et des images comparées à des références.

<!-- source: templates/counter/tests/example.scenario.json -->
```json
  "host": { "mode": "interactive" },
  "steps": [
    { "expect": { "state": "running", "text": ["0"], "image": "initial" } },
    { "pointer": { "click": { "label": "Increase" } } },
    { "expect": { "text": ["1"], "noText": ["0"], "image": "increased", "fault": "none" } }
  ]
```

```sh
overcrow-widget test --runtime path/to/overcrow-widget-headless
```

Le runtime headless sera publié avec les releases d’OverCrow ; tant que le
CLI n’en épingle pas un, passez son chemin avec `--runtime`.

## 10. Demander ce dont vous avez besoin

Un widget n’obtient rien par défaut. Pour appeler une API, conserver des
données ou lire des informations de jeu, déclarez-le dans `manifest.json` ;
l’utilisateur donne son accord avant que le widget n’y ait accès. Une règle
réseau nomme une origine HTTPS, une méthode et un chemin complet, avec des
paramètres typés :

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

<!-- source: docs/content/examples/weather/logic.ts -->
```ts
    const url = `https://api.example.com/v1/forecast/${state.city}?units=${state.units}`;
    const { status, body } = await http.fetch(url, { as: "json" });
```

L’exemple complet se trouve dans
[`docs/content/examples/weather`](../examples/weather/). Lisez
[sécurité](security.md) pour savoir ce que chaque permission autorise et ce
qu’un widget ne peut jamais faire.

## 11. Empaqueter

```sh
overcrow-widget package
overcrow-widget inspect dist/com.example.my-counter-0.1.0.ocpkg
```

`package` écrit un `.ocpkg` déterministe dans `dist/` : les mêmes sources
et la même version du CLI donnent les mêmes octets sur tous les systèmes.
`inspect` montre ce qu’un paquet contient et demande, comme le voit un
relecteur. Un paquet installé localement reste non vérifié ; les
utilisateurs obtiennent les widgets par le catalogue signé.

## 12. Soumettre

Ajoutez un `listing.json` avec le texte de la marketplace, lancez vous-même
l’admission, puis ouvrez une pull request qui ajoute votre widget sous
`widgets/<dossier>/` sur la branche `candidate` :

```sh
overcrow-widget admit
```

`admit` exécute exactement les contrôles de la CI de la marketplace. La
suite, de la revue au catalogue signé, est décrite dans
[publication et revue](publishing.md).
