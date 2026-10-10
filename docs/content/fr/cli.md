# L’outil en ligne de commande

`overcrow-widget` crée, vérifie et empaquette les widgets PlayerVox
OverCrow, les exécute dans OverCrow pendant que vous les écrivez, et les
teste. C’est un seul programme pour Linux et Windows. Il contient les mêmes
validateurs que ceux qu’OverCrow exécute quand il installe et démarre un
widget : un paquet qu’il accepte est un paquet qu’OverCrow lit.

```sh
overcrow-widget init my-widget --template counter --id nova.my-widget
cd my-widget
overcrow-widget check
overcrow-widget package
overcrow-widget inspect dist/nova.my-widget-0.1.0.ocpkg
overcrow-widget doctor
overcrow-widget dev
overcrow-widget test
```

| Commande | Rôle |
| --- | --- |
| [`init`](#init) | Crée un projet à partir d’un template. |
| [`check`](#check) | Valide un projet sans rien écrire. |
| [`package`](#package) | Vérifie, puis écrit le paquet `.ocpkg`. |
| [`inspect`](#inspect) | Montre ce qu’un paquet contient et demande. |
| [`dev`](#dev) | Exécute le widget dans OverCrow et le recharge à chaque enregistrement. |
| [`test`](#test) | Joue les scénarios de test du projet et compare leurs images. |
| [`doctor`](#doctor) | Indique ce que votre installation a et ce qui lui manque. |
| [`admit`](#admit) | Exécute l’admission de l’espace créateurs sur vos sources, un dossier ou un ZIP. |
| [`diff`](#diff) | Compare deux versions des sources d’un widget. |
| [`submit`](#submit) | Envoie une version à l’espace créateurs avec une clé de publication, et suit ses contrôles. |
| [`status`](#status) | Montre les versions d’un widget, leurs contrôles et leur revue. |

Chaque commande prend le dossier du projet en argument ; sans argument,
elle utilise le dossier courant. La [sortie lisible par un programme](#sortie-lisible-par-un-programme)
et les [codes de sortie](#codes-de-sortie) sont stables pour vos scripts.

## Installation

Chaque [release d’OverCrow](https://github.com/Valhallab/playervox-overcrow-releases/releases)
contient les outils créateurs dans un ZIP par plateforme : l’outil avec
sa licence et ses notices tierces, le runtime headless d’OverCrow
qu’utilise [`test`](#test), un `README.txt` et un `SHA256SUMS` de tous
les fichiers.

| Plateforme | ZIP | Outil dans le ZIP |
| --- | --- | --- |
| Linux x86-64 | `overcrow-creator-tools-VERSION-linux-x86_64.zip` | `overcrow-widget-VERSION-linux-x86_64` |
| Windows x64 | `overcrow-creator-tools-VERSION-windows-x86_64.zip` | `overcrow-widget-VERSION-windows-x86_64.exe` |

Décompressez-le, vérifiez les fichiers, renommez l’outil `overcrow-widget`
(`overcrow-widget.exe` sous Windows), rendez-le exécutable sous Linux
(`chmod +x`) et placez-le dans votre `PATH`. Il n’a besoin de rien d’autre
pour vérifier et empaqueter un widget. `overcrow-widget --version` donne sa
version et celle du SDK qu’il embarque.

```sh
unzip overcrow-creator-tools-VERSION-linux-x86_64.zip
cd overcrow-creator-tools-VERSION-linux-x86_64
sha256sum --check SHA256SUMS
install -m 755 overcrow-widget-*-linux-x86_64 ~/.local/bin/overcrow-widget
```

L’outil se compile aussi avec Rust depuis le
[dépôt public](https://github.com/Valhallab/playervox-overcrow-releases) ;
le dépôt épingle la toolchain nécessaire. Le programme est alors
`target/dist/overcrow-widget`.

```sh
cargo build -p overcrow-widget-cli --profile dist --locked
```

### Les types du SDK

`check` vérifie les types de votre logique avec le TypeScript du projet, si
Node.js 22 ou plus récent et `node_modules/typescript` sont présents. Sinon,
il signale par un avertissement que les types n’ont pas été vérifiés
(`typecheck.skipped`) et continue. Le SDK lui-même est inclus dans l’outil :
l’empaquetage ne dépend donc jamais de `node_modules`.

`@overcrow/sdk` est sur [npm](https://www.npmjs.com/package/@overcrow/sdk).
Le `package.json` d’un projet créé par `init` nomme TypeScript et la version
du SDK que l’outil embarque : lancez `npm install` dans le projet. Dans un
autre projet, installez le SDK avec :

```sh
npm install --save-dev --save-exact @overcrow/sdk@1.0.0
```

Gardez la version que l’outil embarque (`overcrow-widget --version`).
`overcrow-widget doctor` signale l’absence de TypeScript, ainsi qu’un SDK
dans `node_modules` dont la version diffère de celle que l’outil embarque.

## Fichiers d’un projet

| Fichier | Rôle | Empaqueté |
| --- | --- | --- |
| `manifest.json` | [Le manifeste](manifest.md), empaqueté tel quel. | oui |
| `view.ocml` | [La vue](view.md), compilée en `view.json`. | compilé |
| `style.ocss` | [Le style](style.md) ; facultatif. | oui |
| `logic.ts` ou `logic.js` | [La logique](logic.md), un seul module ; regroupée avec le SDK dans `logic.js`. | regroupé |
| `locales/en.json`, `locales/fr.json` | [Les messages](logic.md#messages) ; les deux fichiers ou aucun, avec les mêmes clés. | oui |
| `LICENSE` | Le texte de la licence du paquet. Les templates partent de la licence MIT ; choisissez la vôtre. | oui |
| `assets/` | Images PNG, JPEG ou WebP ; facultatif. Les fichiers cachés (`.DS_Store`) et ce que les outils créateurs n’envoient jamais (`dist/`…) sont ignorés, comme dans les [archives de sources](#archives-de-sources). | oui |
| `package.json`, `tsconfig.json` | Outillage uniquement : TypeScript et les types du SDK. | non |
| `listing.json` | Le texte de marketplace d’une [soumission](publishing.md#la-fiche) ; lu par `admit`. Dans l’espace créateurs, où la fiche se modifie, une simple proposition d’import. | non |
| `tests/` | Les [scénarios](testing.md#scénarios) (`tests/<name>.scenario.json`), leurs images de référence (`tests/reference/`) et vos tests unitaires. `tests/output/` contient les images des exécutions en échec. | non |

## init

```sh
overcrow-widget init my-widget --template list --id nova.my-widget --name "My widget"
```

Écrit un nouveau projet dans le dossier, qui ne doit pas exister ou doit
être vide : `init` n’écrase jamais un fichier.

| Template | Montre |
| --- | --- |
| `blank` (par défaut) | Un titre tiré des messages et un état vide. |
| `counter` | Une valeur et deux boutons dont la logique exporte les gestionnaires. |
| `list` | Une liste de tâches à clés : `for`, gestionnaires avec arguments, `t()` avec paramètres. |
| `chart` | Un graphique en direct, mis à jour par un minuteur. |

Passez `--id` avec l’ID de votre widget : `<pseudo>.<nom>`, votre pseudo
d’éditeur dans l’espace créateurs d’OverCrow et un nom (`nova.lol-timers`),
ou un domaine que vous avez vérifié, inversé, et un nom
(`gg.nova.lol-timers`) ; voir [le manifeste](manifest.md#identité-et-version).
Sans `--id`, l’ID vaut `yourhandle.<dir>` : remplacez `yourhandle` avant
d’envoyer le widget, car `admit` le refuse. `com.playervox.*` est réservé.
Chaque template est livré avec un scénario de test,
`tests/example.scenario.json` ; `counter`, `list` et `chart` fournissent
aussi ses images de référence.

## check

```sh
overcrow-widget check
overcrow-widget check --deny-warnings --format json
```

Exécute toutes les vérifications, dans cet ordre, et n’écrit rien :

1. **Fichiers du projet** : les fichiers requis sont présents et respectent
   leurs limites de taille, il y a un seul module de logique, et les deux
   fichiers de langue ou aucun.
2. **Manifeste** : le validateur de manifeste d’OverCrow lui-même.
3. **Vue** : `view.ocml` est compilé et le résultat validé ; les images
   statiques doivent exister dans `assets/`.
4. **Style** : `style.ocss` est analysé avec l’analyseur syntaxique
   d’OverCrow.
5. **Fichiers de langue** : des objets de chaînes aux clés valides, avec les
   mêmes clés dans les deux fichiers. Un `t("key")` de la vue dont la clé
   n’a pas de message donne un avertissement.
6. **Logique** : son
   [analyse statique](logic.md#ce-que-la-logique-ne-peut-pas-utiliser), et
   les exports que la vue appelle.
7. **Types** : le `tsc --noEmit -p tsconfig.json` du projet.
8. **Paquet** : `logic.js` est construit, puis le paquet est écrit en
   mémoire et relu exactement comme OverCrow le lira.

Options : `--no-typecheck`, `--deny-warnings` (un avertissement fait échouer
la commande), `--format json`.

## package

```sh
overcrow-widget package
overcrow-widget package --out build/my-widget.ocpkg
```

Exécute `check`, puis écrit le paquet dans `dist/<id>-<version>.ocpkg`, ou
à l’emplacement donné par `--out`. La commande affiche le chemin, la taille
et le SHA-256 de l’archive.

Avec `--source-map FILE`, elle écrit aussi dans ce fichier
[la carte du code](#la-carte-du-code) de `logic.js`. La carte n’entre
jamais dans le paquet : le paquet est le même avec ou sans elle.

L’empaquetage est déterministe : les mêmes sources et la même version de
l’outil donnent les mêmes octets à chaque exécution et sur tous les
systèmes. Le contenu du paquet est décrit dans [le paquet](package.md).

## inspect

```sh
overcrow-widget inspect dist/nova.my-widget-0.1.0.ocpkg
```

Valide un paquet comme le fait OverCrow, puis le montre tel qu’un relecteur
le voit : l’ID, la version et les noms ; la taille et le SHA-256 de
l’archive ; la version du SDK que contient son `logic.js` ; chaque
permission en toutes lettres (routes réseau avec les contraintes de leurs
paramètres et la limite de réponse déclarée, stockage, presse-papiers,
événements de jeu) ; chaque capability avec son résumé, en précisant si
elle est sensible ou demande un compte ; le nombre de lignes du menu ; et
chaque fichier avec sa taille et son SHA-256. Quand OverCrow refuserait le
paquet, la commande le signale à la place, avec la raison.

## dev

```sh
overcrow-widget dev
```

Exécute le widget dans l’overlay OverCrow qui tourne sur votre machine,
pendant que vous le modifiez :

1. la commande se connecte à l’overlay, qui doit avoir été lancé avec les
   installations de développement autorisées ;
2. elle construit le paquet comme le fait `package` et l’envoie à l’overlay,
   qui le valide entièrement et l’affiche avec la mention
   **Unverified · development package**, les permissions de son manifeste
   étant accordées pour la session seulement ;
3. elle surveille les fichiers du projet et, 200 ms après la dernière
   modification, reconstruit et recharge le widget. Une construction en
   erreur n’est pas envoyée : le widget continue de s’exécuter avec sa
   dernière construction valide ;
4. elle affiche ce que l’overlay rapporte : les états du widget (`starting`,
   `running`, `restarting` avec l’échec, `failed`…) et les sorties `log.*`
   de sa logique ;
5. sur **Ctrl+C**, elle retire le widget de l’overlay.

Options : `--no-typecheck`, `--format json` (un objet JSON par ligne).
Codes de sortie : 0 après Ctrl+C, 1 quand l’overlay met fin à la session,
2 quand aucun overlay n’est joignable.
[Le canal de développement](dev-channel.md) explique comment lancer OverCrow
pour cela, et ce que signifient chaque état et chaque refus.

## test

```sh
overcrow-widget test
overcrow-widget test --scenario example
overcrow-widget test --update
```

Joue les scénarios de `tests/` dans le runtime headless d’OverCrow et
compare les images qu’il rend avec les références :

1. la commande construit le paquet comme le fait `package` ;
2. elle lit chaque `tests/<name>.scenario.json` et le vérifie par rapport au
   manifeste avant toute exécution ; une erreur dans un scénario donne un
   diagnostic `test.scenario` dans son fichier ;
3. elle exécute chaque scénario dans le [runtime headless](testing.md#le-runtime-headless)
   que l’outil épingle, ou celui donné par `--runtime`, et affiche la
   version et le SHA-256 de ce runtime. La première fois, elle télécharge
   le runtime épinglé ;
4. elle compare chaque image capturée avec
   `tests/reference/<name>/<image>.png`. Une différence, un changement de
   taille ou une référence manquante fait échouer le scénario et écrit
   `tests/output/<name>/<image>.actual.png` et, pour une différence,
   `<image>.diff.png`.

Options : `--runtime <path>` (un autre programme `overcrow-widget-headless`),
`--offline` (ne jamais télécharger le runtime), `--scenario <name>` (ce scénario seulement), `--update` (enregistre les
images capturées comme références : examinez-les avant de les commiter),
`--format json`, `--no-typecheck`.

Codes de sortie : 0 quand tous les scénarios ont réussi, 1 quand l’un d’eux
a échoué, 2 quand aucun runtime ne peut s’exécuter. Les scénarios sont
décrits dans [tester un widget](testing.md).

## doctor

```sh
overcrow-widget doctor
```

| Ligne | Ce qui est vérifié |
| --- | --- |
| `cli`, `sdk` | La version de l’outil, son API de widgets et le `@overcrow/sdk` qu’il embarque. |
| `platform` | Le système d’exploitation et l’architecture. |
| `overcrow` | Un OverCrow installé. |
| `development` | Un overlay en cours d’exécution qui autorise les installations de développement, et sa version. |
| `node`, `typescript`, `project sdk` | Dans un projet de widget : Node.js dans le `PATH`, `node_modules/typescript` et la version de `node_modules/@overcrow/sdk`. |

| Code | Sévérité | Signification |
| --- | --- | --- |
| `doctor.overcrow_missing` | avertissement | OverCrow n’est pas installé. |
| `doctor.development_off` | avertissement | Aucun overlay n’autorise les installations de développement ; l’aide donne les commandes pour relancer OverCrow en les autorisant. |
| `doctor.channel_busy` | avertissement | L’overlay sert déjà son nombre maximal de sessions `dev`. |
| `doctor.channel_io` | avertissement | La connexion à l’overlay a échoué. |
| `doctor.channel_untrusted` | erreur | Ce qui répond n’est pas l’overlay de cet utilisateur. |
| `doctor.protocol_version` | erreur | L’overlay et l’outil ne parlent pas la même version du canal de développement. |
| `doctor.node_missing`, `doctor.node_version` | avertissement | Pas de Node.js, ou une version antérieure à la 22 : `check` ne peut pas vérifier les types. |
| `doctor.typescript_missing`, `doctor.sdk_missing` | avertissement | TypeScript ou les types du SDK ne sont pas installés dans le projet. |
| `doctor.sdk_version` | avertissement | `node_modules/@overcrow/sdk` diffère du SDK de l’outil. |

Options : `--format json`, `--deny-warnings`.

## admit

```sh
overcrow-widget admit --publisher nova
overcrow-widget admit lol-timers.zip --publisher nova --previous lol-timers-1.0.0.ocpkg
overcrow-widget admit --publisher nova --package dist/nova.my-widget-0.1.0.ocpkg
```

Exécute l’admission statique que l’espace créateurs fait passer à chaque
version que vous envoyez. Les sources sont le dossier du projet ou un ZIP
de ce dossier, lus comme l’espace créateurs les reçoit
([archives de sources](#archives-de-sources)). La commande n’exécute
jamais votre code ni `tsc` :

1. les sources sont construites comme `package` les construit ;
2. avec `--package`, la vue compilée de cette archive doit être, à l’octet
   près, ce que donne la compilation de `view.ocml` ;
3. l’ID appartient à l’éditeur donné par `--publisher` (ses ID
   `<pseudo>.<nom>` et, avec `--domain`, les ID sous un domaine qu’il a
   vérifié) ; sans `--publisher`, l’ID n’est ni réservé, ni un ID
   d’exemple (`nova.*`, `yourhandle.*`, `gg.nova.*`, `com.example.*`…), ni
   sous un pseudo que personne ne peut prendre (`admin.*`, `com.*`).
   `listing.json` est valide, son aperçu est un PNG empaqueté d’au plus
   256 Kio ;
4. les pouvoirs que le widget demande sont listés pour le relecteur :
   capabilities (les sensibles sont signalées), routes réseau avec leur
   limite de réponse, écritures dans le presse-papiers, stockage et
   événements de jeu ;
5. avec `--previous`, la dernière version approuvée (son `manifest.json`,
   son paquet, son dossier ou son ZIP) : l’ID doit être le même et la
   version supérieure, et le rapport liste les
   [clés de permission](#clés-de-permission) ajoutées, élargies et
   retirées, ainsi que la revue dont la version a besoin.

| Code | Sévérité | Signification |
| --- | --- | --- |
| `admission.reserved_id` | erreur | Un ID `com.playervox.*`, réservé à PlayerVox ; sans `--publisher`, aussi un ID sous un pseudo réservé (`playervox.*`, `admin.*`…). |
| `admission.placeholder_id` | erreur | Un ID d’exemple, sans `--publisher`. |
| `admission.id_not_owned` | erreur | L’ID n’appartient pas à l’éditeur, ou, sans `--publisher`, ne peut appartenir à personne. |
| `admission.listing_missing`, `admission.listing` | erreur | Pas de `listing.json`, ou un fichier qui enfreint les règles de la fiche (un avertissement avec `--listing optional`). |
| `admission.preview` | erreur | `preview` ne désigne pas un PNG empaqueté dans les limites (un avertissement avec `--listing optional`). |
| `admission.license` | erreur | Un widget PlayerVox dont la licence n’est pas MIT (un avertissement avec `--listing optional`). |
| `admission.view_not_reproducible` | erreur | La vue compilée soumise diffère de ce que donne la compilation de `view.ocml`. |
| `admission.previous` | erreur | La version précédente ne peut pas être lue. |
| `admission.previous_mismatch` | erreur | La version précédente est un autre widget. |
| `admission.version_not_newer` | erreur | La version n’est pas supérieure à la précédente. |
| `admission.package_rebuilt` | avertissement | L’archive soumise diffère de la reconstruction dans d’autres fichiers. |
| `admission.not_rebuilt` | avertissement | Une archive a été admise sans ses sources. |

Options : `--publisher HANDLE`, `--domain DOMAIN` (répétable), `--previous
FILE`, `--package FILE`, `--source-map FILE` ([la carte du
code](#la-carte-du-code), écrite quand les sources sont admises), `--out
DIR` (écrit le paquet admis, sa fiche et un rapport dans un dossier vide),
`--format json`, `--deny-warnings`. `admit <file.ocpkg> --listing FILE`
vérifie une archive sans ses sources. Codes de sortie : 0 admis, 1 refusé,
2 pour une erreur d’utilisation ou de fichier. Voir
[publication et revue](publishing.md).

`--listing required|optional` concerne les sources. `required`, par
défaut, refuse des sources sans `listing.json` valide. `optional` est le
mode de l’espace créateurs : la fiche s’y modifie, donc `listing.json` peut
manquer, et un fichier qui pose problème est écarté (aucune fiche dans le
rapport ni dans `--out`) avec des avertissements, au lieu de refuser les
sources.

### Clés de permission

Chaque permission a une clé stable, la même dans l’espace créateurs :

| Clé | Permission |
| --- | --- |
| `network:GET https://api.nova.gg/v1/timers` | Une route réseau : méthode, origine et chemin. |
| `storage` | Le stockage. |
| `clipboardWrite` | Les écritures dans le presse-papiers. |
| `capability:<name>` | Une capability. |
| `gameEvent:<name>` | Un événement de jeu. |

Une clé est *ajoutée* quand la version précédente ne l’avait pas,
*élargie* quand sa route reste mais que sa règle change (contraintes du
chemin ou de la requête, limite de réponse), et *retirée* quand elle
disparaît. Une clé ajoutée ou élargie demande une revue **complète** ;
sinon la revue est **rapide**.

## diff

```sh
overcrow-widget diff lol-timers-1.0.0.zip .
overcrow-widget diff old/ new/ --format json
```

Montre ce qui a changé entre deux versions des sources d’un widget,
chacune un dossier ou un ZIP, lues comme `admit` les lit : les fichiers que
reçoit l’espace créateurs. Les fichiers sont triés par chemin ; chaque
fichier ajouté, modifié ou supprimé est accompagné de ses changements au
format unifié (trois lignes de contexte) et du nombre de lignes ajoutées et
retirées. Un fichier qui n’est pas du texte UTF-8 est binaire : seul son
SHA-256 est comparé. De même pour un texte de plus de 1 Mio ou de
20 000 lignes, ou une fois 200 000 lignes comparées dans un même diff
(`tooLarge`). Quand les deux versions ont un manifeste valide, les
[clés de permission](#clés-de-permission) que la nouvelle version ajoute,
élargit et retire sont listées, avec la revue dont elle a besoin.

Option : `--format json`. Codes de sortie : 0 quand les deux versions ont
été lues, qu’elles diffèrent ou non ; 1 quand l’une est refusée ; 2 pour
une erreur d’utilisation ou de fichier (une version absente ou illisible).

## submit

```sh
overcrow-widget submit --dry-run --submission submission.json
overcrow-widget submit --submission submission.json
```

Envoie une version de votre widget à l’espace créateurs d’OverCrow, depuis
un terminal, une CI ou le serveur MCP d’OverCrow, puis suit ses contrôles.
La commande ne pose jamais de question : ce qui manque est signalé, avec un
[code de sortie](#codes-de-sortie) stable. Elle prend le dossier du widget
(le dossier courant sans argument) ou un ZIP de ce dossier.

### La clé de publication

- Créez-la dans l’espace créateurs (Éditeur, Clés de publication). Une clé
  ne permet que de soumettre des versions d’un seul widget, pour 1 à
  365 jours (90 par défaut), et n’est affichée qu’une fois.
- `submit` et `status` la lisent dans la variable d’environnement
  `OVERCROW_PUBLISH_KEY`, et seulement là : jamais dans un argument ni dans
  un fichier du projet. Dans une CI, gardez-la comme secret.
- L’outil ne l’affiche jamais : tout texte `ocw_pub_…` est masqué dans ses
  sorties, ses erreurs et ses journaux. Quelle que soit la commande, il
  retire la variable de l’environnement des programmes qu’il lance
  (TypeScript, le runtime).
- Une clé qui expire dans moins de 14 jours donne un avertissement. Une clé
  expirée ou révoquée finit avec le code 2 : créez-en une autre et
  remplacez le secret.

### Ce que fait la commande

1. Elle vérifie la clé et lit ce dont l’espace créateurs a besoin pour ce
   widget : la dernière version approuvée, la plus petite version acceptée
   maintenant, les envois restants (20 sur 24 heures), la présence d’une
   politique de confidentialité dans la fiche.
2. Elle vérifie exactement ce qu’elle va envoyer. Le dossier est zippé tel
   que l’espace créateurs le lit ([archives de sources](#archives-de-sources)),
   relu, puis admis comme l’espace créateurs l’admet, `listing.json` étant
   facultatif ; un ZIP donné à la place est envoyé tel quel, octet pour
   octet. L’ID du manifeste doit être le widget de la clé, et la version
   supérieure à la dernière approuvée. Chaque permission que la version
   ajoute ou élargit (chaque permission, pour une première version) demande
   une justification, par sa [clé](#clés-de-permission). Les textes
   doivent suivre les règles de l’espace créateurs. Au moindre problème,
   rien n’est envoyé (code 1).
3. Elle envoie l’archive, puis suit les six contrôles de l’espace créateurs,
   environ une minute : manifeste, numéro de version, analyse du code,
   construction du paquet, permissions, taille et ressources.
4. Elle se termine quand la version entre en revue (code 0), quand un
   contrôle échoue (code 1 : chaque problème est montré sur la ligne de
   votre fichier), ou quand la version a réussi ses contrôles mais attend
   dans l’espace créateurs ce que seul l’espace créateurs reçoit (code 3) :
   une politique de confidentialité si le widget utilise le réseau, une
   fiche complète pour une première version, ou la place en revue d’un
   nouvel éditeur. Le lien pour finir là-bas est affiché.

Ctrl+C pendant les contrôles arrête de les suivre ; ils continuent dans
l’espace créateurs, et `overcrow-widget status --version 1.3.1 --wait` les
suit de nouveau (code 4). Une commande coupée avant la fin (réseau, Ctrl+C)
reprend le même envoi quand vous la relancez à l’identique ; des sources ou
des textes modifiés font un nouvel envoi. Un envoi non terminé dans l’heure
expire, et chaque envoi compte dans la limite quotidienne.

| Option | Effet |
| --- | --- |
| `--submission FILE` | Les textes de la version ([ci-dessous](#le-fichier-de-textes)). |
| `--release-notes-en TEXT`, `--release-notes-fr TEXT`, `--review-message TEXT` | Remplacent ceux du fichier. |
| `--dry-run` | Étapes 1 et 2 seulement, sans rien envoyer : ce que l’espace créateurs exigera (justifications, politique de confidentialité, type de revue, version minimale, envois restants) et l’empreinte SHA-256 de l’archive. Pour une première version, l’espace créateurs vérifie aussi toute la fiche, qu’il est seul à connaître : un essai à blanc qui finit avec 0 peut encore finir avec 3. |
| `--expect-sha256 HEX` | N’envoie qu’une archive de cette empreinte, l’`archive.sha256` d’un `--dry-run` : ce qui part est ce qui a été vérifié. |
| `--no-wait` | S’arrête après l’envoi (code 4). |
| `--format json` | Un seul objet JSON ([sortie lisible par un programme](#sortie-lisible-par-un-programme)). |
| `--verbose` | Une ligne par requête sur la sortie d’erreur : méthode, adresse sans sa requête, statut et durée ; jamais un en-tête, une clé ou un corps. |

### Le fichier de textes

<!-- source: docs/content/examples/weather/submission.json -->
```json
{
  "releaseNotes": {
    "en": "First version: the forecast of your city, in metric or imperial units.",
    "fr": "Première version : les prévisions de votre ville, en unités métriques ou impériales."
  },
  "justifications": [
    {
      "permission": "network:GET https://api.example.com/v1/forecast/{city}",
      "text": "Reads the forecast of the city the player chose, every 30 minutes at most."
    },
    {
      "permission": "storage",
      "text": "Keeps the chosen city and units between two games."
    }
  ],
  "reviewMessage": "The forecast API needs no account and receives only the city."
}
```

| Clé | Valeur |
| --- | --- |
| `releaseNotes` | Les notes publiques de la version, montrées aux joueurs : `en` (exigé dès qu’il y a des notes) et `fr`, 500 caractères chacune, texte simple, retours à la ligne admis. |
| `justifications` | Pour le relecteur, un `{permission, text}` par permission nouvelle ou élargie, par sa [clé](#clés-de-permission) ; 500 caractères chacun. |
| `reviewMessage` | Un message privé au relecteur, 2 000 caractères. |

Chaque clé est facultative ; toute autre clé est refusée. Le serveur MCP
d’OverCrow écrit ce fichier.

### Dans une CI

Un workflow GitHub Actions qui installe l’outil ([installation](#installation))
et soumet le widget d’exemple `nova.weather` à chaque étiquette de version,
avec la clé dans les secrets du dépôt :

<!-- source: docs/content/examples/weather/.github/workflows/submit.yml -->
```yaml
# Sends the widget to the OverCrow creator space when a version tag is
# pushed. The publish key is a secret of the repository, and the OverCrow
# release whose creator tools to use is a variable of the repository.
name: Submit to OverCrow

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  submit:
    runs-on: ubuntu-24.04
    env:
      OVERCROW_VERSION: ${{ vars.OVERCROW_VERSION }}
    steps:
      - uses: actions/checkout@v4
      - name: Install overcrow-widget
        run: |
          tools="overcrow-creator-tools-$OVERCROW_VERSION-linux-x86_64"
          curl --fail --location --silent --show-error --remote-name \
            "https://github.com/Valhallab/playervox-overcrow-releases/releases/download/v$OVERCROW_VERSION/$tools.zip"
          unzip -q "$tools.zip"
          (cd "$tools" && sha256sum --check --quiet SHA256SUMS)
          install -D -m 755 "$tools"/overcrow-widget-*-linux-x86_64 "$HOME/.local/bin/overcrow-widget"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Submit to OverCrow
        run: overcrow-widget submit --submission submission.json
        env:
          OVERCROW_PUBLISH_KEY: ${{ secrets.OVERCROW_PUBLISH_KEY }}
```

Le job échoue pour tout code autre que 0. `OVERCROW_API_URL` dirige
`submit` et `status` vers une autre API, pour des essais seulement :
`https://`, ou `http://` vers `127.0.0.1`, `localhost` ou `[::1]`, avec un
avertissement à chaque fois. Ne la posez jamais dans une vraie CI ; le
serveur MCP d’OverCrow ne la pose jamais.

## status

```sh
overcrow-widget status
overcrow-widget status --version 1.3.1 --wait
```

Montre les versions du widget de la clé, avec leur état et leur type de
revue. Avec `--version`, une seule version, par son numéro (la plus récente
de ce numéro) ou son ID : ses six contrôles et leurs problèmes, ce qui la
retient avant la revue, les remarques du relecteur et le délai de revue.
`--wait` suit une version encore en contrôle. Options : `--version
VERSION|ID`, `--wait`, `--format json`, `--verbose`. Code de sortie : 0
quand la lecture a réussi, 2 sur une erreur ; avec `--wait`, les codes de
`submit`.

| État | Signification |
| --- | --- |
| `checking` | Les contrôles tournent. |
| `checks_failed` | Un contrôle a échoué : rien n’est parvenu aux relecteurs. |
| `ready` | Les contrôles ont réussi ; la version attend dans l’espace créateurs. |
| `in_review` | Une personne la relit. |
| `changes_requested`, `approved`, `rejected` | La décision de la revue. |
| `published` | Dans le catalogue. |
| `superseded`, `discarded` | Remplacée par un envoi plus récent, ou abandonnée. |
| `withdrawn`, `suspended` | Hors du catalogue. |

## Archives de sources

`admit` et `diff` acceptent le dossier du widget ou un ZIP de ce dossier
(son nom finit par `.zip`), tel que l’espace créateurs le reçoit. Le ZIP
peut contenir les fichiers directement, ou un seul dossier qui les contient
tous, comme le font Windows et macOS. Il peut porter un court commentaire
d’archive (1 024 octets au plus), comme l’écrivent le « Download ZIP » de
GitHub et `git archive` ; ce commentaire n’est jamais lu.

Laissés de côté dans les deux cas, et jamais envoyés par les outils
créateurs : les fichiers et dossiers cachés (`.env`, `.git/`,
`assets/.DS_Store`…), `node_modules/`, `dist/`, `tests/output/`,
`__MACOSX/`, les paquets construits, les fichiers de clés et les fichiers
système, et, dans un dossier, les liens et les noms qui ne sont pas en
ASCII portable. Dans un ZIP, ils comptent tout de même dans les limites
ci-dessous et sont vérifiés comme le reste.

| Limite | Valeur |
| --- | --- |
| Archive | 32 Mio |
| Décompressé | 64 Mio |
| Fichiers | 2 000 |

Tout est vérifié avant d’écrire le moindre octet : une archive refusée
n’écrit rien, et une archive admise n’est écrite que dans un dossier de
travail privé, supprimé à la fin.

| Code | L’archive contient |
| --- | --- |
| `sources.archive_size` | Plus de 32 Mio. |
| `sources.too_large`, `sources.too_many_files` | Plus de 64 Mio ou de 2 000 fichiers une fois décompressée. |
| `sources.unsafe_name` | Un nom qui pourrait sortir du dossier du widget (`../`, `/` en tête, `:`), ou qu’un système ne peut pas utiliser : autre chose que de l’ASCII imprimable, un point ou une espace final, `CON`, `NUL`, `COM1`… |
| `sources.backslash` | Des dossiers séparés par `\`, comme les écrit `Compress-Archive` de Windows PowerShell 5.1. Envoyez le dossier du widget lui-même dans l’espace créateurs, ou utilisez [`submit`](#submit), qui fait un ZIP correct. |
| `sources.duplicate_name` | Deux noms qui ne diffèrent que par la casse, ou un fichier qui est aussi un dossier. |
| `sources.link`, `sources.special_file` | Un lien, ou un périphérique, une FIFO ou un socket. |
| `sources.bomb` | Une entrée qui se décompresse bien au-delà de sa taille compressée, ou de sa taille déclarée. |
| `sources.read` | Le fichier ne peut pas être lu (code de sortie 2). |
| `sources.encrypted` | Une entrée chiffrée. |
| `sources.zip64` | Du ZIP64, dont des sources n’ont jamais besoin. |
| `sources.archive` | Tout autre élément qu’un ZIP ne doit pas contenir : un commentaire de plus de 1 024 octets ou qui contient un enregistrement de fin, des octets avant, entre ou après les entrées ou après les données compressées d’une entrée, un autre nom dans un champ extra, des tailles ou des sommes de contrôle qui ne concordent pas. |

## La carte du code

`--source-map FILE` écrit une carte qui relie chaque position du
`logic.js` livré, regroupé et minifié, au fichier, à la ligne et à la
colonne de vos sources : une [Source Map v3](https://tc39.es/ecma426/).
L’espace créateurs la garde privée et s’en sert pour vous montrer les
erreurs de votre widget dans votre propre code.

- `sources` : `logic.ts` (ou `logic.js`), les fichiers de `@overcrow/sdk`
  (listés dans `ignoreList`) et `overcrow:view-table`, la table des
  expressions générée depuis `view.ocml`, dont le texte est dans
  `sourcesContent`.
- `x_overcrow_functions` : les fonctions nommées des sources,
  `{"source", "name", "start": [line, column], "end": [line, column]}`,
  numérotées à partir de 0, colonnes en unités UTF-16 comme `mappings`. La
  fonction d’une position est la plus intérieure qui l’entoure. Les
  expressions de la table de vue s’appellent `view expression <n>`, `<n>`
  étant leur rang dans `view.json`.

Les mêmes sources donnent toujours la même carte. Elle ne fait jamais
partie du paquet, et `logic.js` ne la désigne pas.

## Diagnostics

Chaque problème est un diagnostic, avec un code stable, une position et,
quand il y en a une, une suggestion :

```text
error[view.unknown_attribute]: `clas` is not an attribute of <text>
  --> view.ocml:4:9
   |
 4 |   <text clas="value">{state.count}</text>
   |         ^
   = help: did you mean `class`?
check: 1 error(s), 0 warning(s)
```

Le code a la forme `<domain>.<category>` :

| Domaine | Origine | Codes |
| --- | --- | --- |
| `project` | Les fichiers du projet | `missing_file`, `file_size`, `encoding`, `ambiguous_logic`, `asset_path`, `entry_limit`, `read` |
| `manifest` | `manifest.json` | voir [le manifeste](manifest.md#comment-le-manifeste-est-vérifié) |
| `view` | `view.ocml` | voir [la vue](view.md#quand-la-vue-est-incorrecte) |
| `style` | `style.ocss` | voir [le style](style.md#quand-le-style-est-incorrect) |
| `locales` | `locales/*.json` | `missing_file`, `json`, `shape`, `key`, `value`, `keys`, `entry_limit`, `unknown_key` |
| `logic` | `logic.ts` | voir [la logique](logic.md#ce-que-la-logique-ne-peut-pas-utiliser) |
| `typecheck` | TypeScript | `tsc` (le message de TypeScript lui-même), `skipped`, `sdk_version`, `timeout` |
| `package` | Le paquet relu | `archive_size`, `file_size` et les catégories du lecteur de paquets d’OverCrow |
| `test` | Les scénarios | `scenario`, `scenario_name`, `too_many_scenarios` |
| `sources` | Une archive de sources | voir [archives de sources](#archives-de-sources) |
| `init`, `doctor`, `admission` | Ces commandes | listés ci-dessus |
| `submit` | Ce que `submit` vérifie avant l’envoi | `widget_not_submittable`, `agreement_required`, `limit_reached`, `version_too_low`, `justification_missing`, `archive_too_large`, `archive_mismatch`, `release_notes`, `justification`, `review_message` |

- Les lignes et les colonnes commencent à 1 ; une colonne compte des
  caractères, pas des octets.
- Un nom inconnu est accompagné du nom existant le plus proche.
- Avec `--format json`, chaque diagnostic est un objet JSON sur une ligne de
  la sortie standard :
  `{"severity","code","file","line","column","message","help"}`, avec
  `null` pour ce qui est inconnu. `package --format json` se termine par un
  objet `{"package","bytes","sha256","logicBytes","sourceMap"}` ; `admit` et
  `diff` affichent un seul rapport ([sortie lisible par un
  programme](#sortie-lisible-par-un-programme)).
- Les textes qui viennent d’un widget (ses journaux, ses noms) sont affichés
  avec les caractères de contrôle du terminal neutralisés.

Dans vos scripts, appuyez-vous sur les codes : les messages et les textes
d’aide peuvent être reformulés.

## Sortie lisible par un programme

Avec `--format json`, `admit`, `diff`, `submit` et `status` affichent un
seul objet JSON sur une ligne. Des champs peuvent seulement s’ajouter ; tout autre changement
est annoncé par un nouveau `formatVersion`.

`admit` :

| Champ | Valeur |
| --- | --- |
| `formatVersion` | `1`. |
| `admitted` | Si les sources sont admises. |
| `publisher` | Le pseudo de `--publisher`, ou `third-party`. |
| `id`, `version`, `reservedId` | Le widget ; `null` quand les sources ont été refusées avant la construction. |
| `package` | `bytes`, `sha256` et les `bytes` et `sha256` de chaque fichier. |
| `reproducible` | `viewJson` et `archive`, comparés avec `--package`, sinon `null`. |
| `listing` | `bytes`, `sha256`, `spdxLicense` et `preview` de `listing.json`. |
| `sources` | `kind` (`folder` ou `archive`), `files`, `bytes`, `ignored` (`path`, `reason`) et, pour un ZIP, `sha256` et `prefix` (le dossier englobant). |
| `review` | Les pouvoirs à relire, un objet par élément (`kind`, puis ses champs). |
| `permissions` | `keys` ; avec `--previous`, aussi `previous` (`id`, `version`), `added`, `changed`, `removed` et `reviewType` (`full` ou `quick`), sinon `null`. |
| `listingPolicy` | `required` ou `optional` (`--listing`). |
| `diagnostics` | Les diagnostics, comme ci-dessus. |

`diff` :

| Champ | Valeur |
| --- | --- |
| `formatVersion` | `1`. |
| `compared` | `false` quand une version est refusée ; seul `diagnostics` suit alors. |
| `old`, `new` | `kind`, `files`, `bytes`, `sha256`, `prefix`, `ignored`, `id` et `version` de chaque version. |
| `files` | Les fichiers modifiés, par chemin : `path`, `status` (`added`, `modified`, `removed`), `binary`, `tooLarge`, `oldSha256`, `newSha256`, `additions`, `deletions` et `hunks` (`oldStart`, `oldLines`, `newStart`, `newLines`, `lines`, chaque ligne commençant par ` `, `-`, `+` ou `\`). |
| `totals` | `added`, `modified`, `removed`, `additions`, `deletions`. |
| `permissions` | `added`, `changed`, `removed` et `reviewType`, ou `null` sans deux manifestes valides. |
| `diagnostics` | Les diagnostics. |


`submit` et `status` :

| Champ | Valeur |
| --- | --- |
| `formatVersion`, `command` | `1` ; `submit` ou `status`. |
| `outcome`, `exitCode` | La fin de la commande (ci-dessous) et son [code de sortie](#codes-de-sortie). |
| `dryRun` | `submit` : si rien ne devait partir. |
| `key` | `name`, `hint` (les quatre caractères après `ocw_pub_`), `expiresAt`, `expiresSoon`. |
| `widget` | `id` ; `submit` : `publisher`, `status` ; `status` : `name`. |
| `archive` | `submit` : `kind` (`folder`, zippé par l’outil, ou `archive`), `bytes`, `sha256`, `files`, `uncompressedBytes`, `ignored`. |
| `local` | `submit` : `admitted`, `version`, `minimumVersion`, `previousVersion`, `permissions` (`keys`, `added`, `changed`, `removed`, `reviewType`), `diagnostics`. |
| `requirements` | `submit` : `justifications` (`required`, `given`, `missing`, `unused`), `privacyPolicy` (`required`, `present`), `reviewType`, `submissions` (`limit`, `remaining`, `nextSubmissionAt`), `review` (`available`, `blockedBy`), `agreement` (`version`, `accepted`), `blockers` (`code`). |
| `submission` | `submit` : `id`, `state`, `resumed`, `quota`. |
| `version` | La version de l’espace créateurs, ses champs en camelCase : `id`, `version`, `state`, `reviewType`, `checks` (`key`, `status`, `diagnostics`), `reviewBlockers`, `completeInPortal` (`message`, `url`), `permissions`, `remarks`, `deadline`, `history`… |
| `versions` | `status` sans `--version` : toutes les versions. |
| `error` | `code`, `message` et, quand ils sont connus, `httpStatus`, `retryAfter`, `nextSubmissionAt`, `minimumVersion`, `expiredAt`, `fields` ; sinon `null`. |

`outcome` vaut `ready_to_send` (`--dry-run`), `refused_locally`, `refused`
(l’espace créateurs a refusé l’envoi), `complete_in_portal`, `error`, ou
l’état de la version ; `status` sans `--wait` n’en a pas. Les codes
d’erreur sont ceux de l’espace créateurs (`version_not_newer`,
`submission_limit_reached`, `publish_key_expired`, `publish_key_revoked`…)
ou ceux de l’outil : `publish_key_missing`, `invalid_publish_key`,
`api_url_invalid`, `submission_file`, `sources`, `sources.read`, `network`,
`timeout`, `server`, `response`, `redirect`, `upload_refused`,
`build_failed`, `submission_state`, `not_found`, `internal`. Les problèmes
trouvés avant l’envoi sont des diagnostics : `sources.*`,
`project.missing_file` (ce n’est pas le dossier du widget), `admission.*`
et `submit.*`
(`widget_not_submittable`, `agreement_required`, `limit_reached`,
`version_too_low`, `justification_missing`, `archive_too_large`,
`archive_mismatch`, `release_notes`, `justification`, `review_message`).

## Codes de sortie

| Code | Signification |
| --- | --- |
| 0 | Succès. Les avertissements sont admis, sauf avec `--deny-warnings`. `diff` a lu les deux versions, qu’elles diffèrent ou non. `submit` : la version est en revue (avec `--dry-run`, elle y entrerait), ou déjà au-delà (approuvée, publiée, retirée). |
| 1 | Des erreurs ont été trouvées ; `admit` a refusé les sources ; `diff` a refusé une version ; un scénario de `test` a échoué ; l’overlay a mis fin à une session `dev`. `submit` : quelque chose à corriger (une vérification avant l’envoi, un refus de l’espace créateurs, un contrôle échoué). |
| 2 | Une erreur d’utilisation ou de fichier ; pas d’overlay pour `dev` ; pas de runtime pour `test`. `submit`, `status` : la clé (absente, invalide, expirée, révoquée), le réseau ou le serveur. |
| 3 | `submit`, `status --wait` : la version a réussi ses contrôles et attend dans l’espace créateurs. |
| 4 | `submit`, `status --wait` : la version est encore en contrôle (Ctrl+C, `--no-wait`, ou 15 minutes). |

Ces significations ne changent pas d’une version de l’outil à l’autre.
