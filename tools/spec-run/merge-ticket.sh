#!/usr/bin/env bash
# Merges a finished ticket branch into the integration branch, verifies the
# result and pushes it:
#
#   tools/spec-run/merge-ticket.sh <ticket-branch>
#
# Run it in the main checkout with the integration branch checked out and
# clean. It takes several minutes, so run it in the background. On any failure
# it puts the integration branch back where it was, so the checkout stays
# clean, and the exit code says who fixes it:
#
#   10  merge conflict      the ticket's implementer merges the integration
#                           branch into its ticket branch and resolves it
#   20  check, build or     the ticket's implementer fixes it on its branch
#       database tests fail
#   30  a changed e2e spec  the implementer finds out why: a flaky test is a
#       fails when repeated product bug (a race) until shown otherwise
#   40  the e2e suite fails the implementer fixes it on its branch
#
# After the fix, run this script again.
set -uo pipefail

ticket=${1:?usage: merge-ticket.sh <ticket-branch>}
cd "$(git rev-parse --show-toplevel)" || exit 1
integration=$(git branch --show-current)

if [[ -n $(git status --porcelain) ]]; then
  echo "The checkout has uncommitted changes. Merge from a clean integration branch." >&2
  exit 1
fi
before=$(git rev-parse HEAD)

fail() {
  local code=$1 message=$2 log=$3
  echo "✗ $message" >&2
  tail -n 60 <<<"$log" >&2
  git reset --quiet --hard "$before"
  echo "$integration is back at $(git rev-parse --short "$before")." >&2
  exit "$code"
}
step() {
  local code=$1 name=$2 out
  shift 2
  echo "· $name"
  out=$("$@" 2>&1) || fail "$code" "$name failed:" "$out"
}

if ! out=$(git merge --no-ff --no-edit "$ticket" 2>&1); then
  conflicts=$(git diff --name-only --diff-filter=U)
  git merge --abort
  echo "✗ Merging $ticket into $integration conflicts in:" >&2
  echo "${conflicts:-$out}" >&2
  exit 10
fi
echo "· merged $ticket"

changed() { git diff --name-only --diff-filter=d "$before" HEAD -- "$@"; }

step 20 "install" pnpm install --frozen-lockfile --prefer-offline --reporter=silent
if [[ -n $(changed supabase/migrations) ]]; then
  step 20 "migrations" pnpm exec supabase migration up --local --include-all
fi
step 20 "pnpm check" pnpm check
step 20 "pnpm build" pnpm build
step 20 "database tests" pnpm db:test

mapfile -t specs < <(changed 'e2e/*.spec.ts')
if ((${#specs[@]} > 0)); then
  step 30 "changed e2e specs, 5 runs each" pnpm test:e2e --repeat-each=5 "${specs[@]}"
fi
step 40 "e2e suite" pnpm test:e2e

if ! out=$(git push --quiet -u origin "$integration" 2>&1); then
  echo "✗ Push failed; the merge is committed locally:" >&2
  echo "$out" >&2
  exit 50
fi
echo "✓ $ticket merged into $integration and pushed. Its diff: git diff $(git rev-parse --short "$before")..$(git rev-parse --short HEAD)"
