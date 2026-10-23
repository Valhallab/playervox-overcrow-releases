# Publish a widget

In the creator space of PlayerVox OverCrow, at
`creators.playervox.com`, a widget reaches players in four steps:
you send its sources, they are checked automatically, PlayerVox reviews
them, then the version is published in the catalog. This page covers the
first two and the screen that sends a version to review; the
[review](widget-review.md) and the [listing](widget-listing.md) have their
own pages.

## Before you send

- Your widget's ID is reserved in the creator space
  ([getting started](creator-space.md)), and `manifest.json` uses it.
- `overcrow-widget check` passes in the widget's folder.
- The version in `manifest.json` is newer than the last approved one:
  `1.2.1` or higher after `1.2.0`.

## Send the sources

Open the widget in **Widgets**, then **Submit a version**.

- On a computer, drop the widget's folder on the page, or choose it. You
  can also send a `.zip` of the folder.
- On a phone or a tablet, which cannot pick a folder, choose the `.zip`.

The creator space reads a folder with the same rules as
`overcrow-widget submit`, on your computer, and sends the same files. It
leaves out hidden files and folders (`.env`, `.git/`…), `node_modules/`,
`dist/`, `tests/output/`, `__MACOSX/`, built packages, key files, system
files and names that are not portable ASCII; the page lists what it left
out. A `.zip` is sent as it is. The bounds and the refusals are those of
[source archives](cli.md#source-archives): 32 MiB for the archive, 64 MiB and
2,000 files once uncompressed, 16 levels of folders, paths of 255 bytes at
most, no two names that differ only by case.

- A `.zip` made by Windows PowerShell 5.1 (`Compress-Archive`) separates
  folders with `\` and is refused at once: drop the folder instead.
- A file or folder name with `\ : * ? " < > |` is refused before anything
  is sent: Windows cannot use it. Rename it.
- A browser reads the file a link points to, where the command-line tool
  leaves the link out. Keep links out of the widget's folder.
- Your sources stay private: only PlayerVox reviewers read them, sometimes
  with an AI's help unless you refuse, besides your own publish keys
  (`submit` reads back a version it already sent), and every access shows
  in the creator space.

A publisher sends at most 20 submissions in 24 hours; the page says when
the next one is possible. If the page is closed or the connection drops
while sending, drop the same folder again: the submission resumes, and
nothing is counted twice.

## The checks

The checks take about a minute: the manifest, the version number, the code,
the package build, the permissions, the size. You can leave the page: an
e-mail tells you when they end.

- When a check fails, each problem is shown in your own files, with the
  line and the correction. Fix it and send again; nothing reaches the
  reviewers.
- "Problem on our side" means PlayerVox could not run the checks: your
  code is not the cause. PlayerVox is told and runs them again.

## Submit for review

When the checks pass, the version page says what changes for players:

- **Permissions.** Explain why the widget needs each new or widened
  permission, in words players understand. A first version explains all of
  them. A [third-party account](accounts.md) (`account:<id>`) is explained
  too, with each route and `write` scope that can change the player's
  account.
- **Privacy policy.** Required as soon as the widget uses the network. The
  address typed here is saved into the listing too.
- **Listing.** A first version goes to review with its listing, which needs
  an English description, a license and a support contact.
- **Release notes**, shown to players: optional. English comes first;
  **Add a language** adds others, 16 at most. When you write any, write
  them in English too.
- **Message for the review**, read only by PlayerVox: useful context. Never
  put a key, a token or a password there. Reviewers try a widget with an
  account using PlayerVox's own test account at the service, and its
  scenarios with fixtures, which a widget with an account needs. If your
  application at the service lets only listed users sign in, add that test
  account to it: the reviewer gives only its name in the review thread, and
  nobody ever sends a password or a key there.

The page also says which review the version gets (quick or full) and what
changed since the last approved version. **Submit for review** sends it.

Until one of your widgets is approved, you have one widget in review at a
time: another widget waits until the first is approved, refused or
withdrawn. Sending and checking it are not blocked, and a new version of
the widget in review takes its place.

## From a terminal or a CI job

`overcrow-widget submit` sends a version with a publish key, and stops at
the same screen when something is missing: see [`submit`](cli.md#submit) and
[publish keys and CI](publish-keys.md).

## After the review

PlayerVox aims to publish an approved version within 24 business hours.
You can withdraw it with **Withdraw this version**, or the whole widget with
**Remove from the catalog**, in **Settings**: it leaves the catalog at the
next publication, and installed copies keep working. Until then you can
cancel the withdrawal. See [withdrawal](widget-review.md#withdrawal).
