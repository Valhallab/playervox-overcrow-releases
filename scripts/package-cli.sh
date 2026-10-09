#!/bin/sh
# Assembles the widget CLI's release files from its two dist builds:
#
#   package-cli.sh LINUX-BINARY WINDOWS-BINARY OUTPUT-DIRECTORY
#
# OUTPUT-DIRECTORY (new or empty) receives, for the version of cli/Cargo.toml:
#
#   overcrow-widget-VERSION-linux-x86_64
#   overcrow-widget-VERSION-windows-x86_64.exe
#   overcrow-widget-VERSION-LICENSE.txt               the CLI's MIT license
#   overcrow-widget-VERSION-THIRD-PARTY-NOTICES.md    cargo-about 0.9.1
#   cli.json                                          version, commit, the
#                                                     pinned runtime, files
#   SHA256SUMS                                        every file above
#
# These files go into the creator tools ZIP of OverCrow's GitHub release,
# beside the headless runtimes; this script publishes nothing. The pinned
# runtime comes from the Linux binary itself (`--version --format json`):
# the release publisher checks that the ZIP holds that very runtime.
# The notices come from the locked graph of both targets (about.toml).
set -eu

if test "$#" -ne 3; then
    printf '%s\n' 'usage: package-cli.sh LINUX-BINARY WINDOWS-BINARY OUTPUT-DIRECTORY' >&2
    exit 2
fi
linux_binary=$1
windows_binary=$2
output=$3

fail() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"

about_version=$(cargo about --version 2>/dev/null) \
    || fail 'cargo-about 0.9.1 is required'
test "$about_version" = 'cargo-about 0.9.1' \
    || fail 'cargo-about 0.9.1 is required'
git diff --quiet HEAD -- || fail 'the checkout has uncommitted changes'
commit=$(git rev-parse HEAD)

version=$(sed -n 's/^version = "\(.*\)"$/\1/p' cli/Cargo.toml | head -n 1)
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$' \
    || fail "unsupported CLI version: $version"

test -f "$linux_binary" || fail "missing Linux binary: $linux_binary"
test -f "$windows_binary" || fail "missing Windows binary: $windows_binary"
test "$(head -c 4 "$linux_binary" | od -An -tx1 | tr -d ' \n')" = 7f454c46 \
    || fail "not an ELF executable: $linux_binary"
test "$(head -c 2 "$windows_binary")" = MZ \
    || fail "not a Windows executable: $windows_binary"
# The Linux build must be this version of the CLI; the Windows one is
# checked by the workflow that built it.
"$linux_binary" --version | grep -Fq "overcrow-widget $version " \
    || fail "$linux_binary is not overcrow-widget $version"
command -v jq > /dev/null || fail 'jq is required'
identity=$("$linux_binary" --version --format json)
runtime_version=$(printf '%s' "$identity" | jq -er '.runtime.version') \
    || fail "$linux_binary pins no headless runtime"
runtime_linux=$(printf '%s' "$identity" | jq -er '.runtime.sha256["linux-x86_64"]') \
    || fail 'no pinned Linux runtime'
runtime_windows=$(printf '%s' "$identity" | jq -er '.runtime.sha256["windows-x86_64"]') \
    || fail 'no pinned Windows runtime'
printf '%s\n' "$runtime_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$' \
    || fail "unsupported runtime version: $runtime_version"
for digest in "$runtime_linux" "$runtime_windows"; do
    printf '%s\n' "$digest" | grep -Eq '^[0-9a-f]{64}$' \
        || fail "invalid pinned runtime digest: $digest"
done

mkdir -p -- "$output"
test -z "$(ls -A -- "$output")" || fail "output directory is not empty: $output"

prefix=overcrow-widget-$version
linux_name=$prefix-linux-x86_64
windows_name=$prefix-windows-x86_64.exe
license_name=$prefix-LICENSE.txt
notices_name=$prefix-THIRD-PARTY-NOTICES.md

cp -- "$linux_binary" "$output/$linux_name"
cp -- "$windows_binary" "$output/$windows_name"
chmod 0755 "$output/$linux_name" "$output/$windows_name"
cp -- LICENSE "$output/$license_name"
cargo about generate --locked --offline --fail \
    --manifest-path cli/Cargo.toml --config about.toml \
    --output-file "$output/$notices_name" cli/third-party.hbs
test -s "$output/$notices_name" || fail 'empty third-party notices'
chmod 0644 "$output/$license_name" "$output/$notices_name"

entry() {
    size=$(wc -c < "$output/$1" | tr -d ' ')
    sha=$(sha256sum -- "$output/$1" | cut -d ' ' -f 1)
    printf '    {"name": "%s", "size": %s, "sha256": "%s"}' "$1" "$size" "$sha"
}
{
    printf '{\n  "schemaVersion": 1,\n  "version": "%s",\n' "$version"
    printf '  "sourceCommit": "%s",\n' "$commit"
    printf '  "runtime": {\n    "version": "%s",\n' "$runtime_version"
    printf '    "sha256": {\n      "linux-x86_64": "%s",\n' "$runtime_linux"
    printf '      "windows-x86_64": "%s"\n    }\n  },\n' "$runtime_windows"
    printf '  "files": [\n'
    entry "$linux_name"; printf ',\n'
    entry "$windows_name"; printf ',\n'
    entry "$license_name"; printf ',\n'
    entry "$notices_name"; printf '\n'
    printf '  ]\n}\n'
} > "$output/cli.json"
chmod 0644 "$output/cli.json"

(
    cd "$output"
    sha256sum -- "$linux_name" "$windows_name" "$license_name" \
        "$notices_name" cli.json > SHA256SUMS
    chmod 0644 SHA256SUMS
    cat SHA256SUMS
)
