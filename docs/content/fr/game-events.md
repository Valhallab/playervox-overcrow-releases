# Événements de jeu

Un widget PlayerVox OverCrow peut suivre ce qui se passe dans un jeu : la
mission où se trouve le joueur, la vague, l’escouade, les Eidolons de la
nuit. Le widget liste dans son manifeste les fonctionnalités qu’il veut, et
PlayerVox OverCrow lui donne leur état, prêt à afficher : les noms du jeu
dans la langue du jeu à côté d’ID stables, des heures en millisecondes
Unix, des durées en secondes. Warframe est le premier jeu.

<!-- source: docs/content/examples/warframe-mission/logic.ts -->
```ts
let lastSeq = 0;
gameEvents.warframe.subscribe((update) => {
  if (!update.ok) return; // not declared or not granted
  const { features, info, events } = update.value;
  state.ready = features.mission === "available";
  state.node = info.mission?.node.name ?? info.mission?.node.id ?? "";
  state.type = info.mission?.type?.name ?? info.mission?.type?.id ?? "";
  state.wave = info.progress?.wave ?? null;
  state.rotation = info.progress?.rotation ?? null;
  for (const event of events) {
    if (event.seq <= lastSeq) continue; // seen in an earlier update
    lastSeq = event.seq;
    if (event.type === "mission_ended") state.lastResult = event.mission.result ?? "ended";
  }
});
```

C’est la logique du compagnon de mission de
[`docs/content/examples/warframe-mission`](../examples/warframe-mission/) :
il affiche le nœud, le type de mission, la vague, la rotation de la
prochaine récompense et l’issue de la dernière mission. `info` porte l’état
courant ; `events` dit ce qui vient de se passer.

## Déclarer les fonctionnalités

`permissions.gameEvents` liste les fonctionnalités que le widget suit,
chacune `<game>.<feature>` :

<!-- source: docs/content/examples/warframe-mission/manifest.json -->
```json
  "permissions": {
    "gameEvents": ["warframe.mission", "warframe.progress"]
  }
```

- Chaque fonctionnalité une fois. Un widget ne reçoit rien d’une
  fonctionnalité qu’il ne liste pas.
- Le joueur voit chaque fonctionnalité avant d’installer le widget. Comme
  toute permission, les événements de jeu peuvent être refusés ou retirés
  dans le Centre de contrôle.
- Une version qui liste une fonctionnalité Warframe exige la fonctionnalité
  de catalogue `game-events-warframe` : le catalogue ne la propose qu’à un
  PlayerVox OverCrow qui a les événements de jeu Warframe, et une
  application plus ancienne garde la version précédente.
- Les événements de jeu ne sont pas sensibles : un widget peut les suivre
  et utiliser aussi le réseau, des liens, le presse-papiers ou un compte.
  Voir [Confidentialité](#confidentialité).
- Pour la revue, chaque fonctionnalité est une clé de permission,
  `gameEvent:warframe.mission`, avec sa justification
  ([clés de permission](cli.md#clés-de-permission)).

## Suivre un jeu

Chaque jeu a un abonnement, sans paramètre :
`gameEvents.warframe.subscribe(listener)`. Il donne une valeur aussitôt,
puis une nouvelle à chaque changement de ce que le widget suit.

| Membre | Signification |
| --- | --- |
| `playing` | `true` tant que Warframe est le jeu actif dans PlayerVox OverCrow. |
| `session` | `{ startedAt, language }` : quand Warframe a été lancé, en millisecondes Unix, et la langue du jeu (`en`, `fr`, `de`… ; `null` tant que le jeu ne l’a pas dite) ; `null` avant tout lancement. Chaque lancement est une nouvelle session. |
| `glossary` | Des mots du jeu, dans la langue du jeu, toujours donnés : voir [Glossaire](#glossaire). |
| `features` | Le statut de chaque fonctionnalité : `location`, `mission`, `progress`, `squad`, `eidolons`, `world` et `rewards`. |
| `info` | L’état de chaque fonctionnalité que le widget suit, prêt à afficher. `null` pour les autres, et tant que rien n’est encore connu. |
| `events` | Les 16 derniers événements de ces fonctionnalités, du plus ancien au plus récent. |

Le statut d’une fonctionnalité est l’un de :

- `available` : PlayerVox OverCrow la suit sur cet ordinateur.
- `unavailable` : PlayerVox OverCrow ne peut pas la suivre, par exemple
  quand le jeu n’est pas trouvé sur cet ordinateur ou qu’une mise à jour du
  jeu a changé ce qu’il dit. Affichez ce que vous avez, et dites que la
  donnée manque.
- `undeclared` : le manifeste ne la liste pas.

L’abonnement échoue avec `permission_denied` quand `gameEvents` ne liste
aucune fonctionnalité `warframe.*` ou que l’utilisateur ne l’a pas
accordée, et avec `busy` quand le widget en a déjà un. Les formes
complètes sont dans les [formes de résultat](result-shapes.md#warframeevents).

### Événements

Chaque événement est `{ seq, at, type }` avec l’état que nomme son type :
la mission, la progression, l’Eidolon, le membre ou le lieu, tel qu’il
était à ce moment.

- Les mises à jour sont fusionnées, et chacune répète les 16 derniers
  événements. Ne traitez que les événements dont le `seq` dépasse le
  dernier que vous avez traité, comme le fait l’exemple. `seq` compte à
  partir de 1 dans chaque abonnement.
- `at` est l’heure réelle du moment dans le jeu, en millisecondes Unix.
- Pour se souvenir d’un événement d’un redémarrage à l’autre, par exemple
  pour cocher une seule fois une mission de Sortie, gardez le `at` du
  dernier événement traité dans le stockage du widget, et sautez les
  événements à cette heure ou avant. `seq` repart de 1 après un
  redémarrage ; `at` ne change pas.

## Warframe

### Fonctionnalités

| Fonctionnalité | Ce que reçoit le widget |
| --- | --- |
| `warframe.location` | Où est le joueur : vaisseau, relais, ville, monde ouvert, mission ou dojo. |
| `warframe.mission` | La mission choisie, en chargement, en cours ou terminée : nœud, planète, type, faction, niveaux des ennemis, ère de Fissure du Néant, modificateurs, résultat, durée, et à la fin les rotations obtenues et les crédits. |
| `warframe.progress` | La progression de la mission : vague et ses ennemis, manches, rotations obtenues, rotation de la prochaine récompense et moment où elle vient. |
| `warframe.squad` | Les pseudos du joueur et de son escouade. |
| `warframe.eidolons` | La nuit et le jour sur les Plaines d’Eidolon, et chaque Eidolon de la nuit : apparition, points faibles, capture, mort ou fuite, à la milliseconde. |
| `warframe.world` | Le monde du jour et de la semaine : la Sortie, la Chasse aux Archontes, les Fissures du Néant, les cycles des mondes ouverts, Baro Ki’Teer et les réinitialisations. |
| `warframe.rewards` | Ce que la mission peut rapporter, par table et par rotation, avec la chance de chaque objet (`info.mission.rewards`). |

### Quand les données arrivent

- `location`, `mission`, `progress`, `squad` et `eidolons` ne fonctionnent
  que tant que Warframe est le jeu actif dans PlayerVox OverCrow (`playing`
  vaut `true`). Quand Warframe se ferme, `playing` passe à `false` et
  `location` à `null` ; les autres membres gardent leurs dernières valeurs
  jusqu’à la session suivante.
- `world` vient de l’état du monde public de Warframe. PlayerVox OverCrow
  le lit toutes les 5 minutes tant qu’un widget qui le suit tourne, que
  Warframe soit joué ou non. `updatedAt` dit quand il a été lu.
- `rewards` vient des tables de butin officielles de Digital Extremes,
  lues une fois par jour et à chaque mise à jour du jeu tant qu’un widget
  qui le suit tourne. Il suit la mission de `info.mission`. Pour
  distinguer une mission de Sortie d’une mission de Chasse aux Archontes,
  PlayerVox OverCrow lit alors aussi l’état du monde ; seul un widget qui
  suit `warframe.world` le reçoit.
- Warframe écrit ce qui se passe avec un retard. Mesuré sous Linux
  (Proton) : la plupart des événements arrivent au widget une seconde
  environ après les faits ; le jeu retient parfois ses lignes, et une
  mission choisie ou le début d’une Défense peuvent arriver 5 à 50 secondes
  plus tard, une récompense jusqu’à 15 secondes environ. Pas encore mesuré
  sous Windows. Les heures restent exactes à la milliseconde ; seule la
  mise à jour arrive plus tard. Comptez à partir des heures, comme
  `nextRewardAt`, pas du moment où arrive une mise à jour.
- Quand PlayerVox OverCrow démarre pendant une session de Warframe, il
  rattrape la session depuis son début : `info` aussitôt, et les derniers
  événements avec leurs heures réelles.

### `info`

Les éléments nommés sont `{ id, name }` : notre ID stable, et le nom dans
la langue du jeu. Un nœud est `{ id, name }` ; voir
[Noms et ID](#noms-et-id).

#### `info.location`

| Membre | Signification |
| --- | --- |
| `kind` | `orbiter`, `relay`, `hub`, `open_world`, `mission`, `dojo` ou `other`. |
| `place` | Lequel : une ville, un relais ou un monde ouvert des [lieux](#lieux), ou le nœud de la mission (sa clé et son nom) ; `null` quand Warframe ne le dit pas. |
| `since` | Quand le joueur est arrivé, en millisecondes Unix. |

#### `info.mission`

La dernière mission de la session.

| Membre | Signification |
| --- | --- |
| `state` | `selected` (choisie sur la carte stellaire), `loading`, `in_progress` ou `ended`. |
| `node` | Le nœud : `{ id, name }`. |
| `planet` | Sa [planète ou sa région](#planètes-et-régions). |
| `type` | Le [type de mission](#types-de-mission) ; `null` pour un type absent de la liste, et jusqu’au chargement quand `typeAtLoading` vaut `true`. |
| `typeAtLoading` | `true` quand le jeu remplace le type que l’état du monde publie pour ce nœud (une mission de Sortie dont le type publié n’existe pas sur le décor du nœud) : `type` reste `null` jusqu’au chargement, puis vaut le type choisi par le jeu. N’affichez aucun type d’ici là. |
| `faction` | La [faction](#factions) ennemie. |
| `enemyLevel` | `{ min, max }` : les niveaux des ennemis. À la sélection, ceux du nœud (plus 100 sur la Route de l’Acier) ; ceux d’une mission Cauchemar, d’Arbitrage, d’Alerte ou de Liche Kuva valent `null` jusqu’au chargement, puis ceux du jeu. |
| `fissure` | L’[ère](#ères-des-fissures-du-néant) d’une mission de Fissure du Néant, ou `null`. |
| `modifiers` | Ce qui modifie la mission, au plus 8, chacun `{ id, name, stage }` ([modificateurs](#modificateurs)), dès qu’elle est choisie. `stage` vaut 1 à 3 pour une mission de Sortie ou de Chasse aux Archontes, quand il est connu. |
| `selectedAt`, `loadingAt`, `startedAt`, `endedAt` | Quand elle a été choisie, a commencé à charger, a commencé et s’est terminée, en millisecondes Unix ; `null` jusque-là. |
| `result` | `succeeded`, `failed` ou `aborted` ; `null` avant la fin, ou quand Warframe ne l’a pas dit. |
| `durationSeconds` | Du début de la partie à la fin, en secondes, à la milliseconde près. |
| `earned` | Les rotations obtenues, `{ rotations, totals }` comme dans [`info.progress`](#infoprogress), pour un type à rotations ; `null` sinon. Gardées après la fin, pour un récapitulatif. |
| `credits` | La prime de fin de mission en crédits, telle que l’écran de fin la verse : pas les crédits ramassés pendant la mission. Nommez-la ainsi (« Prime de fin »). `null` avant la fin, ou quand le jeu ne le dit pas (mission abandonnée). |
| `relic` | La relique que le joueur a équipée pour une Fissure du Néant, dès que le jeu demande de la confirmer, gardée sur la mission terminée ; `null` sinon. Voir ci-dessous. |
| `rewards` | Ce que la mission peut rapporter, pour un widget qui suit `warframe.rewards` ([butin](#butin-warframerewards)) ; `null` sinon. |
| `rewardsPending` | `true` tant que `rewards` vaut `null` pour le moment : la table qui s’applique n’est pas encore connue. `false` sinon. |

`relic` vaut `{ id, name, era, refinement, icon, iconPending, items,
reward }` :

- `name` dans la langue du jeu, `id` le nom anglais en `snake_case`
  (`meso_f5_relic`), `era` l’[ère](#ères-des-fissures-du-néant).
- `refinement` : `intact`, `exceptional`, `flawless` ou `radiant`, nommé
  dans la langue du jeu ([glossaire](#glossaire)) ; `null` quand les mots
  du jeu ne le disent pas.
- `items` : ses six objets, le plus rare d’abord, chacun `{ id, name,
  quantity, rarity, chance, icon, iconPending, category }` : `rarity`
  vaut `common`, `uncommon` ou `rare` ; `chance`, la chance au raffinement
  de la relique, de 0 à 1, `null` quand le raffinement n’est pas connu
  (affichez alors la rareté). Source : les tables de butin de Digital
  Extremes, comme pour le [butin](#butin-warframerewards).
- `reward` : à la fin, l’objet qu’a donné la relique du joueur, l’un des
  `items` ; `null` avant. Warframe n’écrit pas quelle relique de l’escouade
  le joueur a choisie : présentez-le comme « Votre relique : … », jamais
  comme obtenu.
- Sans `warframe.rewards`, ou avant la lecture des tables de butin : le
  nom anglais de DE, aucun objet, aucune image.
- `icon`, `iconPending` : l’image de la relique pour son raffinement,
  comme pour un objet du butin.

Un monde ouvert entré par la porte de son hub (les Plaines d’Eidolon, la
Vallée Orbis, le Puy de Cambion) est une mission `in_progress`, de type
`free_roam`, avec sa faction et les niveaux des ennemis, comme quand on le
choisit sur la carte stellaire. Quand le joueur le quitte (retour au hub,
au vaisseau ou une autre mission), `mission_left` arrive avec lui et
`info.mission` passe à `null` : un monde ouvert n’a ni fin ni
récapitulatif.

`mission_ended` arrive avec les crédits de l’écran de fin, écrits un
instant après la fin : au plus 10 secondes de jeu plus tard, et sans eux
pour une mission abandonnée. Son `at` est la fin elle-même. Warframe
n’écrit pas quel objet une récompense a donné : affichez les rotations
obtenues et les tables d’où elles viennent.

#### `info.progress`

La progression de la dernière mission.

| Membre | Signification |
| --- | --- |
| `wave` | La vague en cours (Défense, Défense miroir), ou `null`. |
| `waveEnemies` | `{ total, left }` : les ennemis de la vague de Défense en cours. `total` comme la vague l’annonce ; `left` comme le jeu les compte, une fois tous apparus puis toutes les 10 secondes environ, `0` une fois la vague nettoyée, `null` avant. `null` avant la première vague. |
| `round` | Les manches terminées (Interception, Perturbation), ou `null`. |
| `rewards` | Les récompenses de rotation reçues jusqu’ici. |
| `rotation` | `A`, `B` ou `C` : la rotation de la prochaine récompense ; `null` pour un type sans rotations ou que PlayerVox OverCrow ne sait pas compter. |
| `earned` | `{ rotations, totals }` : les rotations reçues, dans l’ordre (les 64 dernières), et combien de chacune, toutes comptées, `{ A, B, C }`. |
| `cycle` | `{ number, rotations, earned }` : le tour de rotations de la prochaine récompense, 1 pour le premier, ses rotations dans l’ordre et combien ont été reçues ; `null` pour une Perturbation et un type sans rotations. Voir [Rotations](#rotations). |
| `clock` | Pour un type payé au temps (Survie) : `waiting` tant que son horloge n’est pas partie, puis `running` ; `null` sinon. |
| `nextRewardAt` | Quand vient la prochaine récompense, en millisecondes Unix, pour un type payé au temps (Survie) une fois son horloge partie ; `null` sinon. |
| `nextRewardWave` | La vague de la prochaine récompense, pour un type payé aux vagues (Défense) ; `null` sinon. |

#### `info.squad`

| Membre | Signification |
| --- | --- |
| `members` | Les membres, utilisateur compris, au plus 8, chacun `{ name, you }`. `name` est le pseudo du joueur sans l’icône de plateforme ; `you` vaut `true` pour l’utilisateur. |

#### `info.eidolons`

| Membre | Signification |
| --- | --- |
| `night` | S’il fait nuit sur les Plaines, tel que le joueur l’a vu en dernier ; `null` avant. |
| `hunts` | Les Eidolons de la nuit, du plus ancien au plus récent, au plus 16. |

Chaque chasse :

| Membre | Signification |
| --- | --- |
| `eidolon` | Quel [Eidolon](#eidolons) ; `null` quand PlayerVox OverCrow ne peut pas le savoir. |
| `spawnedAt` | Quand il est apparu, en millisecondes Unix. |
| `weakpoints` | Les points faibles détruits. |
| `capturedAt`, `killedAt`, `fledAt` | Quand il a été capturé, tué, ou est parti à l’aube ; `null` sinon. |

#### `info.world`

| Membre | Signification |
| --- | --- |
| `updatedAt` | Quand PlayerVox OverCrow l’a lu pour la dernière fois, en millisecondes Unix. |
| `sortie` | La Sortie du jour, `{ boss, faction, endsAt, missions }`, ou `null`. |
| `archonHunt` | La Chasse aux Archontes de la semaine, `{ boss, endsAt, missions, shard }`, ou `null`. `shard` est le Fragment d’Archonte qu’elle donne, `{ id, name, icon, iconPending }` : `id` vaut `azure`, `crimson` ou `amber`, `name` dans la langue du jeu, `icon` son image comme pour un objet du butin ; `null` pour un Archonte que PlayerVox OverCrow ne connaît pas. Qu’il soit amélioré se tire à la récompense et n’est jamais connu avant. |
| `fissures` | Les Fissures du Néant ouvertes, les plus proches de leur fermeture d’abord, au plus 64, chacune `{ node, planet, type, era, steelPath, voidStorm, endsAt }`. `voidStorm` est une Tempête du Néant (Railjack). |
| `cycles` | `{ cetus, vallis, cambion }`, chacun `{ state, endsAt }` : le jour ou la nuit à Cetus et sur les Plaines, le chaud ou le froid dans la Vallée Orbis, Fass ou Vome dans le Puy de Cambion ([états des cycles](#états-des-cycles)) ; `null` pour un cycle que PlayerVox OverCrow ne peut pas connaître. |
| `resets` | `{ daily, weekly }` : la prochaine réinitialisation quotidienne (00:00 UTC) et hebdomadaire (lundi 00:00 UTC), en millisecondes Unix. |
| `voidTrader` | La prochaine visite de Baro Ki’Teer, ou celle en cours, `{ arrivesAt, leavesAt, relay }`, ou `null`. Ce qu’il vend n’est pas donné. |
| `circuit` | Les récompenses du Circuit de la semaine, `{ normal, steelPath, picked }`, quand l’état du monde les donne ; `null` sinon. `picked` vaut `{ normal, steelPath }` : les ID que le joueur a choisis pour la semaine (une Warframe, deux adaptateurs Incarnon Genesis), tels que cette session du jeu les a montrés ; vide d’ici là. Le jeu ne les montre que pendant que PlayerVox OverCrow peut le lire : laissez le joueur corriger un choix à la main, et gardez-le jusqu’au reset hebdomadaire. Le palier atteint n’est pas donné. |
| `nightwave` | La saison en cours des Ondes Nocturnes, `{ endsAt, challenges }`, ou `null`. Chaque défi, ceux du jour d’abord (au plus 16), vaut `{ id, name, kind, standing, endsAt, progressed, completed }` : `kind` vaut `daily`, `weekly` ou `elite` ; `progressed` vaut `true` quand le jeu a montré une progression du défi dans cette session ; `completed` vaut `true` quand le jeu a écrit dans cette session que le défi est terminé. Le jeu ne l’écrit que pendant que PlayerVox OverCrow peut le lire : laissez aussi le joueur cocher un défi à la main, et gardez son choix. |

Les missions de la Sortie et de la Chasse aux Archontes sont
`{ node, planet, type, modifier, typeAtLoading }`, dans l’ordre :
`modifier` est la condition d’une mission de Sortie, `null` dans la Chasse
aux Archontes ; `typeAtLoading` vaut `true` quand le jeu remplace le type
publié, et `type` vaut alors `null` jusqu’au chargement de cette mission.

### Butin (`warframe.rewards`)

Avec `warframe.rewards`, `info.mission.rewards` liste ce que la mission
choisie ou en cours peut rapporter, par table et par rotation, jamais
d’après une table qui n’est pas la sienne :

```text
{ source: "node" | "arbitration" | "nightmare" | "sortie" | "circuit";
  tables: { kind: "mission" | "caches" | "extra" | "round";
            rotation: "A" | "B" | "C" | null;
            items: { id: string; name: string; quantity: number; chance: number;
                     icon: string | null; iconPending: boolean; category: string }[] }[] }
```

- `source` dit à qui sont les tables, et le titre à leur donner :

  | `source` | Tables | Titre conseillé |
  | --- | --- | --- |
  | `node` | Celles du nœud. | « Rotation A »… ou « Récompense de fin » |
  | `arbitration` | Celles de tous les Arbitrages, A, B et C, à la place de celles du nœud. | « Butin d’Arbitrage » |
  | `nightmare` | La récompense d’une mission Cauchemar : la rotation de sa planète (les trois pour un Sauvetage, selon les objectifs), donnée une fois par mission. | « Mod Cauchemar, une fois » |
  | `sortie` | La récompense de la Sortie, sans rotation, donnée après sa troisième mission. | « Récompense de la Sortie, après la 3e mission » |
  | `circuit` | Le Circuit : ce que donne chaque manche (`kind` `round`), sans rotations. Les paliers de la semaine ne sont pas dans les tables de butin. | « Chaque manche » |

- `null`, avec `rewardsPending` à `false` : pas de table pour cette
  mission : un nœud qui n’en a pas (Extermination, mondes ouverts,
  événements), une Chasse aux Archontes, une Cellule de Netra ou
  une Alerte (Digital Extremes n’en publie pas).
- `null`, avec `rewardsPending` à `true` : pas encore connu. Un nœud de la
  Sortie ou de la Chasse aux Archontes du jour, choisi, se départage au
  chargement ; sans l’état du monde ou les tables de butin encore lus, il
  les attend.

- `kind` : `mission`, la table de la mission ; `caches`, les caches d'un
  nœud de Sabotage, d'Extermination ou de Ruche ; `extra`, une table de
  plus du nœud ; `round`, ce que donne chaque manche du Circuit.
- `rotation` : `null` pour une table sans rotation.
- Dans une mission de Fissure du Néant, le butin du nœud reste donné et la
  relique s'ouvre en plus : `rewards` reste les tables du nœud, même
  quand `fissure` n'est pas `null`. Ce que donne la relique équipée est
  dans [`info.mission.relic`](#infomission).
- `items`, **le plus rare d'abord** : de la `chance` la plus faible à la
  plus forte, à chance égale par nom anglais, le même ordre dans toutes
  les langues. Une table garde au plus ses 64 objets les plus rares.
  `id`, le nom anglais en `snake_case`, stable d'une langue à l'autre ;
  `name`, à afficher tel quel, dans la langue du jeu, ou en
  anglais quand PlayerVox OverCrow n'a pas encore la traduction ;
  `quantity`, le nombre donné d'un coup ; `chance`, de 0 à 1, les entrées
  d'un même objet d'une table additionnées.
- `icon` : l'image de l'objet, tirée du Public Export de Digital Extremes,
  une poignée `asset:` d'un carré de 48 px (à afficher avec une
  [`image`](elements.md#image), par exemple en 24 px). `iconPending` vaut
  `true` tant qu'elle peut encore venir : gardez sa place vide, pour que
  rien ne bouge à son arrivée. Avec `icon` à `null` et `iconPending` à
  `false`, aucune image ne viendra (l'objet n'en a pas, ou la source ne
  répond pas) : affichez votre propre icône de sa `category` (`relic`,
  `mod`, `resource`, `blueprint`, `warframe_part`, `weapon_part`,
  `arcane`, `currency`, `other`). Une image peut encore arriver plus
  tard ; `iconPending` ne repasse jamais à `true`.
- **Source** : les tables de butin officielles de Digital Extremes
  (warframe.com/droptables), lues par PlayerVox OverCrow sur le PC du
  joueur une fois par jour et à chaque mise à jour du jeu, tant qu'un
  widget qui suit `warframe.rewards` est ouvert. Affichez la source avec
  les taux, avec ces mots : **« Taux : Digital Extremes, sans
  garantie »** (en anglais : **"Rates: Digital Extremes, no
  guarantees"**).
- **Images** : le Public Export de Digital Extremes
  (content.warframe.com), téléchargé par PlayerVox OverCrow sur le PC du
  joueur, une fois pour chaque objet qu'un widget affiche, et gardé sur
  ce PC. Rien n'est embarqué dans un widget.

### Types d’événements

| Type | Fonctionnalité | Porte |
| --- | --- | --- |
| `mission_selected`, `mission_loading`, `mission_started`, `mission_ended`, `mission_left` | `warframe.mission` | `mission` |
| `wave_started`, `reward_given` | `warframe.progress` | `progress` |
| `night_started`, `day_started` | `warframe.eidolons` | rien de plus |
| `eidolon_spawned`, `weakpoint_destroyed`, `eidolon_captured`, `eidolon_killed`, `eidolon_fled` | `warframe.eidolons` | `eidolon` : la chasse |
| `member_joined`, `member_left` | `warframe.squad` | `member` : `{ name, you }` |
| `location_changed` | `warframe.location` | `location` : le nouveau lieu |

`warframe.world` n’a pas d’événements : lisez `info.world`.

### Ce que PlayerVox OverCrow calcule

Warframe ne dit pas tout ce qu’affiche un widget. PlayerVox OverCrow
calcule :

- **Les rotations**, d’après les récompenses reçues, dans les missions où
  PlayerVox OverCrow les voit ; voir [Rotations](#rotations).
- **La prochaine récompense.** `nextRewardAt` en Survie : toutes les
  5 minutes de l’horloge de la mission, qui part une fois le panneau
  d’alarme piraté : jusque-là `clock` vaut `waiting` et `nextRewardAt`
  `null`. L’horloge part 3,6 secondes après l’état sans fin du jeu (mesuré
  sur une Survie), puis chaque récompense la recale sur celle du jeu.
  `nextRewardWave` en Défense : toutes les 3 vagues ; en Défense miroir,
  toutes les 2.
- **La durée** d’une mission, du début de la partie à la fin.
- **Quel Eidolon.** Teralyste, Gantulyste ou Hydrolyste, déduit de l’ordre de
  la chasse ; `null` quand l’ordre ne permet pas de le savoir.
- **L’étape d’une mission de Sortie ou de Chasse aux Archontes**, seulement
  pour un widget qui suit aussi `warframe.world` ; sinon `stage` vaut
  `null`. L’étape que le jeu écrit quand il l’écrit, sinon le rang du nœud
  dans la liste du jour.
- **Les réinitialisations**, à 00:00 UTC chaque jour et le lundi.

### Rotations

| Mode | Une récompense | Rotations |
| --- | --- | --- |
| Survie | toutes les 5 minutes | A, A, B, C, puis de nouveau |
| Défense | toutes les 3 vagues | A, A, B, C, puis de nouveau |
| Défense miroir | toutes les 2 vagues | A, A, B, C, puis de nouveau |
| Interception | à chaque manche | A, A, B, C, puis de nouveau |
| Cascade du Néant | tous les 4 Exolizers | A, A, B, C, puis de nouveau |
| Perturbation | à chaque manche | selon la manche et les conduits défendus (ci-dessous) |
| Arbitrage (Survie, Défense, Interception) | comme ci-dessus | A, A, B, B, puis C sans fin |

Les Arbitrages, avec les mots du wiki officiel : « After the first four
rotations (AABB), the Arbitration will continue on the C rotation
endlessly. » `cycle` les montre comme un premier tour A, A, B, B, puis des
tours C, C, C, C.

Perturbation, conduits défendus dans la manche :

| Manche | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | A | A | A | B |
| 2 | A | A | B | B |
| 3 | A | B | B | C |
| 4 et suivantes | B | B | C | C |

En Perturbation, `rotation` est ce que paierait la manche en cours avec
les conduits défendus jusqu’ici (au moins un). Source : les pages Mission
Rewards et Arbitrations du wiki officiel.

### Ce qui n’est pas donné

PlayerVox OverCrow ne donne pas les excavatrices d’une Excavation, les
compteurs d’ennemis tués, la progression des missions de Capture, de
Défense Mobile et d’Espionnage, le palier atteint au Circuit, la fin d’un
défi des Ondes Nocturnes, ce que vend Baro Ki’Teer, quel objet une
récompense a donné, ni quelle relique de l’escouade le joueur a choisie
(Warframe ne les écrit pas). Pour ces missions, la mission elle-même est
donnée, et `progress` garde des compteurs `null` et une `rotation`
`null`.

- Le cycle de la Vallée Orbis, pour l’instant : `cycles.vallis` vaut `null`.

### Noms et ID

- Ce qui vient du jeu est nommé dans **la langue du jeu**
  (`session.language`), quelle que soit celle de l’application : nœuds,
  planètes et objets dans les 15 langues de Warframe (d’après l’export
  public de Digital Extremes), nos autres noms et le glossaire en anglais
  et en français, en anglais pour les autres langues du jeu. Avant qu’une
  session la dise, la dernière langue du jeu, puis celle de
  l’application. Les ID ne changent jamais ; quand la langue du jeu
  change, les mêmes ID arrivent avec les nouveaux noms. Un nom tient sur
  une ligne, 128 octets au plus.
- Les textes propres au widget restent dans la langue de l’application :
  seuls les mots du jeu suivent le jeu. N’écrivez jamais vous-même un mot
  du jeu : prenez-le dans les données ou dans le [glossaire](#glossaire).
- Un nom que PlayerVox OverCrow ne connaît pas encore, comme un nouveau
  contenu, vaut `null` avec son ID : affichez l’ID, ou rien.
- Nos ID sont en `snake_case` et ne changent jamais. Les listes ci-dessous
  les donnent tous, avec leur nom anglais.
- Un nœud garde la clé propre au jeu, comme `SolNode195` : la clé
  qu’utilisent les données publiques comme les tables de butin et l’état
  du monde.
- Les récompenses du Circuit ont aussi des ID : leur nom anglais en
  `snake_case` ; affichez leur `name`.

#### Glossaire

`glossary` donne les mots du jeu qu’un widget affiche seuls, dans la
langue du jeu, quelles que soient les fonctionnalités que suit le widget :
`glossary.damage.corrosive`, `glossary.activity.archon_hunt`,
`glossary.term.reactant`. `glossary.language` est la langue de ces mots :
`fr` ou `en` (l’anglais pour les autres langues du jeu). Ses groupes :

| Groupe | ID |
| --- | --- |
| `damage` | `impact`, `puncture`, `slash`, `heat`, `cold`, `electricity`, `toxin`, `blast`, `corrosive`, `gas`, `magnetic`, `radiation`, `viral` |
| `era` | les [ères des Fissures du Néant](#ères-des-fissures-du-néant) |
| `fissure` | une Fissure du Néant de chaque ère, par l’ID de l’ère : `lith` est « Lith Fissure » |
| `activity` | `sortie`, `archon_hunt`, `netracells`, `circuit`, `nightwave`, `baro_ki_teer`, `void_fissure`, `arbitration`, `steel_path`, `void_storm` |
| `place` | les [lieux](#lieux) |
| `eidolon` | les [Eidolons](#eidolons) |
| `faction` | les [factions](#factions) |
| `cycle` | les [états des cycles](#états-des-cycles) |
| `term` | `reactant`, `relic`, `credits` |
| `refinement` | `intact`, `exceptional`, `flawless`, `radiant` : les raffinements d’une relique |
| `icons` | `damage` : le symbole de chaque type de dégâts, par les mêmes ID |

`glossary.icons.damage.<id>` est le symbole d'un type de dégâts, tiré du
wiki officiel de Warframe (wiki.warframe.com) : une poignée `asset:` d'un
carré de 72 px dont le symbole occupe les 64 px du milieu ; affichez-le
en 22 px pour un symbole de 20 px. Les symboles pâles (`impact`,
`puncture`, `slash`, `radiation`) ont un halo sombre très doux qui les
garde lisibles sur un fond clair. Il vaut `null` tant que PlayerVox
OverCrow ne l'a pas (téléchargé une fois sur le PC du joueur, relu tous
les 30 jours), ou si le wiki ne répond pas : affichez votre propre icône
à sa place.

Noms anglais : les types de dégâts comme leurs ID (Impact, Puncture,
Slash, Heat, Cold, Electricity, Toxin, Blast, Corrosive, Gas, Magnetic,
Radiation, Viral) ; les activités Sortie, Archon Hunt, Netracells, The
Circuit, Nightwave, Baro Ki'Teer, Void Fissure, Arbitration, The Steel
Path, Void Storm ; les termes Reactant, Relic, Credits ; les raffinements
Intact, Exceptional, Flawless, Radiant.

#### Planètes et régions

| ID | Nom anglais |
| --- | --- |
| `mercury` | Mercury |
| `venus` | Venus |
| `earth` | Earth |
| `mars` | Mars |
| `jupiter` | Jupiter |
| `saturn` | Saturn |
| `uranus` | Uranus |
| `neptune` | Neptune |
| `pluto` | Pluto |
| `ceres` | Ceres |
| `eris` | Eris |
| `sedna` | Sedna |
| `europa` | Europa |
| `void` | Void |
| `phobos` | Phobos |
| `deimos` | Deimos |
| `lua` | Lua |
| `kuva_fortress` | Kuva Fortress |
| `zariman` | Zariman |
| `duviri` | Duviri |
| `hollvania` | Höllvania |
| `dark_refractory` | Dark Refractory |

#### Types de mission

| ID | Nom anglais |
| --- | --- |
| `assassination` | Assassination |
| `extermination` | Extermination |
| `survival` | Survival |
| `rescue` | Rescue |
| `sabotage` | Sabotage |
| `capture` | Capture |
| `spy` | Spy |
| `defense` | Defense |
| `mobile_defense` | Mobile Defense |
| `interception` | Interception |
| `hijack` | Hijack |
| `hive` | Hive |
| `excavation` | Excavation |
| `infested_salvage` | Infested Salvage |
| `rathuum` | Rathuum |
| `junction` | Junction |
| `pursuit` | Pursuit |
| `rush` | Rush |
| `assault` | Assault |
| `defection` | Defection |
| `free_roam` | Free Roam |
| `disruption` | Disruption |
| `void_flood` | Void Flood |
| `void_cascade` | Void Cascade |
| `void_armageddon` | Void Armageddon |
| `netracell` | Netracell |
| `alchemy` | Alchemy |
| `circuit` | The Circuit |
| `ascension` | Ascension |
| `legacyte_harvest` | Legacyte Harvest |
| `shrine_defense` | Shrine Defense |

#### Factions

| ID | Nom anglais |
| --- | --- |
| `grineer` | Grineer |
| `corpus` | Corpus |
| `infested` | Infested |
| `corrupted` | Corrupted |
| `sentient` | Sentient |
| `narmer` | Narmer |
| `murmur` | The Murmur |
| `scaldra` | Scaldra |
| `techrot` | Techrot |
| `tenno` | Tenno |

#### Ères des Fissures du Néant

| ID | Nom anglais |
| --- | --- |
| `lith` | Lith |
| `meso` | Meso |
| `neo` | Neo |
| `axi` | Axi |
| `requiem` | Requiem |
| `omnia` | Omnia |

#### Lieux

Villes, relais et mondes ouverts : `location.place` et `voidTrader.relay`.

| ID | Nom anglais |
| --- | --- |
| `drifter_camp` | Drifter's Camp |
| `larunda_relay` | Larunda Relay |
| `vesper_relay` | Vesper Relay |
| `strata_relay` | Strata Relay |
| `kronia_relay` | Kronia Relay |
| `orcus_relay` | Orcus Relay |
| `cetus` | Cetus |
| `fortuna` | Fortuna |
| `necralisk` | Necralisk |
| `sanctum_anatomica` | Sanctum Anatomica |
| `chrysalith` | Chrysalith |
| `hollvania_central_mall` | Höllvania Central Mall |
| `maroos_bazaar` | Maroo's Bazaar |
| `iron_wake` | Iron Wake |
| `plains_of_eidolon` | Plains of Eidolon |
| `orb_vallis` | Orb Vallis |
| `cambion_drift` | Cambion Drift |

#### Eidolons

| ID | Nom anglais |
| --- | --- |
| `teralyst` | Teralyst |
| `gantulyst` | Gantulyst |
| `hydrolyst` | Hydrolyst |

#### États des cycles

| ID | Nom anglais |
| --- | --- |
| `day` | Day |
| `night` | Night |
| `warm` | Warm |
| `cold` | Cold |
| `fass` | Fass |
| `vome` | Vome |

#### Modificateurs

| ID | Nom anglais |
| --- | --- |
| `steel_path` | Steel Path |
| `arbitration` | Arbitration |
| `sortie` | Sortie |
| `archon_hunt` | Archon Hunt |
| `nightmare` | Nightmare |
| `void_storm` | Void Storm |
| `alert` | Alert |
| `lich` | Kuva Lich |

#### Conditions de Sortie

| ID | Nom anglais |
| --- | --- |
| `energy_reduction` | Energy Reduction |
| `augmented_armor` | Augmented Enemy Armor |
| `augmented_shields` | Augmented Enemy Shields |
| `eximus_stronghold` | Eximus Stronghold |
| `impact_enhancement` | Enemy Physical Enhancement: Impact |
| `puncture_enhancement` | Enemy Physical Enhancement: Puncture |
| `slash_enhancement` | Enemy Physical Enhancement: Slash |
| `heat_enhancement` | Enemy Elemental Enhancement: Heat |
| `cold_enhancement` | Enemy Elemental Enhancement: Cold |
| `electricity_enhancement` | Enemy Elemental Enhancement: Electricity |
| `toxin_enhancement` | Enemy Elemental Enhancement: Toxin |
| `blast_enhancement` | Enemy Elemental Enhancement: Blast |
| `corrosive_enhancement` | Enemy Elemental Enhancement: Corrosive |
| `gas_enhancement` | Enemy Elemental Enhancement: Gas |
| `magnetic_enhancement` | Enemy Elemental Enhancement: Magnetic |
| `radiation_enhancement` | Enemy Elemental Enhancement: Radiation |
| `viral_enhancement` | Enemy Elemental Enhancement: Viral |
| `radiation_hazard` | Radiation Hazard |
| `electromagnetic_anomalies` | Electromagnetic Anomalies |
| `dense_fog` | Dense Fog |
| `fire` | Fire |
| `cryogenic_leakage` | Cryogenic Leakage |
| `extreme_cold` | Extreme Cold |
| `secondary_only` | Secondary Only |
| `shotgun_only` | Shotgun Only |
| `sniper_only` | Sniper Only |
| `assault_rifle_only` | Assault Rifle Only |
| `melee_only` | Melee Only |
| `bow_only` | Bow Only |

#### Boss

| ID | Nom anglais |
| --- | --- |
| `captain_vor` | Captain Vor |
| `vay_hek` | Councilor Vay Hek |
| `sargas_ruk` | General Sargas Ruk |
| `kela_de_thaym` | Kela De Thaym |
| `lech_kril` | Lieutenant Lech Kril |
| `tyl_regor` | Tyl Regor |
| `alad_v` | Alad V |
| `ambulas` | Ambulas |
| `hyena_pack` | The Hyena Pack |
| `jackal` | Jackal |
| `nef_anyo` | Nef Anyo |
| `raptor` | The Raptor |
| `phorid` | Phorid |
| `lephantis` | Lephantis |
| `mutalist_alad_v` | Mutalist Alad V |
| `corrupted_vor` | Corrupted Vor |
| `archon_amar` | Archon Amar |
| `archon_nira` | Archon Nira |
| `archon_boreal` | Archon Boreal |

## Confidentialité

Les événements de jeu ne sont pas sensibles, pseudos du joueur et de son
escouade compris. Un widget qui les suit peut aussi déclarer le réseau, et
donc envoyer ce qu’il reçoit à son serveur. Le joueur voit chaque
fonctionnalité avant d’installer le widget, et la politique de
confidentialité du widget dit ce qu’il envoie. Voir
[la sécurité](security.md#permissions-et-consentement).

Les images du jeu viennent de Digital Extremes (images des objets) et du
wiki officiel de Warframe (symboles des dégâts) : PlayerVox OverCrow les
télécharge lui-même sur le PC du joueur, sans aucun identifiant, et les
garde sur ce PC. Un widget n’en reçoit que des poignées.

## Tests

Dans un [scénario](testing.md#scénarios), une étape `gameEvents` dit ce que
le jeu raconte, avec les mots du service : vous n’écrivez jamais rien du
jeu lui-même. Voici le scénario de l’exemple : une mission de Défense se
charge, la vague 5 commence, puis la mission réussit.

<!-- source: docs/content/examples/warframe-mission/tests/mission.scenario.json -->
```json
  "steps": [
    { "expect": { "state": "running", "text": ["No mission yet"] } },
    { "gameEvents": { "warframe": {
      "info": { "mission": {
        "state": "loading",
        "node": { "id": "SolNode195", "name": "Hydron" },
        "planet": { "id": "sedna", "name": "Sedna" },
        "type": { "id": "defense", "name": "Defense" },
        "faction": { "id": "grineer", "name": "Grineer" }
      } },
      "event": "mission_loading"
    } } },
    { "expect": { "text": ["Hydron", "Defense"] } },
    { "advance": { "ms": 30000 } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "in_progress" }, "progress": { "wave": 5, "rewards": 1, "rotation": "A", "nextRewardWave": 6 } },
      "event": "wave_started"
    } } },
    { "expect": { "text": ["Wave 5", "Rotation A"] } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "ended", "result": "succeeded", "durationSeconds": 312.5 } },
      "event": "mission_ended"
    } } },
    { "expect": { "text": ["Last mission succeeded"], "fault": "none" } }
  ]
```

- Une étape nomme un jeu, ici `warframe`, et ce qui change : `playing`,
  `session`, `features` (un statut par fonctionnalité), `info`, `glossary`
  et `event`.
- Les membres d’`info` se fusionnent dans l’état courant :
  `{ "state": "ended" }` garde le nœud donné avant.
- `event` est un type, ou `{ "type": …, "at": …, <state> }`. Sans son
  état, l’événement porte le membre d’`info` correspondant. Sans `at`, son
  heure est l’heure courante du scénario.
- Le scénario complète ce qu’une étape omet (`null`, `[]`, `0`, `false`, ou
  l’heure de l’étape pour une heure), numérote les événements et garde les
  16 derniers, comme le fait PlayerVox OverCrow.
- Avant la première étape, Warframe est joué, les fonctionnalités que liste le
  manifeste sont `available`, les autres `undeclared`, rien n’est connu, et
  le glossaire est en anglais. `fixtures.subscriptions` peut donner à la
  place une première valeur complète (sans `glossary`, elle reçoit
  l’anglais), et une étape `publish` une valeur suivante complète.
- `glossary` se fusionne comme `info` :
  `{ "language": "fr", "damage": { "corrosive": "Corrosif" } }` ne change
  que ces mots. Le `rewards` d’une étape est celui du nœud, sauf s’il
  donne `source` ; un objet sans `icon`, `iconPending` ni `category` n’a
  pas d’image, aucune à attendre, et le genre `other`.
- Les images sont celles du scénario, dessinées pour le test : déclarez-les
  dans `assets` et nommez-les `fixture:<nom>` là où va une poignée, comme
  `"icon": "fixture:relic"` ou
  `{ "icons": { "damage": { "impact": "fixture:impact" } } }` dans
  `glossary`. Ne mettez jamais les images du jeu dans un widget.
- Chaque étape est vérifiée à la lecture du scénario : une valeur qui n’a pas
  la forme du service est une erreur avec le chemin du premier membre
  fautif, et une étape ne peut toucher que les fonctionnalités que liste le
  manifeste.

Dans un test unitaire, `push("gameEvents.warframe.subscribe", value)`
envoie une valeur complète à la logique ([tests unitaires](testing.md#tests-unitaires)).
