#!/usr/bin/env bash
# Prepares an agent worktree for one ticket of a spec run:
#
#   tools/spec-run/setup-worktree.sh <integration-branch> <ticket-number>
#
# Run it from the worktree root as the first command. It puts the worktree on
# the ticket branch `<integration-branch>-<ticket-number>`, based on the
# integration branch (or switches to that branch if it already exists, with
# its commits), installs dependencies and links the main checkout's
# .env.local. Safe to run again.
set -euo pipefail

integration=${1:?usage: setup-worktree.sh <integration-branch> <ticket-number>}
ticket=${2:?usage: setup-worktree.sh <integration-branch> <ticket-number>}
branch="$integration-$ticket"

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$root"
if [[ "$root" == "$main" ]]; then
  echo "Run this inside an agent worktree, not in the main checkout." >&2
  exit 1
fi

if [[ $(git branch --show-current) != "$branch" ]]; then
  if [[ -n $(git status --porcelain) ]]; then
    echo "The worktree has uncommitted changes; commit them before switching to $branch." >&2
    exit 1
  fi
  # A ticket branch that already exists keeps its commits.
  if git rev-parse --quiet --verify "refs/heads/$branch" >/dev/null; then
    git switch --quiet "$branch"
  else
    git switch --quiet -c "$branch" "$integration"
  fi
fi

[[ -e .env.local ]] || ln -s "$main/.env.local" .env.local
pnpm install --frozen-lockfile --prefer-offline --reporter=silent

echo "Ready: $branch at $(git log -1 --format='%h %s'), based on $integration."
