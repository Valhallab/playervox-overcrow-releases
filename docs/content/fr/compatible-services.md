# Rendre votre service compatible avec les widgets

Les widgets de PlayerVox OverCrow peuvent utiliser le compte d'un joueur sur
votre service sans jamais voir son secret : OverCrow garde la clé ou la
connexion sur l'ordinateur du joueur et ne l'ajoute qu'aux requêtes qu'un
widget a déclarées. Cette page dit ce dont un service a besoin pour cela.
Un créateur de widget déclare votre service comme le décrit
[Comptes tiers](accounts.md).

## Ce dont un service a besoin

1. **Connexion.** OAuth 2 à client public : PKCE (S256) et une redirection
   vers `http://127.0.0.1` sur un port quelconque (RFC 8252, section 7.3),
   ou le code d'appareil (RFC 8628). Aucun secret client à l'échange ni au
   rafraîchissement. À défaut, des **jetons personnels** que l'utilisateur
   crée, avec des portées, dont au moins une option en lecture seule.
2. **Envoi du secret.** `Authorization: Bearer`, ou un en-tête dédié. Un
   paramètre de requête seulement si rien d'autre n'est possible.
3. **L'API.** HTTPS et des réponses JSON sans redirection : pas de 3xx vers
   un autre hôte, images comprises (servez-les à une adresse stable). Un 401
   pour un secret refusé. Jamais le secret dans une réponse, même d'erreur.
4. **Jetons.** Des jetons d'accès courts, des jetons de rafraîchissement à
   rotation et un point de révocation (RFC 7009). Une liste publiée et
   stable des origines de l'API.
5. **Applications.** Pas de plafond bas d'utilisateurs pour l'application
   publique d'un éditeur, ni de validation réservée aux grandes entreprises.
6. **Le jeton de rafraîchissement.** Une durée longue ou glissante
   (renouvelée à chaque usage), pour que le joueur n'ait pas à se
   reconnecter souvent.

## Ce que fait OverCrow

- Il ouvre votre page d'autorisation dans le navigateur du système, ou
  affiche votre page de code d'appareil, sur un clic du joueur, en mode
  Interactif seulement.
- Il n'envoie le secret qu'aux origines que le widget a déclarées, sur les
  routes qui nomment le compte, en HTTPS, et refuse les redirections.
- Il refuse une réponse qui contient le secret, et ne donne jamais au widget
  vos points de jeton, de rafraîchissement ou de révocation.
- Il révoque les jetons quand le joueur se déconnecte, et les efface quand
  le widget est désinstallé.
