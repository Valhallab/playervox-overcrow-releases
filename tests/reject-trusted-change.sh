#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

reject() {
    printf '%s\n' 'error: pull-request trusted-path policy rejected' >&2
    exit 1
}

for changed_path in "$@"; do
    case "$changed_path" in
        '' | -* | /* | */ | . | .. | ./* | ../* | */./* | */../* | */. | */.. | \
            *//* | *\\* | *[!A-Za-z0-9._+@/-]*) reject ;;
        .github | .github/* | scripts | scripts/* | tests | tests/* | \
            tools | tools/*) reject ;;
        # The admission tool is built from the reviewed base: the CLI and
        # the SDK it embeds in every bundle.
        cli | cli/* | sdk | sdk/*) reject ;;
        # The public widget contract and everything that builds or checks it.
        crates | crates/* | Cargo.toml | Cargo.lock | rust-toolchain.toml | \
            rust-toolchain | .cargo | .cargo/* | rustfmt.toml | .rustfmt.toml | \
            clippy.toml | .clippy.toml | deny.toml | .gitattributes | \
            .gitignore | docs/widget-schema-v1.md | keys | keys/* | \
            fixtures/keys | fixtures/keys/* | fuzz | fuzz/*) reject ;;
    esac
done
