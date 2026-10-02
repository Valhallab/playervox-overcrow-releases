# Créer des widgets pour PlayerVox OverCrow

Un widget PlayerVox OverCrow est un petit paquet que l’overlay dessine
par-dessus votre jeu : une horloge, un compteur d’images par seconde, une
liste de tâches, un chat. Vous décrivez sa vue en balisage, vous la stylez
avec un petit sous-ensemble de CSS et vous écrivez sa logique en TypeScript
avec `@overcrow/sdk`. L’outil en ligne de commande `overcrow-widget` le
vérifie, le teste et l’empaquette ; le catalogue signé l’apporte aux
utilisateurs.

Tous les widgets intégrés d’OverCrow sont écrits ainsi, avec le même SDK
public, le même format de paquet et le même sandbox que les vôtres. Leurs
sources sont les [widgets de référence](widgets.md).

## De quoi est fait un widget

| Fichier | Rôle | Page |
| --- | --- | --- |
| `manifest.json` | Identité, version, noms, règles de taille, menu d’options et permissions que le widget demande. | [Le manifeste](manifest.md) |
| `view.ocml` | La vue : des éléments comme `box`, `text`, `button`, `list` ou `chart`, liés à l’état par des expressions `{…}`. | [La vue](view.md) |
| `style.ocss` | Le style, facultatif : mise en page flex et grid, couleurs, bordures, typographie, avec les tokens du thème. | [Le style](style.md) |
| `logic.ts` | La logique : l’état, les gestionnaires d’événements, les minuteurs et les appels aux services. | [La logique](logic.md) |
| `locales/en.json`, `locales/fr.json` | Les messages en anglais et en français, facultatifs. | [Messages](logic.md#messages) |
| `LICENSE` | La licence de votre widget. | [Le paquet](package.md) |

La vue et la logique se rejoignent ainsi : la vue lit `state.count` et
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

- La logique tourne dans sa propre petite VM JavaScript, dans son propre
  processus, enfermé dans un sandbox. Elle n’a ni DOM, ni système de
  fichiers, ni réseau, ni accès aux autres widgets : elle n’atteint OverCrow
  que par le SDK.
- Après chaque événement, déclenchement de minuteur ou réponse d’un service,
  la VM évalue de nouveau la vue et n’envoie à OverCrow que ce qui a changé.
  OverCrow met en page et dessine le widget lui-même : aucun moteur web
  n’intervient.
- Tout ce qui touche à l’extérieur (réseau, stockage, presse-papiers,
  données de jeu) est un service d’OverCrow. À chaque appel, celui-ci
  vérifie les permissions que le widget a déclarées et que l’utilisateur a
  accordées. Voir [services et permissions](services.md).

Ces pages appellent OverCrow **l’hôte** quand elles décrivent ce qu’il fait
pour un widget : l’hôte dessine la vue, répond aux services et conserve les
données de l’utilisateur.

## Par où commencer

1. Suivez le [guide du créateur](guide.md) : de `overcrow-widget init` à un
   widget soumis, en douze courtes étapes.
2. Lisez les [widgets de référence](widgets.md) : les widgets intégrés, avec
   leurs tests.
3. Approfondissez, un thème par page : le [manifeste](manifest.md), la
   [vue](view.md), le [style](style.md), la [logique](logic.md), les
   [services et permissions](services.md), les [formulaires](forms.md).
4. Servez-vous des outils : la [CLI](cli.md), les [tests](testing.md) et le
   [canal de développement](dev-channel.md), qui exécute votre widget dans
   OverCrow pendant que vous l’écrivez.
5. Cherchez un élément, une propriété de style, un service ou une fonction
   du SDK dans la [référence](reference.md).
6. Avant de publier, lisez [le paquet](package.md),
   [sécurité](security.md) et [publication et revue](publishing.md).

Les widgets fonctionnent de la même façon sous Windows et sous Linux : le
même paquet, le même SDK et le même rendu.
