# Le style

`style.ocss` met en forme la vue d’un widget PlayerVox OverCrow avec un
sous-ensemble de CSS, réduit et borné : règles, sélecteurs de classe et
d’élément, mise en page flex et grid, couleurs, bordures, typographie,
transitions et animations. Si vous connaissez CSS, vous en connaissez la
syntaxe ; la différence, c’est que le sous-ensemble est fermé. Une
propriété, un sélecteur ou une valeur qui n’en fait pas partie est une
erreur que signale `overcrow-widget check`, et non une déclaration ignorée
en silence.

<!-- source: templates/counter/style.ocss -->
```css
.counter {
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
}

.value {
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
}

.actions {
  gap: var(--space-2);
}

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

Le fichier est facultatif. Sans lui, le widget prend les valeurs par
défaut : une `box` dispose ses enfants à l’horizontale, le texte a la
couleur et la taille du thème.

## Règles et sélecteurs

Une règle est une liste de sélecteurs, suivie de déclarations entre
accolades. Chaque propriété apparaît au plus une fois par règle ; le dernier
`;` est facultatif. Les commentaires s’écrivent `/* … */`.

<!-- generated:selectors -->
| Sélecteur | Signification |
| --- | --- |
| `text` | Type d’élément ; spécificité (0, 1). |
| `.name` | Classe ; spécificité (1, 0). |
| `:hover :active :focus :disabled :checked` | État résolu par l’hôte ; spécificité (1, 0). `:checked` s’applique à `toggle` et à `checkbox`. |
| `a b` | Combinateur de descendance. |
| `a > b` | Combinateur d’enfant direct. |
| `a, b` | Liste de sélecteurs ; chaque sélecteur garde sa propre spécificité. |
<!-- /generated:selectors -->

Un sélecteur composé est un nom d’élément facultatif, suivi de classes et
d’états : `button.primary:hover`. Les sélecteurs composés s’enchaînent par
une espace (descendant) ou par `>` (enfant).

<!-- source: widgets/warframe-market/style.ocss -->
```css
.clear:focus,
.result:focus,
.copy:focus,
.back:focus {
  border-color: var(--color-accent);
}
```

<!-- source: widgets/warframe-market/style.ocss -->
```css
.clear:disabled .clear-text {
  color: var(--color-text-muted);
}
```

Les états sont résolus par OverCrow, pas par votre logique : `:hover` et
`:active` suivent le pointeur, `:focus` le focus clavier, `:disabled`
l’attribut `disabled`, et `:checked` l’état d’un `toggle` ou d’une
`checkbox`. OverCrow ne signale pas au widget les mouvements du pointeur :
un effet de survol ne lui coûte rien.

Quand deux règles définissent la même propriété, le sélecteur le plus
spécifique l’emporte : les classes et les états comptent d’abord, puis les
noms d’éléments. À sélecteurs égaux, la règle écrite en dernier l’emporte.
Il n’y a pas de `!important`.

## Mise en page

Tout conteneur est par défaut un conteneur flex (`display: flex`, à
l’horizontale). `display: grid` en fait une grille, et `display: none`
retire l’élément et ses enfants de la mise en page tout en les gardant dans
la vue.

<!-- source: templates/list/style.ocss -->
```css
.checklist {
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
}
```

<!-- source: widgets/warframe-market/style.ocss -->
```css
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
```

Flex et grid fonctionnent comme en CSS, avec les propriétés du
[groupe Mise en page](style-properties.md#mise-en-page) : `flex-direction`,
`flex-grow`, `gap`, `justify-content`, `align-items`,
`grid-template-columns`, `grid-column`… Un élément peut aussi sortir du flux
avec `position: absolute` ; il se place alors par rapport à son parent avec
`top`, `right`, `bottom` et `left`. Deux éléments placés dans la même
cellule de grille se superposent. C’est ainsi que l’exemple du compte à
rebours place le temps au milieu de son anneau :

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
/* The time sits in the middle of the ring: both share one grid cell. */
.dial {
  display: grid;
  grid-template-columns: 72px;
  grid-template-rows: 72px;
  justify-content: center;
  justify-items: center;
  align-items: center;
}
```

Un widget ne peut pas dessiner hors de son cadre : OverCrow le rogne.

## Valeurs

Les valeurs s’écrivent comme en CSS, dans certaines limites : les longueurs
en `px` (`0` peut omettre l’unité) et les pourcentages, les couleurs sous la
forme `#rrggbb`, `#rrggbbaa` ou `rgb(r g b / a)`, les durées en `ms` ou en
`s`, les angles en `deg` ou en `turn`, et les tokens sous la forme
`var(--name)`. La notation exacte de chaque sorte de valeur figure dans
[valeurs](style-properties.md#valeurs).

Les longueurs sont des pixels logiques : OverCrow les multiplie par
l’échelle du contenu de l’utilisateur (de 50 % à 175 %) et par la densité de
l’écran. `12px` a donc la même taille physique sur tous les écrans. Les
propriétés raccourcies se développent comme en CSS : une à quatre valeurs
pour les côtés et les coins, une ou deux pour les espacements.

## Tokens du design system

Un token est une valeur du design system d’OverCrow, écrite `var(--name)`.
Les tokens de couleur changent avec le thème de l’utilisateur, clair ou
sombre : un widget stylé avec des tokens suit le thème sans aucun code.
Préférez-les aux couleurs littérales.

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.start {
  width: var(--control-height);
  height: var(--control-height);
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  transition: background-color var(--duration-fast) ease-out;
}
```

Un token représente une valeur entière ou une partie d’une valeur composée
(`padding: var(--space-2) var(--space-4)`). Il doit avoir le type qu’attend
la propriété : un token de couleur pour une couleur, un token de longueur
pour une longueur. Il n’y a pas d’argument de repli, et un widget ne peut
pas déclarer ses propres propriétés personnalisées. Tous les tokens sont
listés dans
[tokens du design system](style-properties.md#tokens-du-design-system).

OverCrow dessine le panneau derrière le widget (`--color-surface-panel`),
son cadre et son ombre : partez d’un fond transparent.

## Texte

Les propriétés de texte (`color`, `font-family`, `font-size`, `font-weight`,
`line-height`, `text-align`…) sont héritées, comme en CSS : définissez-les
sur un conteneur pour styler ce qu’il contient.

- Il existe trois familles de police : `ui` (Noto Sans, la valeur par
  défaut), `mono` (Noto Sans Mono, pour les valeurs) et `display` (Space
  Grotesk, pour les grades et les scores). OverCrow les embarque ; les
  polices du système ne sont jamais utilisées : un widget a donc le même
  aspect sur toutes les machines.
- `font-variant-numeric: tabular-nums` donne la même largeur à tous les
  chiffres : un nombre qui change ne déplace pas ses voisins.
- `text-overflow: ellipsis` coupe par `…` une ligne qui déborde ;
  `text-overflow: marquee` la fait défiler dans un sens puis dans l’autre,
  avec une pause à chaque extrémité. `line-clamp` limite un texte à un
  nombre de lignes.
- Une `icon` prend la `color` et le `font-size` de l’endroit où elle se
  trouve, sauf si `width` et `height` sont définis. Dans une ligne de texte,
  `vertical-align: middle` centre sur la ligne une `icon` ou une `image` en
  ligne.

Gardez le texte à 11 px ou plus (`--font-size-small`) : un texte plus petit
se lit mal par-dessus un jeu.

## Transitions et animations

`transition` anime le changement d’une propriété animable ; `animation` joue
un bloc `@keyframes` de la même feuille.

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.ring.done {
  color: var(--color-success);
  animation: countdown-pulse 800ms ease-in-out 3 alternate;
}
```

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
@keyframes countdown-pulse {
  from { opacity: 1; }
  to { opacity: 0.4; }
}
```

Seules les propriétés qui modifient le dessin, et non la mise en page,
peuvent être animées : `opacity`, `color`, `background-color`,
`border-color` et `transform`. Un bloc `@keyframes` ne contient que
celles-là. OverCrow exécute l’animation lui-même : aucun minuteur ni aucun
code du widget ne tourne pendant qu’elle joue, et rien n’est redessiné quand
rien ne change. Un widget masqué ne s’anime pas.

`@keyframes` est la seule règle @. Son nom est un identifiant qui n’est pas
un mot-clé d’animation, unique dans la feuille.

### Mouvement réduit

Un utilisateur peut demander à OverCrow de réduire les animations, dans ses
réglages ou par la préférence de son système. OverCrow ne joue alors ni
transition ni animation : un changement s’affiche aussitôt, une animation
qui se termine montre sa fin (sa dernière image clé avec `forwards`, le
style propre de l’élément sinon), et une animation qui se répète sans fin
ne joue pas : l’élément montre son style propre. Un texte
`text-overflow: marquee` ne défile pas : il est coupé par des points de
suspension.

Un widget n’a rien à faire, et sa logique n’est pas informée de la
préférence. Écrivez le style propre d’un élément comme son aspect lisible
et au repos, et gardez le mouvement dans le style : un minuteur qui déplace
quelque chose pas à pas ne serait pas arrêté. Pour capturer cet aspect dans
un test, mettez `reducedMotion` dans le [`host`](testing.md#host) d’un
scénario.

## Ce qui est refusé

Chacune de ces constructions fait refuser la feuille entière :

- `!important`, `@media`, `@import`, `@font-face` et toute autre règle @ ;
- `url()`, `calc()` et les autres fonctions CSS ; les chaînes et les
  échappements ;
- les déclarations de propriétés personnalisées (`--name: …`) ;
- les sélecteurs d’ID, d’attribut et universel (`*`), les pseudo-éléments,
  les pseudo-classes fonctionnelles (`:not()`, `:nth-child()`), les
  combinateurs de frères ;
- les couleurs nommées (`red`), les exposants, les unités autres que `px`,
  `%`, `fr`, `ms`, `s`, `deg` et `turn` ;
- les caractères hors ASCII, sauf dans les commentaires.

Il n’y a pas de requête média parce qu’il n’y a rien à interroger : la
taille du widget est celle que lui donne l’utilisateur, et la logique la lit
dans `host.viewport` quand la vue doit changer avec elle.

## Quand le style est incorrect

| Code | Problème |
| --- | --- |
| `style.syntax`, `style.encoding`, `style.size` | Le fichier n’est pas une feuille bien formée. |
| `style.unsupported` | Une construction CSS hors du sous-ensemble (voir ci-dessus). |
| `style.unknown_element`, `style.unknown_pseudo_class`, `style.invalid_selector` | Un sélecteur qui ne nomme aucun élément ou aucun état, ou qui est hors du sous-ensemble. |
| `style.unknown_property`, `style.duplicate_property` | Une propriété hors du sous-ensemble, ou définie deux fois dans une règle. |
| `style.invalid_value`, `style.unknown_token` | Une valeur que la propriété n’accepte pas, ou un token qui n’existe pas ou qui a un autre type. |
| `style.not_animatable` | Une transition ou une étape de `@keyframes` sur une propriété qui ne peut pas être animée. |
| `style.unknown_keyframes`, `style.duplicate_keyframes`, `style.invalid_keyframes` | Une `animation` qui ne nomme aucun bloc, un nom utilisé deux fois, ou un bloc invalide. |
| `style.too_many_rules`, `style.too_many_selectors`, `style.too_many_compounds`, `style.too_many_simple_selectors`, `style.too_many_declarations`, `style.too_many_keyframes`, `style.too_many_stops` | Une [limite](limits.md) du style est dépassée. |

Un nom inconnu est signalé avec, en suggestion, le nom le plus proche du
schéma. Chaque propriété, ses valeurs et sa valeur initiale figurent dans
[propriétés de style et tokens](style-properties.md).
