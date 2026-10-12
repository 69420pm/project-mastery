#!/usr/bin/env bash
# Prepares the worktree that /build works in for one spec:
#
#   tools/build/setup.sh <spec-issue>
#
# Run it from the root of the worktree that EnterWorktree created. It renames
# the worktree's branch to `<type>/<issue>-<slug>` (feat, or fix for a spec
# labelled `type: bug`), links the main checkout's .env.local, installs
# dependencies and prints the spec. Safe to run again.
set -euo pipefail

issue=${1:?usage: tools/build/setup.sh <spec-issue>}
[[ "$issue" =~ ^[0-9]+$ ]] || {
  echo "usage: tools/build/setup.sh <spec-issue> (got '$issue')" >&2
  exit 1
}

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$root"
if [[ "$root" == "$main" ]]; then
  echo "Run this inside the /build worktree (EnterWorktree first), not in the main checkout." >&2
  exit 1
fi

json=$(gh issue view "$issue" --json title,body,labels)
title=$(jq -r .title <<<"$json")
type=feat
jq -e '.labels[] | select(.name == "type: bug")' <<<"$json" >/dev/null && type=fix

current=$(git branch --show-current)
if [[ "$current" != "$type/$issue-"* ]]; then
  # The first five words of the title, in kebab case.
  slug=$(tr '[:upper:]' '[:lower:]' <<<"$title" | sed -E 's/[^a-z0-9]+/ /g' |
    awk '{for (i = 1; i <= NF && i <= 5; i++) printf "%s%s", (i > 1 ? "-" : ""), $i}')
  git branch -m "$type/$issue-$slug"
fi
branch=$(git branch --show-current)

[[ -e .env.local ]] || ln -s "$main/.env.local" .env.local
pnpm install --frozen-lockfile --prefer-offline --reporter=silent

echo "Ready: $branch at $(git log -1 --format='%h %s')."
echo "PR title type: $type"
echo
echo "# Spec #$issue: $title"
echo
jq -r .body <<<"$json"
