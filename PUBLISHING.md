# Publishing OverCrow releases

Build and validate the application in its private source repository. This public
repository does not check out the private source or build the application.
GitHub release immutability is enabled for this repository. Finish and verify all
uploads in a draft before publishing; published assets and their tag are locked.

## Release sequence

1. Explicitly select a change type (major, minor, patch) and channel (beta or
   stable) in the private repository's release tooling. Beta iterations increment
   `beta.N`; promoting a beta removes the suffix and requires a new build.
2. Commit and integrate the synchronized version metadata. Dispatch the private
   release build for that exact version. Its quality checks and four native builds
   must all succeed for the same source revision.
3. Complete the applicable native installation/update qualification and write
   release notes intended for public readers. Never copy private build logs or
   private commit messages into release notes automatically.
4. Use the private repository's publisher to preview the validated build, then
   explicitly execute publication. It creates or resumes a matching draft here,
   uploads only the four packages, `release.json` and `SHA256SUMS`, and verifies
   the remote files before publishing. Beta releases are marked as pre-releases.
5. Advance only the matching channel after the complete release is published.
   If updating the channel fails, re-run publication for the same build to repair
   the channel. Never replace an existing asset, move a published tag, roll a
   channel back, or delete release history as part of normal publication.
6. Confirm the public channel and advertised packages are downloadable without
   authentication. Installation behavior is qualified separately on each OS.

The release manifest records the semantic version, source revision, platform,
filename, size, SHA-256 and public download URL. Channel documents describe
downloads; they do not assert that automatic installation is supported.
Checksums are integrity metadata, not cryptographic publisher signatures.
Authenticode, updater signatures and Linux archive signing have separate key
management and validation requirements; no signing key belongs in this repository
or its release assets.

## Automation boundary

The build workflow runs in the private source repository with read-only source
permissions. An explicit publisher command uses the maintainer's authenticated
GitHub CLI to retrieve the successful private build and publish the verified
assets here. This does not require copying a personal GitHub token into Actions.
No GitHub credential is embedded in the application or required by download
clients.

The pipeline must not upload application source archives, private build logs,
credentials, signing keys or debugging artifacts containing source code.

This repository does not have private-build credentials or check out private
source. GitHub's generated source archives contain only this public repository's
distribution documentation and metadata. The private release operator guide is
the authority for commands, prerequisites and current activation status.

## Hosting

GitHub Releases hosts the binary assets. GitHub Pages publishes only `docs/`
from the `main` branch. The site is served over HTTPS at:

https://valhallab.github.io/playervox-overcrow-releases/
