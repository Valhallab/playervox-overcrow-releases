# Le manifeste

`manifest.json` dit à PlayerVox OverCrow ce qu’est un widget avant que son
code ne s’exécute : son identité et sa version, ses noms, les tailles qu’il
accepte, les permissions qu’il demande et les lignes qu’il ajoute à son menu
d’options. Vous l’écrivez à la main ; il est empaqueté tel quel.

Le fichier est un seul objet JSON strict. Une marque d’ordre des octets, une
clé en double, des données après l’objet ou un champ inconnu le font
refuser : OverCrow n’ignore aucun champ.

## Un exemple complet

<!-- source: templates/counter/manifest.json -->
```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "{{id}}",
  "version": "0.1.0",
  "name": {
    "en": "{{name}}",
    "fr": "{{name}}"
  },
  "sizing": {
    "fit": "none",
    "preferred": { "width": 200, "height": 96 },
    "min": { "width": 140, "height": 72 },
    "max": { "width": 640, "height": 640 }
  }
}
```

`overcrow-widget init` écrit ce fichier ; `{{id}}` et `{{name}}` sont les
valeurs qu’il remplit. Voici un manifeste avec des permissions et un menu :

<!-- source: docs/content/examples/countdown/manifest.json -->
```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "com.example.countdown",
  "version": "1.0.0",
  "name": { "en": "Countdown", "fr": "Compte à rebours" },
  "sizing": {
    "fit": "none",
    "preferred": { "width": 220, "height": 190 },
    "min": { "width": 180, "height": 160 },
    "max": { "width": 480, "height": 400 }
  },
  "permissions": {
    "storage": true
  },
  "wrapper": {
    "menu": [
      {
        "type": "toggle",
        "id": "show-rounds",
        "label": { "en": "Show finished rounds", "fr": "Afficher les tours terminés" },
        "icon": "circle-check",
        "default": true
      },
      {
        "type": "action",
        "id": "reset-rounds",
        "label": { "en": "Reset the rounds", "fr": "Remettre les tours à zéro" },
        "icon": "rotate-ccw",
        "visibleWhen": "show-rounds"
      }
    ]
  }
}
```

## Champs

<!-- generated:manifest-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `schemaVersion` | entier de 1 à 1 | oui | Version du document de manifeste. |
| `apiVersion` | entier de 1 à 1 | oui | Version de l’API des widgets ; elle sélectionne ce schéma. |
| `id` | `widget ID` | oui | ID en DNS inversé, de 3 octets à 128 octets : au moins deux segments de `[a-z0-9-]` séparés par des points, chacun d’au plus 63 octets, sans `-` au début ni à la fin. `com.playervox` et `com.playervox.*` sont réservés aux paquets signés par PlayerVox. |
| `version` | `version` | oui | SemVer 2.0.0 `MAJOR.MINOR.PATCH[-PRERELEASE]` sous sa forme canonique, d’au plus 64 octets ; les métadonnées de build sont refusées. |
| `name` | `WidgetName` | oui | Nom localisé du widget, affiché par l’hôte. |
| `sizing` | `Sizing` | oui | Règles de taille et d’ajustement appliquées par le cadre du widget. |
| `vm` | `VmRequest` | non | Budget demandé pour la VM ; absent, les valeurs par défaut s’appliquent. |
| `permissions` | `Permissions` | non | Permissions demandées ; absent, aucune. |
| `wrapper` | `wrapper` | non | Lignes du widget dans le menu d’options de l’hôte. |
| `requires` | `host features` | non | Sources de données de l’hôte, distinctes, sans lesquelles le widget ne peut pas fonctionner, comme le `requires` d’une ligne de `wrapper.menu`. Sur une machine à laquelle il en manque une, l’hôte ne démarre ni n’affiche le widget et conserve sa place ; le widget revient quand la source revient. |
<!-- /generated:manifest-fields -->

### Identité et version

- **`id`** est l’identité du widget partout : dans le catalogue, dans le
  profil de l’utilisateur, dans son stockage. Choisissez un ID en DNS
  inversé sous un domaine que vous contrôlez, et gardez-le. Les ID sous
  `com.playervox` sont réservés aux widgets publiés par PlayerVox.
- **`version`** est une version sémantique. Une version publiée ne change
  jamais : toute modification d’un widget publié est une nouvelle version,
  supérieure.
- **`schemaVersion`** et **`apiVersion`** valent tous deux `1`.

### Noms

`name` donne le nom qu’OverCrow affiche dans sa liste de widgets et dans ses
menus, en anglais et en français. Les deux sont obligatoires.

<!-- generated:manifest-name -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `en` | `name text` | oui | Nom en anglais. |
| `fr` | `name text` | oui | Nom en français. |
<!-- /generated:manifest-name -->

## Tailles

`sizing` indique la taille du widget quand l’utilisateur l’ajoute, jusqu’où
celui-ci peut le réduire et l’agrandir, et si OverCrow peut ajuster son
cadre à son contenu. Les longueurs sont en pixels logiques, à une échelle de
100 % ; l’échelle du contenu choisie par l’utilisateur (de 50 % à 175 %)
les multiplie.

<!-- generated:manifest-sizing -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `fit` | `none` \| `both` \| `height` | oui | Ajustement au contenu que le widget accepte : sur les deux axes (`both`), en hauteur seulement (`height`) ou aucun (`none`). Le redimensionnement manuel reste toujours possible. |
| `defaultMode` | `fit` \| `manual` | non | Mode d’un widget nouvellement placé ; par défaut `fit` quand `fit` n’est pas `none`, sinon `manual`. `fit` avec `fit: none` est refusé. |
| `preferred` | `Dimensions` | oui | Taille initiale ; entre `min` et `max`. |
| `min` | `Dimensions` | oui | Plus petite taille. |
| `max` | `Dimensions` | oui | Plus grande taille. |
<!-- /generated:manifest-sizing -->

`preferred`, `min` et `max` sont chacun une paire de dimensions, avec
`min` ≤ `preferred` ≤ `max` sur les deux axes :

<!-- generated:manifest-dimensions -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `width` | entier de 1 à 4096 | oui | Pixels logiques. |
| `height` | entier de 1 à 4096 | oui | Pixels logiques. |
<!-- /generated:manifest-dimensions -->

Avec `fit: "both"`, OverCrow donne au cadre la taille dont la vue a besoin,
dans les deux directions : l’Horloge grandit quand l’utilisateur active les
secondes. Avec `fit: "height"`, l’utilisateur choisit la largeur et la
hauteur suit le contenu. Avec `fit: "none"`, le cadre garde la taille que
l’utilisateur lui a donnée et la vue le remplit. L’utilisateur peut toujours
redimensionner à la main.

<!-- source: widgets/clock/manifest.json -->
```json
  "sizing": {
    "fit": "both",
    "preferred": { "width": 110, "height": 60 },
    "min": { "width": 40, "height": 24 },
    "max": { "width": 480, "height": 240 }
  },
```

## Permissions

Un widget n’obtient rien qu’il n’ait déclaré ici, et une déclaration
n’accorde rien à elle seule : l’utilisateur donne d’abord son accord.
[Services et permissions](services.md) explique chaque permission et ce
qu’elle autorise.

<!-- generated:manifest-permissions -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `network` | liste de `NetworkRule` ≤ 32 | non | Règles réseau, distinctes. |
| `storage` | booléen | non | Stockage clé-valeur tenu par l’hôte ; `false` par défaut. |
| `clipboardWrite` | booléen | non | Écriture de texte dans le presse-papiers ; `false` par défaut. |
| `gameEvents` | liste de `game event` ≤ 32 | non | Noms d’événements `overcrow.game.<name>.v1`, distincts. |
| `capabilities` | `capability names` | non | Capabilities du schéma, distinctes. |
<!-- /generated:manifest-permissions -->

<!-- source: widgets/stopwatch/manifest.json -->
```json
  "permissions": {
    "capabilities": ["stopwatch.read", "stopwatch.control"]
  }
```

Une règle réseau est un objet à part entière ; ses champs sont décrits avec
les [règles réseau](services.md#règles-réseau).

## Le menu d’options

Chaque widget a un menu d’options, ouvert depuis son cadre. OverCrow y place
d’abord ses propres lignes (opacité, échelle, ajustement au contenu,
visibilité en mode passif). `wrapper.menu` ajoute les vôtres en dessous :
bascules, curseurs, choix, actions et groupes, chacun avec un libellé dans
les deux langues.

<!-- source: widgets/clock/manifest.json -->
```json
  "wrapper": {
    "menu": [
      {
        "type": "toggle",
        "id": "show-seconds",
        "label": { "en": "Show seconds", "fr": "Afficher les secondes" },
        "default": false
      },
      {
        "type": "toggle",
        "id": "show-date",
        "label": { "en": "Show date", "fr": "Afficher la date" },
        "default": true
      },
      {
        "type": "choice",
        "id": "date-format",
        "label": { "en": "Date format", "fr": "Format de date" },
        "visibleWhen": "show-date",
        "choices": [
          { "value": "day-month-year", "label": { "en": "dd/mm/yyyy", "fr": "jj/mm/aaaa" } },
          { "value": "year-month-day", "label": { "en": "yyyy-mm-dd", "fr": "aaaa-mm-jj" } },
          { "value": "month-day-year", "label": { "en": "mm/dd/yyyy", "fr": "mm/jj/aaaa" } }
        ],
        "default": "day-month-year"
      }
    ]
  }
```

OverCrow dessine les lignes, enregistre leurs valeurs dans le profil de
l’utilisateur et les donne à la logique : lisez une valeur avec
`option(id, fallback)` et suivez les changements avec `onHost`. Une ligne
`action` n’a pas de valeur : elle appelle le gestionnaire que vous avez
enregistré avec `onMenu`. Voir
[le menu d’options dans la logique](logic.md#le-menu-doptions).

Une ligne du menu peut fixer l’une de ses valeurs déclarées ou envoyer son
action, rien d’autre. Elle ne peut ni accorder une permission ni ouvrir un
lien, et choisir une ligne n’est pas une
[action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur)
qui autorise un appel de service protégé.

### Champs communs à toutes les lignes

<!-- generated:menu-row-fields -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `type` | `toggle` \| `slider` \| `choice` \| `action` \| `group` | oui | Type de la ligne. |
| `id` | identifiant ≤ 48 octets | oui | Unique parmi toutes les lignes du widget ; clé de la valeur enregistrée. |
| `label` | `MenuLabel` | oui | Libellé localisé de la ligne. |
| `icon` | nom d’icône Lucide | non | Icône placée devant le libellé, prise dans la liste de l’hôte et dessinée par lui. |
| `visibleWhen` | identifiant ≤ 48 octets | non | ID d’une ligne `toggle` déclarée plus haut ; cette ligne n’est affichée que tant que cette bascule est activée. |
| `requires` | `fps` \| `telemetry.cpuTemperature` \| `telemetry.gpuTemperature` | non | Source de données de l’hôte ; l’hôte masque la ligne quand il ne peut pas la fournir. |
<!-- /generated:menu-row-fields -->

Une ligne dotée de `visibleWhen` ne s’affiche que tant que la bascule nommée
est activée : le format de date de l’Horloge apparaît quand la date est
affichée. Une ligne dotée de `requires` est masquée sur une machine qui ne
peut pas fournir cette donnée, comme les lignes de température du widget
Performances :

<!-- source: widgets/performance/manifest.json -->
```json
        "requires": "telemetry.cpuTemperature",
```

### Types de ligne

<!-- generated:menu-row-types -->
### `toggle`

Bascule booléenne.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `default` | booléen | oui | Valeur initiale. |

### `slider`

Nombre borné ; `step` > 0, `step` ≤ `max - min`, au plus 10000 pas, `default` dans l’intervalle.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `min` | nombre de -1000000 à 1000000 | oui | Borne inférieure. |
| `max` | nombre de -1000000 à 1000000 | oui | Borne supérieure, plus grande que `min`. |
| `step` | nombre de -1000000 à 1000000 | oui | Pas. |
| `default` | nombre de -1000000 à 1000000 | oui | Valeur initiale. |

### `choice`

Une valeur parmi les choix déclarés.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `choices` | liste de `MenuChoice` ≤ 16 | oui | Au moins 2 choix. |
| `default` | identifiant ≤ 48 octets | oui | Valeur de l’un des choix déclarés. |

### `action`

Appelle le gestionnaire enregistré par `onMenu` avec l’ID de la ligne. Ce n’est pas une action de l’utilisateur.

### `group`

Sous-menu latéral qui contient des lignes autres que des groupes.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `rows` | liste de `MenuRow` ≤ 16 | oui | Au moins une ligne ; un `group` n’y est pas admis. |
<!-- /generated:menu-row-types -->

### Libellés et choix

Un `label` est un objet qui porte les deux langues :

<!-- generated:menu-label -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `en` | `label text` | oui | Libellé en anglais. |
| `fr` | `label text` | oui | Libellé en français. |
<!-- /generated:menu-label -->

Chaque entrée de `choices` est une valeur et son libellé :

<!-- generated:menu-choice -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `value` | identifiant ≤ 48 octets | oui | Valeur enregistrée ; unique dans la ligne. |
| `label` | `MenuLabel` | oui | Libellé localisé du choix. |
<!-- /generated:menu-choice -->

## Sources de données indispensables

Au premier niveau du manifeste, `requires` liste les sources de données sans
lesquelles le widget ne peut pas fonctionner, avec les mêmes noms que le
`requires` d’une ligne. Sur une machine à laquelle il en manque une,
OverCrow ne démarre pas le widget, ne l’affiche pas et conserve sa place
dans la disposition ; le widget revient quand la source revient.
Utilisez-le pour un widget qui n’a rien d’autre à afficher, comme un
compteur d’images par seconde sans source de fréquence d’images. Pour une
seule valeur facultative, préférez le `requires` d’une ligne.

## Un budget de mémoire plus grand

La logique s’exécute avec un tas de 16 Mio. Un widget qui a besoin de plus
le demande avec `vm` ; aucun autre budget de la VM ne peut être modifié.

<!-- generated:manifest-vm -->
| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `heapMiB` | entier de 16 à 48 | oui | Plafond du tas QuickJS en Mio, de 16 Mio à 48 Mio. Le plafond du processus de la VM (64 Mio) ne change pas. |
<!-- /generated:manifest-vm -->

Le plafond de mémoire du processus du widget reste le même : un tas plus
grand laisse donc moins de place à tout le reste. Ne le demandez que si
`overcrow-widget dev` montre que le widget s’arrête avec `resource_limit`.

## Comment le manifeste est vérifié

`overcrow-widget check` valide le manifeste avec le validateur qu’OverCrow
exécute lui-même, et désigne le membre qu’il refuse :

```text
error[manifest.sizing]: `sizing` is out of bounds or inconsistent
  --> manifest.json:7:3
   |
 7 |   "sizing": {
   |   ^
   = help: `min` <= `preferred` <= `max`, each within the schema's widget size bounds
check: 1 error(s), 0 warning(s)
```

OverCrow le valide de nouveau quand le paquet est admis dans le catalogue,
quand il est installé et à chaque démarrage du widget. Une nouvelle version
dont le manifeste demande plus que la précédente (une règle réseau, un
événement de jeu, une capability, le stockage ou le presse-papiers) attend
l’accord de l’utilisateur avant de remplacer la version installée.
