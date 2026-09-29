#!/bin/sh
# scripts/ci-verify.sh end to end on a throwaway clone: the exact candidate
# revision is admitted, never the base; reserved IDs are refused to a fork;
# a directory that is not a v1 source project, a trusted-path change and a
# Git archive attack fail; a trusted push runs its checks and writes the
# admission bundles its receipt names.
#
# The trusted admission tool is built once into a private cache of this run
# (CI_VERIFY_TOOL_TARGET); set TMPDIR to put the run on a large disk.
set -eu
umask 077

if test "$#" -ne 0; then
    printf '%s\n' 'usage: ci-admission-smoke.sh' >&2
    exit 2
fi

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
scratch=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/marketplace-ci-admission.XXXXXXXXXX")
scratch=$(CDPATH='' cd -- "$scratch" && pwd -P)
cleanup() {
    /usr/bin/rm -rf -- "$scratch"
}
trap cleanup EXIT HUP INT TERM

report_failure() {
    printf 'error: %s\n' "$1" >&2
    /usr/bin/cat "$stdout" "$stderr" >&2 || :
    exit 1
}

repository="$scratch/repository"
/usr/bin/git clone --quiet --no-hardlinks -- "$repo_root" "$repository"
/usr/bin/git -C "$repository" config user.name 'Marketplace CI Test'
/usr/bin/git -C "$repository" config user.email \
    'marketplace-ci-test@invalid.example'
# During a red/green run the driver may not be committed yet: the fixture's
# trusted revision holds this working tree exactly.
# shellcheck disable=SC2016 # the inner scripts expand their own arguments
/usr/bin/git -C "$repo_root" ls-files -z -m -o --exclude-standard \
    | /usr/bin/xargs -0 -r sh -c '
        source=$1 target=$2
        shift 2
        for relative; do
            if test -f "$source/$relative"; then
                /usr/bin/install -D -m 0644 -- "$source/$relative" "$target/$relative"
            fi
        done' copy "$repo_root" "$repository"
# shellcheck disable=SC2016
/usr/bin/git -C "$repo_root" ls-files -z -d \
    | /usr/bin/xargs -0 -r sh -c '
        target=$1
        shift
        for relative; do /usr/bin/rm -f -- "$target/$relative"; done' remove "$repository"
/usr/bin/chmod 0755 "$repository/scripts/ci-verify.sh"

cli() {
    cargo run --quiet --locked --manifest-path "$repo_root/Cargo.toml" \
        -p overcrow-widget-cli -- "$@"
}
widget() {
    directory="$repository/widgets/$1"
    cli init "$directory" --template counter --id com.example.counter >/dev/null
    node - "$directory/manifest.json" "$2" <<'JS'
const fs = require('node:fs');
const [manifestPath, id] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.id = id;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
JS
    printf '%s\n' '{"author":"Example","spdxLicense":"MIT","sourceUrl":"https://github.com/example/counter","defaultLocale":"en","localizations":[{"locale":"en","name":"Counter","description":"Counts."}]}' \
        >"$directory/listing.json"
}
widget example-counter com.example.counter
widget playervox-counter com.playervox.overcrow.smoke-counter
/usr/bin/git -C "$repository" add -A
/usr/bin/git -C "$repository" commit --quiet -m 'trusted driver fixture'
trust_sha=$(/usr/bin/git -C "$repository" rev-parse --verify 'HEAD^{commit}')

private_parent="$scratch/private"
tool_target="$scratch/tool-target"
/usr/bin/install -d -m 0700 -- "$private_parent" "$tool_target"
CI_VERIFY_TOOL_TARGET=$tool_target
export CI_VERIFY_TOOL_TARGET
stdout="$scratch/stdout"
stderr="$scratch/stderr"

candidate() {
    /usr/bin/git -C "$repository" checkout --quiet -B "$1" "$trust_sha"
    shift
    "$@"
    /usr/bin/git -C "$repository" add -A
    /usr/bin/git -C "$repository" commit --quiet --allow-empty -m candidate
    /usr/bin/git -C "$repository" rev-parse --verify 'HEAD^{commit}'
}
pull_request() {
    sh "$repo_root/scripts/ci-verify.sh" \
        "$repository" "$trust_sha" "$2" pull_request \
        Valhallab/playervox-overcrow-releases candidate \
        "$1" feature/widget "$private_parent" admission \
        >"$stdout" 2>"$stderr"
}
fork=contributor/playervox-overcrow-releases
same=Valhallab/playervox-overcrow-releases
expect_refusal() {
    if pull_request "$1" "$2"; then
        report_failure "CI admitted $4"
    fi
    /usr/bin/grep -F -x "error: $3" "$stderr" >/dev/null \
        || report_failure "$4 was not refused explicitly"
    test ! -s "$stdout" || report_failure "$4 produced a receipt"
}

break_view() {
    printf '%s\n' '<box>' >"$repository/widgets/example-counter/view.ocml"
}
expect_refusal "$fork" "$(candidate broken break_view)" \
    'candidate artifact admission failed' 'a broken view'

reserve() {
    widget new-reserved com.playervox.overcrow.forked
}
reserved_sha=$(candidate reserved reserve)
expect_refusal "$fork" "$reserved_sha" \
    'candidate artifact admission failed' 'a reserved ID from a fork'
/usr/bin/grep -F 'admission.reserved_id' "$stderr" >/dev/null \
    || report_failure 'the reserved ID refusal was not reported'
pull_request "$same" "$reserved_sha" \
    || report_failure 'a reserved ID from the releases repository was refused'

edit_reserved() {
    printf '%s\n' '// edited by a fork' \
        >>"$repository/widgets/playervox-counter/logic.ts"
}
expect_refusal "$fork" "$(candidate edited edit_reserved)" \
    'candidate artifact admission failed' 'a fork editing a reserved widget'

web_directory() {
    /usr/bin/install -d "$repository/widgets/other-web"
    printf '%s\n' '{"schemaVersion":1,"apiVersion":"1"}' \
        >"$repository/widgets/other-web/manifest.json"
}
expect_refusal "$fork" "$(candidate web web_directory)" \
    'candidate artifact admission failed' 'a directory that is not a v1 project'

weaken_schema() {
    printf '%s\n' '// weakened validator' \
        >>"$repository/crates/overcrow-widget-schema/src/limits.rs"
}
expect_refusal "$fork" "$(candidate contract weaken_schema)" \
    'pull-request trusted-path policy rejected' 'a widget schema change'
weaken_cli() {
    printf '%s\n' '// weakened admission' >>"$repository/cli/src/admit.rs"
}
expect_refusal "$fork" "$(candidate tool weaken_cli)" \
    'pull-request trusted-path policy rejected' 'an admission tool change'

# The root .gitattributes is a trusted path; a nested one still reaches git
# archive and must be caught by the snapshot comparison.
hide_file() {
    printf '%s\n' 'hidden.txt export-ignore' \
        >"$repository/widgets/example-counter/.gitattributes"
    printf '%s\n' 'hidden from git archive' \
        >"$repository/widgets/example-counter/hidden.txt"
}
expect_refusal "$fork" "$(candidate archive hide_file)" \
    'candidate snapshot admission failed' 'Git archive bytes that differ from the tree'

touch_docs() {
    printf '\n' >>"$repository/docs/creator-guide.md"
    widget new-third-party com.example.new-counter
}
valid_sha=$(candidate valid touch_docs)
valid_tree=$(/usr/bin/git -C "$repository" rev-parse --verify "$valid_sha^{tree}")
pull_request "$fork" "$valid_sha" \
    || report_failure 'the exact valid candidate revision was refused'
tab=$(printf '\t')
/usr/bin/grep -F -x "admission${tab}3${tab}$trust_sha${tab}$valid_sha${tab}$valid_tree" \
    "$stdout" >/dev/null || report_failure 'the receipt header is wrong'
/usr/bin/grep -F -x "legacy${tab}widgets/warframe-market" "$stdout" >/dev/null \
    || report_failure 'the legacy widget is not recorded'
/usr/bin/awk -F '\t' '
    function digest(value) { return length(value) == 64 && value !~ /[^0-9a-f]/ }
    function count(value) { return value ~ /^[1-9][0-9]*$/ }
    $1 == "artifact" && NF == 11 && digest($6) && count($7) && digest($8) \
        && count($9) && digest($10) && count($11) {
        seen[$2 " " $3 " " $4 " " $5] = 1
    }
    END {
        exit (("widgets/example-counter playervox com.example.counter 0.1.0" in seen) \
            && ("widgets/new-third-party third-party com.example.new-counter 0.1.0" in seen) \
            && ("widgets/playervox-counter playervox com.playervox.overcrow.smoke-counter 0.1.0" in seen)) ? 0 : 1
    }' "$stdout" || report_failure 'the receipt artifacts are wrong'
test "$(/usr/bin/tail -n 1 "$stdout")" = 'Hosted static admission passed' \
    && test "$(/usr/bin/wc -l <"$stdout")" -eq 6 \
    || report_failure 'the receipt is incomplete'

failing_test() {
    printf '%s\n' 'throw new Error("trusted push tests must execute");' \
        >"$repository/tests/warframe-market/market.test.mjs"
}
push_sha=$(candidate push failing_test)
# A push is its own trusted revision: run the driver of that checkout.
if sh "$repository/scripts/ci-verify.sh" \
        "$repository" "$push_sha" "$push_sha" push "$same" candidate \
        "$same" candidate "$private_parent" admission >"$stdout" 2>"$stderr"; then
    report_failure 'CI skipped the checks of an exact trusted push'
fi
/usr/bin/grep -F -x 'error: trusted source checks failed' "$stderr" >/dev/null \
    || report_failure 'the trusted push failure was not explicit'

output="$scratch/output"
/usr/bin/install -d -m 0700 -- "$output"
/usr/bin/git -C "$repository" checkout --quiet "$trust_sha"
sh "$repository/scripts/ci-verify.sh" \
    "$repository" "$trust_sha" "$trust_sha" push "$same" candidate \
    "$same" candidate "$private_parent" admission "$output" \
    >"$stdout" 2>"$stderr" || report_failure 'the trusted push was refused'
/usr/bin/head -n -1 "$stdout" | /usr/bin/cmp -s - "$output/receipt.tsv" \
    || report_failure 'the written receipt differs from the printed one'
index=0
/usr/bin/awk -F '\t' '$1 == "artifact" { print $6, $8, $10 }' "$output/receipt.tsv" \
    >"$scratch/digests"
check_digest() {
    test "$(/usr/bin/sha256sum "$1" | /usr/bin/cut -d ' ' -f 1)" = "$2" \
        || report_failure "$1 does not match the receipt"
}
while read -r package listing report; do
    index=$((index + 1))
    check_digest "$output/bundles/$index/package.ocpkg" "$package"
    check_digest "$output/bundles/$index/listing.json" "$listing"
    check_digest "$output/bundles/$index/report.json" "$report"
done <"$scratch/digests"
test "$index" -eq 2 || report_failure 'the output does not hold one bundle per widget'
/usr/bin/find "$private_parent" -mindepth 1 -maxdepth 1 -name 'verification.*' \
    -print -quit | /usr/bin/grep . >/dev/null \
    && report_failure 'a verification directory was left behind'

printf '%s\n' 'CI exact-revision admission smoke tests passed'
