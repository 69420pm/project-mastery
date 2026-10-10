#!/usr/bin/env bash
# Runs before `pnpm test:e2e`: Playwright serves whatever production build is
# in .next, so rebuild it when any input of the build is newer than the last
# build. "Run e2e" then always means "run e2e on this code".
set -euo pipefail
cd "$(dirname "$0")/.."

# Tests against a running deployment need no local build.
[[ -n "${PLAYWRIGHT_BASE_URL:-}" ]] && exit 0

build_id=.next/BUILD_ID
inputs=(src public next.config.ts postcss.config.mjs tsconfig.json package.json pnpm-lock.yaml .env.local)
existing=()
for input in "${inputs[@]}"; do
  [[ -e "$input" ]] && existing+=("$input")
done

if [[ -f "$build_id" ]]; then
  # -L follows the .env.local symlink in agent worktrees.
  newer=$(find -L "${existing[@]}" -newer "$build_id" -print -quit)
  [[ -z "$newer" ]] && exit 0
  echo "e2e: $newer changed since the last build; rebuilding." >&2
else
  echo "e2e: no production build yet; building." >&2
fi
pnpm build
