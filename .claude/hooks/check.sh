#!/usr/bin/env bash
# Stop: run the full `pnpm check` before Claude finishes a turn that changed
# files. On failure, exit 2 keeps Claude working with the errors as feedback.
set -uo pipefail
input=$(cat)
source "$(dirname "$0")/env.sh"

# Nothing changed since the last commit: skip the slow check.
[[ -z "$(git status --porcelain)" ]] && exit 0

if ! out=$(pnpm check 2>&1); then
  # Already blocked once this turn: let Claude stop (it may need to ask the
  # user something) instead of looping, but tell the user checks are red.
  if [[ $(jq -r '.stop_hook_active // false' <<<"$input") == true ]]; then
    echo '{"systemMessage": "pnpm check is still failing."}'
    exit 0
  fi
  echo "pnpm check failed. Fix the errors below before finishing:" >&2
  tail -n 80 <<<"$out" >&2
  exit 2
fi
exit 0
