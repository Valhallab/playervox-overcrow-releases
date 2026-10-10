# Publish keys and CI

A publish key lets `overcrow-widget submit` send versions of one
PlayerVox OverCrow widget from a terminal or a CI job, without your
password. It can do nothing else.

## What a key can do

- Submit versions of **one** widget, and follow their checks. Every version
  still goes through the review before players get it.
- It can neither publish, nor change the listing, nor reach your account or
  your other widgets.
- It lasts 1 to 365 days (90 by default). We remind you by e-mail and in
  the creator space 14 days before it expires.
- PlayerVox keeps only a digest of it: the key is shown **once**, when you
  create it.

## Create a key

In the creator space, **Publish keys**, **Create a key**:

1. Name it after where it will live (`GitHub Actions`, `Laptop`).
2. Choose the widget and the lifetime.
3. Confirm with a fresh code of your authenticator app.

Copy the key at once into your CI's secrets: it starts with `ocw_pub_` and
will never be shown again. If you lose it, revoke it and create another
one. A widget has at most ten active keys.

## Use it

`overcrow-widget submit` reads the key from the environment variable
`OVERCROW_PUBLISH_KEY`, and only there: never put it in a file of your
project or in a command line.

```sh
export OVERCROW_PUBLISH_KEY=ocw_pub_…
overcrow-widget submit
```

The [submit command](cli.md#submit) checks the version as the creator space
will, sends it, then follows its checks, about a minute.

## In GitHub Actions

Keep the key as a secret of the repository, `OVERCROW_PUBLISH_KEY`. This
workflow submits the widget on every version tag:

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

The job fails when the checks fail, with each problem on the line of your
file.

## Revoke a key

**Revoke** stops the key at once: an upload in progress with it fails.
Versions it already sent stay, but no longer enter review on their own:
send them to review from the creator space. Revoke a key as soon as you
think it leaked, then create a new one.
