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
.back:focus,
.refresh:focus {
  border-color: var(--color-user-accent-outline);
}
```

<!-- source: widgets/warframe-market/style.ocss -->
```css
.clear:disabled .clear-text {
  color: var(--color-text-muted);
}
```

Les états sont résolus par PlayerVox OverCrow, pas par votre logique :
`:hover` et `:active` suivent le pointeur, `:focus` le focus clavier,
`:disabled` l’attribut `disabled`, et `:checked` l’état d’un `toggle` ou
d’une `checkbox`. OverCrow ne signale pas au widget les mouvements du
pointeur : un effet de survol ne lui coûte rien.

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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
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

Un widget ne peut pas dessiner hors de son cadre : PlayerVox OverCrow le
rogne.

## Valeurs

Les valeurs s’écrivent comme en CSS, dans certaines limites : les longueurs
en `px` (`0` peut omettre l’unité) et les pourcentages, les couleurs sous la
forme `#rrggbb`, `#rrggbbaa` ou `rgb(r g b / a)`, les durées en `ms` ou en
`s`, les angles en `deg` ou en `turn`, et les tokens sous la forme
`var(--name)`. La notation exacte de chaque sorte de valeur figure dans
[valeurs](style-properties.md#valeurs).

Les longueurs sont des pixels logiques : PlayerVox OverCrow les multiplie
par l’échelle du contenu de l’utilisateur (de 50 % à 175 %) et par la
densité de l’écran. `12px` a donc la même taille physique sur tous les
écrans. Les propriétés raccourcies se développent comme en CSS : une à
quatre valeurs pour les côtés et les coins, une ou deux pour les
espacements.

## Tokens du design system

Un token est une valeur du design system de PlayerVox OverCrow, écrite
`var(--name)`. Les tokens de couleur changent avec le thème de
l’utilisateur, clair ou sombre : un widget stylé avec des tokens suit le
thème sans aucun code. Préférez-les aux couleurs littérales.

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

PlayerVox OverCrow dessine le panneau derrière le widget
(`--color-surface-panel`), son cadre et son ombre : partez d’un fond
transparent.

## Accent de l’utilisateur

PlayerVox OverCrow permet à l’utilisateur de choisir une couleur d’accent,
lime par défaut. Un widget peut la suivre. Déclarez-le dans le manifeste :

<!-- source: docs/content/examples/daily-goal/manifest.json -->
```json
  "accent": "user-roles"
```

Le widget dispose alors d’un token pour chaque usage de l’accent.
Choisissez le token selon ce que vous dessinez, et sur quoi :

| Vous dessinez | Token |
| --- | --- |
| Un remplissage qui porte un texte ou une marque : un bouton principal, un badge, une pastille sélectionnée | `--color-user-accent` |
| Le texte et les icônes posés sur ce remplissage | `--color-on-user-accent` |
| Ce remplissage sous le pointeur ou avec le focus | `--color-user-accent-hover` |
| Un voile derrière un contenu sélectionné | `--color-user-accent-soft` |
| Un texte ou une icône sur le panneau ou sur une autre surface | `--color-user-accent-text` |
| Ce texte sous le pointeur ou pressé | `--color-user-accent-text-hover` |
| Une bordure, un rail, un soulignement, un anneau, une jauge sur une surface | `--color-user-accent-outline` |

<!-- source: docs/content/examples/daily-goal/style.ocss -->
```css
/* Today is the selected day: a wash of the accent inside its outline. */
.today {
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-user-accent-outline);
  border-radius: var(--radius-lg);
  background: var(--color-user-accent-soft);
}

/* A gauge on a surface is an indicator: the outline, which stays visible
   in every colour. */
.ring {
  width: 40px;
  height: 40px;
  color: var(--color-user-accent-outline);
}

/* Accent text on a surface: readable in every colour, red included. */
.count {
  font-size: var(--font-size-body);
  font-variant-numeric: tabular-nums;
  color: var(--color-user-accent-text);
}

/* A fill carries its own text colour. */
.done {
  background: var(--color-user-accent);
  color: var(--color-on-user-accent);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-4);
}
```

`--color-user-accent` est un remplissage, jamais une couleur de texte ni un
trait fin sur une surface : certaines couleurs, dont le rouge, ne se voient
pas sur le panneau sombre. Pour une telle couleur,
`--color-user-accent-text` et `--color-user-accent-outline` prennent la
couleur du texte. Les deux restent lisibles dans les neuf couleurs et les
deux thèmes, sur chaque token de surface (`--color-surface-panel`,
`-raised`, `-hover`, `-field`, `-popover`) : 4,5:1 pour le texte, 3:1 pour
le contour. Ils ne tiennent pas le même rapport et peuvent différer :
utilisez `-text` pour un texte ou une icône, `-outline` pour une bordure,
un rail, un anneau ou une jauge. Une bordure autour d’un élément rempli à
la couleur d’accent fait partie du remplissage : donnez-lui le token de son
fond.

Un remplissage a son propre état de survol, et `--color-on-user-accent`
reste lisible sur les deux :

<!-- source: docs/content/examples/daily-goal/style.ocss -->
```css
/* The main action: the fill, and its hover state under the pointer. */
.add {
  height: var(--control-height);
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-md);
  background: var(--color-user-accent);
  color: var(--color-on-user-accent);
}

.add:hover {
  background: var(--color-user-accent-hover);
}
```

### Ce qui suit l’accent

Avec `"accent": "user-roles"`, deux choses prennent la couleur de
l’utilisateur :

- les sept tokens `--color-user-accent…` ;
- les contrôles que PlayerVox OverCrow dessine dans le widget : une
  bascule (`toggle`) ou une case à cocher (`checkbox`) cochée, la partie
  remplie d’un curseur (`slider`), l’anneau de focus, le texte sélectionné
  et la ligne courante d’une liste déroulante (`select`). Rien à écrire :
  la déclaration suffit. Sans elle, ils restent en lime.

En lime, un widget garde exactement les couleurs de la marque : chaque
token a la valeur de son token de marque (`--color-accent`,
`--color-on-accent`, `--color-accent-hover`, `--color-accent-soft`).

Ne suivent jamais l’accent :

- `--color-accent` et ses variantes, l’accent de la marque : lime, quelle
  que soit la couleur choisie par l’utilisateur ;
- les couleurs d’état : `--color-success` pour une réussite,
  `--color-warning` pour un avertissement, `--color-danger` pour une erreur
  ou une action destructrice. Le vert, l’ambre et le rouge disent la même
  chose dans chaque accent : n’utilisez jamais l’accent pour un état ;
- les couleurs que vous écrivez vous-même, comme celles d’une autre marque.

### L’accent dans la logique

La logique obtient le nom de la couleur dans `host.userAccent`, et la
couleur de chaque rôle dans le thème actif avec `userAccentRoles()`. Une
commande de dessin peut nommer un token, qui suit seul le choix de
l’utilisateur ; une couleur tirée d’une valeur, comme un voile translucide,
c’est à vous de la redessiner :

<!-- source: docs/content/examples/daily-goal/logic.ts -->
```ts
function paint(): void {
  // A dot on the panel is an indicator: the outline role. A token follows
  // the user's colour by itself; a wash needs the colour's value, with an
  // alpha added.
  const { outline } = userAccentRoles();
  const dots: DrawCommand[] = [];
  state.week.forEach((reached, day) => {
    dots.push(["circle", 6 + day * 14, 6, 4]);
    dots.push(["fill", reached ? "var(--color-user-accent-outline)" : `${outline}40`]);
  });
  draw("week", dots);
}
```

L’utilisateur peut choisir une autre couleur pendant que le widget tourne.
Le style, les tokens et les contrôles suivent aussitôt ; redessinez une
couleur calculée quand `userAccent` ou `theme` change :

<!-- source: docs/content/examples/daily-goal/logic.ts -->
```ts
onHost((changed) => {
  if (changed.includes("userAccent") || changed.includes("theme")) {
    paint();
  }
});
```

Le widget n’apprend que le nom de la couleur, sans permission, comme il
apprend la langue. Sans la déclaration, il reçoit lime, et `check` refuse
un style qui utilise ces tokens (`style.undeclared_user_accent`). Les
valeurs des neuf couleurs figurent dans
[accent de l’utilisateur](style-properties.md#accent-de-lutilisateur).

### La forme réduite

`"accent": "user"`, la première forme de la déclaration, reste valable.
Elle ne donne que deux tokens, `--color-user-accent` et
`--color-on-user-accent` ; les contrôles restent en lime, et
`userAccentColors()` donne les deux valeurs. Son lime n’est pas celui de la
marque : `#18181b` sur `#a3e635` en thème sombre, sur `#84cc16` en thème
clair.

Une version qui déclare `"user-roles"` demande un PlayerVox OverCrow qui
connaît les rôles. Un plus ancien garde la version du widget qu’il a déjà,
jusqu’à sa mise à jour.

## Texte

Les propriétés de texte (`color`, `font-family`, `font-size`, `font-weight`,
`line-height`, `text-align`…) sont héritées, comme en CSS : définissez-les
sur un conteneur pour styler ce qu’il contient.

- Il existe trois familles de police : `ui` (Noto Sans, la valeur par
  défaut), `mono` (Noto Sans Mono, pour les valeurs) et `display` (Space
  Grotesk, pour les grades et les scores). PlayerVox OverCrow les embarque ;
  les polices du système ne sont jamais utilisées : un widget a donc le même
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
celles-là. PlayerVox OverCrow exécute l’animation lui-même : aucun minuteur
ni aucun code du widget ne tourne pendant qu’elle joue, et rien n’est
redessiné quand rien ne change. Un widget masqué ne s’anime pas.

`@keyframes` est la seule règle @. Son nom est un identifiant qui n’est pas
un mot-clé d’animation, unique dans la feuille.

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
