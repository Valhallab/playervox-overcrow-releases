# Événements de jeu

Un widget PlayerVox OverCrow peut suivre ce qui se passe dans un jeu : la
mission où se trouve le joueur, la vague, l’escouade, les Eidolons de la
nuit. Le widget liste dans son manifeste les fonctionnalités qu’il veut, et
PlayerVox OverCrow lui donne leur état, prêt à afficher : des noms dans la
langue de l’utilisateur à côté d’ID stables, des heures en millisecondes
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
| `session` | `{ startedAt }` : quand Warframe a été lancé, en millisecondes Unix ; `null` avant tout lancement. Chaque lancement est une nouvelle session. |
| `features` | Le statut de chaque fonctionnalité : `location`, `mission`, `progress`, `squad`, `eidolons` et `world`. |
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
| `warframe.mission` | La mission choisie, en chargement, en cours ou terminée : nœud, planète, type, faction, niveaux des ennemis, ère de Fissure du Néant, modificateurs, résultat et durée. |
| `warframe.progress` | La progression de la mission : vague, manches, récompenses reçues, rotation de la prochaine récompense et moment où elle vient. |
| `warframe.squad` | Les pseudos du joueur et de son escouade. |
| `warframe.eidolons` | La nuit et le jour sur les Plaines d’Eidolon, et chaque Eidolon de la nuit : apparition, points faibles, capture, mort ou fuite, à la milliseconde. |
| `warframe.world` | Le monde du jour et de la semaine : la Sortie, la Chasse d’Archonte, les Fissures du Néant, les cycles des mondes ouverts, Baro Ki’Teer et les réinitialisations. |

### Quand les données arrivent

- `location`, `mission`, `progress`, `squad` et `eidolons` ne fonctionnent
  que tant que Warframe est le jeu actif dans PlayerVox OverCrow (`playing`
  vaut `true`). Quand Warframe se ferme, `playing` passe à `false` et
  `location` à `null` ; les autres membres gardent leurs dernières valeurs
  jusqu’à la session suivante.
- `world` vient de l’état du monde public de Warframe. PlayerVox OverCrow
  le lit toutes les 5 minutes tant qu’un widget qui le suit tourne, que
  Warframe soit joué ou non. `updatedAt` dit quand il a été lu.
- Warframe dit à PlayerVox OverCrow ce qui se passe avec quelques secondes
  de retard : 10 secondes environ, parfois 15 à 25. Les heures restent
  exactes à la milliseconde ; seule la mise à jour arrive plus tard.
  Comptez à partir des heures, comme `nextRewardAt`, pas du moment où
  arrive une mise à jour.
- Quand PlayerVox OverCrow démarre pendant une session de Warframe, il
  rattrape la session depuis son début : `info` aussitôt, et les derniers
  événements avec leurs heures réelles.

### `info`

Les éléments nommés sont `{ id, name }` : notre ID stable, et le nom dans
la langue de l’utilisateur. Un nœud est `{ id, name, englishName }` ; voir
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
| `node` | Le nœud : `{ id, name, englishName }`. |
| `planet` | Sa [planète ou sa région](#planètes-et-régions). |
| `type` | Le [type de mission](#types-de-mission) ; `null` pour un type absent de la liste. |
| `faction` | La [faction](#factions) ennemie. |
| `enemyLevel` | `{ min, max }` : les niveaux des ennemis du nœud, ou `null`. |
| `fissure` | L’[ère](#ères-des-fissures-du-néant) d’une mission de Fissure du Néant, ou `null`. |
| `modifiers` | Ce qui modifie la mission, au plus 8, chacun `{ id, name, stage }` ([modificateurs](#modificateurs)). `stage` vaut 1 à 3 pour une mission de Sortie ou de Chasse d’Archonte, quand il est connu. |
| `selectedAt`, `loadingAt`, `startedAt`, `endedAt` | Quand elle a été choisie, a commencé à charger, a commencé et s’est terminée, en millisecondes Unix ; `null` jusque-là. |
| `result` | `succeeded`, `failed` ou `aborted` ; `null` avant la fin, ou quand Warframe ne l’a pas dit. |
| `durationSeconds` | Du début de la partie à la fin, en secondes, à la milliseconde près. |

#### `info.progress`

La progression de la dernière mission.

| Membre | Signification |
| --- | --- |
| `wave` | La vague en cours (Défense, Défense miroir), ou `null`. |
| `round` | Les manches terminées (Interception, Perturbation), ou `null`. |
| `rewards` | Les récompenses de rotation reçues jusqu’ici. |
| `rotation` | `A`, `B` ou `C` : la rotation de la prochaine récompense ; `null` pour un type sans rotations ou que PlayerVox OverCrow ne sait pas compter. |
| `nextRewardAt` | Quand vient la prochaine récompense, en millisecondes Unix, pour un type payé au temps (Survie) ; `null` sinon. |
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
| `archonHunt` | La Chasse d’Archonte de la semaine, `{ boss, endsAt, missions }`, ou `null`. |
| `fissures` | Les Fissures du Néant ouvertes, les plus proches de leur fermeture d’abord, au plus 64, chacune `{ node, planet, type, era, steelPath, voidStorm, endsAt }`. `voidStorm` est une Tempête du Néant (Railjack). |
| `cycles` | `{ cetus, vallis, cambion }`, chacun `{ state, endsAt }` : le jour ou la nuit à Cetus et sur les Plaines, le chaud ou le froid dans la Vallée Orbis, Fass ou Vome dans le Gouffre de Cambion ([états des cycles](#états-des-cycles)) ; `null` pour un cycle que PlayerVox OverCrow ne peut pas connaître. |
| `resets` | `{ daily, weekly }` : la prochaine réinitialisation quotidienne (00:00 UTC) et hebdomadaire (lundi 00:00 UTC), en millisecondes Unix. |
| `voidTrader` | La prochaine visite de Baro Ki’Teer, ou celle en cours, `{ arrivesAt, leavesAt, relay }`, ou `null`. Ce qu’il vend n’est pas donné. |
| `circuit` | Les récompenses du Circuit de la semaine, `{ normal, steelPath }`, quand l’état du monde les donne ; `null` sinon. |

Les missions de la Sortie et de la Chasse d’Archonte sont
`{ node, planet, type, modifier }`, dans l’ordre : `modifier` est la
condition d’une mission de Sortie, `null` dans la Chasse d’Archonte.

### Types d’événements

| Type | Fonctionnalité | Porte |
| --- | --- | --- |
| `mission_selected`, `mission_loading`, `mission_started`, `mission_ended` | `warframe.mission` | `mission` |
| `wave_started`, `reward_given` | `warframe.progress` | `progress` |
| `night_started`, `day_started` | `warframe.eidolons` | rien de plus |
| `eidolon_spawned`, `weakpoint_destroyed`, `eidolon_captured`, `eidolon_killed`, `eidolon_fled` | `warframe.eidolons` | `eidolon` : la chasse |
| `member_joined`, `member_left` | `warframe.squad` | `member` : `{ name, you }` |
| `location_changed` | `warframe.location` | `location` : le nouveau lieu |

`warframe.world` n’a pas d’événements : lisez `info.world`.

### Ce que PlayerVox OverCrow calcule

Warframe ne dit pas tout ce qu’affiche un widget. PlayerVox OverCrow
calcule :

- **Les rotations.** Comptées A, A, B, C, puis de nouveau, d’après les
  récompenses reçues, dans les missions où PlayerVox OverCrow les voit,
  comme la Survie, la Défense, l’Interception et la Perturbation.
- **La prochaine récompense.** `nextRewardAt` en Survie : toutes les
  5 minutes, d’après l’horloge de la mission. `nextRewardWave` en Défense :
  toutes les 5 vagues.
- **La durée** d’une mission, du début de la partie à la fin.
- **Quel Eidolon.** Teralyst, Gantulyst ou Hydrolyst, déduit de l’ordre de
  la chasse ; `null` quand l’ordre ne permet pas de le savoir.
- **L’étape d’une mission de Sortie ou de Chasse d’Archonte**, seulement
  pour un widget qui suit aussi `warframe.world` ; sinon `stage` vaut
  `null`.
- **Les réinitialisations**, à 00:00 UTC chaque jour et le lundi.

### Ce qui n’est pas donné

PlayerVox OverCrow ne donne pas les excavatrices d’une Excavation, les
compteurs d’ennemis tués, la progression des missions de Capture, de
Défense mobile et d’Espionnage, la progression du Circuit, les reliques,
Nightwave ni ce que vend Baro Ki’Teer. Pour ces missions, la mission
elle-même est donnée, et `progress` garde des compteurs `null` et une
`rotation` `null`.

### Noms et ID

- `name` est dans la langue de l’application, anglais ou français, et
  change avec elle ; les ID ne changent pas. Un nom tient sur une ligne,
  128 octets au plus.
- Un nom que PlayerVox OverCrow ne connaît pas encore, comme un nouveau
  contenu, vaut `null` avec son ID : affichez l’ID, ou rien.
- Nos ID sont en `snake_case` et ne changent jamais. Les listes ci-dessous
  les donnent tous, avec leur nom anglais.
- Un nœud garde la clé propre au jeu, comme `SolNode195` : la clé
  qu’utilisent les données publiques comme les tables de butin et l’état
  du monde. Son `englishName` donne son nom anglais, pour le croiser avec
  des données publiques en anglais.
- Les boss, les conditions de Sortie et les récompenses du Circuit ont
  aussi des ID stables, non listés ici : affichez leur `name`.

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
| `orphix` | Orphix |
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

## Confidentialité

Les événements de jeu ne sont pas sensibles, pseudos du joueur et de son
escouade compris. Un widget qui les suit peut aussi déclarer le réseau, et
donc envoyer ce qu’il reçoit à son serveur. Le joueur voit chaque
fonctionnalité avant d’installer le widget, et la politique de
confidentialité du widget dit ce qu’il envoie. Voir
[la sécurité](security.md#permissions-et-consentement).

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
        "node": { "id": "SolNode195", "name": "Hydron", "englishName": "Hydron" },
        "planet": { "id": "sedna", "name": "Sedna" },
        "type": { "id": "defense", "name": "Defense" },
        "faction": { "id": "grineer", "name": "Grineer" }
      } },
      "event": "mission_loading"
    } } },
    { "expect": { "text": ["Hydron", "Defense"] } },
    { "advance": { "ms": 30000 } },
    { "gameEvents": { "warframe": {
      "info": { "mission": { "state": "in_progress" }, "progress": { "wave": 5, "rotation": "A", "nextRewardWave": 5 } },
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
  `session`, `features` (un statut par fonctionnalité), `info` et `event`.
- Les membres d’`info` se fusionnent dans l’état courant :
  `{ "state": "ended" }` garde le nœud donné avant.
- `event` est un type, ou `{ "type": …, "at": …, <state> }`. Sans son
  état, l’événement porte le membre d’`info` correspondant. Sans `at`, son
  heure est l’heure courante du scénario.
- Le scénario complète ce qu’une étape omet (`null`, `[]`, `0`, `false`, ou
  l’heure de l’étape pour une heure), numérote les événements et garde les
  16 derniers, comme le fait PlayerVox OverCrow.
- Avant la première étape, Warframe est joué, les fonctionnalités que liste le
  manifeste sont `available`, les autres `undeclared`, et rien n’est connu.
  `fixtures.subscriptions` peut donner à la place une première valeur
  complète, et une étape `publish` une valeur suivante complète.
- Chaque étape est vérifiée à la lecture du scénario : une valeur qui n’a pas
  la forme du service est une erreur avec le chemin du premier membre
  fautif, et une étape ne peut toucher que les fonctionnalités que liste le
  manifeste.

Dans un test unitaire, `push("gameEvents.warframe.subscribe", value)`
envoie une valeur complète à la logique ([tests unitaires](testing.md#tests-unitaires)).
