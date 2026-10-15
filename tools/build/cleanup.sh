#!/usr/bin/env bash
# Removes a /build worktree once its PR is merged, from the main checkout:
#
#   tools/build/cleanup.sh <spec-issue>
#
# It stops the processes running in `.claude/worktrees/build-<issue>` (the dev
# server from `pnpm -s agent up` and any other process whose working directory
# is inside it), removes the worktree, deletes its branch, prunes the remote
# branches GitHub deleted and fast-forwards `main` when it is checked out. It
# keeps everything when the PR is not merged or the worktree has uncommitted
# changes.
set -euo pipefail

issue=${1:?usage: tools/build/cleanup.sh <spec-issue>}
[[ "$issue" =~ ^[0-9]+$ ]] || {
  echo "usage: tools/build/cleanup.sh <spec-issue> (got '$issue')" >&2
  exit 1
}
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
if [[ "$(git rev-parse --show-toplevel)" != "$main" ]]; then
  echo "Run this in the main checkout, not in a worktree." >&2
  exit 1
fi
worktree="$main/.claude/worktrees/build-$issue"
[[ -d "$worktree" ]] || {
  echo "No worktree at ${worktree#"$main"/}." >&2
  exit 1
}

branch=$(git -C "$worktree" branch --show-current)
merged=$(gh pr list --head "$branch" --state merged --json number --jq '.[0].number // empty')
if [[ -z "$merged" ]]; then
  echo "Kept: no merged PR for $branch yet." >&2
  exit 1
fi
changes=$(git -C "$worktree" status --porcelain)
if [[ -n "$changes" ]]; then
  echo "Kept: ${worktree#"$main"/} has uncommitted changes:" >&2
  echo "$changes" >&2
  exit 1
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
git worktree remove --force "$worktree"
# -D: a squash merge leaves the branch unmerged in git's eyes.
git branch -D "$branch"
git fetch --prune --quiet
echo "Removed ${worktree#"$main"/} and $branch (PR #$merged)."
if [[ "$(git branch --show-current)" == main ]]; then
  git pull --ff-only --quiet && echo "main is at $(git log -1 --format='%h %s')."
fi
