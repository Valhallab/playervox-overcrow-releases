## Widget submission

Directory: `widgets/<dir>/` (widget API v1 sources and `listing.json`)

Describe the widget, its intended game or use, and the exact revision tested.

## Review declarations

- [ ] `overcrow-widget admit widgets/<dir>` passes on this revision (paste its
      report or `--format json` output below).
- [ ] The widget ID is under a domain I control; it is not `com.playervox.*`.
- [ ] Every network route, capability, clipboard write and storage use serves
      the widget's stated purpose.
- [ ] Source, assets, fonts, preview, and third-party licenses have documented
      provenance; `LICENSE` matches `spdxLicense`.
- [ ] Listing text is present in every declared locale.
- [ ] This PR targets `candidate` and does not modify `published/`.

## Evidence

List the exact local commands run and their results. Note any supported-desktop
or game checks that still require maintainer verification.
