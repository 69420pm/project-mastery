#!/usr/bin/env bash
# Prepares an agent worktree for one piece of work in a spec run:
#
#   tools/spec-run/setup-worktree.sh <integration-branch> <work-id>
#
# The work id is a ticket number, or a short name for other work, such as
# `review-spec` or `review-standards` for the final review fixes. Run it from
# the worktree root as the first command. It puts the worktree on the branch
# `<integration-branch>-<work-id>`, based on the integration branch (or
# switches to that branch if it already exists, with its commits), installs
# dependencies and links the main checkout's .env.local. For a ticket, it then
# prints the ticket brief (ticket-brief.sh). Safe to run again.
set -euo pipefail

usage="usage: setup-worktree.sh <integration-branch> <work-id>, e.g. setup-worktree.sh feat/42-exam-brief 43"
integration=${1:?$usage}
work=${2:?$usage}
if [[ ! "$work" =~ ^[a-z0-9][a-z0-9-]*$ || "$work" == "$integration"* ]]; then
  echo "'$work' is not a work id: give the ticket number or a short name such as review-spec, not a branch name." >&2
  echo "$usage" >&2
  exit 1
fi
branch="$integration-$work"

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
if [[ "$work" =~ ^[0-9]+$ ]]; then
  echo
  "$(dirname "$0")/ticket-brief.sh" "$work"
fi
