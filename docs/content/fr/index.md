# Créer des widgets pour OverCrow

Un widget OverCrow est un petit paquet que l’overlay affiche par-dessus votre
jeu : une horloge, un compteur d’images par seconde, une checklist, un chat.
Vous décrivez sa vue en balisage, vous la stylez avec un petit sous-ensemble
de CSS et vous écrivez sa logique en TypeScript avec `@overcrow/sdk`. L’outil
en ligne de commande `overcrow-widget` le vérifie, le teste et l’empaquette ;
le catalogue signé l’apporte aux utilisateurs.

Tous les widgets intégrés d’OverCrow sont écrits ainsi, avec le même SDK
public, le même format de paquet et le même sandbox que les vôtres. Leurs
sources sont les [widgets de référence](widgets.md).

## De quoi est fait un widget

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Identité, version, noms, règles de taille, menu d’options et permissions demandées. |
| `view.ocml` | La vue : des éléments comme `box`, `text`, `button`, `list` ou `chart`, liés à l’état par des expressions `{…}`. |
| `style.ocss` | Le style, facultatif : mise en page flex et grid, couleurs, bordures, typographie, avec les tokens du thème. |
| `logic.ts` | La logique : l’état, les gestionnaires d’événements, les minuteurs et les appels aux services de l’hôte. |
| `locales/en.json`, `locales/fr.json` | Les messages en anglais et en français, facultatifs. |
| `LICENSE` | La licence de votre widget. |

La vue et la logique se rencontrent ainsi : la vue lit `state.count` et
appelle les gestionnaires que la logique exporte.

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

<!-- source: templates/counter/logic.ts -->
```ts
const state = initState({ count: 0 });

export function increment(): void {
  state.count += 1;
}
```

## Comment un widget s’exécute

- La logique tourne dans sa propre petite machine virtuelle JavaScript, dans
  son propre processus isolé. Elle n’a ni DOM, ni système de fichiers, ni
  réseau, ni accès aux autres widgets : elle ne parle à OverCrow que par le
  SDK.
- Après chaque événement, tick de minuteur ou réponse d’un service, la VM
  évalue de nouveau la vue et n’envoie à OverCrow que ce qui a changé.
  OverCrow met en page et dessine le widget lui-même : aucun moteur web
  n’intervient.
- Tout ce qui sort du widget (réseau, stockage, presse-papiers, données de
  jeu) passe par un service de l’hôte, qui vérifie à chaque appel les
  permissions déclarées et accordées. Voir [sécurité](security.md).

## Par où commencer

1. Suivez le [guide du créateur](guide.md) : de `overcrow-widget init` à un
   widget soumis.
2. Lisez les [widgets de référence](widgets.md) : les widgets intégrés, avec
   leurs tests.
3. Cherchez un élément, une propriété de style, un service ou une fonction
   du SDK dans la [référence](reference.md).
4. Avant de publier, lisez [sécurité](security.md) et
   [publication et revue](publishing.md).

Les widgets fonctionnent de la même façon sous Windows et sous Linux : le
même paquet, le même SDK et le même rendu.
