#!/usr/bin/env bash
# Brings up one local app that holds every PR waiting for review, for /sitting:
#
#   tools/sitting/preview.sh
#
# It puts the worktree `.claude/worktrees/preview` on origin/main, merges the
# branch of each open PR that is not a draft and that no bot opened, oldest
# first, applies their migrations to the local database and starts the app
# with `pnpm -s agent up`. A PR whose branch conflicts with main or with an
# earlier PR is left out and named. Run it again after a merge or a push.
set -euo pipefail

main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
preview="$main/.claude/worktrees/preview"

git -C "$main" fetch --prune --quiet origin
if [[ -d "$preview" ]]; then
  if [[ -d "$preview/node_modules" ]]; then
    (cd "$preview" && pnpm -s agent down >/dev/null 2>&1) || true
  fi
  # Nobody edits the preview: whatever is in it is a merge of an earlier run.
  git -C "$preview" merge --abort 2>/dev/null || true
  git -C "$preview" checkout --quiet --force --detach origin/main
else
  git -C "$main" worktree add --quiet --detach "$preview" origin/main
fi
cd "$preview"
[[ -e .env.local ]] || ln -s "$main/.env.local" .env.local

prs=$(gh pr list --state open --limit 100 --json number,headRefName,title,isDraft,author \
  --jq 'map(select((.isDraft | not) and (.author.is_bot | not))) | sort_by(.number)[]
    | [.number, .headRefName, .title] | @tsv')
lines=()
count=0
while IFS=$'\t' read -r number branch title; do
  [[ -n "$number" ]] || continue
  if git merge --quiet --no-edit "origin/$branch" >/dev/null 2>&1; then
    lines+=("  in   #$number $title")
    count=$((count + 1))
  else
    git merge --abort 2>/dev/null || true
    lines+=("  out  #$number $title (conflicts with main or an earlier PR)")
  fi
done <<<"$prs"

pnpm install --frozen-lockfile --prefer-offline --reporter=silent
# Both print progress and warnings on success: show their output only when
# they fail.
up=$(pnpm -s agent up 2>&1) || {
  echo "$up" >&2
  exit 1
}
migrated=$(pnpm exec supabase migration up --local --include-all 2>&1) || {
  echo "$migrated" >&2
  exit 1
}
url=$(grep '^app' <<<"$up" | grep -o 'http://localhost:[0-9]*' || true)

echo "Preview: $url (main plus waiting PRs: $count)"
[[ ${#lines[@]} -eq 0 ]] || printf '%s\n' "${lines[@]}"
if [[ "$url" != "http://localhost:3000" ]]; then
  echo "Port 3000 is taken, and it is the only one the user's browser reaches." >&2
  echo "Stop the server on it (\`pnpm -s agent down\` in its checkout) and run this again." >&2
  exit 1
fi
