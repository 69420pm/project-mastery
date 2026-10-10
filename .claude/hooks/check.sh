#!/usr/bin/env bash
# Stop and SubagentStop: run the full `pnpm check` in the checkout the agent
# worked in before it finishes. On failure, exit 2 keeps the agent working
# with the errors as feedback.
set -uo pipefail
input=$(cat)
source "$(dirname "$0")/env.sh"

block() {
  # Already blocked once this turn: let the agent stop (it may need to ask
  # something) instead of looping, but say that checks are red.
  if [[ $(jq -r '.stop_hook_active // false' <<<"$input") == true ]]; then
    echo '{"systemMessage": "pnpm check is still failing."}'
    exit 0
  fi
  echo "$1" >&2
  exit 2
}

root=$(checkout_root "$(jq -r '.cwd // empty' <<<"$input")") ||
  root=$(checkout_root "$CLAUDE_PROJECT_DIR") || exit 0
cd "$root" || exit 0

# Each checkout records the commit it last saw green.
stamp=$(git rev-parse --path-format=absolute --git-path claude-checked-head)
dirty=$(git status --porcelain)

if [[ $(jq -r '.hook_event_name' <<<"$input") == SubagentStop ]]; then
  # Subagents in the shared checkout are covered by the main session's Stop.
  [[ "$root" == "$(checkout_root "$CLAUDE_PROJECT_DIR")" ]] && exit 0
  # A worktree agent usually commits before it stops, so check its new
  # commits too: anything not yet pushed and not yet seen green.
  if [[ -z "$dirty" ]]; then
    [[ -n $(git for-each-ref --contains HEAD refs/remotes) ]] && exit 0
    [[ "$(git rev-parse HEAD)" == "$(cat "$stamp" 2>/dev/null)" ]] && exit 0
  fi
  [[ -d node_modules ]] ||
    block "This worktree has changes but no node_modules, so pnpm check cannot run. Run tools/spec-run/setup-worktree.sh <integration-branch> <work-id> first."
else
  # Nothing changed since the last commit: skip the slow check.
  [[ -z "$dirty" ]] && exit 0
fi

out=$(pnpm check 2>&1) ||
  block "pnpm check failed in $root. Fix the errors below before finishing:
$(tail -n 80 <<<"$out")"
[[ -z "$dirty" ]] && git rev-parse HEAD >"$stamp"
exit 0
