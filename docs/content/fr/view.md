# La vue

`view.ocml` décrit ce qu’affiche un widget PlayerVox OverCrow : un arbre
d’éléments, lié à l’état du widget par des expressions `{…}`. Il ressemble à
du HTML ou à du JSX, mais ce n’est ni l’un ni l’autre : le jeu d’éléments
est fermé, il n’y a pas de DOM et la vue ne contient aucun script. OverCrow
met en page et dessine l’arbre lui-même.

<!-- source: templates/list/view.ocml -->
```xml
<box class="checklist">
  <text class="title">{t("title")}</text>
  <list class="items" item-height="32">
    <for each={state.items} as="item" key={item.id}>
      <box class="row">
        <checkbox label={item.text} checked={item.done} on:change={setDone(item.id, event.value)}/>
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
        <button class="remove" label={t("remove")} on:activate={remove(item.id)}>
          <icon name="x"/>
        </button>
      </box>
    </for>
  </list>
  <text class="summary">{t("remaining", { count: remaining(state.items) })}</text>
</box>
```

C’est le template de liste de tâches : un titre, une `list` défilante qui
répète une ligne par entrée, et un résumé. La logique exporte `setDone`,
`remove` et `remaining` ; `t` lit les messages de `locales/`.

La vue est compilée quand vous empaquetez le widget : `overcrow-widget check`
signale chaque erreur avec sa ligne et sa colonne. Un élément, un attribut ou
un événement inconnu est une erreur, jamais ignorée. Le fichier source
lui-même n’est pas livré.

## Balisage

- Le fichier est en UTF-8, sans marque d’ordre des octets.
- Le document est une liste de nœuds de premier niveau : des déclarations
  `<component>` et les enfants de la racine du widget, qui est une `box`.
- Les éléments s’écrivent en minuscules : `<name …>…</name>` ou
  `<name …/>`.
- La valeur d’un attribut est un texte entre guillemets (`"…"` ou `'…'`),
  une expression (`{…}`), ou rien, ce qui vaut `true` : `<button submit>`.
  Les attributs sont séparés par des blancs et ne se répètent jamais.
- Les commentaires s’écrivent `<!-- … -->`, sans `--` à l’intérieur.
- DOCTYPE, instructions de traitement, sections CDATA et espaces de noms
  sont refusés.

Les entités sont `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&lbrace;`
`&rbrace;` `&nbsp;`, ainsi que `&#…;` ou `&#x…;` pour tout caractère qui
n’est pas un caractère de contrôle. Un `{` ou un `}` littéral dans une
valeur entre guillemets, comme un `}` isolé dans du texte, est refusé :
écrivez `&lbrace;` et `&rbrace;`.

## Éléments

Chaque élément a un contenu fixe, un jeu d’attributs et les événements qu’il
peut envoyer. Les conteneurs (`box`, `scroll`, `list`, `form`, `popover`,
`button`) contiennent d’autres éléments ; `text` contient du texte et des
enfants en ligne ; les autres sont des feuilles qu’OverCrow dessine :
`icon`, `image`, `toggle`, `slider`, `field`, `chart`, `gauge`…

<!-- generated:element-list -->
| Élément | Signification |
| --- | --- |
| [`box`](elements.md#box) | Conteneur générique ; la mise en page flex ou grid vient du style. La racine de la vue est un `box`. |
| [`scroll`](elements.md#scroll) | Conteneur qui rogne son contenu et que l’hôte fait défiler à la molette, par glissement et au clavier. |
| [`list`](elements.md#list) | Liste à défilement vertical dont les enfants ne sont mis en page et peints que lorsqu’ils sont visibles. |
| [`text`](elements.md#text) | Bloc de texte avec retour à la ligne ; ses enfants en ligne suivent le texte (une ligne de chat avec des emotes). |
| [`span`](elements.md#span) | Portion de texte stylée à l’intérieur d’un `text`. |
| [`icon`](elements.md#icon) | Icône Lucide teintée par `color`, dimensionnée par `font-size` sauf si `width` et `height` sont définis. |
| [`image`](elements.md#image) | Image matricielle du paquet, ou image remise par un service (identifiant `asset:`) ; `object-fit` s’applique. |
| [`avatar`](elements.md#avatar) | Image ronde, avec un texte de remplacement tant que l’image manque ou n’a pas pu être chargée. |
| [`badge`](elements.md#badge) | Courte pastille de texte. |
| [`button`](elements.md#button) | Contrôle activable ; ses enfants (icône, texte) forment son contenu. |
| [`toggle`](elements.md#toggle) | Bascule activé/désactivé. |
| [`checkbox`](elements.md#checkbox) | Case à cocher (listes de tâches). |
| [`slider`](elements.md#slider) | Curseur sur un intervalle numérique ; le glissement est géré par l’hôte. |
| [`select`](elements.md#select) | Liste déroulante ; la liste ouverte est dessinée par l’hôte. |
| [`option`](elements.md#option) | Choix d’un `select` ; son texte est le libellé affiché. |
| [`field`](elements.md#field) | Champ de texte d’une ligne, édité par l’hôte, méthodes de saisie (IME) comprises. |
| [`textarea`](elements.md#textarea) | Champ de texte de plusieurs lignes, édité par l’hôte, méthodes de saisie (IME) comprises. |
| [`form`](elements.md#form) | Regroupe des contrôles nommés. Avec `intent`, la validation envoie leurs valeurs à un service d’écriture directement depuis l’hôte ; la logique du widget ne fournit jamais ce contenu. |
| [`elapsed`](elements.md#elapsed) | Durée affichée que l’hôte fait avancer à partir d’un repère donné par un service : un chronomètre qui tourne ne demande aucun travail à la logique. Stylé comme `text` ; repeint seulement quand le texte affiché change, au plus à `ANIMATION_RATE_HZ`, et jamais quand le widget est masqué. |
| [`progress`](elements.md#progress) | Barre de progression horizontale. |
| [`gauge`](elements.md#gauge) | Jauge en anneau ou en arc. |
| [`chart`](elements.md#chart) | Graphique en ligne, en aire, en barres ou sparkline, dessiné par l’hôte. |
| [`series`](elements.md#series) | Une série de données d’un `chart`, colorée par `color`. |
| [`separator`](elements.md#separator) | Filet de séparation entre deux groupes. |
| [`canvas`](elements.md#canvas) | Surface que l’hôte peint à partir de la dernière liste de commandes passée à `draw`. |
| [`popover`](elements.md#popover) | Panneau flottant ancré à un élément, dessiné au-dessus du contenu et rogné au cadre du widget (listes déroulantes, menus contextuels). |
<!-- /generated:element-list -->

[Éléments et attributs](elements.md) donne les attributs et les événements
de chacun.

## Texte

Le texte n’est admis que dans `text`, `span`, `badge` et `option`. Un `text`
contient soit du texte, soit des enfants en ligne (`span`, `icon`, `image`),
jamais les deux : pour styler un seul mot, placez chaque segment dans un
`span`.

<!-- source: widgets/performance/view.ocml -->
```xml
      <text class={row.valueClass} label={row.name} tooltip={row.hint}><span>{row.value}</span><if test={row.unit != ""}><span class="unit">{row.unit}</span></if></text>
```

Les blancs suivent la règle de JSX :

- les tabulations deviennent des espaces ;
- un saut de ligne entre deux mots devient une espace ;
- un saut de ligne accolé à une balise ou à une expression disparaît avec
  son indentation ;
- une suite de blancs accolée à une balise est supprimée ; entre deux
  expressions sur la même ligne, elle est conservée.

Un saut de ligne avant une expression supprime donc l’espace qui la
précède : écrivez `you have {state.count} messages` sur une seule ligne pour
garder les deux espaces, ou écrivez `&#32;` là où il vous faut une espace
que la règle supprimerait.

## Attributs

Une valeur entre guillemets est convertie dans le type de l’attribut et
vérifiée à la compilation de la vue :

| Type | Valeur entre guillemets |
| --- | --- |
| booléen | `true` ou `false` ; l’attribut seul vaut `true` |
| entier | un entier décimal, sans zéro initial |
| nombre | un nombre décimal, sans exposant |
| liste de nombres | des nombres séparés par des espaces : `values="12 18.5 30"` |
| texte, identifiant | le texte lui-même |
| image | un fichier du paquet : `src="assets/logo.png"` |

`attr={expression}`, en revanche, lie l’attribut à une expression ; OverCrow
vérifie chaque valeur qu’envoie le widget. Les valeurs qui n’existent qu’à
l’exécution du widget, comme une image fournie par un service, doivent être
liées.

Cinq attributs existent sur tous les éléments :

<!-- generated:common-attributes -->
| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `class` | liste de classes | non | Classes de style : des noms distincts, séparés par une espace. |
| `ref` | nom de `ref` statique | non | Nom par lequel `draw` désigne ce `canvas` et par lequel un attribut tel que `anchor` d’un `popover` désigne cet élément. Statique, unique dans la vue, et interdit dans un `for` ou dans le corps d’un composant, où il nommerait plusieurs éléments. |
| `label` | texte ≤ `MAX_LABEL_BYTES` | non | Nom accessible ; obligatoire sur les contrôles qui ne montrent qu’une icône. |
| `tooltip` | texte ≤ `MAX_LABEL_BYTES` | non | Texte brut que l’hôte affiche au survol ou au focus. |
| `on` | noms d’événements triés | non | Événements transmis à la logique ; s’écrit `on:<event>` dans la vue. |
<!-- /generated:common-attributes -->

`class` est le point d’accroche du [style](style.md). `label` est le nom
accessible de l’élément : donnez-en un à chaque contrôle dont le contenu est
une icône.

### Nommer un élément : `ref`

`ref="name"` donne un nom à un élément. Ce nom sert à deux choses :
`draw(name, commands)` dessine dans le `canvas` de ce nom, et un `popover`
se place contre l’élément que nomme son `anchor`.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<box ref="panel" class="countdown" on:contextmenu={openMenu}>
```

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<popover anchor="panel" placement="pointer" open={state.menu} on:dismiss={closeMenu}>
  <button class="menu-row" on:activate={resetRounds}>
    <text class="menu-text">{t("reset-rounds")}</text>
  </button>
</popover>
```

Un `ref` s’écrit toujours entre guillemets et il est unique dans la vue. Il
est refusé dans un `for` ou dans un composant, où il nommerait plusieurs
éléments.

## Événements

`on:event={handler}` demande à OverCrow d’envoyer à la logique un événement
de l’élément. Sans cela, le widget ignore tout de l’événement : OverCrow ne
lui signale ni les mouvements du pointeur ni les appuis de touches qu’il n’a
pas demandés.

Un gestionnaire s’écrit de deux façons :

- **le nom d’une fonction** exportée par la logique, appelée avec le détail
  de l’événement : `on:activate={increment}` ;
- **un appel**, avec les arguments de votre choix ; `event` y désigne le
  détail de l’événement : `on:change={setDone(item.id, event.value)}`.

<!-- source: templates/list/view.ocml -->
```xml
        <checkbox label={item.text} checked={item.done} on:change={setDone(item.id, event.value)}/>
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
        <button class="remove" label={t("remove")} on:activate={remove(item.id)}>
          <icon name="x"/>
        </button>
```

Les événements sont `activate`, `contextmenu`, `wheel`, `keydown`, `input`,
`change`, `submit`, `focus`, `blur`, `reachend`, `stick` et `dismiss` ;
[événements](elements.md#événements) décrit chacun d’eux et le détail qu’il
transporte, et chaque [élément](elements.md#éléments) liste ceux qu’il
envoie. Certains sont des actions de l’utilisateur, pendant lesquelles un
widget peut appeler un service protégé ; voir
[les appels qui demandent une action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).
Les widgets ne reçoivent d’entrées qu’en mode interactif d’OverCrow : en
mode passif, les clics les traversent et atteignent le jeu.

## Conditions, boucles et composants

<!-- generated:constructs -->
| Syntaxe | Signification |
| --- | --- |
| `{expr}` | Insère la valeur d’une expression dans du texte ou dans la valeur d’un attribut. |
| `<if test={expr}> … <else-if test={expr}> … <else>` | Sous-arbre conditionnel. |
| `<for each={expr} as="item" key={expr}>` | Répète un sous-arbre ; `key` est obligatoire et doit être unique parmi les éléments répétés. |
| `<component name="x" props="a b"> … <slot/> … </component>` | Composant local, avec ses propriétés déclarées et un emplacement (`slot`), utilisé sous la forme `<x a={…}>`. |
| `on:<event>={handler}` | Abonne l’élément à l’un de ses événements et nomme le gestionnaire de la logique. |
<!-- /generated:constructs -->

### `if`, `else-if`, `else`

<!-- source: widgets/stopwatch/view.ocml -->
```xml
        <if test={state.stopwatch.running}>
          <icon name="pause"/>
        </if>
        <else>
          <icon name="play"/>
        </else>
```

`else-if` et `else` suivent directement un `if` : seuls des blancs et des
commentaires peuvent les en séparer.

### `for`

`for` répète ses enfants pour chaque entrée d’une liste. `each`, `as` et
`key` sont tous obligatoires, et la clé doit être unique parmi les entrées
répétées : c’est grâce à elle qu’OverCrow sait quelle ligne a bougé, est
apparue ou a disparu.

<!-- source: widgets/warframe-market/view.ocml -->
```xml
      <for each={state.results} as="item" key={item.slug}>
        <button class="result" label={item.name} on:activate={select(item.slug)}>
          <text class="result-name">{item.name}</text>
          <icon class="result-arrow" name="chevron-right"/>
        </button>
      </for>
```

Pour une longue liste, placez le `for` dans un élément `list` : OverCrow ne
met en page et ne dessine que les lignes visibles.

### Composants

Un composant est un morceau de vue doté d’un nom et de propriétés déclarées,
à écrire une fois et à utiliser plusieurs fois. Il est local à la vue.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
<component name="stat" props="name value">
  <box class="stat">
    <text class="stat-name">{name}</text>
    <text class="stat-value">{value}</text>
  </box>
</component>
```

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
  <stat name={t("state")} value={stateText(state.running, state.remainingMs)}/>
```

- Les composants se déclarent au premier niveau, une seule fois chacun,
  sous un nom qui n’est pas celui d’un élément.
- Le corps ne voit que ses propres propriétés, pas les noms visibles là où
  le composant est utilisé. Passez-lui ce dont il a besoin.
- Une utilisation ne passe que des propriétés déclarées. Une propriété entre
  guillemets est un texte ; liez-la (`value={5}`) pour tout autre type.
- Un corps peut contenir un seul `<slot/>`, où vont les enfants de chaque
  utilisation.
- Un composant ne peut pas se contenir lui-même, et une utilisation
  n’accepte pas de gestionnaires `on:` : placez-les sur des éléments du
  corps.

`if`, `for` et les composants sont transparents pour les règles de contenu :
leurs enfants doivent convenir à l’élément qui les entoure.

## Expressions

Les expressions forment un sous-ensemble de JavaScript, réduit et strict :

- les littéraux : nombres (`0`, `12`, `1.5`), chaînes, `true`, `false`,
  `null`, littéraux de tableau et d’objet ;
- les noms de la portée et leurs membres : `a.b`, `a?.b`, `a[i]`,
  `a?.[i]` ;
- les opérateurs : `!`, `-` et `+` unaires, `* / %`, `+ -`, `< <= > >=`,
  `== != === !==`, `&&`, `||`, `??`, et `a ? b : c`. `??` ne se combine pas
  avec `&&` ou `||` sans parenthèses ;
- les appels de fonctions exportées par la logique, par leur nom seul :
  `remaining(state.items)`. `t(key, params)` en fait partie.

Les noms de la portée sont `state`, les noms `as` des `for` englobants, les
propriétés du composant englobant, et `event` dans un gestionnaire. Un nom
ne peut pas en masquer un autre.

Il n’y a ni affectation, ni fonction fléchée ou littérale, ni `new`, ni
`this`, ni littéral de gabarit, ni expression régulière, ni appel de
méthode, ni globale : tout ce qui dépasse un calcul simple a sa place dans
une fonction de la logique. C’est ce qui permet de vérifier la vue : à
l’empaquetage du widget, chaque expression est compilée en une fonction de
`logic.js`, et la vue elle-même ne contient aucun code.

<!-- source: templates/list/view.ocml -->
```xml
        <text class={item.done ? "text done" : "text"}>{item.text}</text>
```

Les mots réservés de JavaScript, `constructor`, `prototype`, `eval`,
`undefined`, `globalThis`, `overcrow` et tout nom qui commence par `__` sont
refusés.

## Quand la vue est incorrecte

Chaque problème est un diagnostic de `overcrow-widget check`, doté d’un code
stable :

| Code | Problème |
| --- | --- |
| `view.syntax`, `view.encoding`, `view.size`, `view.invalid_entity` | Le fichier n’est pas un balisage bien formé. |
| `view.unknown_element`, `view.invalid_parent` | Un élément qui n’existe pas, ou placé là où il ne peut pas être. |
| `view.unknown_attribute`, `view.duplicate_attribute`, `view.invalid_attribute`, `view.missing_attribute` | Un attribut que l’élément n’a pas, écrit deux fois, de valeur incorrecte, ou obligatoire et absent. |
| `view.unknown_event`, `view.invalid_handler` | Un événement que l’élément n’envoie pas (ou posé sur l’utilisation d’un composant), ou un gestionnaire qui n’est ni un nom ni un appel. |
| `view.expression_syntax`, `view.expression_too_long`, `view.expression_too_deep`, `view.expression_too_many_entries` | Une expression hors du sous-ensemble ou de ses limites. |
| `view.reserved_name`, `view.unknown_name` | Un nom refusé, ou absent de la portée. |
| `view.invalid_text` | Du texte là où l’élément n’en accepte pas, ou mêlé à des enfants en ligne. |
| `view.invalid_component`, `view.recursive_component`, `view.invalid_slot`, `view.invalid_construct` | Un composant, un slot, un `if` ou un `for` qui enfreint ses règles. |
| `view.invalid_ref`, `view.unknown_ref` | Un `ref` qui n’est pas unique ou qui se trouve dans un `for`, ou un `anchor` qui n’en nomme aucun. |
| `view.missing_asset` | Une image statique absente de `assets/`. |
| `view.bound_value` | Un `value` sur un contrôle d’un formulaire lié à un intent d’écriture ; voir [les formulaires](forms.md#les-formulaires-qui-écrivent-des-données-de-lutilisateur). |
| `view.too_many_elements`, `view.too_many_components`, `view.too_many_children`, `view.too_many_expressions`, `view.too_deep` | Une [limite](limits.md) de la vue est dépassée. |
| `logic.missing_export` | La vue appelle une fonction que la logique n’exporte pas. |
