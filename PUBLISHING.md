# Publishing OverCrow releases

Build and validate the application in its private source repository. This public
repository does not check out the private source or build the application.

## Release sequence

1. Assign a new version and build the intended Windows and Linux packages from
   the same reviewed source revision. Never replace an already published build
   with different bytes under the same version.
2. Complete the applicable checks and native installation/update qualification.
3. Sign the final artifacts and produce their checksums and public release notes.
   Signing keys remain outside this repository and published assets.
4. Create a draft release here, upload the selected packages, detached signatures
   and checksums, and verify the uploaded assets. Mark beta releases as
   pre-releases; keep stable releases separate.
5. Publish the release, then update only the matching channel after validating
   its manifest against the Control Center's implemented update contract.
6. Confirm the public channel and every advertised artifact are downloadable
   without authentication and that the application verifies the update.

Do not populate the bootstrap channels until the updater contract, signing and
installation path are implemented. An empty channel is preferable to an
uninstallable or unverifiable update.

## Automation boundary

Future publication automation should run from the private build workflow and
upload only explicitly selected distribution files. Use a GitHub App installation
token or fine-grained token scoped to this distribution repository. No GitHub
credential is embedded in the application or required by download clients.

The pipeline must not upload application source archives, private build logs,
credentials, signing keys or debugging artifacts containing source code.

This repository is currently infrastructure only: it has no private-build
credentials and no automated release publication workflow.

## Hosting

GitHub Releases hosts the binary assets. GitHub Pages publishes only `docs/`
from the `main` branch. The site is served over HTTPS at:

https://valhallab.github.io/playervox-overcrow-releases/
