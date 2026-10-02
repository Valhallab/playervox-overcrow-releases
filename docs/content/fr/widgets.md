# Widgets de référence

Les widgets intégrés de PlayerVox OverCrow sont des widgets ordinaires,
écrits avec le SDK public, empaquetés par `overcrow-widget` et publiés dans
le catalogue signé comme les vôtres. Leurs sources se trouvent dans
[`widgets/`](../../../widgets/), dans le dépôt public, sous licence MIT :
lisez-les, copiez-les et servez-vous-en comme point de départ.

<!-- generated:widgets -->
| Widget | Description | ID | Permissions | Sources |
| --- | --- | --- | --- | --- |
| **Horloge** | Affiche l’heure locale et, en option, la date, au format 24 heures. | `com.playervox.overcrow.clock` | aucune | [widgets/clock/](../../../widgets/clock/) |
| **FPS** | Affiche la fréquence d’images présentée par le jeu, quand l’hôte dispose d’une source. | `com.playervox.overcrow.fps` | `fps.read` | [widgets/fps/](../../../widgets/fps/) |
| **Média** | Le morceau que joue votre lecteur de musique, avec sa pochette, et les boutons précédent, lecture/pause et suivant en mode interactif. | `com.playervox.overcrow.media` | `media.read`, `media.control` | [widgets/media/](../../../widgets/media/) |
| **Notes** | Vos notes et listes de tâches par-dessus le jeu : jusqu’à huit notes, chacune avec un texte libre et une liste de tâches, les mêmes pour tous les jeux. Lisez-les en mode passif ; en mode interactif, choisissez, créez, supprimez et modifiez-les dans le widget, et cochez les éléments. Elles restent sur cet ordinateur. | `com.playervox.overcrow.notes` | `notes.read`, `notes.write` | [widgets/notes/](../../../widgets/notes/) |
| **Performances** | CPU et mémoire du jeu, et les températures que cet ordinateur expose. | `com.playervox.overcrow.performance` | `telemetry.read`, `fps.read` | [widgets/performance/](../../../widgets/performance/) |
| **Journal de sessions** | Les sessions de jeu terminées de votre jeu, de la plus récente à la plus ancienne : date, heure de début et durée, cinq par page. Enregistrées sur votre appareil sans compte, fusionnées avec votre journal PlayerVox si vous synchronisez. Supprimez une session après confirmation. | `com.playervox.overcrow.playervox.journal` | `journal.read`, `journal.delete` | [widgets/playervox-journal/](../../../widgets/playervox-journal/) |
| **Ma note** | Votre note PlayerVox du jeu Steam auquel vous jouez : son grade et son score, et en mode interactif trois critères et un avis facultatif à publier ou mettre à jour. Nécessite votre compte PlayerVox. | `com.playervox.overcrow.playervox.rating` | `playervox.rating.read`, `playervox.rating.write` | [widgets/playervox-rating/](../../../widgets/playervox-rating/) |
| **Avis des joueurs** | Ce que les joueurs de PlayerVox pensent du jeu auquel vous jouez : trois avis par page avec la note et le score de chaque joueur, dans votre langue quand une traduction existe. Limitez-les aux joueurs que vous suivez depuis le menu du widget. Nécessite votre compte PlayerVox. | `com.playervox.overcrow.playervox.reviews` | `playervox.reviews.read` | [widgets/playervox-reviews/](../../../widgets/playervox-reviews/) |
| **Note PlayerVox** | La note de la communauté PlayerVox pour votre jeu Steam, avec son score, son nombre de votes et trois critères. Sans compte ; le badge reste toujours visible. | `com.playervox.overcrow.playervox.score` | `playervox.score.read` | [widgets/playervox-score/](../../../widgets/playervox-score/) |
| **Session** | Affiche la durée de la session de jeu en cours. | `com.playervox.overcrow.session` | `session.read` | [widgets/session/](../../../widgets/session/) |
| **Chronomètre** | Un chronomètre au centième de seconde, démarré, mis en pause et réinitialisé par ses boutons ou les raccourcis de l’hôte. | `com.playervox.overcrow.stopwatch` | `stopwatch.read`, `stopwatch.control` | [widgets/stopwatch/](../../../widgets/stopwatch/) |
| **Chat Twitch** | Lisez et envoyez des messages dans le chat Twitch public de votre choix : vos chaînes favorites, l’historique défilant avec emotes et réponses en mode interactif, les derniers messages qui s’effacent en mode passif. Nécessite votre compte Twitch. | `com.playervox.overcrow.twitch.chat` | `twitch.chat.read`, `twitch.chat.compose` | [widgets/twitch-chat/](../../../widgets/twitch-chat/) |
| **Marché Warframe** | Recherche les objets PC publics dans un catalogue en cache, affiche les meilleures offres d’achat et de vente d’un objet et copie un message d’échange sur un clic. | `com.playervox.overcrow.warframe.market` | `network`, `storage`, `clipboardWrite` | [widgets/warframe-market/](../../../widgets/warframe-market/) |
<!-- /generated:widgets -->

## Ce que contient le dossier d’un widget

- les sources du paquet : `manifest.json`, `view.ocml`, `style.ocss`,
  `logic.ts`, `locales/`, `LICENSE` ;
- `listing.json`, son texte pour la marketplace ;
- `tests/` : les tests unitaires de la logique, et des scénarios avec leurs
  images de référence dans les deux thèmes, les deux langues et deux
  échelles, joués par `overcrow-widget test` dans le runtime headless
  d’OverCrow ;
- `README.md` : ce qu’il affiche, son menu, ses permissions, son
  fonctionnement et son coût.

## Ce que chacun montre

| Pour voir comment… | Lisez |
| --- | --- |
| se déclencher à chaque minute ou seconde de l’heure locale, suivre une option du menu | Horloge |
| s’abonner à un service et afficher une valeur manquante | FPS, Session |
| disposer une liste de valeurs en grille, masquer une ligne du menu que la machine ne peut pas alimenter | Performances |
| afficher une image fournie par OverCrow, relancer un abonnement qui s’est terminé | Média |
| commander un service sur une action de l’utilisateur, laisser OverCrow faire avancer une durée | Chronomètre |
| modifier du texte avec un formulaire lié à un intent d’écriture, conserver des brouillons | Notes, Ma note |
| dessiner sur un canvas | Note PlayerVox, Ma note |
| parcourir un service page par page et réagir à une révision | Avis des joueurs, Journal de sessions |
| maintenir une longue liste défilante sur sa fin, envoyer un message | Chat Twitch |
| appeler une API HTTP, la mettre en cache dans le stockage, copier dans le presse-papiers | Marché Warframe |

Marché Warframe n’est pas un widget intégré : widget PlayerVox du catalogue,
installé à la demande, il montre des routes réseau avec une limite de
réponse déclarée, le stockage pour un catalogue en cache et une copie dans
le presse-papiers sur un clic.

## Travailler sur l’un d’eux

Depuis une copie de travail du dépôt, liez aux widgets le SDK de cette
révision, puis vérifiez l’un d’eux, empaquetez-le et lancez ses tests
unitaires :

```sh
node scripts/prepare-widgets.mjs
overcrow-widget check widgets/clock
overcrow-widget package widgets/clock
node --test widgets/clock/tests/logic.test.mjs
```

`prepare-widgets.mjs` demande que le SDK soit construit d’abord (`npm ci`
puis `npm run build` dans `sdk/`). Les quatre templates
d’`overcrow-widget init` se trouvent dans
[`templates/`](../../../templates/), et deux exemples complets, écrits pour
ces pages, dans [`docs/content/examples/`](../examples/) : `weather` appelle
une API HTTP et `countdown` utilise un minuteur, un canvas, un menu
contextuel et le stockage.
