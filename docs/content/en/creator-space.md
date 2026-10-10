# Getting started in the creator space

The creator space of PlayerVox OverCrow, at `overcrow.playervox.com/creators`,
is where you publish widgets: you create your publisher once, reserve your widgets' IDs,
send their versions and follow their review. It is open by invitation for
now.

## Sign in

Sign in with your PlayerVox account: the creator space sends you to
playervox.com, which asks you to confirm, then brings you back. You never
type your password in the creator space. The session lasts while you use
it, up to 14 days; you can close it on playervox.com, in
**Connected devices**.

The interface is in English or French: choose in the account menu. The
addresses stay the same in both languages.

## Turn on two-factor authentication

Publishing requires two-factor authentication on your account. The first
visit turns it on:

1. Open an authenticator app (Aegis, 2FAS, Google Authenticator,
   1Password…).
2. Scan the QR code on a computer, or tap **Add to my app** on a phone or a
   tablet. You can also type the key by hand.
3. Enter the 6-digit code the app shows.

You then get ten recovery codes, shown once: each signs you in once if you
lose your phone. Keep them somewhere safe. Creating a publish key or
deleting your publisher asks for a fresh code again.

## Create your publisher

The publisher is the name your widgets appear under.

- **Display name**: shown to players. A name that reads as PlayerVox,
  OverCrow or Valhallab is refused.
- **Handle**: 3 to 32 lowercase letters, digits and hyphens, without a
  hyphen at either end. It is **permanent**: it can never be changed, and a
  handle is never given to anyone else, even after a deletion. Your
  widgets' IDs start with it.
- **Contact e-mail**: for PlayerVox to reach you. It is never shown.
- **Website** and **logo** (square, PNG or WebP): optional, shown on your
  publisher page.

Your public profile (name, about, website, logo) appears with the next
publication of the catalog: until then the creator space says
**Visible after the next publication**.

Then read the creator agreement, summed up in six points on the screen, and
accept it. Your space is ready.

## Reserve your first widget's ID

A widget ID is `<handle>.<name>`: `nova.lol-timers` for the handle `nova`.
With a [verified domain](verified-domain.md), it can also start with your
domain reversed: `gg.nova.lol-timers` for `nova.gg`. The name is lowercase
letters, digits and hyphens. An ID is permanent and never reused.

In **Widgets**, **New widget** reserves the ID. Create the project with the
same ID:

```sh
overcrow-widget init lol-timers --id nova.lol-timers
```

Try it in your game with the [development channel](dev-channel.md): nothing
is published.

## Next

- Send a version: [publishing and review](publishing.md).
- Send from a terminal or a CI job: [publish keys and CI](publish-keys.md).
- Get the verified badge and IDs under your domain:
  [verified domain](verified-domain.md).
