# Éléments et attributs

La vue d’un widget PlayerVox OverCrow se compose d’un jeu fermé d’éléments.
Cette page liste chacun d’eux avec son contenu, ses attributs et les
événements qu’il peut envoyer. [La vue](view.md) explique le balisage qui
les entoure : expressions, `if`, `for`, composants.

<!-- source: templates/chart/view.ocml -->
```xml
<box class="panel">
  <box class="header">
    <text class="title">{t("title")}</text>
    <text class="value">{latest(state.values)}</text>
  </box>
  <chart class="plot" kind="area" min="0" max="100">
    <series class="series" values={state.values}/>
  </chart>
</box>
```

Deux conteneurs `box`, deux éléments `text` liés à l’état et un `chart` doté
d’une `series` : OverCrow dessine le tout, graphique compris.

## Lire la fiche d’un élément

- **Contenu** : ce que l’élément peut contenir. Les *éléments de bloc* sont
  tous les éléments qui peuvent figurer seuls dans un conteneur (tous sauf
  `span`, `option` et `series`) ; *en ligne* désigne le contenu d’un
  `text` ; *texte*, du texte brut ; *vide* signifie que l’élément s’écrit
  `<name …/>`.
- **Parents** : où l’élément peut se trouver ; *tout conteneur* désigne
  n’importe quel conteneur.
- **Focus clavier** : *toujours* pour les contrôles ; *quand un événement
  est écouté* pour un élément qui ne prend le focus que si la vue écoute
  l’un de ses événements (`on:activate`…) ; *jamais* sinon.
- **Rôle** : la nature de l’élément, telle qu’elle est annoncée aux
  technologies d’assistance.
- **Événements** : les événements que la vue peut écouter avec
  `on:<event>`.

Un type tel que « texte ≤ 256 octets » donne une
[limite](limits.md).

## Attributs communs à tous les éléments

<!-- generated:common-attributes -->
| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `class` | liste de classes | non | Classes de style : des noms distincts, séparés par une espace. |
| `ref` | nom de `ref` statique | non | Nom par lequel `draw` désigne ce `canvas` et par lequel un attribut tel que `anchor` d’un `popover` désigne cet élément. Statique, unique dans la vue, et interdit dans un `for` ou dans le corps d’un composant, où il nommerait plusieurs éléments. |
| `label` | texte ≤ 256 octets | non | Nom accessible ; obligatoire sur les contrôles qui ne montrent qu’une icône. |
| `tooltip` | texte ≤ 256 octets | non | Texte brut que l’hôte affiche au survol ou au focus. |
| `on` | noms d’événements triés | non | Événements transmis à la logique ; s’écrit `on:<event>` dans la vue. |
<!-- /generated:common-attributes -->

## Éléments

<!-- generated:elements -->
### `box`

Conteneur générique ; la mise en page flex ou grid vient du style. La racine de la vue est un `box`.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | quand un événement est écouté | `group` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

Aucun attribut propre.

### `scroll`

Conteneur qui rogne son contenu et que l’hôte fait défiler à la molette, par glissement et au clavier.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | jamais | `scroll-view` | `reachend`, `stick`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `axis` | `vertical` \| `horizontal` | non | Sens du défilement ; `vertical` par défaut. |
| `stick-to-end` | booléen | non | Reste à la fin tant que le contenu grandit, jusqu’à ce que l’utilisateur fasse défiler ailleurs (chat). Le remettre après l’avoir retiré fait défiler jusqu’à la fin. |

### `list`

Liste à défilement vertical dont les enfants ne sont mis en page et peints que lorsqu’ils sont visibles.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | jamais | `list` | `reachend`, `stick`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `stick-to-end` | booléen | non | Comme pour `scroll`. |
| `item-height` | entier de 1 à 4096 | non | Hauteur estimée d’un enfant, utilisée tant qu’il n’a pas été mesuré. |

### `text`

Bloc de texte avec retour à la ligne ; ses enfants en ligne suivent le texte (une ligne de chat avec des emotes).

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| en ligne : `span`, `icon`, `image` | tout conteneur | quand un événement est écouté | `label` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `selectable` | booléen | non | L’utilisateur peut sélectionner le texte et le copier par l’hôte ; aucune permission du widget n’intervient. |

### `span`

Portion de texte stylée à l’intérieur d’un `text`.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| texte | `text` | jamais | `label` | aucun |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `color` | `#rrggbb` opaque | non | Couleur issue des données, comme celle de l’auteur d’un message de chat ; elle remplace la couleur du style, et l’hôte en relève le contraste à 4,5:1 au moins par rapport au panneau. |

### `icon`

Icône Lucide teintée par `color`, dimensionnée par `font-size` sauf si `width` et `height` sont définis.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `name` | nom d’icône Lucide | oui | Nom de l’icône, par exemple `circle-check`. |

### `image`

Image matricielle du paquet, ou image remise par un service (identifiant `asset:`) ; `object-fit` s’applique.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `src` | source d’image | oui | Source de l’image. |

### `avatar`

Image ronde, avec un texte de remplacement tant que l’image manque ou n’a pas pu être chargée.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `src` | source d’image | non | Source de l’image. |
| `initials` | texte ≤ 16 octets | non | Texte de remplacement. |

### `badge`

Courte pastille de texte.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| texte | tout conteneur | quand un événement est écouté | `label` | `activate`, `contextmenu`, `wheel` |

Aucun attribut propre.

### `button`

Contrôle activable ; ses enfants (icône, texte) forment son contenu.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | toujours | `button` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `submit` | booléen | non | Valide le `form` qui le contient. |

### `toggle`

Bascule activé/désactivé.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | toujours | `switch` | `change`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `checked` | booléen | non | État ; correspond à `:checked`. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `checkbox`

Case à cocher (listes de tâches).

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | toujours | `check-box` | `change`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `checked` | booléen | non | État ; correspond à `:checked`. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `slider`

Curseur sur un intervalle numérique ; le glissement est géré par l’hôte.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | toujours | `slider` | `input`, `change`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `min` | nombre de -1000000000 à 1000000000 | oui | Borne inférieure. |
| `max` | nombre de -1000000000 à 1000000000 | oui | Borne supérieure, plus grande que `min`. |
| `step` | nombre de -1000000000 à 1000000000 | non | Pas, positif ; 1 par défaut. |
| `value` | nombre de -1000000000 à 1000000000 | non | Valeur courante, ramenée dans l’intervalle ; refusée sur un curseur lié à un intent d’écriture. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `select`

Liste déroulante ; la liste ouverte est dessinée par l’hôte.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| `option` | tout conteneur | toujours | `combo-box` | `change`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | texte ≤ 1 Kio | non | Valeur de l’option sélectionnée. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `option`

Choix d’un `select` ; son texte est le libellé affiché.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| texte | `select` | jamais | `list-box-option` | aucun |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | texte ≤ 1 Kio | oui | Valeur transmise par `change`. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |

### `field`

Champ de texte d’une ligne, édité par l’hôte, méthodes de saisie (IME) comprises.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | toujours | `text-input` | `input`, `change`, `submit`, `keydown`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | texte ≤ 16 Kio | non | Remplace le contenu ; refusée sur un champ lié à un intent d’écriture. |
| `placeholder` | texte ≤ 256 octets | non | Indication affichée tant que le champ est vide. |
| `max-length` | entier de 1 à 16384 | non | Limite du contenu, en octets ; un intent d’écriture peut en imposer une plus basse. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `textarea`

Champ de texte de plusieurs lignes, édité par l’hôte, méthodes de saisie (IME) comprises.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | toujours | `multiline-text-input` | `input`, `change`, `submit`, `keydown`, `focus`, `blur`, `contextmenu` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | texte ≤ 16 Kio | non | Comme pour `field`. |
| `placeholder` | texte ≤ 256 octets | non | Indication affichée tant que le champ est vide. |
| `max-length` | entier de 1 à 16384 | non | Comme pour `field`. |
| `rows` | entier de 1 à 40 | non | Lignes visibles avant le défilement ; 3 par défaut. |
| `disabled` | booléen | non | Refuse les entrées ; correspond à `:disabled`. |
| `name` | identifiant ≤ 64 octets | non | Nom du champ dans un `form`. |

### `form`

Regroupe des contrôles nommés. Avec `intent`, la validation envoie leurs valeurs à un service d’écriture directement depuis l’hôte ; la logique du widget ne fournit jamais ce contenu.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | jamais | `form` | `submit` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `intent` | `notes.save` \| `playervox.rating.publish` \| `twitch.chat.send` | non | Intent d’écriture lié. |
| `target` | texte ≤ 1 Kio | non | ID opaque de l’objet modifié (une note, le message auquel on répond), vérifié par le service. |

### `elapsed`

Durée affichée que l’hôte fait avancer à partir d’un repère donné par un service : un chronomètre qui tourne ne demande aucun travail à la logique. Stylé comme `text` ; repeint seulement quand le texte affiché change, au plus à 60 Hz, et jamais quand le widget est masqué.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `timer` | `activate`, `contextmenu`, `wheel` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `base` | entier de 0 à 9007199254740991 | oui | Millisecondes écoulées à l’instant `at`. |
| `at` | entier de 0 à 9007199254740991 | oui | Instant de l’horloge monotone de l’hôte, en millisecondes, donné par le résultat du service. |
| `running` | booléen | non | Avance depuis `at` ; `false` par défaut. |
| `format` | `hh:mm:ss` \| `hh:mm:ss.cc` \| `mm:ss` | oui | Les heures continuent au-delà de 99 ; `cc` sont les centièmes, tronqués. |

### `progress`

Barre de progression horizontale.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `progress-indicator` | `activate`, `contextmenu`, `wheel` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | nombre de -1000000000 à 1000000000 | oui | Valeur courante. |
| `max` | nombre de -1000000000 à 1000000000 | non | Borne supérieure, positive ; 1 par défaut. |

### `gauge`

Jauge en anneau ou en arc.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `meter` | `activate`, `contextmenu`, `wheel` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | nombre de -1000000000 à 1000000000 | oui | Valeur courante. |
| `max` | nombre de -1000000000 à 1000000000 | non | Borne supérieure, positive ; 1 par défaut. |
| `shape` | `ring` \| `arc` | non | `ring` par défaut. |

### `chart`

Graphique en ligne, en aire, en barres ou sparkline, dessiné par l’hôte.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| `series` | tout conteneur | quand un événement est écouté | `figure` | `activate`, `contextmenu`, `wheel` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `kind` | `line` \| `area` \| `bar` \| `sparkline` | oui | Type de graphique. |
| `min` | nombre de -1000000000 à 1000000000 | non | Borne inférieure fixe de l’axe des valeurs. |
| `max` | nombre de -1000000000 à 1000000000 | non | Borne supérieure fixe de l’axe des valeurs. |

### `series`

Une série de données d’un `chart`, colorée par `color`.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | `chart` | jamais | `figure` | aucun |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `values` | liste de nombres ≤ 1024 | oui | Valeurs, dans l’ordre. |

### `separator`

Filet de séparation entre deux groupes.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | jamais | `splitter` | aucun |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `axis` | `vertical` \| `horizontal` | non | `horizontal` par défaut. |

### `canvas`

Surface que l’hôte peint à partir de la dernière liste de commandes passée à `draw`.

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| vide | tout conteneur | quand un événement est écouté | `image` | `activate`, `contextmenu`, `wheel`, `keydown`, `focus`, `blur` |

Aucun attribut propre.

### `popover`

Panneau flottant ancré à un élément, dessiné au-dessus du contenu et rogné au cadre du widget (listes déroulantes, menus contextuels).

| Contenu | Parents | Focus clavier | Rôle | Événements |
| --- | --- | --- | --- | --- |
| éléments de bloc | tout conteneur | jamais | `menu` | `dismiss` |

| Attribut | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `anchor` | nom de `ref` | oui | `ref` de l’élément contre lequel le panneau est placé. |
| `open` | booléen | non | Visibilité ; l’hôte le ferme et envoie `dismiss`. |
| `placement` | `below` \| `above` \| `start` \| `end` \| `pointer` | non | Côté préféré, ou dernière position du pointeur ; `below` par défaut. |
<!-- /generated:elements -->

## Événements

<!-- generated:events -->
| Événement | Action de l’utilisateur | Détail | Signification |
| --- | --- | --- | --- |
| `activate` | **oui** | `x`, `y` | Clic principal, ou Entrée ou Espace sur l’élément qui a le focus. |
| `contextmenu` | **oui** | `x`, `y` | Clic secondaire, touche Menu ou Maj+F10. |
| `wheel` | non | `dx`, `dy` | Défilement à la molette ou au pavé tactile au-dessus d’un élément qui n’est pas un conteneur à défilement. |
| `keydown` | **oui** | `key`, `ctrl`, `alt`, `shift`, `meta`, `repeat` | Touche enfoncée pendant que l’élément a le focus, en mode interactif. Les touches que l’hôte se réserve (Tab pour parcourir les contrôles, raccourcis d’OverCrow, composition d’une méthode de saisie) ne sont jamais transmises. |
| `input` | **oui** | `value` | Valeur en cours de modification (texte, glissement d’un curseur). Copie en lecture seule ; c’est l’hôte qui conserve le contenu. |
| `change` | **oui** | `value` | Valeur validée : perte du focus ou Entrée pour un texte, relâchement pour un curseur, tout changement pour une bascule, une case à cocher ou une liste déroulante. |
| `submit` | **oui** | `outcome`, `error` | Formulaire validé par Entrée dans un champ, par Ctrl+Entrée dans un `field` ou un `textarea`, ou par un bouton `submit` ; un intent d’écriture peut réserver la touche Entrée seule au passage d’un champ à l’autre. Avec un intent, porte le résultat de l’écriture. |
| `focus` | non | aucun | L’élément a reçu le focus clavier. |
| `blur` | non | aucun | L’élément a perdu le focus clavier. |
| `reachend` | non | aucun | Le défilement est arrivé à moins d’une hauteur visible de la fin (charger la suite, l’historique). |
| `stick` | non | `stuck` | L’utilisateur a fait défiler un conteneur loin de sa fin, ou y est revenu (compteur de messages non lus, retour au plus récent). Un contenu qui grandit ne l’envoie jamais. |
| `dismiss` | non | aucun | L’hôte a fermé un popover (Échap, clic à l’extérieur, ancre retirée). |
<!-- /generated:events -->

Un événement marqué comme action de l’utilisateur autorise un
[appel de service protégé](services.md#les-appels-qui-demandent-une-action-de-lutilisateur)
pendant que la logique le traite. Le détail est ce que reçoit un
gestionnaire ; dans un gestionnaire écrit sous forme d’appel, il s’appelle
`event` :

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
    <list class="history" stick-to-end={state.following} item-height="20" label={heading(state)} on:stick={stuck(event.stuck)}>
```

Les touches nommées de `keydown` sont :

<!-- generated:named-keys -->
`Enter`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`.
<!-- /generated:named-keys -->

Toute autre `key` est un unique caractère imprimable.

## Tailles par défaut

Les éléments qu’OverCrow dessine prennent ces tailles, en pixels logiques à
100 %, sauf si le style définit `width` ou `height`. Tout autre élément tire
sa taille de son contenu et du style : un `canvas` n’a pas de taille tant
que le style ne lui en donne pas.

<!-- generated:default-sizes -->
| Élément | Quand | Largeur | Hauteur |
| --- | --- | --- | --- |
| `icon` | toujours | `font-size` | `font-size` |
| `image` | toujours | image décodée, sinon 0 | image décodée, sinon 0 |
| `avatar` | toujours | image décodée, sinon 28 | image décodée, sinon 28 |
| `toggle` | toujours | 32 | 18 |
| `checkbox` | toujours | 16 | 16 |
| `slider` | toujours | 120 | 18 |
| `progress` | toujours | 120 | 6 |
| `gauge` | `shape="arc"` | 48 | 32 |
| `gauge` | toujours | 48 | 48 |
| `chart` | toujours | 160 | 48 |
| `field` | toujours | 160 | max(`--control-height`, hauteur de ligne) |
| `textarea` | toujours | 160 | `rows` hauteurs de ligne |
| `separator` | `axis="vertical"` | 1 | 0 |
| `separator` | toujours | 0 | 1 |
| `select` | toujours | son texte | son texte |
| `elapsed` | toujours | son texte | son texte |
<!-- /generated:default-sizes -->

<!-- source: docs/content/examples/countdown/style.ocss -->
```css
.dots {
  height: 12px;
}
```
