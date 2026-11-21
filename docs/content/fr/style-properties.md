# Propriétés de style et tokens

Toutes les propriétés que `style.ocss` accepte dans un widget PlayerVox
OverCrow, avec leurs valeurs et leur valeur initiale, puis les tokens du
design system et les icônes. [Le style](style.md) explique les sélecteurs,
la mise en page, les tokens et les animations ; cette page en est la liste.

<!-- source: templates/chart/style.ocss -->
```css
.value {
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
}
```

Tout ce qui ne figure pas sur cette page est refusé à la vérification du
widget : une propriété, un mot-clé ou une unité hors des listes ci-dessous
est une erreur, accompagnée du nom le plus proche en suggestion.

## Lire une propriété

- **Valeur** utilise les notations de [valeurs](#valeurs) : `<px>`,
  `<percent>`, `<color>`… Un `|` sépare des alternatives, `?` marque une
  partie facultative.
- **Valeur initiale** est la valeur d’un élément qu’aucune règle ne style.
- **Héritée** : la propriété prend la valeur du parent quand aucune règle ne
  la définit ; définissez-la sur un conteneur.
- **Animable** : la propriété peut figurer dans une `transition` et dans un
  bloc `@keyframes`.

## Propriétés

<!-- generated:style-properties -->
### Mise en page

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `display` | `flex` \| `grid` \| `none` | `flex` | non | non |
| `position` | `relative` \| `absolute` | `relative` | non | non |
| `top` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `auto` | non | non |
| `right` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `auto` | non | non |
| `bottom` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `auto` | non | non |
| `left` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `auto` | non | non |
| `flex-direction` | `row` \| `column` \| `row-reverse` \| `column-reverse` | `row` | non | non |
| `flex-wrap` | `nowrap` \| `wrap` | `nowrap` | non | non |
| `flex-grow` | nombre de 0 à 1000 | `0` | non | non |
| `flex-shrink` | nombre de 0 à 1000 | `1` | non | non |
| `flex-basis` | `<px>` \| `<percent>` \| `auto` | `auto` | non | non |
| `justify-content` | `start` \| `end` \| `center` \| `stretch` \| `space-between` \| `space-around` \| `space-evenly` | `start` | non | non |
| `align-items` | `start` \| `end` \| `center` \| `baseline` \| `stretch` | `stretch` | non | non |
| `align-self` | `auto` \| `start` \| `end` \| `center` \| `baseline` \| `stretch` | `auto` | non | non |
| `align-content` | `start` \| `end` \| `center` \| `stretch` \| `space-between` \| `space-around` \| `space-evenly` | `stretch` | non | non |
| `justify-items` | `start` \| `end` \| `center` \| `stretch` | `stretch` | non | non |
| `justify-self` | `auto` \| `start` \| `end` \| `center` \| `stretch` | `auto` | non | non |
| `gap` | 1–2 × (`<px>` \| `<percent>`) | `0` | non | non |
| `row-gap` | `<px>` \| `<percent>` | `0` | non | non |
| `column-gap` | `<px>` \| `<percent>` | `0` | non | non |
| `grid-template-columns` | `none` \| liste ≤ 24 de `<track>`, ou `repeat(<integer>, <track>)` | `none` | non | non |
| `grid-template-rows` | `none` \| liste ≤ 24 de `<track>`, ou `repeat(<integer>, <track>)` | `none` | non | non |
| `grid-auto-flow` | `row` \| `column` | `row` | non | non |
| `grid-auto-columns` | `<track>`: `<px>` \| `<percent>` \| `<fr>` \| `auto` \| `min-content` \| `max-content` \| `minmax(<track>, <track>)` | `auto` | non | non |
| `grid-auto-rows` | `<track>`: `<px>` \| `<percent>` \| `<fr>` \| `auto` \| `min-content` \| `max-content` \| `minmax(<track>, <track>)` | `auto` | non | non |
| `grid-column` | `auto` \| `<integer>` \| `span <integer>` \| `<start> / <end>`, lignes de 1 à 24 | `auto` | non | non |
| `grid-row` | `auto` \| `<integer>` \| `span <integer>` \| `<start> / <end>`, lignes de 1 à 24 | `auto` | non | non |

### Boîte

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `width` | `<px>` \| `<percent>` \| `auto` | `auto` | non | non |
| `height` | `<px>` \| `<percent>` \| `auto` | `auto` | non | non |
| `min-width` | `<px>` \| `<percent>` \| `auto` | `auto` | non | non |
| `min-height` | `<px>` \| `<percent>` \| `auto` | `auto` | non | non |
| `max-width` | `<px>` \| `<percent>` \| `none` | `none` | non | non |
| `max-height` | `<px>` \| `<percent>` \| `none` | `none` | non | non |
| `aspect-ratio` | nombre de 0.01 à 100 | `auto` | non | non |
| `margin` | 1–4 × (`<px>` \| `<percent>` \| `auto`), valeurs négatives admises | `0` | non | non |
| `margin-top` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `0` | non | non |
| `margin-right` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `0` | non | non |
| `margin-bottom` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `0` | non | non |
| `margin-left` | `<px>` \| `<percent>` \| `auto`, valeurs négatives admises | `0` | non | non |
| `padding` | 1–4 × (`<px>` \| `<percent>`) | `0` | non | non |
| `padding-top` | `<px>` \| `<percent>` | `0` | non | non |
| `padding-right` | `<px>` \| `<percent>` | `0` | non | non |
| `padding-bottom` | `<px>` \| `<percent>` | `0` | non | non |
| `padding-left` | `<px>` \| `<percent>` | `0` | non | non |
| `overflow` | `visible` \| `hidden` | `visible` | non | non |

### Apparence

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `background-color` | `<color>` | `transparent` | non | oui |
| `background` | `<color>` \| `linear-gradient(<angle>?, <color> <percent>?, …)`, arrêts ≤ 8 | `transparent` | non | non |
| `border` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | non | non |
| `border-top` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | non | non |
| `border-right` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | non | non |
| `border-bottom` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | non | non |
| `border-left` | `<px>` (`solid` \| `none`)? `<color>`? | `0 none` | non | non |
| `border-width` | 1–4 × (`<px>`) | `0` | non | non |
| `border-style` | `solid` \| `none` | `none` | non | non |
| `border-color` | `<color>` | `currentColor` | non | oui |
| `border-radius` | 1–4 × (`<px>` \| `<percent>`) | `0` | non | non |
| `box-shadow` | `none` \| `var(--shadow-…)` seul \| liste ≤ 2 de `inset`? `<px> <px> <px>? <px>? <color>` | `none` | non | non |
| `opacity` | nombre de 0 à 1 | `1` | non | oui |
| `visibility` | `visible` \| `hidden` | `visible` | oui | non |
| `object-fit` | `contain` \| `cover` \| `fill` \| `none` | `contain` | non | non |

### Texte

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `color` | `<color>` | `var(--color-text)` | oui | oui |
| `font-family` | `ui` \| `mono` \| `display`, ou un token de police | `ui` | oui | non |
| `font-size` | `<px>` de 6 px à 96 px, ou un token de taille | `var(--font-size-body)` | oui | non |
| `font-weight` | `400` \| `500` \| `600` \| `700` \| `normal` \| `bold` | `400` | oui | non |
| `font-style` | `normal` \| `italic` | `normal` | oui | non |
| `font-variant-numeric` | `normal` \| `tabular-nums` | `normal` | oui | non |
| `line-height` | nombre de 0.5 à 4 (× taille de police) \| `<px>` | `1.3` | oui | non |
| `letter-spacing` | `<px>`, valeurs négatives admises | `0` | oui | non |
| `text-align` | `start` \| `center` \| `end` | `start` | oui | non |
| `text-decoration` | `none` \| `underline` \| `line-through` | `none` | non | non |
| `text-transform` | `none` \| `uppercase` \| `lowercase` \| `capitalize` | `none` | oui | non |
| `white-space` | `normal` \| `nowrap` \| `pre-wrap` | `normal` | oui | non |
| `vertical-align` | `baseline` \| `middle` | `baseline` | non | non |
| `text-overflow` | `clip` \| `ellipsis` \| `marquee` | `clip` | non | non |
| `line-clamp` | entier de 0 à 64 | `0` | non | non |
| `overflow-wrap` | `normal` \| `anywhere` | `normal` | oui | non |

### Mouvement

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `transform` | `none` \| jusqu’à 4 fonctions parmi `translate(<length>, <length>)` avec `<px>` ou `<percent>`, `translateX()`, `translateY()`, `scale(<number>{1,2})` de 0 à 8, `rotate(<angle>)` | `none` | non | oui |
| `transform-origin` | 1–2 × (`left` \| `center` \| `right` \| `top` \| `bottom` \| `<percent>` \| `<px>`) | `center` | non | non |
| `transition` | `none` \| liste ≤ 8 de `<animatable-property> <time> <easing>? <time>?` | `none` | non | non |
| `animation` | `none` \| liste ≤ 8 de `<keyframes-name> <time> <easing>? <time>? (<integer> \| infinite)? <direction>? <fill-mode>?`, entier de 1 à 10000 | `none` | non | non |

### Interaction

| Propriété | Valeur | Valeur initiale | Héritée | Animable |
| --- | --- | --- | --- | --- |
| `cursor` | `default` \| `pointer` \| `text` \| `not-allowed` \| `grab` \| `grabbing` | `default` | oui | non |
| `pointer-events` | `auto` \| `none` | `auto` | non | non |
<!-- /generated:style-properties -->

## Valeurs

<!-- generated:style-values -->
| Syntaxe | Signification |
| --- | --- |
| `<px>` | `12px` ; `0` peut se passer d’unité. Nombres décimaux, sans exposant. |
| `<percent>` | `50%` du bloc conteneur, comme en CSS ; au plus 1000 dans un sens ou dans l’autre. |
| `<fr>` | `1fr`, pour les pistes de grille seulement ; de 0 à 1000. |
| `<time>` | `120ms` ou `0.12s`, de 0 à 300000 ms. |
| `<angle>` | `4deg` ou `0.5turn`, au plus 3600 degrés dans un sens ou dans l’autre. |
| `<color>` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b)`, `rgb(r g b / a)`, `transparent`, `currentColor`, ou un token de couleur. Pas de couleurs nommées. |
| `var(--token)` | Token du design system, du type attendu, comme valeur entière ou comme composante d’une valeur composite. Pas d’argument de repli ; un widget ne peut pas déclarer de propriétés personnalisées. |
| `<easing>` | `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(<integer 1..=MAX_EASING_STEPS>)`. |
| `<direction>` | `normal`, `reverse`, `alternate`. |
| `<fill-mode>` | `none`, `forwards`, `backwards`, `both`. |
<!-- /generated:style-values -->

## Tokens du design system

Un token s’écrit `var(--name)` là où une valeur de son type est attendue.
Les tokens de couleur et d’ombre ont une valeur par thème ; les autres sont
identiques dans les deux thèmes.

<!-- source: templates/list/style.ocss -->
```css
.summary {
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
}
```

<!-- generated:tokens -->
### Couleurs

| Token | Sombre | Clair | Signification |
| --- | --- | --- | --- |
| `--color-accent` | `#a3e635` | `#4d7c0f` | Accent de la marque : actions principales, état coché. |
| `--color-accent-hover` | `#b5f153` | `#3f6212` | Accent sous le pointeur. |
| `--color-accent-soft` | `#a3e6351c` | `#4d7c0f1f` | Voile d’accent derrière un contenu sélectionné. |
| `--color-on-accent` | `#09090b` | `#ffffff` | Texte et icônes dessinés sur l’accent et sur son état de survol. |
| `--color-user-accent` | `#a3e635` | `#4d7c0f` | La couleur d’accent de l’utilisateur, un remplissage qui porte un texte ou une marque ; jamais une couleur de texte ni une bordure sur une surface. Demande `"accent": "user-roles"` ou `"user"` dans le manifeste ; lime par défaut, l’accent de la marque. |
| `--color-on-user-accent` | `#09090b` | `#ffffff` | Texte et icônes posés sur `--color-user-accent` et sur son état de survol. Demande `"accent": "user-roles"` ou `"user"` dans le manifeste. |
| `--color-user-accent-hover` | `#b5f153` | `#3f6212` | `--color-user-accent` sous le pointeur. Demande `"accent": "user-roles"` dans le manifeste. |
| `--color-user-accent-soft` | `#a3e6351c` | `#4d7c0f1f` | Voile de l’accent de l’utilisateur derrière un contenu sélectionné. Demande `"accent": "user-roles"` dans le manifeste. |
| `--color-user-accent-text` | `#a3e635` | `#4d7c0f` | Texte et icônes à l’accent de l’utilisateur sur une surface, lisibles dans chaque couleur d’accent. Demande `"accent": "user-roles"` dans le manifeste. |
| `--color-user-accent-text-hover` | `#b5f153` | `#3f6212` | `--color-user-accent-text` sous le pointeur ou pressé. Demande `"accent": "user-roles"` dans le manifeste. |
| `--color-user-accent-outline` | `#a3e635` | `#4d7c0f` | Bordures, rails, anneaux et jauges à l’accent de l’utilisateur sur une surface, visibles dans chaque couleur d’accent. Demande `"accent": "user-roles"` dans le manifeste. |
| `--color-surface-panel` | `#111114ee` | `#fafafaee` | Fond du panneau du widget, dessiné par l’hôte derrière le contenu. |
| `--color-surface-raised` | `#1e1e22e0` | `#f4f4f5eb` | Surface en relief dans le panneau. |
| `--color-surface-hover` | `#28282deb` | `#e4e4e7f0` | Surface sous le pointeur. |
| `--color-surface-field` | `#0f0f12` | `#ffffff` | Fond d’un champ de texte. |
| `--color-surface-popover` | `#18181c` | `#ffffff` | Fond d’un popover et d’une liste déroulante. |
| `--color-border` | `#ffffff18` | `#0000001a` | Bordure par défaut. |
| `--color-border-strong` | `#ffffff2a` | `#0000002e` | Bordure et séparateur accentués. |
| `--color-text` | `#f7f7f8` | `#18181b` | Texte principal. |
| `--color-text-secondary` | `#d4d4d8` | `#3f3f46` | Texte secondaire. |
| `--color-text-muted` | `#a1a1aa` | `#52525b` | Légendes et métadonnées. |
| `--color-text-subtle` | `#71717a` | `#71717a` | Indications des champs vides et texte désactivé. |
| `--color-danger` | `#fb7185` | `#e11d48` | Erreurs et actions destructrices. |
| `--color-danger-soft` | `#fb71851a` | `#e11d481a` | Voile de danger derrière les confirmations destructrices et les erreurs. |
| `--color-warning` | `#fbbf24` | `#b45309` | Avertissements. |
| `--color-success` | `#86efac` | `#15803d` | Réussite et états sains. |

### Longueurs

| Token | Valeur | Signification |
| --- | --- | --- |
| `--space-1` | `2px` | Espacement, palier 1. |
| `--space-2` | `4px` | Espacement, palier 2. |
| `--space-3` | `6px` | Espacement, palier 3 (espacement par défaut entre les éléments). |
| `--space-4` | `8px` | Espacement, palier 4. |
| `--space-5` | `12px` | Espacement, palier 5. |
| `--space-6` | `16px` | Espacement, palier 6. |
| `--radius-sm` | `6px` | Petits contrôles et images. |
| `--radius-md` | `9px` | Boutons. |
| `--radius-lg` | `10px` | Cartes. |
| `--radius-pill` | `999px` | Pastilles et boutons ronds. |
| `--control-height` | `28px` | Hauteur standard d’un contrôle. |
| `--icon-button-size` | `22px` | Bouton-icône compact. |

### Tailles de police

| Token | Valeur | Signification |
| --- | --- | --- |
| `--font-size-caption` | `10px` | Surtitres et légendes. |
| `--font-size-small` | `11px` | Métadonnées. |
| `--font-size-button` | `13px` | Libellés des boutons. |
| `--font-size-body` | `14px` | Texte courant. |
| `--font-size-title` | `18px` | Titres de section. |
| `--font-size-value` | `22px` | Valeurs mises en avant (horloge, FPS). |

### Familles de police

| Token | Valeur | Signification |
| --- | --- | --- |
| `--font-ui` | `ui` | Noto Sans UI, la police de l’interface. |
| `--font-mono` | `mono` | Noto Sans Mono, pour les valeurs. |
| `--font-display` | `display` | Space Grotesk, pour les grades et les scores. |

### Durées

| Token | Valeur | Signification |
| --- | --- | --- |
| `--duration-fast` | `120ms` | Transitions d’état. |
| `--duration-medium` | `240ms` | Panneaux et popovers. |

### Ombres

| Token | Sombre | Clair | Signification |
| --- | --- | --- | --- |
| `--shadow-panel` | `0px 4px 16px 0px #00000066` | `0px 4px 16px 0px #0000001f` | Ombre du panneau du widget et des surfaces flottantes de l’hôte. |
<!-- /generated:tokens -->

### Accent de l’utilisateur

Pour un widget dont le manifeste déclare `"accent": "user-roles"`, les
tokens `--color-user-accent…` prennent les couleurs de l’accent choisi par
l’utilisateur ; lime sinon.
[Accent de l’utilisateur](style.md#accent-de-lutilisateur) dit quel token
utiliser à quel endroit.

Chaque rôle tient son contraste sur chaque token de surface : le texte sur
le remplissage et sur son état de survol à 4,5:1 ; le texte et son état de
survol à 4,5:1 ; le contour à 3:1. Là où une couleur ne l’atteindrait pas,
le texte et le contour prennent `--color-text`. Lime est l’accent de la
marque, dont le thème clair n’est pas définitif : son texte n’atteint pas
4,5:1 sur `--color-surface-hover`.

Thème sombre :

<!-- generated:user-accent-roles-dark -->
| Couleur | Remplissage | Texte sur le remplissage | Survol | Voile | Texte | Texte survolé | Contour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lime` | `#a3e635` | `#09090b` | `#b5f153` | `#a3e6351c` | `#a3e635` | `#b5f153` | `#a3e635` |
| `amber` | `#fbbf24` | `#18181b` | `#fccc50` | `#fbbf241c` | `#fbbf24` | `#fccc50` | `#fbbf24` |
| `red` | `#991b1b` | `#ffffff` | `#ad4949` | `#991b1b1c` | `#f7f7f8` | `#f9f9f9` | `#f7f7f8` |
| `pink` | `#fb7185` | `#18181b` | `#fc8d9d` | `#fb71851c` | `#fb7185` | `#fc8d9d` | `#fb7185` |
| `purple` | `#a78bfa` | `#18181b` | `#b9a2fb` | `#a78bfa1c` | `#a78bfa` | `#b9a2fb` | `#a78bfa` |
| `blue` | `#60a5fa` | `#18181b` | `#80b7fb` | `#60a5fa1c` | `#60a5fa` | `#80b7fb` | `#60a5fa` |
| `cyan` | `#22d3ee` | `#18181b` | `#4edcf1` | `#22d3ee1c` | `#22d3ee` | `#4edcf1` | `#22d3ee` |
| `emerald` | `#34d399` | `#18181b` | `#5ddcad` | `#34d3991c` | `#34d399` | `#5ddcad` | `#34d399` |
| `steel` | `#a1a1aa` | `#18181b` | `#b4b4bb` | `#a1a1aa1c` | `#a1a1aa` | `#b4b4bb` | `#a1a1aa` |
<!-- /generated:user-accent-roles-dark -->

Thème clair :

<!-- generated:user-accent-roles-light -->
| Couleur | Remplissage | Texte sur le remplissage | Survol | Voile | Texte | Texte survolé | Contour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lime` | `#4d7c0f` | `#ffffff` | `#3f6212` | `#4d7c0f1f` | `#4d7c0f` | `#3f6212` | `#4d7c0f` |
| `amber` | `#f59e0b` | `#18181b` | `#f7ad30` | `#f59e0b1f` | `#18181b` | `#141417` | `#18181b` |
| `red` | `#991b1b` | `#ffffff` | `#821717` | `#991b1b1f` | `#991b1b` | `#821717` | `#991b1b` |
| `pink` | `#f43f5e` | `#18181b` | `#f65c76` | `#f43f5e1f` | `#18181b` | `#141417` | `#18181b` |
| `purple` | `#a78bfa` | `#18181b` | `#b49cfb` | `#a78bfa1f` | `#18181b` | `#141417` | `#18181b` |
| `blue` | `#3b82f6` | `#18181b` | `#5895f7` | `#3b82f61f` | `#18181b` | `#141417` | `#18181b` |
| `cyan` | `#06b6d4` | `#18181b` | `#2bc1da` | `#06b6d41f` | `#18181b` | `#141417` | `#18181b` |
| `emerald` | `#10b981` | `#18181b` | `#34c494` | `#10b9811f` | `#18181b` | `#141417` | `#18181b` |
| `steel` | `#a1a1aa` | `#18181b` | `#afafb7` | `#a1a1aa1f` | `#18181b` | `#141417` | `#18181b` |
<!-- /generated:user-accent-roles-light -->

Avec la forme réduite, `"accent": "user"`, `--color-user-accent` et
`--color-on-user-accent` prennent ces valeurs à la place, qui ne diffèrent
qu’en lime :

<!-- generated:user-accents -->
| Couleur | Remplissage, sombre | Texte, sombre | Remplissage, clair | Texte, clair |
| --- | --- | --- | --- | --- |
| `lime` | `#a3e635` | `#18181b` | `#84cc16` | `#18181b` |
| `amber` | `#fbbf24` | `#18181b` | `#f59e0b` | `#18181b` |
| `red` | `#991b1b` | `#ffffff` | `#991b1b` | `#ffffff` |
| `pink` | `#fb7185` | `#18181b` | `#f43f5e` | `#18181b` |
| `purple` | `#a78bfa` | `#18181b` | `#a78bfa` | `#18181b` |
| `blue` | `#60a5fa` | `#18181b` | `#3b82f6` | `#18181b` |
| `cyan` | `#22d3ee` | `#18181b` | `#06b6d4` | `#18181b` |
| `emerald` | `#34d399` | `#18181b` | `#10b981` | `#18181b` |
| `steel` | `#a1a1aa` | `#18181b` | `#a1a1aa` | `#18181b` |
<!-- /generated:user-accents -->

## Icônes

L’élément `icon` et les lignes du menu d’options prennent le nom d’une icône
Lucide, dans sa graphie habituelle : `circle-check`, `rotate-ccw`,
`chevron-down`.

<!-- source: templates/list/view.ocml -->
```xml
          <icon name="x"/>
```

<!-- generated:icons -->
Lucide 1.34.0, 1777 icônes.
<!-- /generated:icons -->

Tout autre nom est refusé. Le type `IconName` du SDK les liste tous : un nom
erroné dans la logique est donc une erreur TypeScript. Au sein de l’API v1,
le jeu d’icônes peut grandir, mais il ne perd ni ne renomme jamais une
icône. PlayerVox OverCrow dessine les icônes lui-même : un widget n’embarque
aucune police d’icônes.
