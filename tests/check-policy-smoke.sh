#!/bin/sh
set -eu
repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
policy="$repo_root/scripts/check-policy.sh"
fixture="$repo_root/.policy-secret-fixture"
cleanup() { /usr/bin/rm -f -- "$fixture"; }
trap cleanup EXIT HUP INT TERM
# Tailwind's mask utility names contain a token-like substring, not a credential.
printf '%s\n' 'mask-image-linear-from-color mask-image-radial-from-position' >"$fixture"
if ! "$policy"; then
    printf '%s\n' 'error: policy scan rejected ordinary CSS utility names' >&2
    exit 1
fi
if /usr/bin/grep -E \
        'command -v rg|(^|[[:space:]])rg([[:space:]]|$)' \
        "$policy" >/dev/null; then
    printf '%s\n' 'error: policy scan depends on non-baseline ripgrep' >&2
    exit 1
fi
printf '%s\\n' '-----BEGIN PRIVATE '"KEY-----" >"$fixture"
if "$policy"; then exit 1; fi
for block in 'ENCRYPTED PRIVATE KEY' 'DSA PRIVATE KEY' 'PGP PRIVATE KEY BLOCK'; do
    printf '%s\\n' "-----BEGIN $block-----" >"$fixture"
    if "$policy"; then exit 1; fi
done
printf '%s\\n' 'g'"hp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN" >"$fixture"
if "$policy"; then exit 1; fi
for secret in \
    'AGE-SECRET-'"KEY-1abcdefghijklmnopqrstuvwxyz" \
    'sk'"-abcdefghijklmnopqrstuvwxyz" \
    'sk'"-proj-abcdefghijklmnopqrstuvwxyz" \
    'sk'"-proj_abcdefghijklmnopqrstuvwxyz" \
    'xox'"b-abcdefghijklmnopqrstuvwxyz" \
    'AKIA'"ABCDEFGHIJKLMNOP"; do
    printf '%s\\n' "$secret" >"$fixture"
    if "$policy"; then exit 1; fi
done
printf '{"token":"%s"}\n' 'sk'"-proj-abcdefghijklmnopqrstuvwxyz" >"$fixture"
if "$policy"; then exit 1; fi
printf 'Authorization: Bearer %s\n' 'sk'"-proj-abcdefghijklmnopqrstuvwxyz" >"$fixture"
if "$policy"; then exit 1; fi
cleanup
"$policy"
