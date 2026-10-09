#!/bin/sh
# Copies the conformance fixtures into fuzz/corpus/<target>/ as the initial
# corpus of each fuzz target. Run from the repository root.
set -eu
LC_ALL=C
export LC_ALL

schema=crates/overcrow-widget-schema/fixtures
format=crates/overcrow-widget-format/fixtures

seed() {
    target=$1
    shift
    mkdir -p "fuzz/corpus/$target"
    count=0
    for file in "$@"; do
        if [ -f "$file" ]; then
            # Numbered: several fixtures share a file name (`seed.json`).
            count=$((count + 1))
            cp "$file" "fuzz/corpus/$target/seed-$count"
        fi
    done
}

seed ocml "$format"/ocml/valid/*.ocml "$format"/ocml/invalid/*.ocml
seed ocss "$format"/ocss/valid/*.ocss "$format"/ocss/invalid/*.ocss \
    "$schema"/package-src/clock/style.ocss
seed validate_manifest "$schema"/manifest/valid/*.json \
    "$schema"/manifest/invalid/*.json
seed read_package "$schema"/package/valid/*.ocpkg "$schema"/package/invalid/*.ocpkg
# Packages are ZIPs too: they seed the CLI's creator tools and source ZIP
# readers.
seed creator_tools_zip "$schema"/package/valid/*.ocpkg "$schema"/package/invalid/*.ocpkg
seed source_zip "$schema"/package/valid/*.ocpkg "$schema"/package/invalid/*.ocpkg
seed validate_compiled_view "$schema"/view/valid/*.json "$schema"/view/invalid/*.json \
    "$format"/ocml/compiled/*.view.json
seed open_envelope "$schema"/catalog/valid/*.json "$schema"/catalog/invalid/*.json \
    "$schema"/seed/*/*/seed.json

# One template expression per file, taken from the golden expression tables.
mkdir -p fuzz/corpus/expression
index=0
for table in "$format"/ocml/compiled/*.expressions.txt; do
    while IFS="$(printf '\t')" read -r _ _ _ text; do
        if [ -n "$text" ]; then
            index=$((index + 1))
            printf '%s' "$text" > "fuzz/corpus/expression/seed-$index"
        fi
    done < "$table"
done
