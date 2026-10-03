#!/bin/sh
# Static admission of the marketplace CI (docs/review-policy.md): the
# reviewed base builds `overcrow-widget` offline, the exact candidate tree is
# materialized as data, and every widget directory goes through
# `overcrow-widget admit`. Nothing of the candidate is built or executed.
#
#   ci-verify.sh                      local checks of this checkout
#   ci-verify.sh REPOSITORY TRUST-SHA REVIEW-SHA EVENT REPOSITORY-NAME \
#       BASE-REF HEAD-REPOSITORY HEAD-REF PRIVATE-PARENT admission [OUTPUT]
#
# OUTPUT (trusted pushes only) receives the receipt and one admission bundle
# per widget, for the maintainers' private catalog tooling.
set -eu
umask 077

usage() {
    printf '%s\n' \
        'usage: ci-verify.sh [REPOSITORY TRUST-SHA REVIEW-SHA EVENT REPOSITORY-NAME BASE-REF HEAD-REPOSITORY HEAD-REF PRIVATE-PARENT admission [OUTPUT]]' >&2
}

fail() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
trusted_root=$(/usr/bin/dirname -- "$script_dir")

run_local_checks() {
    local_root=$1
    (
        CDPATH='' cd -- "$local_root"
        node --test --test-concurrency=2 \
            tests/check-links.test.mjs tests/docs-content.test.mjs \
            tests/widget-previews.test.mjs
        # The built-ins' copies of widgets-shared/ are current.
        node scripts/sync-shared-widgets.mjs --check
        for directory in widgets/*/; do
            directory=${directory%/}
            cargo run -p overcrow-widget-cli --locked --quiet -- \
                admit "$directory" --publisher playervox >/dev/null
        done
    )
}

if test "$#" -eq 0; then
    run_local_checks "$trusted_root"
    exit 0
fi
if { test "$#" -ne 10 && test "$#" -ne 11; } \
        || test "${10}" != admission; then
    usage
    exit 2
fi

repository=$1
trust_sha=$2
review_sha=$3
event_name=$4
repository_name=$5
base_ref=$6
head_repository=$7
head_ref=$8
private_parent=$9
admission_output=${11:-}

valid_revision() {
    case "$1" in '' | *[!0-9a-f]*) return 1 ;; esac
    test "${#1}" -eq 40
}

safe_owned_directory() {
    directory=$1
    expected_mode=${2:-}
    test -d "$directory" && test ! -L "$directory" \
        && test "$(CDPATH='' cd -- "$directory" 2>/dev/null && pwd -P || :)" \
            = "$directory" \
        && test "$(/usr/bin/stat -c '%u' "$directory" 2>/dev/null || :)" \
            = "$(/usr/bin/id -u)" \
        && test -z "$(/usr/bin/find "$directory" -maxdepth 0 \
            -perm /0022 -print -quit)" \
        && { test -z "$expected_mode" \
            || test "$(/usr/bin/stat -c '%a' "$directory")" \
                = "$expected_mode"; }
}

case "$event_name" in pull_request | push) ;; *)
    fail 'CI trust metadata is invalid'
    ;;
esac
case "$base_ref" in main | candidate) ;; *)
    fail 'CI trust metadata is invalid'
    ;;
esac
if ! valid_revision "$trust_sha" || ! valid_revision "$review_sha"; then
    fail 'CI trust metadata is invalid'
fi
case "$repository:$private_parent" in /*:/*) ;; *)
    fail 'CI trust metadata is invalid'
    ;;
esac
if test "$repository" = / || test "$trusted_root" = / \
        || test "$private_parent" = / \
        || ! safe_owned_directory "$repository" \
        || ! safe_owned_directory "$trusted_root" \
        || ! safe_owned_directory "$private_parent" 700; then
    fail 'CI trust roots are unsafe'
fi
if test -n "$admission_output"; then
    case "$admission_output" in /*) ;; *)
        fail 'admission output is unsafe'
        ;;
    esac
    case "$admission_output" in
        "$repository" | "$repository"/* | "$trusted_root" | "$trusted_root"/*)
            fail 'admission output is unsafe'
            ;;
    esac
    if test "$event_name" != push \
            || ! safe_owned_directory "$admission_output" 700 \
            || test -n "$(/usr/bin/find "$admission_output" -mindepth 1 \
                -print -quit)"; then
        fail 'admission output is unsafe'
    fi
fi
if test "$event_name" = push \
        && { test "$trust_sha" != "$review_sha" \
            || test "$repository_name" != "$head_repository"; }; then
    fail 'CI trust metadata is invalid'
fi
# Reserved com.playervox.* IDs: reviewed pushes and pull requests from the
# releases repository itself. A fork's pull request is a third party, except
# for widget directories it leaves unchanged (already reviewed and merged).
if test "$repository_name" = "$head_repository"; then
    same_repository=yes
else
    same_repository=no
fi
for required in Cargo.lock Cargo.toml rust-toolchain.toml \
        cli/Cargo.toml cli/src/main.rs cli/src/admit.rs cli/src/snapshot.rs \
        scripts/ci-verify.sh scripts/materialize-git-snapshot.sh \
        scripts/resolve-pinned-rust.sh \
        scripts/resolve-system-node.sh \
        tests/reject-published-change.sh tests/reject-trusted-change.sh; do
    if test ! -f "$trusted_root/$required" \
            || test -L "$trusted_root/$required"; then
        fail 'trusted CI driver is incomplete'
    fi
done

ci_git() {
    /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
        /usr/bin/timeout --signal=KILL 15 \
        /usr/bin/prlimit --cpu=10 --as=1073741824 --nofile=128 \
            --fsize=33554432 -- \
        /usr/bin/git --no-replace-objects \
            -c core.fsmonitor=false -c core.hooksPath=/dev/null \
            -c core.attributesFile=/dev/null -c core.excludesFile=/dev/null \
            -c commit.gpgSign=false -c diff.external= -C "$repository" "$@"
}

resolved_trust=$(ci_git rev-parse --verify "$trust_sha^{commit}" 2>/dev/null) \
    || resolved_trust=''
resolved_review=$(ci_git rev-parse --verify "$review_sha^{commit}" 2>/dev/null) \
    || resolved_review=''
review_tree=$(ci_git rev-parse --verify "$review_sha^{tree}" 2>/dev/null) \
    || review_tree=''
if test "$resolved_trust" != "$trust_sha" \
        || test "$resolved_review" != "$review_sha" \
        || ! valid_revision "$review_tree"; then
    fail 'CI trust metadata is invalid'
fi

work=$(/usr/bin/mktemp -d "$private_parent/verification.XXXXXXXXXX") \
    || exit 1
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    /usr/bin/rm -rf -- "$work"
    exit "$status"
}
trap cleanup EXIT HUP INT TERM

changed_paths="$work/changed-paths.nul"
/usr/bin/install -m 0600 /dev/null "$changed_paths"
if test "$event_name" = pull_request; then
    if ! ci_git diff --name-only -z --no-renames \
            "$trust_sha" "$review_sha" -- >"$changed_paths" \
            || test "$(/usr/bin/stat -c '%u:%a:%h' "$changed_paths")" \
                != "$(/usr/bin/id -u):600:1" \
            || test "$(/usr/bin/stat -c '%s' "$changed_paths")" \
                -gt 262144; then
        fail 'pull-request path metadata is unsafe'
    fi
    sh "$trusted_root/tests/reject-published-change.sh" \
        pull_request "$repository_name" "$base_ref" \
        "$head_repository" "$head_ref"
    /usr/bin/xargs -0 -r -- \
        sh "$trusted_root/tests/reject-published-change.sh" \
            pull_request "$repository_name" "$base_ref" \
            "$head_repository" "$head_ref" <"$changed_paths"
    /usr/bin/xargs -0 -r -- \
        sh "$trusted_root/tests/reject-trusted-change.sh" <"$changed_paths"
fi

resolved_rust=$(sh "$trusted_root/scripts/resolve-pinned-rust.sh" \
    "$trusted_root") || {
    fail 'trusted admission tool is unavailable'
}
tab=$(printf '\t')
IFS="$tab" read -r toolchain_root cargo_path rustc_path \
    cargo_index cargo_cache cargo_sources <<EOF
$resolved_rust
EOF
if test -z "$cargo_sources"; then
    fail 'trusted admission tool is unavailable'
fi
tool_home="$work/home"
tool_cargo_home="$work/cargo-home"
tool_rustup_home="$work/rustup-home"
# The trusted build's target directory. CI_VERIFY_TOOL_TARGET lets the local
# smoke test reuse one private cache across its runs; it only ever holds
# builds of the reviewed base, never candidate code.
tool_target=${CI_VERIFY_TOOL_TARGET:-"$work/target"}
case "$tool_target" in /*) ;; *)
    fail 'trusted admission tool is unavailable'
    ;;
esac
if ! /usr/bin/install -d -m 0700 \
        "$tool_home" "$tool_cargo_home/registry" \
        "$tool_rustup_home" "$tool_target" \
        || ! safe_owned_directory "$tool_target" 700 \
        || ! /usr/bin/ln -s -- "$cargo_index" \
            "$tool_cargo_home/registry/index" \
        || ! /usr/bin/ln -s -- "$cargo_cache" \
            "$tool_cargo_home/registry/cache" \
        || ! /usr/bin/ln -s -- "$cargo_sources" \
            "$tool_cargo_home/registry/src"; then
    fail 'trusted admission tool is unavailable'
fi
# The CLI links oxc: a cold debug build took 57 s with two jobs locally
# (943 MB of target). The limits bound it, not the admission itself.
trusted_cargo() {
    (CDPATH='' cd / && \
        /usr/bin/env -i \
            PATH="$toolchain_root/bin:/usr/bin:/bin" \
            HOME="$tool_home" CARGO_HOME="$tool_cargo_home" \
            RUSTUP_HOME="$tool_rustup_home" RUSTC="$rustc_path" \
            CARGO_NET_OFFLINE=true CARGO_INCREMENTAL=0 \
            CARGO_TARGET_DIR="$tool_target" LC_ALL=C.UTF-8 LANG=C.UTF-8 \
            /usr/bin/timeout --signal=TERM --kill-after=5 600 \
            /usr/bin/prlimit --cpu=600 --as=8589934592 --nproc=4096 \
                --nofile=1024 --fsize=1073741824 -- \
            "$cargo_path" "$@")
}
if test "$event_name" = push; then
    node_path=$(sh "$trusted_root/scripts/resolve-system-node.sh") || {
        fail 'trusted source checks failed'
    }
    # Test output goes to the log (stderr): stdout is the receipt only. Only
    # tests that need nothing built run here.
    if ! /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C.UTF-8 LANG=C.UTF-8 \
            /usr/bin/timeout --signal=TERM --kill-after=5 60 \
            "$node_path" --test \
                "$trusted_root/tests/check-links.test.mjs" >&2; then
        fail 'trusted source checks failed'
    fi
fi
if ! trusted_cargo build --manifest-path "$trusted_root/cli/Cargo.toml" \
        --package overcrow-widget-cli --bin overcrow-widget \
        --locked --offline --quiet; then
    fail 'trusted admission tool is unavailable'
fi
built_tool="$tool_target/debug/overcrow-widget"
trusted_tool="$work/overcrow-widget"
if test ! -f "$built_tool" || test -L "$built_tool" \
        || ! /usr/bin/install -m 0700 -- "$built_tool" "$trusted_tool" \
        || test "$(/usr/bin/stat -c '%u:%a:%h' "$trusted_tool")" \
            != "$(/usr/bin/id -u):700:1"; then
    fail 'trusted admission tool is unavailable'
fi

candidate_root="$work/candidate"
if ! sh "$trusted_root/scripts/materialize-git-snapshot.sh" --validated \
        "$repository" "$review_sha" "$candidate_root" "$trusted_tool"; then
    fail 'candidate snapshot admission failed'
fi
widgets_root="$candidate_root/widgets"
widget_list="$work/widgets"
if test ! -d "$widgets_root" || test -L "$widgets_root" \
        || test -n "$(/usr/bin/find "$widgets_root" -mindepth 1 -maxdepth 1 \
            ! -type d -print -quit)" \
        || ! /usr/bin/find "$widgets_root" -mindepth 1 -maxdepth 1 \
            -type d -printf '%f\n' | LC_ALL=C /usr/bin/sort >"$widget_list";
then
    fail 'candidate artifact admission failed'
fi
widget_count=$(/usr/bin/wc -l <"$widget_list")
if test "$widget_count" -eq 0 || test "$widget_count" -gt 512 \
        || test "$(/usr/bin/stat -c '%s' "$widget_list")" -gt 131072; then
    fail 'candidate artifact admission failed'
fi

# The admission tool reads only the materialized snapshot; it runs with an
# empty environment and bounded resources, like Git above.
admit() {
    /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C.UTF-8 LANG=C.UTF-8 \
        HOME="$tool_home" \
        /usr/bin/timeout --signal=KILL 60 \
        /usr/bin/prlimit --cpu=30 --as=4294967296 --nofile=256 \
            --fsize=67108864 -- \
        "$trusted_tool" admit "$@"
}

bundles="$work/bundles"
receipt="$work/admission-receipt.tsv"
identities="$work/identities"
/usr/bin/install -d -m 0700 -- "$bundles"
/usr/bin/install -m 0600 /dev/null "$receipt"
/usr/bin/install -m 0600 /dev/null "$identities"
printf 'admission\t3\t%s\t%s\t%s\n' \
    "$trust_sha" "$review_sha" "$review_tree" >"$receipt"
artifact_index=0
while IFS= read -r directory; do
    case "$directory" in
        '' | -* | *[!A-Za-z0-9._-]*)
            fail 'candidate artifact admission failed'
            ;;
    esac
    source="$widgets_root/$directory"
    artifact_index=$((artifact_index + 1))
    bundle="$bundles/$artifact_index"
    summary="$work/admit-$artifact_index.out"
    publisher=playervox
    if test "$same_repository" = no \
            && /usr/bin/tr '\000' '\n' <"$changed_paths" \
                | /usr/bin/awk -v prefix="widgets/$directory" '
                    $0 == prefix || index($0, prefix "/") == 1 { found = 1 }
                    END { exit found ? 0 : 1 }'; then
        publisher=third-party
    fi
    if test "$publisher" = playervox; then
        admit "$source" --publisher playervox --deny-warnings --out "$bundle" \
            >"$summary" 2>"$work/admit.err" || admitted=no
    else
        admit "$source" --deny-warnings --out "$bundle" \
            >"$summary" 2>"$work/admit.err" || admitted=no
    fi
    if test "${admitted:-yes}" = no; then
        # The report is sanitized by the tool: it is safe for the CI log.
        /usr/bin/head -c 65536 -- "$work/admit.err" >&2 || :
        /usr/bin/head -c 65536 -- "$summary" >&2 || :
        fail 'candidate artifact admission failed'
    fi
    IFS=' ' read -r widget_id widget_version _rest <"$summary"
    case "$widget_id:$widget_version" in
        *[!A-Za-z0-9.:+-]* | :* | *:)
            fail 'candidate artifact admission failed'
            ;;
    esac
    line="widgets/$directory$tab$publisher$tab$widget_id$tab$widget_version"
    for file in package.ocpkg listing.json report.json; do
        if test ! -f "$bundle/$file" || test -L "$bundle/$file"; then
            fail 'candidate artifact admission failed'
        fi
        digest=$(/usr/bin/sha256sum "$bundle/$file" | /usr/bin/cut -d ' ' -f 1)
        bytes=$(/usr/bin/stat -c '%s' "$bundle/$file")
        line="$line$tab$digest$tab$bytes"
    done
    printf '%s\n' "$widget_id" >>"$identities"
    printf 'artifact\t%s\n' "$line" >>"$receipt"
done <"$widget_list"
if test "$artifact_index" -eq 0 \
        || test -n "$(LC_ALL=C /usr/bin/sort "$identities" \
            | /usr/bin/uniq -d)"; then
    fail 'candidate artifact admission failed'
fi

if test -n "$admission_output"; then
    if ! /usr/bin/cp -R -- "$bundles" "$admission_output/bundles" \
            || ! /usr/bin/install -m 0600 -- "$receipt" \
                "$admission_output/receipt.tsv"; then
        fail 'admission output could not be written'
    fi
fi

/usr/bin/cat "$receipt"
printf '%s\n' 'Hosted static admission passed'
