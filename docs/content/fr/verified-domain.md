# Domaine vérifié

Vérifier un domaine qui vous appartient ajoute le badge **Domaine vérifié** à
côté du nom de votre éditeur, dans le Centre de contrôle de PlayerVox
OverCrow et sur le site, et
permet aux identifiants de vos widgets de commencer par ce domaine inversé :
`gg.nova.lol-timers` pour `nova.gg`.

## Ajouter un domaine

Dans l’espace créateurs, **Profil de l’éditeur**, **Ajouter un domaine**.
Écrivez le domaine seul, sans `https://` ni `www.` : `nova.gg`. Un éditeur
peut avoir jusqu’à huit domaines.

L’espace créateurs donne alors l’enregistrement DNS à publier chez votre
hébergeur : un enregistrement TXT nommé `_overcrow.` suivi de votre domaine,
dont la valeur est `overcrow-verify=` suivi d’un jeton.

```text
_overcrow.nova.gg.  TXT  "overcrow-verify=3f9c1e7a52d04b8e"
```

## La vérification

**Vérifier maintenant** cherche l’enregistrement tout de suite (une fois par
minute au plus). Nous vérifions aussi tout seuls, toutes les heures pendant
sept jours. Le DNS peut mettre quelques minutes à se propager.

| État | Signification |
| --- | --- |
| En attente | L’enregistrement n’est pas encore trouvé ; vérifié toutes les heures pendant sept jours. |
| Vérifié | L’enregistrement est trouvé. Il est revérifié tous les 30 jours. |
| Perdu | L’enregistrement a disparu. Remettez-le, puis vérifiez maintenant. |
| Expiré | Pas vérifié en sept jours. Vérifiez maintenant pour recommencer. |

Laissez l’enregistrement en place : s’il disparaît, le badge s’en va. Les
identifiants des widgets déjà créés sous ce domaine restent à vous.

## Qui peut revendiquer un domaine

- Un domaine vérifié une fois par un éditeur lui est réservé, ainsi que les
  domaines en dessous et au-dessus : personne d’autre ne peut les
  revendiquer.
- Un domaine qui se lit comme PlayerVox, OverCrow ou Valhallab est refusé ;
  écrivez à l’assistance s’il vous appartient. Les identifiants sous
  `com.playervox` appartiennent à PlayerVox.
- Retirer un domaine jamais vérifié l’oublie. Un domaine vérifié une fois
  vous reste réservé, et ne peut pas être retiré tant que des identifiants
  de widgets l’utilisent.
