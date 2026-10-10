# Clés de publication et CI

Une clé de publication permet à `overcrow-widget submit` d’envoyer les
versions d’un widget PlayerVox OverCrow depuis un terminal ou une CI, sans
votre mot de passe.
Elle ne permet rien d’autre.

## Ce qu’une clé permet

- Soumettre des versions d’**un seul** widget, et suivre leurs contrôles.
  Chaque version passe toujours par la revue avant d’arriver aux joueurs.
- Elle ne permet ni de publier, ni de modifier la fiche, ni d’accéder à
  votre compte ou à vos autres widgets.
- Elle dure de 1 à 365 jours (90 par défaut). Nous vous prévenons par e-mail
  et dans l’espace créateurs 14 jours avant son expiration.
- PlayerVox n’en garde qu’une empreinte : la clé est affichée **une seule
  fois**, à sa création.

## Créer une clé

Dans l’espace créateurs, **Clés de publication**, **Créer une clé** :

1. Nommez-la d’après l’endroit où elle servira (`GitHub Actions`,
   `Portable`).
2. Choisissez le widget et la durée.
3. Confirmez avec un code récent de votre application d’authentification.

Copiez aussitôt la clé dans les secrets de votre CI : elle commence par
`ocw_pub_` et ne sera plus jamais affichée. Si vous la perdez, révoquez-la et
créez-en une autre. Un widget a au plus dix clés actives.

## L’utiliser

`overcrow-widget submit` lit la clé dans la variable d’environnement
`OVERCROW_PUBLISH_KEY`, et seulement là : ne la mettez jamais dans un fichier
du projet ni dans une ligne de commande.

```sh
export OVERCROW_PUBLISH_KEY=ocw_pub_…
overcrow-widget submit
```

La [commande submit](cli.md#submit) contrôle la version comme le fera
l’espace créateurs, l’envoie, puis suit ses contrôles, environ une minute.

## Dans GitHub Actions

Gardez la clé comme secret du dépôt, `OVERCROW_PUBLISH_KEY`. Ce workflow
soumet le widget à chaque tag de version :

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

La tâche échoue quand les contrôles échouent, avec chaque problème sur la
ligne de votre fichier.

## Révoquer une clé

**Révoquer** arrête la clé aussitôt : un envoi en cours avec elle échoue.
Les versions qu’elle a déjà envoyées restent, mais n’entrent plus seules en
revue : envoyez-les en revue depuis l’espace créateurs. Révoquez une clé dès
que vous pensez qu’elle a fuité, puis créez-en une nouvelle.
