# Widgets de référence

Les widgets intégrés d’OverCrow sont des widgets ordinaires, écrits avec le
SDK public, empaquetés par `overcrow-widget` et publiés dans le catalogue
signé comme les vôtres. Leurs sources se trouvent dans
[`widgets/`](../../../widgets/), sous licence MIT : lisez-les, copiez-les et
partez-en.

<!-- generated:widgets -->
| Widget | Description | ID | Permissions | Page |
| --- | --- | --- | --- | --- |
| **Horloge** | Affiche l’heure locale et, en option, la date, au format 24 heures. | `com.playervox.overcrow.clock` | aucune | [clock/README.md](../../../widgets/clock/README.md) |
| **FPS** | Affiche la fréquence d’images présentée par le jeu, quand l’hôte dispose d’une source. | `com.playervox.overcrow.fps` | `fps.read` | [fps/README.md](../../../widgets/fps/README.md) |
| **Média** | Le morceau que joue votre lecteur de musique, avec sa pochette, et les boutons précédent, lecture/pause et suivant en mode interactif. | `com.playervox.overcrow.media` | `media.read`, `media.control` | [media/README.md](../../../widgets/media/README.md) |
| **Performances** | CPU et mémoire du jeu, et les températures que cet ordinateur expose. | `com.playervox.overcrow.performance` | `telemetry.read`, `fps.read` | [performance/README.md](../../../widgets/performance/README.md) |
| **Journal de sessions** | Les sessions de jeu terminées de votre jeu, de la plus récente à la plus ancienne : date, heure de début et durée, cinq par page. Enregistrées sur votre appareil sans compte, fusionnées avec votre journal PlayerVox si vous synchronisez. Supprimez une session après confirmation. | `com.playervox.overcrow.playervox.journal` | `journal.read`, `journal.delete` | [playervox-journal/README.md](../../../widgets/playervox-journal/README.md) |
| **Ma note** | Votre note PlayerVox du jeu Steam auquel vous jouez : son grade et son score, et en mode interactif trois critères et un avis facultatif à publier ou mettre à jour. Nécessite votre compte PlayerVox. | `com.playervox.overcrow.playervox.rating` | `playervox.rating.read`, `playervox.rating.write` | [playervox-rating/README.md](../../../widgets/playervox-rating/README.md) |
| **Note PlayerVox** | La note de la communauté PlayerVox pour votre jeu Steam, avec son score, son nombre de votes et trois critères. Sans compte ; le badge reste toujours visible. | `com.playervox.overcrow.playervox.score` | `playervox.score.read` | [playervox-score/README.md](../../../widgets/playervox-score/README.md) |
| **Session** | Affiche la durée de la session de jeu en cours. | `com.playervox.overcrow.session` | `session.read` | [session/README.md](../../../widgets/session/README.md) |
| **Chronomètre** | Un chronomètre au centième de seconde, démarré, mis en pause et réinitialisé par ses boutons ou les raccourcis de l’hôte. | `com.playervox.overcrow.stopwatch` | `stopwatch.read`, `stopwatch.control` | [stopwatch/README.md](../../../widgets/stopwatch/README.md) |
| **Marché Warframe** | Recherche les objets PC publics dans un catalogue en cache, affiche les meilleures offres d’achat et de vente d’un objet et copie un message d’échange sur un clic. | `com.playervox.overcrow.warframe.market` | `network`, `storage`, `clipboardWrite` | [warframe-market/README.md](../../../widgets/warframe-market/README.md) |
<!-- /generated:widgets -->

Chaque dossier de widget contient :

- les sources du paquet : `manifest.json`, `view.ocml`, `style.ocss`,
  `logic.ts`, `locales/`, `LICENSE` ;
- `listing.json`, son texte pour la marketplace ;
- `tests/` : les tests unitaires de la logique, et des scénarios avec leurs
  images de référence dans les deux thèmes, les deux langues et deux
  échelles, joués par `overcrow-widget test` dans le runtime headless
  d’OverCrow ;
- `README.md` : ce qu’il affiche, son menu, ses permissions, son
  fonctionnement et son coût (en anglais).

Pour travailler sur l’un d’eux depuis ce dépôt, liez-y le SDK de cette
révision, puis vérifiez-le, empaquetez-le et lancez ses tests unitaires :

```sh
node scripts/prepare-widgets.mjs
overcrow-widget check widgets/clock
overcrow-widget package widgets/clock
node --test widgets/clock/tests/logic.test.mjs
```

`prepare-widgets.mjs` demande que le SDK soit construit d’abord (`npm ci`
puis `npm run build` dans `sdk/`). Les autres widgets intégrés sont réécrits
un par un sur le même SDK et rejoignent cette liste à leur arrivée.
Marché Warframe n’est pas un widget intégré : widget PlayerVox du catalogue,
installé à la demande, il montre des routes réseau avec une borne de réponse
déclarée, le stockage de l’hôte pour un catalogue en cache et une copie dans
le presse-papiers sur un clic.
