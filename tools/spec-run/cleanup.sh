#!/usr/bin/env bash
# Cleans up after a spec run, from the main checkout:
#
#   tools/spec-run/cleanup.sh <integration-branch>
#
# For each agent worktree under .claude/worktrees/, it stops the processes
# running in it (the dev server from `pnpm -s agent up`, and any other process
# whose working directory is inside it), then removes the worktree. Then it
# deletes the work branches `<integration-branch>-*` that are merged into the
# integration branch. A worktree with uncommitted changes and an unmerged
# branch are kept and listed, never forced.
#
# It finds processes by their working directory, not by name: `pkill -f`
# matches the shell that runs it and kills that too.
set -uo pipefail

integration=${1:?usage: cleanup.sh <integration-branch>}
cd "$(git rev-parse --show-toplevel)" || exit 1
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
if [[ "$PWD" != "$main" ]]; then
  echo "Run this in the main checkout, not in a worktree." >&2
  exit 1
fi
git rev-parse --quiet --verify "refs/heads/$integration" >/dev/null || {
  echo "No branch $integration." >&2
  exit 1
}

# Stops every process whose working directory is inside the given directory.
stop_processes_in() {
  local dir=$1 pid cwd
  [[ -d /proc ]] || return 0
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
    [[ "$cwd" == "$dir" || "$cwd" == "$dir"/* ]] && kill "$pid" 2>/dev/null
  done
}

kept=()
mapfile -t worktrees < <(git worktree list --porcelain | sed -n 's/^worktree //p' | grep -F "$main/.claude/worktrees/")
for worktree in "${worktrees[@]}"; do
  if [[ -d "$worktree/node_modules" ]]; then
    (cd "$worktree" && pnpm -s agent down >/dev/null 2>&1)
  fi
  stop_processes_in "$worktree"
  if out=$(git worktree remove "$worktree" 2>&1); then
    echo "removed   ${worktree#"$main"/}"
  else
    kept+=("${worktree#"$main"/}: $out")
  fi
done
git worktree prune

mapfile -t branches < <(git branch --format='%(refname:short)' --list "$integration-*")
for branch in "${branches[@]}"; do
  if git merge-base --is-ancestor "$branch" "$integration"; then
    if git branch --quiet -D "$branch" 2>/dev/null; then
      echo "deleted   $branch"
    else
      kept+=("$branch: checked out in a kept worktree")
    fi
  else
    kept+=("$branch: not merged into $integration")
  fi
done

if ((${#kept[@]} > 0)); then
  echo
  echo "Kept, to check by hand:"
  printf '  %s\n' "${kept[@]}"
  exit 1
fi
