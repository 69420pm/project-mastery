#!/usr/bin/env bash
# Removes /build worktrees whose PRs are merged, from the main checkout:
#
#   tools/build/cleanup.sh [spec-issue ...]
#
# Without an issue it goes through every `.claude/worktrees/build-<issue>`.
# For each it stops the processes running in the worktree (the dev server from
# `pnpm -s agent up` and any other process whose working directory is inside
# it), removes the worktree and deletes its branch. It keeps everything when
# the PR is not merged or the worktree has uncommitted changes. At the end it
# prunes the remote branches GitHub deleted and fast-forwards `main` when it is
# checked out.
set -euo pipefail

usage='usage: tools/build/cleanup.sh [spec-issue ...]'
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
if [[ "$(git rev-parse --show-toplevel)" != "$main" ]]; then
  echo "Run this in the main checkout, not in a worktree." >&2
  exit 1
fi

# Prints why a worktree stays and returns 1, or removes it and returns 0.
cleanup() {
  local issue=$1 worktree branch merged changes pid cwd
  worktree="$main/.claude/worktrees/build-$issue"
  [[ -d "$worktree" ]] || {
    echo "No worktree at ${worktree#"$main"/}." >&2
    return 1
  }

  branch=$(git -C "$worktree" branch --show-current)
  merged=$(gh pr list --head "$branch" --state merged --json number --jq '.[0].number // empty')
  if [[ -z "$merged" ]]; then
    echo "Kept: no merged PR for $branch yet." >&2
    return 1
  fi
  changes=$(git -C "$worktree" status --porcelain)
  if [[ -n "$changes" ]]; then
    echo "Kept: ${worktree#"$main"/} has uncommitted changes:" >&2
    echo "$changes" >&2
    return 1
  fi

  # Finds processes by their working directory, not by name: `pkill -f` would
  # also match the shell running this script.
  if [[ -d "$worktree/node_modules" ]]; then
    (cd "$worktree" && pnpm -s agent down >/dev/null 2>&1) || true
  fi
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    [[ "$cwd" == "$worktree" || "$cwd" == "$worktree"/* ]] && kill "$pid" 2>/dev/null || true
  done

  # --force: the linked .env.local and node_modules are untracked files.
  git worktree remove --force "$worktree" || return 1
  # -D: a squash merge leaves the branch unmerged in git's eyes.
  git branch -D --quiet "$branch" || return 1
  echo "Removed ${worktree#"$main"/} and $branch (PR #$merged)."
}

status=0
if [[ $# -gt 0 ]]; then
  for issue in "$@"; do
    [[ "$issue" =~ ^[0-9]+$ ]] || {
      echo "$usage (got '$issue')" >&2
      exit 1
    }
  done
  # A named issue that stays is an error; in a sweep over all it is the rule.
  for issue in "$@"; do
    cleanup "$issue" || status=1
  done
else
  for worktree in "$main"/.claude/worktrees/build-*/; do
    issue=$(basename "$worktree")
    issue=${issue#build-}
    [[ "$issue" =~ ^[0-9]+$ ]] || continue
    cleanup "$issue" || true
  done
fi

git fetch --prune --quiet
if [[ "$(git branch --show-current)" == main ]]; then
  git pull --ff-only --quiet && echo "main is at $(git log -1 --format='%h %s')."
fi
exit "$status"
