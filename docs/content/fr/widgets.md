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
| **Session** | Affiche la durée de la session de jeu en cours. | `com.playervox.overcrow.session` | `session.read` | [session/README.md](../../../widgets/session/README.md) |
| **Chronomètre** | Un chronomètre au centième de seconde, démarré, mis en pause et réinitialisé par ses boutons ou les raccourcis de l’hôte. | `com.playervox.overcrow.stopwatch` | `stopwatch.read`, `stopwatch.control` | [stopwatch/README.md](../../../widgets/stopwatch/README.md) |
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
`widgets/warframe-market` est un widget de l’ancien runtime Web, conservé
jusqu’à sa réécriture ou son retrait ; ce n’est pas une référence.
