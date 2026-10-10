#!/usr/bin/env bash
# PostToolUse (Write|Edit): fix and format the edited file, then report any
# lint errors that remain back to Claude (exit 2 sends stderr to the model).
# Only errors block: warnings such as an unused variable are normal between
# test-first steps, and `pnpm check` (the stop hook) still refuses them.
set -uo pipefail
source "$(dirname "$0")/env.sh"

file=$(jq -r '.tool_input.file_path // empty')
[[ -n "$file" && -f "$file" && "$file" == "$CLAUDE_PROJECT_DIR"/* ]] || exit 0

# Lint from the file's own checkout, so edits in agent worktrees are linted too.
root=$(checkout_root "$(dirname "$file")") || exit 0
cd "$root" || exit 0
# A worktree before `pnpm install`: nothing to lint with yet.
[[ -d node_modules ]] || exit 0

if [[ "$file" =~ \.(ts|tsx|js|jsx|mjs|cjs)$ ]]; then
  if ! out=$(pnpm exec eslint --fix --quiet --no-warn-ignored \
    --cache --cache-location node_modules/.cache/eslint-hook/ "$file" 2>&1); then
    pnpm exec prettier --write --ignore-unknown "$file" >/dev/null 2>&1
    echo "ESLint errors remain in $file:" >&2
    echo "$out" >&2
    exit 2
  fi
fi

pnpm exec prettier --write --ignore-unknown --log-level=warn "$file" >/dev/null
exit 0
