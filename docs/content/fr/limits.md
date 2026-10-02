# Limites

Tout est borné dans un widget PlayerVox OverCrow : la taille de ses
fichiers, le nombre d’éléments de sa vue, la durée d’un tour de sa logique,
les octets d’une réponse. Ces limites gardent un widget petit et empêchent
qu’un widget ralentisse le jeu ou les autres widgets. Cette page liste
celles que rencontre l’auteur d’un widget.

```text
error[view.too_many_children]: the view exceeds a size bound of the schema
  --> view.ocml:15:14375
   = help: split long static content, or render repeated content with <for>
check: 1 error(s), 0 warning(s)
```

Un élément de plus de 1024 enfants : `check` nomme la limite, l’endroit et
une façon d’en sortir.

## Ce qui se passe à une limite

- **Dans les fichiers du projet**, une limite est une erreur
  d’`overcrow-widget check`, avec un code qui la nomme
  (`view.too_many_elements`, `style.too_many_rules`, `project.file_size`…).
  Rien n’est tronqué.
- **Dans un appel de service**, un paramètre hors limites échoue avec
  `invalid_request`, un quota plein avec `quota_exceeded`, et trop de
  requêtes simultanées avec `busy`. Voir [erreurs](services.md#erreurs).
- **Pendant que la logique s’exécute**, dépasser un budget de la VM (la
  durée d’un tour, le tas, les messages d’un tour) arrête le widget ;
  OverCrow le redémarre quelques fois. Voir
  [ce qui se passe en cas d’échec](logic.md#ce-qui-se-passe-en-cas-déchec).
- **Dans ce que le widget affiche**, OverCrow refuse une valeur hors limites
  (un texte trop long pour un attribut, trop de nœuds), ce qui arrête aussi
  le widget : bornez ce que vous affichez, par exemple le nombre de lignes
  d’une liste.

Les longueurs sont en pixels logiques, à une échelle du contenu de 100 %.
Les limites de texte comptent des octets UTF-8, sauf quand l’unité indique
des caractères. Un Kio vaut 1024 octets et un Mio 1024² octets. Les limites
que la logique peut lire sont aussi des constantes du SDK : voir
[constantes de limites](sdk.md#constantes-de-limites).

## Limites par thème

<!-- generated:limits -->
### Fichiers du projet et paquet

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_VIEW_SOURCE_BYTES` | 256 Kio | Taille du fichier source `view.ocml`. |
| `MAX_STYLE_SOURCE_BYTES` | 128 Kio | Taille du fichier source `style.ocss`. |
| `MAX_LOGIC_BYTES` | 512 Kio | Le script `logic.js`, code compilé de la vue compris. |
| `MAX_LOCALE_ENTRIES` | 2048 | Messages d’un fichier `locales/<locale>.json`. |
| `MAX_LOCALE_KEY_BYTES` | 128 octets | Longueur d’une clé de message. |
| `MAX_LOCALE_VALUE_BYTES` | 4 Kio | Longueur du texte d’un message. |
| `MAX_LOCALE_FILE_BYTES` | 256 Kio | Un fichier `locales/<locale>.json`. |
| `MAX_MANIFEST_BYTES` | 64 Kio | Taille de `manifest.json`. |
| `MAX_LICENSE_BYTES` | 64 Kio | Texte de `LICENSE`. |
| `MAX_COMPILED_VIEW_BYTES` | 512 Kio | `view.json`, la vue compilée. |
| `MAX_PACKAGE_BYTES` | 16 Mio | Taille d’une archive `.ocpkg`. |
| `MAX_PACKAGE_FILES` | 256 | Entrées d’une archive, `manifest.json` et `ledger.json` compris. |
| `MAX_PACKAGE_PATH_BYTES` | 128 octets | Chemin d’une entrée de l’archive. |
| `MAX_ASSET_PATH_SEGMENTS` | 4 | Segments de chemin sous `assets/`, nom du fichier compris. |

### Manifeste et menu d’options

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MIN_WIDGET_ID_BYTES` | 3 octets | ID de widget le plus court. |
| `MAX_WIDGET_ID_BYTES` | 128 octets | ID de widget le plus long ; chaque segment séparé par un point fait au plus 63 octets. |
| `MAX_VERSION_BYTES` | 64 octets | Texte de la version du paquet. |
| `MAX_WIDGET_NAME_CHARS` | 48 caractères | Un nom du widget, en anglais ou en français, dans le manifeste. |
| `MAX_WIDGET_EDGE_PX` | 4096 px | Largeur ou hauteur du cadre d’un widget. |
| `MIN_CONTENT_SCALE` | 500 ‰ | Plus petite échelle du contenu (50 %). |
| `MAX_CONTENT_SCALE` | 1750 ‰ | Plus grande échelle du contenu (175 %). |
| `MAX_GAME_EVENTS` | 32 | Événements de jeu sémantiques déclarés par un paquet. |
| `MAX_MENU_ROWS` | 16 | Lignes du widget dans `wrapper.menu`, lignes de groupe et leurs enfants compris. |
| `MAX_MENU_DEPTH` | 1 | Niveaux de sous-menu : un `group` ne peut pas contenir un autre `group`. |
| `MAX_MENU_LABEL_CHARS` | 80 caractères | Un libellé de ligne ou de choix, en anglais ou en français. |
| `MAX_MENU_ID_BYTES` | 48 octets | ID d’une ligne et valeur d’un choix. |
| `MIN_MENU_CHOICES` | 2 | Choix d’une ligne `choice`, borne inférieure. |
| `MAX_MENU_CHOICES` | 16 | Choix d’une ligne `choice`, borne supérieure. |
| `MAX_MENU_NUMBER` | 1000000 en valeur absolue | Valeur absolue d’une borne, d’un pas ou d’une valeur par défaut de curseur. |
| `MAX_SLIDER_STEPS` | 10000 | `(max - min) / step` d’une ligne de curseur. |

### Règles réseau

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_NETWORK_RULES` | 32 | Règles réseau déclarées par un paquet. |
| `MAX_NETWORK_PATH_BYTES` | 1 Kio | Modèle `path` d’une règle réseau. |
| `MAX_PATH_PARAMS` | 8 | `pathParams` d’une règle réseau. |
| `MAX_QUERY_PARAMS` | 16 | `queryParams` d’une règle réseau. |
| `MAX_ENUM_VALUES` | 32 | Valeurs d’une contrainte de paramètre `enum`. |
| `MAX_ENUM_VALUE_BYTES` | 128 octets | Une valeur d’un paramètre `enum`. |
| `MAX_PARAMETER_NAME_BYTES` | 32 octets | Nom d’un paramètre de chemin ou de requête. |
| `MAX_SLUG_PARAMETER_BYTES` | 128 octets | Plus grand `maxLength` d’une contrainte de paramètre `slug`. |
| `MAX_STRING_PARAMETER_BYTES` | 256 octets | Plus grand `maxLength` d’une contrainte de paramètre de requête `string`. |
| `MAX_DNS_LABEL_BYTES` | 63 octets | Un label, entre deux points, du nom d’hôte d’une origine réseau ou d’un ID de widget. |
| `MAX_DNS_NAME_BYTES` | 253 octets | Nom d’hôte d’une origine réseau. |
| `MAX_REQUEST_URL_BYTES` | 2 Kio | Texte de l’URL d’une requête. |
| `MAX_HTTP_REQUEST_BYTES` | 256 Kio | Corps d’une requête sortante. |
| `MAX_HTTP_RESPONSE_BYTES` | 1 Mio | Corps d’une réponse remise au widget quand sa règle réseau ne déclare pas de `maxResponseBytes`, et de toute réponse `as: "image"`. |
| `MAX_HTTP_DECLARED_RESPONSE_BYTES` | 3 Mio | Plus grand `maxResponseBytes` d’une règle réseau : le corps d’une réponse que la règle autorise, remis au widget. |
| `MAX_HTTP_RESPONSE_BYTES_PER_WIDGET` | 4 Mio | Octets de réponse que les requêtes en cours d’un widget peuvent réserver, chacune à hauteur de la limite de sa règle ; `busy` au-delà. Vaut `MAX_HTTP_CONCURRENT_PER_WIDGET` × `MAX_HTTP_RESPONSE_BYTES` : les règles sans `maxResponseBytes` ne l’atteignent jamais. |
| `MAX_HTTP_RESPONSE_BYTES_GLOBAL` | 64 Mio | Octets de réponse que les requêtes en cours de tous les widgets peuvent réserver ; `busy` au-delà. Vaut `MAX_HTTP_CONCURRENT_GLOBAL` × `MAX_HTTP_RESPONSE_BYTES`. |
| `MAX_HTTP_CONCURRENT_PER_WIDGET` | 4 | Requêtes en cours d’un widget. |
| `MAX_HTTP_CONCURRENT_GLOBAL` | 64 | Requêtes en cours de tous les widgets. |
| `HTTP_TIMEOUT_MS` | 30000 ms | Durée totale d’une requête. |

### Fiche

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_LISTING_LOCALIZATIONS` | 16 | Textes localisés de la fiche d’une version. |
| `MAX_LISTING_NAME_BYTES` | 128 octets | Nom d’une localisation, affiché par la marketplace. |
| `MAX_LISTING_DESCRIPTION_BYTES` | 512 octets | Description d’une localisation, affichée par la marketplace. |
| `MAX_AUTHOR_BYTES` | 128 octets | Auteur affiché dans une fiche. |
| `MAX_SPDX_LICENSE_BYTES` | 64 octets | Expression de licence SPDX d’une fiche. |
| `MAX_CATALOG_URL_BYTES` | 2 Kio | URL des sources d’une fiche. |
| `MAX_PREVIEW_BYTES` | 256 Kio | Image PNG d’aperçu d’une fiche. |

### Vue

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_VIEW_ELEMENTS` | 4096 | Éléments écrits dans `view.ocml`, composants compris. |
| `MAX_COMPONENTS` | 64 | Composants locaux déclarés dans une vue. |
| `MAX_COMPONENT_PROPS` | 32 | Propriétés déclarées d’un composant local. |
| `MAX_VIEW_EXPRESSIONS` | 4096 | Expressions compilées d’une vue, gestionnaires compris. |
| `MAX_EXPRESSION_BYTES` | 1 Kio | Longueur du source d’une expression `{expr}`. |
| `MAX_EXPRESSION_DEPTH` | 32 | Imbrication des opérateurs, des appels, des accès aux membres et des littéraux dans une expression. |
| `MAX_CALL_ARGUMENTS` | 8 | Arguments d’un appel, et entrées d’un littéral d’objet ou de tableau, dans une expression. |
| `MAX_SCENE_NODES` | 4096 | Éléments présents dans la vue d’un widget en cours d’exécution, éléments des listes compris. |
| `MAX_TREE_DEPTH` | 32 | Profondeur de l’arbre de la vue sous sa racine ; c’est aussi la limite d’imbrication de `if`, `for` et des composants. |
| `MAX_CHILDREN` | 1024 | Enfants d’un élément. |
| `MAX_NODE_TEXT_BYTES` | 16 Kio | Contenu textuel d’un élément `text`, `span`, `badge` ou `option`. |
| `MAX_ATTRIBUTE_TEXT_BYTES` | 1 Kio | Tout attribut de texte qui n’a pas de limite plus stricte. |
| `MAX_LABEL_BYTES` | 256 octets | Attributs `label`, `tooltip` et `placeholder`. |
| `MAX_IDENTIFIER_BYTES` | 64 octets | Noms de classes, de composants, de champs, de blocs `@keyframes` et autres identifiants du même genre. |
| `MAX_INITIALS_BYTES` | 16 octets | Texte de remplacement `initials` d’un `avatar`. |
| `MAX_CLASSES_PER_NODE` | 16 | Classes d’un élément. |
| `MAX_FIELD_TEXT_BYTES` | 16 Kio | Contenu d’un `field` ou d’un `textarea`, et d’un événement `input` ou `change`. |
| `MAX_CHART_POINTS` | 1024 | Valeurs d’une série de graphique. |
| `MAX_CHART_SERIES` | 4 | Enfants `series` d’un `chart`. |
| `MAX_KEY_BYTES` | 32 octets | `key` d’un événement `keydown` : un caractère affichable ou une touche nommée. |

### Style

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_STYLE_RULES` | 1024 | Règles d’une feuille de style, blocs `@keyframes` exclus. |
| `MAX_SELECTORS_PER_RULE` | 8 | Sélecteurs d’une règle, séparés par des virgules. |
| `MAX_COMPOUNDS_PER_SELECTOR` | 4 | Sélecteurs composés reliés par des combinateurs dans un sélecteur. |
| `MAX_SIMPLE_SELECTORS_PER_COMPOUND` | 6 | Sélecteurs de type, de classe et d’état dans un sélecteur composé. |
| `MAX_DECLARATIONS_PER_RULE` | 64 | Déclarations d’une règle ou d’une étape de `@keyframes`. |
| `MAX_KEYFRAMES` | 32 | Blocs `@keyframes` d’une feuille de style. |
| `MAX_KEYFRAME_STOPS` | 16 | Étapes d’un bloc `@keyframes`. |
| `MAX_SHADOWS` | 2 | Couches d’une valeur `box-shadow`. |
| `MAX_SHADOW_BLUR_PX` | 64 px | Rayon de flou et d’étalement d’une ombre. |
| `MAX_GRADIENT_STOPS` | 8 | Arrêts de couleur d’un `linear-gradient()`. |
| `MAX_GRID_TRACKS` | 24 | Pistes d’un `grid-template-rows` ou d’un `grid-template-columns`. |
| `MAX_GRID_FRACTION` | 1000 en valeur absolue | Plus grand facteur `<fr>` d’une piste de grille. |
| `MAX_TRANSITIONS` | 8 | Entrées d’une liste `transition` ou `animation`. |
| `MAX_ANIMATION_MS` | 300000 ms | Durée ou délai d’une transition ou d’une animation. |
| `MAX_ACTIVE_ANIMATIONS` | 64 | Transitions et animations en cours en même temps dans un widget ; les suivantes passent directement à leur état final. |
| `ANIMATION_RATE_HZ` | 60 Hz | Cadence maximale de repeinture pendant une animation ; rien n’est repeint quand rien ne change. |
| `MAX_LENGTH_PX` | 16384 px | Valeur absolue de toute longueur, de tout décalage et de toute coordonnée. |
| `MIN_FONT_SIZE_PX` | 6 px | Plus petit `font-size`, avant l’échelle du contenu. |
| `MAX_FONT_SIZE_PX` | 96 px | Plus grand `font-size`, avant l’échelle du contenu. |
| `MAX_PERCENT` | 1000 en valeur absolue | Valeur absolue de tout `<percent>` dans une valeur de style. |
| `MAX_ANGLE_DEG` | 3600 en valeur absolue | Valeur absolue de tout `<angle>`, en degrés (dix tours). |
| `MAX_TRANSFORM_FUNCTIONS` | 4 | Fonctions d’une valeur `transform`. |
| `MAX_TRANSFORM_SCALE` | 8 en valeur absolue | Plus grand facteur de `scale()` ; le plus petit est 0. |
| `MAX_EASING_STEPS` | 60 | Pas d’une fonction de progression `steps()`. |
| `MAX_ANIMATION_ITERATIONS` | 10000 | Nombre fini d’itérations d’une animation ; `infinite` reste admis. |

### Dessin et images

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_CANVASES` | 8 | Éléments `canvas` d’un widget. |
| `MAX_DRAW_COMMANDS` | 4096 | Commandes d’un appel à `draw`, qui remplace le contenu du canvas. |
| `MAX_PATH_POINTS` | 16384 | Sommets que l’hôte dessine pour un appel à `draw`, tous chemins confondus, comptés selon un plafond fixe par commande : `moveTo` et `lineTo` 1, `quadTo` 8, `cubicTo` 16, `arc` et `circle` 64, `rect` 36, les autres commandes 0. |
| `MAX_DRAW_STATE_DEPTH` | 16 | Commandes `save` imbriquées. |
| `MAX_IMAGE_EDGE_PX` | 2048 px | Largeur ou hauteur d’une image décodée. |
| `MAX_IMAGE_ENCODED_BYTES` | 2 Mio | Taille encodée d’une image PNG, JPEG ou WebP, avant décodage. |

### Logique

| Limite | Valeur | Signification |
| --- | --- | --- |
| `VM_HEAP_BYTES` | 16 Mio | Plafond du tas de la VM quand le manifeste n’en demande pas. |
| `VM_MAX_HEAP_BYTES` | 48 Mio | Plus grand plafond de tas qu’un manifeste peut demander. |
| `VM_STACK_BYTES` | 256 Kio | Plafond de la pile de la VM. |
| `VM_PROCESS_MEMORY_BYTES` | 64 Mio | Plafond de mémoire, strict, du processus d’un widget. |
| `VM_CPU_PERCENT` | 25 % d’un cœur | Plafond de CPU du processus d’un widget. |
| `VM_TURN_BUDGET_MS` | 50 ms | Durée d’un tour de la logique avant que la VM ne l’interrompe. |
| `VM_JOBS_PER_TURN` | 1024 | Tâches de promesses traitées dans un tour ; une file plus longue est un dépassement de ressources. |
| `VM_MESSAGES_PER_TURN` | 64 | Messages que le widget peut émettre pendant un tour. |
| `MAX_VM_MESSAGES_PER_SECOND` | 120 par seconde | Débit soutenu des messages du widget vers l’hôte. |
| `MAX_VM_MESSAGE_BURST` | 240 | Rafale de messages admise au-dessus de ce débit. |
| `MAX_PATCH_BYTES` | 256 Kio | Taille de ce que le widget envoie en une fois : un changement de la vue ou un appel à `draw`. |
| `MAX_PATCH_OPS` | 4096 | Opérations d’un changement de la vue (éléments créés, retirés, déplacés ou modifiés) après un tour. |
| `MAX_TIMERS` | 16 | Minuteurs actifs d’un widget. |
| `MIN_TIMER_INTERVAL_MS` | 100 ms | Plus courte période d’un minuteur ; l’animation relève du style, pas des minuteurs. |
| `CLOCK_RESOLUTION_MS` | 1 ms | Résolution de `Date.now()` dans la VM. |
| `MAX_LOG_BYTES` | 4 Kio | Texte d’un appel à `log`. |

### Services

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_SERVICE_CALLS_IN_FLIGHT` | 16 | Appels de service sans réponse d’un widget, abonnements exclus. |
| `MAX_SUBSCRIPTIONS` | 16 | Abonnements ouverts d’un widget. |
| `STORAGE_QUOTA_BYTES` | 256 Kio | Clés et valeurs stockées par un widget. |
| `MAX_STORAGE_KEYS` | 512 | Clés stockées par un widget. |
| `MAX_STORAGE_KEY_BYTES` | 128 octets | Longueur d’une clé de stockage. |
| `MAX_STORAGE_VALUE_BYTES` | 64 Kio | Taille, en JSON sérialisé, d’une valeur stockée. |
| `MAX_CLIPBOARD_BYTES` | 16 Kio | Texte d’une écriture dans le presse-papiers. |
| `MAX_OBJECT_ID_BYTES` | 128 octets | ID opaque d’un objet, ou curseur, échangé avec un service. |

### Notes, avis et chat

| Limite | Valeur | Signification |
| --- | --- | --- |
| `MAX_NOTES` | 8 | Notes du document de notes de l’utilisateur ; `notes.create` échoue au-delà. |
| `MAX_NOTE_TITLE_BYTES` | 96 octets | Titre d’une note, non vide une fois les espaces de début et de fin retirés. |
| `MAX_NOTE_BODY_BYTES` | 8 Kio | Corps d’une note. |
| `MAX_NOTE_ITEMS` | 64 | Entrées de la liste de tâches d’une note. |
| `MAX_NOTE_ITEM_BYTES` | 256 octets | Une entrée de liste de tâches. |
| `MAX_REVIEW_CHARS` | 2000 caractères | Texte d’un avis PlayerVox. |
| `MAX_CHAT_MESSAGE_CHARS` | 500 caractères | Message de chat Twitch, la limite de Twitch ; ni vide ni fait seulement d’espaces, sans caractère de contrôle. |
| `MAX_CHAT_FRAGMENTS` | 16 | Portions de texte et emotes d’un message de chat remis au widget ; l’hôte fond le reste en texte. |
| `MAX_CHAT_FAVORITES` | 20 | Chaînes Twitch favorites conservées par l’hôte. |
| `MAX_CHAT_CHANNEL_BYTES` | 25 octets | Identifiant d’une chaîne Twitch après normalisation : lettres ASCII, chiffres et `_`, en minuscules. |

### Images de référence

| Limite | Valeur | Signification |
| --- | --- | --- |
| `PARITY_CHANNEL_TOLERANCE` | 2 niveaux sur 255 | Plus grand écart par canal pour qu’un pixel compte comme identique à celui de l’image de référence. |
| `PARITY_MAX_DIFFERENT_PIXELS` | 100 ppm | Part des pixels admise au-delà de la tolérance par canal. Une seule lettre fausse de 10 px dans un widget de 360 × 260 représente 385 ppm. |
<!-- /generated:limits -->
