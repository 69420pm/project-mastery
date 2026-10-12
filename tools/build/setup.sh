#!/usr/bin/env bash
# Prepares the worktree that /build works in for one spec:
#
#   tools/build/setup.sh <spec-issue> [type]
#
# Run it from the root of the worktree that EnterWorktree created. It renames
# the worktree's branch to `<type>/<issue>-<slug>`, links the main checkout's
# .env.local, installs dependencies and prints the spec. The type comes from
# the issue's label (`type: bug` is fix, `type: docs` docs, `type: task` chore,
# anything else feat) unless given, e.g. `refactor`. Safe to run again.
set -euo pipefail

usage='usage: tools/build/setup.sh <spec-issue> [feat|fix|refactor|chore|docs]'
issue=${1:?$usage}
type=${2:-}
[[ "$issue" =~ ^[0-9]+$ && "$type" =~ ^(feat|fix|refactor|chore|docs)?$ ]] || {
  echo "$usage (got '$*')" >&2
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
if [[ -z "$type" ]]; then
  case $(jq -r '[.labels[].name | select(startswith("type: "))][0] // ""' <<<"$json") in
  "type: bug") type=fix ;;
  "type: docs") type=docs ;;
  "type: task") type=chore ;;
  *) type=feat ;;
  esac
fi

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
